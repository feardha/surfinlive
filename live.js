/* SurfinLive — Live View controller.
 * Picks one random show from a freshly generated bracket and shows its
 * contestants with dummy scores that tick up in real time, as if an
 * ongoing show is happening. No database — brackets are generated in the
 * browser with window.SurfinLive (tournament.js).
 */
(function () {
  'use strict';

  var S = window.SurfinLive;

  var SAMPLE_SETS = {
    8: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira'],
    12: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton'],
    16: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton', 'Owen Wright', 'Sally Fitzgibbons', 'Jordy Smith', 'Caroline Marks'],
    32: null // generated procedurally
  };

  var COLORS = ['red', 'white', 'yellow', 'blue', 'black'];
  var FLAG_COLORS = { red: '#e23b3b', white: '#f4f4f4', yellow: '#f5c518', blue: '#2f7de1', black: '#1a1a1a' };

  function sampleNames(n) {
    if (SAMPLE_SETS[n]) return SAMPLE_SETS[n].slice();
    var out = [];
    for (var i = 1; i <= n; i++) out.push('Surfer ' + i);
    return out;
  }

  var els = {
    meta: document.getElementById('live-meta'),
    liveTag: document.getElementById('live-tag'),
    round: document.getElementById('live-round'),
    show: document.getElementById('live-show'),
    list: document.getElementById('live-list').querySelector('tbody'),
    detail: document.getElementById('detail-list').querySelector('tbody'),
    liveCard: document.getElementById('live-card'),
    detailCard: document.getElementById('detail-card'),
    countdown: document.getElementById('countdown'),
    tournamentLabel: document.getElementById('tournament-label'),
    championCard: document.getElementById('champion-card'),
    championName: document.getElementById('champion-name'),
    championRu: document.getElementById('champion-ru'),
    champion3rd: document.getElementById('champion-3rd'),
    champion4th: document.getElementById('champion-4th'),
    footerText: document.getElementById('live-footer-text')
  };

  var ticks = null;
  var state = null; // { names: [{name, score}], roundName, showLabel }
  var currentTournamentId = null; // which cached tournament we are viewing

  // The tournament node (round + show) of the most-recently STARTED show, by
  // startedAt. Returns null if nothing has been started yet. The Live View
  // always broadcasts this show.
  function latestShowRef(t) {
    if (!t || !t.rounds) return null;
    var best = null, bestTs = -1;
    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      for (var h = 0; h < round.shows.length; h++) {
        var show = round.shows[h];
        if (show.startedAt == null) continue;
        if (show.startedAt > bestTs) { bestTs = show.startedAt; best = { round: round, show: show }; }
      }
    }
    return best;
  }

  // Build the Live View payload for the most-recently started show, or null if
  // none has been started.
  function tournamentLiveShow(t) {
    var ref = latestShowRef(t);
    if (!ref) return null;
    var reals = ref.show.contestants.filter(function (c) { return !c.isBye; });
    if (reals.length === 0) return null;
    return { roundName: ref.round.name, showLabel: ref.show.label, names: reals.map(function (c) { return c.name; }) };
  }

  // Fallback: no cached bracket — generate a fresh one and pick a random show.
  function pickRandomShow() {
    var pool = [8, 12, 16, 32];
    var n = pool[Math.floor(Math.random() * pool.length)];
    var t = S.generateTournament(sampleNames(n));
    var all = [];
    t.rounds.forEach(function (r) {
      r.shows.forEach(function (h) {
        var reals = h.contestants.filter(function (c) { return !c.isBye; });
        if (reals.length > 0) all.push({ roundName: r.name, showLabel: h.label, names: reals.map(function (c) { return c.name; }) });
      });
    });
    if (all.length === 0) return null;
    var pick = all[Math.floor(Math.random() * all.length)];
    return { names: pick.names, roundName: pick.roundName, showLabel: pick.showLabel };
  }

  // Which tournament to view: the store's "current" (most recent publication —
  // this is what the Dashboard writes every time it Start/Ends a show), or null
  // (→ random fallback). The Live View has no manual selector; it always mirrors
  // the store's newest tournament. We intentionally resolve through currentId()
  // (NOT a cached id from load time) so a Dashboard re-publish after load is seen
  // immediately — that is what lets LIVE flip back to STANDBY (and the named
  // tournament revert to the countdown) the moment a show is Ended.
  function resolveTournament(id) {
    var list = window.SurfinStore.list();
    // If an explicit id was given AND it is still the current record, honor it.
    // Otherwise always fall through to currentId() so post-load updates win.
    if (id && id === window.SurfinStore.currentId()) {
      var byId = window.SurfinStore.get(id);
      if (byId) return { t: byId, id: id };
    }
    if (window.SurfinStore.currentId()) {
      var cur = window.SurfinStore.current();
      if (cur) return { t: cur, id: window.SurfinStore.currentId() };
    }
    if (list.length) return { t: list[0].tournament, id: list[0].id };
    return null;
  }

  // Seconds remaining for the most-recently STARTED show, derived from its
  // persisted startedAt timestamp. This IS the moving value shown in the
  // countdown box — it is computed from the wall clock, never stored as a
  // mutable counter, so it survives reloads and stays exact. While live it
  // counts down from 20:00; once Ended it freezes at the exact value at End.
  function remainingFor(t) {
    var ref = latestShowRef(t);
    if (!ref || ref.show.startedAt == null) return S.SHOW_DURATION_SEC;
    var anchor;
    if (ref.show.phase === 'ended' && ref.show.endedAt != null) {
      anchor = ref.show.endedAt; // freeze at the moment of End, ignore later clock
    } else {
      anchor = Date.now(); // live: keep moving with the clock
    }
    var elapsed = Math.floor((anchor - ref.show.startedAt) / 1000);
    var rem = S.SHOW_DURATION_SEC - elapsed;
    return rem > 0 ? rem : 0;
  }
  function fmtClock(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  // The 20-minute countdown shown in the "Tournament" box. Its value is always
  // derived from the latest-started show's startedAt (see remainingFor). It only
  // ticks while that show is live; once Ended it freezes at the last value.
  var countdownTimer = null;
  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    var res = resolveTournament(currentTournamentId);
    var t = res ? res.t : null;
    function paint() { els.countdown.textContent = fmtClock(remainingFor(t)); }
    paint();
    if (!liveShow()) return; // frozen at full (pre-start) or frozen (ended)
    countdownTimer = setInterval(function () {
      if (!liveShow()) { clearInterval(countdownTimer); countdownTimer = null; paint(); return; }
      paint();
      if (remainingFor(t) === 0) { clearInterval(countdownTimer); countdownTimer = null; }
    }, 1000);
  }

  // Is the latest-started show currently live (phase === 'live')? Drives the
  // countdown + status pill, so the Live View only streams while that show is live.
  function liveShow() {
    var res = resolveTournament(currentTournamentId);
    if (!res || !res.t) return false;
    var ref = latestShowRef(res.t);
    return !!(ref && ref.show.phase === 'live');
  }

  // Replace the "TOURNAMENT" label text with the named tournament ONLY while a live
  // status is confirmed (latest-started show phase === 'live' AND the Dashboard committed
  // a non-empty name). Otherwise the label falls back to "TOURNAMENT". The countdown is
  // never touched — it stays visible in both cases. Reverts instantly when the show ends.
  function updateTournamentName() {
    if (!els.tournamentLabel) return;
    var res = resolveTournament(currentTournamentId);
    var showName = !!(res && res.t && res.t.name && res.t.name.trim());
    els.tournamentLabel.textContent = (liveShow() && showName) ? res.t.name : 'TOURNAMENT';
  }

  // Resolve which show to show for the currently selected tournament.
  function pickShowForCurrent() {
    var res = resolveTournament(currentTournamentId);
    if (!res) return pickRandomShow(); // nothing cached -> random
    currentTournamentId = res.id;
    var live = tournamentLiveShow(res.t);
    if (live) { live.fromDashboard = true; return live; }
    // no live show (e.g. fully simulated/closing) -> first non-empty show
    var first = null;
    for (var r = 0; r < res.t.rounds.length && !first; r++) {
      res.t.rounds[r].shows.forEach(function (h) {
        if (!first && h.contestants.some(function (c) { return !c.isBye; })) {
          first = { roundName: res.t.rounds[r].name, showLabel: h.label, names: h.contestants.filter(function (c) { return !c.isBye; }).map(function (c) { return c.name; }) };
        }
      });
    }
    if (first) { first.fromDashboard = true; return first; }
    return pickRandomShow();
  }

  function fmt(n) { return n.toFixed(2); }

  // Is the current tournament over? (Final concluded -> status 'Ended')
  function isConcluded(t) {
    return !!(t && t.status === 'Ended');
  }

  // Show the champion card instead of the live cards, and switch the footer to a
  // "tournament concluded" message. Hides the scoreboard + countdown entirely.
  function renderConcluded(t) {
    stopTicks();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    els.liveCard.hidden = true;
    els.detailCard.hidden = true;
    els.championCard.hidden = false;
    els.championName.textContent = (t.champion == null || t.champion === S.BYE) ? '—' : t.champion;
    els.championRu.textContent = (t.runnerUp == null || t.runnerUp === S.BYE) ? '—' : t.runnerUp;
    els.champion3rd.textContent = (t.third == null || t.third === S.BYE) ? '—' : t.third;
    els.champion4th.textContent = (t.fourth == null || t.fourth === S.BYE) ? '—' : t.fourth;
    els.footerText.textContent = 'This tournament has already concluded. Thanks for watching — see the Dashboard for full results.';
    els.liveTag.textContent = 'ENDED';
    els.liveTag.classList.add('frozen');
    // Keep the status row visible but neutral; hide the countdown + select row.
    els.countdown.closest('.live-select-row').hidden = true;
  }

  function render() {
    if (!state) return;
    els.round.textContent = state.roundName;
    var sublabel = /\bfinal\b/i.test(state.roundName) ? 'Decisive Showdown!' : 'Top 2 Advance';
    els.show.textContent = sublabel;
    // Show ranked by current score (highest first), like a live leaderboard.
    var ranked = state.names.slice().sort(function (a, b) { return (b.tw1 + b.tw2) - (a.tw1 + a.tw2); });
    els.list.innerHTML = '';
    ranked.forEach(function (row, i) {
      var tr = document.createElement('tr');

      var num = document.createElement('td');
      num.className = 'live-num';
      num.textContent = (i + 1);

      var name = document.createElement('td');
      name.className = 'live-name';
      name.textContent = row.name;

      var score = document.createElement('td');
      score.className = 'live-score';
      score.textContent = fmt(row.tw1 + row.tw2);

      tr.appendChild(num);
      tr.appendChild(name);
      tr.appendChild(score);
      els.list.appendChild(tr);
    });
    els.meta.textContent = state.roundName + ' • ' + state.names.length + ' surfers in the water';
    renderDetail();
    // Reflect live phase in the status pill + meta.
    if (liveShow()) {
      els.liveTag.textContent = 'LIVE';
      els.liveTag.classList.remove('frozen');
    } else {
      els.liveTag.textContent = 'STANDBY';
      els.liveTag.classList.add('frozen');
    }
    updateTournamentName();
  }

  function renderDetail() {
    if (!state) return;
    // Order follows the Judge-Panel-controlled display order (persisted on the
    // show as `order`), so a row dragged in the Judge Panel moves here too.
    // Priority numbers stay 1..N in the new order; row COLOR is derived from
    // position (1 = red … 5 = black) so name+score+color move together.
    var displayRows = state.names;
    if (state._liveShow && state._liveShow.contestants) {
      var orderedNames = window.SurfinLive.orderedContestants(state._liveShow).map(function (c) { return c.name; });
      var byName = {};
      state.names.forEach(function (r) { byName[r.name] = r; });
      var sorted = [];
      orderedNames.forEach(function (nm) { if (byName[nm]) { sorted.push(byName[nm]); delete byName[nm]; } });
      state.names.forEach(function (r) { if (byName[r.name]) sorted.push(r); });
      displayRows = sorted;
    }
    els.detail.innerHTML = '';
    displayRows.forEach(function (row, i) {
      var prio = i + 1;
      var color = COLORS[i % COLORS.length];
      var tr = document.createElement('tr');

      var flag = document.createElement('td');
      flag.className = 'live-flag';
      var sw = document.createElement('span');
      sw.className = 'priority-badge';
      sw.style.backgroundColor = FLAG_COLORS[color] || color;
      sw.style.color = (color === 'white' || color === 'yellow') ? '#1a1a1a' : '#ffffff';
      sw.title = color + ' · priority ' + prio;
      sw.textContent = String(prio);
      flag.appendChild(sw);

      var name = document.createElement('td');
      name.className = 'live-name';
      name.textContent = row.name;

      var tw1 = document.createElement('td');
      tw1.className = 'live-score';
      tw1.textContent = fmt(row.tw1);

      var tw2 = document.createElement('td');
      tw2.className = 'live-score';
      tw2.textContent = fmt(row.tw2);

      tr.appendChild(flag);
      tr.appendChild(name);
      tr.appendChild(tw1);
      tr.appendChild(tw2);
      els.detail.appendChild(tr);
    });
  }

  function stopTicks() { if (ticks) { clearInterval(ticks); ticks = null; } }

  // Tick: each competitor gains a small random float bump, simulating a live show.
  // Persist the shared tournament (only when we are broadcasting a real stored
  // show) so the Dashboard can read the live scores after the show ends.
  function persistLiveScores() {
    if (!state || !state._liveShow) return;
    var res = resolveTournament(currentTournamentId);
    if (res && res.t) { try { window.SurfinStore.put(res.t); } catch (e) {} }
  }

  // Tick: each competitor gains a small random float bump, simulating a live show.
  // The same value is written back to the real contestant's `score` in the shared
  // store, and ticking STOPS the moment the show ends (phase no longer 'live').
  function startTicks() {
    stopTicks();
    ticks = setInterval(function () {
      if (!state) return;
      state.names.forEach(function (row) {
        row.tw1 = Math.round((row.tw1 + Math.random() * 0.5) * 100) / 100; // +0..0.5 per tick
        row.tw2 = Math.round((row.tw2 + Math.random() * 0.5) * 100) / 100;
        if (row.contestant) row.contestant.score = Math.round((row.tw1 + row.tw2) * 100) / 100;
      });
      persistLiveScores();
      render();
      if (!liveShow()) { stopTicks(); persistLiveScores(); } // freeze scoring on End
    }, 1500);
  }

  // On load: show the current tournament's latest-started show; fall back to random.
  function loadInitial() {
    stopTicks();
    var res = resolveTournament(currentTournamentId);
    if (res && res.t && isConcluded(res.t)) {
      renderConcluded(res.t);
      setInterval(pollLatestShow, 1000);
      return;
    }
    state = pickShowForCurrent();
    if (!state) { els.meta.textContent = 'no shows available'; return; }
    applyShow(state);
    // Watch for the bracket concluding (or a newer show being started) on the Dashboard.
    setInterval(pollLatestShow, 1000);
  }

  // Re-broadcast the latest-started show when it changes (e.g. the user starts a
  // different show on the Dashboard). Also flips to the champion card once the
  // tournament is concluded. Keeps the Live View pinned to the most recently
  // started show while the bracket is running.
  function pollLatestShow() {
    var res = resolveTournament(currentTournamentId);
    if (!res || !res.t) return;
    if (isConcluded(res.t)) { renderConcluded(res.t); return; }
    var ref = latestShowRef(res.t);
    if (!ref) return;
    if (!state || state._startedAt !== ref.show.startedAt) {
      var payload = tournamentLiveShow(res.t);
      if (payload) applyShow(payload);
    }
    updateTournamentName();
  }

  // Initialize a freshly-selected show (random names/scores, render, ticks, countdown).
  function applyShow(show) {
    state = show;
    state._startedAt = null; // start fresh if a random fallback; real shows set below
    var res = resolveTournament(currentTournamentId);
    var liveShowNode = null;
    if (res && res.t) {
      var ref = latestShowRef(res.t);
      if (ref) {
        state._startedAt = ref.show.startedAt;
        liveShowNode = ref.show; // the real show we are broadcasting
      }
    }
    state._liveShow = liveShowNode;
    // Map each display name to its real contestant so ticks can write back to the store.
    var conByType = {};
    if (liveShowNode) {
      liveShowNode.contestants.forEach(function (c) {
        if (!c.isBye) conByType[c.name] = c;
      });
    }
    state.names = state.names.map(function (nm, idx) {
      var color = COLORS[idx % COLORS.length];
      return { name: nm, color: color, priority: COLORS.indexOf(color) + 1, tw1: Math.round(Math.random() * 120) / 10, tw2: Math.round(Math.random() * 120) / 10, contestant: conByType[nm] || null };
    });
    render();
    startTicks();
    startCountdown();
  }

  // Kick off on load.
  if (S && S.generateTournament) loadInitial();
})();
