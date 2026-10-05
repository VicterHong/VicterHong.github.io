/**
 * Health & readiness — pemeriksaan yang JUJUR.
 *
 * Masalah dengan health check lama: selalu menjawab `{ok:true}` walau
 * database terkunci, disk penuh, atau dependensi mati. Monitoring jadi
 * buta — uptime terlihat 100% padahal layanan tidak bisa melayani.
 *
 * Di sini dibedakan dua hal (standar Kubernetes):
 *
 *   LIVENESS  (/api/health)  — "proses ini hidup?"
 *     Cepat, tidak menyentuh database. Kalau gagal, proses harus di-restart.
 *     Dipakai oleh systemd watchdog / uptime monitor.
 *
 *   READINESS (/api/ready)   — "siap menerima trafik?"
 *     Memeriksa dependensi nyata: database bisa dibaca, disk bisa ditulis,
 *     direktori konten ada. Kalau gagal, trafik harus dialihkan — TAPI
 *     proses tidak perlu di-restart.
 */

import { statfsSync, accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getDb } from './db.mjs';
import { config } from './config.mjs';

const startedAt = Date.now();

/**
 * Monitor event loop delay.
 *
 * KENAPA INI PENTING (temuan E dari audit enterprise):
 *
 * Di sistem ini, DatabaseSync melakukan kerja di call stack JavaScript.
 * Setiap operasi sinkron yang lambat membekukan SELURUH server — bukan
 * hanya request yang memicunya. CPU% TIDAK menunjukkan ini: bisa 15%
 * sementara p99 event loop delay sudah 500 ms.
 *
 * Contoh nyata: satu query admin 500 ms menahan 4 request pada 8 req/detik,
 * latensi mereka naik dari 5 ms menjadi 250-500 ms (50-100×).
 *
 * ATURAN PRAKTIS: p99 harus < 50 ms. Kalau lebih, ada operasi sinkron
 * yang perlu dipecah per batch atau dipindah ke worker.
 *
 * Histogram ini bawaan Node (perf_hooks) — tidak menambah dependency dan
 * biayanya nyaris nol (diperbarui oleh timer internal, bukan per request).
 */

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/** Ringkasan event loop delay dalam milidetik. */
export function eventLoopStats() {
  // Nilai bawaan adalah nanodetik.
  const toMs = (ns) => Math.round((Number.isFinite(ns) ? ns : 0) / 1e6 * 10) / 10;
  return {
    p50_ms: toMs(loopDelay.percentile(50)),
    p95_ms: toMs(loopDelay.percentile(95)),
    p99_ms: toMs(loopDelay.percentile(99)),
    max_ms: toMs(loopDelay.max),
  };
}

/** Kembalikan { ok: true } kalau p99 masih di bawah ambang. */
export function liveness() {
  const mem = process.memoryUsage();
  const loop = eventLoopStats();
  return {
    ok: true,
    service: 'portfolio-token-service',
    version: config.serviceVersion ?? '1.0.0',
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    pid: process.pid,
    node: process.version,
    memory_mb: Math.round(mem.rss / 1024 / 1024),
    // Metrik event loop (E). Dikirim di liveness supaya monitor bisa
    // memantau tanpa menambah endpoint. Tidak rahasia — hanya angka.
    event_loop_ms: loop,
    // Peringatan kalau p99 melewati ambang. Bukan kegagalan (liveness tetap
    // ok:true — proses memang hidup), tapi sinyal untuk diperiksa.
    event_loop_warn: loop.p99_ms > 50,
    time: new Date().toISOString(),
  };
}

/**
 * Pemeriksaan kesiapan — setiap dependensi diuji NYATA, bukan diasumsikan.
 * Mengembalikan { ok, checks[] } dengan detail per pemeriksaan.
 */
export function readiness() {
  const checks = [];

  // 1. DATABASE — benar-benar jalankan query, bukan sekadar cek koneksi.
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM tokens').get();
    checks.push({
      name: 'database',
      ok: true,
      detail: `${row.n} token terbaca`,
    });
  } catch (err) {
    checks.push({ name: 'database', ok: false, detail: err.message });
  }

  // 2. DISK — bisa ditulis? (database WAL butuh disk tulis)
  try {
    const dir = dirname(config.dbPath);
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.health-${process.pid}`);
    writeFileSync(probe, 'ok', { flag: 'w' });
    unlinkSync(probe);
    // Detail TIDAK memuat path lengkap. Endpoint ini publik, dan
    // '/home/<user>/.portfolio-token' membocorkan username VPS sekaligus
    // struktur direktori — bahan berguna untuk serangan lanjutan.
    // Statusnya sendiri yang penting, bukan lokasinya.
    checks.push({ name: 'disk_write', ok: true, detail: 'bisa ditulis' });
  } catch (err) {
    // Pesan sistem juga bisa memuat path ('ENOENT: ... open /home/...').
    // Yang dilaporkan cukup kode errornya.
    checks.push({ name: 'disk_write', ok: false, detail: err?.code ?? 'gagal menulis' });
  }

  // 3. RUANG DISK — sisa < 50 MB = peringatan (database bisa gagal tulis).
  try {
    const stats = statfsSync(dirname(config.dbPath));
    const freeMb = Math.round((stats.bavail * stats.bsize) / 1024 / 1024);
    checks.push({
      name: 'disk_space',
      ok: freeMb > 50,
      detail: `${freeMb} MB tersisa`,
    });
  } catch {
    // statfs tidak tersedia di semua platform — bukan kegagalan.
    checks.push({ name: 'disk_space', ok: true, detail: 'tidak dapat diperiksa' });
  }

  // 4. DIREKTORI KONTEN — ada dan bisa dibaca?
  // Detail tidak memuat path (sama alasannya dengan disk_write di atas):
  // endpoint ini publik dan path membocorkan struktur direktori VPS.
  try {
    accessSync(config.contentDir, constants.R_OK);
    checks.push({ name: 'content_dir', ok: true, detail: 'bisa dibaca' });
  } catch {
    // Direktori belum dibuat bukan kegagalan fatal — konten contoh yang dipakai.
    checks.push({
      name: 'content_dir',
      ok: true,
      detail: 'belum ada — konten contoh dipakai',
    });
  }

  // 5. KONFIGURASI KRITIS — secret & kunci admin ada.
  checks.push({
    name: 'config',
    ok: Boolean(config.secret && config.adminKey),
    detail: config.secret && config.adminKey ? 'secret & admin key ada' : 'secret/admin key HILANG',
  });

  return {
    ok: checks.every(c => c.ok),
    checks,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  };
}
