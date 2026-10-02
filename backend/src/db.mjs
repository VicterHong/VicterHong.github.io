/**
 * Lapisan database — SQLite lewat modul bawaan Node (node:sqlite).
 *
 * Tidak memakai dependency eksternal: modul bawaan berarti tidak ada paket pihak ketiga
 * yang bisa kedaluwarsa atau menjadi jalur serangan.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db = null;

/**
 * Skema:
 *  - tokens        : token yang diterbitkan (disimpan sebagai hash, bukan plaintext)
 *  - sessions      : sesi aktif per device (cookie-based, maxDevices enforcement)
 *  - access_events : setiap percobaan akses (untuk audit + deteksi penyalahgunaan)
 *  - revocations   : catatan pencabutan (manual maupun otomatis)
 *  - sales_leads   : permintaan akses dari form publik
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tokens (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT '',
  project_slug  TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'standard',
  scopes        TEXT NOT NULL DEFAULT '',
  issued_to     TEXT NOT NULL DEFAULT '',
  company       TEXT NOT NULL DEFAULT '',
  issued_by     TEXT NOT NULL DEFAULT 'admin',
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  revoked_reason TEXT,
  max_ips       INTEGER NOT NULL DEFAULT 3,
  max_devices   INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tokens_project ON tokens(project_slug);
CREATE INDEX IF NOT EXISTS idx_tokens_status  ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_tier    ON tokens(tier);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_id    TEXT NOT NULL,
  device_fp   TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS access_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    TEXT,
  project_slug TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_token ON access_events(token_id, at);
CREATE INDEX IF NOT EXISTS idx_events_ip    ON access_events(ip, at);

CREATE TABLE IF NOT EXISTS revocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  automatic   INTEGER NOT NULL DEFAULT 0,
  detail      TEXT NOT NULL DEFAULT '',
  at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company     TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  project_slug TEXT NOT NULL DEFAULT '',
  budget_range TEXT NOT NULL DEFAULT '',
  urgency     TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON sales_leads(created_at);

CREATE TABLE IF NOT EXISTS device_fingerprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  token_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fp_token ON device_fingerprints(token_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fp_session ON device_fingerprints(session_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,
  project_slug TEXT NOT NULL DEFAULT '',
  token_id    TEXT,
  session_id  TEXT,
  ip          TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  referrer    TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics_events(project_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_token ON analytics_events(token_id, created_at);
`;

/** Buka (atau buat) database. Aman dipanggil berkali-kali. */
export function openDb(path) {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Database yang sedang terbuka, atau lempar kalau belum dibuka. */
export function getDb() {
  if (!db) throw new Error('database belum dibuka — panggil openDb() lebih dulu');
  return db;
}

/** Tutup database (dipakai pengujian dan shutdown bersih). */
export function closeDb() {
  if (!db) return;
  try { db.close(); } catch { /* sudah tertutup */ }
  db = null;
}

/** Waktu sekarang dalam milidetik. */
export const now = () => Date.now();

/** Jalankan beberapa pernyataan dalam satu transaksi. */
export function transaction(fn) {
  const handle = getDb();
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }
}
