import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9263;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-fcs','about:blank'], {stdio:'ignore'});
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
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:'http://127.0.0.1:8899/changelog.html'});
await sleep(3000);
const r = await evalJS(`(() => {
  const b = document.querySelector('.cl-filter-item');
  if (!b) return 'tidak ada';
  const cs = getComputedStyle(b);
  const rect = b.getBoundingClientRect();
  return JSON.stringify({
    rectH: rect.height,
    minHeight: cs.minHeight, height: cs.height,
    padding: cs.padding, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
    display: cs.display, boxSizing: cs.boxSizing,
    cssRules: (() => { const out=[]; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) { if (r.selectorText && r.selectorText.includes('cl-filter-item') && r.style.minHeight) out.push(sh.href.split('/').pop()+': '+r.style.minHeight); } } catch {} } return out; })(),
  });
})()`);
console.log(r);
ws.close(); chrome.kill();
