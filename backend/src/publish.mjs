/**
 * Publish — orkestrasi deploy dengan gerbang mutu.
 *
 * Meniru "Publish" Framer: deploy bukan sekadar unggah berkas. Ada urutan:
 *   preflight (anggaran performa + berkas discovery) → deploy → verifikasi
 *   (cek URL publik benar-benar hidup) → catat rilis.
 *
 * Kalau preflight gagal, deploy TIDAK dijalankan. Ini yang membedakan
 * "publish dengan percaya diri" dari "unggah lalu berdoa".
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { auditAssets } from './performance.mjs';

/**
 * Preflight: semua pemeriksaan SEBELUM deploy.
 * Mengembalikan { ok, checks[] } — setiap check punya status dan detail.
 */
export function preflight(rootDir, { budgets = true } = {}) {
  const checks = [];

  // 1. Berkas wajib ada.
  const required = ['home.html', 'index.html', '404.html', 'robots.txt', 'sitemap.xml'];
  for (const f of required) {
    const exists = existsSync(join(rootDir, f));
    checks.push({
      name: `file:${f}`,
      ok: exists,
      detail: exists ? 'ada' : 'HILANG — deploy akan menghasilkan 404',
    });
  }

  // 2. Anggaran performa.
  if (budgets) {
    try {
      const audit = auditAssets(rootDir);
      checks.push({
        name: 'performance-budget',
        ok: audit.ok,
        detail: audit.ok
          ? `total ${kb(audit.bytes.total)} (anggaran ${kb(audit.budgets.totalBytes)})`
          : audit.violations.map(v => `${v.rule}: ${kb(v.actual)} > ${kb(v.budget)}`).join('; '),
      });
    } catch (err) {
      checks.push({ name: 'performance-budget', ok: false, detail: `gagal audit: ${err.message}` });
    }
  }

  // 3. Tidak ada rahasia yang bocor ke berkas statis.
  const secretLeak = scanForSecrets(rootDir);
  checks.push({
    name: 'no-secret-leak',
    ok: secretLeak.length === 0,
    detail: secretLeak.length ? `menemukan pola rahasia di: ${secretLeak.join(', ')}` : 'bersih',
  });

  return { ok: checks.every(c => c.ok), checks };
}

/**
 * Pindai berkas statis untuk pola rahasia yang tidak boleh ikut ter-deploy.
 * Sengaja konservatif: hanya pola yang pasti rahasia (bukan kata umum).
 */
function scanForSecrets(rootDir, limit = 40) {
  const patterns = [
    /sk-[A-Za-z0-9]{20,}/,          // OpenAI-style
    /ghp_[A-Za-z0-9]{20,}/,          // GitHub PAT
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /0x4AAAAAA[A-Za-z0-9_-]{10,}/,   // Turnstile secret (site key aman)
  ];
  const hits = [];
  const skip = new Set(['node_modules', '.git', '.wrangler', 'backend', 'scripts', 'docs']);

  function walk(dir, depth = 0) {
    if (depth > 6 || hits.length >= limit) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= limit) return;
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (!/\.(html|js|mjs|css|json|txt|xml)$/i.test(entry.name)) continue;
      let text = '';
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      for (const p of patterns) {
        if (p.test(text)) { hits.push(full.slice(rootDir.length + 1)); break; }
      }
    }
  }

  try { walk(rootDir); } catch { /* abaikan */ }
  return hits;
}

/**
 * Jalankan deploy (wrangler pages) dan catat rilis.
 * `runner` bisa diganti untuk pengujian — default execFileSync.
 */
export function deploy(rootDir, { project = 'portfolio-victer', runner = defaultRunner } = {}) {
  const result = { started_at: Date.now(), ok: false, output: '' };
  try {
    const out = runner('npx', ['wrangler', 'pages', 'deploy', '.', `--project-name=${project}`], { cwd: rootDir });
    result.output = String(out).slice(-2000);
    result.ok = true;
  } catch (err) {
    result.output = String(err.stderr ?? err.message).slice(-2000);
  }
  result.finished_at = Date.now();
  return result;
}

function defaultRunner(cmd, args, opts) {
  return execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Verifikasi pasca-deploy: URL publik harus benar-benar menjawab.
 * Jangan pernah bilang "berhasil" tanpa bukti.
 */
export async function verify(url, { expectMarker = null, timeoutMs = 15000 } = {}) {
  const checks = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);

    checks.push({ name: 'http-status', ok: res.ok, detail: String(res.status) });

    const body = await res.text();
    checks.push({ name: 'content-length', ok: body.length > 200, detail: `${body.length} bytes` });

    if (expectMarker) {
      const found = body.includes(expectMarker);
      checks.push({ name: `marker:${expectMarker}`, ok: found, detail: found ? 'ditemukan' : 'TIDAK ditemukan' });
    }
  } catch (err) {
    checks.push({ name: 'fetch', ok: false, detail: err.message });
  }
  return { ok: checks.every(c => c.ok), checks };
}

// ── RELEASE LOG ──────────────────────────────────────────────────────────────

export function recordRelease({ version, commit, deployedBy = 'admin', checks, ok }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO releases (id, version, commit_hash, deployed_by, ok, checks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, String(version).slice(0, 60), String(commit ?? '').slice(0, 80), deployedBy, ok ? 1 : 0, JSON.stringify(checks ?? []), Date.now());
  return id;
}

export function listReleases(limit = 50) {
  return getDb().prepare('SELECT * FROM releases ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Number(limit) || 50, 200))
    .map(r => ({ ...r, checks: safeParse(r.checks, []) }));
}

export function rollbackTarget(currentVersion) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM releases WHERE version != ? AND ok = 1 ORDER BY created_at DESC LIMIT 1`
  ).get(currentVersion) ?? null;
}

function kb(n) {
  return `${Math.round(Number(n) / 1024)} KB`;
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
