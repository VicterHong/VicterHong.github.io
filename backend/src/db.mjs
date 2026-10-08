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
-- A4: index untuk filter project_slug di /api/admin/audit.
--
-- Tanpa ini, filter per-proyek menyusuri SELURUH index idx_events_at dan
-- membuang yang tidak cocok. Diukur pada 303 baris: 0,352 ms vs 0,006 ms
-- dengan index yang cocok — 59x lebih lambat. Pada 1 juta baris, selisihnya
-- menjadi ribuan kali, dan karena DatabaseSync sinkron, seluruh pengunjung
-- ikut menunggu.
--
-- Kolom: (project_slug, at) — project dulu (untuk pencarian), lalu at
-- (untuk ORDER BY). Urutan ini penting: kalau dibalik, SQLite tidak bisa
-- memakai index untuk menyaring project.
CREATE INDEX IF NOT EXISTS idx_events_project ON access_events(project_slug, at);
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
  created_at  INTEGER NOT NULL,
  -- A8: moderasi. Komentar publik masuk dengan status 'pending' dan TIDAK
  -- ditampilkan sampai disetujui admin. Sebelumnya komentar langsung tampil
  -- begitu dikirim — siapa pun bisa menulis apa pun ke halaman publik.
  --
  -- 'approved' = tampil · 'pending' = menunggu · 'rejected' = disembunyikan
  --
  -- DEFAULT 'pending' dipilih dengan sengaja: kolom baru pada tabel yang
  -- sudah ada tidak bisa langsung NOT NULL tanpa default. 'pending' adalah
  -- nilai yang AMAN — kalau ada baris lama yang belum diisi, ia tidak
  -- langsung tampil.
  status      TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON cms_comments(target, created_at);
-- CATATAN A8: index untuk kolom status SENGAJA TIDAK ADA DI SINI.
--
-- Index yang menyebut kolom baru akan GAGAL di database lama — kolomnya
-- belum ada saat SCHEMA dijalankan, dan db.exec(SCHEMA) akan melempar
-- "no such column" sehingga server tidak bisa start sama sekali.
--
-- Index itu dibuat di migrate() SETELAH kolomnya ditambahkan.

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
-- ════════════════════════════════════════════════════════════════════════════
-- PEMBAYARAN — langganan lewat Midtrans
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── KENAPA TABEL SENDIRI, BUKAN LANGSUNG DARI STRIPE ────────────────────────
-- Midtrans adalah sumber kebenaran untuk UANG. Tapi token akses adalah milik
-- sistem ini — dan hubungan antara keduanya perlu dicatat.
--
-- Tanpa tabel ini, setiap kali ada pertanyaan "token ini dari pembayaran
-- mana?" harus bertanya ke Midtrans. Itu lambat, dan bergantung pada layanan
-- luar untuk pertanyaan internal.
--
-- ── KENAPA idempotency_key UNIK ─────────────────────────────────────────────
-- Ini pengaman terhadap dobel tagih DAN dobel token.
--
-- Skenario nyata: pengguna klik "Bayar", jaringan lambat, ia klik lagi.
-- Dua permintaan masuk. Tanpa kolom unik, dua sesi Checkout dibuat, dua
-- pembayaran terjadi, dan dua token diterbitkan — padahal pengguna hanya
-- ingin membayar sekali.
--
-- Dengan UNIQUE, percobaan kedua ditolak di tingkat database. Tidak ada
-- balapan yang bisa lolos.
--
-- ── KENAPA midtrans_order_id JUGA UNIK ─────────────────────────────────────
-- Xendit mengirim webhook berkali-kali untuk satu invoice (PENDING → PAID).
-- Kolom unik memastikan invoice yang sama tidak diterbitkan tokennya dua kali.
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,

  -- Kunci anti-dobel dari klien. UNIK = percobaan kedua ditolak.
  idempotency_key    TEXT NOT NULL UNIQUE,

  -- ID dari Midtrans
  midtrans_order_id  TEXT UNIQUE,
  midtrans_customer_id TEXT,
  midtrans_subscription_id TEXT,
  

  -- Apa yang dibeli
  tier               TEXT NOT NULL,           -- standar | profesional
  periode            TEXT NOT NULL,           -- bulanan | tahunan
  jumlah             INTEGER NOT NULL,        -- dalam rupiah penuh (IDR zero-decimal)

  -- Siapa yang membeli
  email              TEXT NOT NULL DEFAULT '',
  nama               TEXT NOT NULL DEFAULT '',

  -- Status: pending | dibayar | gagal | kedaluwarsa | dikembalikan
  status             TEXT NOT NULL DEFAULT 'pending',
  alasan_gagal       TEXT,

  -- Token yang diterbitkan setelah pembayaran berhasil
  token_id           TEXT,

  -- Waktu
  dibuat_pada        INTEGER NOT NULL,
  dibayar_pada       INTEGER,
  kedaluwarsa_pada   INTEGER,

  -- Metadata tambahan (JSON) — untuk hal yang belum terpikirkan sekarang
  catatan            TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status, dibuat_pada DESC);
