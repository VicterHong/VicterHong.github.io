/**
 * Penerbitan dan verifikasi token.
 *
 * Token disimpan HANYA sebagai hash (SHA-256 + salt dari SERVICE_SECRET). Plaintext
 * ditampilkan sekali saat terbit. Kalau database bocor, token tidak langsung bisa dipakai.
 *
 * Format baru: VP-XXXX-XXXX-XXXX-XXXX (128-bit entropy, 4 segmen × 4 karakter base32)
 * Tier: standard | enterprise
 * Scopes: array project_slug yang bisa diakses (JSON di database)
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
 * @returns {{id: string, token: string, project_slug: string, tier: string, scopes: string[], expires_at: number|null}}
 *   `token` adalah plaintext — satu-satunya kesempatan melihatnya.
 */
export function issueToken({
  secret, projectSlug, tier = 'standard', scopes = null,
  label = '', issuedTo = '', company = '', issuedBy = 'admin',
  expiresInDays = null, maxIps = 3, maxDevices = 3, notes = '',
  prefix = 'VP-', segments = 4, segmentLength = 4,
}) {
  const parts = [];
  for (let i = 0; i < segments; i += 1) parts.push(randomToken(segmentLength));
  const plaintext = prefix + parts.join('-');

  const id = tokenId();
  const issuedAt = now();
  const expiresAt = expiresInDays ? issuedAt + expiresInDays * 86_400_000 : null;

  // scopes: kalau null, default ke [projectSlug]
  const scopeList = scopes && Array.isArray(scopes) && scopes.length > 0 ? scopes : [projectSlug];

  transaction(() => {
    getDb().prepare(`
      INSERT INTO tokens (id, token_hash, label, project_slug, tier, scopes,
                          issued_to, company, issued_by, issued_at, expires_at,
                          max_ips, max_devices, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, hashToken(plaintext, secret), label, projectSlug, tier,
           JSON.stringify(scopeList), issuedTo, company, issuedBy,
           issuedAt, expiresAt, maxIps, maxDevices, notes);
  });

  return {
    id, token: plaintext, project_slug: projectSlug, tier,
    scopes: scopeList, expires_at: expiresAt, max_ips: maxIps, max_devices: maxDevices,
  };
}

/** Cari baris token berdasarkan plaintext. */
export function findTokenByPlaintext(plaintext, secret) {
  const hash = hashToken(plaintext, secret);
  const row = getDb().prepare('SELECT * FROM tokens WHERE token_hash = ?').get(hash) ?? null;
  if (row && row.scopes) {
    try { row.scopes = JSON.parse(row.scopes); } catch { row.scopes = [row.project_slug]; }
  }
  return row;
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
    // Hapus semua sesi aktif token ini
    getDb().prepare('DELETE FROM sessions WHERE token_id = ?').run(tokenId);
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
export function listTokens({ projectSlug = null, status = null, tier = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (projectSlug) { where.push('project_slug = ?'); params.push(projectSlug); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (tier) { where.push('tier = ?'); params.push(tier); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit);
  const rows = getDb().prepare(`
    SELECT id, label, project_slug, tier, scopes, issued_to, company,
           issued_by, issued_at, expires_at, revoked_at, revoked_reason,
           max_ips, max_devices, status, notes
    FROM tokens ${clause}
    ORDER BY issued_at DESC LIMIT ?
  `).all(...params);
  // Parse scopes JSON
  for (const row of rows) {
    if (row.scopes) {
      try { row.scopes = JSON.parse(row.scopes); } catch { row.scopes = [row.project_slug]; }
    }
  }
  return rows;
}

/** Ringkasan satu token untuk tampilan admin. */
export function getToken(tokenId) {
  const row = getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId) ?? null;
  if (row && row.scopes) {
    try { row.scopes = JSON.parse(row.scopes); } catch { row.scopes = [row.project_slug]; }
  }
  return row;
}
