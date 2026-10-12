/**
 * Tes: halaman privat harus jadi "ruang pribadi".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA TES INI ADA ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Permintaan pengguna:
 *
 *   "Hilangin kembali ke halaman masuk semua kosong kecuali logo tapi ga bisa
 *    diklik ke website karena itu macam ruang pribadi"
 *
 * Transformasi itu dilakukan skrip `scripts/auth-ruang-pribadi.mjs`, dan ia
 * MELEWATKAN keamanan.html (halaman profil). Akibatnya:
 *
 *   • halaman profil tetap menampilkan link "Beranda" — satu-satunya halaman
 *     privat yang belum jadi ruang pribadi
 *   • logo tidak muncul sama sekali (logo-mount.js tidak dimuat)
 *
 * Dua bug itu ketahuan dari screenshot pengguna, bukan dari tes. Tes ini
 * memastikan tidak ada halaman privat yang tertinggal lagi — sekarang atau
 * nanti, ketika halaman privat baru ditambahkan.
 *
 * ── ATURAN YANG DIUJI ────────────────────────────────────────────────────────
 *
 * Untuk SETIAP halaman privat (auth + profil):
 *
 *   1. Header memakai kelas `auth-nav-polos` (menandai "sudah ditransformasi")
 *   2. TIDAK ada `auth-nav-links` — tidak ada menu navigasi
 *   3. TIDAK ada `<a class="auth-nav-brand"` — logo bukan tautan
 *   4. `logo-mount.js` DIMUAT — tanpa ini, mark tetap kotak emas kosong
 *   5. `auth-nav-mark` ADA — tempat logo, supaya logo-mount punya sasaran
 *
 * Dan untuk SEMUA halaman yang punya mark (`.brand-mark` atau
 * `.auth-nav-mark`): salah satu dari `logo-mount.js` atau `app.js` harus
 * dimuat — kalau tidak, header menampilkan kotak kosong.
 *
 * ── KENAPA TES INI MEMBACA BERKAS SUMBER, BUKAN dist/ ────────────────────────
 * Sumber adalah kebenaran; dist/ dibangun dari sana. Tes yang membaca dist
 * akan gagal di CI (dist tidak ikut di-commit), dan itu bukan regresi kode —
 * hanya artefak build yang belum dibuat.
 *
 * Jalankan: node --test backend/test/halaman-privat.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Halaman yang WAJIB jadi ruang pribadi.
//
// Daftar ini sengaja eksplisit — bukan "semua *.html". Halaman publik
// (home, pricing, docs) memang HARUS punya navigasi; memasukkannya ke sini
// akan memaksa perubahan yang salah.
const HALAMAN_PRIVAT = [
  'sign-in.html',
  'sign-up.html',
  'lupa-sandi.html',
  'reset-sandi.html',
  'keamanan.html',
];

/** Baca berkas dari root proyek; null kalau tidak ada. */
function baca(nama) {
  const p = resolve(ROOT, nama);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('halaman privat — ruang pribadi', () => {
  for (const berkas of HALAMAN_PRIVAT) {
    describe(berkas, () => {
      const isi = baca(berkas);

      test('berkas ada', () => {
        assert.ok(isi, `${berkas} harus ada di root proyek`);
      });

      test('header memakai auth-nav-polos (sudah ditransformasi)', () => {
        assert.ok(
          isi.includes('auth-nav-polos'),
          `${berkas}: header belum ditransformasi jadi ruang pribadi. ` +
          'Jalankan: node scripts/auth-ruang-pribadi.mjs',
        );
      });

      test('tidak ada menu navigasi (auth-nav-links)', () => {
        assert.equal(
          (isi.match(/auth-nav-links/g) ?? []).length, 0,
          `${berkas}: masih ada menu navigasi. Halaman privat tidak boleh ` +
          'menampilkan menu pemasaran — pengguna bisa keluar dari alur ' +
          'tanpa sengaja dan kehilangan isian form.',
        );
      });

      test('logo bukan tautan (<a class="auth-nav-brand">)', () => {
        assert.equal(
          (isi.match(/<a class="auth-nav-brand"/g) ?? []).length, 0,
          `${berkas}: logo masih berupa <a>. Di halaman privat, logo yang ` +
          'bisa diklik adalah jebakan — pengguna menyentuhnya tanpa sengaja ' +
          'dan kehilangan progres.',
        );
      });

      test('memuat logo-mount.js (supaya mark tidak kosong)', () => {
        assert.ok(
          /logo-mount(\.min)?\.js/.test(isi),
          `${berkas}: logo-mount.js tidak dimuat. Tanpa skrip ini, ` +
          '.auth-nav-mark tetap kotak emas kosong — persis bug "logo hilang" ' +
          'yang dilaporkan pengguna.',
        );
      });

      test('punya titik pasang logo (auth-nav-mark)', () => {
        assert.ok(
          isi.includes('auth-nav-mark'),
          `${berkas}: tidak ada .auth-nav-mark — logo-mount tidak punya ` +
          'elemen untuk diganti.',
        );
      });
    });
  }
});

describe('semua halaman bermark — skrip logo dimuat', () => {
  // Halaman publik pun bisa punya bug yang sama: mark ada, skrip tidak
  // dimuat. Halaman seperti itu menampilkan kotak kosong di header tanpa
  // error apa pun di konsol.
  const KANDIDAT = [
    'home.html', 'pricing.html', 'docs.html', 'changelog.html',
    'privasi.html', 'syarat.html', '404.html',
    ...HALAMAN_PRIVAT,
  ];

  for (const berkas of KANDIDAT) {
    const isi = baca(berkas);
    if (!isi) continue;

    const punyaMark = /class="[^"]*(brand-mark|auth-nav-mark)[^"]*"/.test(isi);
    if (!punyaMark) continue;

    test(`${berkas} — mark ada, skrip logo dimuat`, () => {
      // app.js juga memanggil pasangMonogram(), jadi halaman yang memuatnya
      // tidak butuh logo-mount.js terpisah.
      const punyaSkrip = /logo-mount(\.min)?\.js/.test(isi) || /app(\.min)?\.js/.test(isi);
      assert.ok(
        punyaSkrip,
        `${berkas}: punya mark di header tapi tidak memuat logo-mount.js ` +
        'maupun app.js — header akan menampilkan kotak kosong.',
      );
    });
  }
});

describe('halaman publik — navigasi tetap ada', () => {
  // Kebalikan dari aturan di atas: halaman publik HARUS tetap punya navigasi.
  // Tanpa tes ini, transformasi "ruang pribadi" yang terlalu bersemangat bisa
  // menghapus navigasi dari halaman yang seharusnya memilikinya.
  for (const berkas of ['home.html', 'pricing.html', 'docs.html']) {
    const isi = baca(berkas);
    if (!isi) continue;

    test(`${berkas} — bukan auth-nav-polos`, () => {
      assert.ok(
        !isi.includes('auth-nav-polos'),
        `${berkas} adalah halaman PUBLIK — tidak boleh jadi ruang pribadi.`,
      );
    });
  }
});
