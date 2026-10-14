/**
 * Tes: berkas konfigurasi alat build TIDAK boleh ikut ter-deploy.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * `cloudflare.config.ts` ikut tersalin ke `dist/` — direktori yang di-deploy ke
 * Cloudflare Pages. Isinya tidak memuat NILAI rahasia (memakai
 * `process.env.SERVICE_SECRET`), jadi ini bukan kebocoran kredensial.
 *
 * Tapi ia MEMBOCORKAN TOPOLOGI INFRASTRUKTUR:
 *
 *   - nama database D1        (`portfolio-db`)
 *   - nama KV namespace, R2 bucket, dataset analytics
 *   - nama worker, zona, dan daftar rahasia yang dipakai
 *
 * Bagi penyerang, daftar itu peta yang mempersempit tebakan: ia tahu persis
 * layanan mana yang harus diserang, tanpa perlu memindai.
 *
 * ── KENAPA build-css.mjs MEMAKAI DAFTAR-PUTIH ───────────────────────────────
 * Komentarnya menyebut: "apa pun yang bukan .css/.js/.html disalin apa adanya.
 * Ini lebih aman daripada daftar-hitam — berkas baru otomatis ikut."
 *
 * Itu benar untuk ASET SITUS. Tapi berkas konfigurasi build BUKAN aset situs —
 * ia dibaca alat build, bukan browser. Yang mengunduhnya tidak bisa melakukan
 * apa pun dengannya, jadi menyalinnya hanya menambah risiko tanpa manfaat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');
const DIST = join(AKAR, 'dist');

/* ══ 1. BERKAS KONFIGURASI TIDAK ADA DI dist/ ══════════════════════════════ */

test('cloudflare.config.ts TIDAK ada di dist/', () => {
  const jalur = join(DIST, 'cloudflare.config.ts');
  assert.ok(
    !existsSync(jalur),
    'cloudflare.config.ts ikut ter-deploy — ia membocorkan nama database, '
    + 'KV namespace, R2 bucket, dan daftar rahasia ke siapa pun yang mengunduhnya',
  );
});

test('tidak ada berkas .ts di AKAR dist/', () => {
  // ── KENAPA HANYA AKAR ─────────────────────────────────────────────────────
  // Aset .ts yang sah bisa ada di subfolder (mis. contoh kode). Yang dibuang
  // hanya konfigurasi alat build, dan itu selalu di akar proyek.
  if (!existsSync(DIST)) return; // dist/ belum dibangun — tes dilewati

  const diAkar = readdirSync(DIST, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name);

  assert.deepEqual(
    diAkar,
    [],
    `berkas .ts di akar dist/: ${diAkar.join(', ')} — konfigurasi build tidak `
    + 'perlu ter-deploy',
  );
});

/* ══ 2. TIDAK ADA NAMA INFRASTRUKTUR DI SELURUH dist/ ══════════════════════ */

test('nama infrastruktur tidak muncul di dist/', () => {
  // ── KENAPA DIPERIKSA DI SELURUH dist/ ─────────────────────────────────────
  // Bukan hanya cloudflare.config.ts. Kalau ada berkas lain yang menyebut nama
  // database atau bucket, ia sama bocornya.
  if (!existsSync(DIST)) return;

  const nama = [
    'portfolio-db',        // nama database D1
    'portfolio-analytics', // dataset analytics
  ];

  const ditemukan = [];

  function jelajah(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { jelajah(full); continue; }
      // Hanya periksa berkas teks — gambar/binari tidak relevan.
      if (!/\.(html|js|css|json|xml|txt|md|ts|mjs)$/.test(e.name)) continue;
      try {
        const isi = readFileSync(full, 'utf8');
        for (const n of nama) {
          if (isi.includes(n)) ditemukan.push(`${e.name} → ${n}`);
        }
      } catch { /* berkas tidak terbaca — lewati */ }
    }
  }

  jelajah(DIST);

  assert.deepEqual(
    ditemukan,
    [],
    `nama infrastruktur bocor ke dist/: ${ditemukan.join(', ')}`,
  );
});

/* ══ 3. FILTER DI BUILD SCRIPT ═════════════════════════════════════════════ */

test('build-css.mjs mengecualikan cloudflare.config.ts', () => {
  // ── KENAPA DIUJI DI SUMBERNYA ─────────────────────────────────────────────
  // Tes di atas memeriksa HASIL build. Kalau build belum dijalankan, `dist/`
  // masih versi lama dan tesnya lolos palsu. Memeriksa sumbernya memastikan
  // aturannya benar-benar ada.
  const src = readFileSync(join(AKAR, 'scripts', 'build-css.mjs'), 'utf8');

  assert.ok(
    src.includes('cloudflare.config.ts'),
    'build-css.mjs tidak mengecualikan cloudflare.config.ts — berkas konfigurasi '
    + 'akan ikut ter-deploy lagi',
  );
});

test('build-css.mjs membuang berkas .ts di akar', () => {
  const src = readFileSync(join(AKAR, 'scripts', 'build-css.mjs'), 'utf8');

  assert.ok(
    /endsWith\(['"]\.ts['"]\)/.test(src),
    'build-css.mjs tidak memfilter berkas .ts — konfigurasi alat build bisa '
    + 'ikut ter-deploy',
  );
});

/* ══ 4. KONFIGURASI MEMAKAI process.env, BUKAN NILAI LITERAL ═══════════════ */

test('cloudflare.config.ts memakai process.env, bukan nilai rahasia literal', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kalau suatu saat ada yang menulis nilai rahasia langsung ke berkas ini,
  // bocornya berubah dari "topologi" menjadi "kredensial" — jauh lebih serius.
  const jalur = join(AKAR, 'cloudflare.config.ts');
  if (!existsSync(jalur)) return;

  const src = readFileSync(jalur, 'utf8');

  // Nilai rahasia literal: panjang, dan bukan referensi process.env.
  const polaBahaya = [
    /SERVICE_SECRET:\s*['"][^'"]{8,}['"]/,
    /ADMIN_KEY:\s*['"][^'"]{8,}['"]/,
    /TURNSTILE_SECRET_KEY:\s*['"][^'"]{8,}['"]/,
  ];

  for (const p of polaBahaya) {
    assert.ok(
      !p.test(src),
      `cloudflare.config.ts memuat nilai rahasia LITERAL (${p}) — harus pakai process.env`,
    );
  }
});
