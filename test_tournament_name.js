/* Focused verification: Tournament Name input -> Live View "TOURNAMENT" label is
 * replaced by the name only while live (countdown always stays). Run:
 * node test_tournament_name.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function read(s) { return fs.readFileSync(path.join(__dirname, s), 'utf8'); }
function evalIn(w, code) { new w.Function(code).call(w); }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// --- Part A: Dashboard commits the typed name into the stored tournament on Start ---
(function () {
  const html = read('dashboard.html');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window, doc = w.document;
  evalIn(w, read('store.js')); evalIn(w, read('tournament.js')); evalIn(w, read('app.js'));
  doc.getElementById('tournament-name').value = 'Pipeline Pro-Am 2026';
  doc.querySelector('.chip[data-sample="8"]').dispatchEvent(new w.Event('click'));
  doc.getElementById('generate').dispatchEvent(new w.Event('click'));
  const startBtn = doc.querySelector('.show-start');
  ok(!!startBtn, 'A: a Start button exists after generate');
  startBtn.dispatchEvent(new w.Event('click'));
  doc.getElementById('modal-yes').dispatchEvent(new w.Event('click'));
  const t = w.SurfinStore.current();
  ok(!!t, 'A: a tournament was persisted to the store');
  ok(t && t.name === 'Pipeline Pro-Am 2026', 'A: stored tournament.name === typed name (' + (t && t.name) + ')');
})();

// --- Part B + C: Live View label becomes the name while live (countdown stays);
//     reverts to "TOURNAMENT" when the live status ends. ---
(function () {
  const html = read('index.html');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window, doc = w.document;
  evalIn(w, read('store.js')); evalIn(w, read('tournament.js'));
  // Self-seed a live tournament (JSDOM localStorage is per-window, not shared).
  const S = w.SurfinLive;
  const t = S.generateTournament(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  t.name = 'Pipeline Pro-Am 2026';
  S.startShow(t.rounds[0].shows[0]);
  w.SurfinStore.put(t);
  evalIn(w, read('live.js'));
  return new Promise((resolve) => {
    setTimeout(() => {
      const label = doc.getElementById('tournament-label');
      const countdown = doc.getElementById('countdown');
      ok(!!label && label.textContent === 'Pipeline Pro-Am 2026', 'B: "TOURNAMENT" label replaced by name while live (' + (label && label.textContent) + ')');
      ok(!countdown.hidden, 'B: countdown stays visible while live');

      // Part C: end the live show the SAME way the Dashboard does — mutate the
      // in-memory tournament object, then put() it (store then holds an 'ended' clone).
      S.endShow(t.rounds[0].shows[0]);
      w.SurfinStore.put(t);
      setTimeout(() => {
        ok(label.textContent === 'TOURNAMENT', 'C: label reverts to "TOURNAMENT" after the show ends (' + label.textContent + ')');
        ok(!countdown.hidden, 'C: countdown still visible after the show ends');
        resolve();
      }, 1200); // wait for pollLatestShow (1s)
    }, 80);
  });
})().then(() => {
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
