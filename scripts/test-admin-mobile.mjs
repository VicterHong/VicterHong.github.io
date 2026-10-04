/**
 * Test tampilan admin panel di ukuran HP.
 * Ambil screenshot + verifikasi tabel bisa dibaca tanpa scroll samping.
 *
 * Jalankan: node scripts/test-admin-mobile.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9240;
const OUT = process.argv[2] || '/tmp/admin-mobile.png';
const TAB = process.argv[3] || 'tokens';

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-admin-mobile',
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
// Ukuran HP: iPhone 12 (390×844) dengan touch
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: 'http://127.0.0.1:8788/admin' });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

// Login
await evalJs(`(() => {
  const i = document.querySelector('input[type=password]');
  i.value = ${JSON.stringify(ADMIN_KEY)};
  document.querySelector('.login-card button').click();
})()`);
await sleep(4000);

// Buka tab yang diminta
await evalJs(`document.querySelector('.tab[data-tab="${TAB}"]').click()`);
await sleep(2500);

// ── Verifikasi perilaku responsif ───────────────────────────────────────────
const check = await evalJs(`(() => {
  const wrap = document.querySelector('#panel-${TAB} .table-wrap') || document.querySelector('.table-wrap');
  const table = wrap?.querySelector('table');
  const firstRow = table?.querySelector('tbody tr');
  const firstTd = firstRow?.querySelector('td');

  const cs = firstTd ? getComputedStyle(firstTd) : null;
  const before = firstTd ? getComputedStyle(firstTd, '::before') : null;

  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    hasTable: !!table,
    // Mode kartu: td jadi block/flex, bukan table-cell
    tdDisplay: cs?.display ?? null,
    isCardMode: cs?.display === 'flex',
    // Label kolom muncul?
    labelContent: before?.content ?? null,
    // Apakah ada overflow horizontal di halaman?
    bodyScrollWidth: document.body.scrollWidth,
    windowWidth: window.innerWidth,
    horizontalOverflow: document.body.scrollWidth > window.innerWidth + 2,
    // Apakah tabel bisa di-scroll (untuk layar lebih besar)?
    wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
    dataLabelCount: document.querySelectorAll('[data-label]').length,
  };
})()`);

console.log('=== TAMPILAN ADMIN DI HP (390px) ===');
console.log(JSON.stringify(check, null, 2));
console.log('');
console.log(check.isCardMode
  ? '✅ MODE KARTU AKTIF — setiap baris jadi kartu, label di kiri'
  : '⚠️ bukan mode kartu — cek CSS');
console.log(check.horizontalOverflow
  ? '❌ ADA OVERFLOW HORIZONTAL — halaman bisa digeser ke samping'
  : '✅ tidak ada overflow horizontal — halaman pas');
console.log(check.labelContent && check.labelContent !== 'none'
  ? `✅ label kolom tampil (contoh: ${check.labelContent})`
  : '⚠️ label kolom tidak terdeteksi');

// Screenshot
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('');
console.log('Screenshot:', OUT);

ws.close();
chrome.kill();
process.exit(0);
