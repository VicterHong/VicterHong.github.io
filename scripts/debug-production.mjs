/**
 * Production debug check via CDP — console errors, network failures, JS exceptions.
 * Jalankan: node scripts/debug-production.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9222;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-debug-profile',
  'about:blank',
], { stdio: 'ignore' });

process.on('exit', () => chrome.kill());

// Tunggu CDP siap
let targets;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    targets = await res.json();
    if (targets.length) break;
  } catch { /* belum siap */ }
}

if (!targets?.length) {
  console.error('CDP tidak siap');
  process.exit(1);
}

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
const consoleMsgs = [];
const networkFails = [];
const exceptions = [];
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const level = msg.params.type;
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (level === 'error' || level === 'warning') consoleMsgs.push({ level, text: text.slice(0, 200) });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    exceptions.push((d.exception?.description || d.text || '').slice(0, 300));
  }
  if (msg.method === 'Network.loadingFailed') {
    networkFails.push({
      url: msg.params.requestId,
      error: msg.params.errorText,
      blocked: msg.params.blockedReason || null,
    });
  }
  if (msg.method === 'Network.responseReceived') {
    const { response } = msg.params;
    if (response.status >= 400) {
      networkFails.push({ url: response.url, status: response.status });
    }
  }
};

await new Promise(r => { ws.onopen = r; });

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');

await send('Page.navigate', { url: URL });
await sleep(8000); // tunggu render + animasi

// Ambil state DOM penting
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r?.result?.value;
};

const state = await evalJs(`JSON.stringify({
  title: document.title,
  grain: !!document.querySelector('.grain-overlay'),
  waveChars: document.querySelectorAll('.wave-char').length,
  waveRevealed: document.querySelectorAll('[data-wave-reveal].revealed').length,
  magnetic: document.querySelectorAll('[data-magnetic]').length,
  orb: !!document.querySelector('.orb-menu'),
  orbVisible: document.querySelector('.orb-menu')?.classList.contains('is-visible'),
  projects: document.querySelectorAll('.project').length,
  projectsRendered: document.querySelector('#featuredProjects')?.children.length,
  videoSrc: document.querySelector('#heroVideo')?.currentSrc?.split('/').pop() || null,
  videoPlaying: document.querySelector('#heroVideo') ? !document.querySelector('#heroVideo').paused : null,
  rail: !!document.querySelector('.section-rail'),
  sectionNumbers: document.querySelectorAll('.section-index, [class*="section-num"]').length,
  cssLoaded: document.styleSheets.length,
  errors: window.__errors || null,
})`);

console.log('=== PRODUCTION STATE ===');
console.log(JSON.stringify(JSON.parse(state), null, 2));

console.log('\n=== CONSOLE ERRORS/WARNINGS ===');
if (consoleMsgs.length === 0) console.log('(bersih — tidak ada error)');
else consoleMsgs.slice(0, 15).forEach(m => console.log(`[${m.level}] ${m.text}`));

console.log('\n=== JS EXCEPTIONS ===');
if (exceptions.length === 0) console.log('(bersih — tidak ada exception)');
else exceptions.slice(0, 10).forEach(e => console.log(e));

console.log('\n=== NETWORK FAILURES (4xx/5xx/failed) ===');
const realFails = networkFails.filter(f => !f.url?.includes('requestId'));
if (realFails.length === 0) console.log('(bersih)');
else realFails.slice(0, 15).forEach(f => console.log(JSON.stringify(f)));

ws.close();
chrome.kill();
process.exit(0);
