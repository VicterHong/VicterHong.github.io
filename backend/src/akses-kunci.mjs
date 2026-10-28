/**
 * Kunci akses aplikasi — URL acak panjang yang membuka React penuh.
 *
 * ── BEDA DENGAN `tokens` ─────────────────────────────────────────────────────
 * `tokens` dipakai untuk berbagi PROYEK: satu token bisa membuka beberapa slug
 * lewat /api/project/:slug/locked. Modul ini untuk hal lain: satu PEMBELI
 * mendapat satu URL, dan URL itu memuat aplikasi React beserta aset 3D-nya.
 *
 * Kode disimpan sebagai hash SHA-256, bukan plaintext. Konsekuensinya: kode
 * asli hanya terlihat SEKALI saat diterbitkan. Kalau hilang, harus terbit baru
 * — itu memang perilaku yang diinginkan untuk kunci berumur panjang.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db.mjs';
import { config } from './config.mjs';

const now = () => Date.now();

/** 32 byte = 64 karakter hex. Cukup untuk tidak bisa ditebak. */
export function buatKode() {
  return randomBytes(32).toString('hex');
}

export function hashKode(kode, secret = config.secret) {
  return createHash('sha256').update(`${secret}:akses:${kode}`).digest('hex');
}

function idKunci() {
  return 'ak_' + randomBytes(8).toString('hex');
}

/**
 * Terbitkan kunci baru.
 *
 * @param {object} opsi
 * @param {string} opsi.issuedTo   identitas pembeli (email / order code)
 * @param {string} [opsi.label]    catatan manusiawi
 * @param {string} [opsi.plan]     'lifetime' | '1y' | 'trial'
 * @param {number|null} [opsi.expiresAt] epoch ms; null = tanpa kedaluwarsa
 * @returns {{ kode: string, id: string, expiresAt: number|null }}
 */
export function terbitkanKunci({ issuedTo = '', label = '', plan = 'lifetime', expiresAt = null } = {}) {
  const kode = buatKode();
  const id = idKunci();
  const at = now();

  getDb().prepare(`
    INSERT INTO access_keys (id, code_hash, label, issued_to, plan, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, hashKode(kode), label, issuedTo, plan, at, expiresAt);

  // Kode dikembalikan SEKALI di sini. Tidak ada jalan untuk membacanya lagi.
  return { kode, id, expiresAt };
}

/**
 * Cari kunci berdasarkan kode mentah dari URL.
 * @returns {object|null} baris, atau null kalau tidak ada / tidak sah
 */
export function cariKunci(kode) {
  if (typeof kode !== 'string' || !/^[a-f0-9]{64}$/.test(kode)) return null;

  const row = getDb()
    .prepare('SELECT * FROM access_keys WHERE code_hash = ?')
    .get(hashKode(kode)) ?? null;

  return row;
}

/** Cari kunci berdasarkan ID internalnya (bukan kode). */
export function cariKunciById(id) {
  if (typeof id !== 'string' || !/^ak_[a-f0-9]{16}$/.test(id)) return null;
  return getDb().prepare('SELECT * FROM access_keys WHERE id = ?').get(id) ?? null;
}

/** Alasan kunci tidak bisa dipakai, atau null kalau sah. */
export function masalahKunci(row, at = now()) {
  if (!row) return 'tidak_ditemukan';
  if (row.revoked_at) return 'dicabut';
  if (row.expires_at && at > row.expires_at) return 'kedaluwarsa';
  return null;
}

/** Catat pemakaian. Dipanggil setelah kunci lolos pemeriksaan. */
export function catatPemakaian(row, { ip = '' } = {}) {
  try {
    getDb().prepare(`
      UPDATE access_keys
         SET last_used_at = ?, use_count = use_count + 1
       WHERE id = ?
    `).run(now(), row.id);
  } catch {
    // Pencatatan metrik tidak boleh menggagalkan akses yang sudah sah.
  }
}

/** Cabut kunci. */
export function cabutKunci(id, alasan = 'manual') {
  const info = getDb().prepare(`
    UPDATE access_keys SET revoked_at = ?, revoked_reason = ? WHERE id = ?
  `).run(now(), alasan, id);
  return info.changes > 0;
}

/** Daftar kunci untuk panel admin. Kode TIDAK pernah dikembalikan. */
export function daftarKunci({ limit = 100 } = {}) {
  return getDb().prepare(`
    SELECT id, label, issued_to, plan, issued_at, expires_at,
           revoked_at, revoked_reason, last_used_at, use_count, max_ips, notes
      FROM access_keys
     ORDER BY issued_at DESC
     LIMIT ?
  `).all(limit);
}
