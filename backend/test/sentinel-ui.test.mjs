/**
 * Tes: setiap id yang dipakai sentinel.js harus ada di sentinel.html.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * `$('#sesuatu')` yang tidak menemukan elemennya mengembalikan null, dan
 * `.textContent = ...` pada null melempar TypeError yang MENGHENTIKAN seluruh
 * skrip. Gejalanya: halaman tampak kosong tanpa penjelasan apa pun.
 *
 * Pemeriksaan statis menangkapnya sebelum ada yang membuka halamannya — dan
 * tetap bekerja di lingkungan tanpa browser, tempat tes UI sungguhan tidak bisa
 * dijalankan.
 *
 * ── KENAPA MEMERIKSA NAMA KELAS JUGA ────────────────────────────────────────
 * Kelas yang dibuat JS tapi tidak ada di CSS tidak melempar error — tampilannya
 * hanya diam-diam salah (tanpa warna, tanpa jarak). Itu jenis kesalahan yang
 * paling lama tidak ketahuan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', 'public');

const html = readFileSync(join(AKAR, 'sentinel.html'), 'utf8');
const js = readFileSync(join(AKAR, 'assets', 'js', 'sentinel.js'), 'utf8');
const css = readFileSync(join(AKAR, 'assets', 'css', 'sentinel.css'), 'utf8');

/* ── ID ─────────────────────────────────────────────────────────────────── */

test('setiap id yang dipakai JS ada di HTML', () => {
  const polaId = /\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g;
  const dipakai = [...new Set([...js.matchAll(polaId)].map((m) => m[1]))];

  assert.ok(dipakai.length > 0, 'tidak ada selector id yang terbaca — pola pemeriksaan rusak?');

  const hilang = dipakai.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(hilang, [], `id ini dipakai JS tapi tidak ada di HTML: ${hilang.join(', ')}`);
});

/* ── Kelas ──────────────────────────────────────────────────────────────── */

test('setiap kelas yang dibuat JS punya gaya di CSS', () => {
  // Cocokkan el('div', 'kelas', ...) — argumen kedua.
  const polaKelas = /el\(\s*'[a-z]+'\s*,\s*'([^']+)'/g;
  const dibuat = [...new Set(
    [...js.matchAll(polaKelas)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean),
  )];

  assert.ok(dibuat.length > 0, 'tidak ada kelas yang terbaca — pola pemeriksaan rusak?');

  const tanpaGaya = dibuat.filter((k) => !css.includes(`.${k}`));
  assert.deepEqual(tanpaGaya, [], `kelas ini dibuat JS tapi tidak ada di CSS: ${tanpaGaya.join(', ')}`);
});

test('setiap kelas yang dibuat JS juga punya gaya di CSS', () => {
  // Kelas status lencana dibuat lewat template, jadi tidak tertangkap pola
  // `el(...)`. Diperiksa terpisah supaya tidak ada yang lolos.
  const status = ['menunggu', 'dikirim', 'dlq', 'tertutup', 'terbuka', 'setengah'];
  const hilang = status.filter((s) => !css.includes(`.sentinel-lencana--${s}`));
  assert.deepEqual(hilang, [], `lencana tanpa gaya: ${hilang.join(', ')}`);
});

/* ── Aset yang dirujuk HTML ─────────────────────────────────────────────── */

test('aset yang dirujuk HTML benar-benar ada di disk', () => {
  const rujukan = [...new Set(
    [...html.matchAll(/(?:href|src)="(\/sentinel-assets\/[^"]+)"/g)].map((m) => m[1]),
  )];

  assert.ok(rujukan.length > 0, 'HTML tidak merujuk aset apa pun');

  for (const r of rujukan) {
    const jalur = join(AKAR, 'assets', r.replace('/sentinel-assets/', ''));
    assert.doesNotThrow(() => readFileSync(jalur), `aset tidak ada: ${r} → ${jalur}`);
  }
});

/* ── Berkas rahasia tidak boleh dirujuk halaman publik ──────────────────── */

test('HTML tidak merujuk berkas dari /assets/ publik', () => {
  // ── KENAPA DIPERIKSA ─────────────────────────────────────────────────────
  // /assets/ adalah direktori publik Cloudflare Pages. Kalau inspector merujuk
  // ke sana, asetnya ikut ter-deploy dan bisa diunduh siapa pun.
  //
  // Halaman ini hanya boleh memakai /sentinel-assets/, yang disajikan server
  // dari loopback saja.
  //
  // ── PENGECUALIAN ─────────────────────────────────────────────────────────
  // Berkas ini memang publik dan dipakai SEMUA halaman situs:
  //   cf-gate.css, main.css  → gaya bersama
  //   favicon-*.png, site.webmanifest, favicon.svg → ikon tab
  //
  // Tidak ada yang bocor dengan merujuknya — isinya sudah bisa diunduh siapa
  // pun lewat halaman utama. Yang tidak boleh adalah aset KHUSUS inspector.
  const PUBLIK_BOLEH = [
    'cf-gate.css',
    'main.css',
    'favicon.svg',
    'favicon-32.png',
    'favicon-180.png',
    'site.webmanifest',
  ];

  const rujukanPublik = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((r) => !PUBLIK_BOLEH.some((boleh) => r.endsWith(boleh)));

  assert.deepEqual(rujukanPublik, [], `HTML merujuk aset publik: ${rujukanPublik.join(', ')}`);
});

/* ── Header keamanan ada di HTML ────────────────────────────────────────── */

test('halaman tidak diindeks mesin pencari', () => {
  assert.match(html, /name="robots"[^>]*noindex/, 'halaman tanpa noindex akan muncul di pencarian');
});
