/* Audit A6 — halaman auth (sign-in/sign-up/lupa-sandi/reset-sandi).
   Uji: tap target kontrol, urutan tab (focus order), autofocus, state galat
   (submit kosong), kontras teks kunci. TIDAK mengubah apa pun.
   Jalankan: node scripts/audit-a6.mjs [baseURL] */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9264;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-a6audit','about:blank'], {stdio:'ignore'});
process.on('exit', () => chrome.kill());

let t;
for (let i=0;i<25;i++){ await sleep(400); try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} }
const page = t.find(x=>x.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.on('open',r));
let id=0; const pend={};
ws.on('message', d=>{ const m=JSON.parse(d); if(pend[m.id]){pend[m.id](m); delete pend[m.id];} });
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  if (r.result?.exceptionDetails) return {err: r.result.exceptionDetails.text};
  return r.result?.result?.value;
};

await send('Page.enable');

const PAGES = ['sign-in','sign-up','lupa-sandi','reset-sandi'];
for (const f of PAGES) {
  for (const w of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<500});
    await send('Page.navigate',{url:`${BASE}/${f}.html`});
    await sleep(1800);
    const r = await evalJS(`(() => {
      const out = {tapKecil: [], autofocus: null, urutanTab: [], adaGalat: false};
      // tap target semua kontrol interaktif
      for (const el of document.querySelectorAll('button, a, input, [tabindex]')) {
        const rc = el.getBoundingClientRect();
        if (rc.width === 0 || rc.height === 0) continue;
        if (rc.height < 24 || rc.width < 24) {
          out.tapKecil.push({tag: el.tagName, cls: (el.className||'').toString().split(' ')[0], id: el.id,
            w: Math.round(rc.width), h: Math.round(rc.height), teks: (el.textContent||el.getAttribute('aria-label')||el.type||'').trim().slice(0,24)});
        }
      }
      out.tapKecil = out.tapKecil.slice(0, 10);
      // autofocus
      const af = document.querySelector('[autofocus]');
      out.autofocus = af ? (af.id || af.name || af.type) : 'TIDAK ADA';
      out.fokusAktif = document.activeElement ? (document.activeElement.id || document.activeElement.name || document.activeElement.tagName) : null;
      // urutan tab: elemen fokusable berurutan di DOM
      const foc = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => { const rc = el.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && !el.disabled; });
      out.urutanTab = foc.slice(0, 10).map(el => (el.id || el.name || el.type || el.tagName) + (el.tabIndex !== 0 ? '(tab' + el.tabIndex + ')' : ''));
      return JSON.stringify(out);
    })()`);
    console.log(`A6 ${f} ${w}px:`, r);
  }
}

// state galat: submit form kosong di sign-in
await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:`${BASE}/sign-in.html`});
await sleep(2000);
const r2 = await evalJS(`(async () => {
  const form = document.querySelector('form');
  if (!form) return 'form TIDAK ADA';
  const btn = form.querySelector('button[type=submit], button:not([type])');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 1500));
  const galat = document.querySelectorAll('[role=alert], .auth-galat, .auth-error, [aria-live]');
  const pesan = [...galat].map(g => (g.textContent||'').trim().slice(0,60)).filter(Boolean);
  const inputInvalid = [...document.querySelectorAll('input[aria-invalid=true], input.is-galat, .auth-input-wrap.is-galat')].length;
  return JSON.stringify({jumlahGalat: galat.length, pesan: pesan.slice(0,3), inputInvalid});
})()`);
console.log('A6 sign-in submit kosong:', r2);

// kontras: label & link kunci
const r3 = await evalJS(`(() => {
  function lum(c){ const s=c.match(/\\d+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2]; }
  function rasio(a,b){ const l1=lum(a),l2=lum(b); return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2); }
  const out = [];
  for (const sel of ['.auth-label', '.auth-lupa', '.auth-kecil', 'label', '.auth-link']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const bg = getComputedStyle(document.body).backgroundColor;
    out.push({sel, color: cs.color, bg, rasio: rasio(cs.color, bg), size: cs.fontSize});
  }
  return JSON.stringify(out);
})()`);
console.log('A6 kontras:', r3);

ws.close(); chrome.kill();
