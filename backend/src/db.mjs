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
  issued_to     TEXT NOT NULL DEFAULT '',
  issued_by     TEXT NOT NULL DEFAULT 'admin',
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  revoked_reason TEXT,
  max_ips       INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tokens_project ON tokens(project_slug);
CREATE INDEX IF NOT EXISTS idx_tokens_status  ON tokens(status);

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
  project_slug TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON sales_leads(created_at);
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
