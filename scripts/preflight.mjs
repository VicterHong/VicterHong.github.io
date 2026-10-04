/**
 * Preflight — periksa situs SEBELUM deploy.
 *
 * Meniru alur "Publish" Framer: jangan unggah apa pun sebelum semuanya lolos.
 * Kalau ada pemeriksaan yang gagal, skrip keluar dengan kode 1 — deploy dibatalkan.
 *
 * Jalankan: node scripts/preflight.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Anggaran performa (selaras dengan backend/src/performance.mjs) ───────────
const BUDGETS = {
  totalBytes: 900 * 1024,
  maxJsBytes: 250 * 1024,
  maxCssBytes: 120 * 1024,
  // HTML: naik dari 60 → 90 KB saat halaman panduan (/docs) ditambahkan.
  // Halaman dokumentasi memang berisi banyak teks — itu tujuannya.
  // Anggaran lama terlalu ketat untuk situs yang punya dokumentasi lengkap;
  // yang penting total & JS tetap terkendali (dokumentasi tidak menambah JS).
  maxHtmlBytes: 90 * 1024,
};

const EXCLUDE_EXT = new Set(['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.webp', '.woff', '.woff2']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'backend', 'scripts', 'docs', 'design']);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  const icon = ok ? '✓' : '✗';
  console.log(`${icon} ${name}: ${detail}`);
}

// ── 1. Berkas wajib ──────────────────────────────────────────────────────────
console.log('\n── Berkas wajib ──');
for (const f of ['home.html', 'index.html', '404.html', 'docs.html', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
  const exists = existsSync(resolve(ROOT, f));
  check(`file:${f}`, exists, exists ? 'ada' : 'HILANG');
}

// ── 2. Anggaran performa ─────────────────────────────────────────────────────
console.log('\n── Anggaran performa ──');
const bytes = { total: 0, js: 0, css: 0, html: 0 };
const files = [];

function walk(dir, depth = 0) {
  if (depth > 6) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, depth + 1); continue; }
    const ext = extname(entry.name).toLowerCase();
    if (EXCLUDE_EXT.has(ext)) continue;
    let size = 0;
    try { size = statSync(full).size; } catch { continue; }
    files.push({ path: full.slice(ROOT.length + 1), bytes: size });
    bytes.total += size;
    if (ext === '.js' || ext === '.mjs') bytes.js += size;
    else if (ext === '.css') bytes.css += size;
    else if (ext === '.html') bytes.html += size;
  }
}
walk(ROOT);

const kb = (n) => `${Math.round(n / 1024)} KB`;
check('total-bytes', bytes.total <= BUDGETS.totalBytes,
  `${kb(bytes.total)} (anggaran ${kb(BUDGETS.totalBytes)})`);
check('js-bytes', bytes.js <= BUDGETS.maxJsBytes,
  `${kb(bytes.js)} (anggaran ${kb(BUDGETS.maxJsBytes)})`);
check('css-bytes', bytes.css <= BUDGETS.maxCssBytes,
  `${kb(bytes.css)} (anggaran ${kb(BUDGETS.maxCssBytes)})`);
check('html-bytes', bytes.html <= BUDGETS.maxHtmlBytes,
  `${kb(bytes.html)} (anggaran ${kb(BUDGETS.maxHtmlBytes)})`);

// ── 3. Tidak ada rahasia di berkas statis ────────────────────────────────────
// Dua lapis supaya tidak ada false positive:
//   1. Nilai rahasia NYATA (dibaca dari env service) dicari persis.
//   2. Pola yang pasti rahasia — TANPA pola Turnstile, karena site key
//      memang publik dan wajib ada di HTML (widget tidak render tanpa itu).
console.log('\n── Pemindaian rahasia ──');

// Lapis 1: baca nilai rahasia dari berkas env service (kalau ada).
const literalSecrets = [];
try {
  const envPath = process.env.TOKEN_SERVICE_ENV || `${process.env.HOME}/.portfolio-token/service.env`;
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^(TURNSTILE_SECRET|ADMIN_KEY|TOKEN_SECRET|OPENAI_API_KEY)=(.+)$/);
    if (m && m[2].trim().length >= 16) literalSecrets.push(m[2].trim().replace(/^["']|["']$/g, ''));
  }
} catch { /* berkas env tidak ada — lapis 1 dilewati */ }

// Lapis 2: pola tidak ambigu.
const SECRET_PATTERNS = [
  { re: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI-style key' },
  { re: /ghp_[A-Za-z0-9]{20,}/, name: 'GitHub PAT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: 'private key' },
];
const leaks = [];
for (const f of files) {
  if (!/\.(html|js|mjs|css|json|txt|xml)$/i.test(f.path)) continue;
  let text = '';
  try { text = readFileSync(resolve(ROOT, f.path), 'utf8'); } catch { continue; }

  let found = false;
  for (const secret of literalSecrets) {
    if (text.includes(secret)) {
      leaks.push(`${f.path} (nilai rahasia nyata bocor)`);
      found = true;
      break;
    }
  }
  if (found) continue;

  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) { leaks.push(`${f.path} (${p.name})`); break; }
  }
}
check('no-secret-leak', leaks.length === 0, leaks.length ? leaks.join(', ') : 'bersih');

// ── 4. JSON-LD ada di halaman utama ──────────────────────────────────────────
console.log('\n── SEO / AEO ──');
try {
  const home = readFileSync(resolve(ROOT, 'home.html'), 'utf8');
  check('json-ld', home.includes('application/ld+json'), 'structured data terpasang');
  check('canonical', home.includes('rel="canonical"'), 'canonical terpasang');
  check('og-tags', home.includes('og:title') && home.includes('og:image'), 'Open Graph lengkap');
} catch (err) {
  check('home.html', false, err.message);
}

// ── Ringkasan ────────────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.ok);
console.log(`\n${'─'.repeat(50)}`);
if (failed.length === 0) {
  console.log(`✅ Preflight LOLOS — ${checks.length} pemeriksaan, semua bersih.`);
  console.log('   Siap deploy.\n');
  process.exit(0);
} else {
  console.log(`❌ Preflight GAGAL — ${failed.length} dari ${checks.length} pemeriksaan gagal:`);
  for (const f of failed) console.log(`   • ${f.name}: ${f.detail}`);
  console.log('\n   Deploy DIBATALKAN. Perbaiki dulu.\n');
  process.exit(1);
}
