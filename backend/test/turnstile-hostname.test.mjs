/**
 * Tes: daftar hostname Turnstile harus memuat SEMUA domain yang dipakai.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BUG YANG DICEGAH ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Pengguna membuka halaman lupa sandi di `victer.is-a.dev`. Widget Turnstile
 * menampilkan centang hijau "Berhasil!" — verifikasi SUKSES di sisi Cloudflare.
 *
 * Tapi server menolak dengan pesan yang membingungkan:
 *
 *   "Verifikasi keamanan tidak cocok dengan halaman ini.
 *    Muat ulang halaman, lalu coba lagi."
 *
 * Muat ulang tidak akan pernah menolong: penyebabnya `TURNSTILE_HOSTNAMES`
 * tidak memuat `victer.is-a.dev`:
 *
 *   TURNSTILE_HOSTNAMES=portfolio-victer.pages.dev,victerhong.github.io
 *
 * Log server sudah mencatat dengan jelas:
 *
 *   [turnstile] hostname_tidak_cocok: diterima hostname="victer.is-a.dev" —
 *   daftar diizinkan: ["portfolio-victer.pages.dev","victerhong.github.io"]
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 * Domain bisa ditambahkan kapan saja (seperti `victer.is-a.dev` yang baru
 * dipasang), dan setiap domain baru yang lupa didaftarkan di
 * TURNSTILE_HOSTNAMES akan membuat halaman publik tidak bisa dipakai.
 *
 * Tes ini membaca konfigurasi produksi dan memeriksa bahwa setiap domain yang
 * dikenal ada di daftar.
 *
 * Jalankan: node --test backend/test/turnstile-hostname.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// ── LOKASI service.env — DICARI DI BEBERAPA TEMPAT ──────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// ── MASALAH YANG DIPERBAIKI DI SINI ─────────────────────────────────────────
// Versi pertama tes ini memakai path absolut:
//
//   const ENV_FILE = '/home/ubuntu/.portfolio-token/service.env';
//
// Itu GAGAL di GitHub Actions — runner CI memakai /home/runner/..., dan path
// itu tidak ada di sana. Tes melaporkan "TURNSTILE_HOSTNAMES harus ada"
// padahal konfigurasi produksinya benar.
//
// Persis bug yang sama pernah terjadi di 13 berkas tes lain (path absolut →
// relatif). Pelajarannya: tes TIDAK BOLEH mengasumsikan lokasi berkas
// konfigurasi server.
//
// ── KENAPA DICARI DI BEBERAPA TEMPAT ────────────────────────────────────────
// Konfigurasi produksi ada di ~/.portfolio-token/service.env, tapi tes bisa
// dijalankan dari mana saja. Mencari di beberapa kandidat membuat tes bekerja
// baik di server maupun di mesin pengembang.
//
// Kalau TIDAK ADA satu pun yang ditemukan, tes di-SKIP — bukan gagal. Tes
// yang menguji konfigurasi server tidak masuk akal dijalankan di CI yang
// tidak punya konfigurasi itu. (Pola yang sama dipakai tes 9router untuk
// kredensial provider.)
function cariEnvFile() {
  const kandidat = [
    process.env.TOKEN_SERVICE_ENV,
    join(process.env.HOME ?? '', '.portfolio-token', 'service.env'),
    // Dari lokasi tes: backend/test/ → naik ke root proyek
    resolve(__dirname, '..', '..', '.portfolio-token', 'service.env'),
    resolve(__dirname, '..', 'service.env'),
    resolve(__dirname, '..', '.env'),
  ].filter(Boolean);

  for (const p of kandidat) {
    try {
      if (existsSync(p)) return p;
    } catch { /* lanjut ke kandidat berikutnya */ }
  }
  return null;
}

const ENV_FILE = cariEnvFile();

/**
 * Baca satu nilai dari service.env (parser sama dengan config.mjs).
 *
 * Mengembalikan null kalau berkas tidak ada — pemanggil yang memutuskan
 * apakah itu berarti "skip" atau "gagal".
 */
