/**
 * Uji halaman reset sandi dengan Chrome headless (CDP langsung).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA UJI INI ADA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Halaman reset sandi TIDAK PERNAH ADA, padahal backend sudah lama mengirim
 * tautan ke sana. Setiap pengguna yang lupa sandi mendapat 404 — dan itu baru
 * ketahuan setelah ada yang melaporkannya.
 *
 * Pelajarannya: halaman yang hanya bisa dicapai lewat tautan email tidak
 * pernah diuji "secara tidak sengaja". Ia harus diuji eksplisit.
 *
 * ── KENAPA CDP LANGSUNG, BUKAN PLAYWRIGHT ───────────────────────────────────
 * Playwright tidak terpasang di repo ini, sementara Chrome headless sudah ada
 * (dipakai skrip uji lain) dan protokolnya cukup lewat WebSocket. Menambah
 * dependensi besar hanya untuk menguji satu halaman tidak sepadan.
 *
 * Jalankan: node scripts/uji-reset-sandi.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const CHROME = process.env.CHROME_BIN
  || `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const PORT_CDP = 9245;

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

// ══════════════════════════════════════════════════════════════════════════════
// ── SERVER STATIS KECIL ═════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

function jalankanServer() {
  return new Promise((selesai) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let jalur = join(DIST, decodeURIComponent(url.pathname));

      if (jalur.endsWith('/')) jalur = join(jalur, 'index.html');
      if (!existsSync(jalur) && !extname(jalur)) jalur += '.html';

      if (!existsSync(jalur) || !jalur.startsWith(DIST)) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<h1>404</h1>');
        return;
      }

      res.writeHead(200, { 'content-type': TIPE[extname(jalur)] ?? 'application/octet-stream' });
      res.end(readFileSync(jalur));
    });
    server.listen(0, '127.0.0.1', () => selesai({ server, port: server.address().port }));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── KLIEN CDP MINIMAL ═══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.tunggu = new Map();
    this.galat = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.tunggu.has(m.id)) {
        const { resolve: res, reject } = this.tunggu.get(m.id);
        this.tunggu.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.galat.push(m.params?.exceptionDetails?.text ?? 'error');
      }
    });
  }

  kirim(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.tunggu.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.tunggu.has(id)) {
          this.tunggu.delete(id);
          rej(new Error(`timeout: ${method}`));
        }
      }, 20000);
    });
  }

  /** Jalankan JS di halaman, kembalikan nilainya. */
  async eval(ekspresi) {
    const r = await this.kirim('Runtime.evaluate', {
      expression: ekspresi,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  }
}

async function sambung(port) {
  // Tunggu Chrome siap
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch { /* belum siap */ }
    await sleep(250);
  }

  const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);

  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
    setTimeout(() => rej(new Error('WebSocket timeout')), 15000);
  });

  const cdp = new Cdp(ws);
  await cdp.kirim('Runtime.enable');
  await cdp.kirim('Page.enable');
  await cdp.kirim('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  return cdp;
}

async function buka(cdp, url) {
  await cdp.kirim('Page.navigate', { url });
  // Tunggu halaman selesai memuat
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const siap = await cdp.eval('document.readyState');
    if (siap === 'complete') break;
  }
  await sleep(400);   // beri waktu skrip defer berjalan
}

// ══════════════════════════════════════════════════════════════════════════════
// ── JALANKAN ════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

let lulus = 0, gagal = 0;
const cek = (nama, benar) => {
  if (benar) { console.log(`  ✅ ${nama}`); lulus++; }
  else { console.log(`  ❌ ${nama}`); gagal++; }
};

