/**
 * Tes: router menerima parameter yang bentuknya DIHASILKAN sistem sendiri.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `validParam()` menyebut `SLUG_RE` dan `TOKEN_ID_RE`, tapi kedua konstanta
 * itu HILANG dari routes.mjs — terhapus saat menambahkan pola avatar. Karena
 * referensi ke nama yang tidak ada melempar ReferenceError (bukan mengembalikan
 * false), SETIAP rute ber-`:slug` dan ber-`:id` menjawab 400:
 *
 *   /api/project/:slug/locked   → fitur inti token MATI
 *   /api/pesanan/:id            → halaman /pesanan tidak bisa baca status
 *   /api/admin/token/:id        → detail token tidak bisa dibuka
 *
 * Tes ini memanggil matchPath() langsung — tanpa HTTP — sehingga kegagalan
 * sekecil apa pun pada validasi parameter langsung terlihat, bukan tersamar
 * sebagai "rute tidak ditemukan".
 *
 * Jalankan: node --test backend/test/router-param.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchPath } from '../src/routes.mjs';

describe('matchPath — bentuk parameter yang sah', () => {
  const SAH = [
    // [pattern, pathname, params yang diharapkan]
    ['/api/pesanan/:id', '/api/pesanan/pay_' + 'a'.repeat(24), { id: 'pay_' + 'a'.repeat(24) }],
    ['/api/admin/token/:id', '/api/admin/token/tok_' + 'b'.repeat(16), { id: 'tok_' + 'b'.repeat(16) }],
    ['/api/project/:slug/locked', '/api/project/mina/locked', { slug: 'mina' }],
    ['/api/cms/:collection/items/:slug', '/api/cms/blog/items/hello-world',
      { collection: 'blog', slug: 'hello-world' }],
    ['/api/admin/branch/:name', '/api/admin/branch/fitur-baru', { name: 'fitur-baru' }],
    ['/api/auth/avatar/:berkas',
      '/api/auth/avatar/' + 'a'.repeat(32) + '-' + 'b'.repeat(10) + '.webp',
      { berkas: 'a'.repeat(32) + '-' + 'b'.repeat(10) + '.webp' }],
  ];

  for (const [pattern, pathname, harapan] of SAH) {
    test(`${pathname} cocok`, () => {
      assert.deepEqual(matchPath(pattern, pathname), harapan);
    });
  }
});

describe('matchPath — bentuk parameter yang DITOLAK', () => {
  const TOLAK = [
    // Path traversal setelah decode
    ['/api/project/:slug/locked', '/api/project/..%2F..%2Fetc/locked'],
    // ID token dengan bentuk salah (huruf besar)
    ['/api/admin/token/:id', '/api/admin/token/tok_BUKANHEX'],
    // ID token terlalu pendek
    ['/api/admin/token/:id', '/api/admin/token/tok_abcd'],
    // ID pembayaran dengan panjang salah
    ['/api/pesanan/:id', '/api/pesanan/pay_pendek'],
    ['/api/pesanan/:id', '/api/pesanan/pay_' + 'a'.repeat(23)],
    // ID dengan awalan asing
    ['/api/pesanan/:id', '/api/pesanan/inv_' + 'a'.repeat(24)],
    // Slug dengan huruf besar
    ['/api/project/:slug/locked', '/api/project/MINA/locked'],
    // Nama berkas avatar dengan ekstensi lain
    ['/api/auth/avatar/:berkas', '/api/auth/avatar/' + 'a'.repeat(32) + '-' + 'b'.repeat(10) + '.png'],
  ];

  // ── CATATAN: `id` MENERIMA DUA BENTUK ────────────────────────────────────
  // Dua rute memakai nama parameter `id` dengan dua jenis ID berbeda:
  // /api/admin/token/:id (tok_…) dan /api/pesanan/:id (pay_…). Validator
  // hanya menyaring BENTUK — bentuk yang tidak mungkin dihasilkan sistem
  // ditolak; apakah barisnya ada di database diputuskan handler (404).
  // Jadi `pay_…` pada rute token BUKAN kasus yang ditolak di sini.

  for (const [pattern, pathname] of TOLAK) {
    test(`${pathname} ditolak`, () => {
      assert.equal(matchPath(pattern, pathname), null);
    });
  }
});

describe('matchPath — jumlah segmen', () => {
  test('path lebih pendek tidak cocok', () => {
    assert.equal(matchPath('/api/project/:slug/locked', '/api/project/mina'), null);
  });
  test('path lebih panjang tidak cocok', () => {
    assert.equal(matchPath('/api/project/:slug/locked', '/api/project/mina/locked/extra'), null);
  });
});
