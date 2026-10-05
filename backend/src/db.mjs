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
-- A3: index untuk retensi. Tanpa ini, DELETE ... WHERE at < ? melakukan
-- full scan, dan itu memblokir seluruh server (DatabaseSync sinkron).
-- Index (token_id, at) di atas TIDAK bisa dipakai karena kolom pertamanya
-- token_id — query retensi tidak memfilter token.
CREATE INDEX IF NOT EXISTS idx_events_at    ON access_events(at);

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
-- A3: index untuk retensi. idx_fp_token tidak bisa dipakai karena kolom
-- pertamanya token_id — query retensi tidak memfilter token.
CREATE INDEX IF NOT EXISTS idx_fp_created ON device_fingerprints(created_at);

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
-- A3: index untuk retensi + uniqueVisitors(). Kolom pertama created_at
-- supaya DELETE WHERE created_at < ? tidak full scan. Sekaligus covering
-- untuk COUNT(DISTINCT ip) WHERE created_at >= ? — ip ikut di index,
-- jadi tidak perlu lookup ke tabel.
CREATE INDEX IF NOT EXISTS idx_analytics_created_ip ON analytics_events(created_at, ip);

CREATE TABLE IF NOT EXISTS consents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id      INTEGER NOT NULL,
  terms_version TEXT NOT NULL,
  ip            TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consents_token ON consents(token_id, created_at);

CREATE TABLE IF NOT EXISTS sla_heartbeats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at  INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  detail      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sla_checked ON sla_heartbeats(checked_at);

-- ── A1: agregat heartbeat per menit ─────────────────────────────────────────
--
-- MASALAH YANG DIPERBAIKI:
-- Sebelumnya satu baris ditulis untuk SETIAP request. Dalam 5 hari itu
-- menghasilkan 3.500 baris berbanding 303 event audit — rasio 11:1. Tabel
-- ini jadi yang terbesar, dan laporan SLA (terutama p95) harus mengurutkan
-- SELURUH baris dalam jendela waktu. Pada 800 ribu baris (skenario 1000x),
-- satu laporan SLA memakan 1-3 detik — dan karena DatabaseSync sinkron,
-- SELURUH pengunjung menunggu selama itu.
--
-- SOLUSI: agregasi di memori, tulis SATU baris per menit.
--   30 hari = maksimum 43.200 baris, berapa pun trafiknya.
--   p95 dihitung dari histogram (11 bucket) — O(baris × 11), tanpa sort.
--
-- BONUS KOREKSI: menit tanpa request TIDAK punya baris. Artinya kalau
-- proses mati, menit itu hilang dari data — sehingga uptime jadi JUJUR.
-- Sebelumnya, proses yang mati tidak menulis apa pun, jadi uptime selalu
-- terlihat 100% (hanya menghitung request yang berhasil dilayani).
CREATE TABLE IF NOT EXISTS sla_minutes (
  minute       INTEGER PRIMARY KEY,   -- epoch menit (ms / 60000)
  total        INTEGER NOT NULL,      -- jumlah request di menit itu
  errors       INTEGER NOT NULL,      -- jumlah respons 5xx
  latency_sum  INTEGER NOT NULL,      -- jumlah latency (ms) untuk rata-rata
  hist         TEXT NOT NULL          -- JSON array 11 bucket histogram
);

CREATE INDEX IF NOT EXISTS idx_sla_minutes ON sla_minutes(minute);

