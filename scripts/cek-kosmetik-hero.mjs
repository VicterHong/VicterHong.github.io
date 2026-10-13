/* Verifikasi akhir kosmetik hero:
   1. Kontras ikon .tok (SVG hasil hidrasi icons.js)
   2. Apakah h1 pakai text-wrap balance/pretty
   3. Baris h1 di beberapa lebar layar
   4. Cookie FAB (tombol mengambang) konsisten dark
   Jalankan: node scripts/cek-kosmetik-hero.mjs */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9266;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=/tmp/chrome-kh-${Date.now()}`,'about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());
let t; for (let i=0;i<40;i++){ await sleep(500); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(m,p={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev = async (e) => { const r = await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
await send('Page.enable');

for (const [w,h] of [[1920,1000],[1440,900],[1280,800],[1024,768]]) {
  await send('Emulation.setDeviceMetricsOverride', {width:w, height:h, deviceScaleFactor:1, mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8899/home.html'});
  await sleep(2200);
  const r = await ev(`(()=>{
    const h1 = document.querySelector('h1');
    const c = getComputedStyle(h1);
    return { baris: Math.round(h1.getBoundingClientRect().height / parseFloat(c.lineHeight)),
             wrap: c.textWrap || c.textWrapStyle || '(tidak diset)',
             font: c.fontSize };
  })()`);
  console.log(`${w}px → ${r.baris} baris · text-wrap: ${r.wrap} · font ${r.font}`);
}

/* Kontras ikon .tok (SVG) + FAB */
await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:8899/home.html'});
await sleep(2500);
const detail = await ev(`(()=>{
  const svg = document.querySelector('.tline svg');
  const tokWarna = svg ? getComputedStyle(svg).color : 'tidak ada svg';
  const fab = document.querySelector('.cookie-fab');
  const fabC = fab ? getComputedStyle(fab) : null;
  return {
    tokSvgWarna: tokWarna,
    tokSvgFill: svg ? (svg.getAttribute('fill') || getComputedStyle(svg).fill) : null,
    fab: fabC ? { bg: fabC.backgroundColor, border: fabC.borderColor, warna: fabC.color } : 'tidak ada (belum tampil)'
  };
})()`);
console.log('Detail:', JSON.stringify(detail, null, 1));
ws.close();
