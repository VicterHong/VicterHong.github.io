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
import { auditAssets, BUDGETS } from '../backend/src/performance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Direktori yang diaudit: dist/ kalau ada, selain itu root.
 *
 * ── KENAPA (minifikasi CSS) ─────────────────────────────────────────────────
 * Sumber di assets/css/*.css TIDAK terminifikasi — itu yang dibaca manusia.
 * Minifikasi terjadi saat build (scripts/build-css.mjs) dan hasilnya ke dist/.
 * Kalau preflight mengukur root, ia akan mengukur berkas SUMBER (120 KB) dan
 * menolak deploy — padahal yang benar-benar dikirim ke pengunjung adalah versi
 * terminifikasi di dist/ (54 KB).
 *
 * Jadi preflight harus mengukur apa yang benar-benar di-deploy. Kalau dist/
 * belum dibangun, jatuh ke root supaya preflight tetap berguna sendirian.
 */
const DIST = resolve(ROOT, 'dist');
const AUDIT = existsSync(DIST) ? DIST : ROOT;
if (AUDIT === DIST) console.log('(mengaudit dist/ — hasil build terminifikasi)');

// Anggaran performa diimpor dari backend/src/performance.mjs — SATU sumber.
// Sebelumnya didefinisikan ulang di sini, dan dua daftar anggaran yang
// berbeda pasti akan menyimpang seiring waktu.

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
  const exists = existsSync(resolve(AUDIT, f));
  check(`file:${f}`, exists, exists ? 'ada' : 'HILANG');
}

// ── 2. Anggaran performa ─────────────────────────────────────────────────────
console.log('\n── Anggaran performa ──');
// ── SATU SUMBER KEBENARAN ────────────────────────────────────────────────────
//
// Sebelumnya berkas ini punya walk() SENDIRI untuk bytes.total, dan
// memanggil auditAssets() untuk angka per-halaman. Dua implementasi
// berarti dua kebenaran — dan keduanya memang menyimpang: perbaikan
// "lewati .css yang punya kembaran .min.css" hanya masuk ke auditAssets(),
// sehingga bytes.total tetap membengkak 1166 KB padahal angka nyatanya 816 KB.
//
// Sekarang SEMUA angka datang dari auditAssets(). Satu aturan, satu hasil.
const { perPage, heaviestPage, bytes, files } = auditAssets(AUDIT);

const kb = (n) => `${Math.round(n / 1024)} KB`;
const heaviest = heaviestPage ?? { page: '—', css: 0, js: 0, html: 0 };

check('total-bytes', bytes.total <= BUDGETS.totalBytes,
  `${kb(bytes.total)} (anggaran ${kb(BUDGETS.totalBytes)})`);
check('js-bytes', heaviest.js <= BUDGETS.maxJsBytes,
  `${kb(heaviest.js)} di ${heaviest.page} (anggaran ${kb(BUDGETS.maxJsBytes)})`);
check('css-bytes', heaviest.css <= BUDGETS.maxCssBytes,
  `${kb(heaviest.css)} di ${heaviest.page} (anggaran ${kb(BUDGETS.maxCssBytes)})`);
// ── HTML: HALAMAN TERBERAT, BUKAN TOTAL ──────────────────────────────────────
//
// Anggaran lain diukur per halaman — karena pengunjung mengunduh SATU halaman,
// bukan seluruh situs. HTML dulu diukur sebagai total semua halaman, dan itu
// tidak sebanding: setiap halaman baru selalu "melanggar" anggaran, walaupun
// tidak ada pengunjung yang mengunduh semuanya bersamaan.
//
// Sekarang konsisten: yang dijaga adalah pengalaman terburuk SATU kunjungan.
check('html-bytes', heaviest.html <= BUDGETS.maxHtmlBytes,
  `${kb(heaviest.html)} di ${heaviest.page} (anggaran ${kb(BUDGETS.maxHtmlBytes)})`);

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
  try { text = readFileSync(resolve(AUDIT, f.path), 'utf8'); } catch { continue; }

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
  const home = readFileSync(resolve(AUDIT, 'home.html'), 'utf8');
  check('json-ld', home.includes('application/ld+json'), 'structured data terpasang');
  check('canonical', home.includes('rel="canonical"'), 'canonical terpasang');
  check('og-tags', home.includes('og:title') && home.includes('og:image'), 'Open Graph lengkap');
} catch (err) {
  check('home.html', false, err.message);
}

