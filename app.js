/* SurfinLive — UI controller. Depends on tournament.js (window.SurfinLive). */
(function () {
  'use strict';

  var S = window.SurfinLive;
  var els = {
    tournamentName: document.getElementById('tournament-name'),
    names: document.getElementById('names'),
    generate: document.getElementById('generate'),
    clearInput: document.getElementById('clear-input'),
    inputError: document.getElementById('input-error'),
    toolbar: document.getElementById('toolbar'),
    simulate: document.getElementById('simulate'),
    reset: document.getElementById('reset'),
    roundRandomizer: document.getElementById('round-randomizer'),
    bracket: document.getElementById('bracket'),
    champion: document.getElementById('champion'),
    modeBanner: document.getElementById('mode-banner'),
    tourneyName: document.getElementById('tourney-name'),
    shortIdWrap: document.getElementById('short-id-wrap'),
    shortId: document.getElementById('short-id'),
    shareShortId: document.getElementById('share-shortid'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalYes: document.getElementById('modal-yes'),
    modalNo: document.getElementById('modal-no')
  };

  // --- Confirmation modal (Start / End show) ---------------------------
  // Ask the user "are you sure to Start/End this show?" with Yes / No. The
  // provided callback only runs if the user clicks Yes; No just closes it.
  var modalCallback = null;
  function confirmShow(message, onYes) {
    els.modalTitle.textContent = message;
    modalCallback = onYes;
    els.modalOverlay.hidden = false;
  }
  function closeModal() {
    els.modalOverlay.hidden = true;
    modalCallback = null;
  }
  els.modalYes.addEventListener('click', function () {
    var cb = modalCallback;
    closeModal();
    if (cb) cb();
  });
  els.modalNo.addEventListener('click', closeModal);
  els.modalOverlay.addEventListener('click', function (e) {
    if (e.target === els.modalOverlay) closeModal(); // click outside = No
  });

  // --- Share the generated Short ID as a tournament link ----------------
  // Builds the URL from the page's own host:port, e.g.
  //   localhost:5000/dyn.html?shortId=ABC123
  function shareShortIdUrl() {
    var t = state.tournament;
    if (!t || !t.shortId) return null;
    return location.hostname + (location.port ? ':' + location.port : '') +
           '/dyn.html?shortId=' + encodeURIComponent(t.shortId);
  }
  if (els.shareShortId) {
    els.shareShortId.addEventListener('click', async function () {
      var url = shareShortIdUrl();
      if (!url) return;
      var btn = els.shareShortId;
      var original = btn.textContent;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✓ Copied!';
      } catch (e) {
        btn.textContent = '⚠ Copy failed';
      }
      setTimeout(function () { btn.textContent = original; }, 1800);
    });
  }

  var state = {
    tournament: null,
    mode: null // 'sim' | 'manual'
  };

  var SAMPLE_SETS = {
    8: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira'],
    12: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton'],
    16: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton', 'Owen Wright', 'Sally Fitzgibbons', 'Jordy Smith', 'Caroline Marks']
  };

  function sampleNames(n) {
    if (SAMPLE_SETS[n]) return SAMPLE_SETS[n].join('\n');
    // Any other count (e.g. 32, 64): generate procedural names so the chip
    // always produces n entries. Real rosters are reused first when helpful,
    // then padded with "Surfer N" up to n.
    var out = [];
    // start from the largest real roster we have, then fill the rest
    var base = SAMPLE_SETS[16] || [];
    for (var i = 0; i < n; i++) {
      out.push(base[i] || ('Surfer ' + (i + 1)));
    }
    return out.join('\n');
  }

  function parseNames() {
    return els.names.value
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function showInputError(msg) {
    els.inputError.textContent = msg;
    els.inputError.hidden = false;
  }
  function clearInputError() {
    els.inputError.hidden = true;
    els.inputError.textContent = '';
  }

  function activeRoundIndex(t) {
    for (var i = 0; i < t.rounds.length; i++) {
      var round = t.rounds[i];
      var hasPending = round.shows.some(function (h) {
        return h.contestants.some(function (c) { return !c.isBye && c.name !== 'TBD' && c.status === 'pending'; });
      });
      if (hasPending) return i;
    }
    return -1; // all decided
  }

  // --- Rendering ---------------------------------------------------------
  function statusClass(c) {
    if (c.isBye) return 'bye';
    switch (c.status) {
      case 'advanced': return 'advanced';
      case 'eliminated': return 'eliminated';
      case 'champion': return 'champion';
      case 'runnerup': return 'runnerup';
      case 'pending': return 'pending';
      default: return '';
    }
  }

  function fmt(n) { return (n == null ? 0 : n).toFixed(2); }

  function renderContestant(c, opts) {
    var div = document.createElement('div');
    div.className = 'contestant ' + statusClass(c);
    var clickable = opts && opts.clickable;
    if (clickable) {
      div.classList.add('clickable');
      if (c.picked) div.classList.add('picked');
    }

    var name = document.createElement('span');
    name.className = 'c-name';
    name.textContent = c.isBye ? 'BYE' : c.name;
    div.appendChild(name);

    if (c.isBye) return div;

    if (opts && opts.showScore && c.score != null) {
      var sc = document.createElement('span');
      sc.className = 'c-score';
      sc.textContent = fmt(c.score);
      div.appendChild(sc);
    }
    if (c.status === 'champion') {
      var badge = document.createElement('span');
      badge.className = 'c-badge';
      badge.textContent = '👑';
      div.appendChild(badge);
    } else if (c.status === 'runnerup') {
      var b2 = document.createElement('span');
      b2.className = 'c-badge';
      b2.textContent = '2nd';
      div.appendChild(b2);
    }
    return div;
  }

  function render() {
    var t = state.tournament;
    if (!t) return;
    // Surface the tournament's name (centered) and short code beneath the status banner.
    if (t.name && els.tourneyName) {
      els.tourneyName.textContent = t.name;
      els.tourneyName.hidden = false;
    } else if (els.tourneyName) {
      els.tourneyName.hidden = true;
    }
    if (t.shortId && els.shortIdWrap) {
      els.shortId.textContent = t.shortId;
      els.shortIdWrap.hidden = false;
    } else if (els.shortIdWrap) {
      els.shortIdWrap.hidden = true;
    }
    els.bracket.innerHTML = '';
    var activeIdx = activeRoundIndex(t);

    t.rounds.forEach(function (round, ri) {
      var col = document.createElement('div');
      col.className = 'round-col';

      var title = document.createElement('div');
      title.className = 'round-title' + (round.isFinal ? ' is-final' : '');
      title.innerHTML = round.name + '<span class="count">' + round.shows.length + ' show' + (round.shows.length > 1 ? 's' : '') + (round.isFinal ? ' · 2 finalists' : '') + '</span>';
      col.appendChild(title);

      var shows = document.createElement('div');
      shows.className = 'shows';

      var isActive = (ri === activeIdx);
      var showScore = state.mode === 'sim' || round.status === 'scored' ||
        round.shows.some(function (h) { return h.phase === 'ended'; });

      round.shows.forEach(function (show) {
        var hdiv = document.createElement('div');
        hdiv.className = 'show' + (isActive ? '' : ' locked');
        var hlabel = document.createElement('div');
        hlabel.className = 'show-label';
        hlabel.textContent = show.label + (round.isFinal ? ' · Final' : ' · top 2 advance');
        // ONE state badge per show, driven by the live lifecycle the user drives
        // with Start/End (phase), not by internal bracket progression (status):
        //   open -> ● LIVE -> ended, and "closed" once the round is advanced.
        // A freshly generated show therefore reads "open" and only becomes
        // "● LIVE" after Start is confirmed.
        var stateTag = document.createElement('span');
        if (show.status === 'closed') {
          stateTag.className = 'show-tag tag-closed';
          stateTag.textContent = 'closed';
        } else if (show.phase === 'live') {
          stateTag.className = 'show-tag tag-live';
          stateTag.textContent = '● LIVE';
        } else if (show.phase === 'ended') {
          stateTag.className = 'show-tag tag-ended';
          stateTag.textContent = 'ended';
        } else {
          stateTag.className = 'show-tag tag-open';
          stateTag.textContent = 'open';
        }
        hlabel.appendChild(stateTag);
        hdiv.appendChild(hlabel);

        var phase = show.phase || 'open';

        // Start / End controls (Dashboard-driven live phase).
        var actions = document.createElement('div');
        actions.className = 'show-actions';
        if (phase === 'open') {
          var startBtn = document.createElement('button');
          startBtn.className = 'btn btn-green show-start';
          startBtn.textContent = 'Start';
          startBtn.addEventListener('click', function () {
            confirmShow('Are you sure to Start this show?', function () { onStartShow(ri, show); });
          });
          actions.appendChild(startBtn);
        } else if (phase === 'live') {
          var endBtn = document.createElement('button');
          endBtn.className = 'btn btn-danger show-end';
          endBtn.textContent = 'End';
          endBtn.addEventListener('click', function () {
            confirmShow('Are you sure to End this show?', function () { onEndShow(ri, show); });
          });
          actions.appendChild(endBtn);
        } else { // ended
          var endedTag = document.createElement('div');
          endedTag.className = 'unlock-note';
          endedTag.textContent = '✓ ended — select 2 to advance';
          actions.appendChild(endedTag);
        }

        show.contestants.forEach(function (c) {
          var clickable = phase === 'ended' && !c.isBye && c.status === 'pending';
          var node = renderContestant(c, { clickable: clickable, showScore: showScore });
          if (clickable) {
            node.addEventListener('click', function () { onPick(ri, show, c); });
          }
          hdiv.appendChild(node);
        });
        // Start / End controls live UNDER the contestant names (not above them).
        hdiv.appendChild(actions);
        shows.appendChild(hdiv);
      });
      col.appendChild(shows);

      // round action button for manual mode
      if (state.mode === 'manual') {
        var actions = document.createElement('div');
        actions.className = 'round-actions';
        if (isActive) {
          var pickedCount = countPicked(round);
          var btn = document.createElement('button');
          btn.className = 'btn btn-primary';
          btn.textContent = round.isFinal ? 'Finalize Tournament 🏆' : 'Advance this round →';
          btn.disabled = !canAdvance(round);
          btn.addEventListener('click', function () { onAdvanceRound(ri); });
          actions.appendChild(btn);
          var pc = document.createElement('div');
          pc.className = 'pick-counter';
          var need = minPicks(round);
          pc.textContent = 'Picked ' + pickedCount + ' / ' + need + ' to advance';
          actions.appendChild(pc);
        } else if (ri < activeIdx) {
          var done = document.createElement('div');
          done.className = 'unlock-note';
          done.textContent = '✓ scored';
          actions.appendChild(done);
        } else {
          var lock = document.createElement('div');
          lock.className = 'unlock-note';
          lock.textContent = '🔒 end a show to unlock';
          actions.appendChild(lock);
        }
        col.appendChild(actions);
      }

      els.bracket.appendChild(col);
    });

    renderChampion(t);
  }

  function renderChampion(t) {
    var hasChamp = t.champion && (t.simulated || t.rounds[t.rounds.length - 1].status === 'scored');
    if (hasChamp) {
      els.champion.hidden = false;
      els.champion.innerHTML =
        '<h3>🏆 Champion</h3>' +
        '<div class="crown">👑</div>' +
        '<div class="who"></div>' +
        '<div class="ru">Runner-up: <span class="ru-name"></span></div>' +
        '<div class="third">3rd: <span class="third-name"></span></div>' +
        '<div class="fourth">4th: <span class="fourth-name"></span></div>';
      els.champion.querySelector('.who').textContent = t.champion === S.BYE ? '—' : t.champion;
      els.champion.querySelector('.ru-name').textContent = t.runnerUp === S.BYE ? '—' : t.runnerUp;
      els.champion.querySelector('.third-name').textContent = (!t.third || t.third === S.BYE) ? '—' : t.third;
      els.champion.querySelector('.fourth-name').textContent = (!t.fourth || t.fourth === S.BYE) ? '—' : t.fourth;
    } else {
      els.champion.hidden = true;
    }
  }

  function minPicks(round) {
    // total minimum picks needed = number of reals in shows of size>=3 contribute 2,
    // shows of size <3 contribute their real count. For a clean tournament this is 2*shows.
    var total = 0;
    round.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye; });
      total += Math.min(2, reals.length);
    });
    return total;
  }
  function countPicked(round) {
    var n = 0;
    round.shows.forEach(function (h) {
      h.contestants.forEach(function (c) { if (!c.isBye && c.picked) n++; });
    });
    return n;
  }
  function canAdvance(round) {
    var ok = true;
    round.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye && c.status === 'pending'; });
      var picked = reals.filter(function (c) { return c.picked; }).length;
      if (reals.length >= 3) { if (picked !== 2) ok = false; }
      else if (picked !== reals.length) ok = false;
    });
    return ok;
  }

  // --- Interactions ------------------------------------------------------
  function onPick(ri, show, contestant) {
    var round = state.tournament.rounds[ri];
    var reals = show.contestants.filter(function (c) { return !c.isBye && c.status === 'pending'; });
    if (reals.length >= 3) {
      // toggle; cap at 2 picks per this show
      if (!contestant.picked) {
        var pickedHere = reals.filter(function (c) { return c.picked; }).length;
        if (pickedHere >= 2) return; // already 2 in this show
      }
      contestant.picked = !contestant.picked;
    } else {
      contestant.picked = !contestant.picked;
    }
    render();
  }

  function onStartShow(ri, show) {
    S.startShow(show);
    render();
    persist();
  }

  function onEndShow(ri, show) {
    S.endShow(show);
    // Stop the score change (Live View freezes on End) and automatically
    // highlight the top 2 (by score) to advance. The user can still change
    // these picks manually before advancing the round.
    S.autoPickTopTwo(show);
    render();
    persist();
  }

  // --- Persistence (durable cache) ------------------------------------
  // Every generated tournament is saved to the shared store (localStorage),
  // and the current one is restored when the Dashboard reloads — so navigating
  // away and back (or reopening the tab) never loses a tournament.
  function persist() {
    if (state.tournament) {
      // Lock in the typed Tournament Name at the moment we persist (i.e. when a
      // live status is confirmed). This value then flows to the Live View, which
      // only swaps "TOURNAMENT" -> name once a show is live.
      if (els.tournamentName) state.tournament.name = els.tournamentName.value.trim() || '';
      try { window.SurfinStore.put(state.tournament); } catch (e) {}
      // keep the Live-link fallback too for same-tab convenience
      try { sessionStorage.setItem('surfinlive.tournament', JSON.stringify(state.tournament)); } catch (e) {}
    }
    var link = document.querySelector('.nav-link[href="index.html"]');
    if (link) link.setAttribute('data-has-bracket', state.tournament ? '1' : '');
  }

  function restore() {
    try {
      var t = window.SurfinStore.current();
      if (t && t.rounds && t.rounds.length) {
        state.tournament = t;
        state.mode = t.simulated ? 'sim' : 'manual';
        if (t.rounds[t.rounds.length - 1].status === 'scored') state.mode = 'sim';
        if (els.tournamentName) els.tournamentName.value = t.name || '';
        els.toolbar.hidden = false;
        if (els.simulate) els.simulate.hidden = false;
        setBanner(state.mode === 'sim'
          ? 'Restored previous bracket (simulated). Hit Reset to start over or switch to manual.'
          : 'Restored previous bracket — pick 2 to advance in each show, or hit Simulate.', false);
        render();
      }
    } catch (e) {}
  }

  function onAdvanceRound(ri) {
    var res = S.scoreRound(state.tournament, ri);
    if (!res.ok) { alert(res.errors.join('\n')); return; }
    state.tournament.rounds[ri].status = 'scored';
    render();
    persist();
  }

  // --- Re-randomize open shows in the active round ----------------------
  // Fisher-Yates shuffle of a copy (does not mutate the input array).
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Re-shuffle the contestant names in every show of the active round that is
  // still "open". Shows that have started (live), ended, or been closed (round
  // advanced) are left exactly as they are.
  function randomizeRound() {
    var t = state.tournament;
    if (!t || !t.rounds || !t.rounds.length) return;
    var ri = activeRoundIndex(t);
    if (ri < 0) return; // nothing left to play
    var round = t.rounds[ri];
    var changed = 0;
    round.shows.forEach(function (show) {
      // Only touch shows still in the "open" phase: not started/live, not ended,
      // and not closed (round already advanced).
      var phase = show.phase || 'open';
      if (phase === 'live' || phase === 'ended' || show.status === 'closed') return;
      // Collect the real (non-bye) contestants and shuffle just their order,
      // then write them back into the real slots so BYE positions stay fixed.
      var realIdx = [];
      var reals = [];
      show.contestants.forEach(function (c, ci) {
        if (!c.isBye) { realIdx.push(ci); reals.push(c); }
      });
      if (reals.length < 2) return; // nothing meaningful to shuffle
      var shuffled = shuffleArray(reals);
      realIdx.forEach(function (ci, k) { show.contestants[ci] = shuffled[k]; });
      changed++;
    });
    if (changed > 0) {
      render();
      persist();
    }
  }

  // Source of truth for the per-show size: the value the user typed in the
  // on-page control. Falls back to the persisted setting only if the control
  // isn't present. We deliberately read the INPUT directly (not localStorage)
  // so clicking Generate uses exactly what's on screen — no hidden cross-page
  // state can override it.
  function getDashboardK() {
    var el = document.getElementById('cps-dash');
    var raw = el ? parseInt(el.value, 10) : NaN;
    if (!isNaN(raw) && raw >= 3 && raw <= 8) return raw;
    return (window.SurfinSettings) ? window.SurfinSettings.getContestantsPerShow() : 4;
  }

  function generate() {
    clearInputError();
    var names = parseNames();
    if (names.length < 2) { showInputError('Enter at least 2 participant names.'); return; }
    try {
      // Use the on-page control's value directly; never fall through to a stale
      // stored default. (Prefs are still persisted so other pages stay in sync.)
      var genOpts = { contestantsPerShow: getDashboardK() };
      state.tournament = S.generateTournament(names, null, genOpts);
    } catch (e) {
      showInputError(e.message);
      return;
    }
    state.mode = 'manual';
    els.toolbar.hidden = false;
    if (els.simulate) els.simulate.hidden = false;
    // Capture the typed Tournament Name now so the centered name line renders
    // immediately on generate (persist() also locks it in, but render() runs first).
    state.tournament.name = (els.tournamentName ? els.tournamentName.value.trim() : '') || 'Untitled Tournament';
    setBanner('Manual mode — pick 2 to advance in each show, or hit Simulate for random results.', false);
    render();
    persist();
  }

  function simulate() {
    if (!state.tournament) return;
    S.simulateTournament(state.tournament);
    state.mode = 'sim';
    state.tournament.rounds.forEach(function (r) { r.status = 'scored'; });
    setBanner('Simulated (random scores). Hit Reset to start over or switch to manual.', true);
    render();
    persist();
  }

  function resetResults() {
    if (!state.tournament) return;
    S.resetResults(state.tournament);
    state.tournament.rounds.forEach(function (r) { r.status = undefined; });
    state.mode = 'manual';
    setBanner('Manual mode — pick 2 to advance in each show, or hit Simulate for random results.', false);
    render();
    persist();
  }

  function setBanner(text, scored) {
    els.modeBanner.hidden = false;
    els.modeBanner.textContent = text;
    els.modeBanner.classList.toggle('scored', !!scored);
  }

  // --- Wire up -----------------------------------------------------------
  els.generate.addEventListener('click', generate);
  els.clearInput.addEventListener('click', function () {
    els.names.value = ''; clearInputError();
  });
  if (els.simulate) els.simulate.addEventListener('click', simulate);
  els.reset.addEventListener('click', resetResults);
  if (els.roundRandomizer) els.roundRandomizer.addEventListener('click', randomizeRound);

  // --- Dashboard "Contestants per show" control -------------------------
  // Lives directly on the Dashboard so the setting can't be lost to cross-page
  // cache/state issues. Persists via SurfinSettings (so the Settings page and
  // Live View stay in sync) and shows a live readout of the next bracket.
  var cpsDash = document.getElementById('cps-dash');
  var cpsDashOk = document.getElementById('cps-dash-ok');
  var cpsReadout = document.getElementById('cps-readout');
  function currentK() {
    return (window.SurfinSettings) ? window.SurfinSettings.getContestantsPerShow() : 4;
  }
  function refreshCpsReadout() {
    if (!cpsReadout) return;
    var k = currentK();
    var n = Math.max(0, parseNames().length);
    var txt;
    if (n === 0) {
      txt = 'Next bracket: shows of ' + k + ' (top 2 advance; Final = 4). Enter names above.';
    } else {
      var c = S.padToCleanSize(n, k);
      var firstSizes = S.partitionKExt(c, k) || S.partition4or5(c);
      txt = 'Next bracket: ' + n + ' names -> ' + firstSizes.length + ' show(s) of ' +
            firstSizes.join('/') + ' (top 2 advance; Final = 4).';
    }
    cpsReadout.textContent = txt;
  }
  if (cpsDash && cpsDashOk) {
    // reflect stored value on load
    var storedK = currentK();
    cpsDash.value = storedK;
    refreshCpsReadout();
    cpsDash.addEventListener('input', refreshCpsReadout);
    cpsDashOk.addEventListener('click', function () {
      var v = parseInt(cpsDash.value, 10);
      if (isNaN(v)) return;
      var clamped = (window.SurfinSettings)
        ? window.SurfinSettings.set({ contestantsPerShow: v }).contestantsPerShow
        : (v < 3 ? 3 : v > 8 ? 8 : v);
      cpsDash.value = clamped;
      refreshCpsReadout();
    });
  }

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var n = parseInt(chip.getAttribute('data-sample'), 10);
      els.names.value = sampleNames(n);
      clearInputError();
    });
  });

  // Seed with a sample so the page is immediately usable.
  els.names.value = sampleNames(8);

  // Restore the most recently generated tournament (if any) so navigating
  // back to the Dashboard never loses state.
  restore();
})();
