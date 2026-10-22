/* jsdom smoke test for the Judge Panel (judge.js).
 * Verifies: shortId lookup, LIVE-show broadcast, and latest-CLOSED fallback.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
function load(file) { return fs.readFileSync(path.join(dir, file), 'utf8'); }

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } }

function buildDom() {
  const html = load('judge.html');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/judge.html' });
  const { window } = dom;
  // inject store.js, tournament.js, then judge.js into the window
  function inject(code) { window.eval(code); }
  inject(load('store.js'));
  inject(load('tournament.js'));
  inject(load('judge.js'));
  return window;
}

// --- Case A: a tournament with a LIVE show -> Judge shows that show, LIVE pill
(function () {
  console.log('Case A: live show present');
  const w = buildDom();
  const S = w.SurfinLive;
  const t = S.generateTournament(['A','B','C','D','E','F','G','H']);
  t.name = 'Judge Test A';
  // start the first real show (makes it live + stamped startedAt)
  const firstShow = (function () { for (const r of t.rounds) for (const h of r.shows) if (h.contestants.some(c=>!c.isBye)) return h; })();
  S.startShow(firstShow);
  w.SurfinStore.put(t);
  const sid = t.shortId;
  w.document.getElementById('j-shortid').value = sid;
  w.document.getElementById('j-search-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const tag = w.document.getElementById('j-live-tag').textContent;
  const round = w.document.getElementById('j-live-round').textContent;
  const names = w.document.querySelectorAll('#j-list tbody tr').length;
  const broadcastVisible = !w.document.getElementById('j-broadcast').hidden;
  ok('broadcast becomes visible after search', broadcastVisible);
  ok('status pill is LIVE', tag === 'LIVE');
  ok('round name populated', round && round !== '—');
  ok('leaderboard has rows', names >= 2);
})();

// --- Case B: no live show, one ENDED show -> Judge shows latest CLOSED
(function () {
  console.log('Case B: latest closed show');
  const w = buildDom();
  const S = w.SurfinLive;
  const t = S.generateTournament(['A','B','C','D','E','F','G','H']);
  t.name = 'Judge Test B';
  const r0 = t.rounds[0];
  const s0 = r0.shows.find(h => h.contestants.some(c=>!c.isBye));
  S.startShow(s0);
  S.endShow(s0); // now ended, with a startedAt in the past
  // a second show ended later should be the "latest closed"
  const s1 = (function () { for (let r=0;r<t.rounds.length;r++) for (const h of t.rounds[r].shows) if (h !== s0 && h.contestants.some(c=>!c.isBye)) return h; })();
  if (s1) { S.startShow(s1); S.endShow(s1); }
  w.SurfinStore.put(t);
  w.document.getElementById('j-shortid').value = t.shortId;
  w.document.getElementById('j-search-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const tag = w.document.getElementById('j-live-tag').textContent;
  const meta = w.document.getElementById('j-live-meta').textContent;
  ok('status pill is CLOSED (not LIVE)', tag === 'CLOSED');
  ok('meta shows a round + surfers', /• \d+ surfers in the water/.test(meta));
  ok('leaderboard rendered', w.document.querySelectorAll('#j-list tbody tr').length >= 2);
})();

// --- Case C: unknown shortId -> error shown, no broadcast
(function () {
  console.log('Case C: unknown shortId');
  const w = buildDom();
  w.document.getElementById('j-shortid').value = 'ZZZZZ9';
  w.document.getElementById('j-search-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  ok('error visible', !w.document.getElementById('j-search-error').hidden);
  ok('broadcast stays hidden', w.document.getElementById('j-broadcast').hidden);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
