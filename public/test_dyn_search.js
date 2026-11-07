/* End-to-end test for the dyn.html no-Short-ID search gate.
 * Loads the REAL store.js / tournament.js / dyn.js into jsdom, builds a
 * tournament through the injected window.SurfinStore (same instance the app
 * reads), then asserts the gate + redirect behaviour.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

function loadFileInto(dom, file) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  // indirect eval runs in the window's global scope (so `window.X` assignments
  // and IIFE side effects land on the jsdom window), without double-executing.
  dom.window.eval(code);
}

function assertTrue(cond, label) {
  if (!cond) { console.error('FAIL: ' + label); process.exit(1); }
  console.log('PASS: ' + label);
}

// 1) Build the DOM with NO shortId in the URL.
const html = fs.readFileSync(path.join(dir, 'dyn.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/dyn.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const { window } = dom;

// 2) Load deps + app.
loadFileInto(dom, 'store.js');
loadFileInto(dom, 'tournament.js');

// 3) Build a tournament through the SAME injected store the app uses.
const S = window.SurfinLive;
const store = window.SurfinStore;
const t = S.generateTournament(['Surfer A', 'Surfer B', 'Surfer C', 'Surfer D']);
store.put(t);
const rec = store.getByShortId(t.shortId);
const sid = rec ? rec.tournament.shortId : (store.list()[0].tournament.shortId);
console.log('built tournament shortId=' + sid);

// 4) Boot dyn.js (no shortId -> search gate expected).
loadFileInto(dom, 'dyn.js');

const search = window.document.getElementById('dyn-search');
const wrap = window.document.getElementById('dyn-wrap');
const error = window.document.getElementById('dyn-error');

assertTrue(!search.hidden, 'search gate visible when no shortId in URL');
assertTrue(wrap.hidden, 'broadcast wrap hidden when no shortId');
assertTrue(error.hidden, 'error hidden when no shortId');

// 5) Enter the shortId and submit -> should redirect to ?shortId=XXX and show wrap.
const input = window.document.getElementById('dyn-search-input');
const form = window.document.getElementById('dyn-search-form');
input.value = sid.toLowerCase(); // verify it upper-cases like the UI
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

assertTrue(window.location.search.indexOf('shortId=' + sid) !== -1,
  'URL rewritten to dyn.html?shortId=' + sid);
assertTrue(!wrap.hidden, 'broadcast wrap shown after valid shortId submitted');
assertTrue(search.hidden, 'search gate hidden after redirect');

// 6) Bad submit (empty) shows inline error, stays on gate.
//    Reset by reloading into a fresh no-id DOM.
const dom2 = new JSDOM(html, { url: 'http://localhost/dyn.html', runScripts: 'dangerously', pretendToBeVisual: true });
['store.js', 'tournament.js', 'dyn.js'].forEach(f => loadFileInto(dom2, f));
const form2 = dom2.window.document.getElementById('dyn-search-form');
const err2 = dom2.window.document.getElementById('dyn-search-error');
form2.dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
assertTrue(!err2.hidden, 'inline error shown on empty submit');
assertTrue(!dom2.window.document.getElementById('dyn-search').hidden, 'gate still visible on empty submit');

console.log('\nALL DYN SEARCH TESTS PASSED');
process.exit(0);
