/**
 * Penerbitan dan verifikasi token.
 *
 * Token disimpan HANYA sebagai hash (SHA-256 + salt dari SERVICE_SECRET). Plaintext
 * ditampilkan sekali saat terbit. Kalau database bocor, token tidak langsung bisa dipakai.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb, now, transaction } from './db.mjs';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // base32 tanpa huruf/angka ambigu

/** String acak kriptografis dari alfabet tanpa karakter ambigu. */
function randomToken(length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Hash token dengan salt dari secret layanan. */
export function hashToken(plaintext, secret) {
  return createHash('sha256').update(`${secret}:${plaintext}`).digest('hex');
}

/** ID unik untuk baris token (bukan rahasia). */
function tokenId() {
  return 'tok_' + randomBytes(8).toString('hex');
}

/** Bandingkan dua hash tanpa membocorkan waktu. */
export function hashesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Terbitkan token baru.
 * @returns {{id: string, token: string, project_slug: string, expires_at: number|null}}
 *   `token` adalah plaintext — satu-satunya kesempatan melihatnya.
 */
export function issueToken({
  secret, projectSlug, label = '', issuedTo = '', issuedBy = 'admin',
  expiresInDays = null, maxIps = 3, notes = '', prefix = 'pv_',
}) {
  const plaintext = prefix + randomToken(32);
  const id = tokenId();
  const issuedAt = now();
  const expiresAt = expiresInDays ? issuedAt + expiresInDays * 86_400_000 : null;

  transaction(() => {
    getDb().prepare(`
      INSERT INTO tokens (id, token_hash, label, project_slug, issued_to, issued_by,
                          issued_at, expires_at, max_ips, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, hashToken(plaintext, secret), label, projectSlug, issuedTo, issuedBy,
           issuedAt, expiresAt, maxIps, notes);
  });

  return { id, token: plaintext, project_slug: projectSlug, expires_at: expiresAt, max_ips: maxIps };
}

/** Cari baris token berdasarkan plaintext. */
export function findTokenByPlaintext(plaintext, secret) {
  const hash = hashToken(plaintext, secret);
  return getDb().prepare('SELECT * FROM tokens WHERE token_hash = ?').get(hash) ?? null;
}

/** Alasan token tidak valid, atau null kalau valid. */
export function tokenProblem(row, at = now()) {
  if (!row) return 'not_found';
  if (row.status === 'revoked' || row.revoked_at) return 'revoked';
  if (row.status === 'suspended') return 'suspended';
  if (row.expires_at && at > row.expires_at) return 'expired';
  return null;
}

/** Cabut token secara manual. */
export function revokeToken(tokenId, reason, { automatic = false, detail = '' } = {}) {
  return transaction(() => {
    const at = now();
    const info = getDb().prepare(`
      UPDATE tokens SET status = 'revoked', revoked_at = ?, revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(at, reason, tokenId);
    if (info.changes === 0) return { revoked: false };
    getDb().prepare(`
      INSERT INTO revocations (token_id, reason, automatic, detail, at) VALUES (?, ?, ?, ?, ?)
    `).run(tokenId, reason, automatic ? 1 : 0, detail, at);
    return { revoked: true, at };
  });
}

/** Tangguhkan sementara (bisa diaktifkan kembali). */
export function suspendToken(tokenId, reason) {
  const info = getDb().prepare(`
    UPDATE tokens SET status = 'suspended', notes = ?
    WHERE id = ? AND status = 'active'
  `).run(reason, tokenId);
  return { suspended: info.changes > 0 };
}

/** Aktifkan kembali token yang ditangguhkan. */
export function resumeToken(tokenId) {
  const info = getDb().prepare(`
    UPDATE tokens SET status = 'active' WHERE id = ? AND status = 'suspended'
  `).run(tokenId);
  return { resumed: info.changes > 0 };
}

/** Daftar token, terbaru lebih dulu. Plaintext TIDAK pernah dikembalikan. */
export function listTokens({ projectSlug = null, status = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (projectSlug) { where.push('project_slug = ?'); params.push(projectSlug); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit);
  return getDb().prepare(`
    SELECT id, label, project_slug, issued_to, issued_by, issued_at, expires_at,
           revoked_at, revoked_reason, max_ips, status, notes
    FROM tokens ${clause}
    ORDER BY issued_at DESC LIMIT ?
  `).all(...params);
}

/** Ringkasan satu token untuk tampilan admin. */
export function getToken(tokenId) {
  return getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId) ?? null;
}
