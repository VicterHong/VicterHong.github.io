/**
 * Uji beberapa nilai max-width untuk judul hero — DIUKUR, bukan ditebak.
 *
 * Kenapa: HTML punya <br> eksplisit, jadi menambahkan max-width bisa
 * membuat pemecahan LEBIH buruk. Uji beberapa nilai pada viewport nyata,
 * pilih yang keseimbangannya terbaik.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9232;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-hero-profile',
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

const MEASURE = `(() => {
  const h1 = document.querySelector('.hero-title');
  if (!h1) return JSON.stringify({ error: 'tidak ada' });
  const range = document.createRange();
  range.selectNodeContents(h1);
  const rects = Array.from(range.getClientRects()).filter(x => x.width > 2);
  // Gabungkan rect yang top-nya berdekatan (satu baris visual bisa
  // menghasilkan beberapa rect karena <span> dan .cine-word).
  const lines = [];
  for (const r of rects) {
    const f = lines.find(l => Math.abs(l.top - r.top) < 10);
    if (f) { f.right = Math.max(f.right, r.right); f.left = Math.min(f.left, r.left); }
    else lines.push({ top: r.top, left: r.left, right: r.right });
  }
  lines.sort((a, b) => a.top - b.top);
  const widths = lines.map(l => Math.round(l.right - l.left));
  const bal = widths.length > 1
    ? Math.round(Math.min(...widths) / Math.max(...widths) * 100) : 100;
  return JSON.stringify({
    baris: widths.length,
    lebar: widths,
    keseimbangan: bal,
    tinggi: Math.round(h1.getBoundingClientRect().height),
  });
})()`;

// Siapkan halaman
await send('Page.navigate', { url: new globalThis.URL(URL_TARGET).origin });
await sleep(2500);
await send('Runtime.evaluate', {
  expression: `sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now()))`,
});

const WIDTHS = [1440, 1280, 1024];

// Opsi yang diuji: [label, css max-width, hapus <br>?]
const OPSI = [
  ['baseline (sekarang)', 'none', false],
  ['maxw 12ch', '12ch', false],
  ['maxw 15ch', '15ch', false],
  ['maxw 18ch', '18ch', false],
  ['maxw 20ch', '20ch', false],
  ['maxw 24ch', '24ch', false],
  ['tanpa <br> + 18ch', '18ch', true],
  ['tanpa <br> + 20ch', '20ch', true],
  ['tanpa <br> + none', 'none', true],
];

for (const W of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(3500);

  console.log(`\n═══════ VIEWPORT ${W}px ═══════`);
  for (const [label, mw, hapusBr] of OPSI) {
    // Terapkan perubahan
    await send('Runtime.evaluate', {
      expression: `(() => {
        let st = document.getElementById('hero-test-style');
        if (!st) { st = document.createElement('style'); st.id = 'hero-test-style'; document.head.appendChild(st); }
        st.textContent = '.hero-title { max-width: ${mw} !important; }';

        // Simpan HTML asli sekali saja, lalu ubah sesuai opsi
        const h1 = document.querySelector('.hero-title');
        if (!h1.dataset.orig) h1.dataset.orig = h1.innerHTML;
        h1.innerHTML = h1.dataset.orig;
        if (${hapusBr}) {
          // Ganti <br> dengan spasi supaya text-wrap: balance bekerja
          h1.innerHTML = h1.dataset.orig.replace(/<br\\s*\\/?>/gi, ' ');
        }
      })()`,
    });
    await sleep(400);

    const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
    const d = JSON.parse(r.result.value);
    const tanda = d.keseimbangan >= 70 ? '✅' : d.keseimbangan >= 50 ? '⚠ ' : '❌';
    console.log(`  ${label.padEnd(22)} baris=${d.baris} lebar=[${d.lebar.join(', ')}] tinggi=${d.tinggi}px keseimbangan=${d.keseimbangan}% ${tanda}`);
  }
}

chrome.kill();
