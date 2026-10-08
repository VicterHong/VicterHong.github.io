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

import { statSync, readdirSync, readFileSync, existsSync } from 'node:fs';
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
  // HTML: 90 KB — halaman panduan (/docs) berisi banyak teks, itu tujuannya.
  // Yang dijaga ketat adalah total & JS (dokumentasi tidak menambah JS).
  maxHtmlBytes: 90 * 1024,
  // Target Core Web Vitals (persentil 75, "Good" menurut Google)
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  ttfbMs: 800,
};

const EXCLUDE = new Set(['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.webp']);

/**
 * Direktori yang BUKAN bagian situs — kode server, tooling, dokumentasi.
 * Tanpa pengecualian ini, audit menghitung `backend/src/routes.mjs` (54 KB)
 * sebagai "aset situs" dan laporan jadi menyesatkan.
 */
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.wrangler', 'backend', 'scripts', 'docs', 'design',
  'assets-original', 'domains', 'workers',
]);

/**
 * Audit ukuran aset statis terhadap anggaran.
 * Video/gambar dikecualikan — mereka di-lazy-load dan tidak memblokir render.
 *
 * PENTING — apa yang diukur:
 *   Anggaran per-halaman, bukan jumlah seluruh repo. Yang membebani
 *   pengunjung adalah berkas yang BENAR-BENAR dimuat satu halaman, bukan
 *   total semua berkas yang ada di repo. Menjumlahkan semuanya membuat
 *   laporan menyesatkan: repo punya 22 berkas CSS, tapi tidak ada satu
 *   halaman pun yang memuat lebih dari 20 di antaranya.
 *
 *   Karena itu CSS/JS dihitung per halaman HTML: untuk setiap halaman,
 *   jumlahkan hanya berkas yang dirujuknya. Anggaran dibandingkan
 *   terhadap halaman TERBERAT — itu yang menentukan pengalaman terburuk.
 */
