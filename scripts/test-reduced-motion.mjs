/**
 * Uji prefers-reduced-motion — APAKAH BENAR-BENAR BEKERJA?
 *
 * Audit desain Batch 2 menambahkan penanganan reduced-motion ke
 * scroll-manager.js dan 3 file CSS. Tapi "menambahkan kode" bukan bukti
 * bahwa gerak benar-benar berhenti.
 *
 * Skrip ini mengukur SEBELUM dan SESUDAH emulasi reduced-motion, dengan
 * membandingkan posisi/opasitas elemen yang seharusnya berhenti bergerak.
 *
 * Cara mengukur gerak tanpa mata: ambil snapshot nilai transform pada
 * beberapa posisi scroll, lalu bandingkan. Kalau nilainya SAMA di semua
 * posisi → tidak ada gerak. Kalau BERBEDA → ada gerak.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9250;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-rm-profile',
  'about:blank',
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

/** Ambil snapshot nilai transform/opacity pada beberapa posisi scroll. */
const SNAPSHOT = `(async () => {
  const targets = [
    ['.hero-title', 'judul hero'],
    ['.marquee', 'marquee'],
    ['[data-depth]', 'depth'],
    ['.project', 'kartu proyek'],
    ['.hero-backdrop', 'video latar'],
  ];
  const out = {};
  const positions = [0, 400, 900, 1500];

  for (const [sel, label] of targets) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const samples = [];
    for (const y of positions) {
      window.scrollTo(0, y);
      // Tunggu 2 frame supaya rAF sempat jalan
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cs = getComputedStyle(el);
      samples.push(cs.transform + '|' + cs.opacity);
    }
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out[label] = {
      sampel: samples,
      // Unik = berapa nilai berbeda. 1 = tidak bergerak.
      unik: new Set(samples).size,
      bergerak: new Set(samples).size > 1,
    };
  }
  return JSON.stringify(out);
})()`;

async function measure(reduced) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  });
  await send('Page.navigate', { url: new URL(URL_TARGET).origin });
  await sleep(2000);
  await send('Runtime.evaluate', {
    expression: `try{sessionStorage.setItem('cf_clearance_'+location.hostname,String(Date.now()))}catch(e){}`,
  });
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(5000);
  // Scroll sekali supaya efek reveal terpicu
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, 0)` });
  await sleep(2000);

  const r = await send('Runtime.evaluate', {
    expression: SNAPSHOT, awaitPromise: true, returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

console.log('=== UJI PREFERS-REDUCED-MOTION ===\n');

console.log('── TANPA reduced-motion (gerak harus ADA) ──');
const normal = await measure(false);
for (const [label, d] of Object.entries(normal)) {
  console.log(`  ${label.padEnd(16)} unik=${d.unik} ${d.bergerak ? '✅ bergerak' : '⚠ statis'}`);
}

console.log('\n── DENGAN reduced-motion (gerak harus BERHENTI) ──');
const reduced = await measure(true);
let gagal = 0;
for (const [label, d] of Object.entries(reduced)) {
  const ok = !d.bergerak;
  if (!ok) gagal++;
  console.log(`  ${label.padEnd(16)} unik=${d.unik} ${ok ? '✅ statis' : '❌ MASIH BERGERAK'}`);
}

console.log('\n── KESIMPULAN ──');
const bergerakNormal = Object.values(normal).filter(d => d.bergerak).length;
const bergerakReduced = Object.values(reduced).filter(d => d.bergerak).length;
console.log(`  Elemen bergerak tanpa reduced-motion : ${bergerakNormal}`);
console.log(`  Elemen bergerak dengan reduced-motion: ${bergerakReduced}`);
if (bergerakReduced === 0 && bergerakNormal > 0) {
  console.log('\n  ✅ reduced-motion BEKERJA — semua gerak berhenti');
} else if (bergerakReduced === 0 && bergerakNormal === 0) {
  console.log('\n  ⚠ tidak ada elemen yang bergerak sama sekali — uji tidak membuktikan apa pun');
} else {
  console.log(`\n  ❌ ${bergerakReduced} elemen MASIH bergerak — perlu diperiksa`);
}

chrome.kill();
process.exit(gagal > 0 ? 1 : 0);
