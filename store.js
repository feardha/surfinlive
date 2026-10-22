/* SurfinLive — shared durable store.
 *
 * Persists EVERY generated tournament so nothing is lost when you navigate
 * between the Dashboard and the Live View, or when the page reloads. Uses
 * localStorage (survives tab close / reload / new tab); if storage is
 * unavailable (e.g. file:// in some browsers, private mode) it falls back to
 * an in-memory object for the lifetime of the tab.
 *
 * Layout in storage:
 *   surfinlive.tournaments  -> { [id]: { id, createdAt, title, tournament } }
 *   surfinlive.current      -> <id of the most-recently-generated tournament>
 *
 * Exposed as window.SurfinStore (and module.exports for Node tests).
 */
(function (global) {
  'use strict';

  var KEY_ALL = 'surfinlive.tournaments';
  var KEY_CUR = 'surfinlive.current';

  // In-memory fallback when localStorage throws (private mode, file://, quota).
  var mem = { all: {}, current: null };
  var hasLS = (function () {
    try {
      var k = '__sl_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  // In-memory subscribers notified on every write (put/get clearing current).
  // Lets the Dynamic View mirror the Judge Panel's updates within the same
  // page/worker without waiting for a cross-tab storage event.
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
  // Correct any legacy tournament saved under the old '*10' score encoding on read.
  // Window.SurfinLive/normalizeScores is defined by tournament.js (loaded before store
  // consumers run), so it's available by the time any get* is actually called.
  function normalize(t) {
    var S = (typeof window !== 'undefined' && window.SurfinLive) ? window.SurfinLive : null;
    return S && typeof S.normalizeScores === 'function' ? S.normalizeScores(t) : t;
  }

  function generateId() {
    return 'T' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // Build a short human title from the participant list / size.
  function makeTitle(tournament) {
    var size = (tournament && tournament.participants != null) ? tournament.participants : '?';
    return size + ' surfers';
  }

  var api = {
    storageAvailable: hasLS,

    // Persist a tournament (new or replacement). Returns its id.
    put: function (tournament) {
      var all = readAll();
      var id = tournament.__id || generateId();
      // Stamp the id/createdAt back onto the object so future saves (Start/End,
      // Live View tick persistence) REUSE the same record instead of cloning a
      // new one. This keeps both the Live View (current pointer) and the
      // Dynamic View (shortId lookup) pointed at a single, always-current copy.
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
      return id;
    },

    // Get one tournament by id (or null).
    get: function (id) {
      var all = readAll();
      return all[id] ? normalize(all[id].tournament) : null;
    },

    // Resolve a tournament by its generated Short ID (e.g. "JQJKJ1"), case-
    // insensitively. Returns { id, tournament } or null if no match. Used by the
    // Dynamic page (dyn.html) to broadcast one specific tournament by its code.
    getByShortId: function (shortId) {
      if (!shortId) return null;
      var sid = String(shortId).toUpperCase();
      var all = readAll();
      var keys = Object.keys(all);
      // Search newest-created first so a re-published (Start/End) bracket wins
      // over any earlier stale snapshot that happens to share the same Short ID.
      var sorted = keys
        .map(function (k) { return all[k]; })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      for (var i = 0; i < sorted.length; i++) {
        var rec = sorted[i];
        if (rec && rec.tournament && rec.tournament.shortId === sid) {
          return { id: rec.id, tournament: normalize(rec.tournament) };
        }
      }
      return null;
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

    // Make `id` the current tournament (e.g. when the user picks it in Live View).
    setCurrent: function (id) { writeCurrent(id); },

    // Remove a tournament from the cache. If it was current, clears the pointer.
    remove: function (id) {
      var all = readAll();
      delete all[id];
      writeAll(all);
      if (readCurrent() === id) writeCurrent(null);
      notify();
    },

    // Subscribe to any change (put/remove/clear). Used by the Dynamic View to
    // mirror the Judge Panel in real time. Returns an unsubscribe function.
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
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SurfinStore = api;
})(typeof window !== 'undefined' ? window : this);
