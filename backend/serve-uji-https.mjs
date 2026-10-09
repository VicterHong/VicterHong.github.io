#!/usr/bin/env node
/**
 * Server uji SATU ORIGIN dengan HTTPS — statis + proxy /api/*.
 *
 * ── KENAPA SATU ORIGIN ──────────────────────────────────────────────────────
 * Pendekatan dua-port (frontend + backend) gagal karena:
 *   • Cookie tidak diteruskan antar-origin tanpa konfigurasi manual
 *   • Playwright mengelola header `cookie` sendiri — header yang kita set
 *     eksplisit diabaikan, sehingga cookie gate hilang
 *   • Setiap request harus di-proxy manual → rapuh
 *
 * Satu origin menghilangkan semua itu — dan meniru produksi, di mana
 * Pages Function juga mem-proxy /api/* ke Worker.
 *
 * ── KENAPA HTTPS ────────────────────────────────────────────────────────────
 * Cookie `__Host-portfolio_gate` WAJIB Secure menurut spesifikasi. Browser
 * menolaknya di HTTP. Alternatifnya adalah mengubah kode produksi agar
 * tidak memakai `__Host-` — itu melemahkan keamanan hanya demi kenyamanan
 * uji, pertukaran yang salah. Jadi uji memakai HTTPS dengan sertifikat
 * self-signed (Chromium dijalankan dengan --ignore-certificate-errors).
 *
 * Pakai: node serve-uji-https.mjs <port> <dir> <backend-url> <cert> <key>
 */

import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.argv[2] ?? 8802);
const ROOT = process.argv[3] ?? '/home/ubuntu/portfolio-victer/dist';
const BACKEND = process.argv[4] ?? 'http://127.0.0.1:8788';
const CERT = process.argv[5];
const KEY = process.argv[6];

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const target = new URL(BACKEND);

/**
 * Teruskan permintaan ke backend, header & body apa adanya.
 *
 * Modul request dipilih dari SKEMA URL backend: backend uji berjalan di
 * HTTP (tanpa TLS), jadi memakai httpsRequest akan gagal dengan
 * `SSL routines: tls_validate_record_header`. Ini benar-benar terjadi —
 * proxy mengirim ClientHello TLS ke server yang berbicara HTTP polos.
 */
function teruskan(req) {
  const pengirim = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const prox = pengirim({
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    }, (res) => {
      const potongan = [];
      res.on('data', (c) => potongan.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 502,
        headers: res.headers,
        body: Buffer.concat(potongan),
      }));
    });
    prox.on('error', reject);
    req.pipe(prox);
  });
}

