/*
 * SurfinLive — tournament generator core logic
 * No dependencies. Works in the browser (window.SurfinLive) and in Node (module.exports).
 *
 * Rules implemented (per the spec):
 *  - Participants are seeded (shuffled) into the first round.
 *  - Each round is split into "shows" of K or K+1 contestants (hard rule),
 *    where K is the configured per-show size (default 4).
 *  - The best 2 contestants of each show advance; the rest are eliminated.
 *  - This continues until 4 contestants remain. They meet in the FINAL show (size 4),
 *    where the top 2 are crowned champion and runner-up. (The Final is a show of 4,
 *    fed by 2 semifinals each advancing 2.)
 *  - Rounds are named on the canonical ladder:
 *      Preliminary -> Octofinal -> Quarterfinal -> Semifinal -> Final
 *    (the Final is always the last round and always holds exactly 4 contestants;
 *     smaller fields use a shorter suffix of this ladder).
 *
 * Not every participant count divides cleanly into K-(K+1) shows with top-2 advancing
 * into a 4-person Final (e.g. 5, 6, 11). To keep the rule exact for ANY input, small
 * fields are padded with "BYE" slots in round 1. A BYE is a ghost entry: it occupies a
 * K-(K+1) show slot but, ranked below real contestants, is eliminated in round 1 (so it
 * never steals a real advancement slot and never becomes champion). This yields a valid
 * bracket for any N >= 2 while every show stays exactly K or K+1 and the Final always
 * has exactly 4.
 *
 * A full 5-round ladder (Preliminary..Final) appears for ~64 participants.
 *
 * The per-show size K is configurable via generateTournament(names, rng, opts) where
 * opts.contestantsPerShow defaults to 4 (the historical behavior). SurfinSettings
 * supplies the persisted value to the UI.
 */
