/**
 * Uji migrasi kolom Midtrans pada database LAMA (skema era Xendit).
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 *
 * Perpindahan penyedia pembayaran Xendit → Midtrans mengubah definisi
 * `CREATE TABLE payments` — tapi `CREATE TABLE IF NOT EXISTS` TIDAK
 * menyentuh tabel yang sudah ada. Database produksi tetap memakai skema
 * lama, dan setiap checkout gagal dengan:
 *
 *   "no such column: midtrans_order_id"
 *
 * Database BARU selalu benar (SCHEMA membuatnya lengkap). Yang rusak hanya
 * database LAMA — dan tidak ada tes lama yang memakai DB lama. Tes ini
 * menutup celah itu: DB dibangun dengan skema lama PERSIS seperti produksi,
 * lalu `openDb()` dijalankan di atasnya dan hasil migrasinya diperiksa.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── SKEMA LAMA — DIBEKUKAN, BUKAN DIIMPOR ───────────────────────────────────
// Disalin dari commit tepat sebelum migrasi Midtrans. Sengaja tidak diimpor
// dari db.mjs: tujuannya membekukan bentuk database yang SUDAH ADA di
// produksi. Kalau skema lama ikut berubah, tes berhenti menguji hal yang
// benar.
const SKEMA_LAMA = `
CREATE TABLE payments (
  id                  TEXT PRIMARY KEY,
  idempotency_key     TEXT NOT NULL UNIQUE,
  xendit_invoice_id   TEXT UNIQUE,
  xendit_customer_id  TEXT,
  xendit_recurring_id TEXT,
  tier                TEXT NOT NULL,
  periode             TEXT NOT NULL,
  jumlah              INTEGER NOT NULL,
  email               TEXT NOT NULL DEFAULT '',
  nama                TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending',
  alasan_gagal        TEXT,
  token_id            TEXT,
  dibuat_pada         INTEGER NOT NULL,
  dibayar_pada        INTEGER,
  kedaluwarsa_pada    INTEGER,
  catatan             TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_payments_status  ON payments(status, dibuat_pada DESC);
CREATE INDEX idx_payments_email   ON payments(email);
CREATE INDEX idx_payments_invoice ON payments(xendit_invoice_id);
`;

const DIR = mkdtempSync(join(tmpdir(), 'uji-migrasi-midtrans-'));
const DB_LAMA = join(DIR, 'lama.db');
const DB_BARU = join(DIR, 'baru.db');

after(() => rmSync(DIR, { recursive: true, force: true }));

const { openDb, closeDb, migrateUlang } = await import(
  join(AKAR, 'backend', 'src', 'db.mjs')
);

const kolomPayments = (h) =>
  h.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);

/** Database skema LAMA + satu baris pembayaran era Xendit. */
function siapkanDbLama() {
  const raw = new DatabaseSync(DB_LAMA);
  raw.exec(SKEMA_LAMA);
  raw.prepare(`
    INSERT INTO payments (id, idempotency_key, xendit_invoice_id, tier, periode,
                          jumlah, email, nama, status, dibuat_pada)
    VALUES (?, ?, ?, 'standar', 'bulanan', 200000, 'lama@contoh.id', 'Pembeli Lama', 'dibayar', ?)
  `).run('pay_lama_1', 'kunci-lama-00000001', 'xnd_inv_1', Date.now());
  raw.close();
}

test('database skema lama mendapat kolom midtrans_* setelah migrasi', () => {
  siapkanDbLama();
  const h = openDb(DB_LAMA);

  const kolom = kolomPayments(h);
  for (const c of ['midtrans_order_id', 'midtrans_customer_id', 'midtrans_subscription_id']) {
    assert.ok(kolom.includes(c), `kolom ${c} harus ada setelah migrasi`);
  }

  // Kolom & data era Xendit TIDAK dihapus — riwayat tetap utuh.
  assert.ok(kolom.includes('xendit_invoice_id'), 'kolom xendit_* lama tidak boleh hilang');
  const baris = h.prepare('SELECT * FROM payments WHERE id = ?').get('pay_lama_1');
  assert.equal(baris.xendit_invoice_id, 'xnd_inv_1', 'data lama harus tetap terbaca');

  closeDb();
});

