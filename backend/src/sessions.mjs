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

/** Hash session ID untuk penyimpanan (tidak simpan plaintext session ID). */
function hashSession(id, secret) {
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

  // Update last_seen
  getDb().prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(at, hash);

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
