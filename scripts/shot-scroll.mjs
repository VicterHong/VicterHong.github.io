/**
 * Screenshot dengan scroll ke posisi tertentu (untuk verifikasi section).
 * Jalankan: node scripts/shot-scroll.mjs [url] [out] [width] [height] [scrollY]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const TARGET_URL = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const OUT = process.argv[3] || '/tmp/shot-scroll.png';
const W = parseInt(process.argv[4] || '1440', 10);
const H = parseInt(process.argv[5] || '900', 10);
const SCROLL_Y = parseInt(process.argv[6] || '1200', 10);
const PORT = 9226;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${W},${H}`,
  '--user-data-dir=/tmp/chrome-scroll-profile',
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
  width: W, height: H, deviceScaleFactor: 1, mobile: W < 700,
});

await send('Page.navigate', { url: new globalThis.URL(TARGET_URL).origin });
await sleep(2500);
await send('Runtime.evaluate', {
  expression: `sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now()))`,
});

await send('Page.navigate', { url: TARGET_URL });
await sleep(6000);

// Scroll bertahap supaya IntersectionObserver & scroll effects terpicu.
for (let y = 0; y <= SCROLL_Y; y += 400) {
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y})` });
  await sleep(300);
}
await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${SCROLL_Y})` });
await sleep(2500);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('saved:', OUT, 'at scrollY=', SCROLL_Y);

ws.close();
chrome.kill();
process.exit(0);
