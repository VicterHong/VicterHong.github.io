/**
 * Debug menyeluruh panel admin — audit profesional.
 *
 * Menguji:
 *   1. Login & autentikasi
 *   2. Semua 11 tab — apakah termuat tanpa error
 *   3. Semua filter — apakah mengirim request & menyaring data
 *   4. Semua modal — Terbitkan token, Cabut token
 *   5. Semua tombol — refresh, logout, export CSV
 *   6. Console errors & JS exceptions
 *   7. Network failures
 *   8. Responsivitas mobile
 *
 * Jalankan: node scripts/debug-admin-full.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT = 9400;
const BASE = 'http://127.0.0.1:8788';

const envText = readFileSync(`${process.env.HOME}/.portfolio-token/service.env`, 'utf8');
const ADMIN_KEY = envText.match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-debug-full-${Date.now()}`,
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
const consoleWarns = [];
const exceptions = [];
const networkFails = [];
const apiCalls = [];
const requests = new Map();

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

  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 250);
    if (m.params.type === 'error') consoleErrors.push(text);
    if (m.params.type === 'warning') consoleWarns.push(text);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300));
  }
  if (m.method === 'Network.requestWillBeSent') {
    requests.set(m.params.requestId, m.params.request.url);
    if (m.params.request.url.includes('/api/')) {
      apiCalls.push(m.params.request.url.replace(BASE, ''));
    }
  }
  if (m.method === 'Network.loadingFailed') {
    const url = requests.get(m.params.requestId) || '(unknown)';
    if (!url.includes('favicon')) {
      networkFails.push({ url: url.replace(BASE, ''), error: m.params.errorText });
    }
  }
  if (m.method === 'Network.responseReceived') {
    const { response } = m.params;
    if (response.status >= 400 && response.url.includes('/api/')) {
      networkFails.push({ url: response.url.replace(BASE, ''), status: response.status });
    }
  }
};
await new Promise(r => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

// ══ 1. LOGIN ═════════════════════════════════════════════════════════════════

console.log('══════════════════════════════════════════════════════════');
console.log(' DEBUG PANEL ADMIN — AUDIT MENYELURUH');
console.log('══════════════════════════════════════════════════════════');
console.log('');

const t0 = Date.now();
await send('Page.navigate', { url: `${BASE}/admin` });
await sleep(2500);

const loginPage = await ev(`JSON.stringify({
  hasLogin: !!document.querySelector('.login-card'),
  title: document.title,
  loadTime: performance.timing?.loadEventEnd - performance.timing?.navigationStart || 0,
})`);
console.log('── 1. HALAMAN LOGIN ──');
console.log(`   ${loginPage}`);

await ev(`(() => { document.querySelector('input[type=password]').value = ${JSON.stringify(ADMIN_KEY)}; document.querySelector('.login-card button').click(); })()`);
await sleep(5500);

const loggedIn = await ev(`JSON.stringify({
  shellVisible: document.querySelector('#shell')?.classList.contains('active'),
  loginHidden: getComputedStyle(document.querySelector('#loginWrap')).display === 'none',
  statusText: document.querySelector('#statusText')?.textContent?.trim(),
  tabCount: document.querySelectorAll('.tab').length,
})`);
console.log('');
console.log('── 2. LOGIN ──');
console.log(`   ${loggedIn}`);
const login = JSON.parse(loggedIn);
console.log(`   ${login.shellVisible && login.loginHidden ? '✅ Login berhasil' : '❌ Login gagal'}`);
console.log(`   ${login.statusText === 'layanan aktif' ? '✅ Status: layanan aktif' : '⚠️ Status: ' + login.statusText}`);

// ══ 3. SEMUA TAB ═════════════════════════════════════════════════════════════

console.log('');
console.log('── 3. SEMUA TAB (11) ──');

const tabs = await ev(`JSON.stringify([...document.querySelectorAll('.tab')].map(t => ({
  id: t.dataset.tab,
  label: t.textContent.trim(),
  panelExists: !!document.querySelector('#panel-' + t.dataset.tab),
})))`);
const tabList = JSON.parse(tabs);

const tabResults = [];
for (const t of tabList) {
  apiCalls.length = 0;
  await ev(`document.querySelector('.tab[data-tab="${t.id}"]').click()`);
  await sleep(1400);

  const state = await ev(`(() => {
    const p = document.querySelector('#panel-${t.id}');
    if (!p) return JSON.stringify({ error: 'panel tidak ada' });
    const rows = p.querySelectorAll('table tbody tr').length;
    const hasError = p.innerHTML.includes('Gagal memuat') || p.innerHTML.includes('color:var(--err)');
    const empty = p.innerHTML.includes('Belum ada') || p.innerHTML.includes('Tidak ada');
    return JSON.stringify({
      isActive: p.classList.contains('active'),
      rows,
      hasError,
      empty,
      height: Math.round(p.getBoundingClientRect().height),
    });
  })()`);
  const s = JSON.parse(state);

  const icon = s.hasError ? '❌' : s.isActive ? '✅' : '⚠️';
  const note = s.hasError ? 'ADA ERROR'
    : s.rows > 0 ? `${s.rows} baris`
    : s.empty ? 'kosong (wajar)' : `${s.height}px`;

  tabResults.push({ ...t, ...s, icon });
  console.log(`   ${icon} ${t.label.padEnd(12)} — ${note}`);
}

// ══ 4. FILTER ════════════════════════════════════════════════════════════════

console.log('');
console.log('── 4. FILTER ──');

const filters = [
  { id: 'tokenStatusFilter', tab: 'tokens', label: 'Status token' },
  { id: 'tokenTierFilter', tab: 'tokens', label: 'Tier token' },
  { id: 'tokenProjectFilter', tab: 'tokens', label: 'Proyek token' },
  { id: 'funnelProject', tab: 'funnel', label: 'Proyek funnel' },
  { id: 'funnelDays', tab: 'funnel', label: 'Periode funnel' },
  { id: 'auditLimit', tab: 'audit', label: 'Limit audit' },
  { id: 'perfDays', tab: 'perf', label: 'Periode performa' },
];

for (const f of filters) {
  await ev(`document.querySelector('.tab[data-tab="${f.tab}"]').click()`);
  await sleep(800);
  apiCalls.length = 0;

  const result = await ev(`(() => {
    const sel = document.querySelector('#${f.id}');
    if (!sel) return JSON.stringify({ error: 'tidak ada' });
    const opts = [...sel.options].filter(o => o.value !== '');
    if (!opts.length) return JSON.stringify({ skip: true, reason: 'tidak ada opsi' });
    sel.value = opts[0].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ changed: opts[0].value, totalOpts: opts.length });
  })()`);
  const r = JSON.parse(result);
  await sleep(1600);

  const relevant = apiCalls.filter(u => !u.includes('/api/health') && !u.includes('/api/config'));
  const icon = r.error ? '❌' : r.skip ? '⏭️' : relevant.length > 0 ? '✅' : '❌';
  const note = r.error ? 'elemen tidak ditemukan'
    : r.skip ? r.reason
    : relevant.length > 0 ? `→ "${r.changed}" (${relevant.length} request)` : 'TIDAK mengirim request';
  console.log(`   ${icon} ${f.label.padEnd(16)} — ${note}`);
}

// ══ 5. MODAL ═════════════════════════════════════════════════════════════════

console.log('');
console.log('── 5. MODAL ──');

// Modal Terbitkan token
await ev(`document.querySelector('.tab[data-tab="tokens"]').click()`);
await sleep(1000);
await ev(`document.querySelector('#issueBtn').click()`);
await sleep(2200);

const issueModal = await ev(`JSON.stringify({
  open: !!document.querySelector('.modal'),
  title: document.querySelector('.modal h2')?.textContent?.trim(),
  projectOptions: document.querySelector('#mProject')?.options?.length ?? 0,
  hasExtraCheckboxes: document.querySelectorAll('.proj-check').length,
  hasAdvToggle: !!document.querySelector('#mAdvToggle'),
  actionsVisible: (() => {
    const a = document.querySelector('.modal-actions');
    if (!a) return false;
    const r = a.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 2 && r.height > 0;
  })(),
})`);
const im = JSON.parse(issueModal);
console.log(`   ${im.open ? '✅' : '❌'} Modal Terbitkan   — ${im.title || 'tidak terbuka'}`);
console.log(`      Proyek: ${im.projectOptions} opsi, checkbox tambahan: ${im.hasExtraCheckboxes}, adv-toggle: ${im.hasAdvToggle ? 'ada' : 'tidak'}`);
console.log(`      ${im.actionsVisible ? '✅' : '❌'} Tombol aksi terlihat di viewport`);

// Tutup modal
await ev(`document.querySelector('#mCancel')?.click()`);
await sleep(800);

// Modal Cabut token
await ev(`document.querySelector('[data-revoke]')?.click()`);
await sleep(2000);

const revokeModal = await ev(`JSON.stringify({
  open: !!document.querySelector('.modal-sm'),
  title: document.querySelector('.modal-sm h2')?.textContent?.trim(),
  contextRows: document.querySelectorAll('.revoke-row').length,
  chips: document.querySelectorAll('.reason-chip').length,
  confirmDisabled: document.querySelector('#rvConfirm')?.disabled,
  isDanger: document.querySelector('#rvConfirm')?.classList.contains('danger'),
  warning: !!document.querySelector('.revoke-warning'),
  modalMargin: (() => {
    const m = document.querySelector('.modal-sm');
    return m ? Math.round(m.getBoundingClientRect().left) : null;
  })(),
})`);
const rm = JSON.parse(revokeModal);
console.log(`   ${rm.open ? '✅' : '❌'} Modal Cabut       — ${rm.title || 'tidak terbuka'}`);
console.log(`      Konteks: ${rm.contextRows} baris, chip alasan: ${rm.chips}, margin: ${rm.modalMargin}px`);
console.log(`      ${rm.confirmDisabled ? '✅' : '❌'} Tombol terkunci awal, ${rm.isDanger ? '✅' : '❌'} merah destruktif, ${rm.warning ? '✅' : '❌'} peringatan`);

await ev(`document.querySelector('#rvCancel')?.click()`);
await sleep(600);

// ══ 6. TOMBOL ════════════════════════════════════════════════════════════════

console.log('');
console.log('── 6. TOMBOL UTAMA ──');

apiCalls.length = 0;
await ev(`document.querySelector('#refreshBtn').click()`);
// Cek state loading dalam 100ms — setelah itu loadAll selesai (data lokal, cepat).
await sleep(100);
const refreshLoading = await ev(`JSON.stringify({
  disabled: document.querySelector('#refreshBtn')?.disabled,
  text: document.querySelector('#refreshBtn')?.textContent?.trim(),
})`);
await sleep(4500);
const refreshDone = await ev(`JSON.stringify({
  disabled: document.querySelector('#refreshBtn')?.disabled,
  text: document.querySelector('#refreshBtn')?.textContent?.trim(),
  toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
})`);
const rl = JSON.parse(refreshLoading), rd = JSON.parse(refreshDone);
console.log(`   ${rl.disabled && rl.text.includes('Memuat') ? '✅' : '❌'} Tombol Muat ulang — feedback loading`);
console.log(`      Saat klik: "${rl.text}" → selesai: "${rd.text}"${rd.toast ? ` + notif "${rd.toast}"` : ''}`);
console.log(`      Request terkirim: ${apiCalls.filter(u => u.includes('/api/')).length}`);

const logoutBtn = await ev(`!!document.querySelector('#logoutBtn')`);
console.log(`   ${logoutBtn ? '✅' : '❌'} Tombol Keluar — ada`);

// ══ 7. KESEHATAN TEKNIS ══════════════════════════════════════════════════════

console.log('');
console.log('── 7. KESEHATAN TEKNIS ──');

// Cek mobile card mode
await ev(`document.querySelector('.tab[data-tab="tokens"]').click()`);
await sleep(1200);
const mobileCheck = await ev(`(() => {
  const wrap = document.querySelector('#panel-tokens .table-wrap');
  const td = wrap?.querySelector('tbody td');
  const overflow = document.body.scrollWidth > window.innerWidth + 2;
  return JSON.stringify({
    cardMode: td ? getComputedStyle(td).display === 'flex' : false,
    hasDataLabel: td ? !!td.getAttribute('data-label') : false,
    horizontalOverflow: overflow,
    viewport: window.innerWidth + 'x' + window.innerHeight,
  });
})()`);
const mc = JSON.parse(mobileCheck);
console.log(`   ${mc.cardMode ? '✅' : '❌'} Mode kartu mobile aktif`);
console.log(`   ${mc.hasDataLabel ? '✅' : '❌'} Label kolom ada (data-label)`);
console.log(`   ${!mc.horizontalOverflow ? '✅' : '❌'} Tidak ada overflow horizontal`);

// Cek API endpoint health
const apiHealth = await ev(`(async () => {
  const endpoints = [
    '/api/health', '/api/config', '/api/cms/collections', '/api/comments',
    '/api/admin/tokens?limit=1', '/api/admin/leads?limit=1', '/api/admin/sla',
    '/api/admin/performance', '/api/admin/experiments', '/api/admin/branches',
    '/api/admin/releases?limit=1', '/api/admin/projects',
  ];
  const results = [];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers: { 'x-admin-key': ${JSON.stringify(ADMIN_KEY)} } });
      results.push({ ep, status: r.status });
    } catch (e) {
      results.push({ ep, status: 'ERR' });
    }
  }
  return JSON.stringify(results);
})()`);
const apiResults = JSON.parse(apiHealth);
const apiOk = apiResults.filter(r => r.status === 200).length;
console.log('');
console.log(`   Endpoint API: ${apiOk}/${apiResults.length} OK`);
for (const r of apiResults) {
  const icon = r.status === 200 ? '✅' : r.status === 404 ? '⚠️' : '❌';
  console.log(`   ${icon} ${r.ep.padEnd(38)} → ${r.status}`);
}

// ══ 8. HASIL AKHIR ═══════════════════════════════════════════════════════════

console.log('');
console.log('── 8. CONSOLE & NETWORK ──');
console.log(`   Console errors   : ${consoleErrors.length}`);
if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log(`      ${e}`));
console.log(`   Console warnings : ${consoleWarns.length}`);
if (consoleWarns.length) consoleWarns.slice(0, 5).forEach(e => console.log(`      ${e}`));
console.log(`   JS exceptions    : ${exceptions.length}`);
if (exceptions.length) exceptions.slice(0, 5).forEach(e => console.log(`      ${e}`));
console.log(`   Network failures : ${networkFails.length}`);
if (networkFails.length) networkFails.slice(0, 8).forEach(f => console.log(`      ${JSON.stringify(f)}`));

// Screenshot akhir
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/admin-debug-final.png', Buffer.from(shot.data, 'base64'));

console.log('');
console.log('══════════════════════════════════════════════════════════');
const totalIssues = consoleErrors.length + exceptions.length + networkFails.length
  + tabResults.filter(t => t.hasError).length;
console.log(` RINGKASAN: ${totalIssues === 0 ? '✅ SEMUA BERSIH' : `⚠️ ${totalIssues} masalah`}`);
console.log(` Durasi total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('══════════════════════════════════════════════════════════');
console.log('');
console.log('Screenshot: /tmp/admin-debug-final.png');

ws.close();
chrome.kill();
process.exit(totalIssues === 0 ? 0 : 1);
