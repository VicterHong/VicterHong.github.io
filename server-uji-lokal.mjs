/**
 * Server uji lokal — menyajikan berkas statis DAN meneruskan /api ke backend.
 *
 * ── KENAPA PERLU ───────────────────────────────────────────────────────────
 * Di produksi, Cloudflare menyajikan berkas statis dan meneruskan /api ke
 * backend. Di mesin lokal keduanya terpisah: berkas statis dari disk,
 * backend di port 8788.
 *
 * Tanpa proxy ini, halaman pricing akan memanggil /api/pricing ke server
 * statis — yang menjawab 404. Halaman tidak akan pernah bisa diuji.
 *
 * Dengan proxy, halaman melihat SATU origin yang sama persis seperti di
 * produksi. Tidak ada perbedaan antara yang diuji dan yang dipakai.
 *
 * ── KENAPA TIDAK DEPLOY ────────────────────────────────────────────────────
 * Ini murni untuk pengujian lokal. Tidak ada perintah deploy di sini, dan
 * tidak ada yang dikirim ke internet.
 *
 * Jalankan:  node server-uji-lokal.mjs
 * Buka:      http://127.0.0.1:8899/pricing
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8899);
const HOST = '127.0.0.1';
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8788';
const ROOT = resolve(import.meta.dirname);

/** Tipe konten per ekstensi. */
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
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

/**
 * Teruskan permintaan ke backend.
 *
 * Header `host` diganti dengan host backend — backend memakai host untuk
 * menentukan origin, dan meneruskan host asli bisa membuatnya menolak
 * permintaan yang seharusnya diterima.
 */
async function teruskan(req, res) {
  const target = new URL(req.url, BACKEND);

  const headers = { ...req.headers };
  delete headers.host;
  headers.host = new URL(BACKEND).host;

  const init = {
    method: req.method,
    headers,
    redirect: 'manual',
  };

  // Badan permintaan hanya untuk metode yang memang membawanya.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const potongan = [];
    for await (const c of req) potongan.push(c);
    if (potongan.length) init.body = Buffer.concat(potongan);
  }

  try {
    const jawab = await fetch(target, init);

    // Salin header — kecuali yang mengganggu pembacaan di lokal.
    const keluar = {};
    for (const [k, v] of jawab.headers) {
      if (k === 'content-encoding' || k === 'transfer-encoding') continue;
      keluar[k] = v;
    }

    res.writeHead(jawab.status, keluar);
    const buf = Buffer.from(await jawab.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error('[proxy] gagal:', err?.message ?? err);
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: false,
      error: 'backend_tidak_terjangkau',
      detail: `Tidak bisa menghubungi ${BACKEND}. Jalankan backend dulu.`,
    }));
  }
}

/** Sajikan berkas statis dari disk. */
async function sajikan(pathname, res) {
  // Normalisasi & pastikan tidak keluar dari ROOT (path traversal).
  const bersih = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let jalur = join(ROOT, bersih);

  if (!jalur.startsWith(ROOT)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('403 — di luar akar');
  }

  try {
    let info = await stat(jalur);

    if (info.isDirectory()) {
      jalur = join(jalur, 'index.html');
      info = await stat(jalur);
    }

    // Coba .html kalau yang diminta tanpa ekstensi (mis. /pricing)
    if (!info.isFile()) throw new Error('bukan berkas');

    const isi = await readFile(jalur);
    const tipe = TIPE[extname(jalur).toLowerCase()] ?? 'application/octet-stream';

    res.writeHead(200, {
      'content-type': tipe,
      'content-length': isi.length,
      // Jangan cache di lokal — supaya perubahan langsung terlihat.
      'cache-control': 'no-store',
    });
    res.end(isi);
  } catch {
    // Coba sebagai .html
    if (!extname(jalur)) {
      try {
        const html = await readFile(`${jalur}.html`);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': html.length,
          'cache-control': 'no-store',
        });
        return res.end(html);
      } catch { /* lanjut ke 404 */ }
    }

    const notFound = join(ROOT, '404.html');
    try {
      const html = await readFile(notFound);
      res.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': html.length,
      });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 — tidak ditemukan');
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
  const pathname = url.pathname;

  const catat = `${req.method} ${pathname}`;

  // Teruskan semua /api/* ke backend.
  if (pathname.startsWith('/api/')) {
    console.log(`  → ${catat} (proxy)`);
    return teruskan(req, res);
  }

  console.log(`  · ${catat}`);
  return sajikan(pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ════════════════════════════════════════════════');
  console.log('   Server uji lokal — pricing');
  console.log('  ════════════════════════════════════════════════');
  console.log('');
  console.log(`   Halaman  : http://${HOST}:${PORT}/pricing`);
  console.log(`   Statis   : ${ROOT}`);
  console.log(`   Backend  : ${BACKEND} (diteruskan untuk /api/*)`);
  console.log('');
  console.log('   Tidak ada deploy. Semua lokal.');
  console.log('  ════════════════════════════════════════════════');
  console.log('');
});
