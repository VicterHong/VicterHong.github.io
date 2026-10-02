/**
 * Analytics funnel — tracking setiap step konversi.
 *
 * Event types:
 *   page_view      — user buka halaman proyek
 *   modal_open     — user lihat gate/token modal
 *   token_attempt  — user submit token
 *   token_success  — token valid, konten terbuka
 *   token_fail     — token invalid/revoked/expired
 *   contact_sales  — user klik "Minta akses"
 *   lead_submit    — form lead terkirim
 *   session_create — session cookie dibuat
 *   content_view   — konten terkunci dibuka
 *
 * Semua data di database, tidak ada third-party tracker.
 */

import { getDb, now } from './db.mjs';

/** Catat satu analytics event. */
export function recordAnalytics({
  eventType, projectSlug = '', tokenId = null, sessionId = null,
  ip = '', country = '', userAgent = '', referrer = '', metadata = {},
}) {
  getDb().prepare(`
    INSERT INTO analytics_events
      (event_type, project_slug, token_id, session_id, ip, country, user_agent, referrer, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType, projectSlug, tokenId, sessionId,
    ip, country, userAgent, referrer,
    JSON.stringify(metadata), now()
  );
}

/** Funnel counts untuk satu proyek dalam jendela waktu. */
export function getFunnel({ projectSlug = null, windowMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const since = now() - windowMs;
  const params = [since];
  const projectFilter = projectSlug ? 'AND project_slug = ?' : '';
  if (projectSlug) params.push(projectSlug);

  const db = getDb();

  const funnelSteps = [
    'page_view',
    'modal_open',
    'token_attempt',
    'token_success',
    'token_fail',
    'contact_sales',
    'lead_submit',
    'content_view',
  ];

  const result = {};
  for (const step of funnelSteps) {
    const row = db.prepare(`
      SELECT COUNT(*) as n FROM analytics_events
      WHERE event_type = ? AND created_at >= ? ${projectFilter}
    `).get(step, ...params);
    result[step] = row.n;
  }

  // Conversion rates
  result.conversion_rate = {
    view_to_attempt: result.page_view > 0 ? (result.token_attempt / result.page_view * 100).toFixed(1) : 0,
    attempt_to_success: result.token_attempt > 0 ? (result.token_success / result.token_attempt * 100).toFixed(1) : 0,
    view_to_lead: result.page_view > 0 ? (result.lead_submit / result.page_view * 100).toFixed(1) : 0,
    view_to_content: result.page_view > 0 ? (result.content_view / result.page_view * 100).toFixed(1) : 0,
  };

  return result;
}

/** Event terbaru, terbaru lebih dulu. */
export function recentAnalytics({ limit = 100, eventType = null, projectSlug = null } = {}) {
  const where = ['created_at >= 0'];
  const params = [];

  if (eventType) { where.push('event_type = ?'); params.push(eventType); }
  if (projectSlug) { where.push('project_slug = ?'); params.push(projectSlug); }

  const clause = 'WHERE ' + where.join(' AND ');
  params.push(limit);

  return getDb().prepare(`
    SELECT id, event_type, project_slug, token_id, session_id, ip, country, metadata, created_at
    FROM analytics_events ${clause}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params);
}

/** Unique visitors (by IP) dalam jendela waktu. */
export function uniqueVisitors({ projectSlug = null, windowMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const since = now() - windowMs;
  const params = [since];
  const projectFilter = projectSlug ? 'AND project_slug = ?' : '';
  if (projectSlug) params.push(projectSlug);

  const row = getDb().prepare(`
    SELECT COUNT(DISTINCT ip) as n FROM analytics_events
    WHERE created_at >= ? ${projectFilter}
  `).get(...params);

  return row.n;
}

/** Cleanup analytics lama. */
export function cleanupAnalytics(olderThanMs) {
  const cutoff = now() - olderThanMs;
  const info = getDb().prepare(
    'DELETE FROM analytics_events WHERE created_at < ?'
  ).run(cutoff);
  return info.changes;
}
