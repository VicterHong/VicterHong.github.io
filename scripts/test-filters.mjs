/**
 * Test SEMUA filter di panel admin — cari yang tidak berfungsi.
 * Jalankan: node scripts/test-filters.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9300;

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-filter-test',
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
const apiCalls = [];
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
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/')) {
    apiCalls.push(m.params.request.url.replace('http://127.0.0.1:8788', ''));
  }
};
await new Promise(r => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});
await send('Page.navigate', { url: 'http://127.0.0.1:8788/admin' });
await sleep(2500);

const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value;

await ev(`(() => { document.querySelector('input[type=password]').value = ${JSON.stringify(ADMIN_KEY)}; document.querySelector('.login-card button').click(); })()`);
await sleep(4000);

// ── Kumpulkan semua elemen filter di seluruh panel ──────────────────────────
const allFilters = await ev(`(() => {
  const selects = [...document.querySelectorAll('select')];
  return selects.map(s => ({
    id: s.id,
    options: [...s.options].map(o => o.value),
    inPanel: s.closest('.panel')?.id ?? 'topbar',
    hasListener: typeof s.onchange === 'function',
  }));
})()`);

console.log('=== SEMUA SELECT/FILTER DI PANEL ===');
allFilters.forEach(f => {
  console.log(`  ${f.id || '(tanpa id)'} [${f.inPanel}] → ${f.options.length} opsi: ${f.options.slice(0, 6).join(', ')}`);
});

// ── Test tiap filter: ubah nilai, lihat apakah request dikirim ──────────────
console.log('');
console.log('=== TEST SETIAP FILTER (apakah mengirim request?) ===');

const results = [];

for (const f of allFilters) {
  if (!f.id) continue;

  // Buka tab yang sesuai supaya filter terlihat & aktif
  const tab = f.inPanel.replace('panel-', '');
  await ev(`(() => { const t = document.querySelector('.tab[data-tab="${tab}"]'); if (t) t.click(); })()`);
  await sleep(600);

  apiCalls.length = 0;

  // Ubah nilai filter ke opsi non-default (kalau ada)
  const changed = await ev(`(() => {
    const sel = document.querySelector('#${f.id}');
    if (!sel) return null;
    if (sel.options.length < 2) return 'hanya 1 opsi';
    const prev = sel.value;
    // Pilih opsi berikutnya (bukan yang sedang aktif)
    const nextIdx = [...sel.options].findIndex(o => o.value !== prev && o.value !== '');
    if (nextIdx < 0) return 'tidak ada opsi lain';
    sel.value = sel.options[nextIdx].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.options[nextIdx].value;
  })()`);

  await sleep(1800);

  const relevant = apiCalls.filter(u => !u.includes('/api/health'));
  results.push({
    filter: f.id,
    changedTo: changed,
    requests: relevant.length,
    sample: relevant.slice(0, 2),
  });
}

console.log('');
for (const r of results) {
  const ok = r.requests > 0;
  const icon = ok ? '✅' : '❌';
  const note = r.changedTo === null ? ' (elemen tidak ditemukan)'
    : r.changedTo === 'hanya 1 opsi' ? ' (hanya 1 opsi — tidak bisa diuji)'
    : r.changedTo === 'tidak ada opsi lain' ? ' (tidak ada opsi lain)'
    : ` → "${r.changedTo}"`;
  console.log(`${icon} ${r.filter}${note} — ${r.requests} request`);
  if (r.sample.length) r.sample.forEach(s => console.log(`     ${s}`));
}

const broken = results.filter(r => r.requests === 0 && typeof r.changedTo === 'string' && r.changedTo !== 'hanya 1 opsi' && r.changedTo !== 'tidak ada opsi lain');
console.log('');
console.log(broken.length
  ? `❌ FILTER BERMASALAH: ${broken.map(b => b.filter).join(', ')}`
  : '✅ Semua filter yang bisa diuji mengirim request');

ws.close();
chrome.kill();
process.exit(0);
