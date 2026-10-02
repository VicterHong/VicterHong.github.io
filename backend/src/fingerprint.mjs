/**
 * Device fingerprint — deteksi sharing tanpa library eksternal.
 *
 * Fingerprint dibuat dari header HTTP yang tersedia di server:
 *   - User-Agent (browser, OS, versi)
 *   - Accept-Language
 *   - Accept-Encoding
 *   - DNT (Do Not Track)
 *   - Cloudflare headers: CF-Device-Type, CF-Visitor (scheme)
 *
 * Tidak bisa seakurat fingerprint client-side (canvas, WebGL, fonts),
 * tapi cukup untuk deteksi sharing kasar: orang yang benar-benar berbeda
 * biasanya punya kombinasi UA + language + encoding yang berbeda.
 *
 * Hash fingerprint disimpan per session. Kalau session baru punya
 * fingerprint yang sangat berbeda dari session-session sebelumnya
 * dalam waktu singkat, flag sebagai suspicious.
 */

import { createHash } from 'node:crypto';
import { getDb, now } from './db.mjs';

/** Buat fingerprint dari header request. */
export function makeFingerprint(req) {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 500);
  const lang = String(req.headers['accept-language'] ?? '').slice(0, 100);
  const enc = String(req.headers['accept-encoding'] ?? '').slice(0, 100);
  const dnt = String(req.headers['dnt'] ?? '');
  const cfDevice = String(req.headers['cf-device-type'] ?? '');

  const raw = `${ua}|${lang}|${enc}|${dnt}|${cfDevice}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

/** Simpan fingerprint untuk satu session. */
export function recordFingerprint({ sessionId, tokenId, fingerprint, ip, country }) {
  getDb().prepare(`
    INSERT INTO device_fingerprints (session_id, token_id, fingerprint, ip, country, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, tokenId, fingerprint, ip, country, now());
}

/**
 * Hitung fingerprint unik untuk token dalam jendela waktu.
 * Mengembalikan { uniqueFpCount, totalSessions, suspicious }.
 */
export function analyzeFingerprints(tokenId, windowMs) {
  const since = now() - windowMs;

  const rows = getDb().prepare(`
    SELECT DISTINCT fingerprint FROM device_fingerprints
    WHERE token_id = ? AND created_at >= ?
  `).all(tokenId, since);

  const total = getDb().prepare(`
    SELECT COUNT(*) as n FROM device_fingerprints
    WHERE token_id = ? AND created_at >= ?
  `).get(tokenId, since).n;

  return {
    uniqueFpCount: rows.length,
    totalSessions: total,
    suspicious: rows.length >= 3 && total >= 5, // 3+ fingerprint berbeda, 5+ sesi
  };
}

/** Cleanup fingerprint lama. */
export function cleanupFingerprints(olderThanMs) {
  const cutoff = now() - olderThanMs;
  const info = getDb().prepare(
    'DELETE FROM device_fingerprints WHERE created_at < ?'
  ).run(cutoff);
  return info.changes;
}