CREATE INDEX IF NOT EXISTS idx_payments_email   ON payments(email);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(midtrans_order_id);

-- ── Log webhook mentah ───────────────────────────────────────────────────────
--
-- ── KENAPA DISIMPAN ─────────────────────────────────────────────────────────
-- Webhook adalah satu-satunya bukti bahwa pembayaran benar terjadi. Kalau
-- ada sengketa enam bulan kemudian ("saya sudah bayar, kok tidak dapat
-- akses?"), data ini yang menjawab — bukan tebakan.
--
-- Body disimpan MENTAH (string persis seperti diterima) karena itulah yang
-- ditandatangani penyedia. Kalau di-parse lalu disimpan ulang, bukti
-- aslinya hilang.
--
-- ── KENAPA event_id UNIK ────────────────────────────────────────────────────
-- Xendit bisa mengirim webhook berkali-kali untuk invoice yang sama.
-- Dengan UNIK, kiriman kedua tidak diproses — tapi tetap tercatat.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id     TEXT PRIMARY KEY,
  tipe         TEXT NOT NULL,
  body_mentah  TEXT NOT NULL,
  diterima_pada INTEGER NOT NULL,
  diproses     INTEGER NOT NULL DEFAULT 0,
  catatan      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_payment_events_tipe ON payment_events(tipe, diterima_pada DESC);

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

  migrate(db);

  return db;
}

/**
 * Migrasi kolom untuk database yang SUDAH ADA.
 *
 * ── KENAPA INI PERLU ────────────────────────────────────────────────────────
 *
 * `CREATE TABLE IF NOT EXISTS` hanya membuat tabel yang belum ada. Kalau
 * tabelnya sudah ada, pernyataan itu TIDAK MELAKUKAN APA PUN — termasuk
 * tidak menambahkan kolom baru ke tabel lama.
 *
 * Artinya: menambahkan kolom ke SCHEMA saja tidak cukup. Di database
 * produksi yang sudah berisi data, kolom `status` untuk moderasi komentar
 * TIDAK akan muncul, dan setiap query yang menyebutnya akan gagal dengan
 * "no such column". Migrasi ini menutup celah itu.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 *
 * Untuk setiap kolom yang mungkin belum ada: cek PRAGMA table_info, dan
 * hanya jalankan ALTER TABLE kalau memang belum ada. Sifatnya idempoten —
 * aman dijalankan berkali-kali, aman di database baru (kolom sudah dibuat
 * oleh SCHEMA, jadi migrasi ini tidak melakukan apa-apa).
 *
 * ALTER TABLE ADD COLUMN dengan DEFAULT bersifat instan di SQLite (tidak
 * menulis ulang tabel), jadi tidak ada risiko pada database besar.
 */
