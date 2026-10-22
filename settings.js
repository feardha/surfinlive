/* SurfinLive — Settings page controller.
 *
 * Owns the Appearance radio group. Reads the persisted theme from
 * SurfinTheme, checks the matching radio, and applies + saves on change so
 * the switch is instant (no Save button).
 */
(function () {
  'use strict';

  var T = window.SurfinTheme;
  var radios = Array.prototype.slice.call(document.querySelectorAll('input[name="theme"]'));
  var saved = document.getElementById('settings-saved');
  if (!T || !radios.length) return;

  // Mirror :has(input:checked) into a class so the selected card highlights
  // even on engines without :has() support.
  function syncSelectedClass() {
    radios.forEach(function (r) {
      var card = r.closest('.radio-option');
      if (card) card.classList.toggle('is-selected', r.checked);
    });
  }

  function announce(theme) {
    if (!saved) return;
    saved.textContent = (theme === T.LIGHT ? 'Light Mode' : 'Dark Mode') + ' applied.';
  }

  // Reflect the stored theme into the radio group on load.
  var current = T.get();
  radios.forEach(function (r) { r.checked = (r.value === current); });
  syncSelectedClass();

  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      T.set(r.value);      // persists + applies data-theme on <html>
      syncSelectedClass();
      announce(r.value);
    });
  });

  // --- Bracket settings: "Contestants per show" ---------------------------
  var S = window.SurfinSettings;
  var cpsInput = document.getElementById('contestants-per-show');
  var cpsForm = document.getElementById('bracket-settings');
  var cpsSaved = document.getElementById('bracket-saved');
  if (S && cpsInput && cpsForm) {
    // Reflect the persisted value on load.
    cpsInput.value = S.getContestantsPerShow();

    // Apply + persist only when the user confirms with the OK button.
    // Save is wired BOTH on form-submit and on a direct button click, so it
    // works even if the OK button is (stale-cached) nested inside the <label>,
    // which would otherwise swallow the click and never fire a submit.
    function applySetting(e) {
      if (e && e.preventDefault) e.preventDefault(); // stop page reload / double-save
      var v = parseInt(cpsInput.value, 10);
      if (isNaN(v)) return;
      var clamped = S.set({ contestantsPerShow: v }).contestantsPerShow;
      if (clamped !== v) cpsInput.value = clamped; // echo back the clamped value
      if (cpsSaved) cpsSaved.textContent = 'Contestants per show set to ' + clamped + '.';
    }
    cpsForm.addEventListener('submit', applySetting);
    var cpsOk = document.getElementById('cps-ok');
    if (cpsOk) cpsOk.addEventListener('click', applySetting);
  }
})();
