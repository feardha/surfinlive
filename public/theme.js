/* SurfinLive — shared theme (Light / Dark) controller.
 *
 * Dark is the DEFAULT and the historical look of the app; Light is opt-in via
 * the Settings page. The chosen theme is persisted in localStorage so it holds
 * across pages (Dashboard / Live View / Settings), reloads and new tabs.
 *
 * How it is applied: `data-theme="light"` on <html>. styles.css defines the
 * dark tokens on :root and overrides them under [data-theme="light"], so every
 * page themes itself purely through CSS variables — no per-page JS repainting.
 *
 * IMPORTANT: this file must be loaded as a BLOCKING script in <head>, before
 * the stylesheet paints, otherwise a dark frame flashes before Light applies.
 *
 * Layout in storage:
 *   surfinlive.theme -> 'light' | 'dark'
 *
 * Exposed as window.SurfinTheme (and module.exports for Node tests).
 */
(function (global) {
  'use strict';

  var KEY = 'surfinlive.theme';
  var DARK = 'dark';
  var LIGHT = 'light';
  var DEFAULT = DARK; // Dark Mode is the current effective UI setting.

  // In-memory fallback when localStorage throws (private mode, file://, quota).
  var mem = null;
  var hasLS = (function () {
    try {
      var k = '__sl_theme_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function normalize(v) {
    return v === LIGHT ? LIGHT : DARK; // anything unknown/absent -> dark
  }

  function read() {
    if (!hasLS) return normalize(mem);
    try { return normalize(global.localStorage.getItem(KEY)); } catch (e) { return normalize(mem); }
  }

  function write(theme) {
    if (!hasLS) { mem = theme; return; }
    try { global.localStorage.setItem(KEY, theme); } catch (e) { mem = theme; }
  }

  // Reflect the theme onto <html>. Dark is the default token set on :root, so
  // dark simply removes the attribute rather than setting data-theme="dark".
  function apply(theme) {
    var doc = global.document;
    if (!doc || !doc.documentElement) return theme;
    if (theme === LIGHT) doc.documentElement.setAttribute('data-theme', LIGHT);
    else doc.documentElement.removeAttribute('data-theme');
    return theme;
  }

  var api = {
    DARK: DARK,
    LIGHT: LIGHT,
    DEFAULT: DEFAULT,
    storageAvailable: hasLS,

    // Currently selected theme ('light' | 'dark'); never throws.
    get: function () { return read(); },

    // Persist + apply a theme. Unknown values fall back to dark.
    set: function (theme) {
      var t = normalize(theme);
      write(t);
      return apply(t);
    },

    // Re-apply the stored theme to <html>. Called on every page load.
    init: function () { return apply(read()); },

    isLight: function () { return read() === LIGHT; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SurfinTheme = api;

  // Apply immediately so the very first paint already uses the right tokens.
  if (typeof module === 'undefined' || !module.exports) api.init();
})(typeof window !== 'undefined' ? window : this);
