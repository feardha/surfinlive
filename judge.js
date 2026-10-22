/* SurfinLive — Judge Panel controller.
 *
 * A Judge looks up a tournament by its Short ID (typed into the search bar) and
 * sees the SAME scoreboard as the Live View: a live leaderboard (Number · Name ·
 * Score), a Running Score card (Color and Priority · Name · High 1st · High 2nd),
 * the 20:00 countdown, and the LIVE/STANDBY status pill — all styled identically
 * to index.html (live.js).
 *
 * Show selection (per owner spec):
 *   1. If the tournament has a show currently LIVE (phase === 'live'), show it and
 *      keep ticking scores in real time, exactly like the Live View.
 *   2. Otherwise show the LATEST CLOSED show (the most-recently ended show, by
 *      startedAt) — frozen at its final scores, no ticking.
 *   3. Otherwise (nothing started or closed yet) show the first real show, frozen.
 *
 * The tournament is resolved by shortId via window.SurfinStore.getByShortId, re-
 * resolved on every poll so a show going live after the search appears instantly.
 *
 * Running Score reordering (Judge Panel only):
 *   The Running Score rows are draggable. Dragging reorders the row DISPLAY ORDER
 *   (persisted on the show as `order`), so a contestant's name, score, AND color
 *   move up/down together. The priority numbers always renumber 1..N in the new
 *   order (1 = red at the top … 5 = black). Live View and the Dynamic page read
 *   the same `order`, so a reorder here is reflected everywhere.
 */
