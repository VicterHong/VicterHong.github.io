/**
 * Debug network — lacak request yang gagal/di-abort beserta URL-nya.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const TARGET_URL = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9227;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-net-profile',
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
const requests = new Map(); // requestId → url
const fails = [];

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
  if (m.method === 'Network.requestWillBeSent') {
    requests.set(m.params.requestId, m.params.request.url);
  }
  if (m.method === 'Network.loadingFailed') {
    fails.push({
      url: requests.get(m.params.requestId) || '(unknown)',
      error: m.params.errorText,
      type: m.params.type,
    });
  }
  if (m.method === 'Network.responseReceived') {
    const { response, type } = m.params;
    if (response.status >= 400) {
      fails.push({ url: response.url, status: response.status, type });
    }
  }
};
await new Promise(r => { ws.onopen = r; });

await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: new globalThis.URL(TARGET_URL).origin });
await sleep(2500);
await send('Runtime.evaluate', {
  expression: `sessionStorage.setItem('cf_clearance_' + location.hostname, String(Date.now()))`,
});
await send('Page.navigate', { url: TARGET_URL });
await sleep(9000);

console.log('=== NETWORK FAILURES (with URLs) ===');
if (!fails.length) console.log('(bersih)');
else fails.forEach(f => console.log(JSON.stringify(f)));

ws.close();
chrome.kill();
process.exit(0);
