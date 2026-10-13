/* Audit aksesibilitas dengan axe-core (standar industri WCAG 2.1/2.2) via CDP.
   Menggantikan heuristik buatan sendiri — axe adalah alat yang sama dipakai
   Lighthouse & Deque; hasilnya bisa dipercaya dan bisa dibandingkan.

   Tag yang dijalankan: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa
   + best-practice (dipisah agar bisa dinilai terpisah).

   Jalankan: node scripts/audit-a11y.mjs [baseURL] */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const HAL = ['home.html','docs.html','pricing.html','changelog.html','privasi.html','syarat.html','keamanan.html','sign-in.html','sign-up.html','404.html'];
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9262;
const chrome = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,`--user-data-dir=/tmp/chrome-a11y-${Date.now()}`,'about:blank'], {stdio:'ignore'});
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
  if (r.result?.exceptionDetails) return {__exc: r.result.exceptionDetails.text};
  return r.result?.result?.value;
};
await send('Page.enable');
/* 1440px: nav mobile tersembunyi <900px → temuan palsu bila diukur kecil. */
await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});

let totalPelanggaran = 0, totalSerius = 0;
const ringkasan = [];

for (const hal of HAL) {
  await send('Page.navigate',{url:`${BASE}/${hal}`});
  await sleep(1200);
  /* Gulir bertahap: IntersectionObserver (app.js) menandai [data-reveal]
     .is-visible saat masuk viewport. Tanpa gulir, paragraf bawah tetap
     opacity<1 → axe salah baca sebagai kontras gagal (artefak tes). */
  await evalJS(`(async()=>{
    const H = document.body.scrollHeight;
    for (let y=0; y<H; y+=400){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,90)); }
    window.scrollTo(0,0);
    await new Promise(r=>setTimeout(r,900));
  })()`);
  await sleep(800);                        // beri waktu transisi 720ms selesai
  await evalJS(AXE);                       // suntik axe ke halaman
  const hasil = await evalJS(`(async()=>{
    const r = await axe.run(document, {
      runOnly: { type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] },
      resultTypes: ['violations']
    });
    return r.violations.map(v => ({
      id: v.id, impact: v.impact, help: v.help,
      n: v.nodes.length,
      contoh: v.nodes.slice(0,3).map(n => (n.target||[]).join(' ') + (n.failureSummary ? ' — ' + n.failureSummary.split('\\n').slice(0,2).join(' ') : ''))
    }));
  })()`);

  if (hasil?.__exc) { console.log(`⚠ ${hal}: AXE ERROR — ${hasil.__exc}`); continue; }
  if (!Array.isArray(hasil)) { console.log(`⚠ ${hal}: hasil tak terduga`); continue; }

  const serius = hasil.filter(v => ['critical','serious'].includes(v.impact));
  totalPelanggaran += hasil.length;
  totalSerius += serius.length;
  ringkasan.push({ hal, total: hasil.length, serius: serius.length });

  if (!hasil.length) { console.log(`✓ ${hal} — bersih`); continue; }
  console.log(`\n══ ${hal} — ${hasil.length} pelanggaran (${serius.length} critical/serious) ══`);
  for (const v of hasil) {
    console.log(`  [${(v.impact||'?').toUpperCase()}] ${v.id} ×${v.n} — ${v.help}`);
    v.contoh.forEach(c => console.log(`      · ${c.slice(0,160)}`));
  }
}

console.log('\n── RINGKASAN ──');
for (const r of ringkasan) console.log(`  ${r.hal.padEnd(16)} ${String(r.total).padStart(2)} pelanggaran (${r.serius} critical/serious)`);
console.log(`\nTOTAL: ${totalPelanggaran} pelanggaran di ${HAL.length} halaman · ${totalSerius} critical/serious`);
console.log(totalPelanggaran === 0 ? '✅ BERSIH' : '❌ Perlu perbaikan');
ws.close();