(function (global) {
  'use strict';

  var ROUND_LADDER = ['Preliminary', 'Octofinal', 'Quarterfinal', 'Semifinal', 'Final'];
  var BYE = 'BYE';
  var SHOW_DURATION_SEC = 20 * 60; // 20-minute show window

  function defaultRng() { return Math.random(); }

  function shuffle(arr, rng) {
    rng = rng || defaultRng;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Express n as a sum of Ks and (K+1)s (shows of K or K+1) for a given base size K.
  // Every returned show is K or K+1. We pick the show COUNT H that is (a) fillable
  // (K*H <= n <= (K+1)*H, i.e. bigs = n - K*H in [0,H]), (b) chainable (2*H itself
  // reaches the Final of 4), and (c) closest to the balanced target n/(K+0.5) (so the
  // split is as even as possible). Among show-counts with equal distance to the target
  // we prefer fewer (K+1)s. Returns an array of show sizes, or null if no K-(K+1)
  // partition chains to 4.
  //
  // With K=4 this reproduces the historical "shows of 4 or 5" rule exactly.
  //
  // Why chaining matters: a partition is only useful if playing it out (top 2 per show)
  // keeps yielding K-(K+1)-splittable fields all the way to 4.
  function partitionKExt(n, K) {
    K = K || 4;
    if (n < 2) return null;
    if (n === 4) return [4]; // terminal Final show (always size 4 regardless of K)
    if (K === 4 && n === 4) return [4];
    var target = Math.round(n / (K + 0.5));
    var Hmin = Math.ceil(n / (K + 1));
    var Hmax = Math.floor(n / K);
    var best = null, bestScore = Infinity;
    for (var H = Hmin; H <= Hmax; H++) {
      if (!cleanReachesN(2 * H, K)) continue;
      var bigs = n - K * H;
      if (bigs < 0 || bigs > H) continue; // not fillable with Ks+(K+1)s
      var score = Math.abs(H - target) * 100 + bigs;
      if (score < bestScore) {
        bestScore = score;
        best = [];
        for (var a = 0; a < H - bigs; a++) best.push(K);
        for (var b = 0; b < bigs; b++) best.push(K + 1);
      }
    }
    return best;
  }

  // Backwards-compatible alias matching the historical 4-5 naming.
  function partition4or5(n) { return partitionKExt(n, 4); }

  // Does a bracket starting at count c terminate cleanly at the FINAL (count 4)
  // using only valid K-(K+1) partitions at every round?
  function cleanReachesN(c, K) {
    K = K || 4;
    var x = c;
    while (x > 4) {
      var p = partitionKExt(x, K);
      if (!p) return false;
      x = 2 * p.length;
    }
    return x === 4;
  }

  // Backwards-compatible alias.
  function cleanReaches4(c) { return cleanReachesN(c, 4); }

  // Smallest clean bracket size >= N (pads with BYEs when needed).
  function padToCleanSize(N, K) {
    K = K || 4;
    var c = N;
    while (!cleanReachesN(c, K)) c++;
    return c;
  }

  // Tournament short code: 5 uppercase letters + 1 digit (e.g. "QXJZP3").
  // Generated fresh every time a tournament is built, and travels with the
  // tournament object through the store, so the Live View and Dashboard always
  // agree on the same code for a given bracket.
  function makeShortId() {
    var letters = '';
    for (var i = 0; i < 5; i++) {
      letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    }
    return letters + Math.floor(Math.random() * 10);
  }

  // Stable internal id for the store. Set ONCE at generation time and carried
  // with the tournament object, so every subsequent Store.put() (Start/End,
  // Live View tick persistence) updates the SAME record instead of cloning a
  // new one. Without this the Dashboard would leave stale duplicate snapshots,
  // and the Short-ID-resolved Dynamic View could latch onto a pre-Start copy.
  function makeId() {
    return 'T' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function generateTournament(names, rng, opts) {
    var list = (names || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (list.length < 2) {
      throw new Error('At least 2 participants are required to build a tournament.');
    }
    // K = per-show base size (a show holds K or K+1 contestants). Default 4 keeps
    // the historical "shows of 4 or 5" behavior; 3 enables "shows of 3 or 4".
    var K = (opts && opts.contestantsPerShow) ? parseInt(opts.contestantsPerShow, 10) : 4;
    if (!(K >= 3 && K <= 8)) K = 4; // guard against nonsense / Final-of-4 breakage
    var N = list.length;
    var c = padToCleanSize(N, K);
    var byes = c - N;

    // Distribute the N real contestants across the H0 round-1 shows so that every show
    // receives between 2 and its capacity reals, and the sum equals N. We start from the
    // full show capacities (c slots) and convert `byes` of them to BYE slots, always
    // taking from the most-populated show so no show drops below 2 reals. This keeps the
    // 4-5 / top-2 ladder exact and chainable for any input.
    var firstSizes = partitionKExt(c, K) || partition4or5(c);
    var H0 = firstSizes.length;
    if (N < 2 * H0) {
      // Should not happen for valid clean sizes, but guard anyway.
      throw new Error('Internal: cannot seat ' + N + ' contestants with ' + H0 + ' shows (need >= ' + (2 * H0) + ').');
    }
    var alloc = firstSizes.slice();
    var deficit = byes;
    while (deficit > 0) {
      // find show with the largest allocation that can still give up a slot (stays >= 2)
      var best = -1, bestVal = 2;
      for (var q = 0; q < H0; q++) {
        if (alloc[q] > bestVal) { bestVal = alloc[q]; best = q; }
      }
      if (best === -1) break; // cannot reduce further (shouldn't happen)
      alloc[best]--;
      deficit--;
    }
    var reals = shuffle(list, rng);
    var ri = 0;
    var seeds = []; // flat pool, ordered show-by-show (show1 slots, show2 slots, ...)
    for (var hi = 0; hi < H0; hi++) {
      for (var k = 0; k < alloc[hi]; k++) seeds.push(reals[ri++]);
      for (var bk = 0; bk < firstSizes[hi] - alloc[hi]; bk++) seeds.push(BYE);
    }

    var rounds = [];
    var pool = seeds.slice();
    // First show that receives real contestants becomes Active. It does NOT become
    // Live — `live` is owned exclusively by startShow() (the Dashboard Start button),
    // so a freshly generated bracket has NO live show and every show reads "open".
    var activeAssigned = false;

    while (true) {
      var isFinal = (pool.length === 4);
      var sizes = isFinal ? [4] : (partitionKExt(pool.length, K) || partition4or5(pool.length)); // clean because c is clean
      var offset = 0;
      var shows = sizes.map(function (size, hi) {
        var slice = pool.slice(offset, offset + size);
        offset += size;
        var hasReals = slice.some(function (name) { return name !== BYE; });
        return {
          label: 'Show ' + (hi + 1),
          status: hasReals ? (activeAssigned ? 'open' : 'active') : 'open',
          live: false,
          phase: 'open',
          startedAt: null,
          endedAt: null,
          contestants: slice.map(function (name) {
            if (!activeAssigned && name !== BYE) activeAssigned = true;
            return {
              name: name,
              score: null,
              status: name === BYE ? 'bye' : 'pending',
              isBye: name === BYE
            };
          })
        };
      });
      rounds.push({ name: '', shows: shows, isFinal: isFinal });

      if (isFinal) break;

      var survivors = sizes.length * 2;
      pool = [];
      for (var s = 0; s < survivors; s++) pool.push('TBD');
    }

    // Name the rounds so the Final is always last. Extra rounds (fields > 40) get
    // "Qualifying N" prefixes in front of the canonical 5-name ladder.
    var R = rounds.length;
    var names2 = [];
    if (R <= ROUND_LADDER.length) {
      names2 = ROUND_LADDER.slice(ROUND_LADDER.length - R);
    } else {
      var extra = R - ROUND_LADDER.length;
      for (var e = 0; e < extra; e++) names2.push('Qualifying ' + (e + 1));
      names2 = names2.concat(ROUND_LADDER);
    }
    rounds.forEach(function (r, i) { r.name = names2[i]; });

    return {
      __id: makeId(),
      __createdAt: Date.now(),
      shortId: makeShortId(),
      participants: N,
      byes: byes,
      contestantsPerShow: K, // persisted so Live View / re-render reuse the same size
      status: 'open', // 'open' while running; set to 'Ended' when the Final is concluded
      rounds: rounds,
      champion: null,
      runnerUp: null,
      third: null,
      fourth: null,
      simulated: false
    };
  }

  // Clear any previous results so the tournament can be re-simulated (keeps round-1
  // seeding/matchups stable across re-runs).
  function resetResults(t) {
    if (!t || !t.rounds) return t;
    // Same rule as generateTournament: reset restores the freshly-generated state,
    // which has NO live show. `live` only becomes true via startShow().
    var activeAssigned = false;
    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      for (var hi = 0; hi < round.shows.length; hi++) {
        var show = round.shows[hi];
        var hasReals = show.contestants.some(function (c) { return !c.isBye; });
        show.status = hasReals ? (activeAssigned ? 'open' : 'active') : 'open';
        show.live = false;
        show.phase = 'open';
        show.startedAt = null;
        show.endedAt = null;
        if (hasReals) activeAssigned = true;
        for (var ci = 0; ci < show.contestants.length; ci++) {
          var con = show.contestants[ci];
          if (r === 0) {
            con.score = null;
            con.status = con.isBye ? 'bye' : 'pending';
          } else {
            con.name = 'TBD';
            con.score = null;
            con.status = 'tbd';
            con.isBye = false;
          }
        }
      }
    }
    t.champion = null;
    t.runnerUp = null;
    t.third = null;
    t.fourth = null;
    t.simulated = false;
    t.status = 'open';
    return t;
  }

  // Manual mode works round-by-round (matching the progressive UI): the user picks
  // winners in round 0, those promote into round 1, then round 1 becomes pickable, etc.
  // scoreRound(t, idx) validates and applies picks for ONE round and promotes winners
  // into the next round. Returns { ok, errors }. The Final crowns champion/runnerUp.
  function scoreRound(t, idx, rng) {
    if (!t || !t.rounds) throw new Error('Nothing to score.');
    var round = t.rounds[idx];
    var errors = [];

    round.shows.forEach(function (show) {
      var reals = show.contestants.filter(function (c) { return !c.isBye && c.status !== 'tbd'; });
      if (reals.length === 0) return;
      var picked = reals.filter(function (c) { return c.picked; });
      if (reals.length >= 3) {
        if (picked.length !== 2) errors.push(round.name + ' ' + show.label + ': pick exactly 2 to advance (' + picked.length + ' picked).');
      } else if (picked.length !== reals.length) {
        errors.push(round.name + ' ' + show.label + ': pick all ' + reals.length + ' contestants.');
      }
    });
    if (errors.length) return { ok: false, errors: errors };

    var advancedNames = [];
    round.shows.forEach(function (show) {
      var reals = show.contestants.filter(function (c) { return !c.isBye && c.status !== 'tbd'; });
      var adv = reals.filter(function (c) { return c.picked; });
      var elim = reals.filter(function (c) { return !c.picked; });
      adv.forEach(function (c) { c.status = 'advanced'; });
      elim.forEach(function (c) { c.status = 'eliminated'; });
      if (round.isFinal) {
        if (adv[0]) { adv[0].status = 'champion'; t.champion = adv[0].name; }
        if (adv[1]) { adv[1].status = 'runnerup'; t.runnerUp = adv[1].name; }
        // 3rd and 4th are the two eliminated finalists.
        t.third = elim[0] ? elim[0].name : null;
        t.fourth = elim[1] ? elim[1].name : null;
        t.status = 'Ended'; // Final concluded -> tournament over
      }
      adv.forEach(function (c) { advancedNames.push(c.name); });
    });

    // This round is now decided — close all its shows.
    round.shows.forEach(function (h) { h.status = 'closed'; h.live = false; h.phase = 'ended'; });

    if (idx + 1 < t.rounds.length) {
    // Re-randomize the advancing order so each new round gets a freshly
    // shuffled draw (show placement + within-show order both change).
    advancedNames = shuffle(advancedNames, rng || defaultRng);
    var nxt = t.rounds[idx + 1];
    var kk = 0;
    nxt.shows.forEach(function (ht) {
      ht.status = 'active';
      ht.live = false;
      ht.phase = 'open';
      ht.contestants.forEach(function (c) {
        if (kk < advancedNames.length) {
          c.name = advancedNames[kk++];
          c.status = 'pending';
          c.isBye = false;
          c.score = null;
          c.picked = false;
        }
      });
    });
    }
    return { ok: true, errors: [], done: round.isFinal, champion: t.champion, runnerUp: t.runnerUp };
  }

  // Re-open a previously scored round: wipe its decisions AND everything downstream,
  // restoring the tournament to the state right after generation (so the user can
  // re-pick). Operates on the live tournament object.
  function clearFromRound(t, idx) {
    for (var r = idx; r < t.rounds.length; r++) {
      t.rounds[r].shows.forEach(function (show) {
        // shows at/after idx are downstream: empty (TBD) -> open; not live
        show.status = 'open';
        show.live = false;
        show.phase = 'open';
        show.contestants.forEach(function (c) {
          if (r === 0) {
            c.status = c.isBye ? 'bye' : 'pending';
            c.score = null; c.picked = false;
          } else {
            c.name = 'TBD'; c.status = 'tbd'; c.isBye = false; c.score = null; c.picked = false;
          }
        });
      });
    }
    t.champion = null; t.runnerUp = null; t.third = null; t.fourth = null; t.simulated = false; t.status = 'open';
    return t;
  }

  // Simulate (or re-simulate) the whole tournament. Uses each contestant's `score`
  // if set, otherwise assigns a random score. Top 2 per show advance (BYEs rank
  // last, so they only advance if fewer than 2 real contestants are present).
  function simulateTournament(t, rng) {
    rng = rng || defaultRng;
    if (!t || !t.rounds) throw new Error('Nothing to simulate.');
    resetResults(t);

    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      var advancedNames = [];

      for (var hi = 0; hi < round.shows.length; hi++) {
        var show = round.shows[hi];
        var reals = [];
        var byes = [];
        show.contestants.forEach(function (c) {
          if (c.isBye) { byes.push(c); }
          else if (c.status !== 'tbd') { reals.push(c); }
        });

        reals.forEach(function (c) {
          c.score = (c.score == null) ? Math.round(rng() * 4000) / 100 : c.score;
        });
        reals.sort(function (a, b) { return b.score - a.score; });

        // ranking: real contestants (by score) then BYEs
        var ranking = reals.concat(byes);
        var adv = ranking.slice(0, 2);
        var elim = ranking.slice(2);

        adv.forEach(function (c) { c.status = 'advanced'; });
        elim.forEach(function (c) { c.status = 'eliminated'; });

        if (round.isFinal) {
          if (reals[0]) { reals[0].status = 'champion'; t.champion = reals[0].name; }
          if (reals[1]) { reals[1].status = 'runnerup'; t.runnerUp = reals[1].name; }
          t.third = reals[2] ? reals[2].name : null;
          t.fourth = reals[3] ? reals[3].name : null;
          t.status = 'Ended'; // Final concluded -> tournament over
        }
        adv.forEach(function (c) { if (!c.isBye) advancedNames.push(c.name); });
      }

      // This round is now decided — close all its shows.
      round.shows.forEach(function (h) { h.status = 'closed'; h.live = false; h.phase = 'ended'; });

      if (r + 1 < t.rounds.length) {
        // Re-randomize the advancing order so each new round gets a freshly
        // shuffled draw (show placement + within-show order both change).
        advancedNames = shuffle(advancedNames, rng);
        var next = t.rounds[r + 1];
        var k = 0;
        for (var nh = 0; nh < next.shows.length; nh++) {
          var nhc = next.shows[nh].contestants;
          for (var ci = 0; ci < nhc.length; ci++) {
            if (k < advancedNames.length) {
              nhc[ci].name = advancedNames[k++];
              nhc[ci].status = 'pending';
              nhc[ci].isBye = false;
              nhc[ci].score = null;
            }
          }
        }
        // The next round just opened: its shows go Active but NOT live — going live
        // is always an explicit Dashboard Start (startShow), never automatic.
        next.shows.forEach(function (h) { h.status = 'active'; h.live = false; h.phase = 'open'; });
      }
    }

    t.simulated = true;
    return t;
  }

  // Returns the real (non-BYE) contestants of `show` in the Judge- Panel-
  // controlled display order. The order is persisted on show.order (an array
  // of names); it is lazily initialized to the current contestant order on
  // first use. Reordering (done only in the Judge Panel) mutates show.order so
  // Row COLOR is owned by the contestant (assigned when the show goes LIVE, or
  // lazily backfilled by ensureShowColors) and stays fixed until the show ends.
  // Dragging reorders `order` only, so a contestant carries its color with it.
  // Priority numbers always stay 1..N in the displayed order.
  //
  // ensureShowColors: guarantees every real contestant has a UNIQUE color from
  // {red,white,blue,yellow,black}. It only fills MISSING colors (idempotent — a
  // contestant already holding a valid color keeps it), so once assigned the
  // color is stable for the whole show. This backfills shows that started before
  // color-assignment existed, and rounds that opened but were never explicitly
  // started, without ever reshuffling an already-colored show.
  var COLOR_SET = ['red', 'white', 'blue', 'yellow', 'black'];
  function ensureShowColors(show) {
    if (!show || !show.contestants) return;
    var reals = show.contestants.filter(function (c) { return !c.isBye; });
    var used = {};
    reals.forEach(function (c) { if (COLOR_SET.indexOf(c.color) !== -1) used[c.color] = true; });
    var pool = COLOR_SET.filter(function (col) { return !used[col]; });
    var p = 0;
    reals.forEach(function (c) {
      if (COLOR_SET.indexOf(c.color) === -1) {
        // wrap around the free pool if more contestants than colors (won't happen
        // for 4-5 surfer heats, but safe for any size)
        c.color = pool[p % pool.length]; p++;
      }
    });
  }

  function orderedContestants(show) {
    if (!show || !show.contestants) return [];
    var reals = show.contestants.filter(function (c) { return !c.isBye; });
    if (!show.order) show.order = reals.map(function (c) { return c.name; });
    var byName = {};
    reals.forEach(function (c) { byName[c.name] = c; });
    var ordered = [];
    show.order.forEach(function (nm) {
      if (byName[nm]) { ordered.push(byName[nm]); delete byName[nm]; }
    });
    // Any real contestant missing from order (e.g. added later) appends.
    reals.forEach(function (c) { if (byName[c.name]) ordered.push(c); });
    return ordered;
  }

  // --- Live-phase control (Dashboard Start / End buttons) -------------
  // A show moves open -> live -> ended. Only a "live" show streams on the
  // Live View (its 20:00 countdown runs). "ended" freezes the countdown and
  // unlocks winner selection in the Dashboard.
  function startShow(show) {
    if (!show) return;
    show.phase = 'live';
    show.live = true;
    // Record when the 20-minute window began. The Live View derives the moving
    // countdown (and never auto-resets) from this timestamp, so the exact value
    // is "now - startedAt", frozen at End. Persisted on the show via the store.
    show.startedAt = Date.now();
    // Assign a fresh, unique color to each real contestant for THIS show. The set
    // is red/white/blue/yellow/black, shuffled so every round hands out a new
    // arrangement. Colors are fixed on the contestant until the show ends; the
    // next startShow (next round) reassigns them.
    var reals = show.contestants.filter(function (c) { return !c.isBye; });
    var palette = ['red', 'white', 'blue', 'yellow', 'black'];
    shuffle(palette);
    reals.forEach(function (c, i) { c.color = palette[i % palette.length]; });
  }
  function endShow(show) {
    if (!show) return;
    show.phase = 'ended';
    show.live = false;
    // Freeze the countdown at the exact value at End. The Live View reads this
    // timestamp (instead of the clock) once ended, so the displayed value never
    // drifts after a reload.
    show.endedAt = Date.now();
  }
  // When a show ends, auto-select its top 2 by current score so the round can
  // advance immediately. Safe to call on a show of any size — contests of <3
  // auto-pick everyone. The user can still toggle picks afterward (manual override).
  function autoPickTopTwo(show) {
    if (!show) return;
    var reals = show.contestants.filter(function (c) { return !c.isBye && c.status !== 'tbd'; });
    reals.forEach(function (c) { c.picked = false; });
    reals.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var n = Math.min(2, reals.length);
    for (var i = 0; i < n; i++) reals[i].picked = true;
  }
  // One-time migration for tournaments saved under the old '*10' score encoding
  // (c.score held whole numbers 0..200 representing the real score * 10). Any such
  // legacy record read back is corrected in place to the real value (÷10). Modern
  // records store the real value directly and are left untouched. This only runs on
  // read, never on display — display always uses fmt(c.score) with no division.
  function normalizeScores(t) {
    if (!t || !t.rounds) return t;
    t.rounds.forEach(function (round) {
      round.shows.forEach(function (show) {
        show.contestants.forEach(function (c) {
          if (c.isBye || c.score == null) return;
          // Legacy shape: a whole-number score that is also > 40 (we never assign a
          // real score above ~40.00, so 137 etc. can only be the old *10 encoding).
          if (typeof c.score === 'number' && c.score % 1 === 0 && c.score > 40) {
            c.score = Math.round((c.score / 10) * 100) / 100;
          }
        });
      });
    });
    return t;
  }
  var api = {
    ROUND_LADDER: ROUND_LADDER,
    BYE: BYE,
    SHOW_DURATION_SEC: SHOW_DURATION_SEC,
    shuffle: shuffle,
    partition4or5: partition4or5,
    partitionKExt: partitionKExt,
    cleanReaches4: cleanReaches4,
    cleanReachesN: cleanReachesN,
    padToCleanSize: padToCleanSize,
    generateTournament: generateTournament,
    resetResults: resetResults,
    scoreRound: scoreRound,
    clearFromRound: clearFromRound,
    simulateTournament: simulateTournament,
    startShow: startShow,
    endShow: endShow,
    autoPickTopTwo: autoPickTopTwo,
    orderedContestants: orderedContestants,
    ensureShowColors: ensureShowColors,
    normalizeScores: normalizeScores
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SurfinLive = api;
  }
})(typeof window !== 'undefined' ? window : this);
