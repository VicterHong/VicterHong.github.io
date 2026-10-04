/**
 * Test halaman panduan (/docs) — verifikasi fungsional & visual.
 * Jalankan: node scripts/test-docs-page.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9450;
const URL = process.argv[2] || 'https://portfolio-victer.pages.dev/docs';
const OUT = process.argv[3] || '/tmp/docs-page.png';
const WIDTH = parseInt(process.argv[4] || '1440', 10);

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-docs-${Date.now()}`,
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
const exceptions = [];
const consoleErrors = [];

function send(method, params = {}) {
  return new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map(a => a.value ?? '').join(' ').slice(0, 150));
  }
};
await new Promise(r => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 700,
});

await send('Page.navigate', { url: URL });
await sleep(4000);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

// ── Verifikasi struktur ─────────────────────────────────────────────────────
const structure = await ev(`(() => {
  const tocLinks = document.querySelectorAll('.toc-link');
  const sections = document.querySelectorAll('.doc-section');
  const codeBlocks = document.querySelectorAll('.code-block');
  const tables = document.querySelectorAll('.doc-table');
  const steps = document.querySelectorAll('.step');
  const notes = document.querySelectorAll('.note');

  return JSON.stringify({
    title: document.title,
    h1: document.querySelector('.docs-head h1')?.textContent?.trim(),
    tocCount: tocLinks.length,
    tocSample: [...tocLinks].slice(0, 5).map(l => l.textContent.trim()),
    sectionCount: sections.length,
    sectionIds: [...sections].map(s => s.id),
    codeBlocks: codeBlocks.length,
    tables: tables.length,
    steps: steps.length,
    notes: notes.length,
    hasSearch: !!document.querySelector('#docSearch'),
    horizontalOverflow: document.body.scrollWidth > window.innerWidth + 2,
  });
})()`);

const s = JSON.parse(structure);
console.log('=== STRUKTUR HALAMAN PANDUAN ===');
console.log(`Judul     : ${s.title}`);
console.log(`H1        : ${s.h1}`);
console.log(`Daftar isi: ${s.tocCount} link`);
console.log(`  Contoh  : ${s.tocSample.join(' | ')}`);
console.log(`Bagian    : ${s.sectionCount} → ${s.sectionIds.join(', ')}`);
console.log(`Blok kode : ${s.codeBlocks}`);
console.log(`Tabel     : ${s.tables}`);
console.log(`Langkah   : ${s.steps}`);
console.log(`Catatan   : ${s.notes}`);
console.log(`Pencarian : ${s.hasSearch ? 'ada' : 'TIDAK ADA'}`);
console.log('');
console.log(s.tocCount >= 10 ? '✅ Daftar isi terisi otomatis' : '❌ Daftar isi kosong');
console.log(s.sectionCount === 6 ? '✅ 6 bagian lengkap' : `⚠️ ${s.sectionCount} bagian (harap 6)`);
console.log(!s.horizontalOverflow ? '✅ Tidak ada overflow horizontal' : '❌ Ada overflow');

// ── Test pencarian ──────────────────────────────────────────────────────────
console.log('');
console.log('=== TEST PENCARIAN ===');

const searchTest = await ev(`(async () => {
  const input = document.querySelector('#docSearch');
  if (!input) return JSON.stringify({ error: 'input tidak ada' });

  const visibleBefore = [...document.querySelectorAll('.doc-section')]
    .filter(s => !s.classList.contains('is-hidden')).length;

  // Cari "token"
  input.value = 'token';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const visibleAfter = [...document.querySelectorAll('.doc-section')]
    .filter(s => !s.classList.contains('is-hidden')).length;

  // Cari sesuatu yang tidak ada
  input.value = 'zzzz tidak ada xyz';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const visibleNone = [...document.querySelectorAll('.doc-section')]
    .filter(s => !s.classList.contains('is-hidden')).length;
  const emptyShown = !document.querySelector('#docEmpty')?.classList.contains('hidden');

  // Bersihkan
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  const visibleCleared = [...document.querySelectorAll('.doc-section')]
    .filter(s => !s.classList.contains('is-hidden')).length;

  return JSON.stringify({ visibleBefore, visibleAfter, visibleNone, emptyShown, visibleCleared });
})()`);

const st = JSON.parse(searchTest);
console.log(`Sebelum cari     : ${st.visibleBefore} bagian terlihat`);
console.log(`Cari "token"     : ${st.visibleAfter} bagian cocok`);
console.log(`Cari "zzz xyz"   : ${st.visibleNone} bagian + pesan kosong ${st.emptyShown ? 'tampil' : 'TIDAK tampil'}`);
console.log(`Setelah dibersihkan: ${st.visibleCleared} bagian`);
console.log('');
console.log(st.visibleAfter > 0 && st.visibleAfter < st.visibleBefore ? '✅ Pencarian menyaring dengan benar' : '❌ Pencarian tidak bekerja');
console.log(st.visibleNone === 0 && st.emptyShown ? '✅ Pesan "tidak ada hasil" muncul' : '❌ Pesan kosong bermasalah');
console.log(st.visibleCleared === st.visibleBefore ? '✅ Pembersihan mengembalikan semua' : '❌ Pembersihan gagal');

// ── Test tombol salin ───────────────────────────────────────────────────────
console.log('');
console.log('=== TOMBOL SALIN ===');
const copyTest = await ev(`(() => {
  const btns = document.querySelectorAll('.copy-btn');
  return JSON.stringify({
    count: btns.length,
    firstLabel: btns[0]?.textContent?.trim(),
    hasCode: !!btns[0]?.parentElement?.querySelector('code'),
  });
})()`);
const ct = JSON.parse(copyTest);
console.log(`Tombol salin: ${ct.count}, label: "${ct.firstLabel}", ada kode: ${ct.hasCode ? 'ya' : 'tidak'}`);
console.log(ct.count > 0 ? '✅ Tombol salin tersedia di blok kode' : '⚠️ tidak ada tombol salin');

// ── Test tautan ─────────────────────────────────────────────────────────────
const links = await ev(`(() => {
  const nav = [...document.querySelectorAll('.site-nav a')].map(a => a.textContent.trim());
  const tocWorking = [...document.querySelectorAll('.toc-link')].every(l => {
    const id = l.getAttribute('href').slice(1);
    return !!document.getElementById(id);
  });
  return JSON.stringify({ nav, tocWorking });
})()`);
const lk = JSON.parse(links);
console.log('');
console.log('=== TAUTAN ===');
console.log(`Navigasi: ${lk.nav.join(' | ')}`);
console.log(lk.tocWorking ? '✅ Semua link daftar isi menunjuk ke bagian yang ada' : '❌ Ada link daftar isi rusak');

// ── Screenshot ──────────────────────────────────────────────────────────────
await ev(`window.scrollTo(0, 0)`);
await sleep(800);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

console.log('');
console.log('=== KESEHATAN ===');
console.log(`JS exceptions : ${exceptions.length}${exceptions.length ? ' — ' + exceptions[0] : ''}`);
console.log(`Console errors: ${consoleErrors.length}${consoleErrors.length ? ' — ' + consoleErrors[0] : ''}`);
console.log('');
console.log('Screenshot:', OUT);

ws.close();
chrome.kill();
process.exit(0);