test('UPDATE midtrans_order_id yang dulu gagal kini berhasil (regresi checkout)', () => {
  const h = openDb(DB_LAMA);

  // PERSIS pola yang dipakai checkout.mjs setelah Snap menerbitkan token —
  // baris inilah yang dulu melempar "no such column: midtrans_order_id".
  const hasil = h.prepare(
    'UPDATE payments SET midtrans_order_id = ?, kedaluwarsa_pada = ? WHERE id = ?'
  ).run('pay_lama_1', Date.now() + 86400000, 'pay_lama_1');

  assert.equal(hasil.changes, 1, 'UPDATE harus menyentuh tepat satu baris');
  const sesudah = h.prepare('SELECT midtrans_order_id FROM payments WHERE id = ?').get('pay_lama_1');
  assert.equal(sesudah.midtrans_order_id, 'pay_lama_1', 'nilai harus tersimpan');

  closeDb();
});

test('keunikan midtrans_order_id ditegakkan lewat index unik', () => {
  const h = openDb(DB_LAMA);

  const idx = h.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_payments_midtrans_order'"
  ).get();
  assert.ok(idx, 'index idx_payments_midtrans_order harus ada');
  assert.match(idx.sql, /UNIQUE/i, 'index harus UNIK');
  assert.match(idx.sql, /midtrans_order_id/, 'index harus menunjuk midtrans_order_id');

  // Index lama era Xendit sudah dibuang — tidak menunjuk kolom mati.
  const lama = h.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_payments_invoice'"
  ).get();
  assert.equal(lama, undefined, 'index lama idx_payments_invoice harus dibuang');

  // Dua baris dengan order_id sama harus ditolak — inilah jaminan
  // "satu transaksi Midtrans = satu token".
  h.prepare(`
    INSERT INTO payments (id, idempotency_key, midtrans_order_id, tier, periode, jumlah, dibuat_pada)
    VALUES ('pay_dup_1', 'kunci-dup-0000000001', 'pay_sama', 'standar', 'bulanan', 1, ?)
  `).run(Date.now());

  assert.throws(
    () => h.prepare(`
      INSERT INTO payments (id, idempotency_key, midtrans_order_id, tier, periode, jumlah, dibuat_pada)
      VALUES ('pay_dup_2', 'kunci-dup-0000000002', 'pay_sama', 'standar', 'bulanan', 1, ?)
    `).run(Date.now()),
    /UNIQUE/i,
    'order_id duplikat harus ditolak database'
  );

  closeDb();
});

test('migrasi idempoten — dijalankan berkali-kali tetap aman', () => {
  const h = openDb(DB_LAMA);
  migrateUlang();
  migrateUlang();
  assert.ok(kolomPayments(h).includes('midtrans_order_id'));
  closeDb();
});

test('skema baru sepenuhnya tercakup oleh skema lama setelah migrasi', () => {
  const hLama = openDb(DB_LAMA);
  const kolomLama = new Set(kolomPayments(hLama));
  const indexLama = hLama.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'payments' "
    + "AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
  ).all().map((r) => r.name);
  closeDb();

  const hBaru = openDb(DB_BARU);
  const kolomBaru = kolomPayments(hBaru);
  const indexBaru = hBaru.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'payments' "
    + "AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
  ).all().map((r) => r.name);
  closeDb();

  // DB lama boleh punya KELEBIHAN kolom (xendit_* yang sengaja
  // dipertahankan), tapi tidak boleh KURANG satu pun dari yang dipakai
  // kode saat ini — kalau kurang, bug "hanya di produksi" akan kembali.
  for (const c of kolomBaru) {
    assert.ok(kolomLama.has(c), `kolom "${c}" ada di DB baru tapi tidak di DB lama-migrasi`);
  }
  assert.deepEqual(indexLama, indexBaru, 'daftar index payments harus sama');
});
