#!/usr/bin/env node
/**
 * Build CSS: minifikasi semua berkas ke dist/, lalu tulis ulang rujukan
 * di HTML ke versi terminifikasi.
 *
 * ── KENAPA SKRIP, BUKAN EDIT LANGSUNG ───────────────────────────────────────
 *
 * Sumber di assets/css/*.css TETAP tidak terminifikasi — itu yang dibaca dan
 * diedit manusia. Minifikasi terjadi saat build, hasilnya ke dist/.
 * Kalau sumbernya yang diminifikasi, setiap perubahan berikutnya jadi mimpi
 * buruk: tidak ada komentar, tidak ada baris baru, sulit ditinjau.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 *
 *   1. Baca setiap assets/css/*.css
 *   2. Minifikasi dengan esbuild
 *   3. Tulis ke dist/assets/css/<nama>.min.css
 *   4. Untuk setiap HTML: ganti rujukan .css → .min.css
 *   5. Tulis HTML hasil ke dist/
 *
 * Deploy dari dist/, bukan dari root. Sumber tetap bersih di git.
 *
 * Jalankan: node scripts/build-css.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

// ── 1. Bersihkan dist ────────────────────────────────────────────────────────
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'assets', 'css'), { recursive: true });

// ── 2. Minifikasi setiap CSS ─────────────────────────────────────────────────
const cssDir = join(ROOT, 'assets', 'css');
const files = readdirSync(cssDir).filter((f) => f.endsWith('.css'));

let totalAsli = 0, totalMin = 0;
const peta = new Map();   // 'assets/css/main.css' → 'assets/css/main.min.css'

for (const f of files) {
  const src = join(cssDir, f);
  const isi = readFileSync(src);
  totalAsli += isi.length;

  // esbuild lewat stdin: '--loader=css' hanya berlaku untuk stdin,
  // dan cara ini menghindari esbuild menulis berkas tambahan.
  let hasil;
  try {
    hasil = execFileSync('npx', ['esbuild', '--minify', '--loader=css'], {
      input: isi,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (e) {
    // Gagal minifikasi → pakai berkas asli. Situs tetap jalan.
    console.error(`  ⚠ gagal minifikasi ${f}, memakai asli`);
    hasil = isi;
  }

  const nama = f.replace(/\.css$/, '.min.css');
  writeFileSync(join(DIST, 'assets', 'css', nama), hasil);
  totalMin += hasil.length;
  peta.set(`assets/css/${f}`, `assets/css/${nama}`);
}

console.log(`  CSS: ${files.length} berkas · ${totalAsli} → ${totalMin} byte ` +
  `(hemat ${100 - Math.round((totalMin / totalAsli) * 100)}%)`);

// ── 3. Salin SEMUA berkas kecuali CSS dan HTML ───────────────────────────────
// Pendekatan daftar-putih: apa pun yang bukan .css/.html disalin apa adanya.
// Ini lebih aman daripada daftar-hitam — berkas baru otomatis ikut.
const LEWATI_DIR = new Set(['node_modules', '.git', '.github', '.wrangler', 'dist',
  'backend', 'workers', 'scripts', 'design', 'tests', 'docs', '.hermes']);

function salin(dir, rel = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (LEWATI_DIR.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      mkdirSync(join(DIST, relPath), { recursive: true });
      salin(full, relPath);
      continue;
    }
    // CSS ditangani di langkah 2, HTML di langkah 4
    if (entry.name.endsWith('.css') || entry.name.endsWith('.html')) continue;
    // Berkas yang tidak perlu ikut deploy
    if (/^(package|package-lock|yarn|tsconfig|wrangler|eslint|prettier|commitlint|greptile)/.test(entry.name)) continue;

    mkdirSync(join(DIST, dirname(relPath)), { recursive: true });
    writeFileSync(join(DIST, relPath), readFileSync(full));
  }
}
salin(ROOT);

// ── 4. Tulis ulang HTML: .css → .min.css ─────────────────────────────────────
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let nHtml = 0;

function prosesHtml(isi) {
  // Ganti setiap rujukan ke berkas CSS yang ada di peta.
  // Hanya yang benar-benar ada di peta — CDN dan berkas luar tidak disentuh.
  let hasil = isi;
  for (const [asli, min] of peta) {
    hasil = hasil.split(asli).join(min);
  }
  return minifyHtml(hasil);
}

/**
 * Minifikasi HTML untuk berkas yang DIKIRIM ke pengunjung.
 *
 * ── KENAPA INI ADA ──────────────────────────────────────────────────────────
 * Berkas sumber di root TIDAK diminifikasi — itu yang dibaca manusia, dan
 * komentarnya menjelaskan keputusan desain. Yang diminifikasi hanya salinan
 * di dist/, yaitu yang benar-benar diunduh browser.
 *
 * Ini menghemat ~25%: 54 KB → 40 KB. Tanpa ini, halaman baru (masuk.html)
 * mendorong total melewati anggaran 90 KB dan preflight menolak deploy.
 *
 * ── YANG DILINDUNGI ─────────────────────────────────────────────────────────
 * Isi <pre>, <textarea>, <script>, dan <style> TIDAK disentuh. Spasi di
 * dalamnya bermakna: mengubahnya bisa merusak kode atau mengubah tampilan
 * teks yang sengaja diformat. Blok itu ditukar dengan penanda sementara,
 * lalu dikembalikan utuh setelah minifikasi selesai.
 *
 * Komentar kondisional IE (`<!--[if ...]>`) juga dibiarkan — beberapa
 * proxy lama masih membacanya, dan menghapusnya bisa mengubah perilaku.
 */
