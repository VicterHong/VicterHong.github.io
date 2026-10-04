/**
 * Performance — pengukuran & anggaran (budget) performa.
 *
 * Meniru "Performance" Framer: situs punya ANGGARAN yang tidak boleh dilampaui,
 * dan setiap deploy diperiksa terhadap anggaran itu. Bukan sekadar "kelihatan
 * cepat" — ada angka yang bisa gagal.
 *
 * Dua bagian:
 *   1. Budget statis  — ukuran berkas, jumlah request, kompresi.
 *   2. Field metrics  — Core Web Vitals dari pengunjung nyata (via /api/vitals).
 */

import { statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { getDb } from './db.mjs';

/**
 * Anggaran performa. Kalau terlampaui → deploy sebaiknya ditinjau.
 * Nilai mengacu pada target "Good" Core Web Vitals + ukuran wajar situs statis.
 */
export const BUDGETS = {
  totalBytes: 900 * 1024,        // 900 KB total aset kritis (html+css+js, tanpa video)
  maxRequests: 40,               // jumlah berkas kritis
  maxJsBytes: 250 * 1024,        // JS adalah yang paling mahal
  maxCssBytes: 120 * 1024,
  maxHtmlBytes: 60 * 1024,
  // Target Core Web Vitals (persentil 75, "Good" menurut Google)
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  ttfbMs: 800,
};

const EXCLUDE = new Set(['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.webp']);

/**
 * Audit ukuran aset statis terhadap anggaran.
 * Video/gambar dikecualikan — mereka di-lazy-load dan tidak memblokir render.
 */
export function auditAssets(rootDir) {
  const files = [];
  let totalBytes = 0, jsBytes = 0, cssBytes = 0, htmlBytes = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }

      const ext = extname(entry.name).toLowerCase();
      if (EXCLUDE.has(ext)) continue;

      let size = 0;
      try { size = statSync(full).size; } catch { continue; }

      const rel = full.slice(rootDir.length + 1);
      files.push({ path: rel, bytes: size, ext });
      totalBytes += size;
      if (ext === '.js' || ext === '.mjs') jsBytes += size;
      else if (ext === '.css') cssBytes += size;
      else if (ext === '.html') htmlBytes += size;
    }
  }

  walk(rootDir);

  const violations = [];
  if (totalBytes > BUDGETS.totalBytes) {
    violations.push({ rule: 'totalBytes', actual: totalBytes, budget: BUDGETS.totalBytes });
  }
  if (jsBytes > BUDGETS.maxJsBytes) {
    violations.push({ rule: 'maxJsBytes', actual: jsBytes, budget: BUDGETS.maxJsBytes });
  }
  if (cssBytes > BUDGETS.maxCssBytes) {
    violations.push({ rule: 'maxCssBytes', actual: cssBytes, budget: BUDGETS.maxCssBytes });
  }
  if (htmlBytes > BUDGETS.maxHtmlBytes) {
    violations.push({ rule: 'maxHtmlBytes', actual: htmlBytes, budget: BUDGETS.maxHtmlBytes });
  }

  // Berkas terbesar — untuk tahu apa yang harus dioptimalkan lebih dulu.
  const heaviest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10);

  return {
    ok: violations.length === 0,
    counts: { files: files.length },
    bytes: { total: totalBytes, js: jsBytes, css: cssBytes, html: htmlBytes },
    budgets: BUDGETS,
    violations,
    heaviest,
  };
}

// ── FIELD METRICS (Core Web Vitals dari pengunjung nyata) ────────────────────

const METRIC_NAMES = new Set(['lcp', 'inp', 'cls', 'ttfb', 'fcp']);

/** Catat satu metrik dari browser. */
export function recordVital({ name, value, rating, path, country, userAgent, connection }) {
  const metric = String(name ?? '').toLowerCase();
  if (!METRIC_NAMES.has(metric)) return false;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return false;

  getDb().prepare(
    `INSERT INTO web_vitals (name, value, rating, path, country, user_agent, connection, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    metric,
    num,
    String(rating ?? '').slice(0, 20),
    String(path ?? '/').slice(0, 300),
    String(country ?? '').slice(0, 8),
    String(userAgent ?? '').slice(0, 300),
    String(connection ?? '').slice(0, 40),
    Date.now(),
  );
  return true;
}

/**
 * Ringkasan metrik: p75 (persentil yang dipakai Google), p50, jumlah sampel,
 * dan apakah lolos anggaran. Persentil dihitung di SQL supaya tidak memuat
 * seluruh baris ke memori.
 */
export function vitalsSummary({ days = 7 } = {}) {
  const since = Date.now() - Math.min(Number(days) || 7, 90) * 86400000;
  const db = getDb();
  const out = {};

  for (const name of METRIC_NAMES) {
    const row = db.prepare(
      `SELECT
         COUNT(*) AS n,
         MIN(value) AS min,
         MAX(value) AS max,
         AVG(value) AS avg
       FROM web_vitals WHERE name = ? AND created_at >= ?`
    ).get(name, since);

    if (!row || !row.n) { out[name] = { samples: 0 }; continue; }

    const p50 = percentile(db, name, since, 0.50);
    const p75 = percentile(db, name, since, 0.75);
    const p95 = percentile(db, name, since, 0.95);

    const budget = BUDGETS[`${name}Ms`] ?? (name === 'cls' ? BUDGETS.cls : null);
    out[name] = {
      samples: row.n,
      min: round(row.min), max: round(row.max), avg: round(row.avg),
      p50, p75, p95,
      budget: budget ?? null,
      pass: budget == null ? null : p75 <= budget,
    };
  }

  return { window_days: days, metrics: out };
}

/** Ambil nilai pada persentil tertentu — pakai LIMIT/OFFSET, bukan muat semua. */
function percentile(db, name, since, p) {
  const { n } = db.prepare(
    'SELECT COUNT(*) AS n FROM web_vitals WHERE name = ? AND created_at >= ?'
  ).get(name, since);
  if (!n) return null;
  const offset = Math.min(Math.floor(n * p), n - 1);
  const row = db.prepare(
    'SELECT value FROM web_vitals WHERE name = ? AND created_at >= ? ORDER BY value ASC LIMIT 1 OFFSET ?'
  ).get(name, since, offset);
  return row ? round(row.value) : null;
}

function round(v) {
  if (v == null) return null;
  return Math.round(Number(v) * 1000) / 1000;
}
