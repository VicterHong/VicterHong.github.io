#!/usr/bin/env node
/**
 * Server uji SATU ORIGIN — serve statis + proxy /api/* ke backend.
 *
 * ── KENAPA SATU ORIGIN (bukan dua port) ─────────────────────────────────────
 * Percobaan pertama memakai dua server (frontend :8802, backend :8801) dan
 * menjembataninya dengan route interception Playwright. Itu gagal karena:
 *
 *   • Playwright mengelola header `cookie` SENDIRI — header yang kita set
 *     eksplisit tidak diteruskan, sehingga cookie gate hilang dan backend
 *     menjawab `token_kosong`.
 *   • Cookie `__Host-` WAJIB Secure, dan tidak bisa disetel di halaman HTTP.
 *   • Setiap request harus di-proxy manual — rapuh dan sulit di-debug.
 *   • Dua port = dua peluang bentrok.
 *
 * Dengan SATU origin, semua masalah itu hilang: browser mengirim cookie
 * secara alami, tidak ada proxy manual, dan hanya satu port.
 *
 * ── DAN INI MENIRU PRODUKSI ─────────────────────────────────────────────────
 * Di produksi, frontend (Pages) dan backend (Worker → tunnel) juga satu
 * origin — lewat `functions/[[path]].js` yang mem-proxy `/api/*`. Jadi uji
 * ini lebih mirip produksi daripada pendekatan dua-port.
 *
 * Pakai: node serve-uji.mjs <port> <dir-statis> <url-backend>
 */

import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.argv[2] ?? 8802);
const ROOT = process.argv[3] ?? '/home/ubuntu/portfolio-victer/dist';
const BACKEND = process.argv[4] ?? 'http://127.0.0.1:8788';

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
 * Teruskan permintaan ke backend, termasuk header dan body apa adanya.
 *
 * Mengembalikan Promise yang resolve dengan { status, headers, body }.
 * Dipakai untuk semua jalur /api/*.
 */
function teruskanKeBackend(req) {
  return new Promise((resolve, reject) => {
    const opsi = {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        // Backend perlu tahu host asli untuk pemeriksaan origin.
        host: target.host,
      },
    };

    const prox = httpRequest(opsi, (res) => {
      const potongan = [];
      res.on('data', (c) => potongan.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers,
          body: Buffer.concat(potongan),
        });
      });
    });

    prox.on('error', reject);
    // Teruskan body permintaan (POST/PUT) apa adanya.
    req.pipe(prox);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // ── Jalur API: proxy ke backend ──────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    try {
      const hasil = await teruskanKeBackend(req);
      res.writeHead(hasil.status, hasil.headers);
      res.end(hasil.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'backend_tidak_terjangkau',
        message: String(err.message),
      }));
    }
    return;
  }

  // ── Jalur statis ─────────────────────────────────────────────────────────
  try {
    let jalur = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (jalur === '/' || jalur === '\\') jalur = '/index.html';

    const berkas = join(ROOT, jalur);
    if (!berkas.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(berkas).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }

    const isi = await readFile(berkas);
    res.writeHead(200, {
      'Content-Type': TIPE[extname(berkas).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': isi.length,
      'Cache-Control': 'no-store',
    });
    res.end(isi);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`PORT_DIPAKAI: ${PORT} sudah dipakai proses lain.`);
    process.exit(2);
  }
  console.error('GAGAL:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SIAP: http://127.0.0.1:${PORT} → statis: ${ROOT} · api: ${BACKEND}`);
});
