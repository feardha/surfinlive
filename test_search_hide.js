const fs = require('fs');
const { JSDOM } = require('jsdom');

function makeWin(url){
  const html = fs.readFileSync('dyn.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'');
  const dom = new JSDOM(html, { runScripts:'outside-only', url });
  const w = dom.window;
  w.URLSearchParams = URLSearchParams;
  return w;
}
const mem = {};
function attachLS(w){ w.localStorage = { getItem:k=>(k in mem?mem[k]:null), setItem:(k,v)=>{mem[k]=String(v);}, removeItem:k=>{delete mem[k];} }; }

// Build a real tournament + store it
const w1 = makeWin('http://localhost/dyn.html?shortId=INIT');
attachLS(w1);
global.window=w1; global.document=w1.document;
new Function('window','module', fs.readFileSync('tournament.js','utf8'))(w1,{});
new Function('window','module', fs.readFileSync('store.js','utf8'))(w1,{});
const T2=w1.SurfinLive, S2=w1.SurfinStore;
const t = T2.generateTournament(['Kelly','Layne','Gabriel','Carissa']);
const sid = t.shortId;
S2.put(t);

// Open dyn view WITH a valid shortId
const w2 = makeWin('http://localhost/dyn.html?shortId=' + sid);
attachLS(w2);
w2.SurfinLive=T2; w2.SurfinStore=S2;
global.window=w2; global.document=w2.document;
new Function('window','document', fs.readFileSync('dyn.js','utf8'))(w2, w2.document);

setTimeout(()=>{
  const d=w2.document;
  const search=d.getElementById('dyn-search');
  const wrap=d.getElementById('dyn-wrap');
  const err=d.getElementById('dyn-error');
  const css=fs.readFileSync('styles.css','utf8');
  const hasHiddenRule = /\.dyn-search\[hidden\]\s*\{\s*display:\s*none/.test(css);
  console.log('valid shortId ->', sid);
  console.log('JS: search.hidden =', search.hidden);
  console.log('JS: wrap.hidden    =', wrap.hidden);
  console.log('JS: error.hidden   =', err.hidden);
  console.log('CSS: .dyn-search[hidden]{display:none} present =', hasHiddenRule);
  const passes = (search.hidden === true) && (wrap.hidden === false) && hasHiddenRule;
  console.log(passes ? 'PASS: search gate hidden + wrap shown + CSS supports it' : 'FAIL');
}, 300);
