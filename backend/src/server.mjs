/**
 * Server HTTP layanan token portofolio.
 *
 * Hanya modul bawaan Node — tidak ada framework, tidak ada dependency pihak ketiga.
 * Bind ke loopback; akses publik lewat tunnel Cloudflare.
 */

import { createServer } from 'node:http';
import { config, validateConfig, validateWarnings, ENV_FILE } from './config.mjs';
import { initRoutes, resolveRoute, handlePreflight, rateLimited } from './routes.mjs';
import { applyCors, sendJson, mutationAllowed, clientIp } from './http-util.mjs';
import { closeDb } from './db.mjs';
import { tanganiAksesAplikasi } from './akses-halaman.mjs';
import { cleanupExpiredSessions } from './sessions.mjs';
import { recordHeartbeat, cleanupHeartbeats, flushHeartbeats } from './sla.mjs';
import { pruneAll } from './retention.mjs';
// ── Worker Sentinel: pengirim webhook berkala ────────────────────────────────
// Tanpa ini, pesan masuk antrean dan tidak pernah terkirim — backoff dan DLQ
// tidak ada gunanya kalau tidak ada yang mencoba mengirim berulang kali.
import { jalankanPutaran } from './sentinel/pengirim.mjs';

// ── PENGHAPUSAN AKUN (model korporat) ───────────────────────────────────────
//
// Dipanggil penjadwal di bawah untuk membersihkan akun yang sudah lewat masa
// tinjauan. Logikanya di modul terpisah supaya bisa diuji tanpa server HTTP.
import { bersihkanAkunKedaluwarsa } from './purge-akun.mjs';
import { sweepRateLimit } from './rate-limit.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = join(__dirname, '..', 'public', 'admin.html');

/** Halaman inspector Sentinel — hanya disajikan dari loopback. */
const SENTINEL_HTML = join(__dirname, '..', 'public', 'sentinel.html');

/** Direktori aset yang TIDAK ikut ter-deploy publik. */
const PUBLIC_DIR = join(__dirname, '..', 'public');

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

// Peringatan konfigurasi — layanan TETAP JALAN.
//
// Dipisahkan dari `problems` karena keduanya punya konsekuensi berbeda.
// Peringatan muncul untuk hal yang hanya bisa diperiksa BENTUKNYA di sini,
// sementara kebenarannya bergantung pada keadaan luar — misalnya apakah
// domain EMAIL_FROM sudah diverifikasi di dashboard penyedia email.
//
// Versi pertama pemeriksaan ini memblokir startup, dan akibatnya layanan
// MATI justru setelah domainnya berhasil diverifikasi. Peringatan tidak
// boleh mematikan layanan.
for (const w of validateWarnings()) console.warn('[startup] peringatan:', w);

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
export async function requestHandler(req, res) {
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

  if (!mutationAllowed(req)) {
    return sendJson(res, 403, { ok: false, error: 'origin_ditolak' });
  }

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

  // ══ SENTINEL INSPECTOR: HANYA DARI LOOPBACK ═══════════════════════════════
  //
  // ── KENAPA DIBATASI LOOPBACK, SAMA SEPERTI /admin ─────────────────────────
  // Halaman ini memuat body webhook — data pembayaran, email pelanggan, ID
  // pesanan — dan tombol yang bisa memicu pengiriman ke layanan luar.
  //
  // Aksesnya lewat SSH tunnel:
  //   ssh -L 8789:127.0.0.1:8788 user@vps
  //   lalu buka http://localhost:8789/sentinel
  //
  // ── KENAPA TIDAK DI dist/ ═════════════════════════════════════════════════
  // dist/ adalah aset publik Cloudflare Pages. Apa pun yang ada di sana bisa
  // diunduh siapa pun yang tahu URL-nya — dan kunci admin di halaman ini tidak
  // mencegah halamannya sendiri terunduh.
  if (pathname === '/sentinel' || pathname === '/sentinel/') {
    if (!isLoopback(req)) {
      return sendJson(res, 403, {
        ok: false,
        error: 'akses_ditolak',
        message: 'Inspector hanya bisa dibuka dari server (SSH tunnel).',
      });
    }
    try {
      const html = readFileSync(SENTINEL_HTML, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        // ── CSP: HANYA SUMBER SENDIRI ────────────────────────────────────────
        // `connect-src 'self'` membatasi fetch ke origin yang sama. Kalau ada
        // payload yang berhasil menyuntikkan skrip, ia tidak bisa mengirim data
        // ke server lain.
        'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com; font-src 'self' https://api.fontshare.com https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; img-src 'self' data:",
      });
      return res.end(html);
    } catch {
      return sendJson(res, 500, { ok: false, error: 'sentinel_html_tidak_ada' });
    }
  }

  // Aset inspector: CSS dan JS. Loopback saja, sama seperti halamannya.
  if (pathname.startsWith('/sentinel-assets/')) {
    if (!isLoopback(req)) {
      return sendJson(res, 403, { ok: false, error: 'akses_ditolak' });
    }

    // ── DAFTAR PUTIH, BUKAN GABUNG PATH ═════════════════════════════════════
    // `join(PUBLIC_DIR, pathname)` dengan pathname yang berisi `../` bisa
    // membaca berkas mana pun di server. Daftar putih membuat itu tidak mungkin
    // — hanya dua berkas ini yang bisa diambil.
    const diizinkan = {
      '/sentinel-assets/css/sentinel.css': ['text/css; charset=utf-8', 'assets/css/sentinel.css'],
      '/sentinel-assets/js/sentinel.js': ['text/javascript; charset=utf-8', 'assets/js/sentinel.js'],
    };

    const entri = diizinkan[pathname];
    if (!entri) return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });

    try {
      const isi = readFileSync(join(PUBLIC_DIR, entri[1]));
      res.writeHead(200, {
        'content-type': entri[0],
        'content-length': isi.length,
        'cache-control': 'no-store',
      });
      return res.end(isi);
    } catch {
      return sendJson(res, 500, { ok: false, error: 'aset_tidak_ada' });
    }
  }

  // Batas laju per-IP untuk endpoint publik — menutup brute force token
  // tak dikenal yang tidak tersentuh guard berbasis token.
  if (rateLimited(req, res, pathname)) return;

  // ── APLIKASI REACT PENUH DI BALIK KUNCI AKSES ──────────────────────────────
  // Ditangani SEBELUM resolveRoute karena path-nya memuat kode 64 hex dan
  // asetnya bersarang di bawahnya — bukan pola rute biasa.
  //
  // Diletakkan SETELAH rate limit supaya percobaan menebak kode tetap dibatasi.
  if (pathname.startsWith('/s/')) {
    const ditangani = tanganiAksesAplikasi(req, res, pathname, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });
    if (ditangani) return;
  }

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
}, 3_600_000).unref();

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
 * Bersihkan rate limiter (A6) — tiap 5 menit, TERLEPAS dari trafik.
 *
 * ── KENAPA HARUS TIMER SENDIRI ──────────────────────────────────────────────
 *
 * Sebelumnya pembersihan dipanggil di dalam checkRateLimit() — artinya
 * hanya berjalan kalau ada request. Dua akibatnya:
 *
 * 1. Kalau trafik berhenti, Map tidak pernah dibersihkan dan memori tetap
 *    terpakai sampai proses restart.
 * 2. Kalau trafik padat, pembersihan jalan terus — dan versi lama
 *    mengalokasi array baru per key, jadi justru memperberat event loop
 *    tepat saat server sedang sibuk.
 *
 * Jendela rate limit terpanjang adalah 1 jam, jadi menyapu tiap 5 menit
 * dengan batas 1 jam sudah lebih dari cukup. Entri yang lebih muda dari
 * 1 jam memang MASIH BERLAKU — tidak boleh dibuang.
 */
