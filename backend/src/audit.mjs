/**
 * Pencatatan audit.
 *
 * Setiap percobaan akses dicatat — berhasil maupun gagal. Ini dasar dua hal:
 * deteksi penyalahgunaan (auto-revoke) dan jawaban saat pemilik ditanya
 * "siapa yang membuka proyek saya?".
 */

import { getDb, now } from './db.mjs';

/** Catat satu peristiwa akses. */
export function recordEvent({
  tokenId = null, projectSlug = '', action, outcome,
  ip = '', userAgent = '', country = '', detail = '',
}) {
  getDb().prepare(`
    INSERT INTO access_events (token_id, project_slug, action, outcome, ip, user_agent, country, detail, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tokenId, projectSlug, action, outcome, ip, userAgent, country, detail, now());
}

/** Peristiwa terbaru, terbaru lebih dulu. */
export function recentEvents({ limit = 100, tokenId = null, projectSlug = null } = {}) {
  const where = [];
  const params = [];
  if (tokenId) { where.push('token_id = ?'); params.push(tokenId); }
  if (projectSlug) { where.push('project_slug = ?'); params.push(projectSlug); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit);
  // ORDER BY at DESC, id DESC — urutan sekunder WAJIB.
  // Tanpa itu, dua event dengan timestamp sama (tercatat dalam milidetik
  // yang sama) bisa kembali dalam urutan acak, tergantung bagaimana SQLite
  // memilih baris. Di mesin cepat ini bikin urutan "terbaru dulu" tidak
  // deterministik — dan itu pernah menggagalkan test di CI.
  return getDb().prepare(`
    SELECT id, token_id, project_slug, action, outcome, ip, country, detail, at
    FROM access_events ${clause} ORDER BY at DESC, id DESC LIMIT ?
  `).all(...params);
}

/**
 * Alamat IP berbeda yang pernah memakai token ini dalam jendela waktu tertentu.
 * Dipakai deteksi sharing.
 */
export function distinctIpsForToken(tokenId, windowMs) {
  const since = now() - windowMs;
  const rows = getDb().prepare(`
    SELECT DISTINCT ip FROM access_events
    WHERE token_id = ? AND at >= ? AND ip <> ''
  `).all(tokenId, since);
  return rows.map((r) => r.ip);
}

/** Hitungan request token ini dalam jendela waktu — dasar pembatas laju. */
export function requestsInWindow(tokenId, windowMs) {
  const since = now() - windowMs;
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM access_events
    WHERE token_id = ? AND at >= ? AND action IN ('validate', 'content', 'session_create')
  `).get(tokenId, since);
  return Number(row?.n ?? 0);
}

/** Percobaan gagal beruntun sejak keberhasilan terakhir.
 *  ORDER BY at DESC, id DESC — urutan sekunder supaya deterministik saat
 *  beberapa event punya timestamp sama. Ini memengaruhi keputusan
 *  auto-revoke, jadi urutannya TIDAK BOLEH acak. */
export function consecutiveFailures(tokenId) {
  const rows = getDb().prepare(`
    SELECT outcome FROM access_events
    WHERE token_id = ? AND action IN ('validate', 'session_create')
    ORDER BY at DESC, id DESC LIMIT 40
  `).all(tokenId);
  let n = 0;
  for (const r of rows) {
    if (r.outcome === 'ok') break;
    n += 1;
  }
  return n;
}

/** Permintaan akses dari form publik. */
export function recordLead({ company = '', name = '', email, role = '', projectSlug = '', budgetRange = '', urgency = '', message = '', ip = '', userAgent = '', status = 'new' }) {
  const info = getDb().prepare(`
    INSERT INTO sales_leads (company, name, email, role, project_slug, budget_range, urgency, message, ip, user_agent, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(company, name, email, role, projectSlug, budgetRange, urgency, message, ip, userAgent, status, now());
  return { id: Number(info.lastInsertRowid) };
}

/** Daftar permintaan akses untuk dashboard admin. */
export function listLeads({ limit = 100, status = null } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status, limit] : [limit];
  return getDb().prepare(`
    SELECT id, company, name, email, role, project_slug, budget_range, urgency, message, status, created_at
    FROM sales_leads ${where} ORDER BY created_at DESC LIMIT ?
  `).all(...params);
}

/** Status lead yang sah. Menjaga nilai kolom tetap konsisten. */
export const LEAD_STATUSES = new Set(['new', 'contacted', 'review', 'spam']);

/**
 * Ubah status lead (mis. dari 'review' jadi 'contacted' setelah ditinjau).
 * @param {number} id id lead
 * @param {string} status status baru
 * @returns {{ok: boolean, changes?: number, error?: string}}
 */
export function updateLeadStatus(id, status) {
  if (!id) return { ok: false, error: 'id_wajib' };
  if (!LEAD_STATUSES.has(status)) {
    return { ok: false, error: `status_tidak_valid: ${status}` };
  }
  const info = getDb().prepare('UPDATE sales_leads SET status = ? WHERE id = ?').run(status, Number(id));
  return { ok: true, changes: Number(info.changes) };
}
