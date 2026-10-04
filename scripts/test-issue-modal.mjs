/**
 * Test modal "Terbitkan token" — verifikasi UI sudah rapi.
 * Jalankan: node scripts/test-issue-modal.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9250;
const OUT = process.argv[2] || '/tmp/issue-modal.png';

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-issue-modal',
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
await sleep(3500);

// Buka modal terbitkan token
await evalJs(`document.querySelector('.tab[data-tab="tokens"]').click()`);
await sleep(1500);
await evalJs(`document.querySelector('#issueBtn').click()`);
await sleep(2500);

// Verifikasi struktur modal
const check = await evalJs(`(() => {
  const modal = document.querySelector('.modal');
  if (!modal) return { error: 'modal tidak terbuka' };

  const primary = document.querySelector('#mProject');
  const checks = [...document.querySelectorAll('.proj-check')];
  const visibleChecks = checks.filter(c => !c.classList.contains('is-hidden'));
  const hiddenChecks = checks.filter(c => c.classList.contains('is-hidden'));
  const advToggle = document.querySelector('#mAdvToggle');
  const advBody = document.querySelector('#mAdvBody');

  // Field yang terlihat (untuk mengukur kepadatan)
  const visibleFields = [...modal.querySelectorAll('.field')]
    .filter(f => f.offsetParent !== null && !f.closest('.adv-body'));

  return {
    modalWidth: modal.offsetWidth,
    viewportWidth: window.innerWidth,
    primaryOptions: primary ? [...primary.options].map(o => o.value) : [],
    primarySelected: primary?.value ?? null,
    totalCheckboxes: checks.length,
    visibleCheckboxes: visibleChecks.map(c => c.querySelector('input').value),
    hiddenCheckboxes: hiddenChecks.map(c => c.querySelector('input').value),
    advCollapsed: advBody ? !advBody.classList.contains('is-open') : null,
    advAriaExpanded: advToggle?.getAttribute('aria-expanded'),
    visibleFieldCount: visibleFields.length,
    fieldGroups: [...modal.querySelectorAll('.field-group-label')].map(l => l.textContent.trim()),
    // Apakah proyek utama muncul di daftar akses tambahan?
    primaryDuplicated: visibleChecks.some(c => c.querySelector('input').value === primary?.value),
    overflowX: modal.scrollWidth > modal.clientWidth + 2,
  };
})()`);

console.log('=== MODAL TERBITKAN TOKEN (390px) ===');
console.log(JSON.stringify(check, null, 2));
console.log('');
console.log(check.primaryDuplicated
  ? '❌ proyek utama MASIH tampil di akses tambahan (membingungkan)'
  : '✅ proyek utama tidak duplikat di akses tambahan');
console.log(check.advCollapsed
  ? '✅ pengaturan lanjutan terlipat (modal lebih ringkas)'
  : '⚠️ pengaturan lanjutan terbuka');
console.log(check.overflowX
  ? '❌ ada overflow horizontal'
  : '✅ tidak ada overflow horizontal');
console.log(`ℹ️ ${check.visibleFieldCount} field terlihat, ${check.totalCheckboxes - check.visibleCheckboxes.length} checkbox tersembunyi`);

// Buka pengaturan lanjutan untuk lihat isinya
await evalJs(`document.querySelector('#mAdvToggle').click()`);
await sleep(1000);

const afterExpand = await evalJs(`(() => {
  const advBody = document.querySelector('#mAdvBody');
  const modal = document.querySelector('.modal');
  return {
    advOpen: advBody?.classList.contains('is-open'),
    ariaExpanded: document.querySelector('#mAdvToggle')?.getAttribute('aria-expanded'),
    modalScrollable: modal ? modal.scrollHeight > modal.clientHeight : null,
    modalHeight: modal?.offsetHeight,
    viewportHeight: window.innerHeight,
  };
})()`);

console.log('');
console.log('=== SETELAH BUKA PENGATURAN LANJUTAN ===');
console.log(JSON.stringify(afterExpand, null, 2));
console.log(afterExpand.advOpen ? '✅ panel lanjutan terbuka' : '❌ panel tidak terbuka');
console.log(afterExpand.modalHeight <= afterExpand.viewportHeight
  ? '✅ modal pas di layar (tidak terpotong)'
  : '⚠️ modal lebih tinggi dari layar (bisa di-scroll)');

// Screenshot
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('');
console.log('Screenshot:', OUT);

ws.close();
chrome.kill();
process.exit(0);
