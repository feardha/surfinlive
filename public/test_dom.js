/* DOM integration test: load the real dashboard.html + scripts in jsdom and drive the UI.
 *
 * The Dashboard now uses a multi-view "Tournament View" model: each
 * "Generate New Tournament" press clones the template into one scoped package
 * (input panel + bracket panel + its own modal). Tests here target the FIRST
 * view through view-scoped selectors.
 */
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
loadInWindow('store.js');
loadInWindow('settings-store.js');
loadInWindow('tournament.js');
loadInWindow('app.js');

function view(i) { return window.document.querySelectorAll('.tournament-view')[i]; }
function $(sel) { return view(0).querySelector(sel); }

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 0) One Tournament View is seeded, the generate button sits directly under it,
//    and each view wraps input panel + bracket panel + modal overlay.
check('one Tournament View seeded', window.document.querySelectorAll('.tournament-view').length === 1);
const genBtn = window.document.getElementById('generate-new-tournament');
check('generate button exists', !!genBtn);
check('generate button text', !!genBtn && genBtn.textContent === 'Generate New Tournament');
check('generate button is directly under the view',
  !!genBtn && !!genBtn.previousElementSibling && genBtn.previousElementSibling.classList.contains('tournament-view'));
check('view wraps input panel, bracket panel, modal',
  !!$('.input-panel') && !!$('.bracket-panel') && !!$('.modal-overlay'));
check('view has a Delete Tournament button', !!$('.delete-tournament'));

// 1) Generate with the pre-seeded 8 sample names
$('.generate-bracket').click();
check('bracket rendered after generate (round cols)', window.document.querySelectorAll('.tournament-view')[0].querySelectorAll('.round-col').length >= 1);
check('toolbar visible', $('.bracket-toolbar').hidden === false);
check('8 names -> 2 rounds (Semifinal, Final)', window.document.querySelectorAll('.tournament-view')[0].querySelectorAll('.round-col').length === 2);

// 2) Simulate random
$('.simulate').click();
check('champion shown after simulate', $('.champion-card').hidden === false);
check('champion name non-empty', $('.champion-card').querySelector('.who').textContent.length > 0);
const champ = $('.champion-card').querySelector('.who').textContent;
check('champion is one of the 8 sample names', ['Kelly Slater','Layne Beachley','Gabriel Medina','Carissa Moore','John John Florence','Stephanie Gilmore','Italo Ferreira','Maya Gabeira'].includes(champ));

// 3) Reset -> manual mode
$('.reset').click();
check('champion hidden after reset', $('.champion-card').hidden === true);
// A freshly generated show is phase "open"; contestants only become pickable
// after the show is Ended (the current flow requires Start -> End first).
check('no clickable contestants before a show is ended', window.document.querySelectorAll('.tournament-view')[0].querySelectorAll('.contestant.clickable').length === 0);

// 3b) Start + End the first show, then contestants become pickable.
const startBtn = view(0).querySelector('.show-start');
check('a Start button exists', !!startBtn);
startBtn.click();
view(0).querySelector('.modal-yes').click();
const endBtn = view(0).querySelector('.show-end');
check('an End button appears once live', !!endBtn);
endBtn.click();
view(0).querySelector('.modal-yes').click();
check('bracket has clickable contestants after End', window.document.querySelectorAll('.tournament-view')[0].querySelectorAll('.contestant.clickable').length > 0);

// 4) Manual: pick 2 in EACH show of the active round, then advance through all rounds.
//    The app re-renders on every click, so we MUST re-query fresh DOM nodes each step.
function pickAndAdvanceAllRounds() {
  const root = window.document.querySelectorAll('.tournament-view')[0];
  let guard = 0;
  while (guard++ < 30) {
    if (root.querySelector('.champion-card').hidden === false) break;

    // A show must be open to be played: Start then End it (contestants become
    // pickable only once the show is ended). Skip shows already ended/closed.
    const pendingShow = Array.from(root.querySelectorAll('.show')).find(h => h.querySelector('.show-start'));
    if (pendingShow) {
      pendingShow.querySelector('.show-start').click();
      root.querySelector('.modal-yes').click();
      const endNow = Array.from(root.querySelectorAll('.show')).find(h => h.querySelector('.show-end'));
      if (!endNow) break;
      endNow.querySelector('.show-end').click();
      root.querySelector('.modal-yes').click();
    }

    const col = Array.from(root.querySelectorAll('.round-col'))
      .find(c => c.querySelector('.round-actions .btn'));
    if (!col) break;

    // click pending contestants (2 per show) until the freshly-read advance button enables
    let inner = 0;
    while (inner++ < 30) {
      const freshCol = Array.from(root.querySelectorAll('.round-col'))
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

    const freshCol = Array.from(root.querySelectorAll('.round-col'))
      .find(c => c.querySelector('.round-actions .btn'));
    const btn = freshCol && freshCol.querySelector('.round-actions .btn');
    if (!btn || btn.disabled) break;
    btn.click();
  }
}
pickAndAdvanceAllRounds();
check('manual champion crowned after advancing all rounds', $('.champion-card').hidden === false && $('.champion-card').querySelector('.who').textContent.length > 0);
check('manual champion is a real sample name', ['Kelly Slater','Layne Beachley','Gabriel Medina','Carissa Moore','John John Florence','Stephanie Gilmore','Italo Ferreira','Maya Gabeira'].includes($('.champion-card').querySelector('.who').textContent));

// 5) error path: <2 names
$('.names').value = 'Solo';
$('.generate-bracket').click();
check('input error shown for <2 names', $('.input-error').hidden === false);

// 6) Multi-view: each press adds exactly one more Tournament View, and the
//    generate button stays directly under the latest view.
const before = window.document.querySelectorAll('.tournament-view').length;
genBtn.click();
check('one press adds exactly one view', window.document.querySelectorAll('.tournament-view').length === before + 1);
check('button still directly under latest view',
  genBtn.previousElementSibling === window.document.querySelectorAll('.tournament-view')[before]);

// 7) Delete: removes that view's package and re-places the button.
const viewCountBeforeDelete = window.document.querySelectorAll('.tournament-view').length;
view(0).querySelector('.delete-tournament').click();
check('delete removes the view package', window.document.querySelectorAll('.tournament-view').length === viewCountBeforeDelete - 1);
check('button still directly under latest view after delete',
  !!genBtn.previousElementSibling && genBtn.previousElementSibling.classList.contains('tournament-view'));

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
