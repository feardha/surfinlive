/* DOM integration test: load the real dashboard.html + scripts in jsdom and drive the UI. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;

// load scripts in order, in the window context
function loadInWindow(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const fn = new window.Function(code);
  fn.call(window);
}
loadInWindow('tournament.js');
loadInWindow('app.js');

// app.js wires up on DOMContentLoaded? It runs immediately since the script tag is at end of body.
function $(id) { return window.document.getElementById(id); }

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 1) Generate with the pre-seeded 8 sample names
window.SurfinLive; // ensure loaded
$('generate').click();
check('bracket rendered after generate', $('bracket').children.length >= 1);
check('toolbar visible', $('toolbar').hidden === false);
check('8 names -> 2 rounds (Semifinal, Final)', $('bracket').querySelectorAll('.round-col').length === 2);

// 2) Simulate random
$('simulate').click();
check('champion shown after simulate', $('champion').hidden === false);
check('champion name non-empty', $('champion').querySelector('.who').textContent.length > 0);
const champ = $('champion').querySelector('.who').textContent;
check('champion is one of the 8 sample names', ['Kelly Slater','Layne Beachley','Gabriel Medina','Carissa Moore','John John Florence','Stephanie Gilmore','Italo Ferreira','Maya Gabeira'].includes(champ));

// 3) Reset -> manual mode
$('reset').click();
check('champion hidden after reset', $('champion').hidden === true);
check('bracket has clickable contestants in round 1', $('bracket').querySelectorAll('.contestant.clickable').length > 0);

// 4) Manual: pick 2 in EACH show of the active round, then advance through all rounds.
//    The app re-renders on every click, so we MUST re-query fresh DOM nodes each step.
function pickAndAdvanceAllRounds() {
  let guard = 0;
  while (guard++ < 30) {
    if ($('champion').hidden === false) break;

    const col = Array.from($('bracket').querySelectorAll('.round-col'))
      .find(c => c.querySelector('.round-actions .btn'));
    if (!col) break;

    // click pending contestants (2 per show) until the freshly-read advance button enables
    let inner = 0;
    while (inner++ < 30) {
      const freshCol = Array.from($('bracket').querySelectorAll('.round-col'))
        .find(c => c.querySelector('.round-actions .btn'));
      if (!freshCol) break;
      const btn = freshCol.querySelector('.round-actions .btn');
      if (btn && !btn.disabled) break; // done picking this round
      // find first show not yet fully picked
      const shows = freshCol.querySelectorAll('.show');
      let clickedThisPass = false;
      for (const h of shows) {
        const picked = h.querySelectorAll('.contestant.picked').length;
        if (picked >= 2) continue;
        const c = h.querySelector('.contestant.clickable:not(.picked)');
        if (c) { c.click(); clickedThisPass = true; break; }
      }
      if (!clickedThisPass) break;
    }

    const freshCol = Array.from($('bracket').querySelectorAll('.round-col'))
      .find(c => c.querySelector('.round-actions .btn'));
    const btn = freshCol && freshCol.querySelector('.round-actions .btn');
    if (!btn || btn.disabled) break;
    btn.click();
  }
}
pickAndAdvanceAllRounds();
check('manual champion crowned after advancing all rounds', $('champion').hidden === false && $('champion').querySelector('.who').textContent.length > 0);
check('manual champion is a real sample name', ['Kelly Slater','Layne Beachley','Gabriel Medina','Carissa Moore','John John Florence','Stephanie Gilmore','Italo Ferreira','Maya Gabeira'].includes($('champion').querySelector('.who').textContent));

// 5) error path: <2 names
$('names').value = 'Solo';
$('generate').click();
check('input error shown for <2 names', $('input-error').hidden === false);

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
