/* End-to-end test for the judge.html Short-ID search gate.
 * Loads the REAL store.js / tournament.js / judge.js into jsdom, builds a
 * tournament through the injected window.SurfinStore, then asserts the gate
 * hides when a match is found and shows the inline error under the box otherwise.
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

function loadFileInto(dom, file) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  dom.window.eval(code);
}

function assertTrue(cond, label) {
  if (!cond) { console.error('FAIL: ' + label); process.exit(1); }
  console.log('PASS: ' + label);
}

const html = fs.readFileSync(path.join(dir, 'judge.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/judge.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const { window } = dom;

['store.js', 'tournament.js'].forEach(f => loadFileInto(dom, f));

const S = window.SurfinLive;
const store = window.SurfinStore;
const t = S.generateTournament(['Surfer A', 'Surfer B', 'Surfer C', 'Surfer D']);
store.put(t);
const rec = store.getByShortId(t.shortId);
const sid = rec ? rec.tournament.shortId : store.list()[0].tournament.shortId;
console.log('built tournament shortId=' + sid);

loadFileInto(dom, 'judge.js');

const search = window.document.getElementById('j-search');
const broadcast = window.document.getElementById('j-broadcast');
const input = window.document.getElementById('j-shortid');
const form = window.document.getElementById('j-search-form');
const errEl = window.document.getElementById('j-search-error');

// Gate visible on load.
assertTrue(!search.hidden, 'search gate visible on load');
assertTrue(broadcast.hidden, 'broadcast hidden on load');

// Valid submit -> gate hides, broadcast shows, error still hidden.
input.value = sid.toLowerCase();
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assertTrue(search.hidden, 'search gate hidden after valid shortId submit');
assertTrue(!broadcast.hidden, 'broadcast shown after valid shortId submit');
assertTrue(errEl.hidden, 'error hidden after valid submit');

// Empty submit -> gate visible again + inline error under the box.
const dom2 = new JSDOM(html, { url: 'http://localhost/judge.html', runScripts: 'dangerously', pretendToBeVisual: true });
['store.js', 'tournament.js', 'judge.js'].forEach(f => loadFileInto(dom2, f));
const form2 = dom2.window.document.getElementById('j-search-form');
const err2 = dom2.window.document.getElementById('j-search-error');
const search2 = dom2.window.document.getElementById('j-search');
form2.dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
assertTrue(!err2.hidden, 'inline error shown on empty submit');
assertTrue(!search2.hidden, 'gate still visible on empty submit');

console.log('\nALL JUDGE SEARCH TESTS PASSED');
process.exit(0);
