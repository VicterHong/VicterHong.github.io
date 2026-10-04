/**
 * Test modal pencabutan token — verifikasi UI profesional.
 * Jalankan: node scripts/test-revoke-modal.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9270;
const OUT = process.argv[2] || '/tmp/revoke-modal.png';

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-revoke-test',
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

const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value;

// Login
await ev(`(() => { document.querySelector('input[type=password]').value = ${JSON.stringify(ADMIN_KEY)}; document.querySelector('.login-card button').click(); })()`);
await sleep(3500);

// Buka tab token
await ev(`document.querySelector('.tab[data-tab="tokens"]').click()`);
await sleep(2000);

// Cari token aktif dan klik Cabut
const clicked = await ev(`(() => {
  const btn = document.querySelector('[data-revoke]');
  if (!btn) return 'tidak ada token aktif';
  btn.click();
  return 'modal dibuka';
})()`);
console.log('Aksi:', clicked);
await sleep(2000);

// Verifikasi modal
const check = await ev(`(() => {
  const modal = document.querySelector('.modal-sm');
  if (!modal) return { error: 'modal tidak terbuka' };

  const chips = [...modal.querySelectorAll('.reason-chip')];
  const confirmBtn = modal.querySelector('#rvConfirm');
  const warning = modal.querySelector('.revoke-warning');
  const target = modal.querySelector('.revoke-target');
  const rows = [...modal.querySelectorAll('.revoke-row')];

  // Apakah prompt() bawaan masih muncul? (tidak boleh)
  const isNativeDialog = !modal;

  return {
    modalOpened: !!modal,
    title: modal.querySelector('h2')?.textContent?.trim(),
    contextRows: rows.map(r => r.querySelector('.revoke-key')?.textContent?.trim()),
    contextValues: rows.map(r => r.querySelector('.revoke-val')?.textContent?.trim()),
    reasonChipCount: chips.length,
    reasonLabels: chips.map(c => c.textContent.trim()),
    confirmDisabledInitially: confirmBtn?.disabled,
    confirmLabel: confirmBtn?.textContent?.trim(),
    confirmIsDanger: confirmBtn?.classList.contains('danger'),
    warningText: warning?.textContent?.trim().slice(0, 80),
    // Ukuran target sentuh
    chipHeights: chips.map(c => Math.round(c.getBoundingClientRect().height)),
  };
})()`);

console.log('');
console.log('=== MODAL PENCABUTAN ===');
console.log(JSON.stringify(check, null, 2));
console.log('');
console.log(check.modalOpened ? '✅ modal profesional (bukan prompt bawaan)' : '❌ modal tidak muncul');
console.log(check.confirmDisabledInitially ? '✅ tombol konfirmasi terkunci sampai alasan dipilih' : '⚠️ tombol aktif dari awal');
console.log(check.confirmIsDanger ? '✅ tombol konfirmasi berwarna merah (destruktif)' : '⚠️ bukan warna destruktif');
console.log(check.warningText?.includes('tidak bisa dibatalkan') ? '✅ peringatan tegas ada' : '⚠️ peringatan tidak ada');
console.log(`ℹ️ ${check.reasonChipCount} chip alasan, tinggi: ${check.chipHeights?.join(', ')}px`);

// Uji interaksi: pilih chip "Kontrak selesai"
await ev(`document.querySelector('.reason-chip[data-reason="kontrak-selesai"]').click()`);
await sleep(800);

const afterChip = await ev(`(() => {
  const confirmBtn = document.querySelector('#rvConfirm');
  const active = document.querySelector('.reason-chip.is-active');
  return {
    activeChip: active?.textContent?.trim(),
    confirmEnabled: !confirmBtn?.disabled,
  };
})()`);

console.log('');
console.log('=== SETELAH PILIH ALASAN ===');
console.log(JSON.stringify(afterChip, null, 2));
console.log(afterChip.confirmEnabled ? '✅ tombol konfirmasi menyala setelah alasan dipilih' : '❌ tombol masih terkunci');

// Screenshot modal terbuka (belum konfirmasi — jangan cabut token sungguhan)
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('');
console.log('Screenshot:', OUT);

console.log('');
console.log('=== JS EXCEPTIONS ===');
console.log(exceptions.length ? exceptions.join('\n') : '(bersih)');

ws.close();
chrome.kill();
process.exit(0);
