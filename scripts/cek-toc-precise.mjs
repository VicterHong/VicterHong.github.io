import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9262;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-tocprec','about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());
let t;
for (let i=0;i<25;i++){ await sleep(400); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const page = t.find(x=>x.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const evalJS = async (expr) => { const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); return r.result?.result?.value; };
await send('Page.enable');

for (const [w,label] of [[390,'mobile'],[1440,'desktop']]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<500});
  await send('Page.navigate',{url:'http://127.0.0.1:8899/privasi.html'});
  await sleep(1800);
  const r = await evalJS(`(async () => {
    const toc = document.querySelector('.legal-toc');
    const tocVisible = toc ? getComputedStyle(toc).display !== 'none' : false;
    const a = document.querySelector('.legal-toc-list a[href="#hak"]');
    if (!a) return 'no link';
    a.click();
    await new Promise(r => setTimeout(r, 1300));
    const h = document.getElementById('hak');
    const hdr = document.querySelector('.site-header') || document.querySelector('header');
    const hTop = h.getBoundingClientRect().top;
    const hdrB = hdr ? hdr.getBoundingClientRect().bottom : 0;
    return JSON.stringify({tocVisible, hTop: hTop.toFixed(2), hdrBottom: hdrB.toFixed(2),
      selisih: (hTop - hdrB).toFixed(2), hash: location.hash,
      aktif: (document.querySelector('.legal-toc-list a.aktif')||{}).textContent});
  })()`);
  console.log(`${label} ${w}px:`, r);
}
ws.close(); chrome.kill();
