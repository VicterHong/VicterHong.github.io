/**
 * Manajemen sesi cookie-based.
 *
 * Session = httpOnly Secure SameSite cookie yang berisi session ID acak.
 * Setiap sesi terhubung ke satu token. maxDevices = batas sesi aktif per token.
 *
 * Tidak pakai dependency eksternal — hanya modul bawaan Node.
 */

import { randomBytes, createHash } from 'node:crypto';
import { getDb, now, transaction } from './db.mjs';

/** ID acak untuk sesi (256-bit, hex). */
function sessionId() {
  return 'sess_' + randomBytes(32).toString('hex');
}

/**
 * Hash session ID untuk penyimpanan (tidak simpan plaintext session ID).
 *
 * ── KENAPA DIEKSPOR ─────────────────────────────────────────────────────────
 * Halaman akun perlu tahu sesi MANA yang sedang dipakai browser ini, supaya
 * bisa menandainya "Perangkat ini" dan mencegahnya dicabut dari daftar.
 *
 * Untuk itu, session_id dari cookie harus di-hash dengan cara yang PERSIS
 * sama seperti saat pembuatan sesi — kalau tidak, hash-nya tidak akan cocok
 * dengan kolom `id` dan pencocokan gagal.
 *
 * Menyalin logikanya ke berkas lain akan berbahaya: mengubah format hash di
 * sini (misalnya menambah salt) akan membuat salinannya diam-diam tidak
 * cocok lagi. Mengekspornya membuat hanya ada SATU definisi.
 */
export function hashSession(id, secret) {
  return createHash('sha256').update(`${secret}:${id}`).digest('hex');
}

/**
 * Buat sesi baru untuk token.
 * Kalau sudah mencapai maxDevices, hapus sesi paling lama (FIFO).
 */
export function createSession({
  tokenId, secret, deviceFp = '', ip = '', country = '', userAgent = '',
  durationHours = 24, maxDevices = null,
}) {
  const id = sessionId();
  const at = now();
  const expiresAt = at + durationHours * 3_600_000;

  // Kalau maxDevices tidak disediakan, baca dari token row
  let effectiveMaxDevices = maxDevices;
  if (effectiveMaxDevices === null || effectiveMaxDevices === undefined) {
    const tokenRow = getDb().prepare('SELECT max_devices FROM tokens WHERE id = ?').get(tokenId);
    effectiveMaxDevices = tokenRow?.max_devices ?? 3;
  }

  transaction(() => {
    // Hitung sesi aktif token ini (yang belum expired)
    const at = now();
    const active = getDb().prepare(
      'SELECT COUNT(*) as n FROM sessions WHERE token_id = ? AND expires_at > ?'
    ).get(tokenId, at).n;

    // Kalau penuh, hapus sesi paling lama (yang belum expired)
    if (active >= effectiveMaxDevices) {
      const toRemove = getDb().prepare(
        'SELECT id FROM sessions WHERE token_id = ? AND expires_at > ? ORDER BY created_at ASC LIMIT ?'
      ).all(tokenId, at, active - effectiveMaxDevices + 1);
      for (const row of toRemove) {
        getDb().prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
      }
    }

    getDb().prepare(`
      INSERT INTO sessions (id, token_id, device_fp, ip, country, user_agent, created_at, last_seen, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hashSession(id, secret), tokenId, deviceFp, ip, country, userAgent, at, at, expiresAt);
  });

  return { id, expiresAt };
}

/**
 * Validasi session ID dari cookie.
 * Mengembalikan { tokenRow, sessionRow } atau null kalau tidak valid.
 */
export function validateSession(sessionId, secret) {
  if (!sessionId || !secret) return null;
  const hash = hashSession(sessionId, secret);
  const at = now();

  const session = getDb().prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(hash, at) ?? null;
  if (!session) return null;

  // Update last_seen — TAPI hanya kalau sudah lebih dari 60 detik.
  //
  // A5: sebelumnya baris ini menulis pada SETIAP request terautentikasi.
  // Setiap tulis = satu commit = satu fsync (dengan synchronous=FULL).
  // Di disk VPS, fsync memakan 1-10 ms dan selama itu event loop BLOKIR.
  // Pada 8 req/detik itu berarti lantai latensi yang tidak perlu.
  //
  // 60 detik dipilih karena: last_seen dipakai untuk menampilkan "terakhir
  // aktif" dan membersihkan sesi kedaluwarsa — resolusi 1 menit sudah lebih
  // dari cukup untuk keduanya. Presisi detik tidak memberi manfaat apa pun
  // yang sebanding dengan biaya fsync per request.
  if (at - Number(session.last_seen ?? 0) > 60_000) {
    getDb().prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(at, hash);
  }

  // Ambil token terkait
  const token = getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(session.token_id) ?? null;
  if (!token) return null;

  if (token.scopes) {
    try { token.scopes = JSON.parse(token.scopes); } catch { token.scopes = [token.project_slug]; }
  }

  return { tokenRow: token, sessionRow: session };
}

/**
 * Hapus sesi (logout atau revoke).
 */
export function destroySession(sessionId, secret) {
  if (!sessionId || !secret) return false;
  const hash = hashSession(sessionId, secret);
  const info = getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hash);
  return info.changes > 0;
}

/**
 * Hapus semua sesi expired (cleanup).
 */
export function cleanupExpiredSessions() {
  const at = now();
  const info = getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(at);
  return info.changes;
}

/**
 * Hitung sesi aktif per token.
 */
export function countSessions(tokenId) {
  const at = now();
  return getDb().prepare(
    'SELECT COUNT(*) as n FROM sessions WHERE token_id = ? AND expires_at > ?'
  ).get(tokenId, at).n;
}
