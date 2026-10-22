/* SurfinLive — Dynamic View controller.
 *
 * A read-only public mirror of the Judge Panel (judge.html) / Live View. A
 * spectator reaches it via a clean URL such as SurfinLive/JQJKJ1  ->
 * dyn.html?shortId=JQJKJ1.
 *
 * It is EVENT-DRIVEN: it never generates its own scores. It reads the SAME
 * tournament the Judge Panel is showing (resolved by Short ID from the shared
 * store) and reflects whatever the judge does, in real time, via two channels:
 *   1. `storage` events  — fires in every OTHER tab/page when judge.js writes
 *      the shared localStorage (SurfinStore persists there). This is the
 *      cross-tab live link between judge.html and dyn.html.
 *   2. `surfinlive:broadcast` — a custom window event the Judge Panel dispatches
 *      directly (same-tab / in-page) on every score / color / priority / show
 *      change, so a dyn view embedded in the same document updates instantly
 *      even where storage events don't fire.
 *
 * What it mirrors (all from the authoritative contestant objects on the show):
 *   - Leaderboard (#dyn-list): real tw1+tw2 scores, ranked, frozen when closed.
 *   - Running Score (#dyn-detail-list): ordered by the judge's `order` (a drag
 *     in the Judge Panel moves a row here); each row shows the PERSON's assigned
 *     color + priority, so color and priority travel with the surfer when the
 *     judge reorders — not with the slot position.
 *   - Countdown: derived from the live show's startedAt + SHOW_DURATION_SEC.
 *   - Champion card when concluded.
 *
 * Scoped to `dyn-` elements so it never collides with the Live View controller.
 */
