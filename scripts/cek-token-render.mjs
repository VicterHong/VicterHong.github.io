/* Uji regresi F1 — tokenisasi warna/radius.
   Warna terhitung sesudah patch harus identik dengan nilai asli.
   Catatan: tunggu transisi (0.15s) & hidrasi JS; elemen .tok di-replace
   icons.js, .periode-* & .spotlight-card dibuat JS — tes membangun elemen
   sendiri bila perlu. Jalankan: node scripts/cek-token-render.mjs [baseURL] */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9258;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=/tmp/chrome-token-${Date.now()}`,'about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());

let t;
for (let i=0;i<40;i++){ await sleep(500); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const page = t.find(x=>x.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(m,p={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (r.result?.exceptionDetails) return 'EXC: ' + r.result.exceptionDetails.text;
  return r.result?.result?.value;
};
await send('Page.enable');

/* [halaman, ekspresi (boleh async), harapan, label] */
const TESTS = [
  ['docs.html', `(async()=>{
     const b=document.querySelector('.code-block .copy-btn')||document.querySelector('.copy-btn');
     b.style.transition='none';
     b.classList.add('is-done');
     await new Promise(r=>setTimeout(r,100));
     const c=getComputedStyle(b).color; b.classList.remove('is-done'); b.style.transition=''; return c;
   })()`, 'rgb(74, 222, 128)', 'docs .copy-btn.is-done = --sukses'],
  ['docs.html', `getComputedStyle(document.querySelector('.toc-bahasa-select')).borderRadius`, '9px', 'docs .toc-bahasa-select = --radius-sm'],
  ['home.html', `(()=>{
     const el=document.createElement('span'); el.className='tok';
     document.querySelector('.terminal-body').appendChild(el);
     const c=getComputedStyle(el).color; el.remove(); return c;
   })()`, 'rgb(74, 222, 128)', 'home .tok = --sukses'],
  ['home.html', `(async()=>{
     for(let i=0;i<20;i++){const c=document.querySelector('.spotlight-card'); if(c) return getComputedStyle(c).borderRadius; await new Promise(r=>setTimeout(r,300));}
     return 'TIMEOUT';
   })()`, '14px', 'home .spotlight-card = --radius'],
  ['pricing.html', `(()=>{
     const el=document.createElement('span'); el.className='periode-teks';
     document.querySelector('.pricing-page').appendChild(el);
     const normal=getComputedStyle(el).color;
     const inp=document.createElement('input'); inp.type='radio'; inp.className='periode-input'; inp.checked=true;
     const wrap=document.createElement('label'); wrap.appendChild(inp); wrap.appendChild(el);
     document.querySelector('.pricing-page').appendChild(wrap);
     const cek=getComputedStyle(el).color;
     wrap.remove();
     return JSON.stringify({normal, cek});
   })()`, JSON.stringify({normal:'rgb(161, 161, 170)', cek:'rgb(10, 10, 11)'}), 'pricing .periode-teks normal=dim, :checked=--pr-bg'],
  ['pricing.html', `(()=>{
     const el=document.createElement('span'); el.className='harga-ikon--cek';
     document.querySelector('.pricing-page').appendChild(el);
     const c=getComputedStyle(el).color; el.remove(); return c;
   })()`, 'rgb(10, 10, 11)', 'pricing .harga-ikon--cek = --pr-bg'],
  ['keamanan.html', `(()=>{
     const el=document.createElement('div'); el.className='kam-toast is-sukses';
     document.body.appendChild(el);
     const c=getComputedStyle(el).borderLeftColor; el.remove(); return c;
   })()`, 'rgb(74, 222, 128)', 'keamanan .kam-toast.is-sukses = --sukses'],
  ['keamanan.html', `(()=>{
     const el=document.createElement('div'); el.className='kam-toast is-galat';
     document.body.appendChild(el);
     const c=getComputedStyle(el).borderLeftColor; el.remove(); return c;
   })()`, 'rgb(248, 113, 113)', 'keamanan .kam-toast.is-galat = --galat'],
];

let gagal = 0;
for (const [hal, expr, harap, label] of TESTS) {
  await send('Page.navigate',{url:`${BASE}/${hal}`});
  await sleep(1600);
  const v = await evalJS(expr);
  const ok = v === harap;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${label}\n    ${hal} → ${JSON.stringify(v)}${ok ? '' : ` (harap ${JSON.stringify(harap)})`}`);
}

const resolusi = await evalJS(`(()=>{
  const cs=getComputedStyle(document.documentElement);
  return ['--sukses','--galat','--radius-sm','--radius','--accent-light','--bg']
    .map(t=>t+'='+(cs.getPropertyValue(t).trim()||'KOSONG')).join(' ');
})()`);
console.log(`\n:root (keamanan.html, sesudah patch): ${resolusi}`);
console.log(`\n${gagal === 0 ? '✅ SEMUA LOLOS' : `❌ ${gagal} GAGAL`} — ${TESTS.length} pemeriksaan`);
ws.close();
