/**
 * Uji migrasi pada SALINAN database produksi.
 *
 * Membuat salinan konsisten (VACUUM INTO), menjalankan openDb() — yang
 * menjalankan SCHEMA + migrate() — lalu memverifikasi bahwa:
 *   1. kolom midtrans_* muncul,
 *   2. UPDATE yang dulu gagal ("no such column") kini berhasil,
 *   3. index unik dibuat dan index lama dibuang,
 *   4. semua baris lama tetap utuh (tidak ada data hilang).
 *
 * Path DB sumber bisa diatur lewat env DB_ASLI (default: DB produksi
 * layanan token). Tidak pernah menulis ke DB asli — hanya membacanya
 * lewat VACUUM INTO.
 */
import { DatabaseSync } from 'node:sqlite';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ASLI = process.env.DB_ASLI ?? join(homedir(), '.portfolio-token', 'tokens.db');
const SALINAN = process.env.DB_SALINAN ?? '/tmp/uji-migrasi/salinan-bersih.db';

// ── 1. Salinan konsisten ────────────────────────────────────────────────────
const src = new DatabaseSync(ASLI, { readOnly: true });
try { src.exec(`VACUUM INTO '${SALINAN}'`); } catch (e) {
  // VACUUM INTO gagal kalau file tujuan sudah ada — hapus dan ulangi.
  const { rmSync } = await import('node:fs');
  rmSync(SALINAN, { force: true });
  rmSync(SALINAN + '-wal', { force: true });
  rmSync(SALINAN + '-shm', { force: true });
  src.exec(`VACUUM INTO '${SALINAN}'`);
}
const sebelum = {
  cols: src.prepare('PRAGMA table_info(payments)').all().map((c) => c.name),
  baris: src.prepare('SELECT COUNT(*) AS n FROM payments').get().n,
  isi: src.prepare('SELECT id, status, tier FROM payments ORDER BY dibuat_pada').all(),
};
src.close();
console.log(`[salinan] payments: ${sebelum.baris} baris, ${sebelum.cols.length} kolom`);
console.log(`[salinan] kolom xendit_* ada: ${sebelum.cols.filter((c) => c.startsWith('xendit')).join(', ') || '(tidak ada)'}`);
console.log(`[salinan] kolom midtrans_* ada: ${sebelum.cols.filter((c) => c.startsWith('midtrans')).join(', ') || '(TIDAK ADA — inilah bugnya)'}`);

// ── 2. Jalankan migrasi pada salinan ────────────────────────────────────────
openDb(SALINAN);
const db = getDb();

const sesudah = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
const baru = sesudah.filter((c) => !sebelum.cols.includes(c));
console.log(`[migrasi] kolom baru: ${baru.join(', ')}`);

const gagal = [];
if (!sesudah.includes('midtrans_order_id')) gagal.push('midtrans_order_id tidak ada');
if (!sesudah.includes('midtrans_customer_id')) gagal.push('midtrans_customer_id tidak ada');
if (!sesudah.includes('midtrans_subscription_id')) gagal.push('midtrans_subscription_id tidak ada');

// ── 3. UPDATE yang dulu gagal — regresi checkout ────────────────────────────
const target = db.prepare('SELECT id FROM payments ORDER BY dibuat_pada LIMIT 1').get();
if (target) {
  try {
    db.prepare("UPDATE payments SET midtrans_order_id = ? WHERE id = ?").run('UJI-MIGRASI-001', target.id);
    db.prepare("UPDATE payments SET midtrans_order_id = NULL WHERE id = ?").run(target.id);
    console.log('[regresi] UPDATE midtrans_order_id: BERHASIL (dulu "no such column")');
  } catch (e) {
    gagal.push(`UPDATE midtrans_order_id gagal: ${e.message}`);
  }
}

// ── 4. Index ────────────────────────────────────────────────────────────────
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='payments'").all();
const namaIdx = idx.map((i) => i.name);
console.log(`[index] setelah migrasi: ${namaIdx.join(', ')}`);
if (!namaIdx.includes('idx_payments_midtrans_order')) gagal.push('index unik midtrans tidak dibuat');
if (namaIdx.includes('idx_payments_invoice')) gagal.push('index lama idx_payments_invoice tidak dibuang');

// Index unik benar-benar unik?
try {
  db.prepare("INSERT INTO payments (id, idempotency_key, midtrans_order_id, tier, periode, jumlah, dibuat_pada) VALUES ('uji-a', 'uji-a', 'UJI-UNIK-1', 'standar', 'bulanan', 1, 0)").run();
  try {
    db.prepare("INSERT INTO payments (id, idempotency_key, midtrans_order_id, tier, periode, jumlah, dibuat_pada) VALUES ('uji-b', 'uji-b', 'UJI-UNIK-1', 'standar', 'bulanan', 1, 0)").run();
    gagal.push('index unik TIDAK menolak duplikat');
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) console.log('[index] duplikat midtrans_order_id ditolak: OK');
    else gagal.push(`duplikat gagal dengan galat tak terduga: ${e.message}`);
  }
  db.prepare("DELETE FROM payments WHERE id IN ('uji-a','uji-b')").run();
} catch (e) {
  gagal.push(`uji unik gagal: ${e.message}`);
}

// ── 5. Data lama utuh ───────────────────────────────────────────────────────
const isiSesudah = db.prepare('SELECT id, status, tier FROM payments ORDER BY dibuat_pada').all();
if (JSON.stringify(sebelum.isi) !== JSON.stringify(isiSesudah)) {
  gagal.push('DATA BERUBAH setelah migrasi!');
} else {
  console.log('[data] semua baris lama utuh');
}

closeDb();

console.log();
if (gagal.length) {
  console.log('GAGAL:');
  for (const g of gagal) console.log('  ✖', g);
  process.exit(1);
}
console.log('SEMUA VERIFIKASI PADA SALINAN PRODUKSI LULUS ✔');
