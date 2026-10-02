/**
 * SLA tracking — uptime, latency, dan error rate layanan token.
 *
 * Pemantauan dilakukan DARI DALAM proses: setiap request publik mencatat
 * heartbeat, dan laporan SLA dihitung dari tabel `sla_heartbeats`.
 *
 * Kenapa bukan uptime monitor eksternal? Karena layanan ini self-hosted dan
 * tujuannya memberi angka jujur kepada klien enterprise — bukan sertifikasi
 * uptime pihak ketiga. Angka dihitung dari data nyata, bukan klaim.
 */

import { getDb, now } from './db.mjs';

/** Catat satu heartbeat request. Dipanggil dari server untuk setiap respons. */
export function recordHeartbeat({ ok, latencyMs, detail = '' }) {
  getDb().prepare(`
    INSERT INTO sla_heartbeats (checked_at, ok, latency_ms, detail)
    VALUES (?, ?, ?, ?)
  `).run(now(), ok ? 1 : 0, Math.max(0, Math.round(latencyMs)), String(detail).slice(0, 200));
}

/**
 * Hitung laporan SLA untuk jendela waktu.
 * @returns {{
 *   window_hours: number,
 *   total_requests: number,
 *   uptime_percent: number,
 *   avg_latency_ms: number,
 *   p95_latency_ms: number,
 *   error_count: number,
 *   error_rate_percent: number,
 *   meets_sla: boolean,
 *   sla_target_percent: number,
 * }}
 */
export function slaReport({ windowMs = 24 * 3_600_000, targetUptime = 99.0 } = {}) {
  const since = now() - windowMs;
  const db = getDb();

  const total = db.prepare(
    'SELECT COUNT(*) as n FROM sla_heartbeats WHERE checked_at >= ?'
  ).get(since).n;

  if (total === 0) {
    return {
      window_hours: Math.round(windowMs / 3_600_000),
      total_requests: 0,
      uptime_percent: 100,
      avg_latency_ms: 0,
      p95_latency_ms: 0,
      error_count: 0,
      error_rate_percent: 0,
      meets_sla: true,
      sla_target_percent: targetUptime,
    };
  }

  const errors = db.prepare(
    'SELECT COUNT(*) as n FROM sla_heartbeats WHERE checked_at >= ? AND ok = 0'
  ).get(since).n;

  const avg = db.prepare(
    'SELECT AVG(latency_ms) as v FROM sla_heartbeats WHERE checked_at >= ? AND ok = 1'
  ).get(since).v ?? 0;

  // P95: ambil nilai pada posisi 95% dari data terurut.
  const p95Row = db.prepare(`
    SELECT latency_ms FROM sla_heartbeats
    WHERE checked_at >= ? AND ok = 1
    ORDER BY latency_ms ASC
    LIMIT 1 OFFSET (
      SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM sla_heartbeats
      WHERE checked_at >= ? AND ok = 1
    )
  `).get(since, since);

  const uptime = ((total - errors) / total) * 100;
  const errorRate = (errors / total) * 100;

  return {
    window_hours: Math.round(windowMs / 3_600_000),
    total_requests: total,
    uptime_percent: Number(uptime.toFixed(3)),
    avg_latency_ms: Math.round(avg),
    p95_latency_ms: p95Row?.latency_ms ?? 0,
    error_count: errors,
    error_rate_percent: Number(errorRate.toFixed(3)),
    meets_sla: uptime >= targetUptime,
    sla_target_percent: targetUptime,
  };
}

/** Hapus heartbeat lama (di luar jendela retensi). */
export function cleanupHeartbeats(olderThanMs) {
  const cutoff = now() - olderThanMs;
  const info = getDb().prepare('DELETE FROM sla_heartbeats WHERE checked_at < ?').run(cutoff);
  return info.changes;
}

/**
 * Ringkasan SLA untuk laporan enterprise (7 hari + 30 hari).
 */
export function slaSummary({ targetUptime = 99.0 } = {}) {
  return {
    day: slaReport({ windowMs: 24 * 3_600_000, targetUptime }),
    week: slaReport({ windowMs: 7 * 24 * 3_600_000, targetUptime }),
    month: slaReport({ windowMs: 30 * 24 * 3_600_000, targetUptime }),
  };
}