export function auditAssets(rootDir) {
  const files = [];
  let totalBytes = 0, jsBytes = 0, cssBytes = 0, htmlBytes = 0;

  function walk(dir, depth = 0) {
    if (depth > 8) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }

      const ext = extname(entry.name).toLowerCase();
      if (EXCLUDE.has(ext)) continue;

      // ── Lewati CSS yang punya kembaran .min.css ──────────────────────────
      //
      // build-css.mjs menulis auth.min.css DAN menyalin auth.css. HTML hanya
      // memuat yang .min. Menghitung keduanya berarti mengukur isi disk,
      // bukan yang diunduh pengunjung — dan itu membuat anggaran performa
      // berbohong (terukur: 1166 KB dihitung vs 816 KB nyata).
      //
      // Kalau .min.css TIDAK ada, .css aslinya tetap dihitung — jadi tidak
      // ada berkas yang lolos dari audit.
      if (ext === '.css' && !entry.name.endsWith('.min.css')) {
        const kembaran = join(dir, entry.name.replace(/\.css$/, '.min.css'));
        if (existsSync(kembaran)) continue;
      }

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

  // ── Ukuran nyata per halaman ────────────────────────────────────────────────
  //
  // ── KENAPA DIDAFTAR OTOMATIS ────────────────────────────────────────────────
  // Daftar hardcoded berarti halaman baru TIDAK PERNAH diperiksa sampai ada
  // yang ingat menambahkannya. Itu sudah terjadi: pricing.html dibuat, dan
  // audit tetap melaporkan angka lama — seolah halaman itu tidak ada.
  //
  // Dengan deteksi otomatis, setiap halaman baru langsung masuk audit.
  //
  // Yang dikecualikan: 404.html (halaman error, tidak pernah jadi tujuan),
  // dan halaman di dalam folder berkode (/s/<kode>/) karena itu halaman
  // akses sementara, bukan bagian tetap situs.
  const PAGES = files
    .filter((f) => f.ext === '.html')
    .map((f) => f.path)
    .filter((p) => !p.includes('/') && p !== '404.html')
    .sort();

  const sizeByPath = new Map(files.map((f) => [f.path, f.bytes]));
  const perPage = [];

  for (const page of PAGES) {
    let html = '';
    try { html = readFileSync(join(rootDir, page), 'utf8'); } catch { continue; }

    // Kumpulkan rujukan berkas lokal: <link href> dan <script src>.
    // Yang absolut (CDN) dilewati — tidak dihitung sebagai aset situs.
    const refs = new Set();
    for (const m of html.matchAll(/(?:href|src)="([^"]+\.(?:css|js|mjs))"/g)) {
      const url = m[1];
      if (/^https?:/.test(url)) continue;
      // Normalisasi: buang awalan "/" dan "./" supaya cocok dengan path repo.
      refs.add(url.replace(/^\.?\//, ''));
    }

    let pageCss = 0, pageJs = 0, pageHtml = sizeByPath.get(page) ?? 0;
    for (const ref of refs) {
      const size = sizeByPath.get(ref) ?? 0;
      if (ref.endsWith('.css')) pageCss += size;
      else pageJs += size;
    }

    perPage.push({
      page,
      html: pageHtml,
      css: pageCss,
      js: pageJs,
      total: pageHtml + pageCss + pageJs,
      refs: refs.size,
    });
  }

  // Halaman terberat menentukan — itu pengalaman terburuk pengunjung.
  const heaviestPage = perPage.reduce(
    (max, p) => (p.total > (max?.total ?? 0) ? p : max),
    null,
  );

  const violations = [];
  if (totalBytes > BUDGETS.totalBytes) {
    violations.push({ rule: 'totalBytes', actual: totalBytes, budget: BUDGETS.totalBytes });
  }
  if (heaviestPage) {
    if (heaviestPage.css > BUDGETS.maxCssBytes) {
      violations.push({
        rule: 'maxCssBytes',
        actual: heaviestPage.css,
        budget: BUDGETS.maxCssBytes,
        page: heaviestPage.page,
      });
    }
    if (heaviestPage.js > BUDGETS.maxJsBytes) {
      violations.push({
        rule: 'maxJsBytes',
        actual: heaviestPage.js,
        budget: BUDGETS.maxJsBytes,
        page: heaviestPage.page,
      });
    }
  }
  // ── KENAPA HALAMAN TERBERAT, BUKAN TOTAL ───────────────────────────────────
  // Anggaran lain (CSS, JS) diukur per halaman — karena pengunjung hanya
  // mengunduh SATU halaman, bukan seluruh situs.
  //
  // HTML dulu diukur sebagai total semua halaman, dan itu tidak sebanding:
  // menambah halaman baru selalu "melanggar" anggaran, walaupun tidak ada
  // pengunjung yang mengunduh halaman itu bersamaan.
  //
  // Sekarang konsisten: yang dijaga adalah pengalaman terburuk SATU
  // kunjungan — halaman terberat.
  const heaviestHtml = perPage.reduce((max, p) => Math.max(max, p.html), 0);

  if (heaviestHtml > BUDGETS.maxHtmlBytes) {
    violations.push({
      rule: 'maxHtmlBytes',
      actual: heaviestHtml,
      budget: BUDGETS.maxHtmlBytes,
      page: heaviestPage?.page,
    });
  }

  // Berkas terbesar — untuk tahu apa yang harus dioptimalkan lebih dulu.
  const heaviest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10);

  return {
    ok: violations.length === 0,
    counts: { files: files.length },
    // bytes.* = total repo (berguna untuk memantau pertumbuhan repo),
    // perPage.* = yang benar-benar dimuat pengunjung (dipakai anggaran).
    bytes: { total: totalBytes, js: jsBytes, css: cssBytes, html: htmlBytes },
    // Daftar berkas yang IKUT dihitung — dipakai pemindaian rahasia di
    // preflight. Dikembalikan supaya pemanggil tidak perlu menelusuri
    // direktori sendiri dengan aturan yang bisa berbeda.
    files,
    perPage,
    heaviestPage,
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