// ── 5. Angka di bagian Visi & Misi harus cocok dengan kenyataan ──────────────
//
// ── KENAPA PEMERIKSAAN INI ADA ───────────────────────────────────────────────
// Saat pertama menulis Visi & Misi, EMPAT angka yang saya tulis salah:
//
//   diklaim        nyata    kenapa berubah
//   ───────────    ──────   ───────────────────────────────────────────────
//   1.864 tes      1.956    angka backend ikut berubah tiap ada tes baru
//   29 berkas      30       PRD-nya sendiri menambah satu berkas
//   7.886 baris    8.115    idem
//   61 KB          47 KB    saya mengukur halaman lain, bukan halaman ini
//
// Yang penting bukan kesalahannya — angka memang berubah. Yang penting:
// halaman ini menjanjikan "setiap angka bisa diperiksa", jadi angka yang tidak
// bisa dijaga tidak boleh ada di sana.
//
// ── ATURAN YANG DIPAKAI ──────────────────────────────────────────────────────
// Hanya angka yang STABIL yang ditulis di halaman:
//
//   ✓ dari projects.js     — 3 sistem, 1.428 tes (berubah hanya kalau repo berubah)
//   ✓ sifat fisik          — ~25 MB memori, 2 GB RAM
//   ✓ ANGGARAN, bukan pemakaian — 940 KB (anggarannya tetap; pemakaiannya naik-turun)
//
//   ✗ jumlah berkas dokumentasi  — naik tiap kali ada catatan baru
//   ✗ jumlah baris dokumentasi   — idem
//   ✗ ukuran halaman saat ini    — berubah tiap kali CSS disentuh
//   ✗ jumlah tes backend         — naik tiap kali ada tes baru
//
// Angka yang tidak stabil diganti dengan pernyataan yang tetap benar
// ("ada berkas yang bisa Anda periksa") alih-alih angka yang akan basi.
//
// Pemeriksaan di bawah menegakkan aturan itu: kalau ada yang menulis angka
// tidak stabil ke halaman, atau angka stabil yang jadi tidak cocok, deploy
// DITOLAK.
console.log('\n── Angka Visi & Misi ──');
try {
  const visi = readFileSync(resolve(AUDIT, 'demo-how-it-works.html'), 'utf8');

  const diklaim = {
    sistem: (visi.match(/hiw-angka">(\d+) sistem/) || [])[1],
    tes: (visi.match(/hiw-angka">([\d.]+) tes otomatis/) || [])[1],
    memori: (visi.match(/hiw-angka">~(\d+) MB memori/) || [])[1],
    ram: (visi.match(/hiw-angka">(\d+) GB RAM/) || [])[1],
    anggaran: (visi.match(/hiw-angka">(\d+) KB</) || [])[1],
    temuanDibatalkan: (visi.match(/hiw-angka">(\d+) dari (\d+) temuan/) || [])[1],
    temuanTotal: (visi.match(/hiw-angka">(\d+) dari (\d+) temuan/) || [])[2],
  };

  // ── Angka nyata dari projects.js — satu sumber kebenaran ───────────────────
  //
  // ── KENAPA HANYA label YANG MENGANDUNG "tes" ───────────────────────────────
  // Versi pertama pemeriksaan ini menjumlahkan SEMUA `value:` di projects.js —
  // dan hasilnya 1.573, bukan 1.428. Selisihnya: nilai "berkas uji" (4 dan 141)
  // ikut terjumlah, padahal itu jumlah berkas, bukan jumlah tes.
  //
  // Sekarang labelnya dibaca juga, dan hanya yang mengandung "tes" yang
  // dijumlahkan — sama persis dengan cara `stats()` di projects.js menghitung.
  const proyekSrc = readFileSync(resolve(ROOT, 'assets/js/data/projects.js'), 'utf8');
  const jumlahProyek = (proyekSrc.match(/^\s{2}\{\n\s{4}slug:/gm) || []).length;
  const tesProyek = [...proyekSrc.matchAll(/{\s*label:\s*'([^']*)',\s*value:\s*'([^']*)'\s*}/g)]
    .filter((m) => m[1].includes('tes'))
    .map((m) => Number(m[2].replace(/\./g, '')))
    .reduce((a, b) => a + b, 0);

  // ── Anggaran aset — dari SATU sumber, sama dengan yang dipakai audit ───────
  const anggaranKb = Math.round(BUDGETS.totalBytes / 1024);

  check('angka:sistem', Number(diklaim.sistem) === jumlahProyek,
    `halaman bilang ${diklaim.sistem ?? '—'} · projects.js punya ${jumlahProyek}`);
  check('angka:tes-proyek', Number(diklaim.tes?.replace(/\./g, '')) === tesProyek,
    `halaman bilang ${diklaim.tes ?? '—'} · projects.js punya ${tesProyek.toLocaleString('id-ID')}`);
  check('angka:anggaran-kb', Number(diklaim.anggaran) === anggaranKb,
    `halaman bilang ${diklaim.anggaran ?? '—'} KB · anggaran nyata ${anggaranKb} KB`);
  check('angka:memori-mina', Number(diklaim.memori) === 25 && Number(diklaim.ram) === 2,
    `halaman bilang ~${diklaim.memori ?? '—'} MB di ${diklaim.ram ?? '—'} GB RAM`);

  // ── Temuan audit yang dibatalkan: dibaca dari dokumennya sendiri ───────────
  //
  // Angka "5 dari 8" berasal dari docs/AUDIT-ENTERPRISE-KOREKSI.md. Kalau
  // dokumennya berubah, halaman harus ikut berubah — kalau tidak, deploy
  // ditolak. Dibaca dari dokumennya, bukan diketik ulang di sini, supaya
  // tidak ada dua sumber yang bisa berbeda.
  const auditSrc = readFileSync(resolve(ROOT, 'docs/AUDIT-ENTERPRISE-KOREKSI.md'), 'utf8');
  const auditCocok = auditSrc.match(/(\d+)\s+dari\s+(\d+)\s+"temuan"/);
  const auditDibatalkan = auditCocok ? Number(auditCocok[1]) : NaN;
  const auditTotal = auditCocok ? Number(auditCocok[2]) : NaN;

  check('angka:audit-dibatalkan',
    Number(diklaim.temuanDibatalkan) === auditDibatalkan && Number(diklaim.temuanTotal) === auditTotal,
    `halaman bilang ${diklaim.temuanDibatalkan ?? '—'} dari ${diklaim.temuanTotal ?? '—'} · dokumen audit bilang ${auditDibatalkan} dari ${auditTotal}`);

  // ── Angka yang TIDAK boleh muncul: berubah tiap kali ada catatan baru ──────
  //
  // Kalau suatu saat seseorang menambahkan "30 berkas" atau "8.115 baris" ke
  // halaman, pemeriksaan ini menangkapnya sebelum terkirim.
  const terlarang = [
    { pola: /(\d[\d.]*)\s+berkas\s+catatan/, label: 'jumlah berkas dokumentasi' },
    { pola: /(\d[\d.]*)\s+baris/, label: 'jumlah baris dokumentasi' },
    { pola: /hiw-angka">\d+\s*KB<\/span>\s*—\s*dibuka/, label: 'ukuran halaman saat ini' },
  ];
  const ditemukan = terlarang.filter((t) => t.pola.test(visi)).map((t) => t.label);
  check('angka:tidak-stabil', ditemukan.length === 0,
    ditemukan.length ? `ada angka yang berubah-ubah: ${ditemukan.join(', ')}` : 'tidak ada angka yang berubah-ubah');
} catch (err) {
  check('angka:visi-misi', false, err.message);
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