-- ── CMS (Framer-grade): koleksi, item, versi ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_collections (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  fields      TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL DEFAULT 'admin',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_items (
  id           TEXT PRIMARY KEY,
  collection   TEXT NOT NULL,
  item_slug    TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE(collection, item_slug)
);

CREATE INDEX IF NOT EXISTS idx_cms_items_collection ON cms_items(collection, status);
CREATE INDEX IF NOT EXISTS idx_cms_items_updated ON cms_items(updated_at);

CREATE TABLE IF NOT EXISTS cms_item_versions (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'draft',
  author     TEXT NOT NULL DEFAULT 'admin',
  message    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_versions_item ON cms_item_versions(item_id, version);

-- ── PERFORMANCE: Core Web Vitals dari pengunjung nyata ──────────────────────
CREATE TABLE IF NOT EXISTS web_vitals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  value       REAL NOT NULL,
  rating      TEXT NOT NULL DEFAULT '',
  path        TEXT NOT NULL DEFAULT '/',
  country     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  connection  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vitals_name ON web_vitals(name, created_at);
CREATE INDEX IF NOT EXISTS idx_vitals_path ON web_vitals(path, created_at);
-- A3: index untuk retensi.
CREATE INDEX IF NOT EXISTS idx_vitals_created ON web_vitals(created_at);

-- ── COLLABORATE: cabang (branch) & riwayat perubahan ────────────────────────
CREATE TABLE IF NOT EXISTS cms_branches (
  name        TEXT PRIMARY KEY,
  base        TEXT NOT NULL DEFAULT 'main',
  author      TEXT NOT NULL DEFAULT 'admin',
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_branch_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  branch      TEXT NOT NULL,
  collection  TEXT NOT NULL DEFAULT '',
  item_slug   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL DEFAULT 'update',
  payload     TEXT NOT NULL DEFAULT '{}',
  author      TEXT NOT NULL DEFAULT 'admin',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_branch_changes ON cms_branch_changes(branch, created_at);

-- ── COLLABORATE: komentar (review di kanvas konten) ─────────────────────────
CREATE TABLE IF NOT EXISTS cms_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target      TEXT NOT NULL,
  anchor      TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'guest',
  resolved    INTEGER NOT NULL DEFAULT 0,
  parent_id   INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON cms_comments(target, created_at);

-- ── GROW: eksperimen A/B & konversi ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  variants    TEXT NOT NULL DEFAULT '[]',
  goal        TEXT NOT NULL DEFAULT 'signup',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  variant     TEXT NOT NULL,
  event       TEXT NOT NULL,
  visitor     TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_events ON experiment_events(slug, variant, event, created_at);

-- ── PUBLISH: catatan rilis ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS releases (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL DEFAULT '',
  commit_hash  TEXT NOT NULL DEFAULT '',
  deployed_by  TEXT NOT NULL DEFAULT 'admin',
  ok           INTEGER NOT NULL DEFAULT 0,
  checks       TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_releases_created ON releases(created_at);
`;

/** Buka (atau buat) database. Aman dipanggil berkali-kali. */
export function openDb(path) {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(SCHEMA);

  // ── A5: PRAGMA untuk produksi ─────────────────────────────────────────────
  //
  // busy_timeout = 2000 ms
  //   Tanpa ini, kalau ada proses lain menulis ke DB yang sama (skrip CLI,
  //   backup, migrasi), server LANGSUNG menerima SQLITE_BUSY dan request
  //   publik gagal 500. Dengan timeout, server menunggu sebentar.
  //   Catatan: pada API sinkron, menunggu berarti event loop ikut menunggu
  //   sampai 2 detik — tapi itu tetap jauh lebih baik daripada error 500.
  //
  // synchronous = NORMAL
  //   Bawaan SQLite adalah FULL, yang memicu fsync pada SETIAP commit.
  //   Di WAL mode, NORMAL sudah cukup aman (hanya commit terakhir yang bisa
  //   hilang kalau listrik mati — database tetap konsisten, tidak korup).
  //   Ini menghapus fsync dari jalur request, yang di disk VPS memakan
  //   1-10 ms dan bisa 50+ ms saat disk sibuk.
  //
  // Keduanya dijalankan SETELAH SCHEMA supaya tidak memperlambat migrasi.
  try {
    db.exec('PRAGMA busy_timeout = 2000;');
    db.exec('PRAGMA synchronous = NORMAL;');
  } catch {
    // Versi SQLite lama atau build khusus — bukan alasan menggagalkan start.
    // Tanpa PRAGMA ini layanan tetap benar, hanya kurang optimal.
  }

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
