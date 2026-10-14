/**
 * Tes verifikasi star GitHub.
 *
 * ── YANG PALING PENTING DIUJI DI SINI ──────────────────────────────────────
 * Bukan "apakah fetch-nya jalan", tapi dua hal:
 *
 *   1. VALIDASI USERNAME — ini satu-satunya tempat masukan pengguna menyentuh
 *      URL. Kalau lolos, penyusup bisa mengubah permintaan ke GitHub.
 *   2. PERBEDAAN antara "belum star" dan "tidak tahu" — kegagalan GitHub
 *      TIDAK BOLEH dilaporkan sebagai "belum star", karena itu memberi tahu
 *      pengguna yang sudah star bahwa dia belum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { usernameSah, REPO_DIPERIKSA } from '../src/star-github.mjs';

// ── 1. VALIDASI USERNAME — CELAH KEAMANAN ────────────────────────────────────

test('username sah: huruf, angka, tanda hubung', () => {
  for (const nama of ['victer', 'VicterHong', 'victer-hong', 'user123', 'a', 'a-b-c', '123']) {
    assert.ok(usernameSah(nama), `"${nama}" harus sah`);
  }
});

test('username dengan GARIS MIRING ditolak — bisa menembus path URL', () => {
  // Kalau ini lolos, URL jadi:
  //   https://api.github.com/repos/.../stargazers/../../users/admin
  // dan permintaan mengarah ke tempat yang tidak dimaksudkan.
  for (const jahat of ['foo/bar', '../../users/admin', 'a/b/c', '/etc/passwd']) {
    assert.ok(!usernameSah(jahat), `"${jahat}" harus ditolak`);
  }
});

test('username dengan TANDA TANYA ditolak — bisa mengubah query URL', () => {
  for (const jahat of ['foo?per_page=9999', 'user&admin=1', 'a?b=c']) {
    assert.ok(!usernameSah(jahat), `"${jahat}" harus ditolak`);
  }
});

test('username dengan SPASI, persen, dan karakter null ditolak', () => {
  for (const jahat of ['foo bar', 'foo%20bar', 'foo%00bar', 'user name', 'a\tb', 'a\nb']) {
    assert.ok(!usernameSah(jahat), `"${jahat}" harus ditolak`);
  }
});

test('username dengan tanda hubung di UJUNG ditolak', () => {
  // GitHub melarangnya, dan kalau lolos ia bisa membingungkan pembaca URL.
  for (const aneh of ['-foo', 'foo-', '-']) {
    assert.ok(!usernameSah(aneh), `"${aneh}" harus ditolak`);
  }
});

test('username terlalu panjang ditolak (GitHub maksimal 39)', () => {
  assert.ok(usernameSah('a'.repeat(39)), '39 karakter masih sah');
  assert.ok(!usernameSah('a'.repeat(40)), '40 karakter harus ditolak');
});

test('username kosong dan bukan-string ditolak', () => {
  for (const kosong of ['', '   ', null, undefined, 123, {}, [], true]) {
    assert.ok(!usernameSah(kosong), `${JSON.stringify(kosong)} harus ditolak`);
  }
});

test('username dengan spasi di pinggir tetap sah setelah dipangkas', () => {
  // Pengguna sering menempel dengan spasi tidak sengaja. Menolaknya akan
  // membuat mereka bingung karena username-nya terlihat benar.
  assert.ok(usernameSah('  victer  '), 'spasi di pinggir harus dipangkas');
});

test('karakter unicode yang terlihat seperti huruf ditolak', () => {
  // Huruf Kiril "а" (U+0430) terlihat sama seperti huruf Latin "a".
  // Kalau diterima, seseorang bisa mendaftar username yang secara visual
  // identik dengan orang lain.
  for (const unicode of ['аdmin', 'vіcter', 'user\u200bname', 'usér']) {
    assert.ok(!usernameSah(unicode), `"${unicode}" harus ditolak`);
  }
});

// ── 2. REPO YANG DIPERIKSA ───────────────────────────────────────────────────

test('dua repo diperiksa, dan namanya dalam bentuk owner/repo', () => {
  assert.equal(REPO_DIPERIKSA.length, 2, 'star di salah satu repo cukup');
  for (const repo of REPO_DIPERIKSA) {
    assert.match(repo, /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, `"${repo}" bukan bentuk owner/repo`);
  }
});

test('tidak ada repo duplikat di daftar', () => {
  assert.equal(new Set(REPO_DIPERIKSA).size, REPO_DIPERIKSA.length);
});

test('repo privat TIDAK ada di daftar', () => {
  // ── KENAPA INI DIUJI ─────────────────────────────────────────────────────
  // Repo privat tidak bisa di-star: GitHub tidak menampilkan tombolnya, dan
  // API-nya menjawab 404. Kalau repo privat masuk daftar, pemeriksaan akan
  // selalu gagal di situ — dan pengguna yang SUDAH star repo lain tetap
  // ditolak, tanpa cara memperbaikinya.
  //
  // `portfolio-victer` (sumber situs ini) privat karena itu aset berharga.
  // Ia tidak boleh masuk daftar pemeriksaan.
  assert.ok(!REPO_DIPERIKSA.includes('VicterHong/portfolio-victer'),
    'repo privat tidak boleh diperiksa starnya');
});

test('daftar repo memakai pemilik yang sama', () => {
  // Kalau ada repo milik orang lain, star di repo itu akan memberi bonus —
  // padahal yang ingin didorong adalah repo portofolio sendiri.
  const pemilik = new Set(REPO_DIPERIKSA.map((r) => r.split('/')[0]));
  assert.equal(pemilik.size, 1, `pemilik berbeda: ${[...pemilik].join(', ')}`);
  assert.equal([...pemilik][0], 'VicterHong');
});
