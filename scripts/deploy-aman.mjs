#!/usr/bin/env node
/**
 * Deploy aman: build → verifikasi → deploy.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SKRIP INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kesalahan yang terjadi DUA KALI: mengubah HTML/CSS di sumber, lalu menjalankan
 * `wrangler pages deploy dist` LANGSUNG tanpa build. Yang ter-deploy adalah
 * dist LAMA, perubahan tidak pernah sampai ke produksi, dan tidak ada
 * peringatan apa pun.
 *
 * Akar masalahnya bukan kelalaian — tapi URUTAN PERINTAH YANG MUDAH SALAH.
 * Menjalankan tiga perintah berurutan dengan benar setiap kali adalah beban
 * yang tidak perlu. Skrip ini menyatukannya jadi satu perintah yang tidak
 * bisa salah urutan.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * URUTANNYA PENTING
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   1. build-css.mjs        → tulis dist/ + manifest
 *   2. preflight.mjs        → periksa ukuran, rujukan, keamanan
 *   3. verifikasi-dist.mjs  → pastikan dist benar-benar dari sumber terbaru
 *   4. wrangler deploy      → kirim
 *
 * Verifikasi dijalankan SETELAH build (bukan sebelum) karena manifest baru
 * ditulis oleh build. Kalau ada yang salah di antara langkah 1–3, deploy
 * TIDAK dijalankan — lebih baik gagal di sini daripada mengirim versi lama
 * ke produksi tanpa ada yang sadar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CARA PAKAI
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/deploy-aman.mjs
 *
 * Atau lewat npm:
 *   npm run deploy:aman
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Jalankan satu langkah; hentikan seluruh proses kalau gagal. */
function langkah(judul, perintah, args) {
  console.log(`\n  ── ${judul} ──`);
  try {
    execFileSync(perintah, args, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`\n  ❌ GAGAL di langkah: ${judul}`);
    console.error(`     Deploy DIBATALKAN — produksi tidak tersentuh.\n`);
    process.exit(1);
  }
}

console.log('\n  ══ DEPLOY AMAN ══');

// 1. Build — menulis dist/ dan manifest
langkah('1/4  Build CSS + HTML', 'node', ['scripts/build-css.mjs']);

// 2. Preflight — ukuran, rujukan, pemeriksaan keamanan
langkah('2/4  Preflight', 'node', ['scripts/preflight.mjs']);

// 3. Verifikasi — dist benar-benar dari sumber terbaru?
//    Ini yang menangkap kesalahan "lupa build" kalau urutan di atas berubah.
langkah('3/4  Verifikasi dist', 'node', ['scripts/verifikasi-dist.mjs']);

// 4. Deploy
langkah('4/4  Deploy ke Cloudflare Pages', 'npx', [
  'wrangler', 'pages', 'deploy', 'dist',
  '--project-name=portfolio-victer',
  '--branch=main',
  '--commit-dirty=true',
]);

console.log('\n  ✅ SELESAI — produksi sudah diperbarui.\n');
