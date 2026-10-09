#!/usr/bin/env node
/**
 * Verifikasi bahwa dist/ SINKRON dengan sumber sebelum deploy.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SKRIP INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kesalahan yang terjadi DUA KALI di proyek ini:
 *
 *   1. Teks "ditinjau manual" masih muncul di produksi setelah diperbaiki di
 *      sumber — karena dist tidak dibangun ulang sebelum deploy.
 *   2. Kotak saran sign-up tidak muncul sama sekali di produksi — sebab yang
 *      sama.
 *
 * Keduanya lolos karena `wrangler pages deploy dist` mengirim isi dist apa
 * adanya. Kalau dist belum dibangun, yang ter-deploy adalah versi LAMA — dan
 * TIDAK ADA peringatan apa pun. Situs terlihat baik-baik saja, hanya
 * perubahannya tidak ada.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CARA KERJA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `build-css.mjs` menulis `.build-manifest.json` berisi stempel waktu setiap
 * berkas sumber PADA SAAT BUILD. Skrip ini membandingkan stempel waktu sumber
 * SEKARANG dengan catatan itu:
 *
 *   sumber lebih baru dari manifest  →  ada perubahan setelah build terakhir
 *                                   →  dist BASI, deploy akan mengirim versi lama
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TIDAK MEMBANDINGKAN SUMBER vs DIST LANGSUNG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Sudah dicoba dan GAGAL: build menyalin HTML ke dist dan menulis ulang
 * rujukan CSS, jadi stempel waktu dist SELALU lebih baru dari sumber —
 * perbandingan itu selalu melaporkan "sinkron", bahkan saat dist basi.
 *
 * Manifest memutus lingkaran itu: ia mencatat keadaan sumber pada saat build,
 * sehingga perbandingan dilakukan terhadap KENYATAAN SAAT ITU, bukan terhadap
 * hasil build yang selalu baru.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CARA PAKAI
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/verifikasi-dist.mjs        → periksa saja
 *   node scripts/deploy-aman.mjs            → periksa + deploy
 *
 * Exit code 1 kalau dist basi — supaya bisa dirantai di CI:
 *   node scripts/build-css.mjs && node scripts/verifikasi-dist.mjs && wrangler ...
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');
const MANIFEST = join(DIST, '.build-manifest.json');

// ── 1. Manifest harus ada ────────────────────────────────────────────────────
if (!existsSync(MANIFEST)) {
  console.error('\n  ❌ dist/.build-manifest.json tidak ada.');
  console.error('     Artinya build belum pernah dijalankan, atau dist dihapus.');
  console.error('     Jalankan: node scripts/build-css.mjs\n');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  console.error(`\n  ❌ manifest tidak bisa dibaca: ${err.message}`);
  console.error('     Jalankan: node scripts/build-css.mjs\n');
  process.exit(1);
}

// ── 2. Bandingkan setiap berkas sumber dengan catatan manifest ───────────────
const basi = [];
const hilang = [];

for (const [relatif, mtimeBuild] of Object.entries(manifest.berkas || {})) {
  const penuh = join(ROOT, relatif);

  if (!existsSync(penuh)) {
    hilang.push(relatif);
    continue;
  }

  const mtimeSekarang = statSync(penuh).mtimeMs;

  // Toleransi 1 detik: beberapa filesystem menyimpan waktu dengan presisi
  // lebih kasar, dan perbedaan <1 detik bukan perubahan sungguhan.
  if (mtimeSekarang > mtimeBuild + 1000) {
    basi.push({ relatif, selisihDetik: Math.round((mtimeSekarang - mtimeBuild) / 1000) });
  }
}

// ── 3. Laporkan ──────────────────────────────────────────────────────────────
if (hilang.length) {
  console.error('\n  ⚠️  berkas di manifest sudah tidak ada di sumber:');
  for (const f of hilang) console.error(`     • ${f}`);
  console.error('     (mungkin dihapus — jalankan build ulang untuk memperbarui manifest)');
}

if (basi.length) {
  console.error('\n  ❌ DIST BASI — perubahan berikut belum masuk ke dist:\n');
  for (const b of basi) {
    const detik = b.selisihDetik < 60 ? `${b.selisihDetik} detik` : `${Math.round(b.selisihDetik / 60)} menit`;
    console.error(`     • ${b.relatif}  (diubah ${detik} setelah build terakhir)`);
  }
  console.error('\n     Deploy sekarang akan mengirim versi LAMA — perubahan di atas');
  console.error('     tidak akan muncul di produksi.\n');
  console.error('     Jalankan: node scripts/build-css.mjs\n');
  process.exit(1);
}

// ── 4. Aman ──────────────────────────────────────────────────────────────────
const jumlah = Object.keys(manifest.berkas || {}).length;
const kapan = manifest.dibangun ? new Date(manifest.dibangun).toLocaleString('id-ID') : '(tidak diketahui)';
console.log(`  ✅ dist sinkron — ${jumlah} berkas sumber diperiksa (build: ${kapan})`);
