/* SurfinLive — Settings / theme verification (jsdom + contrast math).
 * Run: node test_settings.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
let jsdom;
try { jsdom = require('jsdom'); } catch (e) {
  console.log('SKIP: jsdom not installed'); process.exit(0);
}
const { JSDOM } = jsdom;
const DIR = __dirname;
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

// ---------- contrast helpers (WCAG 2.1) ----------
function hex2rgb(h) {
  h = h.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function lum(rgb) {
  const a = rgb.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
  return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
}
function ratio(h1, h2) {
  const l1 = lum(hex2rgb(h1)), l2 = lum(hex2rgb(h2));
  const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- parse tokens out of styles.css ----------
const css = fs.readFileSync(path.join(DIR, 'styles.css'), 'utf8');
function blockTokens(selector) {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf('{', i), close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = {};
  body.replace(/--([\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
  return out;
}
const dark = blockTokens(':root {');
const light = blockTokens('[data-theme="light"]');

console.log('\n== A. token sets ==');
ok(!!dark, 'dark tokens found on :root');
ok(!!light, 'light tokens found on [data-theme="light"]');
const required = ['bg','panel','panel-2','line','text','muted','primary','primary-ink',
  'advance','elim','champ','bye','bg-glow','header-bg','input-bg','entry-bg',
  'bye-stripe','overlay','green','green-ink','live-ink','score-ink','picked-fill','champ-fill','champ-card-fill'];
const missing = required.filter(k => !(k in light));
ok(missing.length === 0, 'light theme overrides every themed token', 'missing: ' + missing.join(','));

console.log('\n== B. no stray hardcoded colors in rules ==');
// strip the two token blocks, then look for hex/rgba in actual rules
let rules = css;
[':root {', '[data-theme="light"]'].forEach(sel => {
  const i = rules.indexOf(sel);
  if (i >= 0) { const o = rules.indexOf('{', i), c = rules.indexOf('}', o); rules = rules.slice(0, i) + rules.slice(c + 1); }
});
// swatch previews intentionally hardcode both palettes; exclude those lines
const offenders = rules.split('\n').filter(l =>
  /#[0-9a-fA-F]{3,6}|rgba?\(/.test(l) &&
  !/\.swatch-(dark|light)/.test(l) &&
  !/box-shadow|livePulse|0 0 0/.test(l)
);
ok(offenders.length === 0, 'no hardcoded colors left in themed rules',
   offenders.map(s => s.trim()).join(' | '));

console.log('\n== C. LIGHT mode contrast (WCAG AA) ==');
const L = light;
function chk(fg, bg, min, label) {
  const r = ratio(L[fg] || fg, L[bg] || bg);
  ok(r >= min, `${label}: ${r.toFixed(2)}:1 (need ${min})`);
  return r;
}
chk('text', 'panel', 4.5, 'body text on panel');
chk('text', 'bg', 4.5, 'body text on page bg');
chk('muted', 'panel', 4.5, 'muted text on panel');
chk('muted', 'panel-2', 4.5, 'muted on panel-2');
chk('primary-ink', 'primary', 4.5, 'primary button ink on primary fill');
chk('green-ink', 'green', 4.5, 'Start button ink on green');
chk('live-ink', 'elim', 4.5, 'LIVE pill ink on red');
chk('advance', 'panel', 4.5, 'advance/ended tag on panel');
chk('advance', 'panel-2', 4.5, 'advance tag on panel-2 (show card)');
chk('elim', 'panel', 4.5, 'error/elim text on panel');
chk('champ', 'panel', 4.5, 'champion gold on panel');
chk('bye', 'panel-2', 4.5, 'closed/bye tag on panel-2');
chk('text', 'input-bg', 4.5, 'textarea text on input bg');
chk('text', 'entry-bg', 4.5, 'contestant name on entry bg');

console.log('\n== D. light mode really is "black text over white" ==');
ok(lum(hex2rgb(L.panel)) > 0.85, 'panel is white-ish (lum ' + lum(hex2rgb(L.panel)).toFixed(2) + ')');
ok(lum(hex2rgb(L.text)) < 0.10, 'text is near-black (lum ' + lum(hex2rgb(L.text)).toFixed(3) + ')');
ok(lum(hex2rgb(dark.panel)) < 0.10, 'dark panel still dark (unchanged default)');

console.log('\n== E. Settings page DOM + radio behaviour ==');
// (score-ink checks live in section H below)
const html = fs.readFileSync(path.join(DIR, 'settings.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/settings.html', pretendToBeVisual: true });
const w = dom.window;
// load theme.js then settings.js in order
w.eval(fs.readFileSync(path.join(DIR, 'theme.js'), 'utf8'));
const T = w.SurfinTheme;
ok(!!T, 'SurfinTheme exposed');
ok(T.get() === 'dark', 'default theme is dark');
ok(w.document.documentElement.getAttribute('data-theme') === null, 'no data-theme attr while dark');

w.eval(fs.readFileSync(path.join(DIR, 'settings.js'), 'utf8'));
const rDark = w.document.getElementById('theme-dark');
const rLight = w.document.getElementById('theme-light');
ok(!!rDark && !!rLight, 'both radios present');
ok(rDark.type === 'radio' && rLight.type === 'radio', 'inputs are type=radio');
ok(rDark.name === rLight.name && rDark.name === 'theme', 'radios share name="theme" (mutually exclusive)');
ok(rDark.checked === true && rLight.checked === false, 'dark radio pre-checked from storage');

// click Light
rLight.checked = true;
rLight.dispatchEvent(new w.Event('change', { bubbles: true }));
ok(w.document.documentElement.getAttribute('data-theme') === 'light', 'selecting Light sets data-theme="light"');
ok(T.get() === 'light', 'Light persisted to storage');
ok(T.isLight() === true, 'isLight() true');
ok(rLight.closest('.radio-option').classList.contains('is-selected'), 'Light card marked selected');
ok(!rDark.closest('.radio-option').classList.contains('is-selected'), 'Dark card not selected');
ok(/Light Mode applied/.test(w.document.getElementById('settings-saved').textContent), 'status message announced');

// back to Dark
rDark.checked = true; rLight.checked = false;
rDark.dispatchEvent(new w.Event('change', { bubbles: true }));
ok(w.document.documentElement.getAttribute('data-theme') === null, 'selecting Dark removes data-theme');
ok(T.get() === 'dark', 'Dark persisted');

console.log('\n== F. theme persists across pages ==');
T.set('light');
const saved = w.localStorage.getItem('surfinlive.theme');
ok(saved === 'light', 'stored under surfinlive.theme = light');
// simulate a fresh page load of the Dashboard with that storage
const dom2 = new JSDOM(fs.readFileSync(path.join(DIR, 'dashboard.html'), 'utf8'),
  { runScripts: 'outside-only', url: 'http://localhost/dashboard.html' });
dom2.window.localStorage.setItem('surfinlive.theme', 'light');
dom2.window.eval(fs.readFileSync(path.join(DIR, 'theme.js'), 'utf8'));
ok(dom2.window.document.documentElement.getAttribute('data-theme') === 'light',
   'Dashboard picks up Light on load');
ok(/theme\.js/.test(fs.readFileSync(path.join(DIR, 'dashboard.html'), 'utf8').split('<link')[0]),
   'theme.js loads BEFORE stylesheet on dashboard (no flash)');
ok(/theme\.js/.test(fs.readFileSync(path.join(DIR, 'index.html'), 'utf8').split('<link')[0]),
   'theme.js loads BEFORE stylesheet on index (no flash)');

console.log('\n== G. Settings tab present in nav on all 3 pages ==');
['dashboard.html', 'index.html', 'settings.html'].forEach(f => {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const nav = src.slice(src.indexOf('<nav'), src.indexOf('</nav>'));
  ok(/href="settings\.html"/.test(nav), f + ' nav links to Settings');
  ok(/href="dashboard\.html"/.test(nav) && /href="index\.html"/.test(nav), f + ' nav keeps other tabs');
});
const sset = fs.readFileSync(path.join(DIR, 'settings.html'), 'utf8');
const snav = sset.slice(sset.indexOf('<nav'), sset.indexOf('</nav>'));
ok(/class="nav-link active" href="settings\.html"/.test(snav), 'Settings tab is active on settings.html');
ok((snav.match(/nav-link active/g) || []).length === 1, 'exactly one active tab on settings.html');

console.log(`\n== H. Live View score color (.live-score) ==`);
// Resolve a token value that may itself be `var(--other)` (one hop is enough here).
function resolveToken(set, name) {
  let v = (set[name] || '').trim();
  const m = v.match(/^var\(\s*--([\w-]+)\s*\)$/);
  if (m) v = (set[m[1]] || '').trim();
  return v;
}
// The three score cells (main Score, High 1st, High 2nd) all use .live-score.
const scoreRule = css.split('\n').find(l => /^\.live-score\s*\{/.test(l.trim()));
ok(!!scoreRule, '.live-score rule exists');
ok(/color:\s*var\(--score-ink\)/.test(scoreRule || ''),
   '.live-score color is driven by --score-ink', (scoreRule || '').trim());

const darkScore = resolveToken(dark, 'score-ink');
const lightScore = resolveToken(light, 'score-ink');
ok(darkScore.toLowerCase() === dark.primary.toLowerCase(),
   'DARK: score stays the teal accent (' + darkScore + ')');
ok(lightScore.toLowerCase() === light.text.toLowerCase(),
   'LIGHT: score resolves to the body text color (' + lightScore + ')');
ok(lum(hex2rgb(lightScore)) < 0.02,
   'LIGHT: score ink is black (lum ' + lum(hex2rgb(lightScore)).toFixed(4) + ')');
// Scores sit on .live-table td, which is panel-2.
const rScore = ratio(lightScore, light['panel-2']);
ok(rScore >= 7, 'LIGHT: score on table cell = ' + rScore.toFixed(2) + ':1 (AAA)');
const rScoreDark = ratio(darkScore, dark['panel-2']);
ok(rScoreDark >= 4.5, 'DARK: score on table cell = ' + rScoreDark.toFixed(2) + ':1 (unchanged, AA)');

// live.js must keep tagging BOTH detail columns with .live-score.
const liveJs = fs.readFileSync(path.join(DIR, 'live.js'), 'utf8');
const scoreCells = (liveJs.match(/className\s*=\s*'live-score'/g) || []).length;
ok(scoreCells >= 3, 'live.js tags >=3 cells .live-score (Score + TW1 + TW2), found ' + scoreCells);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
