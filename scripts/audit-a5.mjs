/* Audit A5 mendalam — legal (privasi/syarat) + changelog + 404.
   Uji: klik nyata TOC → posisi heading vs header fixed (scroll-margin),
   filter changelog berfungsi, tap target mobile, state kosong.
   Jalankan: node scripts/audit-a5.mjs [baseURL] */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9261;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/chrome-a5audit','about:blank'], {stdio:'ignore'});
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
  const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true, awaitPromise:true});
  if (r.result?.exceptionDetails) return {err: r.result.exceptionDetails.text};
  return r.result?.result?.value;
};

await send('Page.enable');

// ── 1. LEGAL: klik nyata TOC → apakah heading tertutup header fixed? ──
for (const f of ['privasi','syarat']) {
  await send('Emulation.setDeviceMetricsOverride', {width:390, height:844, deviceScaleFactor:1, mobile:true});
  await send('Page.navigate',{url:`${BASE}/${f}.html`});
  await sleep(1800);
  const r = await evalJS(`(async () => {
    const a = document.querySelector('.legal-toc-list a[href="#hak"], .legal-toc-list a');
    if (!a) return 'TOC TIDAK ADA';
    const targetId = a.getAttribute('href').slice(1);
    a.click();
    await new Promise(r => setTimeout(r, 1200));
    const h = document.getElementById(targetId);
    const hdr = document.querySelector('.site-header, header');
    const hRect = h.getBoundingClientRect();
    const hdrRect = hdr ? hdr.getBoundingClientRect() : null;
    const sm = getComputedStyle(h).scrollMarginTop;
    // heading "tertutup" kalau atasnya berada di atas batas bawah header fixed
    const tertutup = hdrRect ? hRect.top < hdrRect.bottom : false;
    return JSON.stringify({
      target: targetId,
      hTop: Math.round(hRect.top), hdrBottom: hdrRect ? Math.round(hdrRect.bottom) : null,
      scrollMarginTop: sm,
      tertutup,
      urlHash: location.hash,
      aktif: !!document.querySelector('.legal-toc-list a.aktif'),
    });
  })()`);
  console.log(`LEGAL ${f} 390px klik TOC:`, r);
  // tap target link TOC
  const r2 = await evalJS(`(() => {
    const links = [...document.querySelectorAll('.legal-toc-list a')];
    const kecil = links.map(a => { const r = a.getBoundingClientRect(); return {t: a.textContent.trim().slice(0,22), w: Math.round(r.width), h: Math.round(r.height)}; })
      .filter(x => x.h < 24);
    return JSON.stringify({jumlah: links.length, kecil: kecil.slice(0,6)});
  })()`);
  console.log(`LEGAL ${f} tap target TOC:`, r2);
}

// ── 2. CHANGELOG: filter nyata ──
await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});
await send('Page.navigate',{url:`${BASE}/changelog.html`});
await sleep(3000);
const r3 = await evalJS(`(async () => {
  const tombol = [...document.querySelectorAll('.cl-filter button, .cl-filter [role=button], #clFilter button')];
  const itemAwal = document.querySelectorAll('.cl-item, #clDaftar li, #clDaftar article').length;
  if (!tombol.length) return JSON.stringify({err:'filter tidak ter-render', itemAwal});
  const nama = tombol.map(b => b.textContent.trim().slice(0,24));
  // klik tombol kedua (biasanya kategori pertama non-"semua")
  const target = tombol[1] || tombol[0];
  target.click();
  await new Promise(r => setTimeout(r, 800));
  const itemSesudah = document.querySelectorAll('.cl-item, #clDaftar li, #clDaftar article').length;
  const aktif = [...document.querySelectorAll('.cl-filter button')].map(b => b.getAttribute('aria-pressed') || (b.classList.contains('is-aktif') ? 'cls' : '')).filter(Boolean);
  const kosongTampil = document.getElementById('clKosong') ? getComputedStyle(document.getElementById('clKosong')).display : 'n/a';
  return JSON.stringify({nama, itemAwal, itemSesudah, targetKlik: target.textContent.trim(), ariaAktif: aktif, kosongDisplay: kosongTampil});
})()`);
console.log('CHANGELOG filter:', r3);

// tap target filter di mobile
await send('Emulation.setDeviceMetricsOverride', {width:390, height:844, deviceScaleFactor:1, mobile:true});
await send('Page.navigate',{url:`${BASE}/changelog.html`});
await sleep(3000);
const r4 = await evalJS(`(() => {
  const tombol = [...document.querySelectorAll('.cl-filter button')];
  const kecil = tombol.map(b => { const r = b.getBoundingClientRect(); return {t: b.textContent.trim().slice(0,20), w: Math.round(r.width), h: Math.round(r.height)}; }).filter(x => x.h < 44);
  const tanggal = document.querySelectorAll('time, .cl-tanggal, [class*=tanggal]').length;
  return JSON.stringify({filter: tombol.length, filterKecil: kecil.slice(0,8), elemenTanggal: tanggal});
})()`);
console.log('CHANGELOG 390px:', r4);

// ── 3. 404: CTA & tap target ──
await send('Page.navigate',{url:`${BASE}/404.html`});
await sleep(1500);
const r5 = await evalJS(`(() => {
  const out = [];
  for (const sel of ['.err-links .btn-primary', '.err-links .btn-ghost']) {
    const el = document.querySelector(sel);
    if (!el) { out.push({sel, missing:true}); continue; }
    const r = el.getBoundingClientRect();
    out.push({sel, w: Math.round(r.width), h: Math.round(r.height), teks: el.textContent.trim()});
  }
  return JSON.stringify(out);
})()`);
console.log('404 CTA 390px:', r5);

ws.close(); chrome.kill();
