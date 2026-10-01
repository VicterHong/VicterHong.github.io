/**
 * Server HTTP layanan token portofolio.
 *
 * Hanya modul bawaan Node — tidak ada framework, tidak ada dependency pihak ketiga.
 * Bind ke loopback; akses publik lewat tunnel Cloudflare.
 */

import { createServer } from 'node:http';
import { config, validateConfig, ENV_FILE } from './config.mjs';
import { initRoutes, resolveRoute, handlePreflight } from './routes.mjs';
import { applyCors, sendJson } from './http-util.mjs';
import { closeDb } from './db.mjs';

const problems = validateConfig();
if (problems.length) {
  console.error('[startup] konfigurasi belum lengkap:');
  for (const p of problems) console.error('  -', p);
  console.error('\nBuat berkas ' + ENV_FILE + ' berisi:');
  console.error('  SERVICE_SECRET=<string acak minimal 24 karakter>');
  console.error('  ADMIN_KEY=<string acak minimal 24 karakter>');
  console.error('  SALES_EMAIL=<email sales>');
  process.exit(1);
}

initRoutes();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // CORS untuk SETIAP permintaan: preflight maupun respons sebenarnya.
  // Tanpa ini, browser memblokir jawaban walau server menjawab 200.
  applyCors(req, res);

  if (req.method === 'OPTIONS') return handlePreflight(req, res);

  const match = resolveRoute(req.method ?? 'GET', pathname);
  if (!match) {
    return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan', path: pathname });
  }

  try {
    await match.route.handler(req, res, match.params, url);
  } catch (err) {
    console.error('[server] handler error:', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'kesalahan_internal' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[startup] layanan token berjalan di http://${config.host}:${config.port}`);
  console.log(`[startup] database: ${config.dbPath}`);
  console.log(`[startup] origin diizinkan: ${config.allowedOrigins.join(', ') || '(tidak ada)'}`);
});

/** Matikan dengan bersih supaya WAL SQLite tersimpan. */
function shutdown(signal) {
  console.log(`[shutdown] menerima ${signal}, menutup...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Jaring pengaman: paksa keluar kalau koneksi menggantung.
  setTimeout(() => { closeDb(); process.exit(0); }, 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
