/* Screenshot hero + cookie banner untuk audit kosmetik.
   Jalankan: node scripts/shot-hero.mjs */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8899';
const OUT = '/tmp/hero-shots';
mkdirSync(OUT, { recursive: true });
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9263;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=/tmp/chrome-shot-${Date.now()}`,'about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());

let t;
for (let i=0;i<40;i++){ await sleep(500); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(m,p={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (r.result?.exceptionDetails) return 'EXC: ' + r.result.exceptionDetails.text;
  return r.result?.result?.value;
};
const shot = async (nama) => {
  const r = await send('Page.captureScreenshot', {format:'png'});
  const p = `${OUT}/${nama}.png`;
  writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log(`  📸 ${p}`);
  return p;
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});

/* 1. Hero desktop (banner cookie disembunyikan dulu — mau lihat hero polos) */
await send('Page.navigate',{url:`${BASE}/home.html`});
await sleep(2500);
await evalJS(`localStorage.setItem('cookie-consent-v1', JSON.stringify({keputusan:'terima', waktu:Date.now()})); document.querySelector('.cookie-banner')?.remove();`);
await sleep(300);
await shot('1-hero-1440');

/* 2. Cookie banner tampil */
await evalJS(`localStorage.removeItem('cookie-consent-v1'); location.reload();`);
await sleep(3000);
await shot('2-cookie-1440');

/* 3. Zoom terminal */
await evalJS(`(()=>{const t=document.querySelector('.terminal'); if(!t) return 'TIDAK ADA';
  const r=t.getBoundingClientRect(); window.scrollTo(0, r.top-60); return 'ok';})()`);
await sleep(600);
await shot('3-terminal-zoom');

/* 4. Hero mobile 390px */
await send('Emulation.setDeviceMetricsOverride', {width:390, height:844, deviceScaleFactor:1, mobile:true});
await send('Page.navigate',{url:`${BASE}/home.html`});
await sleep(2500);
await evalJS(`localStorage.setItem('cookie-consent-v1', JSON.stringify({keputusan:'terima', waktu:Date.now()})); document.querySelector('.cookie-banner')?.remove();`);
await sleep(300);
await shot('4-hero-390');

/* Ukur beberapa angka objektif untuk laporan */
const ukur = await evalJS(`(()=>{
  const g = s => document.querySelector(s);
  const cs = e => e ? getComputedStyle(e) : null;
  const h1 = g('h1');
  return {
    h1Baris: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(cs(h1).lineHeight)) : null,
    h1Font: cs(h1)?.fontSize, h1Line: cs(h1)?.lineHeight,
    tdim: cs(g('.tline.tdim'))?.color,
    tcmd: cs(g('.tcmd'))?.color,
    tok: cs(g('.tok'))?.color,
    terminalBg: cs(g('.terminal'))?.backgroundColor
  };
})()`);
console.log('Ukuran:', JSON.stringify(ukur, null, 1));
ws.close();