function minifyHtml(isi) {
  const simpan = new Map();

  // Tukar blok yang tidak boleh diubah dengan penanda unik.
  // \x00 tidak mungkin muncul di HTML sungguhan, jadi tidak akan bentrok.
  let hasil = isi.replace(
    /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (m) => {
      const kunci = `\x00LINDUNG${simpan.size}\x00`;
      simpan.set(kunci, m);
      return kunci;
    },
  );

  hasil = hasil
    // Komentar HTML — kecuali kondisional IE
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    // Spasi di antara tag
    .replace(/>\s+</g, '><')
    // Beberapa spasi/baris baru berturut-turut → satu spasi
    .replace(/\s{2,}/g, ' ')
    // Spasi di awal baris
    .replace(/\n\s+/g, '\n')
    .trim();

  // Kembalikan blok yang dilindungi, persis seperti aslinya.
  for (const [kunci, asli] of simpan) {
    hasil = hasil.split(kunci).join(asli);
  }
  return hasil;
}

for (const f of htmlFiles) {
  const isi = readFileSync(join(ROOT, f), 'utf8');
  writeFileSync(join(DIST, f), prosesHtml(isi));
  nHtml++;
}

// HTML di subfolder (mis. /s/<kode>/index.html)
const sDir = join(ROOT, 's');
if (existsSync(sDir)) {
  for (const sub of readdirSync(sDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const idx = join(sDir, sub.name, 'index.html');
    if (!existsSync(idx)) continue;
    const isi = readFileSync(idx, 'utf8');
    mkdirSync(join(DIST, 's', sub.name), { recursive: true });
    writeFileSync(join(DIST, 's', sub.name, 'index.html'), prosesHtml(isi));
    nHtml++;
  }
}

console.log(`  HTML: ${nHtml} berkas · rujukan CSS dialihkan ke .min.css`);

// ── 5. Verifikasi: tidak ada rujukan .css non-min yang tersisa ───────────────
let bocor = 0;
function cekBocor(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { cekBocor(full); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const isi = readFileSync(full, 'utf8');
    for (const m of isi.matchAll(/href="(assets\/css\/[^"]+\.css)"/g)) {
      if (!m[1].endsWith('.min.css')) {
        console.error(`  ❌ ${full.slice(ROOT.length + 1)} masih merujuk ${m[1]}`);
        bocor++;
      }
    }
  }
}
cekBocor(DIST);

if (bocor) {
  console.error(`\n  ❌ ${bocor} rujukan CSS belum diminifikasi — build GAGAL`);
  process.exit(1);
}

console.log(`  ✅ build selesai → dist/`);