setInterval(() => {
  try {
    const removed = sweepRateLimit(Date.now(), 3_600_000);
    if (removed > 0) console.log(`[rate-limit] ${removed} entri kedaluwarsa dibuang`);
  } catch (err) {
    console.error('[rate-limit] sweep gagal:', err?.message ?? err);
  }
}, 300_000).unref();

/**
 * Bersihkan akun yang sudah lewat masa tinjauan — model korporat.
 *
 * ── KENAPA PENJADWAL INI WAJIB ADA ──────────────────────────────────────────
 *
 * Ada DUA jalur yang menghasilkan penghapusan permanen:
 *   1. Admin menyetujui permintaan → status 'siap_hapus'
 *   2. Lewat 12 bulan tanpa tinjauan → status 'menunggu_hapus' kedaluwarsa
 *
 * Tanpa penjadwal, jalur 2 tidak pernah jalan — akun yang tidak pernah
 * ditinjau menumpuk SELAMANYA, dan itu melanggar prinsip penyimpanan
 * terbatas GDPR (Pasal 5(1)(e)).
 *
 * ── KENAPA TIAP 6 JAM ───────────────────────────────────────────────────────
 *
 * Penghapusan bukan operasi mendesak: masa tunggunya 12 bulan, jadi
 * menjalankannya 4x sehari sudah sangat cukup.
 *
 * Lebih jarang (mis. sekali sehari) berarti admin yang menyetujui pagi harus
 * menunggu sampai besok untuk melihat hasilnya. Lebih sering (mis. tiap
 * menit) hanya membuang siklus CPU untuk query yang hampir selalu kosong.
 */
setInterval(() => {
  try {
    const hasil = bersihkanAkunKedaluwarsa();
    if (hasil.berhasil > 0 || hasil.gagal > 0) {
      console.log(`[purge] ${hasil.berhasil} akun dihapus permanen`
        + (hasil.gagal ? `, ${hasil.gagal} gagal` : ''));
    }
  } catch (err) {
    // Sama seperti pembersih lain: kalau DB sedang terkunci (backup berjalan),
    // error di sini TIDAK BOLEH mematikan proses.
    console.error('[purge] gagal:', err?.message ?? err);
  }
}, 6 * 3_600_000).unref();

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

