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
import { getDb } from './db.mjs';
import { config } from './config.mjs';

const startedAt = Date.now();

/** Ringkasan proses — dipakai /api/health. */
export function liveness() {
  const mem = process.memoryUsage();
  return {
    ok: true,
    service: 'portfolio-token-service',
    version: config.serviceVersion ?? '1.0.0',
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    pid: process.pid,
    node: process.version,
    memory_mb: Math.round(mem.rss / 1024 / 1024),
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
    checks.push({ name: 'disk_write', ok: true, detail: dir });
  } catch (err) {
    checks.push({ name: 'disk_write', ok: false, detail: err.message });
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
  try {
    accessSync(config.contentDir, constants.R_OK);
    checks.push({ name: 'content_dir', ok: true, detail: config.contentDir });
  } catch (err) {
    // Direktori belum dibuat bukan kegagalan fatal — konten contoh yang dipakai.
    checks.push({
      name: 'content_dir',
      ok: true,
      detail: `${config.contentDir} (belum ada — konten contoh dipakai)`,
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
