/**
 * Test tombol "Muat ulang" — verifikasi feedback visual.
 * Jalankan: node scripts/test-refresh-button.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9290;
const OUT = process.argv[2] || '/tmp/refresh-test.png';

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-refresh-test',
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
const apiRequests = [];
const consoleMsgs = [];
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
    apiRequests.push(m.params.request.url.replace('http://127.0.0.1:8788', ''));
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleMsgs.push({
      type: m.params.type,
      text: m.params.args.map(a => a.value ?? '').join(' ').slice(0, 150),
    });
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

// ── Test 1: klik dan periksa state SEGERA (harus loading) ────────────────────
apiRequests.length = 0;
await ev(`document.querySelector('#refreshBtn').click()`);

// Cek state tepat setelah klik (dalam ~100ms)
await sleep(120);
const loadingState = await ev(`(() => {
  const btn = document.querySelector('#refreshBtn');
  return {
    disabled: btn.disabled,
    text: btn.textContent.trim(),
    isLoading: btn.classList.contains('is-loading'),
    cursor: getComputedStyle(btn).cursor,
  };
})()`);

console.log('=== STATE SAAT MEMUAT (100ms setelah klik) ===');
console.log(JSON.stringify(loadingState, null, 2));
console.log(loadingState.disabled && loadingState.text.includes('Memuat')
  ? '✅ Tombol menunjukkan status "Memuat…" dan terkunci'
  : '❌ Tidak ada indikator memuat');

// ── Test 2: tunggu selesai, cek state akhir ──────────────────────────────────
await sleep(5000);
const doneState = await ev(`(() => {
  const btn = document.querySelector('#refreshBtn');
  const toast = document.querySelector('.toast');
  return {
    disabled: btn.disabled,
    text: btn.textContent.trim(),
    isLoading: btn.classList.contains('is-loading'),
    toastVisible: !!toast,
    toastText: toast?.textContent?.trim() ?? null,
  };
})()`);

console.log('');
console.log('=== STATE SETELAH SELESAI ===');
console.log(JSON.stringify(doneState, null, 2));
console.log(!doneState.disabled && doneState.text.includes('Muat ulang')
  ? '✅ Tombol kembali normal'
  : '❌ Tombol tidak kembali ke state normal');
console.log(doneState.toastVisible
  ? `✅ Notifikasi muncul: "${doneState.toastText}"`
  : '⚠️ Tidak ada notifikasi');

console.log('');
console.log('=== REQUEST TERKIRIM ===');
console.log(`${apiRequests.length} request API`);
apiRequests.slice(0, 14).forEach(u => console.log('  ' + u));

console.log('');
console.log('=== CONSOLE WARNINGS (panel gagal) ===');
const warns = consoleMsgs.filter(m => m.text.includes('gagal'));
console.log(warns.length ? warns.map(w => w.text).join('\n') : '(tidak ada panel yang gagal)');

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('');
console.log('Screenshot:', OUT);

ws.close();
chrome.kill();
process.exit(0);
