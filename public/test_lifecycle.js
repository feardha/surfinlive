/* Tests for the show status lifecycle + Live show selection.
 * Part A: engine show.status transitions (generate / scoreRound / resetResults).
 * Part B: live.js picks the Dashboard's `live` show from sessionStorage.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

const S = require('./tournament.js');

// --- Part A: engine show lifecycle ------------------------------------
function allShows(t) {
  const out = [];
  t.rounds.forEach(r => r.shows.forEach(h => out.push(h)));
  return out;
}
function liveShow(t) { return allShows(t).find(h => h.live); }

(function testLifecycle() {
  const names = []; for (let i = 1; i <= 32; i++) names.push('P' + i);
  const t = S.generateTournament(names);

  const shows = allShows(t);
  const lives = shows.filter(h => h.live);
  const actives = shows.filter(h => h.status === 'active');
  check('A1: every show has a status', shows.every(h => !!h.status));
  // A freshly generated bracket has NO live show: going live is an explicit
  // Dashboard Start (startShow), never automatic on generate.
  check('A2: no show is live on a fresh bracket', lives.length === 0);
  check('A3: exactly one show is active', actives.length === 1);
  check('A4: every show starts in phase "open"', shows.every(h => h.phase === 'open'));
  check('A5: round-1 distributed shows are active/open (no other active)', actives[0].contestants.some(c => c.name !== 'TBD'));

  // A2b: Start flips exactly that show to live; End flips it back out of live.
  const first = t.rounds[0].shows[0];
  S.startShow(first);
  check('A2b: after startShow, that show is live', first.live === true && first.phase === 'live');
  check('A2c: after startShow, exactly one show is live', allShows(t).filter(h => h.live).length === 1);
  S.endShow(first);
  check('A2d: after endShow, no show is live', allShows(t).filter(h => h.live).length === 0);
  check('A2e: after endShow, phase is "ended"', first.phase === 'ended');

  // Advance round 0 (manual: pick 2 per show)
  t.rounds[0].shows.forEach(h => {
    const reals = h.contestants.filter(c => !c.isBye && c.status === 'pending');
    reals.forEach((c, k) => { if (k < Math.min(2, reals.length)) c.picked = true; });
  });
  S.scoreRound(t, 0);

  const r0 = t.rounds[0].shows;
  const r1 = t.rounds[1].shows;
  check('A6: round-0 shows closed after advance', r0.every(h => h.status === 'closed'));
  check('A7: round-0 show no longer live', r0.every(h => h.live === false));
  check('A8: round-1 shows active', r1.every(h => h.status === 'active'));
  // The newly opened round is Active but NOT live — the user must press Start.
  check('A9: no round-1 show is live after advance', r1.filter(h => h.live).length === 0);
  check('A10: round-1 shows are phase "open" awaiting Start', r1.every(h => h.phase === 'open'));

  // Reset -> back to generated state
  S.resetResults(t);
  const after = allShows(t);
  check('A11: after reset, no live show', after.filter(h => h.live).length === 0);
  check('A12: after reset, round-0 distributed shows active/open again',
    t.rounds[0].shows.some(h => h.status === 'active') || t.rounds[0].shows[0].status === 'active');

  // Simulate fully -> final round closed, all shows closed
  S.simulateTournament(t);
  check('A13: after full simulate, all shows closed', allShows(t).every(h => h.status === 'closed'));
  check('A14: after full simulate, no show live', allShows(t).every(h => h.live === false));
})();

// --- Part B: live.js selects the Dashboard's live show ----------------
function makeDomWithBracket(tournament) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  global.window = window; global.document = window.document;
  function load(f) {
    const fn = new window.Function(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    fn.call(window);
  }
  // live.js resolves the bracket through SurfinStore (localStorage), so load
  // the store first and seed the tournament the Dashboard would have saved.
  load('store.js');
  window.SurfinStore.put(tournament);
  load('tournament.js'); load('live.js');
  return window;
}

(function testLiveSelection() {
  const names = []; for (let i = 1; i <= 16; i++) names.push('P' + i);
  const t = S.generateTournament(names);
  // A fresh bracket has NO live show — `live` is owned exclusively by the
  // Dashboard Start button. Press Start on the first real show so the Live
  // View has something to lock onto.
  const target = allShows(t).find(h => h.contestants.some(c => !c.isBye));
  S.startShow(target);
  const live = liveShow(t);
  check('B0: after startShow there is exactly one live show',
    allShows(t).filter(h => h.live).length === 1 && live === target);
  const expectedNames = live.contestants.filter(c => !c.isBye).map(c => c.name).sort();

  const w = makeDomWithBracket(t);
  const rows = Array.from(w.document.querySelectorAll('#live-list tbody tr'));
  const shown = rows.map(r => r.querySelector('.live-name').textContent).sort();
  check('B1: Live View shows the Dashboard live show (same contestants)',
    JSON.stringify(shown) === JSON.stringify(expectedNames));
  // live.js signals the live state on the status pill (LIVE vs STANDBY/frozen);
  // the meta line carries the round name + head count.
  check('B2: status pill reads LIVE and is not frozen',
    w.document.getElementById('live-tag').textContent.trim() === 'LIVE' &&
    !w.document.getElementById('live-tag').classList.contains('frozen'));
  check('B2b: meta names the round and head count, not frozen',
    /surfers in the water/.test(w.document.getElementById('live-meta').textContent) &&
    !/frozen/.test(w.document.getElementById('live-meta').textContent));

  // Fallback: no stored bracket at all -> Live View still renders a show.
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w2 = dom2.window; global.window = w2; global.document = w2.document;
  function load(f) { const fn = new w2.Function(fs.readFileSync(path.join(__dirname, f), 'utf8')); fn.call(w2); }
  load('store.js'); load('tournament.js'); load('live.js');
  const rows2 = Array.from(w2.document.querySelectorAll('#live-list tbody tr'));
  check('B3: without a bracket, Live View still renders a show', rows2.length >= 1);
})();

console.log('\nLIFECYCLE RESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
