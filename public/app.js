/* SurfinLive — Dashboard UI controller. Depends on tournament.js (window.SurfinLive).
 *
 * Layout: every "Generate New Tournament" press clones the tournament-view
 * <template> into #tournament-views, producing ONE independent Tournament View
 * (input panel + bracket panel + its own confirmation modal). Each view owns
 * its own tournament state and writes lifecycle events to the backend
 * (create / generate / soft delete), which audits them.
 */
(function () {
  'use strict';

  var S = window.SurfinLive;
  var viewsRoot = document.getElementById('tournament-views');
  var template = document.getElementById('tournament-view-template');
  var generateNewBtn = document.getElementById('generate-new-tournament');

  var SAMPLE_SETS = {
    8: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira'],
    12: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton'],
    16: ['Kelly Slater', 'Layne Beachley', 'Gabriel Medina', 'Carissa Moore', 'John John Florence', 'Stephanie Gilmore', 'Italo Ferreira', 'Maya Gabeira', 'Filipe Toledo', 'Tyler Wright', 'Kanoa Igarashi', 'Bethany Hamilton', 'Owen Wright', 'Sally Fitzgibbons', 'Jordy Smith', 'Caroline Marks']
  };

  function sampleNames(n) {
    if (SAMPLE_SETS[n]) return SAMPLE_SETS[n].join('\n');
    var out = [];
    var base = SAMPLE_SETS[16] || [];
    for (var i = 0; i < n; i++) {
      out.push(base[i] || ('Surfer ' + (i + 1)));
    }
    return out.join('\n');
  }

  function makeShortId() {
    var letters = '';
    for (var i = 0; i < 5; i++) {
      letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    }
    return letters + Math.floor(Math.random() * 10);
  }

  function makeId() {
    return 'T' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  function shareUrlFor(shortId) {
    if (!shortId) return null;
    return location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') +
           '/dyn.html?shortId=' + encodeURIComponent(shortId);
  }

  // =======================================================================
  // TournamentView — one instance per generated tournament cycle
  // =======================================================================
  function TournamentView(root, index) {
    this.root = root;
    this.index = index;
    this.state = { tournament: null, mode: null }; // mode: 'sim' | 'manual'

    var q = function (sel) { return root.querySelector(sel); };
    this.els = {
      title: q('.tournament-view-title'),
      metaShortId: q('[data-meta="shortId"]'),
      metaStatus: q('[data-meta="status"]'),
      tournamentName: q('.tournament-name'),
      names: q('.names'),
      generate: q('.generate-bracket'),
      clearInput: q('.clear-input'),
      inputError: q('.input-error'),
      toolbar: q('.bracket-toolbar'),
      simulate: q('.simulate'),
      reset: q('.reset'),
      roundRandomizer: q('.round-randomizer'),
      bracket: q('.bracket'),
      champion: q('.champion-card'),
      modeBanner: q('.mode-banner'),
      tourneyName: q('.tourney-name'),
      shortIdWrap: q('.short-id-wrap'),
      shortId: q('.short-id'),
      shareShortId: q('.share-shortid'),
      modalOverlay: q('.modal-overlay'),
      modalTitle: q('.modal-title'),
      modalYes: q('.modal-yes'),
      modalNo: q('.modal-no'),
      deleteBtn: q('.delete-tournament')
    };

    this.modalCallback = null;
    this.wire();
    this.refreshHeader();
  }

  // --- Confirmation modal (Start / End show) ---------------------------
  TournamentView.prototype.confirmShow = function (message, onYes) {
    this.els.modalTitle.textContent = message;
    this.modalCallback = onYes;
    this.els.modalOverlay.hidden = false;
  };
  TournamentView.prototype.closeModal = function () {
    this.els.modalOverlay.hidden = true;
    this.modalCallback = null;
  };

  TournamentView.prototype.wire = function () {
    var self = this;
    var els = this.els;

    els.modalYes.addEventListener('click', function () {
      var cb = self.modalCallback;
      self.closeModal();
      if (cb) cb();
    });
    els.modalNo.addEventListener('click', function () { self.closeModal(); });
    els.modalOverlay.addEventListener('click', function (e) {
      if (e.target === els.modalOverlay) self.closeModal(); // click outside = No
    });

    els.generate.addEventListener('click', function () { self.generate(); });
    els.clearInput.addEventListener('click', function () {
      els.names.value = '';
      self.clearInputError();
    });
    if (els.simulate) els.simulate.addEventListener('click', function () { self.simulate(); });
    els.reset.addEventListener('click', function () { self.resetResults(); });
    if (els.roundRandomizer) els.roundRandomizer.addEventListener('click', function () { self.randomizeRound(); });

    if (els.shareShortId) {
      els.shareShortId.addEventListener('click', function () {
        var url = shareUrlFor(self.state.tournament && self.state.tournament.shortId);
        if (!url) return;
        var btn = els.shareShortId;
        var original = btn.textContent;
        navigator.clipboard.writeText(url).then(function () {
          btn.textContent = '✓ Copied!';
        }).catch(function () {
          btn.textContent = '⚠ Copy failed';
        });
        setTimeout(function () { btn.textContent = original; }, 1800);
      });
    }

    // Sample chips + per-show size control are scoped to THIS view.
    this.root.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var n = parseInt(chip.getAttribute('data-sample'), 10);
        els.names.value = sampleNames(n);
        self.clearInputError();
      });
    });

    els.deleteBtn.addEventListener('click', function () { self.deleteTournament(); });

    // Seed each view with the 8-surfer sample so it is immediately usable.
    els.names.value = sampleNames(8);
  };

  TournamentView.prototype.refreshHeader = function () {
    var t = this.state.tournament;
    this.els.title.textContent = 'Tournament View ' + (this.index + 1);
    this.els.metaShortId.textContent = t && t.shortId ? t.shortId : '';
    this.els.metaStatus.textContent = t ? (t.__deleted ? 'deleted' : 'active') : 'not generated';
  };

  // --- Input helpers -----------------------------------------------------
  TournamentView.prototype.parseNames = function () {
    return this.els.names.value
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  };

  TournamentView.prototype.showInputError = function (msg) {
    this.els.inputError.textContent = msg;
    this.els.inputError.hidden = false;
  };
  TournamentView.prototype.clearInputError = function () {
    this.els.inputError.hidden = true;
    this.els.inputError.textContent = '';
  };

  // Source of truth for the per-show size: the Settings page value (the
  // Dashboard's own control is commented out in the template).
  TournamentView.prototype.getK = function () {
    return (window.SurfinSettings) ? window.SurfinSettings.getContestantsPerShow() : 4;
  };

  // --- Generate ---------------------------------------------------------
  TournamentView.prototype.generate = function () {
    var self = this;
    this.clearInputError();
    var names = this.parseNames();
    if (names.length < 2) { this.showInputError('Enter at least 2 participant names.'); return; }

    var tournament;
    try {
      tournament = S.generateTournament(names, null, { contestantsPerShow: this.getK() });
    } catch (e) {
      this.showInputError(e.message);
      return;
    }
    tournament.name = (this.els.tournamentName ? this.els.tournamentName.value.trim() : '') || 'Untitled Tournament';
    tournament.tournamentId = makeId();
    tournament.url = shareUrlFor(tournament.shortId);

    this.state.tournament = tournament;
    this.state.mode = 'manual';
    this.els.toolbar.hidden = false;
    if (this.els.simulate) {
      this.els.simulate.hidden = true;
      this.els.simulate.style.display = 'none';
    }
    this.setBanner('Manual mode — pick 2 to advance in each show.', false);
    this.render();
    this.refreshHeader();
    this.persist();

    // Backend: register the cycle and audit the "create" operation.
    window.SurfinStore.createTournament(tournament, { url: tournament.url }).then(function (res) {
      if (!res || !res.ok) return;
      tournament.tournamentId = res.tournamentId || tournament.tournamentId;
      tournament.url = res.url || tournament.url;
      self.persist();
      self.refreshHeader();
    });
  };

  // --- Persistence (durable cache) --------------------------------------
  TournamentView.prototype.persist = function () {
    var t = this.state.tournament;
    if (!t) return;
    // Lock in the typed Tournament Name at the moment we persist (i.e. when a
    // live status is confirmed). This value then flows to the Live View.
    if (this.els.tournamentName) t.name = this.els.tournamentName.value.trim() || t.name || '';
    try { window.SurfinStore.put(t); } catch (e) {}
    try { sessionStorage.setItem('surfinlive.tournament', JSON.stringify(t)); } catch (e) {}
    var link = document.querySelector('.nav-link[href="index.html"]');
    if (link) link.setAttribute('data-has-bracket', t ? '1' : '');
  };

  // --- Rendering ---------------------------------------------------------
  TournamentView.prototype.activeRoundIndex = function (t) {
    for (var i = 0; i < t.rounds.length; i++) {
      var round = t.rounds[i];
      var hasPending = round.shows.some(function (h) {
        return h.contestants.some(function (c) { return !c.isBye && c.name !== 'TBD' && c.status === 'pending'; });
      });
      if (hasPending) return i;
    }
    return -1; // all decided
  };

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

  TournamentView.prototype.renderContestant = function (c, opts) {
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
  };

  TournamentView.prototype.render = function () {
    var self = this;
    var t = this.state.tournament;
    if (!t) return;
    var els = this.els;

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
    var activeIdx = this.activeRoundIndex(t);

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
      var showScore = self.state.mode === 'sim' || round.status === 'scored' ||
        round.shows.some(function (h) { return h.phase === 'ended'; });

      round.shows.forEach(function (show) {
        var hdiv = document.createElement('div');
        hdiv.className = 'show' + (isActive ? '' : ' locked');
        var hlabel = document.createElement('div');
        hlabel.className = 'show-label';
        hlabel.textContent = show.label + (round.isFinal ? ' · Final' : ' · top 2 advance');
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

        var actions = document.createElement('div');
        actions.className = 'show-actions';
        if (phase === 'open') {
          var startBtn = document.createElement('button');
          startBtn.className = 'btn btn-green show-start';
          startBtn.textContent = 'Start';
          startBtn.addEventListener('click', function () {
            self.confirmShow('Are you sure to Start this show?', function () { self.onStartShow(ri, show); });
          });
          actions.appendChild(startBtn);
        } else if (phase === 'live') {
          var endBtn = document.createElement('button');
          endBtn.className = 'btn btn-danger show-end';
          endBtn.textContent = 'End';
          endBtn.addEventListener('click', function () {
            self.confirmShow('Are you sure to End this show?', function () { self.onEndShow(ri, show); });
          });
          actions.appendChild(endBtn);
        } else {
          var endedTag = document.createElement('div');
          endedTag.className = 'unlock-note';
          endedTag.textContent = '✓ ended — select 2 to advance';
          actions.appendChild(endedTag);
        }

        show.contestants.forEach(function (c) {
          var clickable = phase === 'ended' && !c.isBye && c.status === 'pending';
          var node = self.renderContestant(c, { clickable: clickable, showScore: showScore });
          if (clickable) {
            node.addEventListener('click', function () { self.onPick(ri, show, c); });
          }
          hdiv.appendChild(node);
        });
        hdiv.appendChild(actions);
        shows.appendChild(hdiv);
      });
      col.appendChild(shows);

      if (self.state.mode === 'manual') {
        var actions = document.createElement('div');
        actions.className = 'round-actions';
        if (isActive) {
          var pickedCount = self.countPicked(round);
          var btn = document.createElement('button');
          btn.className = 'btn btn-primary';
          btn.textContent = round.isFinal ? 'Finalize Tournament 🏆' : 'Advance this round →';
          btn.disabled = !self.canAdvance(round);
          btn.addEventListener('click', function () { self.onAdvanceRound(ri); });
          actions.appendChild(btn);
          var pc = document.createElement('div');
          pc.className = 'pick-counter';
          pc.textContent = 'Picked ' + pickedCount + ' / ' + self.minPicks(round) + ' to advance';
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

    this.renderChampion(t);
  };

  TournamentView.prototype.renderChampion = function (t) {
    var hasChamp = t.champion && (t.simulated || t.rounds[t.rounds.length - 1].status === 'scored');
    if (hasChamp) {
      this.els.champion.hidden = false;
      this.els.champion.innerHTML =
        '<h3>🏆 Champion</h3>' +
        '<div class="crown">👑</div>' +
        '<div class="who"></div>' +
        '<div class="ru">Runner-up: <span class="ru-name"></span></div>' +
        '<div class="third">3rd: <span class="third-name"></span></div>' +
        '<div class="fourth">4th: <span class="fourth-name"></span></div>';
      this.els.champion.querySelector('.who').textContent = t.champion === S.BYE ? '—' : t.champion;
      this.els.champion.querySelector('.ru-name').textContent = t.runnerUp === S.BYE ? '—' : t.runnerUp;
      this.els.champion.querySelector('.third-name').textContent = (!t.third || t.third === S.BYE) ? '—' : t.third;
      this.els.champion.querySelector('.fourth-name').textContent = (!t.fourth || t.fourth === S.BYE) ? '—' : t.fourth;
    } else {
      this.els.champion.hidden = true;
    }
  };

  TournamentView.prototype.minPicks = function (round) {
    var total = 0;
    round.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye; });
      total += Math.min(2, reals.length);
    });
    return total;
  };
  TournamentView.prototype.countPicked = function (round) {
    var n = 0;
    round.shows.forEach(function (h) {
      h.contestants.forEach(function (c) { if (!c.isBye && c.picked) n++; });
    });
    return n;
  };
  TournamentView.prototype.canAdvance = function (round) {
    var ok = true;
    round.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye && c.status === 'pending'; });
      var picked = reals.filter(function (c) { return c.picked; }).length;
      if (reals.length >= 3) { if (picked !== 2) ok = false; }
      else if (picked !== reals.length) ok = false;
    });
    return ok;
  };

  // --- Interactions ------------------------------------------------------
  TournamentView.prototype.onPick = function (ri, show, contestant) {
    var reals = show.contestants.filter(function (c) { return !c.isBye && c.status === 'pending'; });
    if (reals.length >= 3) {
      if (!contestant.picked) {
        var pickedHere = reals.filter(function (c) { return c.picked; }).length;
        if (pickedHere >= 2) return;
      }
      contestant.picked = !contestant.picked;
    } else {
      contestant.picked = !contestant.picked;
    }
    this.render();
  };

  TournamentView.prototype.onStartShow = function (ri, show) {
    S.startShow(show);
    this.render();
    this.persist();
  };

  TournamentView.prototype.onEndShow = function (ri, show) {
    S.endShow(show);
    S.autoPickTopTwo(show);
    this.render();
    this.persist();
  };

  TournamentView.prototype.onAdvanceRound = function (ri) {
    var res = S.scoreRound(this.state.tournament, ri);
    if (!res.ok) { alert(res.errors.join('\n')); return; }
    this.state.tournament.rounds[ri].status = 'scored';
    this.render();
    this.persist();
  };

  TournamentView.prototype.simulate = function () {
    if (!this.state.tournament) return;
    S.simulateTournament(this.state.tournament);
    this.state.mode = 'sim';
    this.state.tournament.rounds.forEach(function (r) { r.status = 'scored'; });
    this.setBanner('Simulated (random scores). Hit Reset to start over or switch to manual.', true);
    this.render();
    this.persist();
  };

  TournamentView.prototype.resetResults = function () {
    if (!this.state.tournament) return;
    S.resetResults(this.state.tournament);
    this.state.tournament.rounds.forEach(function (r) { r.status = undefined; });
    this.state.mode = 'manual';
    this.setBanner('Manual mode — pick 2 to advance in each show, or hit Simulate for random results.', false);
    this.render();
    this.persist();
  };

  TournamentView.prototype.setBanner = function (text, scored) {
    this.els.modeBanner.hidden = false;
    this.els.modeBanner.textContent = text;
    this.els.modeBanner.classList.toggle('scored', !!scored);
  };

  // --- Re-randomize open shows in the active round ----------------------
  TournamentView.prototype.shuffleArray = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  TournamentView.prototype.randomizeRound = function () {
    var t = this.state.tournament;
    if (!t || !t.rounds || !t.rounds.length) return;
    var ri = this.activeRoundIndex(t);
    if (ri < 0) return;
    var round = t.rounds[ri];
    var changed = 0;
    var self = this;
    round.shows.forEach(function (show) {
      var phase = show.phase || 'open';
      if (phase === 'live' || phase === 'ended' || show.status === 'closed') return;
      var realIdx = [];
      var reals = [];
      show.contestants.forEach(function (c, ci) {
        if (!c.isBye) { realIdx.push(ci); reals.push(c); }
      });
      if (reals.length < 2) return;
      var shuffled = self.shuffleArray(reals);
      realIdx.forEach(function (ci, k) { show.contestants[ci] = shuffled[k]; });
      changed++;
    });
    if (changed > 0) {
      this.render();
      this.persist();
    }
  };

  // --- Delete (soft delete in the backend) ------------------------------
  TournamentView.prototype.deleteTournament = function () {
    var self = this;
    var t = this.state.tournament;
    var shortId = t && t.shortId;
    var tournamentId = t && t.tournamentId;

    // Backend first: soft delete + audit. If the call fails (server down),
    // still remove the view locally so the UI stays responsive.
    window.SurfinStore.deleteTournament(t).then(function () {
      if (t) t.__deleted = true;
      self.refreshHeader();
    });

    try {
      if (t) {
        var all = window.SurfinStore.list();
        for (var i = 0; i < all.length; i++) {
          if (all[i].tournament && all[i].tournament.shortId === shortId) {
            window.SurfinStore.remove(all[i].id);
            break;
          }
        }
      }
    } catch (e) {}

    this.root.remove();
    placeGenerateButton();
  };

  // =======================================================================
  // View collection management
  // =======================================================================
  var views = [];

  function placeGenerateButton() {
    // Keep the generate button directly under the latest Tournament View,
    // aligned left (it is a grid item with justify-self: start).
    if (!generateNewBtn) return;
    if (viewsRoot && viewsRoot.lastElementChild) {
      viewsRoot.appendChild(generateNewBtn);
    }
  }

  function createTournamentView() {
    if (!template || !viewsRoot) return;
    var src = template.content || template.innerHTML;
    var node = (src.firstElementChild || src.querySelector('.tournament-view')).cloneNode(true);
    viewsRoot.appendChild(node);
    var view = new TournamentView(node, views.length);
    views.push(view);
    placeGenerateButton();
    view.refreshHeader();
    return view;
  }

  // --- Wire up -----------------------------------------------------------
  if (generateNewBtn) {
    generateNewBtn.addEventListener('click', function () {
      createTournamentView();
    });
  }

  // Always start with exactly ONE Tournament View. Previously saved cycles
  // stay in the store (localStorage + server) so Short-ID / Dynamic / Judge
  // resolution still works, but they are not re-rendered as views here.
  createTournamentView();
})();
