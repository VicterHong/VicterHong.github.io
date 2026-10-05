/**
 * Uji dua tata letak kartu Layanan — DIUKUR, bukan ditebak.
 *
 * Opsi A: ikon di ATAS judul (sekarang)
 * Opsi B: ikon di KIRI, judul+teks di kanan
 *
 * Yang diukur: tinggi kartu, densitas (teks/tinggi), jumlah baris teks,
 * dan apakah ada ruang kosong besar.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9290;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-layout-test', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

let targets;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    if (targets.length) break;
  } catch { /* retry */ }
}

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: new URL(URL_TARGET).origin });
await sleep(2000);
await send('Runtime.evaluate', {
  expression: `try{sessionStorage.setItem('cf_clearance_'+location.hostname,String(Date.now()))}catch(e){}`,
});
await send('Page.navigate', { url: URL_TARGET });
await sleep(6000);
await send('Runtime.evaluate', {
  expression: `(async()=>{const h=document.documentElement;const a=h.style.scrollBehavior;h.style.scrollBehavior='auto';
    for(let y=0;y<h.scrollHeight;y+=600){h.scrollTop=y;await new Promise(r=>setTimeout(r,120));}
    h.scrollTop=0;h.style.scrollBehavior=a;})()`, awaitPromise: true,
});
await sleep(2000);

const MEASURE = `(() => {
  const cards = [...document.querySelectorAll('.service-card')];
  if (!cards.length) return JSON.stringify({error:'kartu tidak ada'});
  const out = cards.map(c => {
    const rect = c.getBoundingClientRect();
    const icon = c.querySelector('.service-icon');
    const h3 = c.querySelector('h3');
    const p = c.querySelector('p');
    const ir = icon?.getBoundingClientRect();
    const hr = h3?.getBoundingClientRect();
    const pr = p?.getBoundingClientRect();
    return {
      judul: h3?.textContent.trim().slice(0, 22),
      kartuTinggi: Math.round(rect.height),
      kartuLebar: Math.round(rect.width),
      iconTop: ir ? Math.round(ir.top - rect.top) : null,
      iconLeft: ir ? Math.round(ir.left - rect.left) : null,
      judulTop: hr ? Math.round(hr.top - rect.top) : null,
      judulLebar: hr ? Math.round(hr.width) : null,
      teksTinggi: pr ? Math.round(pr.height) : 0,
      teksLebar: pr ? Math.round(pr.width) : 0,
      // Ruang kosong di bawah teks
      sisaBawah: pr ? Math.round(rect.bottom - pr.bottom) : 0,
    };
  });
  return JSON.stringify(out);
})()`;

async function ukur(label, css) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      let st = document.getElementById('layout-test');
      if (!st) { st = document.createElement('style'); st.id = 'layout-test'; document.head.appendChild(st); }
      st.textContent = ${JSON.stringify(css)};
    })()`,
  });
  await sleep(600);
  const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const d = JSON.parse(r.result.value);
  if (d.error) { console.log(`  ❌ ${d.error}`); return; }

  const avgTinggi = Math.round(d.reduce((a, c) => a + c.kartuTinggi, 0) / d.length);
  const avgTeks = Math.round(d.reduce((a, c) => a + c.teksTinggi, 0) / d.length);
  const densitas = Math.round(avgTeks / avgTinggi * 100);
  const sisaBawah = Math.round(d.reduce((a, c) => a + c.sisaBawah, 0) / d.length);

  console.log(`  ${label}`);
  console.log(`    tinggi kartu : ${avgTinggi}px`);
  console.log(`    tinggi teks  : ${avgTeks}px`);
  console.log(`    densitas     : ${densitas}%`);
  console.log(`    sisa bawah   : ${sisaBawah}px (padding)`);
  console.log(`    lebar teks   : ${d[0].teksLebar}px`);
  console.log(`    ikon         : top=${d[0].iconTop} left=${d[0].iconLeft}`);
  console.log('');
  return { avgTinggi, densitas, sisaBawah };
}

console.log('=== UJI TATA LETAK KARTU LAYANAN ===\n');

// A: ikon di atas (sekarang)
const a = await ukur('OPSI A — ikon di atas judul (sekarang)', `
  .service-icon { margin-bottom: 1rem; }
`);

// B: ikon di kiri, sejajar judul
const b = await ukur('OPSI B — ikon di kiri, judul+teks di kanan', `
  .service-card {
    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: 1rem;
    align-items: start;
  }
  .service-icon { margin-bottom: 0; grid-row: span 2; }
  .service-card h3 { grid-column: 2; }
  .service-card p { grid-column: 2; }
`);

// C: ikon di kiri + judul sejajar tengah ikon
const c = await ukur('OPSI C — ikon di kiri, judul sejajar tengah ikon', `
  .service-card {
    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: 1rem;
    align-items: start;
  }
  .service-icon { margin-bottom: 0; grid-row: span 2; align-self: center; }
  .service-card h3 { grid-column: 2; }
  .service-card p { grid-column: 2; }
`);

console.log('══════ PERBANDINGAN ══════\n');
console.log(`  A (ikon atas) : ${a.avgTinggi}px, densitas ${a.densitas}%`);
console.log(`  B (ikon kiri) : ${b.avgTinggi}px, densitas ${b.densitas}%`);
console.log(`  C (ikon tengah): ${c.avgTinggi}px, densitas ${c.densitas}%`);
console.log('');
const terbaik = [['A', a], ['B', b], ['C', c]].sort((x, y) => y[1].densitas - x[1].densitas)[0];
console.log(`  Densitas tertinggi: Opsi ${terbaik[0]} (${terbaik[1].densitas}%)`);
console.log('');
console.log('  CATATAN: densitas tinggi belum tentu lebih baik — kartu yang');
console.log('  terlalu padat terasa sesak. Yang dicari: ruang kosong yang');
console.log('  TIDAK mengganggu, bukan angka densitas tertinggi.');

chrome.kill();
