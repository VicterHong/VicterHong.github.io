/**
 * Pasang monogram VIVASTIC di halaman yang tidak memuat app.js.
 *
 * ── SEJARAH BERKAS INI ───────────────────────────────────────────────────────
 * Versi pertama memasang logo `{ }` animasi dari logo.js. Logo itu sudah
 * diganti monogram statis — lihat monogram.js untuk alasannya (ringkasnya:
 * kurung kurawal adalah metafora coding yang dipakai di hampir semua template
 * portofolio, sehingga justru terlihat seperti template, bukan identitas).
 *
 * Berkas ini tetap ada sebagai titik pemasangan tunggal, supaya halaman hanya
 * perlu memuat satu skrip kecil alih-alih seluruh bundel app.js (yang berisi
 * cinematic scroll, spotlight carousel, media loader — puluhan KB yang tidak
 * dipakai halaman harga atau halaman masuk).
 *
 * ── DUA KELAS, SATU MONOGRAM ─────────────────────────────────────────────────
 * Situs memakai dua nama kelas untuk tempat yang sama:
 *
 *   .brand-mark      → header situs (home, pricing, docs, privasi, syarat)
 *   .auth-nav-mark   → header halaman auth (sign-in, sign-up)
 *
 * Keduanya diganti supaya identitasnya benar-benar sama di seluruh situs.
 *
 * ── KENAPA type="module" ────────────────────────────────────────────────────
 * monogram.js memakai `export`. Modul juga otomatis deferred — skrip berjalan
 * setelah HTML selesai diparse, jadi mark pasti sudah ada di DOM.
 *
 * Kalau elemennya tidak ditemukan (mis. halaman tanpa header), fungsi pasang
 * keluar diam-diam — tidak ada error yang bocor ke konsol pengunjung.
 */

import { pasangMonogram } from './monogram.js';

pasangMonogram('.brand-mark');
pasangMonogram('.auth-nav-mark');
