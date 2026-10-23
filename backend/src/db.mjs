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

-- ── KUNCI AKSES APLIKASI (URL acak panjang) ──────────────────────────────────
--
-- Berbeda dari tabel tokens: tabel itu untuk berbagi PROYEK (satu token bisa
-- membuka beberapa slug). Tabel ini untuk satu PEMBELI → satu URL aplikasi
-- React penuh. Kode disimpan sebagai hash, jadi bocornya database tidak
-- langsung memberi URL yang bisa dipakai.
CREATE TABLE IF NOT EXISTS access_keys (
  id            TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT '',
  issued_to     TEXT NOT NULL DEFAULT '',
  plan          TEXT NOT NULL DEFAULT 'lifetime',
  issued_at     INTEGER NOT NULL,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  revoked_reason TEXT,
  last_used_at  INTEGER,
  use_count     INTEGER NOT NULL DEFAULT 0,
  max_ips       INTEGER NOT NULL DEFAULT 3,
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_access_keys_hash   ON access_keys(code_hash);
CREATE INDEX IF NOT EXISTS idx_access_keys_issued ON access_keys(issued_to);

CREATE TABLE IF NOT EXISTS token_requests (
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, request_key)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_id    TEXT NOT NULL,
  device_fp   TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,

  -- ══ GEOGRAFI (dari header Cloudflare) ══════════════════════════════════════
  -- Disimpan saat sesi dibuat: data ini hanya tersedia selama request
  -- berlangsung, dan halaman Sesi aktif dibuka jauh setelahnya.
  kota        TEXT NOT NULL DEFAULT '',
  wilayah     TEXT NOT NULL DEFAULT '',
  asn         TEXT NOT NULL DEFAULT '',
  zona_waktu  TEXT NOT NULL DEFAULT '',
  -- Nama ISP/organisasi dari Cloudflare (cf.asOrganization).
  org         TEXT NOT NULL DEFAULT '',

  -- ══ DETEKSI PERANGKAT (dari klien) ═════════════════════════════════════════
  --
  -- ── KENAPA DISIMPAN, PADAHAL UA SUDAH ADA ────────────────────────────────
  -- User-Agent TIDAK BISA DIPERCAYA untuk menentukan OS. Kasus nyata: Chrome
  -- Android mode "Desktop site" mengubah UA jadi X11; Linux x86_64 --
  -- Android hilang sepenuhnya, dan UA saja menyimpulkan "Linux desktop".
  --
  -- Kolom ini menyimpan hasil deteksi dari klien (Client Hints + layar)
  -- yang TIDAK ikut berubah saat mode itu aktif.
  platform    TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  jenis       TEXT NOT NULL DEFAULT '',

  -- ══ SUDO MODE (step-up 2FA) ══════════════════════════════════════════════
  -- Batas waktu (epoch ms) sampai kapan sesi ini boleh melakukan aksi
  -- sensitif TANPA memasukkan kode 2FA lagi. 0 = belum pernah diverifikasi.
  --
  -- ── KENAPA DI SESI, BUKAN DI TOKEN ───────────────────────────────────────
  -- Verifikasi ulang terikat pada PERANGKAT yang sedang dipakai, bukan pada
  -- akun. Kalau disimpan di token (identitas), membuka sudo di laptop akan
  -- membuka sudo di ponsel juga — dan itu justru melemahkan tujuannya.
  --
  -- Pola ini mengikuti GitHub "sudo mode": setelah re-autentikasi, aksi
  -- sensitif diizinkan selama jendela waktu tertentu; setiap aksi menyegarkan
  -- jendelanya. Lihat SUDO_MS di routes.mjs.
  sudo_until  INTEGER NOT NULL DEFAULT 0
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
-- ── KENAPA TABEL SENDIRI, BUKAN LANGSUNG DARI MIDTRANS ──────────────────────
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
-- Midtrans mengirim webhook berkali-kali untuk satu transaksi
-- (pending → settlement). Keunikan memastikan transaksi yang sama tidak
-- diterbitkan tokennya dua kali.
--
-- Keunikan ditegakkan oleh idx_payments_midtrans_order yang dibuat di
-- migrate(), BUKAN oleh UNIQUE pada definisi kolom: ALTER TABLE ADD COLUMN
-- tidak bisa membawa UNIQUE, dan database LAMA harus mendapat jaminan yang
-- sama dengan database baru. NULL berulang diizinkan SQLite, jadi baris lama
-- yang belum punya order_id tidak saling bentrok.
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,

  -- Kunci anti-dobel dari klien. UNIK = percobaan kedua ditolak.
  idempotency_key    TEXT NOT NULL UNIQUE,

  -- ID dari Midtrans
  midtrans_order_id  TEXT,
  midtrans_customer_id TEXT,
  midtrans_subscription_id TEXT,

  -- Halaman pembayaran Snap + tokennya, disimpan supaya percobaan ulang
  -- dengan kunci idempotensi yang sama mengembalikan URL YANG SAMA.
  --
  -- ── KENAPA DISIMPAN, BUKAN DIBACA ULANG DARI MIDTRANS ────────────────────
  -- API status v2 Midtrans tidak mengenal transaksi Snap yang belum dibuka
  -- pembeli ("Transaction doesn't exist") — jadi URL-nya tidak bisa diambil
  -- kembali dari sana. Tanpa kolom ini, setiap percobaan ulang membuat
  -- transaksi Snap BARU dengan order_id yang sama, dan pembeli bisa melihat
  -- dua halaman pembayaran yang keduanya bisa dibayar.
  payment_url        TEXT,
  snap_token         TEXT,
  

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
-- Index unik midtrans_order_id dibuat di migrate(), SETELAH kolomnya
-- ditambahkan — database lama belum punya kolom itu saat SCHEMA dijalankan,
-- dan CREATE INDEX yang menyebut kolom tidak ada adalah galat yang
-- menggagalkan start layanan.

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
-- Midtrans bisa mengirim webhook berkali-kali untuk transaksi yang sama.
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
 * Jalankan migrasi kolom lagi pada database yang sudah terbuka.
  *
  * ── KENAPA INI PERLU DIEKSPOR ───────────────────────────────────────────────
  *
  * `openDb()` menjalankan migrasi SEKALI, saat database dibuka. Tapi ada
  * modul yang membuat tabelnya SENDIRI setelah itu (mis. `siapkanTabelPengguna`
  * di users.mjs) — dan tabel yang baru dibuat itu tidak melewati migrasi.
  *
  * Akibatnya, database BARU tidak mendapat kolom-kolom hasil migrasi:
  * `addColumn('users', ...)` dijalankan saat tabelnya belum ada, gagal dengan
  * "no such table", dan kegagalan itu ditelan dengan sengaja.
  *
  * Di produksi masalah ini tidak terlihat karena tabelnya sudah ada sejak
  * lama. Yang terkena hanya database baru — termasuk SEMUA uji otomatis.
  *
  * Idempoten: `addColumn` melewati kolom yang sudah ada, jadi memanggilnya
  * berkali-kali aman.
  */
export function migrateUlang() {
  migrate(getDb());
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
  // ── PINDAHKAN TRIAL LAMA KE TABEL BARU ─────────────────────────────────────
  //
  // ── KENAPA PERLU DIPINDAHKAN ──────────────────────────────────────────────
  // Aturan lama: satu proyek per akun, wajib star. Aturan baru: lima proyek,
  // tiga dari login.
  //
  // Pengguna yang sudah memakai jatahnya di aturan LAMA tidak boleh kehilangan
  // akses yang sudah dia dapat — proyek yang pernah dia buka harus tetap
  // terbuka. Kalau datanya tidak dipindahkan, dia akan melihat proyek itu
  // terkunci lagi, dan itu terasa seperti sistemnya rusak.
  //
  // ── SUMBERNYA DITANDAI 'star' ─────────────────────────────────────────────
  // Di aturan lama, satu-satunya cara membuka metrik adalah memberi star. Jadi
  // setiap baris lama pasti berasal dari star — bukan dari login.
  //
  // ── IDEMPOTEN ─────────────────────────────────────────────────────────────
  // INSERT OR IGNORE dengan UNIQUE(user_id, project_slug): menjalankan migrasi
  // dua kali tidak menggandakan baris. Aman dijalankan setiap startup.
  try {
    const adaTabelLama = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trial_metrik'")
      .get();

    if (adaTabelLama) {
      const hasil = handle.prepare(`
        INSERT OR IGNORE INTO metrik_terbuka
          (id, user_id, project_slug, sumber, dibuka_at, ip, user_agent)
        SELECT id, user_id, project_slug, 'star', dibuka_at, ip, user_agent
        FROM trial_metrik
      `).run();

      if (hasil.changes > 0) {
        console.log(`[migrasi] ${hasil.changes} trial metrik lama dipindahkan ke metrik_terbuka`);
      }
    }
  } catch (err) {
    // Kalau gagal, JANGAN hentikan startup — aturan baru tetap berjalan, hanya
    // data lama yang belum terbawa. Dilaporkan supaya bisa diperiksa.
    console.error('[migrasi] gagal memindahkan trial_metrik:', err?.message ?? err);
  }

  const addColumn = (table, column, definition) => {
    // Defense-in-depth: `table` dan `column` harus identifier sederhana.
    // Pemanggil selalu string literal dari `migrate()`, tapi validasi ini
    // mencegah injection kalau suatu saat dipanggil dengan input dinamis.
    if (!/^[a-z_]+$/.test(table)) throw new Error(`[BUG] nama tabel tidak valid: ${table}`);
    if (!/^[a-z_]+$/.test(column)) throw new Error(`[BUG] nama kolom tidak valid: ${column}`);
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

  // ── KOLOM GEO SESI ────────────────────────────────────────────────────────
  //
  // Sesi yang dibuat SEBELUM kolom ini ada akan punya nilai kosong — dan itu
  // memang benar: datanya tidak pernah tersimpan, jadi tidak ada yang bisa
  // dipulihkan. UI menanganinya dengan "Lokasi tidak diketahui" alih-alih
  // mengarang nilai.
  addColumn('sessions', 'kota', "TEXT NOT NULL DEFAULT ''");

  // ── PREFERENSI NOTIFIKASI ─────────────────────────────────────────────────
  //
  // ── KENAPA DISIMPAN DI TABEL users, BUKAN TABEL TERPISAH ─────────────────
  //
  // Ini tiga nilai boolean milik pengguna. Tabel terpisah berarti satu JOIN
  // tambahan untuk setiap pembacaan — dan tidak ada manfaatnya, karena
  // hubungannya satu-ke-satu.
  //
  // Kalau nanti bertambah jadi 20 preferensi, barulah tabel terpisah masuk
  // akal. Sekarang: tiga kolom di tabel yang sudah dibaca setiap login.
  //
  // ── KENAPA DEFAULT 1 UNTUK DUA, 0 UNTUK SATU ─────────────────────────────
  //
  //   produk    = 1 (aktif)  → pengguna BARU memang ingin tahu fitur baru
  //   pembayaran= 1 (aktif)  → ini transaksional; mematikannya berbahaya
  //                            (pengguna tidak dapat invoice-nya)
  //   promosi   = 0 (mati)   → email promosi HARUS opt-in, bukan opt-out.
  //                            Mengaktifkannya diam-diam adalah praktik yang
  //                            melanggar GDPR dan merusak kepercayaan.
  //
  // ── KENAPA PEMBAYARAN TIDAK BISA DIMATIKAN DI UI ─────────────────────────
  //
  // Kolomnya ada (supaya bisa dimatikan manual oleh admin kalau perlu), tapi
  // toggle-nya tidak ditampilkan. Alasannya: invoice dan konfirmasi
  // pembayaran bukan promosi — pengguna berhak mendapatkannya, dan
  // menyembunyikannya hanya akan menimbulkan tiket dukungan.
  addColumn('users', 'notif_produk', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'notif_pembayaran', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'notif_promosi', 'INTEGER NOT NULL DEFAULT 0');

  // ── LANGGANAN & KUOTA TOKEN ───────────────────────────────────────────────
  //
  // ── KENAPA TABEL TERPISAH, BUKAN KOLOM DI users ───────────────────────────
  // Paket langganan punya SIKLUS HIDUP: mulai, diperbarui, berakhir. Kalau
  // disimpan sebagai kolom tier di tabel users, riwayatnya hilang — dan kita
  // tidak bisa menjawab "bulan lalu dia paket apa" saat ada sengketa tagihan.
  //
  // Tabel terpisah juga membuat kuota bisa dihitung PER BULAN tanpa
  // menimpa catatan bulan sebelumnya.
  handle.exec(`
    CREATE TABLE IF NOT EXISTS langganan (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      paket         TEXT NOT NULL,              -- standar | profesional | enterprise
      periode       TEXT NOT NULL DEFAULT 'bulanan',
      mulai_at      INTEGER NOT NULL,
      selesai_at    INTEGER,                    -- NULL = masih berjalan
      status        TEXT NOT NULL DEFAULT 'aktif',
      -- aktif | diperpanjang | berakhir | dibatalkan
      --
      -- 'diperpanjang' dibedakan dari 'berakhir': yang pertama berarti
      -- pengguna membayar lagi dan masa aktifnya digantikan baris baru;
      -- yang kedua berarti waktunya habis sendiri.
      dibuat_at     INTEGER NOT NULL,

      -- ── KENAPA payment_id UNIK ────────────────────────────────────────────
      -- Midtrans bisa mengirim webhook yang sama lebih dari sekali (kalau
      -- balasan kita lambat). Kalau setiap webhook menambah masa aktif,
      -- pembeli mendapat 2× masa aktif dari 1× pembayaran.
      --
      -- UNIQUE di sini membuat pelanggaran itu DITOLAK DATABASE — bukan hanya
      -- diperiksa kode. Pemeriksaan kode punya celah: dua webhook yang datang
      -- BERSAMAAN bisa dua-duanya membaca "belum ada" sebelum salah satunya
      -- menulis. Database tidak punya celah itu.
      payment_id    TEXT UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_langganan_user   ON langganan(user_id);
    CREATE INDEX IF NOT EXISTS idx_langganan_status ON langganan(status);

    -- ══════════════════════════════════════════════════════════════════════════
    -- PAKET YANG SEDANG BERLAKU UNTUK SEBUAH AKUN
    --
    -- ── KENAPA TABEL TERPISAH, BUKAN BARIS DI TABEL LANGGANAN ────────────────
    -- Godaannya: catat paket gratis sebagai baris di tabel langganan dengan
    -- paket='gratis'. Itu MERUSAK dua hal sekaligus — dan kerusakannya sudah
    -- dibuktikan sebelum tabel ini dibuat:
    --
    --   1. PERPANJANGAN MENANDAI BARIS GRATIS
    --      langganan-aktivasi.mjs menjalankan:
    --        UPDATE langganan SET status = 'diperpanjang'
    --        WHERE user_id = ? AND status = 'aktif'
    --      tanpa memandang paket. Baris gratis ikut tertandai "diperpanjang" —
    --      riwayatnya jadi salah: "gratis diperpanjang".
    --
    --   2. PAKET YANG TERBACA BISA SALAH
    --      paketPengguna() mengambil baris dengan mulai_at PALING BARU. Kalau
    --      baris gratis dibuat setelah baris berbayar (misalnya pengguna login
    --      ulang), pengguna BERBAYAR akan terbaca sebagai GRATIS. Akses yang
    --      sudah dia bayar hilang.
    --
    -- Tabel langganan adalah catatan TRANSAKSI: ia punya payment_id,
    -- periode, dan selesai_at. Paket gratis tidak punya satu pun dari ketiganya
    -- — tidak ada yang dibayar, tidak ada periode, tidak ada yang berakhir.
    -- Menaruhnya di sana berarti memaksakan makna yang tidak cocok.
    --
    -- ── KENAPA HANYA MENYIMPAN PAKET GRATIS ─────────────────────────────────
    -- Paket berbayar SELALU dibaca dari tabel langganan, tidak pernah dari sini.
    -- Dengan begitu tidak ada dua sumber yang bisa bertentangan: kalau
    -- langganan berbayar habis, paketnya kembali gratis tanpa perlu ada yang
    -- memperbarui tabel ini.
    --
    -- Tabel ini menjawab satu pertanyaan yang tidak bisa dijawab langganan:
    -- "sejak kapan akun ini memakai paket gratis?" — dan itu tidak sama dengan
    -- users.dibuat_at kalau pengguna pernah berlangganan lalu berhenti.
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS paket_akun (
      -- PRIMARY KEY di user_id: satu akun = satu paket berlaku.
      -- Tabel ini menyimpan KEADAAN SEKARANG, bukan riwayat. Riwayat
      -- transaksi tetap di tabel langganan.
      user_id       TEXT PRIMARY KEY,
      paket         TEXT NOT NULL DEFAULT 'gratis',
      mulai_at      INTEGER NOT NULL,
      diperbarui_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paket_akun_paket ON paket_akun(paket);

    -- Pemakaian kuota token per pengguna PER BULAN.
    --
    -- Satu baris = satu bulan. Dibuat saat pertama kali token dibuat di bulan
    -- itu; kalau belum ada barisnya, berarti terpakai = 0.
    --
    -- ── KENAPA DIBUAT SAAT DIPAKAI, BUKAN DI AWAL BULAN ─────────────────────
    -- Membuat baris untuk SEMUA pengguna di awal bulan berarti pekerjaan
    -- terjadwal yang harus berjalan tepat waktu — dan kalau meleset, semua
    -- orang tidak bisa membuat token. Dibuat saat dipakai: tidak ada jadwal
    -- yang bisa gagal, dan pengguna yang tidak aktif tidak menghasilkan baris.
    CREATE TABLE IF NOT EXISTS kuota_token (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      bulan       TEXT NOT NULL,                -- YYYY-MM, zona Asia/Jakarta
      terpakai    INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL,
      UNIQUE(user_id, bulan)
    );

    CREATE INDEX IF NOT EXISTS idx_kuota_user_bulan ON kuota_token(user_id, bulan);

    -- Bonus dari memberi star di repo GitHub.
    --
    -- UNIQUE(user_id) — SEKALI seumur akun, bukan per bulan. Ini yang membuat
    -- "hanya bisa terbaca 1" berlaku: klaim kedua ditolak database, bukan
    -- hanya diperiksa kode.
    CREATE TABLE IF NOT EXISTS bonus_star (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL UNIQUE,
      paket_saat_itu TEXT NOT NULL DEFAULT '',
      sumber         TEXT NOT NULL DEFAULT 'github',  -- github | manual
      github_user    TEXT NOT NULL DEFAULT '',
      diberikan_at   INTEGER NOT NULL,
      catatan        TEXT NOT NULL DEFAULT ''
    );

    -- Trial melihat data metrik untuk pengguna GRATIS.
    --
    -- ── UNIQUE(user_id) — SEKALI SEUMUR AKUN, BUKAN PER PROYEK ──────────────
    -- Dikonfirmasi pemilik proyek: "per akun, total 1× saja untuk semua
    -- proyek". Jadi pengguna gratis memilih SATU proyek yang ingin dinilai,
    -- dan setelah itu jatahnya habis.
    --
    -- Konsekuensi yang perlu diketahui: kalau dia salah pilih proyek, dia
    -- tidak bisa mencoba yang lain. Itu memang aturannya — trial ini untuk
    -- menilai KUALITAS data, bukan untuk menjelajahi semua proyek.
    --
    -- Kolom project_slug tetap dicatat supaya kita tahu proyek mana yang dipakai
    -- untuk trial — berguna saat menjawab "kenapa dia tidak bisa buka yang
    -- lain" dan untuk melihat proyek mana yang paling menarik minat.
    -- ══════════════════════════════════════════════════════════════════════════
    -- PROYEK YANG SUDAH DIBUKA METRIKNYA OLEH PENGGUNA GRATIS
    --
    -- ── PERUBAHAN ATURAN ═════════════════════════════════════════════════════
    -- Aturan LAMA: satu proyek per akun, dan harus memberi star dulu.
    --   Tabel lama (trial_metrik) punya UNIQUE(user_id) — satu baris per akun,
    --   karena memang hanya satu proyek yang boleh dibuka.
    --
    -- Aturan BARU: lima proyek per akun untuk paket Gratis.
    --     · Login  memberi 3 proyek
    --     · Star   menambah 2 proyek lagi (total 5)
    --   Jadi satu akun bisa membuka BEBERAPA proyek, dan tabelnya harus bisa
    --   menyimpan lebih dari satu baris per akun.
    --
    -- ── KENAPA SATU BARIS PER PROYEK, BUKAN SATU PENGHITUNG ══════════════════
    -- Godaannya: simpan satu angka "terpakai: 3" lalu naikkan tiap kali
    -- dibuka. Itu lebih sederhana, tapi punya tiga masalah:
    --
    --   1. Membuka proyek yang SAMA dua kali akan menghabiskan dua jatah —
    --      padahal pengguna tidak mendapat apa pun yang baru. Dengan satu baris
    --      per proyek, UNIQUE(user_id, project_slug) menolak duplikatnya.
    --
    --   2. Halaman tidak bisa menampilkan PROYEK MANA yang sudah dibuka —
    --      padahal itu yang perlu dia lihat untuk memutuskan proyek berikutnya.
    --
    --   3. Tidak ada jejak untuk menjawab "kenapa proyek ini terbuka?"
    --      saat ada pertanyaan dari pengguna.
    --
    -- ── KENAPA UNIQUE(user_id, project_slug) ═════════════════════════════════
    -- Ditegakkan DATABASE, bukan hanya kode. Dua permintaan yang datang
    -- bersamaan tidak bisa dua-duanya lolos hanya karena kode memeriksa lebih
    -- dulu — celah yang sama dengan yang sudah ditutup di tabel langganan.
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS metrik_terbuka (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      project_slug  TEXT NOT NULL,
      -- 'login' | 'star' — dari mana jatah ini berasal.
      -- Berguna saat menjawab "kenapa proyek ini terbuka?" dan saat menghitung
      -- berapa yang dipakai dari masing-masing sumber.
      sumber        TEXT NOT NULL DEFAULT 'login',
      dibuka_at     INTEGER NOT NULL,
      ip            TEXT NOT NULL DEFAULT '',
      user_agent    TEXT NOT NULL DEFAULT '',
      UNIQUE (user_id, project_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_metrik_user    ON metrik_terbuka(user_id);
    CREATE INDEX IF NOT EXISTS idx_metrik_proyek  ON metrik_terbuka(project_slug);

    -- Tabel LAMA dibiarkan ada. Isinya dipindahkan ke metrik_terbuka oleh
    -- migrasi di bawah, dan membiarkan tabelnya tidak merugikan apa pun —
    -- sementara menghapusnya berarti kehilangan data kalau migrasinya perlu
    -- diulang.
    CREATE TABLE IF NOT EXISTS trial_metrik (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL UNIQUE,
      project_slug  TEXT NOT NULL,
      dibuka_at     INTEGER NOT NULL,
      ip            TEXT NOT NULL DEFAULT '',
      user_agent    TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_trial_user ON trial_metrik(user_id);
  `);

  // Cache hasil pemeriksaan star GitHub, supaya tidak memanggil API setiap
  // permintaan. 6 jam: cukup lama untuk menghemat panggilan, cukup pendek
  // supaya orang yang baru memberi star tidak menunggu lama.
  handle.exec(`
    CREATE TABLE IF NOT EXISTS star_cache (
      github_user  TEXT PRIMARY KEY,
      starred      INTEGER NOT NULL DEFAULT 0,
      dicek_at     INTEGER NOT NULL
    );
  `);

  // ── LANGGANAN: kolom payment_id ───────────────────────────────────────────
  // Database yang dibuat SEBELUM fitur aktivasi otomatis belum punya kolom
  // ini. Tanpa migrasi, INSERT-nya gagal dengan "no such column: payment_id"
  // dan pembeli yang sudah membayar tidak mendapat langganannya.
  //
  // UNIQUE tidak bisa ditambahkan lewat addColumn() (SQLite hanya
  // mengizinkan kolom baru tanpa constraint tabel). Jadi indeks uniknya
  // dibuat terpisah — hasilnya sama: duplikat ditolak.
  addColumn('langganan', 'payment_id', 'TEXT');
  try {
    handle.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_langganan_payment ON langganan(payment_id) WHERE payment_id IS NOT NULL');
  } catch {
    // Kalau sudah ada (atau database lama punya duplikat), jangan gagalkan
    // migrasi — indeks adalah pengaman tambahan, bukan syarat berjalannya.
  }

  addColumn('sessions', 'wilayah', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'asn', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'zona_waktu', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'org', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'platform', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'model', "TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'jenis', "TEXT NOT NULL DEFAULT ''");

  // ── SUDO MODE (step-up 2FA untuk pembayaran) ─────────────────────────────
  // Database lama belum punya kolom ini; tanpa migrasi, UPDATE-nya gagal
  // dengan "no such column: sudo_until" dan step-up tidak pernah bisa
  // membuka akses — pembeli yang punya 2FA akan selamanya ditolak.
  addColumn('sessions', 'sudo_until', 'INTEGER NOT NULL DEFAULT 0');

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

  // ── FOTO PROFIL ───────────────────────────────────────────────────────────
  //
  // Database yang dibuat SEBELUM fitur ini punya tabel users tanpa kolom
  // avatar_key. Tanpa migrasi, setiap query yang menyebut kolom itu gagal
  // dengan "no such column" — dan karena query pengguna ada di jalur login,
  // SELURUH login ikut rusak, bukan hanya fitur fotonya.
  //
  // Kolomnya DEFAULT '' (bukan NULL): '' berarti "belum ada foto", dan
  // itu keadaan yang sah. NULL akan memaksa setiap pembaca memeriksa dua
  // bentuk kekosongan yang berbeda.
  addColumn('users', 'avatar_key', "TEXT NOT NULL DEFAULT ''");

  // ══ GRACE PERIOD — HAPUS AKUN DENGAN MASA TENGGANG ════════════════════════
  //
  // ── KENAPA TIDAK LANGSUNG HAPUS ────────────────────────────────────────────
  //
  // Versi pertama menghapus akun SEGERA. Itu melanggar standar korporat dan
  // berbahaya untuk pengguna:
  //
  //   • Salah klik / akun diretas → data hilang permanen, tidak bisa kembali
  //   • Dendam sesaat → pengguna kehilangan riwayat pembelian dan akses
  //   • Tidak ada jalan pulang sama sekali
  //
  // Riset: "Temporary soft deletion is acceptable as an intermediate state
  // (e.g., offering a 7-day grace period where users can cancel account
  // deletion), provided the hard purge runs automatically at the end of the
  // window." — dan GDPR memberi jendela 30 hari untuk memenuhi permintaan.
  //
  // GitHub, Google, Stripe, dan Facebook semuanya memakai masa tenggang.
  //
  // ── KENAPA 30 HARI ────────────────────────────────────────────────────────
  //
  // Itu batas respons GDPR (Pasal 12(3)): permintaan harus dipenuhi "tanpa
  // penundaan yang tidak semestinya" dan paling lambat 1 bulan. Menghapus
  // LEBIH CEPAT dari itu tidak melanggar — tapi menghapus lebih cepat berarti
  // menghilangkan kesempatan pengguna membatalkan.
  //
  // 30 hari = batas maksimum yang masih patuh, dan itu yang dipakai
  // vNext/Stripe/GitHub.
  //
  // ── KENAPA DISIMPAN SEBAGAI TIMESTAMP, BUKAN BOOLEAN ─────────────────────
  //
  // `dihapus_pada` memberi TIGA informasi sekaligus:
  //   1. Apakah ada permintaan hapus (NULL = tidak ada)
  //   2. Kapan permintaan dibuat (untuk menghitung sisa waktu)
  //   3. Kapan purge harus jalan (dihapus_pada + 30 hari)
  //
  // Boolean `akan_dihapus` hanya memberi nomor 1 — dan untuk menampilkan
  // "sisa 23 hari" atau menjadwalkan purge, dua informasi lainnya tetap
  // perlu kolom tambahan.
  //
  // ── KENAPA `status` IKUT DIPAKAI ─────────────────────────────────────────
  //
  // Kolom `status` sudah ada (nilai: 'aktif'). Saat pengguna meminta hapus,
  // statusnya jadi 'menunggu_hapus'. Itu membuat SEMUA pemeriksaan login
  // yang sudah ada (yang membaca `status`) otomatis menolak akun ini —
  // tanpa perlu menyentuh satu pun dari mereka.
  //
  // Menambah kolom boolean terpisah berarti SETIAP tempat yang memeriksa
  // login harus diperbarui. Satu yang terlewat = akun yang seharusnya
  // terkunci masih bisa masuk.
  addColumn('users', 'dihapus_pada', 'INTEGER');
  addColumn('users', 'alasan_hapus', "TEXT NOT NULL DEFAULT ''");

  // ── KOLOM PERSETUJUAN ADMIN ──────────────────────────────────────────────────
  //
  // ── MODEL KORPORAT: NONAKTIF → PERSETUJUAN → HAPUS ───────────────────────────
  //
  // Bukan "klik hapus → langsung hilang". Alurnya:
  //
  //   1. Pengguna minta hapus → akun NONAKTIF (data utuh)
  //   2. Admin/CS meninjau → SETUJU atau TOLAK
  //   3. Kalau disetujui → dihapus permanen
  //      Kalau tidak ada yang meninjau → otomatis setelah 12 bulan
  //
  // ── KENAPA ADMIN HARUS MENYETUJUI ────────────────────────────────────────────
  //
  // Ada situasi di mana penghapusan TIDAK BOLEH jalan, dan hanya manusia yang
  // bisa menilainya:
  //   • Sengketa pembayaran yang sedang berjalan
  //   • Investigasi penyalahgunaan
  //   • Kewajiban kontrak yang belum selesai
  //   • Permintaan dari akun yang sedang diperebutkan kepemilikannya
  //
  // Otomatisasi tidak bisa membedakan "pengguna ingin pergi" dari "penyerang
  // ingin menghapus jejak". Manusia bisa.
  //
  // ── KENAPA TETAP ADA JALUR OTOMATIS ──────────────────────────────────────────
  //
  // Kalau hanya admin yang bisa menghapus, akun yang benar-benar ditinggalkan
  // akan menumpuk selamanya — dan itu melanggar prinsip penyimpanan terbatas
  // GDPR (Pasal 5(1)(e)). 12 bulan adalah masa yang cukup untuk meninjau,
  // dan cukup lama sehingga tidak ada pengguna aktif yang terkena.
  addColumn('users', 'disetujui_oleh', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'disetujui_pada', 'INTEGER');
  addColumn('users', 'catatan_admin', "TEXT NOT NULL DEFAULT ''");

  // ══ KOLOM MIDTRANS — MIGRASI DARI SKEMA XENDIT ════════════════════════════
  //
  // ── KENAPA INI ADA ─────────────────────────────────────────────────────────
  //
  // Commit yang memindahkan pembayaran dari Xendit ke Midtrans mengubah
  // definisi `CREATE TABLE payments` — TAPI `CREATE TABLE IF NOT EXISTS`
  // tidak menyentuh tabel yang sudah ada. Database produksi tetap memakai
  // skema lama: kolom xendit_* ada, kolom midtrans_* TIDAK.
  //
  // Akibatnya nyata dan mahal: setiap checkout menulis baris pembayaran,
  // memanggil Midtrans, lalu GAGAL di UPDATE yang menyebut
  // midtrans_order_id — "no such column: midtrans_order_id". Pembeli
  // melihat pesan galat dan pembayaran tidak pernah tercatat selesai.
  //
  // Kolom xendit_* sengaja TIDAK dihapus: SQLite versi lama tidak bisa
  // DROP COLUMN, dan baris lama mungkin masih menyimpan nilainya —
  // menghapus riwayat bukan urusan migrasi ini.
  addColumn('payments', 'midtrans_order_id', 'TEXT');
  addColumn('payments', 'midtrans_customer_id', 'TEXT');
  addColumn('payments', 'midtrans_subscription_id', 'TEXT');

  // ── URL PEMBAYARAN TERSIMPAN ──────────────────────────────────────────────
  // Lihat catatan di SCHEMA: API status Midtrans tidak mengenal transaksi Snap
  // yang belum dibuka, jadi URL-nya harus disimpan sendiri agar percobaan
  // ulang tidak membuat transaksi kedua.
  addColumn('payments', 'payment_url', 'TEXT');
  addColumn('payments', 'snap_token', 'TEXT');

  // ── INDEX PEMBAYARAN ───────────────────────────────────────────────────────
  //
  // Index lama idx_payments_invoice menunjuk ke xendit_invoice_id. Setelah
  // kolom midtrans_order_id ada, index itu menunjuk kolom yang tidak lagi
  // ditulis siapa pun — dibuang, lalu diganti index UNIK pada kolom yang
  // benar.
  //
  // ── KENAPA UNIKNYA LEWAT INDEX, BUKAN DI DEFINISI KOLOM ──────────────────
  //
  // `ALTER TABLE ADD COLUMN` tidak menerima UNIQUE di SQLite — jadi kolom
  // hasil migrasi tidak bisa membawa jaminan itu sendiri. Index unik
  // memberi jaminan yang SAMA untuk database lama maupun baru.
  //
  // Dibuat SETELAH kolomnya ada. Kalau ditulis di SCHEMA, database lama
  // akan gagal start dengan "no such column" sebelum migrasi sempat jalan.
  try {
    handle.exec('DROP INDEX IF EXISTS idx_payments_invoice');
    handle.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_midtrans_order ON payments(midtrans_order_id)'
    );
  } catch (err) {
    // Index unik gagal dibuat (mis. ada nilai duplikat di database lain).
    // Bukan alasan menggagalkan start — tapi harus terlihat di log, karena
    // jaminan "satu transaksi = satu token" jadi bergantung pada kode saja.
    console.warn(`[migrasi] index midtrans_order_id tidak dibuat: ${err?.message ?? err}`);
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
let transactionSequence = 0;
export function transaction(fn) {
  const handle = getDb();
  const savepoint = `atomic_${++transactionSequence}`;
  handle.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = fn();
    handle.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    handle.exec(`ROLLBACK TO ${savepoint}`);
    handle.exec(`RELEASE ${savepoint}`);
    throw err;
  }
}