(function () {
  'use strict';

  var S = window.SurfinLive;

  var COLORS = ['red', 'white', 'yellow', 'blue', 'black'];
  var FLAG_COLORS = { red: '#e23b3b', white: '#f4f4f4', yellow: '#f5c518', blue: '#2f7de1', black: '#1a1a1a' };

  function $(id) { return document.getElementById(id); }

  var els = {
    search: $('j-search'),
    searchForm: $('j-search-form'),
    shortIdInput: $('j-shortid'),
    searchError: $('j-search-error'),
    broadcast: $('j-broadcast'),
    meta: $('j-live-meta'),
    liveTag: $('j-live-tag'),
    round: $('j-live-round'),
    show: $('j-live-show'),
    list: $('j-list').querySelector('tbody'),
    detail: $('j-detail-list').querySelector('tbody'),
    detailTable: $('j-detail-list'),
    liveCard: $('j-live-card'),
    detailCard: $('j-detail-card'),
    detailsBtn: $('j-details'),
    detailsPanel: $('j-details-panel'),
    detailsBody: $('j-details-body'),
    countdown: $('j-countdown'),
    tournamentLabel: $('j-tournament-label'),
    championCard: $('j-champion-card'),
    championName: $('j-champion-name'),
    championRu: $('j-champion-ru'),
    champion3rd: $('j-champion-3rd'),
    champion4th: $('j-champion-4th'),
    footerText: $('j-footer-text')
  };

  var ticks = null;
  var countdownTimer = null;
  var state = null;            // { names, roundName, showLabel, _startedAt, _liveShow }
  var currentTournamentId = null;
  var requestedShortId = null;
  var pollTimer = null;
  var detailDrag = null;      // active drag state (see startDetailDrag)
  function isDraggingDetail() { return !!detailDrag; }

  // --- Tournament helpers (mirror live.js / dyn.js) --------------------
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

  // The most-recently ENDED show (by startedAt). Used when nothing is live.
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

  // Pick the show to display per spec: live -> latest closed -> first real.
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

  // Is the *currently selected* show live? (drives tick + LIVE pill)
  function selectedIsLive() {
    return !!(state && state._liveShow && state._liveShow.phase === 'live');
  }

  function updateTournamentName(t) {
    if (!els.tournamentLabel) return;
    var name = t && t.name ? t.name.trim() : '';
    els.tournamentLabel.textContent = name || 'TOURNAMENT';
  }

  function fmt(n) { return n.toFixed(2); }
  function isConcluded(t) { return !!(t && t.status === 'Ended'); }

  function renderConcluded(t) {
    stopTicks();
    stopCountdown();
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
    els.countdown.closest('.live-select-row').hidden = true;
  }

  function render() {
    if (!state) return;
    els.round.textContent = state.roundName;
    var sublabel = /\bfinal\b/i.test(state.roundName) ? 'Decisive Showdown!' : 'Top 2 Advance';
    els.show.textContent = sublabel;
    var ranked = state.names.slice().sort(function (a, b) { return (b.tw1 + b.tw2) - (a.tw1 + a.tw2); });
    els.list.innerHTML = '';
    ranked.forEach(function (row, i) {
      var tr = document.createElement('tr');
      var num = document.createElement('td'); num.className = 'live-num'; num.textContent = (i + 1);
      var name = document.createElement('td'); name.className = 'live-name'; name.textContent = row.name;
      var score = document.createElement('td'); score.className = 'live-score'; score.textContent = fmt(row.tw1 + row.tw2);
      tr.appendChild(num); tr.appendChild(name); tr.appendChild(score);
      els.list.appendChild(tr);
    });
    var reals = state._liveShow ? state._liveShow.contestants.filter(function (c) { return !c.isBye; }) : state.names;
    els.meta.textContent = state.roundName + ' • ' + reals.length + ' surfers in the water';
    // Never rebuild the Running Score rows mid-drag — table-dragger holds the DOM
    // (its own mirror + the source row) while dragging; rebuilding now would
    // destroy that and drop the in-progress drag. The 1.5s LIVE tick also calls
    // render(), so this guard is what keeps a live re-render from killing a drag.
    if (!isDraggingDetail()) renderDetail();
    renderDetailsPanel();
    if (selectedIsLive()) {
      els.liveTag.textContent = 'LIVE';
      els.liveTag.classList.remove('frozen');
    } else {
      var label = state._liveShow && state._liveShow.phase === 'ended' ? 'CLOSED' : 'STANDBY';
      els.liveTag.textContent = label;
      els.liveTag.classList.add('frozen');
    }
  }

  // --- Running Score reorder (Judge Panel only) ------------------------
  // Self-contained pointer drag (no external library). Each row gets a pointerdown
  // listener in renderDetail; once a press passes a small dead-zone we lift a floating
  // clone and move the listeners to `window` so the 1.5s LIVE score-tick re-render
  // (which rebuilds the tbody) cannot kill an in-flight drag. Dragging reorders the
  // row DISPLAY ORDER (persisted on the show as `order`); priority numbers renumber
  // 1..N. Live View + Dynamic read the same order.
  var DRAG_DEADZONE = 6;   // px before a press becomes a drag
  var GHOST_LIFT = 8;      // px the clone floats above the cursor

  function swapOrder(order, fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= order.length || toIdx >= order.length) return;
    var moved = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, moved);
  }

  function commitOrder(fromIdx, toIdx) {
    if (!state || !state._liveShow) return;
    if (!state._liveShow.order) {
      state._liveShow.order = window.SurfinLive.orderedContestants(state._liveShow).map(function (c) { return c.name; });
    }
    swapOrder(state._liveShow.order, fromIdx, toIdx);
    try { window.SurfinStore.put(state._tournament); } catch (e) {}
    broadcastChange(); // priority/color order changed -> notify mirrors
  }

  function buildGhost(tr) {
    var g = tr.cloneNode(true);
    g.classList.add('rs-ghost');
    var rect = tr.getBoundingClientRect();
    g.style.width = rect.width + 'px';
    g.style.height = rect.height + 'px';
    // Anchor the clone exactly where the row currently sits on screen, so the
    // floating clone starts in the right place (not the page top) and tracks the
    // cursor from there via a delta translate.
    g._left = rect.left;
    g._top = rect.top;
    g.style.left = rect.left + 'px';
    g.style.top = rect.top + 'px';
    document.body.appendChild(g);
    return g;
  }

  function startDetailDrag(tr, ev) {
    var fromIdx = parseInt(tr.dataset.idx, 10);
    if (isNaN(fromIdx)) return;
    detailDrag = {
      tr: tr, fromIdx: fromIdx,
      startX: ev.clientX || 0, startY: ev.clientY || 0,
      ghost: null, curTo: fromIdx, lastTo: fromIdx
    };
    tr.classList.add('rs-dragging');
    window.addEventListener('pointermove', onDetailDragMove, true);
    window.addEventListener('pointerup', onDetailDragEnd, true);
    window.addEventListener('pointercancel', onDetailDragEnd, true);
    if (ev.target && ev.target.setPointerCapture && ev.pointerId != null) {
      try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    ev.preventDefault();
  }

  function clearDropTarget() {
    if (!detailDrag || detailDrag.lastTo == null) return;
    var rows = Array.prototype.slice.call(els.detail.children);
    var prev = rows[detailDrag.lastTo];
    if (prev && prev !== detailDrag.tr) prev.classList.remove('rs-drop-target');
  }

  function onDetailDragMove(ev) {
    if (!detailDrag) return;
    var x = ev.clientX || 0, y = ev.clientY || 0;
    if (!detailDrag.ghost) {
      if (Math.abs(y - detailDrag.startY) < DRAG_DEADZONE) return; // still in dead-zone
      detailDrag.ghost = buildGhost(detailDrag.tr);
      document.body.classList.add('rs-dragging-active');
    }
    // Ghost is anchored at the row's real screen position (buildGhost), so a pure
    // delta translate keeps it glued under the cursor at the press point — no jump
    // to the page top, and it tracks both axes.
    detailDrag.ghost.style.transform =
      'translate(' + (x - detailDrag.startX) + 'px,' + (y - detailDrag.startY - GHOST_LIFT) + 'px)';
    var rows = Array.prototype.slice.call(els.detail.children);
    var to = detailDrag.fromIdx;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === detailDrag.tr) continue;
      var rr = rows[i].getBoundingClientRect();
      if (y > rr.top + rr.height / 2) to = i;
    }
    detailDrag.curTo = to;
    // Highlight where the row will land if released now.
    if (to !== detailDrag.lastTo) {
      clearDropTarget();
      var target = rows[to];
      if (target && target !== detailDrag.tr) target.classList.add('rs-drop-target');
      detailDrag.lastTo = to;
    }
    ev.preventDefault();
  }

  function onDetailDragEnd(ev) {
    if (!detailDrag) return;
    window.removeEventListener('pointermove', onDetailDragMove, true);
    window.removeEventListener('pointerup', onDetailDragEnd, true);
    window.removeEventListener('pointercancel', onDetailDragEnd, true);
    var tr = detailDrag.tr, from = detailDrag.fromIdx, to = detailDrag.curTo;
    if (detailDrag.ghost) detailDrag.ghost.remove();
    document.body.classList.remove('rs-dragging-active');
    tr.classList.remove('rs-dragging');
    clearDropTarget();
    detailDrag = null;
    if (from !== to) commitOrder(from, to);
    renderDetail();
  }

  function bindDetailDragger() {
    // Rows are rebuilt every render, so attach the press listener to the fresh rows.
    Array.prototype.slice.call(els.detail.children).forEach(function (tr) {
      tr.addEventListener('pointerdown', function (ev) {
        if (detailDrag) return;
        startDetailDrag(tr, ev);
      });
    });
  }

  function renderDetail() {
    if (!state) return;
    // Base ordering: Judge-controlled `show.order` if available, else current names.
    var baseNames;
    if (state._liveShow && state._liveShow.contestants) {
      baseNames = window.SurfinLive.orderedContestants(state._liveShow).map(function (c) { return c.name; });
    } else {
      baseNames = state.names.map(function (r) { return r.name; });
    }
    var byName = {};
    state.names.forEach(function (r) { byName[r.name] = r; });
    var displayRows = [];
    baseNames.forEach(function (nm) { if (byName[nm]) { displayRows.push(byName[nm]); delete byName[nm]; } });
    state.names.forEach(function (r) { if (byName[r.name]) displayRows.push(r); });

    els.detail.innerHTML = '';
    displayRows.forEach(function (row, i) {
      var prio = i + 1;
      // Color is owned by the contestant (assigned when the show went LIVE and
      // fixed until it ends), so it travels WITH the person when the row is
      // dragged — not with the slot position. Falls back to slot color only for
      // shows that have never been started.
      var color = (row.contestant && row.contestant.color) ? row.contestant.color : COLORS[i % COLORS.length];
      var tr = document.createElement('tr');
      tr.dataset.idx = String(i);
      tr.classList.add('rs-row');

      var flag = document.createElement('td');
      flag.className = 'live-flag';
      var sw = document.createElement('span');
      sw.className = 'priority-badge';
      sw.style.backgroundColor = FLAG_COLORS[color] || color;
      sw.style.color = (color === 'white' || color === 'yellow') ? '#1a1a1a' : '#ffffff';
      sw.title = color + ' · priority ' + prio + ' · drag to reorder';
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
    bindDetailDragger(); // bind the whole stable table so the new rows are draggable
  }

  // Populate the Details panel (toggled by #j-details) with the current priority
  // order: priority number, color badge, name, and live score. Only painted while
  // the panel is open, so it doesn't cost anything when hidden.
  function renderDetailsPanel() {
    if (!els.detailsPanel || !state || els.detailsPanel.hidden) return;
    var rows = displayRowsForDetails();
    els.detailsBody.innerHTML = '';
    rows.forEach(function (row, i) {
      var color = (row.contestant && row.contestant.color) ? row.contestant.color : COLORS[i % COLORS.length];
      var tr = document.createElement('div');
      tr.className = 'details-row';
      var p = document.createElement('span'); p.className = 'details-prio'; p.textContent = String(i + 1);
      var c = document.createElement('span'); c.className = 'details-color';
      var sw = document.createElement('span');
      sw.className = 'priority-badge';
      sw.style.backgroundColor = FLAG_COLORS[color] || color;
      sw.style.color = (color === 'white' || color === 'yellow') ? '#1a1a1a' : '#ffffff';
      sw.textContent = String(i + 1);
      c.appendChild(sw);
      var n = document.createElement('span'); n.className = 'details-name'; n.textContent = row.name;
      var s = document.createElement('span'); s.className = 'details-score'; s.textContent = fmt(row.tw1 + row.tw2);
      tr.appendChild(p); tr.appendChild(c); tr.appendChild(n); tr.appendChild(s);
      els.detailsBody.appendChild(tr);
    });
  }

  // Same source ordering as renderDetail (respects show.order + show.contestant.color).
  function displayRowsForDetails() {
    if (!state) return [];
    var baseNames;
    if (state._liveShow && state._liveShow.contestants) {
      baseNames = window.SurfinLive.orderedContestants(state._liveShow).map(function (c) { return c.name; });
    } else {
      baseNames = state.names.map(function (r) { return r.name; });
    }
    var byName = {};
    state.names.forEach(function (r) { byName[r.name] = r; });
    var out = [];
    baseNames.forEach(function (nm) { if (byName[nm]) { out.push(byName[nm]); delete byName[nm]; } });
    state.names.forEach(function (r) { if (byName[r.name]) out.push(r); });
    return out;
  }

  function stopTicks() { if (ticks) { clearInterval(ticks); ticks = null; } }
  function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }

  function persistLiveScores() {
    if (!state || !state._tournament || state._liveShow.phase !== 'live') return;
    try { window.SurfinStore.put(state._tournament); } catch (e) {}
  }

  // Push a "the shared tournament changed" signal so a dyn view (same page or a
  // sibling tab via the store's onChange + storage event) can mirror scores,
  // colors and priority order instantly. Not persisted — purely a notification.
  function broadcastChange() {
    try {
      if (state && state._tournament) window.SurfinStore.put(state._tournament);
    } catch (e) {}
    try {
      window.dispatchEvent(new window.CustomEvent('surfinlive:broadcast', {
        detail: { shortId: requestedShortId }
      }));
    } catch (e) {}
  }

  function startTicks() {
    stopTicks();
    ticks = setInterval(function () {
      if (!state) return;
      var conByType = {};
      if (state._liveShow) {
        state._liveShow.contestants.forEach(function (c) { if (!c.isBye) conByType[c.name] = c; });
      }
      state.names.forEach(function (row) {
        // Each constituent wave ticks up to 20.00; the surfer's live TOTAL is the
        // real score the spectator sees (persisted to the contestant).
        row.tw1 = Math.min(20, Math.round((row.tw1 + Math.random() * 0.5) * 100) / 100);
        row.tw2 = Math.min(20, Math.round((row.tw2 + Math.random() * 0.5) * 100) / 100);
        var totalScore = Math.round((row.tw1 + row.tw2) * 100) / 100;
        if (row.contestant) {
          row.contestant.score = totalScore;
          row.contestant.tw1 = row.tw1;   // persist wave 1 so dyn mirrors High 1st
          row.contestant.tw2 = row.tw2;   // persist wave 2 so dyn mirrors High 2nd
        } else if (conByType[row.name]) {
          conByType[row.name].score = totalScore;
          conByType[row.name].tw1 = row.tw1;
          conByType[row.name].tw2 = row.tw2;
        }
      });
      render();
      broadcastChange();
      if (!selectedIsLive()) { stopTicks(); broadcastChange(); }
    }, 1500);
  }

  function startCountdown(t) {
    stopCountdown();
    function paint() { els.countdown.textContent = fmtClock(remainingFor(t)); }
    paint();
    if (!selectedIsLive()) return; // frozen (pre-start or ended)
    countdownTimer = setInterval(function () {
      if (!selectedIsLive()) { stopCountdown(); paint(); return; }
      paint();
      if (remainingFor(t) === 0) stopCountdown();
    }, 1000);
  }

  function applyShow(show, t) {
    // Guarantee every contestant has a unique color from the fixed set. This
    // backfills shows that started before color-assignment existed and rounds
    // that opened without an explicit Start; a contestant already holding a
    // valid color keeps it, so colors stay stable until the show ends.
    window.SurfinLive.ensureShowColors(show.show);
    state = { roundName: show.round.name, showLabel: show.show.label };
    state._startedAt = show.show.startedAt != null ? show.show.startedAt : 0;
    state._liveShow = show.show;
    state._tournament = t; // root object the drag / live-tick mutations live in
    var conByType = {};
    show.show.contestants.forEach(function (c) { if (!c.isBye) conByType[c.name] = c; });

    var names = show.show.contestants.filter(function (c) { return !c.isBye; }).map(function (c) { return c.name; });
    state.names = names.map(function (nm, idx) {
      var color = COLORS[idx % COLORS.length];
      var tw1, tw2;
      var con = conByType[nm];
      if (show.show.phase === 'live') {
        // Resume from the persisted waves if we re-opened a live show; else fresh.
        if (con && con.tw1 != null && con.tw2 != null) { tw1 = con.tw1; tw2 = con.tw2; }
        else { tw1 = Math.round(Math.random() * 120) / 10; tw2 = Math.round(Math.random() * 120) / 10; }
      } else {
        // Closed / standby: seed from the stored final score so the scoreboard shows real values.
        var total = (con && con.score != null) ? con.score : 0;
        tw1 = (con && con.tw1 != null) ? con.tw1 : Math.round(total * 100) / 100;
        tw2 = (con && con.tw2 != null) ? con.tw2 : 0;
      }
      if (con) { con.tw1 = tw1; con.tw2 = tw2; } // persist both waves so dyn mirrors them
      return { name: nm, color: color, priority: COLORS.indexOf(color) + 1, tw1: tw1, tw2: tw2, contestant: con || null };
    });
    updateTournamentName(t);
    render();
    if (show.show.phase === 'live') { startTicks(); startCountdown(t); }
    else { stopTicks(); startCountdown(t); }
  }

  function pollLatestShow() {
    var res = resolveTournament();
    if (!res || !res.t) return;
    if (isConcluded(res.t)) { renderConcluded(res.t); return; }
    var picked = pickShowForShortId(res.t);
    if (!picked) { els.meta.textContent = 'no shows available'; return; }
    var startedAt = picked.show.startedAt != null ? picked.show.startedAt : 0;
    var live = picked.show.phase === 'live';
    var changed = !state
      || state._startedAt !== startedAt
      || (state._liveShow && state._liveShow.phase === 'live') !== live;
    if (changed) applyShow(picked, res.t);
    else updateTournamentName(res.t);
  }

  function doSearch() {
    stopTicks();
    stopCountdown();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    var sid = (els.shortIdInput.value || '').trim().toUpperCase();
    els.searchError.hidden = true;
    if (!sid) {
      els.searchError.textContent = 'Enter a Short ID to look up a match.';
      els.searchError.hidden = false;
      return;
    }
    var match = window.SurfinStore.getByShortId(sid);
    if (!match) {
      els.broadcast.hidden = true;
      els.searchError.textContent = 'No tournament found for Short ID "' + sid + '". It may have been cleared, or the code is incorrect.';
      els.searchError.hidden = false;
      return;
    }
    requestedShortId = sid;
    currentTournamentId = match.id;
    state = null;
    els.searchError.hidden = true;
    els.search.hidden = true;
    els.broadcast.hidden = false;
    els.championCard.hidden = true;
    els.liveCard.hidden = false;
    els.detailCard.hidden = false;
    if (isConcluded(match.tournament)) { renderConcluded(match.tournament); }
    else { pollLatestShow(); }
    pollTimer = setInterval(pollLatestShow, 1000);
  }

  function boot() {
    if (els.searchForm) {
      els.searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        doSearch();
      });
    }
    if (els.detailsBtn && els.detailsPanel) {
      els.detailsBtn.addEventListener('click', function () {
        els.detailsPanel.hidden = !els.detailsPanel.hidden;
        els.detailsBtn.classList.toggle('active', !els.detailsPanel.hidden);
        renderDetailsPanel();
      });
    }
  }

  if (S && S.generateTournament && window.SurfinStore) boot();
})();
