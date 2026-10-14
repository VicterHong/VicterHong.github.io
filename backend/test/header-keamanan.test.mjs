/**
 * Penjaga: header keamanan wajib ada dan wajib ikut ke dist/.
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 * Situs ini sebelumnya tidak punya berkas _headers sama sekali: tanpa HSTS,
 * tanpa CSP, tanpa proteksi framing. Itu tidak terlihat sebagai kerusakan —
 * halaman tetap 200, tampilan tetap bagus — jadi tidak ada yang menyadarinya.
 *
 * Dua cara perbaikan ini bisa hilang lagi tanpa ketahuan:
 *
 *   1. Berkas _headers terhapus dari repositori. Tidak ada yang gagal; hanya
 *      header keamanannya diam-diam hilang lagi.
 *
 *   2. Build tidak menyalin _headers ke dist/. Deploy berjalan mulus, tapi
 *      Cloudflare tidak menerima berkasnya, jadi header tidak pernah aktif.
 *
 * Keduanya diperiksa di sini, ditambah pemeriksaan bahwa arahan CSP-nya
 * benar-benar memuat sumber daya yang dipakai situs — CSP yang kurang satu
 * sumber akan memblokir font atau skrip tanpa error yang jelas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function bacaHeaders() {
  const jalur = join(AKAR, '_headers');
  assert.ok(existsSync(jalur), '_headers harus ada di akar repositori');
  return readFileSync(jalur, 'utf8');
}

test('_headers ada dan tidak kosong', () => {
  const isi = bacaHeaders();
  assert.ok(isi.length > 500, `_headers terlalu pendek (${isi.length} byte)`);
});

test('header keamanan wajib terdaftar', () => {
  const isi = bacaHeaders();
  const wajib = [
    'Strict-Transport-Security',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
  ];
  for (const h of wajib) {
    assert.ok(isi.includes(h), `header ${h} hilang dari _headers`);
  }
});

test('CSP memuat semua sumber daya yang dipakai situs', () => {
  const isi = bacaHeaders();
  const baris = isi.split('\n').find((b) => b.trim().startsWith('Content-Security-Policy:'));
  assert.ok(baris, 'baris Content-Security-Policy tidak ditemukan');

  // Sumber yang terbukti dipakai halaman. Kalau salah satu hilang dari CSP,
  // font atau skrip akan diblokir tanpa pesan error yang jelas di produksi.
  const sumberWajib = [
    ['challenges.cloudflare.com', 'Turnstile — widget verifikasi'],
    ['api.fontshare.com', 'font (CSS Fontshare)'],
    ['cdn.fontshare.com', 'font (berkas .woff2 Fontshare)'],
    ['fonts.gstatic.com', 'font (berkas Google Fonts)'],
    ['cdn.jsdelivr.net', 'pustaka pihak ketiga'],
    ['api.iconify.design', 'ikon'],
    ['api.github.com', 'badge status CI'],
  ];

  for (const [domain, alasan] of sumberWajib) {
    assert.ok(baris.includes(domain), `CSP tidak memuat ${domain} (${alasan})`);
  }
});

test('CSP memblokir plugin dan melarang framing lintas situs', () => {
  const isi = bacaHeaders();
  const baris = isi.split('\n').find((b) => b.trim().startsWith('Content-Security-Policy:'));
  assert.ok(baris.includes("object-src 'none'"), "CSP harus memuat object-src 'none'");
  assert.ok(baris.includes("frame-ancestors 'self'"), "CSP harus memuat frame-ancestors 'self'");
  assert.ok(baris.includes("base-uri 'self'"), "CSP harus memuat base-uri 'self'");
});

test('aset statis TIDAK di-cache lama (nama berkas tanpa hash)', () => {
  const isi = bacaHeaders();

  // Nama aset tidak berisi hash isi, jadi nama yang sama dipakai ulang setiap
  // deploy. Cache panjang berarti pengunjung memakai JS lama bersama HTML baru
  // — kerusakan yang sangat sulit dilacak.
  //
  // CATATAN: pencarian harus dibatasi pada blok /assets/* saja. Header HSTS di
  // bagian atas berkas juga memuat max-age=31536000, jadi mencocokkan seluruh
  // berkas akan memberi hasil palsu.
  const bagianAset = isi.split('/assets/*')[1]?.split(/\n\/|\n#/)[0] || '';

  assert.ok(bagianAset.length > 0, 'blok aturan /assets/* tidak ditemukan di _headers');
  assert.ok(
    !bagianAset.includes('max-age=31536000'),
    'aset tidak boleh di-cache setahun selama namanya belum berisi hash'
  );
  assert.ok(
    bagianAset.includes('must-revalidate') || bagianAset.includes('max-age=0'),
    'aset harus divalidasi ulang setiap permintaan'
  );
});

test('_headers ikut tersalin ke dist/ saat build', () => {
  const dist = join(AKAR, 'dist', '_headers');

  // dist/ mungkin belum dibangun di lingkungan bersih; lewati dengan jelas
  // ketimbang gagal palsu.
  if (!existsSync(join(AKAR, 'dist'))) {
    console.log('  (dist/ belum ada — lewati, build belum dijalankan)');
    return;
  }

  assert.ok(existsSync(dist), '_headers harus tersalin ke dist/ supaya ikut ter-deploy');
  const isi = readFileSync(dist, 'utf8');
  assert.ok(
    isi.includes('Content-Security-Policy'),
    '_headers di dist/ harus memuat CSP'
  );
});