const { server, port } = await jalankanServer();
const BASE = `http://127.0.0.1:${port}`;

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT_CDP}`,
  '--user-data-dir=/tmp/chrome-uji-reset',
  'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  cdp = await sambung(PORT_CDP);

  console.log('');
  console.log('  ══ UJI HALAMAN RESET SANDI ══');
  console.log('');

  // ── 1. Halaman termuat ────────────────────────────────────────────────────
  console.log('  ── 1. Halaman termuat ──');

  await buka(cdp, `${BASE}/reset-sandi.html?token=token-uji-abc123`);

  const info = await cdp.eval(`({
    title: document.title,
    adaForm: !!document.getElementById('formReset'),
    adaSyarat: document.querySelectorAll('.auth-syarat-item').length,
    panel: document.querySelector('.auth-panel.is-active')?.dataset.panel ?? null,
    token: new URLSearchParams(location.search).get('token'),
    bukan404: !document.body.textContent.includes('404'),
  })`);

  cek('halaman termuat (bukan 404)', info.bukan404 === true);
  cek('judul benar', (info.title ?? '').includes('Buat sandi baru'));
  cek('form reset ada', info.adaForm === true);
  cek('tiga syarat ditampilkan', info.adaSyarat === 3);
  cek('token terbaca dari URL', info.token === 'token-uji-abc123');
  cek('panel form yang aktif', info.panel === 'form');
  cek('tidak ada error JS', cdp.galat.length === 0);
  if (cdp.galat.length) console.log(`     → ${cdp.galat[0].slice(0, 120)}`);

  // ── 2. Indikator syarat sandi ─────────────────────────────────────────────
  console.log('');
  console.log('  ── 2. Indikator syarat sandi ──');

  // Sandi lemah
  await cdp.eval(`(() => {
    const el = document.getElementById('inpSandi');
    el.value = 'abcdefgh';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  let n = await cdp.eval(`document.querySelectorAll('.auth-syarat-item.terpenuhi').length`);
  cek('sandi huruf kecil saja → 1 syarat (panjang)', n === 1);

  // Sandi kuat
  await cdp.eval(`(() => {
    const el = document.getElementById('inpSandi');
    el.value = 'SandiKuat123';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  n = await cdp.eval(`document.querySelectorAll('.auth-syarat-item.terpenuhi').length`);
  cek('sandi kuat → 3 syarat terpenuhi', n === 3);

  // ── 3. Tombol lihat sandi ─────────────────────────────────────────────────
  console.log('');
  console.log('  ── 3. Tombol lihat sandi ──');

  let tipe = await cdp.eval(`document.getElementById('inpSandi').type`);
  cek('tipe awal = password', tipe === 'password');

  await cdp.eval(`document.getElementById('btnRevealSandi').click()`);
  await sleep(150);
  tipe = await cdp.eval(`document.getElementById('inpSandi').type`);
  cek('setelah klik → text', tipe === 'text');

  const pressed = await cdp.eval(`document.getElementById('btnRevealSandi').getAttribute('aria-pressed')`);
  cek('aria-pressed jadi true', pressed === 'true');

  await cdp.eval(`document.getElementById('btnRevealSandi').click()`);
  await sleep(150);
  tipe = await cdp.eval(`document.getElementById('inpSandi').type`);
  cek('klik lagi → password', tipe === 'password');

  // Tombol kedua independen
  await cdp.eval(`document.getElementById('btnRevealUlangi').click()`);
  await sleep(150);
  const tipe1 = await cdp.eval(`document.getElementById('inpSandi').type`);
  const tipe2 = await cdp.eval(`document.getElementById('inpUlangi').type`);
  cek('tombol kedua bekerja sendiri', tipe2 === 'text' && tipe1 === 'password');
  await cdp.eval(`document.getElementById('btnRevealUlangi').click()`);

  // ── 4. Pesan kecocokan ────────────────────────────────────────────────────
  console.log('');
  console.log('  ── 4. Pesan kecocokan sandi ──');

  await cdp.eval(`(() => {
    const a = document.getElementById('inpSandi');
    const b = document.getElementById('inpUlangi');
    a.value = 'SandiKuat123'; a.dispatchEvent(new Event('input', { bubbles: true }));
    b.value = 'SandiKuat124'; b.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(250);
  let pesan = await cdp.eval(`document.getElementById('msgCocok').textContent`);
  cek('sandi tidak sama → ada pesan', (pesan ?? '').length > 0);
  cek('pesannya jelas ("belum sama")', (pesan ?? '').includes('belum sama'));

  await cdp.eval(`(() => {
    const b = document.getElementById('inpUlangi');
    b.value = 'SandiKuat123'; b.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(250);
  pesan = await cdp.eval(`document.getElementById('msgCocok').textContent`);
  cek('sandi sama → pesan hilang', (pesan ?? '').length === 0);

  // ── 5. Tanpa token → panel gagal ──────────────────────────────────────────
  console.log('');
  console.log('  ── 5. Tautan tanpa token ──');

  await buka(cdp, `${BASE}/reset-sandi.html`);
  const g = await cdp.eval(`({
    panel: document.querySelector('.auth-panel.is-active')?.dataset.panel ?? null,
    judul: document.getElementById('judulGagal')?.textContent ?? '',
    adaTombol: document.querySelectorAll('a[href="/sign-in"]').length,
  })`);
  cek('panel gagal yang tampil', g.panel === 'gagal');
  cek('judul menyebut tautan tidak lengkap', g.judul.includes('tidak lengkap'));
  cek('ada jalan minta tautan baru', g.adaTombol >= 1);

  // ── 6. Tampilan ponsel ────────────────────────────────────────────────────
  console.log('');
  console.log('  ── 6. Tampilan ponsel (390px) ──');

  await buka(cdp, `${BASE}/reset-sandi.html?token=uji`);
  const ukur = await cdp.eval(`({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    tinggiTombol: document.getElementById('btnSimpan')?.getBoundingClientRect().height ?? 0,
  })`);
  cek('tidak ada geser horizontal', ukur.scrollW <= ukur.clientW + 1);
  cek('tombol simpan ≥ 44px', ukur.tinggiTombol >= 44);

  // Screenshot
  const shot = await cdp.kirim('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/reset-sandi-uji.png', Buffer.from(shot.data, 'base64'));
  console.log('  📸 screenshot: /tmp/reset-sandi-uji.png');

} finally {
  try { cdp?.ws.close(); } catch { /* sudah tertutup */ }
  chrome.kill();
  server.close();
}

console.log('');
console.log(`  ${lulus} lulus, ${gagal} gagal`);
console.log('');

process.exit(gagal > 0 ? 1 : 0);
