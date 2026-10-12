/**
 * Uji browser: logo VIVASTIC muncul di halaman profil, dan tidak bisa diklik.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BUG YANG DIUJI ────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Pengguna melaporkan: "Diprofil tidak ada logo tolong di perbaiki" — dengan
 * screenshot yang menunjukkan kotak emas KOSONG di header (placeholder tanpa
 * logo V di dalamnya).
 *
 * Penyebab: keamanan.html tidak memuat logo-mount.js. Mark tetap elemen
 * <span class="auth-nav-mark"> dengan gaya bawaan (kotak emas 10×10).
 *
 * ── KENAPA TES INI MENUNGGU, BUKAN LANGSUNG MEMERIKSA ────────────────────────
 * Logo dipasang JavaScript setelah DOM siap. Memeriksa terlalu cepat berarti
 * memeriksa DOM sebelum logo-mount.js sempat berjalan — dan tes akan gagal
 * meski kodenya benar. Karena itu tes menunggu sampai <img class="brand-logo">
 * benar-benar ada, dengan batas waktu.
 *
 * ── KENAPA DIPERIKSA naturalWidth, BUKAN CUMA KEBERADAAN ELEMEN ──────────────
 * <img> yang dibuat JS bisa ADA di DOM tapi GAGAL memuat (404). Elemennya
 * ada, tapi pengguna melihat ikon gambar rusak — bukan logo. naturalWidth > 0
 * hanya benar kalau gambar benar-benar termuat.
 *
 * Jalankan: node backend/test/ui-profil-logo.mjs
 * (Butuh chromium playwright — dilewati kalau tidak ada.)
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DIST = join(ROOT, 'dist');

// ── CHROMIUM — cari di lokasi yang mungkin ──────────────────────────────────
// Tidak semua lingkungan punya playwright terpasang (mis. CI minimal). Kalau
// tidak ada, tes di-SKIP — bukan gagal. Tes yang butuh browser tidak masuk
// akal memaksa CI memasang browser hanya untuk memverifikasi header.
function cariChromium() {
  const kandidat = [
    process.env.CHROMIUM_PATH,
    join(process.env.HOME ?? '', '.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome'),
    join(process.env.HOME ?? '', '.cache/ms-playwright/chromium-1243/chrome-linux/chrome'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return kandidat.find(p => { try { return existsSync(p); } catch { return false; } }) ?? null;
}

const CHROME = cariChromium();
const LEWATI = !CHROME && 'chromium tidak terpasang — tes browser dilewati';
const DIST_ADA = existsSync(join(DIST, 'keamanan.html'));

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

/** Server statis kecil untuk dist/ — cukup untuk memuat halaman + asetnya. */
function buatServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let j = join(DIST, decodeURIComponent(url.pathname));
    if (j.endsWith('/')) j = join(j, 'index.html');
    if (!existsSync(j) && !extname(j)) j += '.html';
    // Jangan biarkan path keluar dari dist/
    if (!j.startsWith(DIST) || !existsSync(j)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TIPE[extname(j)] ?? 'application/octet-stream' });
    res.end(readFileSync(j));
  });
}

/** Klien CDP minimal — cukup untuk navigate + evaluate + screenshot. */
async function hubungkan(port) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const tunggu = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && tunggu.has(m.id)) { tunggu.get(m.id)(m.result); tunggu.delete(m.id); }
  });
  const kirim = (method, params = {}) => new Promise(res => { const i = ++id; tunggu.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const eval_ = async expr => (await kirim('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  return { ws, kirim, eval: eval_ };
}

describe('logo di halaman profil (browser)', { skip: LEWATI ?? (DIST_ADA ? false : 'dist/ belum dibangun') }, () => {
  let server, chrome, cdp, port;

  before(async () => {
    server = buatServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;

    const dbg = port + 1;
    chrome = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/chrome-profil-${Date.now()}`, 'about:blank',
    ], { stdio: 'ignore' });

    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${dbg}/json/version`); if (r.ok) break; } catch {}
      await sleep(250);
    }
    cdp = await hubungkan(dbg);
    await cdp.kirim('Runtime.enable');
    await cdp.kirim('Page.enable');
    await cdp.kirim('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  });

  after(() => {
    try { cdp?.ws.close(); } catch {}
    try { chrome?.kill(); } catch {}
    try { server?.close(); } catch {}
  });

  test('logo V termuat di header halaman profil', async () => {
    await cdp.kirim('Page.navigate', { url: `http://127.0.0.1:${port}/keamanan.html` });
    for (let i = 0; i < 80; i++) { await sleep(150); if (await cdp.eval('document.readyState') === 'complete') break; }

    // Tunggu logo terpasang (maks ~5 dtk) — logo-mount.js berjalan setelah DOM.
    let hasil = null;
    for (let i = 0; i < 50; i++) {
      hasil = await cdp.eval(`(() => {
        const brand = document.querySelector('.auth-nav-brand');
        if (!brand) return { tahap: 'brand-tidak-ada' };
        const img = brand.querySelector('img.brand-logo');
        if (!img) return { tahap: 'img-belum-ada', html: brand.innerHTML.slice(0, 100) };
        return {
          tahap: 'ok',
          src: img.getAttribute('src'),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          lengkap: img.complete,
        };
      })()`);
      if (hasil?.tahap === 'ok' && hasil.lengkap) break;
      await sleep(100);
    }

    assert.ok(hasil, 'evaluasi DOM harus menghasilkan nilai');
    assert.equal(hasil.tahap, 'ok',
      `logo belum terpasang (tahap: ${hasil.tahap}). ` +
      'Pastikan logo-mount.js dimuat di halaman ini.');

    // naturalWidth > 0 = gambar BENAR-BENAR termuat, bukan sekadar elemen ada.
    assert.ok(hasil.naturalWidth > 0,
      `gambar logo ada tapi tidak termuat (naturalWidth: ${hasil.naturalWidth}). ` +
      `src: ${hasil.src} — cek apakah asetnya ada di dist/.`);
  });

  test('logo tidak bisa diklik (bukan di dalam tautan)', async () => {
    const cek = await cdp.eval(`(() => {
      const img = document.querySelector('.auth-nav-brand img.brand-logo');
      if (!img) return { ada: false };
      const tautan = img.closest('a');
      const brand = document.querySelector('.auth-nav-brand');
      return {
        ada: true,
        dalamTautan: !!tautan,
        kursor: getComputedStyle(brand).cursor,
      };
    })()`);

    assert.ok(cek.ada, 'logo harus ada');
    assert.equal(cek.dalamTautan, false,
      'logo TIDAK boleh berada di dalam <a> — di halaman privat itu jebakan, ' +
      'pengguna menyentuhnya tanpa sengaja dan kehilangan isian form.');
    assert.equal(cek.kursor, 'default',
      `kursor brand harus "default", dapat "${cek.kursor}" — ` +
      'kursor pointer adalah janji "ini bisa ditekan".');
  });

  test('tidak ada menu navigasi di header', async () => {
    const cek = await cdp.eval(`(() => ({
      navLinks: document.querySelectorAll('.auth-nav-links').length,
      brandLinks: document.querySelectorAll('a.auth-nav-brand').length,
      headerText: (document.querySelector('.auth-nav')?.textContent ?? '').trim(),
    }))()`);

    assert.equal(cek.navLinks, 0, 'header tidak boleh punya menu navigasi');
    assert.equal(cek.brandLinks, 0, 'brand tidak boleh berupa tautan');
    assert.ok(!/Beranda|Harga|Panduan/.test(cek.headerText),
      `header masih memuat teks navigasi: "${cek.headerText}"`);
  });
});
