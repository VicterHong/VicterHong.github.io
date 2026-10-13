/**
 * Ukur distribusi ukuran font per halaman (nyata, dari browser).
 *
 * Kenapa: kriteria GOAL "tipografi maks 5 ukuran" belum bisa dinilai tanpa
 * angka. Skrip ini menghitung ukuran font unik yang BENAR-BENAR terpakai di
 * elemen teks (bukan yang dideklarasikan di CSS — banyak aturan tak terpakai).
 *
 * Jalankan: node scripts/ukur-tipografi.mjs [baseUrl]
 * Contoh:   node scripts/ukur-tipografi.mjs http://127.0.0.1:8899
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const BASE = (process.argv[2] || 'http://127.0.0.1:8899').replace(/\/$/, '');
const PORT = 9247;

const HALAMAN = [
  'home.html', 'pricing.html', 'docs.html', 'changelog.html',
  'privasi.html', 'syarat.html', 'keamanan.html', 'sign-in.html',
  'sign-up.html', 'lupa-sandi.html', 'reset-sandi.html', '404.html',
];

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-tipo-profile',
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
function send(method, params = {}) {
  return new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise(r => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');

const ekspresi = `(() => {
  const terlihat = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity) < 0.05) return false;
    return r.width > 0 && r.height > 0;
  };
  const punyaTeks = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    }
    return false;
  };
  const hitung = new Map();  // px -> jumlah elemen
  const contoh = new Map();  // px -> contoh teks
  for (const el of document.querySelectorAll('body *')) {
    if (!terlihat(el) || !punyaTeks(el)) continue;
    const px = getComputedStyle(el).fontSize;
    hitung.set(px, (hitung.get(px) || 0) + 1);
    if (!contoh.has(px)) {
      contoh.set(px, (el.textContent || '').trim().slice(0, 42).replace(/\\s+/g, ' '));
    }
  }
  const arr = [...hitung.entries()].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
  return {
    total: arr.length,
    ukuran: arr.map(([px, n]) => ({ px, n, teks: contoh.get(px) })),
  };
})()`;

console.log(`\nTIPOGRAFI — ukuran font unik yang benar-benar terpakai (1440px)\n`);
const ringkas = [];
for (const h of HALAMAN) {
  await send('Page.navigate', { url: `${BASE}/${h}` });
  await sleep(1400);
  const r = await send('Runtime.evaluate', { expression: ekspresi, returnByValue: true });
  const v = r?.result?.value;
  if (!v) { console.log(`  ${h.padEnd(16)} GAGAL DIUKUR`); continue; }
  ringkas.push({ halaman: h, unik: v.total });
  console.log(`  ${h.padEnd(16)} ${String(v.total).padStart(2)} ukuran unik`);
  for (const u of v.ukuran) {
    console.log(`      ${u.px.padStart(7)}  ×${String(u.n).padStart(3)}  "${u.teks}"`);
  }
  console.log('');
}

console.log('RINGKASAN (terburuk dulu):');
ringkas.sort((a, b) => b.unik - a.unik);
for (const r of ringkas) console.log(`  ${r.halaman.padEnd(16)} ${r.unik}`);
console.log(`\nTarget GOAL: maks 5 ukuran unik per halaman.\n`);

ws.close();
chrome.kill();
process.exit(0);
