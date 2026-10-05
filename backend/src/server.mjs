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
import { recordHeartbeat, cleanupHeartbeats, flushHeartbeats } from './sla.mjs';
import { pruneAll } from './retention.mjs';
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

/**
 * Penangan permintaan — dipakai oleh SEMUA listener (IPv4 + IPv6).
 * Dipisah jadi fungsi supaya logikanya tidak terduplikasi.
 *
 * Dua lapis, dan pemisahan ini disengaja:
 *   requestHandler — pembungkus tipis. Tugasnya HANYA memastikan satu
 *                    request rusak tidak bisa mematikan proses.
 *   handleRequest  — logika sebenarnya.
 *
 * Kenapa dipisah: `resolveRoute()`, `rateLimited()`, dan `new URL()`
 * dipanggil SEBELUM blok try yang lama. Ketiganya bisa melempar
 * (URIError dari decodeURIComponent, TypeError dari header Host rusak).
 * Karena fungsi ini async, lemparan itu menjadi unhandledRejection —
 * dan di Node ≥15 itu MEMATIKAN proses. systemd me-restart, tapi state
 * rate limit di memori ikut tereset, jadi penyerang bisa mengulanginya
 * tanpa henti. Pembungkus ini menutup celah itu.
 */
async function requestHandler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[server] request gagal:', err?.stack ?? err);
    if (!res.headersSent) {
      sendJson(res, 400, { ok: false, error: 'permintaan_tidak_valid' });
    } else {
      res.destroy();
    }
  }
}

async function handleRequest(req, res) {
  const startedAt = Date.now();

  // Base URL TETAP, tidak memakai req.headers.host.
  // Header Host dikendalikan klien — nilai seperti "[" atau "a b" membuat
  // new URL() melempar TypeError, dan sebelum perbaikan ini itu mematikan
  // proses. Path yang dipakai dispatcher hanya butuh pathname, jadi host
  // palsu tidak memberi keuntungan apa pun pada penyerang.
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return sendJson(res, 400, { ok: false, error: 'url_tidak_valid' });
  }
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

  // ── API admin: HANYA dari loopback ─────────────────────────────────────────
  //
  // Sebelum ini, /api/admin/* terjangkau dari internet lewat tunnel Cloudflare
  // dan hanya dijaga oleh kunci statis. Satu kebocoran kunci = kendali penuh
  // atas ±30 endpoint (terbitkan/cabut token, ekspor lead, publish).
  //
  // Panel admin memang selalu dibuka lewat SSH tunnel ke localhost, jadi
  // menutup jalur publik tidak mengurangi fungsionalitas sama sekali.
  //
  // Dijawab 404 (bukan 403) dengan sengaja: 403 mengonfirmasi bahwa endpoint
  // itu ADA, sehingga penyerang tahu harus mencoba kunci. 404 tidak memberi
  // petunjuk apa pun — dari luar, seolah endpoint itu memang tidak ada.
  if (pathname.startsWith('/api/admin/') || pathname === '/api/admin') {
    if (!isLoopback(req)) {
      return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });
    }
  }

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
    // Path TIDAK dikembalikan di respons. Mengembalikannya hanya
    // mengonfirmasi ke penyerang bagaimana input mereka dinormalisasi
    // (mis. bahwa '/etc/passwd' sampai utuh ke sini) — tidak ada gunanya
    // untuk klien yang sah, karena mereka sudah tahu path yang dipanggil.
    return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });
  }

  try {
    await match.route.handler(req, res, match.params, url);
  } catch (err) {
    console.error('[server] handler error:', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'kesalahan_internal' });
  }
}

// Cleanup sesi expired setiap 1 jam.
// Dibungkus try/catch: kalau DB sedang terkunci (mis. backup sedang jalan),
// error di sini sebelumnya bisa mematikan proses — padahal ini tugas
// pemeliharaan, bukan hal yang perlu menghentikan layanan.
setInterval(() => {
  try {
    const removed = cleanupExpiredSessions();
    if (removed > 0) console.log(`[cleanup] ${removed} sesi expired dihapus`);
    // Heartbeat disimpan 90 hari (cukup untuk laporan SLA bulanan + margin).
    cleanupHeartbeats(90 * 24 * 3_600_000);
  } catch (err) {
    console.error('[cleanup] gagal:', err?.message ?? err);
  }
}, 3_600_000);

/**
 * Flush agregat SLA berkala (A1).
 *
 * `recordHeartbeat` menulis saat MENIT BERGANTI, jadi pada trafik normal
 * tidak perlu timer. Tapi pada trafik SEPI (mis. situs tidak dikunjungi
 * semalaman), akumulator menit terakhir bisa tertahan sampai ada request
 * berikutnya. Flush tiap menit memastikan data tidak tertahan lama.
 *
 * Biayanya nyaris nol: kalau tidak ada request, `flushHeartbeats()`
 * langsung kembali tanpa menulis apa pun.
 */
setInterval(() => {
  try { flushHeartbeats(); } catch (err) {
    console.error('[sla] flush berkala gagal:', err?.message ?? err);
  }
}, 60_000).unref();