/** Handler bersama untuk HTTP dan HTTPS. */
async function tangani(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    try {
      const h = await teruskan(req);
      res.writeHead(h.status, h.headers);
      res.end(h.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'backend_mati', message: String(err.message) }));
    }
    return;
  }

  // ── /avatar/<nama> — DILAYANI DI SINI, BUKAN DI-PROXY ───────────────────────
  //
  // Di produksi, /avatar dibuat oleh Worker (workers/site.ts). Server uji ini
  // hanya mem-proxy /api/*, jadi /avatar 404 — dan uji otomatis melaporkan
  // "gambar avatar tidak termuat" padahal di produksi bekerja. Gejalanya
  // menyesatkan: fitur terlihat rusak di uji, padahal tidak.
  //
  // Dibuat di sini, bukan di-proxy: Worker butuh tunnel + kredensial
  // Cloudflare. Rumus SVG-nya sama, jadi hasilnya identik.
  if (url.pathname.startsWith('/avatar/')) {
    const nama = decodeURIComponent(url.pathname.slice('/avatar/'.length)).slice(0, 80);

    const kata = nama.trim().split(/[\s._-]+/).filter(Boolean);
    const inisial = (kata.length >= 2
      ? kata[0][0] + kata[1][0]
      : (nama || '?').slice(0, 2)).toUpperCase() || '?';

    // Warna stabil dari hash — nama sama selalu dapat warna sama.
    let h = 0;
    for (let i = 0; i < (nama || '?').length; i += 1) {
      h = (h * 31 + (nama || '?').charCodeAt(i)) >>> 0;
    }
    const hue = 38 + (h % 15);            // emas 38–52: keluarga aksen situs
    const warna = 'hsl(' + hue + ' 61% 50%)';
    const latar = h % 2 === 0 ? '#0e1116' : '#11151b';

    const esc = (t) => String(t).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="' + esc(inisial) + '">'
      + '<rect width="128" height="128" rx="23" fill="' + latar + '"/>'
      + '<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Satoshi,sans-serif" font-size="54" font-weight="600" fill="' + warna + '">' + esc(inisial) + '</text>'
      + '</svg>';

    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(svg);
    return;
  }

  try {
    let jalur = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (jalur === '/' || jalur === '\\') jalur = '/index.html';

    // ── CLEAN URLS: /masuk → masuk.html ────────────────────────────────────
    //
    // ── KENAPA INI PENTING (BUG UJI YANG MENGHABISKAN WAKTU) ───────────────
    // Cloudflare Pages menyajikan `sign-in.html` di URL `/sign-in` secara OTOMATIS
    // (fitur "clean URLs"). Server uji ini awalnya tidak — jadi setiap tautan
    // ke `/sign-in` menghasilkan 404 di uji, padahal di produksi bekerja.
    //
    // Gejalanya sangat menyesatkan: setelah mendaftar, redirect ke
    // `/sign-in?email=...` menghasilkan halaman 404 kosong. Uji melaporkan
    // "email tidak terisi" — padahal #inpEmailMasuk memang tidak ada karena
    // halaman yang dimuat adalah 404.
    //
    // Perbaikan: kalau berkas tidak ditemukan, coba tambahkan `.html` dan
    // coba lagi. Ini meniru perilaku Pages.
    let berkas = join(ROOT, jalur);
    if (!berkas.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    let info = await stat(berkas).catch(() => null);
    if (!info || !info.isFile()) {
      // Coba sebagai .html (perilaku clean URLs Cloudflare Pages)
      if (!extname(jalur)) {
        const berkasHtml = join(ROOT, jalur + '.html');
        const infoHtml = await stat(berkasHtml).catch(() => null);
        if (infoHtml?.isFile()) {
          berkas = berkasHtml;
          info = infoHtml;
          jalur = jalur + '.html';
        }
      }
    }
    if (!info || !info.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }

    const isi = await readFile(berkas);
    const ext = extname(berkas).toLowerCase();

    // ── TULIS ULANG SITEKEY UNTUK UJI ───────────────────────────────────────
    //
    // Sitekey Turnstile di-hardcode di HTML (nilai produksi). Uji tidak bisa
    // memakai sitekey produksi: ia menuntut domain produksi yang sebenarnya,
    // dan token dari sitekey itu hanya sah di sana.
    //
    // Sitekey UJI Cloudflare (`1x00000000000000000000AA`) selalu lolos tanpa
    // interaksi, tapi tetap melalui SELURUH alur nyata — widget dirender,
    // token dibuat Cloudflare, server memverifikasi ke Cloudflare. Itu yang
    // membuat uji ini sungguhan, bukan token palsu yang disuntikkan.
    //
    // Penulisan ulang hanya terjadi di server uji. Berkas sumber tidak diubah,
    // jadi produksi tetap memakai sitekey produksi.
    const sitekeyUji = process.env.SITEKEY_UJI;
    if (sitekeyUji && (ext === '.html' || ext === '.js')) {
      let teks = isi.toString('utf8');
      // Ganti sitekey produksi (0x4AAAAAA...) di konfigurasi halaman.
      const sebelum = teks;
      teks = teks.replace(/(siteKey:\s*')0x[0-9A-Za-z]+(')/g, `$1${sitekeyUji}$2`);
      if (teks !== sebelum) {
        res.writeHead(200, {
          'Content-Type': TIPE[ext] ?? 'application/octet-stream',
          'Content-Length': Buffer.byteLength(teks),
          'Cache-Control': 'no-store',
        });
        res.end(teks);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': TIPE[ext] ?? 'application/octet-stream',
      'Content-Length': isi.length,
      'Cache-Control': 'no-store',
    });
    res.end(isi);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
  }
}

let server;
if (CERT && KEY) {
  try {
    server = createHttpsServer(
      { cert: readFileSync(CERT), key: readFileSync(KEY) },
      tangani,
    );
  } catch (e) {
    console.error('GAGAL baca sertifikat:', e.message);
    process.exit(1);
  }
} else {
  // Tanpa sertifikat → HTTP. Cookie `__Host-` tidak akan bekerja,
  // tapi berguna untuk memeriksa tampilan saja.
  server = createHttpServer(tangani);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`PORT_DIPAKAI: ${PORT}`);
    process.exit(2);
  }
  console.error('GAGAL:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const proto = CERT && KEY ? 'https' : 'http';
  console.log(`SIAP: ${proto}://127.0.0.1:${PORT} → ${ROOT} · api: ${BACKEND}`);
});