/* ══ WORKER SENTINEL — PENGIRIM WEBHOOK BERKALA ═════════════════════════════
 *
 * ── KENAPA INI ADA ─────────────────────────────────────────────────────────
 * Tanpa worker, pesan masuk antrean dan TIDAK PERNAH terkirim. Antreannya
 * penuh, inspector menampilkan tumpukan "menunggu", dan tidak ada yang
 * bergerak — kecuali ada yang menekan "Kirim sekarang" secara manual.
 *
 * Itu membuat seluruh mekanisme backoff dan DLQ tidak ada gunanya: keduanya
 * hanya bekerja kalau ADA yang mencoba mengirim berulang kali.
 *
 * ── KENAPA setTimeout BERANTAI, BUKAN setInterval ──────────────────────────
 * `setInterval` menjadwalkan putaran berikutnya TANPA menunggu yang sekarang
 * selesai. Kalau satu putaran lambat (banyak pesan, atau jaringan lambat),
 * putaran berikutnya menumpuk di atasnya — dan itu berulang sampai server
 * kehabisan sumber daya.
 *
 * Dengan `setTimeout` berantai, jeda dihitung SETELAH putaran selesai. Tidak
 * mungkin ada dua putaran berjalan bersamaan.
 *
 * ── KENAPA DI-UNREF ────────────────────────────────────────────────────────
 * Timer yang tidak di-unref menahan proses tetap hidup. Saat shutdown, itu
 * berarti service tidak pernah benar-benar berhenti dan systemd harus
 * membunuhnya paksa — dan SQLite tidak sempat menutup WAL dengan bersih.
 */
function scheduleSentinel() {
  setTimeout(async () => {
    try {
      // Batas 10 per putaran: cukup untuk mengosongkan tumpukan kecil,
      // tidak cukup untuk membuat satu putaran berjalan sampai timeout.
      const ringkas = await jalankanPutaran({ batas: 10 });

      // ── HANYA CATAT KALAU ADA KEGIATAN ────────────────────────────────────
      // Putaran kosong terjadi setiap 15 detik. Mencatatnya berarti log
      // terisi ribuan baris "0 terkirim" sehari, dan baris yang penting
      // tenggelam di antaranya.
      if (ringkas.terkirim || ringkas.gagal || ringkas.dilewati || ringkas.masukDlq) {
        console.log(
          `[sentinel] putaran: ${ringkas.terkirim} terkirim, ${ringkas.gagal} gagal`
          + (ringkas.dilewati ? `, ${ringkas.dilewati} dilewati (sirkuit)` : '')
          + (ringkas.masukDlq ? `, ${ringkas.masukDlq} masuk DLQ` : ''),
        );
      }
    } catch (err) {
      // Kegagalan satu putaran TIDAK boleh menghentikan worker. Kalau
      // penjadwalan ulang dilewati, webhook berhenti terkirim selamanya
      // dan tidak ada yang memberi tahu.
      console.error('[sentinel] putaran gagal:', err?.message ?? err);
    }
    scheduleSentinel();
  }, config.sentinelIntervalMs).unref();
}

// ── HANYA JALAN KALAU ADA YANG PERLU DIKIRIM ────────────────────────────────
// Worker tanpa tujuan tidak ada gunanya: ia hanya membuka database setiap
// 15 detik untuk menemukan antrean kosong. Kalau SENTINEL_TUJUAN_URL belum
// disetel, pesan tetap DICATAT (berguna untuk memantau) tapi tidak dikirim.
if (config.sentinelTujuanUrl) {
  scheduleSentinel();
  console.log(`[sentinel] worker aktif — tiap ${config.sentinelIntervalMs}ms → ${config.sentinelTujuanUrl}`);
} else {
  console.log('[sentinel] worker nonaktif (SENTINEL_TUJUAN_URL belum disetel) — webhook dicatat saja');
}

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

/**
 * Nyalakan listener hanya kalau berkas ini dijalankan LANGSUNG.
 *
 * ── KENAPA ADA PEMERIKSAAN INI ──────────────────────────────────────────────
 * Tanpa `import.meta.main`-style guard, `import '../src/server.mjs'` dari tes
 * ikut menyalakan dua listener di port produksi (8788) dan bertabrakan dengan
 * layanan yang sedang berjalan — tes gagal dengan EADDRINUSE, dan lebih buruk,
 * ia bisa melayani permintaan nyata memakai database uji.
 *
 * Tes HTTP membutuhkan `requestHandler` yang diekspor tanpa efek samping ini.
 */
const dijalankanLangsung = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

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

if (dijalankanLangsung) {
  startListener('127.0.0.1', 'IPv4');
  startListener('::1', 'IPv6');

  console.log(`[startup] database: ${config.dbPath}`);
  console.log(`[startup] origin diizinkan: ${config.allowedOrigins.join(', ') || '(tidak ada)'}`);
}

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
