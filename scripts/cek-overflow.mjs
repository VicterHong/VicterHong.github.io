/* Cek overflow horizontal + elemen meluber di semua halaman target × 3 lebar.
   Jalankan: node scripts/cek-overflow.mjs [baseURL] */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const PAGES = ['home','pricing','docs','changelog','privasi','syarat','keamanan','sign-in','sign-up','404','cookies','spotlight'];
const WIDTHS = [320, 360, 768, 1440];
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9253;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-overflow','about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());

let t;
for (let i=0;i<25;i++){ await sleep(400); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const page = t.find(x=>x.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});

await send('Page.enable');
let bad = 0;
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', {width:w, height:900, deviceScaleFactor:1, mobile:w<500});
  for (const p of PAGES) {
    await send('Page.navigate',{url:`${BASE}/${p}.html`});
    await sleep(1400);
    const expr = `(() => {
      const de = document.documentElement;
      // window.innerWidth includes the classic scrollbar gutter; subtracting
      // clientWidth reports the gutter as a false horizontal overflow on Linux.
      const over = de.scrollWidth - window.innerWidth;
      const wide = [];
      if (over > 2) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width > de.clientWidth + 2 && r.height > 4) {
            wide.push((el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName) + ':' + Math.round(r.width));
            if (wide.length >= 3) break;
          }
        }
      }
      const right = [...document.querySelectorAll('body *')]
        .map(el => ({el, r: el.getBoundingClientRect()}))
        .filter(({r}) => r.right > innerWidth + 2 && r.height > 4)
        .slice(0, 5)
        .map(({el,r}) => ({name: el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName, right: Math.round(r.right), position: getComputedStyle(el).position}));
      return JSON.stringify({over, wide, right});
    })()`;
    const res = await send('Runtime.evaluate',{expression:expr,returnByValue:true});
    const v = JSON.parse(res.result?.result?.value || '{}');
    if (v.over > 2) { bad++; console.log(`OVERFLOW ${w}px ${p}.html  +${v.over}px  [${(v.wide||[]).join(', ')}] ${JSON.stringify(v.right||[])}`); }
    else console.log(`ok ${String(w).padStart(4)}px ${p}.html`);
  }
}
console.log(bad ? `\n${bad} halaman overflow` : '\nSemua bersih — tidak ada overflow horizontal.');
ws.close(); chrome.kill();
