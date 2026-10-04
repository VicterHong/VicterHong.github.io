/**
 * Test panel admin dengan headless Chrome.
 * Masuk dengan kunci admin, klik semua tab, laporkan hasilnya.
 *
 * Jalankan: node scripts/test-admin-panel.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9230;

// Baca kunci admin dari berkas env service.
const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!ADMIN_KEY) {
  console.error('ADMIN_KEY tidak ditemukan di service.env');
  process.exit(1);
}

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-admin-test',
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
const consoleErrors = [];
const exceptions = [];

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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 250));
  }
};

await new Promise(r => { ws.onopen = r; });
await send('Page.enable');
await send('Runtime.enable');

// Buka panel admin (loopback).
await send('Page.navigate', { url: 'http://127.0.0.1:8788/admin' });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

// Masuk dengan kunci admin.
const loginState = await evalJs(`(() => {
  const input = document.querySelector('#keyInput, input[type=password]');
  const btn = document.querySelector('#loginBtn, .login-card button');
  if (!input || !btn) return 'form tidak ditemukan';
  input.value = ${JSON.stringify(ADMIN_KEY)};
  btn.click();
  return 'login dikirim';
})()`);
console.log('Login:', loginState);

await sleep(4000);

// Cek semua tab.
const tabResults = await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.tab')];
  return tabs.map(t => ({
    tab: t.dataset.tab,
    label: t.textContent.trim(),
    panelExists: !!document.querySelector('#panel-' + t.dataset.tab),
  }));
})()`);

console.log('\n=== TAB DI PANEL ADMIN ===');
for (const t of tabResults) {
  console.log(`  ${t.panelExists ? '✓' : '✗'} ${t.tab.padEnd(10)} — ${t.label}`);
}

// Klik tiap tab dan lihat apakah kontennya terisi.
console.log('\n=== ISI TAB (setelah diklik) ===');
for (const t of tabResults) {
  await evalJs(`document.querySelector('.tab[data-tab="${t.tab}"]').click()`);
  await sleep(1200);
  const content = await evalJs(`(() => {
    const p = document.querySelector('#panel-${t.tab}');
    if (!p) return null;
    const rows = p.querySelectorAll('table tbody tr').length;
    const text = (p.innerText || '').trim().slice(0, 80).replace(/\\n/g, ' | ');
    const hasError = p.innerHTML.includes('Gagal memuat') || p.innerHTML.includes('var(--err)');
    return { rows, preview: text, hasError };
  })()`);
  const status = content?.hasError ? '⚠ ADA ERROR' : '✓';
  console.log(`  ${status} ${t.tab.padEnd(10)} — ${content?.rows ?? 0} baris tabel — ${content?.preview ?? '(kosong)'}`);
}

console.log('\n=== CONSOLE ERRORS ===');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(bersih)');
console.log('\n=== JS EXCEPTIONS ===');
console.log(exceptions.length ? exceptions.join('\n') : '(bersih)');

ws.close();
chrome.kill();
process.exit(0);