function migrate(handle) {
  const addColumn = (table, column, definition) => {
    try {
      const cols = handle.prepare(`PRAGMA table_info(${table})`).all();
      if (cols.some((c) => c.name === column)) return false;
      handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[migrasi] ${table}.${column} ditambahkan`);
      return true;
    } catch (err) {
      // Tabel belum ada (database baru sudah punya kolomnya dari SCHEMA).
      if (/no such table/i.test(err?.message ?? '')) return false;
      throw err;
    }
  };

  // A8: status moderasi komentar.
  // Baris LAMA diisi 'approved' — komentar yang sudah tayang sebelum
  // moderasi ada tidak boleh tiba-tiba hilang dari halaman. Yang baru
  // masuk akan memakai DEFAULT 'pending' dari SCHEMA.
  const added = addColumn('cms_comments', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  if (added) {
    // Hanya untuk baris yang sudah ada SEBELUM kolom ini ditambahkan.
    const n = handle.prepare(
      "UPDATE cms_comments SET status = 'approved' WHERE status = 'pending'"
    ).run().changes ?? 0;
    if (n > 0) console.log(`[migrasi] ${n} komentar lama ditandai 'approved'`);
  }

  // Index untuk moderasi dibuat SETELAH kolom ada. Kalau diletakkan di SCHEMA,
  // database lama akan gagal start ("no such column") karena index menyebut
  // kolom yang belum ada saat SCHEMA dijalankan.
  try {
    handle.exec('CREATE INDEX IF NOT EXISTS idx_comments_status ON cms_comments(status, created_at)');
  } catch {
    // Sangat lama / tabel belum ada — query tetap benar, hanya kurang cepat.
  }

  // ── TOTP / 2FA ────────────────────────────────────────────────────────────
  //
  // Kenapa tabel terpisah, bukan kolom di `tokens`:
  //
  //   1. Token bisa di-issue ulang tanpa kehilangan pendaftaran 2FA.
  //      Kalau secret disimpan di baris token, mencabut token lama dan
  //      menerbitkan yang baru akan memaksa klien mendaftar ulang
  //      authenticator-nya — padahal perangkatnya tidak berubah.
  //
  //   2. Enrollment bisa ada SEBELUM token diterbitkan. Admin bisa
  //      menyiapkan 2FA untuk klien, lalu mengirim token setelahnya.
  //
  //   3. Kode pemulihan punya relasi banyak-ke-satu dengan identitas,
  //      bukan dengan token.
  //
  // Identitas di sini adalah `issued_to` (email/ID klien) yang sudah
  // dipakai tabel tokens — bukan token_id.
  handle.exec(`
    CREATE TABLE IF NOT EXISTS totp_secrets (
      id              TEXT PRIMARY KEY,
      identity        TEXT NOT NULL UNIQUE,
      secret_enc      TEXT NOT NULL,
      -- Kolom untuk membuktikan klien benar-benar berhasil memindai QR
      -- sebelum 2FA diaktifkan. Tanpa ini, admin bisa mengaktifkan 2FA
      -- untuk klien yang belum pernah setup — dan klien terkunci.
      terverifikasi   INTEGER NOT NULL DEFAULT 0,
      terverifikasi_at INTEGER,
      dibuat_at       INTEGER NOT NULL,
      terakhir_dipakai INTEGER,
      -- Deteksi replay: kode TOTP yang sama tidak boleh dipakai dua kali
      -- dalam jendela 30 detik yang sama.
      langkah_terakhir INTEGER NOT NULL DEFAULT 0
    )
  `);

  handle.exec(`
    CREATE TABLE IF NOT EXISTS totp_recovery (
      id          TEXT PRIMARY KEY,
      identity    TEXT NOT NULL,
      kode_hash   TEXT NOT NULL,
      dipakai_at  INTEGER,
      dibuat_at   INTEGER NOT NULL
    )
  `);

  // Index untuk pencarian saat verifikasi (jalur panas — setiap login).
  try {
    handle.exec('CREATE INDEX IF NOT EXISTS idx_totp_identity ON totp_secrets(identity)');
    handle.exec('CREATE INDEX IF NOT EXISTS idx_recovery_identity ON totp_recovery(identity, dipakai_at)');
  } catch {
    // Tabel belum ada di DB sangat lama — query tetap benar.
  }

  // Audit percobaan 2FA. Tanpa ini, serangan brute-force terhadap kode
  // 6 digit tidak terlihat sama sekali di log.
  handle.exec(`
    CREATE TABLE IF NOT EXISTS totp_attempts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      identity    TEXT NOT NULL,
      berhasil    INTEGER NOT NULL,
      alasan      TEXT NOT NULL DEFAULT '',
      ip          TEXT NOT NULL DEFAULT '',
      dibuat_at   INTEGER NOT NULL
    )
  `);

  try {
    handle.exec('CREATE INDEX IF NOT EXISTS idx_totp_attempts ON totp_attempts(identity, dibuat_at)');
  } catch {
    // Sama seperti di atas.
  }
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
