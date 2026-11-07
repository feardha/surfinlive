/* SurfinLive — Modernized Shared Durable & Real-time Store.
 *
 * Persists EVERY generated tournament both in local storage (for zero-latency UI)
 * AND in the SQLite backend database via /api/tournaments.
 *
 * Supports real-time Server-Sent Events (SSE) via /api/live-stream so that
 * when an organizer hits "Start Heat" or advances a round on the Dashboard, or
 * a judge enters scores on the Judge Panel, the Live View and Dynamic View
 * update in real time across ALL connected devices and screens.
 *
 * Fully backward-compatible with the Node.js test suite.
 */
(function (global) {
  'use strict';

  var KEY_ALL = 'surfinlive.tournaments';
  var KEY_CUR = 'surfinlive.current';

  // In-memory fallback when localStorage is unavailable
  var mem = { all: {}, current: null };
  var hasLS = (function () {
    try {
      var k = '__sl_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var subscribers = [];
  function onChange(fn) {
    if (typeof fn === 'function' && subscribers.indexOf(fn) === -1) subscribers.push(fn);
  }
  function notify() {
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](); } catch (e) {}
    }
  }

  function readAll() {
    if (!hasLS) return mem.all;
    try {
      var raw = global.localStorage.getItem(KEY_ALL);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return mem.all; }
  }

  function writeAll(obj) {
    if (!hasLS) { mem.all = obj; return; }
    try { global.localStorage.setItem(KEY_ALL, JSON.stringify(obj)); } catch (e) { mem.all = obj; }
  }

  function readCurrent() {
    if (!hasLS) return mem.current;
    try { return global.localStorage.getItem(KEY_CUR) || null; } catch (e) { return mem.current; }
  }

  function writeCurrent(id) {
    if (!hasLS) { mem.current = id; return; }
    try { global.localStorage.setItem(KEY_CUR, id); } catch (e) { mem.current = id; }
  }

  function normalize(t) {
    var S = (typeof window !== 'undefined' && window.SurfinLive) ? window.SurfinLive : null;
    return S && typeof S.normalizeScores === 'function' ? S.normalizeScores(t) : t;
  }

  function generateId() {
    return 'T' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function makeTitle(tournament) {
    var size = (tournament && tournament.participants != null) ? tournament.participants : '?';
    return size + ' surfers';
  }

  // --- Remote Backend Sync & SSE -------------------------------------------
  var isBrowser = typeof window !== 'undefined' && typeof fetch !== 'undefined';
  var liveEventSource = null;

  function pushTournamentToServer(tournament) {
    if (!isBrowser || !tournament) return;
    try {
      fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ tournament: tournament })
      }).catch(function () {});
    } catch (e) {}
  }

  // Register a tournament cycle (Generate New Tournament). Returns a promise
  // resolving to { ok, tournamentId, shortId, url } or null on failure.
  function createTournament(tournament, meta) {
    if (!isBrowser || !tournament) return Promise.resolve(null);
    return fetch('/api/tournaments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        tournament: tournament,
        tournamentId: tournament.__id,
        shortId: tournament.shortId,
        name: tournament.name,
        participants: tournament.participants,
        url: (meta && meta.url) || null
      })
    }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  // Soft delete a tournament cycle. The row stays in the database with
  // is_deleted = 1 and is audited; it disappears from the active list.
  function deleteTournament(tournament) {
    if (!isBrowser || !tournament) return Promise.resolve(null);
    return fetch('/api/tournaments/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        shortId: tournament.shortId,
        tournamentId: tournament.__id
      })
    }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; });
  }

  // Active tournament cycles: { tournamentId, shortId, name, url }.
  function fetchActiveTournaments() {
    if (!isBrowser) return Promise.resolve([]);
    return fetch('/api/tournaments/active', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return (data && data.tournaments) || []; })
      .catch(function () { return []; });
  }

  function fetchServerTournaments() {
    if (!isBrowser) return;
    try {
      fetch('/api/tournaments', { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !Array.isArray(data.tournaments) || data.tournaments.length === 0) return;
          var all = readAll();
          var updated = false;
          data.tournaments.forEach(function (item) {
            if (!item.tournament) return;
            var t = item.tournament;
            var id = t.__id || ('T_' + (t.shortId || item.shortId));
            t.__id = id;
            if (!all[id] || (item.updatedAt && (!all[id].createdAt || item.updatedAt > all[id].createdAt))) {
              all[id] = {
                id: id,
                createdAt: new Date(item.createdAt || Date.now()).getTime(),
                title: makeTitle(t),
                tournament: t
              };
              updated = true;
            }
          });
          if (updated) {
            writeAll(all);
            if (!readCurrent() && data.tournaments[0] && data.tournaments[0].tournament) {
              writeCurrent(data.tournaments[0].tournament.__id);
            }
            notify();
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function connectLiveStream() {
    if (!isBrowser || typeof EventSource === 'undefined') return;
    if (liveEventSource) return;

    try {
      liveEventSource = new EventSource('/api/live-stream');

      liveEventSource.onmessage = function (event) {
        try {
          var payload = JSON.parse(event.data);
          if (payload.type === 'tournament_sync' && payload.tournament) {
            var t = payload.tournament;
            var all = readAll();
            var id = t.__id || ('T_' + (t.shortId || payload.shortId));
            t.__id = id;
            all[id] = {
              id: id,
              createdAt: Date.now(),
              title: makeTitle(t),
              tournament: t
            };
            writeAll(all);
            writeCurrent(id);
            notify();
          }
        } catch (err) {}
      };

      liveEventSource.onerror = function () {
        if (liveEventSource) {
          liveEventSource.close();
          liveEventSource = null;
        }
        // Graceful reconnect after 5s
        setTimeout(connectLiveStream, 5000);
      };
    } catch (e) {}
  }

  var api = {
    storageAvailable: hasLS,

    // Persist a tournament (new or replacement). Returns its id.
    put: function (tournament) {
      var all = readAll();
      var id = tournament.__id || generateId();
      tournament.__id = id;
      tournament.__createdAt = tournament.__createdAt || Date.now();
      all[id] = {
        id: id,
        createdAt: tournament.__createdAt,
        title: makeTitle(tournament),
        tournament: tournament
      };
      writeAll(all);
      writeCurrent(id);
      notify();

      // Async sync to SQLite backend
      pushTournamentToServer(tournament);

      return id;
    },

    // Get one tournament by id (or null).
    get: function (id) {
      var all = readAll();
      return all[id] ? normalize(all[id].tournament) : null;
    },

    // Resolve a tournament by its generated Short ID (case-insensitively).
    getByShortId: function (shortId) {
      if (!shortId) return null;
      var sid = String(shortId).toUpperCase().trim();
      var all = readAll();
      var keys = Object.keys(all);
      var sorted = keys
        .map(function (k) { return all[k]; })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      for (var i = 0; i < sorted.length; i++) {
        var rec = sorted[i];
        if (rec && rec.tournament && String(rec.tournament.shortId).toUpperCase() === sid) {
          return { id: rec.id, tournament: normalize(rec.tournament) };
        }
      }
      return null;
    },

    // Async fallback to fetch from server if not found in local cache
    getByShortIdAsync: function (shortId, callback) {
      var local = api.getByShortId(shortId);
      if (local) {
        if (callback) callback(local);
        return;
      }
      if (!isBrowser) {
        if (callback) callback(null);
        return;
      }
      var sid = String(shortId).toUpperCase().trim();
      fetch('/api/tournaments/' + encodeURIComponent(sid), { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (data && data.tournament) {
            var t = data.tournament;
            var id = t.__id || ('T_' + sid);
            t.__id = id;
            var all = readAll();
            all[id] = { id: id, createdAt: Date.now(), title: makeTitle(t), tournament: t };
            writeAll(all);
            notify();
            if (callback) callback({ id: id, tournament: normalize(t) });
          } else {
            if (callback) callback(null);
          }
        })
        .catch(function () {
          if (callback) callback(null);
        });
    },

    // All tournaments, most-recently-created first.
    list: function () {
      var all = readAll();
      return Object.keys(all)
        .map(function (k) { return all[k]; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
    },

    // The currently active tournament's id (or null).
    currentId: function () { return readCurrent(); },

    // The currently active tournament object (or null).
    current: function () {
      var id = readCurrent();
      return id ? api.get(id) : null;
    },

    // Make `id` the current tournament.
    setCurrent: function (id) {
      writeCurrent(id);
      notify();
    },

    // Remove a tournament from the cache.
    remove: function (id) {
      var all = readAll();
      delete all[id];
      writeAll(all);
      if (readCurrent() === id) writeCurrent(null);
      notify();
    },

    // Register / soft-delete / list tournament cycles on the backend.
    createTournament: createTournament,
    deleteTournament: deleteTournament,
    fetchActiveTournaments: fetchActiveTournaments,

    // Subscribe to changes.
    onChange: function (fn) {
      onChange(fn);
      return function () {
        var i = subscribers.indexOf(fn);
        if (i !== -1) subscribers.splice(i, 1);
      };
    },

    // Wipe everything.
    clear: function () {
      writeAll({});
      writeCurrent(null);
      if (!hasLS) { mem.all = {}; mem.current = null; }
      notify();
    },

    // Trigger manual re-fetch from server.
    refreshFromServer: function () {
      fetchServerTournaments();
    }
  };

  // Start real-time SSE listener and initial fetch in browser
  if (isBrowser) {
    fetchServerTournaments();
    connectLiveStream();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SurfinStore = api;
})(typeof window !== 'undefined' ? window : this);
