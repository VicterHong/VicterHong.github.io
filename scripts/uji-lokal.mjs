#!/usr/bin/env node
/**
 * Server uji lokal: dist/ statis + /api/* diteruskan ke backend 8788.
 *
 * ── KENAPA PERLU ────────────────────────────────────────────────────────────
 * `python3 -m http.server` hanya menyajikan berkas; permintaan /api/akses
 * dijawab 404, sehingga halaman selalu jatuh ke status "belum masuk" dan
 * gating tidak bisa diuji untuk pengguna login. Skrip ini menambahkan satu
 * hal itu saja — tanpa build step, tanpa dependency.
 *
 * Jalankan: node scripts/uji-lokal.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] ?? 8899);
const BACKEND = 'http://127.0.0.1:8788';

const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ── /api/* → backend ──────────────────────────────────────────────────────
  // Header cookie diteruskan apa adanya: sesi uji disimpan di situ.
  if (url.pathname.startsWith('/api/')) {
    try {
      const r = await fetch(BACKEND + url.pathname + url.search, {
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:8788' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
        duplex: 'half',
      });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'backend_mati', detail: err.message }));
    }
    return;
  }

  // ── Statis dari dist/ ─────────────────────────────────────────────────────
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path.endsWith('/')) path += 'home.html';

  let file = join(DIST, path);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    // Tanpa ekstensi → coba .html (mis. /home → home.html)
    if (!extname(path)) {
      try { await stat(file + '.html'); file += '.html'; }
      catch { res.writeHead(404); res.end('404'); return; }
    } else {
      res.writeHead(404); res.end('404'); return;
    }
  }

  try {
    const isi = await readFile(file);
    res.writeHead(200, { 'content-type': TIPE[extname(file)] ?? 'application/octet-stream' });
    res.end(isi);
  } catch {
    res.writeHead(404); res.end('404');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`uji lokal: http://127.0.0.1:${PORT}  (dist/ + /api → ${BACKEND})`);
});
