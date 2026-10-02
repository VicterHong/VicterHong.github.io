/**
 * Konfigurasi layanan token.
 *
 * Rahasia dibaca dari berkas env terpisah (tidak pernah di repo). Semua nilai lain
 * punya default aman supaya layanan bisa dijalankan tanpa konfigurasi tambahan.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const ENV_FILE = process.env.TOKEN_SERVICE_ENV ?? join(HOME, '.portfolio-token', 'service.env');

/** Baca berkas env sederhana: KEY=VALUE per baris, # komentar. */
function readEnvFile(path) {
  const out = {};
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Buang kutip pembungkus kalau ada.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // Berkas belum ada: pakai default. Bukan error saat pengembangan.
  }
  return out;
}

const fileEnv = readEnvFile(ENV_FILE);

const pick = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

export const config = {
  /** Port HTTP. 8788 dipilih karena bebas di VPS ini. */
  port: Number(pick('PORT', '8788')),

  /** Bind hanya ke loopback: akses publik lewat tunnel, bukan langsung. */
  host: pick('HOST', '127.0.0.1'),

  /** Lokasi database SQLite. */
  dbPath: pick('DB_PATH', join(HOME, '.portfolio-token', 'tokens.db')),

  /** Lokasi berkas konten terkunci (per proyek). */
  contentDir: pick('CONTENT_DIR', join(HOME, '.portfolio-token', 'content')),

  /**
   * Secret untuk menandatangani token yang diterbitkan.
   * WAJIB ada di service.env saat produksi — kalau kosong, layanan menolak start.
   */
  secret: pick('SERVICE_SECRET', ''),

  /**
   * Kunci admin untuk endpoint penerbitan/pencabutan token.
   * WAJIB ada di service.env saat produksi.
   */
  adminKey: pick('ADMIN_KEY', ''),

  /** Email sales untuk notifikasi permintaan akses. */
  salesEmail: pick('SALES_EMAIL', ''),

  /** URL webhook untuk notifikasi lead baru (Discord/Slack/generik). Kosong = nonaktif. */
  leadWebhookUrl: pick('LEAD_WEBHOOK_URL', ''),

  /** Origin yang boleh mengakses API (CORS). */
  allowedOrigins: pick('ALLOWED_ORIGINS', 'https://victerhong.github.io')
    .split(',').map((s) => s.trim()).filter(Boolean),

  /** Batas laju default per token per menit. */
  rateLimitPerMinute: Number(pick('RATE_LIMIT_PER_MINUTE', '30')),

  /** Auto-revoke: jumlah IP berbeda maksimum dalam jendela waktu. */
  maxDistinctIps: Number(pick('MAX_DISTINCT_IPS', '3')),

  /** Auto-revoke: jendela waktu untuk menghitung IP berbeda (jam). */
  ipWindowHours: Number(pick('IP_WINDOW_HOURS', '24')),

  /** Auto-revoke: jumlah request gagal berturut-turut sebelum token dikunci. */
  maxFailedAttempts: Number(pick('MAX_FAILED_ATTEMPTS', '12')),

  /** Panjang segmen token acak (karakter, bukan byte). */
  tokenSegmentLength: Number(pick('TOKEN_SEGMENT_LENGTH', '4')),

  /** Jumlah segmen token (contoh: 4 segmen → VP-XXXX-XXXX-XXXX-XXXX). */
  tokenSegments: Number(pick('TOKEN_SEGMENTS', '4')),

  /** Awalan token supaya mudah dikenali. */
  tokenPrefix: pick('TOKEN_PREFIX', 'VP-'),

  /** Durasi sesi cookie (jam). */
  sessionDurationHours: Number(pick('SESSION_DURATION_HOURS', '24')),

  /** Maksimum sesi aktif per token (device). */
  maxDevices: Number(pick('MAX_DEVICES', '3')),
};

/** Apakah konfigurasi cukup untuk menjalankan layanan produksi. */
export function validateConfig() {
  const problems = [];
  if (!config.secret || config.secret.length < 24) {
    problems.push('SERVICE_SECRET wajib diisi (minimal 24 karakter) di ' + ENV_FILE);
  }
  if (!config.adminKey || config.adminKey.length < 24) {
    problems.push('ADMIN_KEY wajib diisi (minimal 24 karakter) di ' + ENV_FILE);
  }
  return problems;
}

export { ENV_FILE };