/**
 * Retensi data (A3) — dijalankan SEKALI SEHARI, bukan tiap jam.
 *
 * Kenapa terpisah dari cleanup per jam: retensi menyentuh tabel besar
 * (access_events, analytics_events) dan menghapus bertahap per batch.
 * Menjalankannya tiap jam hanya menambah beban tanpa manfaat — umur simpan
 * dihitung dalam HARI, jadi sekali sehari sudah tepat.
 *
 * Jam 04:30 dipilih karena: backup jalan 03:45 (selesai jauh sebelum ini),
 * dan log rotation 04:15. Ketiganya berurutan, tidak bertabrakan — penting
 * karena DatabaseSync sinkron: dua tugas berat bersamaan akan saling
 * memblokir di satu CPU.
 *
 * maxBatches dibatasi 50 per tabel per hari (≈100 ribu baris/hari pada
 * batch 2000). Kalau ada tumpukan besar, habis dalam beberapa hari tanpa
 * pernah mengganggu layanan.
 */
function msUntilNext(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleRetention() {
  const delay = msUntilNext(4, 30);
  setTimeout(async () => {
    try {
      const results = await pruneAll({ batch: 2000, maxBatches: 50 });
      for (const r of results) {
        if (r.error) console.error(`[retensi] ${r.table}: gagal — ${r.error}`);
        else if (r.deleted > 0) {
          console.log(`[retensi] ${r.table}: ${r.deleted} baris dihapus${r.done ? '' : ' (masih ada sisa)'}`);
        }
      }
    } catch (err) {
      console.error('[retensi] gagal:', err?.message ?? err);
    }
    scheduleRetention(); // jadwalkan hari berikutnya
  }, delay).unref();
}
scheduleRetention();

/**
 * Bind ke KEDUA alamat loopback (IPv4 + IPv6).
 *
 * Kenapa: di banyak sistem `localhost` di-resolve ke `::1` (IPv6) lebih dulu.
 * Kalau layanan hanya listen di IPv4, SSH tunnel dengan target `localhost`
 * (mis. `ssh -L 8789:localhost:8788`) akan gagal — browser menggantung.
 * Dengan listen di dua-duanya, cara apa pun menulis `localhost` tetap bekerja.
 *
 * Tetap aman: hanya alamat loopback, tidak ada antarmuka publik.
 */
const servers = [];

function startListener(host, label) {
  const s = createServer(requestHandler);
  s.on('error', (err) => {
    // Satu keluarga alamat tidak tersedia (mis. IPv6 dimatikan) bukan masalah:
    // listener lain tetap melayani.
    console.error(`[startup] listener ${label} (${host}) gagal: ${err.message}`);
  });
  s.listen(config.port, host, () => {
    console.log(`[startup] ${label} → http://${host}:${config.port}`);
  });
  servers.push(s);
  return s;
}

startListener('127.0.0.1', 'IPv4');
startListener('::1', 'IPv6');

console.log(`[startup] database: ${config.dbPath}`);
console.log(`[startup] origin diizinkan: ${config.allowedOrigins.join(', ') || '(tidak ada)'}`);

/** Matikan dengan bersih supaya WAL SQLite tersimpan. */
function shutdown(signal) {
  console.log(`[shutdown] menerima ${signal}, menutup...`);

  // A1: tulis akumulator SLA yang belum tersimpan SEBELUM menutup DB.
  // Tanpa ini, sampai 60 detik terakhir data heartbeat hilang setiap kali
  // service di-restart — dan restart terjadi setiap deploy.
  try {
    const flushed = flushHeartbeats();
    if (flushed > 0) console.log(`[shutdown] ${flushed} heartbeat ditulis`);
  } catch (err) {
    console.error('[shutdown] flush SLA gagal:', err?.message ?? err);
  }

  let pending = servers.length;
  const done = () => {
    if (--pending <= 0) {
      closeDb();
      process.exit(0);
    }
  };
  for (const s of servers) s.close(done);
  // Jaring pengaman: paksa keluar kalau koneksi menggantung.
  setTimeout(() => { closeDb(); process.exit(0); }, 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Jaring pengaman terakhir.
 *
 * requestHandler sudah membungkus semua yang ia panggil, tapi kode di
 * luar jalur itu (timer, event emitter, promise yang lupa di-await) bisa
 * melempar tanpa tertangkap. Tanpa handler ini, Node mematikan proses.
 *
 * Sengaja HANYA mencatat, bukan keluar: satu bug di jalur pinggir tidak
 * seharusnya menghentikan layanan yang sedang melayani pengunjung.
 * Kalau ada yang benar-benar fatal, health check akan menangkapnya.
 */
process.on('unhandledRejection', (err) => {
  console.error('[fatal-dicegah] unhandledRejection:', err?.stack ?? err);
});

process.on('uncaughtException', (err) => {
  // Ini lebih serius dari unhandledRejection — state proses bisa rusak.
  // Dicatat, lalu keluar dengan kode error supaya systemd me-restart
  // dengan state bersih (bukan melanjutkan dengan state yang tidak pasti).
  console.error('[fatal] uncaughtException:', err?.stack ?? err);
  shutdown('uncaughtException');
});
