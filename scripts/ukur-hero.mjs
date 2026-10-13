/* Ukur sisa kosmetik hero secara objektif:
   1. Radius tombol cookie vs tombol situs (konsistensi)
   2. Baris judul desktop (h1) — Linear target 2-3
   3. Kontras semua tipe teks terminal (WCAG AA ≥4.5:1)
   Jalankan: node scripts/ukur-hero.mjs */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9265;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=/tmp/chrome-uk-${Date.now()}`,'about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());
let t; for (let i=0;i<40;i++){ await sleep(500); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(m,p={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev = async (e) => { const r = await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:8899/home.html'});
await sleep(3000);

const hasil = await ev(`(()=>{
  /* Kontras: luminance relatif WCAG */
  const lum = (r,g,b) => { const f = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = s => { const m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/); return m ? {r:+m[1],g:+m[2],b:+m[3],a:m[4]!==undefined?+m[4]:1} : null; };
  const ratio = (fg, bg) => { /* komposit fg (mungkin alpha) di atas bg (opaque) */
    const f = fg.a < 1 ? { r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a:1 } : fg;
    const L1 = lum(f.r,f.g,f.b), L2 = lum(bg.r,bg.g,bg.b);
    const [hi,lo] = L1>L2 ? [L1,L2] : [L2,L1];
    return ((hi+0.05)/(lo+0.05)).toFixed(2);
  };

  const cs = e => e ? getComputedStyle(e) : null;
  const h1 = document.querySelector('h1');
  const c1 = cs(h1);

  /* Latar terminal efektif: rgba(13,13,16,.82) di atas latar hero (video/gradien gelap ~#0a0a0b) */
  const termBg = { r: Math.round(13*.82+10*.18), g: Math.round(13*.82+10*.18), b: Math.round(16*.82+11*.18), a: 1 };

  const tipe = {
    '.tline':      '.tline:not(.tdim):not(.tcaret)',
    '.tline.tdim': '.tline.tdim',
    '.tprompt':    '.tprompt',
    '.tcmd':       '.tcmd',
    '.tok':        '.tok'
  };
  const kontras = {};
  for (const [nama, sel] of Object.entries(tipe)) {
    const e = document.querySelector(sel);
    if (!e) { kontras[nama] = 'TIDAK ADA'; continue; }
    const fg = parse(cs(e).color);
    kontras[nama] = fg ? ratio(fg, termBg) : 'parse gagal';
  }

  const radius = {
    'cookie decision': cs(document.querySelector('.cookie-btn--decision'))?.borderRadius,
    'CTA hero (.btn)': cs(document.querySelector('.hero-actions .btn, .hero-actions a'))?.borderRadius,
    'btn-primary': cs(document.querySelector('.btn-primary'))?.borderRadius,
  };

  return {
    h1: { baris: Math.round(h1.getBoundingClientRect().height / parseFloat(c1.lineHeight)),
          font: c1.fontSize, line: c1.lineHeight, teks: h1.textContent.trim().slice(0,80) },
    radius, kontras
  };
})()`);
console.log(JSON.stringify(hasil, null, 1));
ws.close();
