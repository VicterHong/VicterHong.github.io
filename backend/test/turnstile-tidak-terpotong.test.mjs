/**
 * Tes: widget Turnstile tidak boleh terpotong di layar sempit.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * Turnstile merender widget dengan lebar TETAP 300px. Opsi `size` tidak
 * menolong: `normal` 300×65, `compact` 150×140 (vertikal, mengubah bentuk),
 * `flexible` tetap 300px di dalam wadah sempit.
 *
 * Di layar 360px, kartu gerbang menyisakan 278px untuk slot. Widget 300px
 * meluber 22px dan terpotong: logo terbaca "CLOUDFLA", "Privasi" jadi
 * "Privi", "Bantuan" jadi "Bant". Di 320px kekurangannya 62px.
 *
 * ── KENAPA INI SULIT DILIHAT ────────────────────────────────────────────────
 * `place-items: center` + `overflow: hidden` memusatkan widget lalu
 * memotongnya di KEDUA sisi. Tidak ada error, tidak ada scroll horizontal —
 * widget hanya tampak "sedikit aneh", dan teks yang hilang mudah dikira
 * memang begitu.
 *
 * ── ATURAN YANG DIJAGA ──────────────────────────────────────────────────────
 *   1. Slot tidak memakai `place-items: center` bersama `overflow: hidden`
 *      tanpa jalur keluar di layar sempit
 *   2. Ada media query yang mengurangi padding kartu di bawah 380px
 *   3. Ada penanganan khusus di bawah 340px (skala / lebar mengikuti isi)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(`${ROOT}assets/css/project.css`, 'utf8');

test('ada media query yang memberi ruang untuk widget 300px', () => {
  assert.match(
    css, /@media \(max-width: 380px\)/,
    'harus ada media query <=380px yang mengurangi padding kartu — '
    + 'tanpa itu widget 300px terpotong di layar 360px',
  );
});

test('ada penanganan khusus di bawah 340px', () => {
  assert.match(
    css, /@media \(max-width: 340px\)/,
    'harus ada media query <=340px — di 320px widget 300px tidak muat sama sekali',
  );
});

test('slot di layar sangat sempit melebar mengikuti isi, bukan dipotong', () => {
  // Ambil blok media query <=340px
  const i = css.indexOf('@media (max-width: 340px)');
  assert.ok(i > -1, 'media query <=340px harus ada');
  const blok = css.slice(i, i + 900);

  assert.match(
    blok, /width:\s*max-content/,
    'slot harus width:max-content supaya lebarnya mengikuti widget — '
    + 'kalau tetap selebar kartu, widget 252px dipotong oleh overflow:hidden',
  );
  assert.match(
    blok, /overflow:\s*visible/,
    'slot harus overflow:visible di layar sempit supaya tidak memotong widget',
  );
});

test('slot normal tetap memusatkan widget di layar lebar', () => {
  assert.match(
    css, /\.gate-turnstile:not\(\[hidden\]\)[\s\S]{0,200}place-items:\s*center/,
    'di layar lebar widget harus tetap dipusatkan',
  );
});

test('tinggi minimum slot mencegah layout shift', () => {
  assert.match(
    css, /min-height:\s*65px/,
    'slot butuh min-height 65px (tinggi widget Turnstile) supaya kartu '
    + 'tidak melompat saat widget selesai dimuat',
  );
});

test('warna skema gelap dipertahankan agar widget tidak putih', () => {
  assert.match(
    css, /color-scheme:\s*dark/,
    'color-scheme:dark diperlukan supaya Turnstile memakai palet gelapnya',
  );
});