(function () {
  'use strict';

  var S = window.SurfinLive;

  var COLORS = ['red', 'white', 'yellow', 'blue', 'black'];
  var FLAG_COLORS = { red: '#e23b3b', white: '#f4f4f4', yellow: '#f5c518', blue: '#2f7de1', black: '#1a1a1a' };

  function $(id) { return document.getElementById(id); }

  var els = {
    error: $('dyn-error'),
    errorText: $('dyn-error-text'),
    wrap: $('dyn-wrap'),
    meta: $('dyn-live-meta'),
    liveTag: $('dyn-live-tag'),
    round: $('dyn-live-round'),
    show: $('dyn-live-show'),
    list: $('dyn-list').querySelector('tbody'),
    detail: $('dyn-detail-list').querySelector('tbody'),
    showsList: $('dyn-shows-list').querySelector('tbody'),
    showsCard: $('dyn-shows-card'),
    liveCard: $('dyn-live-card'),
    detailCard: $('dyn-detail-card'),
    countdown: $('dyn-countdown'),
    tournamentLabel: $('dyn-tournament-label'),
    championCard: $('dyn-champion-card'),
    championName: $('dyn-champion-name'),
    championRu: $('dyn-champion-ru'),
    champion3rd: $('dyn-champion-3rd'),
    champion4th: $('dyn-champion-4th'),
    footerText: $('dyn-footer-text'),
    search: $('dyn-search'),
    searchForm: $('dyn-search-form'),
    searchInput: $('dyn-search-input'),
    searchError: $('dyn-search-error')
  };

  var countdownTimer = null;
  var expandedKey = null;     // "<roundIdx>:<showIdx>" of the tapped show (null = none)
  var state = null;           // { names, roundName, showLabel, _liveShow, _tournament }
  var currentTournamentId = null;
  var requestedShortId = null;
  var resolvedShowRef = null; // { round, show } currently mirrored

  // --- Short ID resolution from the URL -------------------------------
  function readShortId() {
    try {
      var p = new URLSearchParams(window.location.search);
      var v = p.get('shortId');
      if (v) return v.trim();
    } catch (e) {}
    return null;
  }

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

  function findLiveShow(t) {
    if (!t || !t.rounds) return null;
    var best = null, bestTs = -1;
    for (var r = 0; r < t.rounds.length; r++) {
      t.rounds[r].shows.forEach(function (show) {
        if (show.phase !== 'live') return;
        var reals = show.contestants.filter(function (c) { return !c.isBye; });
        if (reals.length === 0) return;
        if (show.startedAt == null) show.startedAt = 0;
        if (show.startedAt >= bestTs) { bestTs = show.startedAt; best = { round: t.rounds[r], show: show }; }
      });
    }
    return best;
  }

  function latestClosedShow(t) {
    if (!t || !t.rounds) return null;
    var best = null, bestTs = -1;
    for (var r = 0; r < t.rounds.length; r++) {
      t.rounds[r].shows.forEach(function (show) {
        if (show.phase !== 'ended') return;
        var reals = show.contestants.filter(function (c) { return !c.isBye; });
        if (reals.length === 0) return;
        if (show.startedAt == null) show.startedAt = 0;
        if (show.startedAt > bestTs) { bestTs = show.startedAt; best = { round: t.rounds[r], show: show }; }
      });
    }
    return best;
  }

  function firstRealShow(t) {
    if (!t || !t.rounds) return null;
    for (var r = 0; r < t.rounds.length; r++) {
      for (var h = 0; h < t.rounds[r].shows.length; h++) {
        var show = t.rounds[r].shows[h];
        var reals = show.contestants.filter(function (c) { return !c.isBye; });
        if (reals.length > 0) return { round: t.rounds[r], show: show };
      }
    }
    return null;
  }

  function pickShowForShortId(t) {
    var live = findLiveShow(t);
    if (live) return live;
    var closed = latestClosedShow(t);
    if (closed) return closed;
    return firstRealShow(t);
  }

  function resolveTournament() {
    if (!requestedShortId) return null;
    var m = window.SurfinStore.getByShortId(requestedShortId);
    if (!m) return null;
    currentTournamentId = m.id;
    return { t: m.tournament, id: m.id };
  }

  function remainingFor(t) {
    var ref = latestShowRef(t);
    if (!ref || ref.show.startedAt == null) return S.SHOW_DURATION_SEC;
    var anchor;
    if (ref.show.phase === 'ended' && ref.show.endedAt != null) anchor = ref.show.endedAt;
    else anchor = Date.now();
    var elapsed = Math.floor((anchor - ref.show.startedAt) / 1000);
    var rem = S.SHOW_DURATION_SEC - elapsed;
    return rem > 0 ? rem : 0;
  }
  function fmtClock(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function fmt(n) { return n.toFixed(2); }
  function isConcluded(t) { return !!(t && t.status === 'Ended'); }

  // --- Rendering (reads the authoritative contestant objects) --------
  function renderHeader(t) {
    if (!els.tournamentLabel) return;
    var name = t && t.name ? t.name.trim() : '';
    els.tournamentLabel.textContent = name || 'Tournament Name';
    var live = findLiveShow(t);
    if (live) {
      els.liveTag.textContent = 'LIVE';
      els.liveTag.classList.remove('frozen');
      els.liveCard.hidden = false;
      els.detailCard.hidden = false;
    } else {
      els.liveTag.textContent = 'STANDBY';
      els.liveTag.classList.add('frozen');
    }
  }

  function renderLeaderboard(t) {
    var ref = latestShowRef(t);
    var show = ref ? ref.show : null;
    els.list.innerHTML = '';
    if (!show) return;
    var reals = show.contestants.filter(function (c) { return !c.isBye; });
    var ranked = reals.slice().sort(function (a, b) { return effectiveScore(b) - effectiveScore(a); });
    ranked.forEach(function (c, i) {
      var tr = document.createElement('tr');
      var num = document.createElement('td'); num.className = 'live-num'; num.textContent = (i + 1);
      var name = document.createElement('td'); name.className = 'live-name'; name.textContent = c.name;
      var score = document.createElement('td'); score.className = 'live-score'; score.textContent = fmt(effectiveScore(c));
      tr.appendChild(num); tr.appendChild(name); tr.appendChild(score);
      els.list.appendChild(tr);
    });
    var sublabel = ref.round ? ref.round.name : '';
    els.round.textContent = sublabel;
    var verb = /final/i.test(sublabel) ? 'Decisive Showdown!' : 'Top 2 Advance';
    els.show.textContent = verb;
    els.meta.textContent = sublabel + ' • ' + reals.length + ' surfers in the water';
  }

  function effectiveScore(c) {
    return c.score != null ? c.score : 0;
  }

  // Running Score: ordered by the Judge Panel's `order` (a drag there moves a
  // row here). Each row shows the PERSON's assigned color + priority, so color
  // and priority travel with the surfer when the judge reorders — not with the
  // slot position. This is the fix for "assigned color did not move on reorder".
  function renderDetail(t) {
    var ref = latestShowRef(t);
    var show = ref ? ref.show : null;
    els.detail.innerHTML = '';
    if (!show) return;
    var ordered = window.SurfinLive.orderedContestants(show); // per judge `order`
    ordered.forEach(function (c, i) {
      var prio = i + 1;
      var color = (c.color && COLORS.indexOf(c.color) !== -1) ? c.color : COLORS[i % COLORS.length];
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
      name.textContent = c.name;

      // High 1st / High 2nd MUST mirror the Judge Panel's Running Score exactly.
      // The judge (and the canonical Live View, live.js) define them as the two
      // constituent wave scores stored on the contestant (c.tw1, c.tw2) — NOT a
      // total. Read those directly; only fall back to the seeded total/0 when a
      // show has been persisted but never actually ticked (tw1/tw2 still null).
      var tw1Val = (c.tw1 != null) ? c.tw1 : effectiveScore(c);
      var tw2Val = (c.tw2 != null) ? c.tw2 : 0;
      var tw1 = document.createElement('td');
      tw1.className = 'live-score';
      tw1.textContent = fmt(tw1Val);

      var tw2 = document.createElement('td');
      tw2.className = 'live-score';
      tw2.textContent = fmt(tw2Val);

      tr.appendChild(flag);
      tr.appendChild(name);
      tr.appendChild(tw1);
      tr.appendChild(tw2);
      els.detail.appendChild(tr);
    });
  }

  function renderAllShows() {
    var res = resolveTournament();
    var t = res ? res.t : null;
    if (!t || !t.rounds) { els.showsCard.hidden = true; return; }
    els.showsCard.hidden = false;
    els.showsList.innerHTML = '';
    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      for (var h = 0; h < round.shows.length; h++) {
        (function (round, show, rIdx, hIdx) {
          var reals = show.contestants.filter(function (c) { return !c.isBye; });
          if (reals.length === 0) return;
          var key = rIdx + ':' + hIdx;
          var tr = document.createElement('tr');
          tr.className = 'dyn-show-row';
          tr.setAttribute('data-key', key);
          if (key === expandedKey) tr.classList.add('is-open');

          var ended = show.phase === 'ended';
          var cRound = document.createElement('td'); cRound.className = 'live-name' + (ended ? ' dyn-show-ended' : ''); cRound.textContent = round.name;
          var cShow = document.createElement('td'); cShow.className = 'live-name' + (ended ? ' dyn-show-ended' : ''); cShow.textContent = show.label;
          var cStatus = document.createElement('td');
          var tag = document.createElement('span');
          tag.className = 'dyn-show-tag ' + showStatusClass(show);
          tag.textContent = showStatusLabel(show);
          cStatus.appendChild(tag);

          tr.appendChild(cRound); tr.appendChild(cShow); tr.appendChild(cStatus);
          tr.addEventListener('click', function () {
            expandedKey = (expandedKey === key) ? null : key;
            renderAllShows();
          });
          els.showsList.appendChild(tr);

          if (key === expandedKey) {
            var drawer = document.createElement('tr');
            drawer.className = 'dyn-show-drawer';
            var td = document.createElement('td');
            td.colSpan = 3;
            td.appendChild(buildContestantTable(show, round.isFinal));
            drawer.appendChild(td);
            els.showsList.appendChild(drawer);
          }
        })(round, round.shows[h], r, h);
      }
    }
  }

  function showStatusLabel(show) {
    if (show.phase === 'live') return 'Live';
    if (show.phase === 'ended') return 'Ended';
    return 'Scheduled';
  }
  function showStatusClass(show) {
    if (show.phase === 'live') return 'tag-live';
    if (show.phase === 'ended') return 'tag-ended';
    return 'tag-open';
  }

  function buildContestantTable(show, isFinal) {
    var reals = show.contestants.filter(function (c) { return !c.isBye; });
    var played = (show.phase === 'live' || show.phase === 'ended');
    var ranked = played
      ? reals.slice().sort(function (a, b) { return effectiveScore(b) - effectiveScore(a); })
      : reals.slice();
    var advanceSet = {};
    if (played && !isFinal && reals.length >= 2) {
      advanceSet[ranked[0].name] = true;
      advanceSet[ranked[1].name] = true;
    }
    var wrap = document.createElement('div');
    wrap.className = 'dyn-show-contestants';
    var table = document.createElement('table');
    table.className = 'live-table';
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Name</th><th>Status</th><th>Score</th></tr>';
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    ranked.forEach(function (c) {
      var tr = document.createElement('tr');
      if (advanceSet[c.name]) tr.className = 'dyn-advance';

      var name = document.createElement('td'); name.className = 'live-name'; name.textContent = c.name;

      var status = document.createElement('td'); status.className = 'live-status-cell';
      if (advanceSet[c.name]) {
        var badge = document.createElement('span');
        badge.className = 'dyn-advance-badge';
        badge.textContent = 'Continue';
        status.appendChild(badge);
      } else {
        var dash = document.createElement('span');
        dash.className = 'dyn-status-dash';
        dash.textContent = '—';
        status.appendChild(dash);
      }

      var score = document.createElement('td'); score.className = 'live-score';
      var s = effectiveScore(c);
      score.textContent = (s === 0 && c.score == null) ? '—' : fmt(s);

      tr.appendChild(name); tr.appendChild(status); tr.appendChild(score);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderConcluded(t) {
    stopCountdown();
    els.liveCard.hidden = true;
    els.detailCard.hidden = true;
    els.showsCard.hidden = false;
    renderAllShows();
    els.championCard.hidden = false;
    els.championName.textContent = (t.champion == null || t.champion === S.BYE) ? '—' : t.champion;
    els.championRu.textContent = (t.runnerUp == null || t.runnerUp === S.BYE) ? '—' : t.runnerUp;
    els.champion3rd.textContent = (t.third == null || t.third === S.BYE) ? '—' : t.third;
    els.champion4th.textContent = (t.fourth == null || t.fourth === S.BYE) ? '—' : t.fourth;
    els.footerText.textContent = 'This tournament has already concluded. Thanks for watching — see the Dashboard for full results.';
    els.liveTag.textContent = 'ENDED';
    els.liveTag.classList.add('frozen');
  }

  // Single render entry point: re-reads the whole tournament from the store and
  // repaints every card from the authoritative contestant objects. Cheap enough
  // to call on every event tick.
  function render() {
    var res = resolveTournament();
    if (!res || !res.t) return;
    var t = res.t;
    renderHeader(t);
    renderLeaderboard(t);
    renderDetail(t);
    renderAllShows();
  }

  function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }

  function startCountdown() {
    stopCountdown();
    var res = resolveTournament();
    var t = res ? res.t : null;
    function paint() { els.countdown.textContent = fmtClock(remainingFor(t)); }
    paint();
    if (!findLiveShow(t)) return;
    countdownTimer = setInterval(function () {
      if (!findLiveShow(t)) { stopCountdown(); paint(); return; }
      paint();
      if (remainingFor(t) === 0) stopCountdown();
    }, 1000);
  }

  // --- Boot: resolve the shortId, show search gate if missing ----------
  function loadInitial() {
    stopCountdown();
    var sid = readShortId();
    if (!sid) {
      showSearchGate();
      return;
    }
    var match = window.SurfinStore.getByShortId(sid);
    if (!match) {
      showGateError('No tournament found for Short ID "' + sid.toUpperCase() + '". It may have been cleared, or the code is incorrect.');
      return;
    }
    requestedShortId = sid;
    currentTournamentId = match.id;
    hideSearchGate();
    els.error.hidden = true;
    els.wrap.hidden = false;
    var res = { t: match.tournament };
    if (isConcluded(res.t)) {
      renderConcluded(res.t);
    } else {
      render();
      startCountdown();
    }
    bindLiveEvents();
  }

  // --- Live link to the Judge Panel ----------------------------------
  // Whenever the judge writes the shared store (storage event) or dispatches a
  // `surfinlive:broadcast` event, re-read and repaint. This is what makes
  // scores, colors and priority order flow judge -> dyn in real time.
  // Three live-link channels back to the Judge Panel:
  //   1. SurfinStore.onChange  — same-process writes (judge.js persistLiveScores,
  //      commitOrder, etc. all call store.put -> notify()).
  //   2. `surfinlive:broadcast` — a custom window event judge.js dispatches directly
  //      on every score / color / priority-order / show change, so a dyn view in the
  //      same document updates instantly even where storage events don't fire.
  //   3. `storage` events — fired by the browser in EVERY OTHER tab when localStorage
  //      is written, i.e. the real cross-tab link between judge.html and dyn.html.
  // All three feed the single `syncFromJudge()` repaint: scores, colors, priority
  // order and countdown all flow judge -> dyn in real time.
  var broadcastHandler = null, storageHandler = null;
  function bindLiveEvents() {
    if (!window.SurfinStore) return;

    if (window.SurfinStore.onChange) {
      window.SurfinStore.onChange(function () { syncFromJudge(); });
    }

    broadcastHandler = function (e) {
      // Ignore broadcasts about a different tournament than the one we mirror.
      var sid = e && e.detail ? e.detail.shortId : null;
      if (sid && requestedShortId && sid.toUpperCase() !== requestedShortId.toUpperCase()) return;
      syncFromJudge();
    };
    window.addEventListener('surfinlive:broadcast', broadcastHandler);

    storageHandler = function (e) {
      if (e && e.key && e.key !== 'surfinlive.tournaments') return;
      // The shared store was written elsewhere (another tab) — re-resolve and repaint.
      currentTournamentId = null; // force re-resolve in case the record was replaced
      syncFromJudge();
    };
    window.addEventListener('storage', storageHandler);
  }

  function syncFromJudge() {
    var res = resolveTournament();
    if (!res || !res.t) return;
    if (isConcluded(res.t)) { renderConcluded(res.t); return; }
    render();
    startCountdown();
  }

  // --- Search gate (mirrors the Judge Panel gate) --------------------
  function showGateError(msg) {
    hideSearchGate();
    els.wrap.hidden = true;
    els.error.hidden = false;
    if (els.errorText) els.errorText.textContent = msg;
  }
  function hideSearchGate() {
    if (els.search) els.search.hidden = true;
    if (els.searchError) els.searchError.hidden = true;
  }
  function showSearchGate() {
    els.error.hidden = true;
    els.wrap.hidden = true;
    if (els.searchError) els.searchError.hidden = true;
    if (els.search) els.search.hidden = false;
    if (els.searchInput) {
      els.searchInput.value = '';
      setTimeout(function () { els.searchInput.focus(); }, 0);
    }
  }
  function bindSearchGate() {
    if (!els.searchForm) return;
    els.searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var val = (els.searchInput ? els.searchInput.value : '').trim();
      if (!val) {
        if (els.searchError) els.searchError.hidden = false;
        return;
      }
      val = val.toUpperCase();
      var url = 'dyn.html?shortId=' + encodeURIComponent(val);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', url);
      } else {
        window.location.search = '?shortId=' + encodeURIComponent(val);
        return;
      }
      loadInitial();
    });
  }

  bindSearchGate();
  if (S && S.generateTournament && window.SurfinStore) loadInitial();
})();
