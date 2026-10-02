/**
 * Server HTTP layanan token portofolio.
 *
 * Hanya modul bawaan Node — tidak ada framework, tidak ada dependency pihak ketiga.
 * Bind ke loopback; akses publik lewat tunnel Cloudflare.
 */

import { createServer } from 'node:http';
import { config, validateConfig, ENV_FILE } from './config.mjs';
import { initRoutes, resolveRoute, handlePreflight, rateLimited } from './routes.mjs';
import { applyCors, sendJson } from './http-util.mjs';
import { closeDb } from './db.mjs';
import { cleanupExpiredSessions } from './sessions.mjs';
import { recordHeartbeat, cleanupHeartbeats } from './sla.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = join(__dirname, '..', 'public', 'admin.html');

/** Apakah permintaan datang dari loopback TANPA melalui tunnel.
 *  cloudflared terhubung dari 127.0.0.1 juga, jadi alamat saja tidak cukup —
 *  request lewat tunnel selalu membawa header CF-Connecting-IP / CF-Ray. */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? '';
  const fromLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  if (!fromLoopback) return false;
  // Header Cloudflare = permintaan datang dari internet lewat tunnel.
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['cf-ipcountry']) {
    return false;
  }
  // X-Forwarded-For juga menandakan perantara.
  if (req.headers['x-forwarded-for']) return false;
  return true;
}

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

// Cleanup sesi expired setiap 1 jam
setInterval(() => {
  const removed = cleanupExpiredSessions();
  if (removed > 0) console.log(`[cleanup] ${removed} sesi expired dihapus`);
  // Heartbeat disimpan 90 hari (cukup untuk laporan SLA bulanan + margin).
  cleanupHeartbeats(90 * 24 * 3_600_000);
}, 3_600_000);

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // SLA: catat setiap respons publik (bukan health check itu sendiri).
  res.on('finish', () => {
    if (pathname === '/api/health') return;
    try {
      recordHeartbeat({
        ok: res.statusCode < 500,
        latencyMs: Date.now() - startedAt,
        detail: `${req.method} ${pathname} → ${res.statusCode}`,
      });
    } catch { /* heartbeat gagal tidak boleh mengganggu respons */ }
  });

  // CORS untuk SETIAP permintaan: preflight maupun respons sebenarnya.
  // Tanpa ini, browser memblokir jawaban walau server menjawab 200.
  applyCors(req, res);

  if (req.method === 'OPTIONS') return handlePreflight(req, res);

  // Admin panel: HANYA dari loopback. Akses lewat SSH tunnel:
  //   ssh -L 8789:127.0.0.1:8788 user@vps
  //   lalu buka http://localhost:8789/admin
  if (pathname === '/admin' || pathname === '/admin/') {
    if (!isLoopback(req)) {
      return sendJson(res, 403, {
        ok: false,
        error: 'akses_ditolak',
        message: 'Panel admin hanya bisa dibuka dari server (SSH tunnel).',
      });
    }
    try {
      const html = readFileSync(ADMIN_HTML, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      return res.end(html);
    } catch {
      return sendJson(res, 500, { ok: false, error: 'admin_html_tidak_ada' });
    }
  }

  // Batas laju per-IP untuk endpoint publik — menutup brute force token
  // tak dikenal yang tidak tersentuh guard berbasis token.
  if (rateLimited(req, res, pathname)) return;

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
