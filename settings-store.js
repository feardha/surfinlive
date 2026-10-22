/* SurfinLive — shared bracket settings controller.
 *
 * Persists bracket-configuration preferences across pages (Dashboard /
 * Live View / Settings), reloads and new tabs. Currently holds the
 * per-show contestant count ("Contestants per show"), which configures the
 * partition size passed to the tournament engine.
 *
 * Layout in storage:
 *   surfinlive.settings -> JSON { contestantsPerShow: <int> }
 *
 * Exposed as window.SurfinSettings (and module.exports for Node tests).
 */
(function (global) {
  'use strict';

  var KEY = 'surfinlive.settings';
  var DEFAULT_CONTESTANTS_PER_SHOW = 4; // historical "shows of 4 or 5" behavior
  var MIN = 3, MAX = 8; // a show holds K or K+1; <3 is degenerate, >8 unwieldy

  var mem = null;
  var hasLS = (function () {
    try {
      var k = '__sl_settings_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function normalize(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return DEFAULT_CONTESTANTS_PER_SHOW;
    if (n < MIN) return MIN; // clamp too-low down to the floor, don't drop to default
    if (n > MAX) return MAX; // clamp too-high up to the ceiling
    return n;
  }

  function read() {
    var raw;
    if (!hasLS) raw = mem;                       // fallback: JSON string (see write)
    else { try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = mem; } }
    var obj = {};
    if (raw) {
      if (typeof raw === 'string') {
        try { obj = JSON.parse(raw) || {}; } catch (e) { obj = {}; }
      } else {
        obj = raw; // already a parsed object (in-memory fallback)
      }
    }
    obj.contestantsPerShow = normalize(obj.contestantsPerShow);
    return obj;
  }

  function write(obj) {
    var payload = JSON.stringify(obj);
    if (!hasLS) { mem = payload; return; }       // store as JSON string for read() symmetry
    try { global.localStorage.setItem(KEY, payload); } catch (e) { mem = payload; }
  }

  var api = {
    DEFAULT_CONTESTANTS_PER_SHOW: DEFAULT_CONTESTANTS_PER_SHOW,
    MIN: MIN,
    MAX: MAX,
    storageAvailable: hasLS,

    // Returns the full settings object (currently { contestantsPerShow }).
    get: function () { return read(); },

    // Returns just the per-show size, ready to drop into generateTournament opts.
    getContestantsPerShow: function () { return read().contestantsPerShow; },

    // Persist one or more settings (merged with the stored object).
    set: function (patch) {
      var obj = read();
      if (patch && typeof patch === 'object') {
        if (patch.contestantsPerShow !== undefined) {
          obj.contestantsPerShow = normalize(patch.contestantsPerShow);
        }
      }
      write(obj);
      return obj;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SurfinSettings = api;
})(typeof window !== 'undefined' ? window : this);
