/* DOM test for the Live View: load index.html + scripts in jsdom, drive it. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;

function loadInWindow(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const fn = new window.Function(code);
  fn.call(window);
}
loadInWindow('tournament.js');
loadInWindow('live.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function rows() { return Array.from(window.document.querySelectorAll('#live-list tbody tr')); }
function names() { return rows().map(r => r.querySelector('.live-name').textContent); }
function scores() { return rows().map(r => parseFloat(r.querySelector('.live-score').textContent)); }

// 1) A show was picked and rendered
check('live card has contestant rows', rows().length >= 1);
check('each row has a name', names().every(n => n.length > 0));
check('each row has a numeric score', scores().every(s => !isNaN(s)));
check('round label is set', window.document.getElementById('live-round').textContent.length > 0);
check('show title set', window.document.getElementById('live-show').textContent.length > 0);
check('meta says surfers in the water', /surfers in the water/.test(window.document.getElementById('live-meta').textContent));

// 2) Scores are sorted descending (live leaderboard) on first render
const sc = scores();
let sorted = true;
for (let i = 1; i < sc.length; i++) if (sc[i] > sc[i - 1]) return false;
check('rows sorted by score descending', sorted);

// 2b) Scores are floats with exactly two decimals
const scoreText = Array.from(window.document.querySelectorAll('#live-list .live-score')).map(e => e.textContent);
check('scores formatted as two-decimal floats', scoreText.every(s => /^\d+\.\d{2}$/.test(s)));

// 3) "New random show" button re-renders without error
const before = window.document.getElementById('live-show').textContent;
window.document.getElementById('live-new').click();
check('still has rows after New random show', rows().length >= 1);
check('still valid scores after New random show', scores().every(s => !isNaN(s)));

// 4) Number column present and sequential (1..N)
const nums = Array.from(window.document.querySelectorAll('#live-list .live-num')).map(e => parseInt(e.textContent, 10));
check('athlete numbers sequential 1..N', nums.length > 0 && nums.every((v, i) => v === i + 1));

console.log('\nLIVE RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
