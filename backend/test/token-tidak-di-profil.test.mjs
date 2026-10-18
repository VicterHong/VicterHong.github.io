/**
 * Tes: metadata token akses tidak boleh tampil di halaman profil pengguna.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * Halaman profil (/keamanan) punya tab "Token akses" yang menampilkan paket,
 * proyek, cakupan, tanggal terbit, masa berlaku, dan status token.
 *
 * Token akses adalah kredensial INTEGRASI untuk skrip/API — bukan identitas
 * akun. Menampilkannya di halaman profil membuat pemegang akun melihat
 * metadata yang bukan urusannya, dan memberi kesan bahwa token itu milik
 * pribadi akun tersebut.
 *
 * Tab, panel, dan pemuat datanya sudah dihapus. Tes ini memastikan tidak ada
 * yang mengembalikannya tanpa sengaja — misalnya saat menyalin markup dari
 * versi lama.
 *
 * ── YANG TIDAK DIUJI DI SINI ────────────────────────────────────────────────
 * Endpoint /api/auth/token-saya TETAP ada (dipakai admin & integrasi) dan
 * tetap menolak permintaan tanpa sesi. Tes untuk itu ada di
 * `nav-akun-privasi.test.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baca = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const keamananHtml = baca('../../keamanan.html');
const keamananJs = baca('../../assets/js/keamanan.js');
const klienHtml = baca('../../klien.html');
const klienJs = baca('../../assets/js/klien.js');

test('halaman profil tidak punya tab atau panel Token akses', () => {
  assert.doesNotMatch(keamananHtml, /id="tabToken"/, 'tab Token akses harus sudah dihapus');
  assert.doesNotMatch(keamananHtml, /id="panelToken"/, 'panel Token akses harus sudah dihapus');
  assert.doesNotMatch(keamananHtml, /data-panel="panelToken"/, 'navigasi ke panel token harus dihapus');
});

test('halaman profil tidak memuat wadah data token', () => {
  for (const id of ['kamTokenDaftar', 'kamTokenKosong', 'kamPesanToken']) {
    assert.doesNotMatch(keamananHtml, new RegExp(`id="${id}"`), `wadah #${id} tidak boleh ada`);
  }
});

test('skrip profil tidak memanggil /api/auth/token-saya', () => {
  // Komentar boleh menyebut nama endpoint (dokumentasi alasan penghapusan);
  // yang dilarang adalah PEMANGGILAN-nya.
  const tanpaKomentar = keamananJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(
    tanpaKomentar,
    /fetch\(\s*['"`]\/api\/auth\/token-saya/,
    'halaman profil tidak boleh mengambil metadata token',
  );
});

test('skrip profil tidak merender baris paket/cakupan token', () => {
  // Penanda isi panel lama. Kalau salah satunya kembali, panelnya ikut kembali.
  assert.doesNotMatch(keamananJs, /kamTokenDaftar|kamTokenKosong/);
  assert.doesNotMatch(keamananJs, /daftarPemuat\('panelToken'/);
});

test('endpoint token-saya tetap terdaftar di backend (untuk admin & integrasi)', () => {
  const authRoutes = baca('../src/auth-routes.mjs');
  assert.match(
    authRoutes,
    /pattern: '\/api\/auth\/token-saya'/,
    'endpoint tetap harus ada — yang dihapus hanya permukaan UI-nya',
  );
});

// ══ HALAMAN /klien (Proyek Saya) ═════════════════════════════════════════════

test('halaman /klien tidak punya tab atau panel Token akses', () => {
  assert.doesNotMatch(klienHtml, /id="tabToken"/, 'tab Token akses harus dihapus');
  assert.doesNotMatch(klienHtml, /id="panelToken"/, 'panel Token akses harus dihapus');
});

test('halaman /klien tidak memuat wadah token', () => {
  for (const id of ['klienTokenDaftar', 'klienTokenKosong', 'klienTokenSisa', 'klienBuatToken', 'klienTokenBaru']) {
    assert.doesNotMatch(klienHtml, new RegExp(`id="${id}"`), `wadah #${id} tidak boleh ada`);
  }
});

test('skrip /klien tidak memanggil endpoint token', () => {
  const tanpaKomentar = klienJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(tanpaKomentar, /\/api\/klien\/token/, 'tidak boleh memanggil API token');
  assert.doesNotMatch(tanpaKomentar, /muatToken|pasangBuatToken|renderToken/, 'fungsi token harus dihapus');
});

test('halaman /klien tetap menampilkan daftar proyek', () => {
  // Kontrol negatif: penghapusan token tidak boleh ikut menghapus proyek.
  assert.match(klienHtml, /id="panelProyek"/);
  assert.match(klienHtml, /id="klienDaftar"/);
  assert.match(klienJs, /\/api\/klien\/proyek/);
});

test('tidak ada referensi ARIA yang menggantung setelah tab dihapus', () => {
  // aria-labelledby/aria-controls yang menunjuk id tak ada membingungkan
  // pembaca layar: ia mengumumkan label yang tidak pernah ditemukan.
  for (const [nama, isi] of [['keamanan.html', keamananHtml], ['klien.html', klienHtml]]) {
    for (const m of isi.matchAll(/aria-(?:labelledby|controls)="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/).filter(Boolean)) {
        assert.match(isi, new RegExp(`id="${id}"`), `${nama}: aria menunjuk #${id} yang tidak ada`);
      }
    }
  }
});