function bacaEnv(kunci) {
  if (!ENV_FILE || !existsSync(ENV_FILE)) return null;
  for (const baris of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = baris.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    if (t.slice(0, eq).trim() === kunci) {
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── DOMAIN YANG HARUS ADA DI DAFTAR ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Setiap domain yang bisa membuka halaman publik (masuk, daftar, lupa sandi)
// HARUS ada di sini. Kalau tidak, pengguna di domain itu tidak bisa memakai
// fitur apa pun yang butuh Turnstile.
//
// Cara menambah: tambahkan domainnya ke TURNSTILE_HOSTNAMES di service.env,
// lalu tambahkan juga ke daftar ini supaya tes menjaganya.
const DOMAIN_WAJIB = [
  'portfolio-victer.pages.dev',   // domain utama Cloudflare Pages
  'victer.is-a.dev',              // domain profesional (via is-a.dev)
  'victerhong.github.io',         // domain GitHub Pages (fallback)
];

describe('TURNSTILE_HOSTNAMES memuat semua domain', () => {
  test('setiap domain yang dikenal ada di daftar', { skip: !ENV_FILE && 'service.env tidak ada (CI)' }, () => {
    const nilai = bacaEnv('TURNSTILE_HOSTNAMES');
    assert.ok(nilai, 'TURNSTILE_HOSTNAMES harus ada di service.env');

    const daftar = nilai.split(',').map((s) => s.trim()).filter(Boolean);

    for (const domain of DOMAIN_WAJIB) {
      assert.ok(
        daftar.includes(domain),
        `domain "${domain}" TIDAK ADA di TURNSTILE_HOSTNAMES.\n`
        + `Pengguna yang membuka situs lewat domain itu akan ditolak Turnstile\n`
        + `dengan pesan "Verifikasi keamanan tidak cocok dengan halaman ini",\n`
        + `padahal widget-nya menunjukkan centang hijau "Berhasil!".\n`
        + `Daftar sekarang: [${daftar.join(', ')}]`,
      );
    }
  });

  test('daftar tidak memuat domain kosong', { skip: !ENV_FILE && 'service.env tidak ada (CI)' }, () => {
    const nilai = bacaEnv('TURNSTILE_HOSTNAMES') ?? '';
    const daftar = nilai.split(',').map((s) => s.trim()).filter(Boolean);

    for (const d of daftar) {
      assert.ok(
        d.length > 3 && d.includes('.'),
        `entri "${d}" bukan hostname yang sah`,
      );
    }
  });

  test('tidak ada duplikat', { skip: !ENV_FILE && 'service.env tidak ada (CI)' }, () => {
    const nilai = bacaEnv('TURNSTILE_HOSTNAMES') ?? '';
    const daftar = nilai.split(',').map((s) => s.trim()).filter(Boolean);
    const unik = new Set(daftar);

    assert.equal(
      daftar.length, unik.size,
      `ada duplikat: [${daftar.join(', ')}]`,
    );
  });

  test('site key dan secret key keduanya terisi', { skip: !ENV_FILE && 'service.env tidak ada (CI)' }, () => {
    const site = bacaEnv('TURNSTILE_SITE_KEY');
    const secret = bacaEnv('TURNSTILE_SECRET_KEY');

    assert.ok(site, 'TURNSTILE_SITE_KEY harus ada');
    assert.ok(secret, 'TURNSTILE_SECRET_KEY harus ada');

    // Site key Cloudflare selalu diawali '0x'.
    assert.ok(
      site.startsWith('0x'),
      `site key harus diawali "0x", dapat: ${site.slice(0, 10)}…`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── SITE KEY DI HALAMAN HTML HARUS SAMA DENGAN SERVICE.ENV ──────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Site key ditulis langsung di HTML (halaman masuk, daftar, lupa sandi) supaya
// widget bisa dirender tanpa menunggu /api/config. Kalau nilainya berbeda dari
// service.env, verifikasi akan gagal — Cloudflare menerbitkan token untuk satu
// site key, dan server memverifikasinya dengan site key yang lain.

describe('site key di HTML cocok dengan service.env', () => {
  const HALAMAN = [
    'sign-in.html',
    'sign-up.html',
    'lupa-sandi.html',
  ];

  // Path relatif dari lokasi tes: backend/test/ → root proyek
  const ROOT = resolve(__dirname, '..', '..');

  test('setiap halaman menulis site key yang sama', () => {
    const siteEnv = bacaEnv('TURNSTILE_SITE_KEY');
    if (!siteEnv) return;   // sudah diperiksa di atas

    for (const halaman of HALAMAN) {
      const jalur = `${ROOT}/${halaman}`;
      if (!existsSync(jalur)) continue;

      const isi = readFileSync(jalur, 'utf8');

      // Cari `siteKey: '...'` atau `siteKey: "..."`
      const cocok = isi.match(/siteKey:\s*['"]([^'"]+)['"]/);
      if (!cocok) continue;   // halaman ini tidak menulis site key

      assert.equal(
        cocok[1], siteEnv,
        `${halaman}: site key di HTML (${cocok[1].slice(0, 20)}…) berbeda `
        + `dari TURNSTILE_SITE_KEY di service.env (${siteEnv.slice(0, 20)}…). `
        + 'Token dari satu site key tidak bisa diverifikasi dengan site key lain — '
        + 'semua verifikasi akan gagal.',
      );
    }
  });
});
