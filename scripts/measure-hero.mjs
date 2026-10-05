/**
 * Ukur pemecahan baris judul hero di beberapa lebar viewport.
 *
 * Kenapa perlu diukur: HTML punya <br> eksplisit, jadi menambahkan
 * max-width bisa membuat pemecahan jadi LEBIH buruk (baris terlalu pendek
 * atau teks terpotong). Jangan menebak — ukur di browser nyata.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9231;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-measure-profile',
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

// Lewati gate
await send('Page.navigate', { url: new globalThis.URL(URL_TARGET).origin });
await sleep(2500);
await send('Runtime.evaluate', {
  expression: `sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now()))`,
});

const WIDTHS = [1440, 1280, 1024, 900, 768, 640, 390];

console.log('=== PENGUKURAN JUDUL HERO ===\n');

for (const W of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700,
  });
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(3500);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const h1 = document.querySelector('.hero-title');
      if (!h1) return JSON.stringify({ error: 'tidak ditemukan' });
      const cs = getComputedStyle(h1);
      const range = document.createRange();
      range.selectNodeContents(h1);
      const rects = Array.from(range.getClientRects()).filter(x => x.width > 2);

      // Gabungkan rect yang punya 'top' hampir sama (satu baris bisa
      // menghasilkan beberapa rect kalau ada <span>)
      const lines = [];
      for (const r of rects) {
        const found = lines.find(l => Math.abs(l.top - r.top) < 6);
        if (found) { found.right = Math.max(found.right, r.right); found.left = Math.min(found.left, r.left); }
        else lines.push({ top: r.top, left: r.left, right: r.right });
      }
      lines.sort((a, b) => a.top - b.top);

      return JSON.stringify({
        fontSize: cs.fontSize,
        maxWidth: cs.maxWidth,
        boxWidth: Math.round(h1.getBoundingClientRect().width),
        boxHeight: Math.round(h1.getBoundingClientRect().height),
        jumlahBaris: lines.length,
        baris: lines.map(l => Math.round(l.right - l.left)),
      });
    })()`,
    returnByValue: true,
  });

  const data = JSON.parse(r.result.value);
  if (data.error) { console.log(`${W}px: ${data.error}`); continue; }

  const seimbang = data.jumlahBaris > 1
    ? (Math.min(...data.baris) / Math.max(...data.baris) * 100).toFixed(0)
    : '100';

  console.log(`${String(W).padStart(4)}px  font=${data.fontSize.padEnd(7)} maxw=${data.maxWidth.padEnd(8)} baris=${data.jumlahBaris}  lebar=[${data.baris.join(', ')}]  tinggi=${data.boxHeight}px  keseimbangan=${seimbang}%`);
}

chrome.kill();
