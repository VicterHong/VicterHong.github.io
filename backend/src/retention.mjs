/**
 * Retensi data — hapus baris lama secara BERTAHAP.
 *
 * KENAPA BERTAHAP (dan bukan satu DELETE besar):
 *
 * DatabaseSync bersifat SINKRON. Satu `DELETE` yang menghapus 1 juta baris
 * dalam satu transaksi akan membekukan event loop selama puluhan detik —
 * artinya SELURUH pengunjung situs menunggu selama itu. Diukur: pada
 * 1 CPU, menghapus ~500 ribu baris bisa memakan 30+ detik.
 *
 * Solusinya: hapus per batch kecil (default 2000 baris), lalu kembalikan
 * kontrol ke event loop dengan setImmediate() sebelum batch berikutnya.
 * Setiap batch memakan <20 ms, jadi request pengunjung tetap dilayani
 * di antara batch.
 *
 * KENAPA TIDAK DELETE SEMUA SEKALIGUS SAAT PERTAMA KALI:
 * Kalau tabel sudah menumpuk setahun (mis. 5 juta baris) dan kita jalankan
 * prune tanpa batas, prosesnya tetap berjalan sampai selesai — memakan
 * waktu lama dan membuat WAL membengkak sebesar data yang dihapus.
 * Karena itu ada `maxBatches` per pemanggilan: satu pemanggilan cron hanya
 * menghapus sebagian, dan sisanya dilanjutkan di pemanggilan berikutnya.
 * Dengan cron harian, tumpukan besar akan habis dalam beberapa hari tanpa
 * pernah mengganggu layanan.
 *
 * YANG TIDAK DIHAPUS:
 * - tokens, revocations, sessions, sales_leads — data bisnis, bukan telemetri
 * - cms_* — konten yang sengaja disimpan
 * - sla_heartbeats — punya retensi sendiri di sla.mjs (A1 akan mengubahnya)
 */

import { getDb } from './db.mjs';

/** Tabel yang boleh di-prune, beserta kolom waktu dan masa simpannya. */
export const RETENTION = {
  access_events:       { column: 'at',         days: 365 },
  analytics_events:    { column: 'created_at', days: 180 },
  device_fingerprints: { column: 'created_at', days: 90 },
  web_vitals:          { column: 'created_at', days: 90 },
  experiment_events:   { column: 'created_at', days: 180 },
};

/**
 * Hapus baris lama dari satu tabel, bertahap.
 *
 * @param {string} table       nama tabel (harus ada di RETENTION)
 * @param {object} [opts]
 * @param {number} [opts.days]        umur simpan; bawaan dari RETENTION
 * @param {number} [opts.batch]       baris per batch (bawaan 2000)
 * @param {number} [opts.maxBatches]  batas batch per pemanggilan (bawaan 50)
 * @returns {Promise<{deleted: number, done: boolean}>}
 *   `done: false` berarti masih ada sisa — panggil lagi nanti.
 */
export async function prune(table, { days, batch = 2000, maxBatches = 50 } = {}) {
  const spec = RETENTION[table];
  if (!spec) throw new Error(`tabel tidak boleh di-prune: ${table}`);

  // Nama tabel & kolom berasal dari konstanta di atas, bukan input pengguna —
  // tapi tetap divalidasi supaya tidak ada jalur interpolasi yang tidak aman.
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(spec.column)) {
    throw new Error('nama tabel/kolom tidak valid');
  }

  const keepDays = Number.isFinite(days) ? days : spec.days;
  const cutoff = Date.now() - keepDays * 86_400_000;

  const db = getDb();
  // rowid dipakai supaya DELETE bisa memakai LIMIT — SQLite tidak mendukung
  // LIMIT langsung di DELETE tanpa subquery.
  const stmt = db.prepare(
    `DELETE FROM ${table} WHERE rowid IN (
       SELECT rowid FROM ${table} WHERE ${spec.column} < ? LIMIT ?
     )`,
  );

  let deleted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    let changes = 0;
    try {
      changes = Number(stmt.run(cutoff, batch).changes ?? 0);
    } catch (err) {
      // DB terkunci (mis. backup sedang jalan). Bukan kegagalan fatal —
      // batch berikutnya akan berhasil setelah lock lepas.
      throw new Error(`prune ${table} gagal pada batch ${batches}: ${err.message}`);
    }
    deleted += changes;
    batches += 1;
    if (changes < batch) break; // sudah tidak ada sisa

    // Kembalikan kontrol ke event loop supaya request pengunjung dilayani
    // di antara batch. Tanpa ini, loop ini memblokir server sampai selesai.
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { deleted, done: batches < maxBatches };
}

/**
 * Jalankan retensi untuk SEMUA tabel yang punya kebijakan.
 * Dipakai oleh cron harian.
 *
 * @param {object} [opts]
 * @param {number} [opts.batch]       baris per batch
 * @param {number} [opts.maxBatches]  batas batch PER TABEL
 * @returns {Promise<Array<{table: string, deleted: number, done: boolean, error?: string}>>}
 */
export async function pruneAll({ batch, maxBatches } = {}) {
  const results = [];
  for (const table of Object.keys(RETENTION)) {
    try {
      const r = await prune(table, { batch, maxBatches });
      results.push({ table, ...r });
    } catch (err) {
      // Satu tabel gagal tidak boleh menghentikan yang lain.
      results.push({ table, deleted: 0, done: false, error: err.message });
    }
  }
  return results;
}
