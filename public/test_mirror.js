/* Integration test: Judge Panel -> Dynamic View mirror.
 *
 * judge.js runs in judge.html (jdom); dyn.js runs in dyn.html (ddom). They
 * share the SAME SurfinStore instance (injected), which is how judge.js's
 * store.put(...) -> notify() reaches dyn.js's onChange subscription across the
 * two "tabs". The surfinlive:broadcast custom event is per-window, so we also
 * fire it on ddom to confirm dyn's own listener repaints.
 *
 * Verifies:
 *   A. dyn Running Score shows the PERSON's assigned color (reorder moves color
 *      WITH the surfer) — the reported bug.
 *   B. dyn mirrors the judge leaderboard's real scores after a judge tick.
 *   C. a priority reorder in the judge (color+order) is picked up by dyn —
 *      both via the shared-store onChange path and via the broadcast event.
 *   D. the same-process SurfinStore.onChange path also repaints dyn.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.error('  FAIL ' + label); }
}
function loadInto(dom, file) {
  dom.window.eval(fs.readFileSync(path.join(dir, file), 'utf8'));
}

// ---- Judge window (real judge.html DOM) ----
const jdom = new JSDOM(fs.readFileSync(path.join(dir, 'judge.html'), 'utf8'), {
  url: 'http://localhost/judge.html', runScripts: 'outside-only', pretendToBeVisual: true
});
loadInto(jdom, 'store.js');
loadInto(jdom, 'tournament.js');
loadInto(jdom, 'judge.js');
const JS = jdom.window.SurfinLive;
const JStore = jdom.window.SurfinStore; // the shared store instance

// ---- Dyn window (real dyn.html DOM), but reuse the SAME store instance ----
const ddom = new JSDOM(fs.readFileSync(path.join(dir, 'dyn.html'), 'utf8'), {
  url: 'http://localhost/dyn.html?shortId=PENDING', runScripts: 'outside-only', pretendToBeVisual: true
});
loadInto(ddom, 'tournament.js');
ddom.window.SurfinStore = JStore; // <-- share the judge's store (real link)

// ---- Build tournament + start a live show (assigns colors) ----
const names = ['Alfie', 'Bree', 'Cody', 'Dara'];
const t = JS.generateTournament(names.slice());
t.name = 'Mirror Test';
JStore.put(t);
const liveShow = (function () {
  for (const r of t.rounds) for (const h of r.shows)
    if (h.contestants.some(c => !c.isBye)) return h;
})();
JS.startShow(liveShow);          // assigns each surfer a unique color, phase=live
JStore.put(t);                  // persist with colors + phase

const personColor = {};
liveShow.contestants.forEach(c => { if (!c.isBye) personColor[c.name] = c.color; });
console.log('assigned colors:', JSON.stringify(personColor));

// Judge looks up the shortId (wires its state + ticks/broadcast).
jdom.window.document.getElementById('j-shortid').value = t.shortId;
jdom.window.document.getElementById('j-search-form')
  .dispatchEvent(new jdom.window.Event('submit', { bubbles: true, cancelable: true }));

// Boot dyn.js for the SAME shortId.
ddom.reconfigure({ url: 'http://localhost/dyn.html?shortId=' + t.shortId });
loadInto(ddom, 'dyn.js');

function dynDetailRows() {
  return Array.prototype.slice.call(
    ddom.window.document.querySelectorAll('#dyn-detail-list tbody tr'));
}
function dynDetailColors() {
  return dynDetailRows().map(tr => {
    const badge = tr.querySelector('.priority-badge');
    const title = badge ? badge.getAttribute('title') : '';
    const m = /(\w+) · priority (\d+)/.exec(title || '');
    return {
      name: tr.querySelector('.live-name').textContent,
      color: m ? m[1] : null,
      prio: m ? m[2] : null
    };
  });
}

console.log('\nCase A: dyn Running Score shows the PERSON color (not slot position)');
const detailA = dynDetailColors();
ok('dyn has one row per surfer', detailA.length === names.length);
detailA.forEach(r => {
  ok('dyn row "' + r.name + '" shows its assigned color ' + (personColor[r.name] || '?'),
    r.color === personColor[r.name]);
});

console.log('\nCase B: dyn mirrors judge leaderboard + Running Score (High 1st / High 2nd)');
// Simulate the judge having ticked Alfie to 8.40 / 5.30 (total 13.70) on a LIVE
// show. applyShow() in judge.js now PERSISTS tw1/tw2 onto the contestant (the fix),
// where previously it only wrote the total to .score. Then we open the judge (which
// calls applyShow and writes the waves) and push the shared store so dyn repaints.
const alfie = liveShow.contestants.find(c => !c.isBye && c.name === 'Alfie');
alfie.tw1 = 8.40; alfie.tw2 = 5.30; alfie.score = 137;
JStore.put(t);
// Open the judge for this shortId -> judge.js applyShow() reads the contestant and
// writes its tw1/tw2 back onto the contestant object in the shared store.
jdom.window.document.getElementById('j-shortid').value = t.shortId;
jdom.window.document.getElementById('j-search-form')
  .dispatchEvent(new jdom.window.Event('submit', { bubbles: true, cancelable: true }));
JStore.put(t); // judge's tick/broadcast -> store.put (shared) -> dyn repaint
let leader = Array.prototype.slice.call(
  ddom.window.document.querySelectorAll('#dyn-list tbody tr'));
let alfieRow = leader.find(tr => tr.querySelector('.live-name').textContent === 'Alfie');
ok('dyn leaderboard has Alfie total at 13.70',
  alfieRow && alfieRow.querySelector('.live-score').textContent === '13.70');
const alfieDetail = dynDetailRows().find(tr => tr.querySelector('.live-name').textContent === 'Alfie');
ok('dyn Running Score Alfie High 1st mirrors judge tw1 (8.40, not the total)',
  alfieDetail && alfieDetail.querySelectorAll('.live-score')[0].textContent === '8.40');
ok('dyn Running Score Alfie High 2nd mirrors judge tw2 (5.30, not 0)',
  alfieDetail && alfieDetail.querySelectorAll('.live-score')[1].textContent === '5.30');
// These two assertions prove the judge actually persisted the waves (the real fix),
// so a dyn page reading the shared store matches the judge.
ok('judge persisted alfie.tw1 onto the contestant', alfie.tw1 === 8.40);
ok('judge persisted alfie.tw2 onto the contestant', alfie.tw2 === 5.30);

// Confirm EVERY dyn Running Score row's High 1st/2nd equals the judge's tw1/tw2.
console.log('\nCase B2: every dyn Running Score row mirrors judge tw1/tw2 exactly');
const judgeRows = JS.orderedContestants(liveShow);
const dynRows = dynDetailRows();
ok('dyn row count equals judge row count', dynRows.length === judgeRows.length);
let allMatch = true;
judgeRows.forEach((jc, i) => {
  const dr = dynRows[i];
  if (!dr) { allMatch = false; return; }
  const cells = dr.querySelectorAll('.live-score');
  const h1 = jc.tw1 != null ? jc.tw1.toFixed(2) : '0.00';
  const h2 = jc.tw2 != null ? jc.tw2.toFixed(2) : '0.00';
  if (cells[0].textContent !== h1 || cells[1].textContent !== h2) allMatch = false;
});
ok('every dyn High 1st/2nd equals the judge panel tw1/tw2', allMatch);

console.log('\nCase C: priority reorder in judge moves color+order in dyn (event-driven)');
const order = JS.orderedContestants(liveShow).map(c => c.name);
const idx = order.indexOf('Alfie');
order.splice(idx, 1);
order.push('Alfie');
liveShow.order = order;
JStore.put(t);                     // shared store -> notify -> dyn repaint (onChange path)
// Emulate the judge also firing its broadcast event to the dyn window.
ddom.window.dispatchEvent(new ddom.window.CustomEvent('surfinlive:broadcast', { detail: { shortId: t.shortId } }));

const detailC = dynDetailColors();
const alfiePos = detailC.findIndex(r => r.name === 'Alfie');
ok('Alfie moved to last in dyn detail order', alfiePos === detailC.length - 1);
ok('Alfie keeps its assigned color after reorder (color travels with person)',
  detailC[alfiePos].color === personColor['Alfie']);
ok('Alfie priority renumbered to last', detailC[alfiePos].prio === String(detailC.length));
const first = detailC[0];
ok('new first row keeps its own assigned color', first.color === personColor[first.name]);

console.log('\nCase D: another store write re-paints dyn (onChange subscription)');
const bre = liveShow.contestants.find(c => !c.isBye && c.name === 'Bree');
bre.score = 200;                  // 20.00
JStore.put(t);
const detailD = dynDetailColors();
const breRow = detailD.find(r => r.name === 'Bree');
ok('dyn re-painted on SurfinStore.put (onChange fired)', !!breRow && breRow.color === personColor['Bree']);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
