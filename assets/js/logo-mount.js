/**
 * Pasang logo interaktif di halaman yang TIDAK memuat app.js.
 *
 * ── KENAPA BERKAS INI ADA ────────────────────────────────────────────────────
 * Logo animasi (kurung `{ }` yang membuka saat hover, berputar saat klik,
 * kursor berkedip) tinggal di logo.js. Selama ini hanya home.html yang
 * memakainya — karena app.js mengimpornya, dan app.js hanya dimuat di beranda.
 *
 * Akibatnya halaman lain menampilkan mark statis: kotak kuning kecil tanpa
 * animasi. Dua tampilan berbeda untuk elemen yang sama membuat situs terasa
 * tidak konsisten.
 *
 * ── DUA KELAS, SATU LOGO ─────────────────────────────────────────────────────
 * Situs memakai dua nama kelas untuk mark yang sama:
 *
 *   .brand-mark      → header situs (home, pricing, docs, privasi, syarat)
 *   .auth-nav-mark   → header halaman auth (masuk, daftar)
 *
 * Keduanya diganti supaya logonya benar-benar sama di seluruh situs.
 *
 * ── KENAPA TIDAK MEMUAT app.js SAJA ─────────────────────────────────────────
 * app.js adalah bundel beranda: cinematic scroll, spotlight carousel, media
 * loader, tilt panel — puluhan kilobyte yang tidak dipakai halaman harga.
 * Memuatnya berarti mengirim kode mati hanya untuk mengambil satu fungsi.
 *
 * Berkas ini mengimpor logo.js langsung — hanya kode yang benar-benar jalan.
 *
 * ── KENAPA type="module" ────────────────────────────────────────────────────
 * logo.js memakai `export`. Modul juga otomatis deferred — skrip berjalan
 * setelah HTML selesai diparse, jadi mark pasti sudah ada di DOM.
 *
 * Kalau elemennya tidak ditemukan (mis. halaman tanpa header), fungsi mount
 * keluar diam-diam — tidak ada error yang bocor ke konsol pengunjung.
 */

import { mountInteractiveLogo } from './logo.js';

mountInteractiveLogo('.brand-mark');
mountInteractiveLogo('.auth-nav-mark');
