/**
 * Uji tata letak grid untuk section "Cara saya bekerja" — DIUKUR.
 *
 * Masalah: 4 item dengan grid `auto-fit minmax(268px, 1fr)` menghasilkan
 * 3 kolom di desktop → layout 3+1, baris kedua kosong 2/3.
 *
 * Referensi Kombai (How it works/Fernwell) memakai `repeat(3, 1fr)` —
 * TAPI mereka punya 3 item, bukan 4. Jumlah item menentukan pilihan.
 *
 * Opsi yang diuji:
 *   A. 2x2 grid (repeat(2, 1fr))
 *   B. 4 kolom satu baris (repeat(4, 1fr))
 *   C. Status quo (auto-fit minmax(268px, 1fr)) = 3+1
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9300;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-grid-test', 'about:blank',
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
    for(let y=0;y<h.scrollHeight;y+=600){h.scrollTop=y;await new Promise(r=>setTimeout(r,130));}
    h.scrollTop=0;h.style.scrollBehavior=a;})()`, awaitPromise: true,
});
await sleep(2000);

const MEASURE = `(() => {
  const grid = document.querySelector('.principles');
  const items = [...document.querySelectorAll('.principle')];
  if (!grid || !items.length) return JSON.stringify({error:'tidak ada'});

  const gr = grid.getBoundingClientRect();
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;

  // Hitung berapa item per baris berdasarkan posisi top
  const tops = [...new Set(items.map(i => Math.round(i.getBoundingClientRect().top)))];
  const perBaris = tops.map(t =>
    items.filter(i => Math.abs(i.getBoundingClientRect().top - t) < 8).length
  );

  const info = items.map(i => {
    const r = i.getBoundingClientRect();
    const p = i.querySelector('p');
    const cs = p ? getComputedStyle(p) : null;
    const lh = cs ? (parseFloat(cs.lineHeight) || 22) : 22;
    return {
      judul: i.querySelector('h3')?.textContent.trim().slice(0, 24),
      tinggi: Math.round(r.height),
      lebar: Math.round(r.width),
      barisTeks: p ? Math.round(p.getBoundingClientRect().height / lh) : 0,
      teksTinggi: p ? Math.round(p.getBoundingClientRect().height) : 0,
    };
  });

  const avgTinggi = Math.round(info.reduce((a, c) => a + c.tinggi, 0) / info.length);
  const avgTeks = Math.round(info.reduce((a, c) => a + c.teksTinggi, 0) / info.length);
  const gridTinggi = Math.round(gr.height);

  return JSON.stringify({
    kolom: cols,
    baris: tops.length,
    perBaris,
    gridTinggi,
    avgTinggiKartu: avgTinggi,
    avgTeksTinggi: avgTeks,
    densitas: Math.round(avgTeks / avgTinggi * 100),
    lebarKartu: info[0].lebar,
    barisTeks: info.map(i => i.barisTeks),
    // Apakah ada baris yang tidak penuh?
    barisTidakPenuh: perBaris.filter(n => n < cols).length,
  });
})()`;

async function ukur(label, css) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      let st = document.getElementById('grid-test');
      if (!st) { st = document.createElement('style'); st.id = 'grid-test'; document.head.appendChild(st); }
      st.textContent = ${JSON.stringify(css)};
    })()`,
  });
  await sleep(700);
  const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const d = JSON.parse(r.result.value);
  if (d.error) { console.log(`  ❌ ${d.error}`); return null; }

  console.log(`  ${label}`);
  console.log(`    kolom          : ${d.kolom}`);
  console.log(`    baris          : ${d.baris} (item per baris: ${d.perBaris.join(' + ')})`);
  console.log(`    baris tak penuh: ${d.barisTidakPenuh} ${d.barisTidakPenuh === 0 ? '✅' : '⚠'}`);
  console.log(`    tinggi grid    : ${d.gridTinggi}px`);
  console.log(`    kartu          : ${d.lebarKartu}px × ${d.avgTinggiKartu}px`);
  console.log(`    baris teks     : ${d.barisTeks.join(', ')}`);
  console.log(`    densitas       : ${d.densitas}%`);
  console.log('');
  return d;
}

console.log('=== UJI TATA LETAK "CARA SAYA BEKERJA" (4 item) ===\n');

const a = await ukur('OPSI A — 2x2 grid', `
  .principles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
`);
const b = await ukur('OPSI B — 4 kolom satu baris', `
  .principles { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
`);
const c = await ukur('OPSI C — status quo (auto-fit 268px)', `
  .principles { grid-template-columns: repeat(auto-fit, minmax(268px, 1fr)) !important; }
`);

console.log('══════ PERBANDINGAN ══════\n');
const opsi = [['A 2x2', a], ['B 4-kolom', b], ['C status quo', c]].filter(x => x[1]);
for (const [nama, d] of opsi) {
  const penuh = d.barisTidakPenuh === 0 ? '✅ penuh' : `⚠ ${d.barisTidakPenuh} baris tak penuh`;
  console.log(`  ${nama.padEnd(14)} ${d.kolom} kolom, ${d.baris} baris, grid ${String(d.gridTinggi).padStart(4)}px, kartu ${d.lebarKartu}px, ${penuh}`);
}

console.log('\n  Yang dicari: baris PENUH (tidak ada ruang kosong menggantung)');
console.log('  dengan tinggi grid yang wajar (tidak memaksa teks jadi 6 baris).');

chrome.kill();
