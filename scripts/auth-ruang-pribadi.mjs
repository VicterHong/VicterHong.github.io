/**
 * Ubah header halaman auth jadi "ruang pribadi": logo saja, tanpa navigasi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── PERMINTAAN PENGGUNA ─────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   "Hilangin kembali ke halaman masuk semua kosong kecuali logo tapi ga bisa
 *    diklik ke website karena itu macam ruang pribadi"
 *
 * ── KENAPA INI KEPUTUSAN DESAIN YANG BENAR ──────────────────────────────────
 *
 * Halaman autentikasi (masuk, daftar, lupa sandi, reset sandi) adalah
 * RUANG PRIBADI. Pengguna yang sedang di sana:
 *
 *   • sedang login — mereka butuh fokus pada satu tugas
 *   • mungkin sedang panik (lupa sandi)
 *   • mungkin di perangkat orang lain (warnet, kantor)
 *
 * Navigasi seperti "Beranda / Harga / Panduan / Changelog / Kontak" mengundang
 * mereka KELUAR dari alur. Satu klik tidak sengaja, dan mereka kehilangan
 * progres — di halaman daftar, itu berarti mengisi ulang seluruh form.
 *
 * ── BAGAIMANA PRODUK BESAR MELAKUKANNYA ─────────────────────────────────────
 *
 *   • Stripe (dashboard.stripe.com/login)  → hanya logo, tanpa nav
 *   • Linear (linear.app/login)             → hanya logo, tanpa nav
 *   • Vercel (vercel.com/login)             → hanya logo, tanpa nav
 *   • GitHub (github.com/login)             → hanya logo, tanpa nav
 *   • Google (accounts.google.com)          → hanya logo, tanpa nav
 *
 * Tidak ada satu pun yang menampilkan menu pemasaran di halaman login.
 * Alasannya bukan estetika — itu keputusan produk: halaman auth adalah
 * pintu, bukan ruang pamer.
 *
 * ── KENAPA LOGO TIDAK BOLEH DIKLIK ──────────────────────────────────────────
 *
 * Di halaman publik, logo yang bisa diklik adalah konvensi baik (pulang ke
 * beranda). Di halaman auth, itu justru JEBAKAN: pengguna yang tidak sengaja
 * menyentuhnya akan meninggalkan form dan kehilangan isinya.
 *
 * Logo tetap ditampilkan sebagai identitas — pengguna harus tahu mereka
 * sedang di situs yang benar. Tapi ia jadi elemen visual, bukan pintu keluar.
 *
 * ── KENAPA LOGO TETAP ADA ───────────────────────────────────────────────────
 *
 * Menghapus logo sepenuhnya akan membuat halaman terasa "milik siapa pun" —
 * dan itu masalah keamanan nyata: halaman login palsu terlihat sama saja.
 * Logo adalah penanda identitas yang memberi pengguna keyakinan.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HALAMAN = [
  'sign-in.html',
  'sign-up.html',
  'reset-sandi.html',
  'lupa-sandi.html',
  'keamanan.html',   // halaman profil — juga ruang pribadi
];

// ── POLA HEADER LAMA ─────────────────────────────────────────────────────────
//
// Dua bentuk header lama ada di proyek ini:
//
//   <header class="auth-nav"> ... </header>   → halaman auth (sign-in dll)
//   <nav class="auth-nav"> ... </nav>         → halaman profil (keamanan.html)
//
// Versi pertama skrip ini hanya menangkap <header>. Akibatnya keamanan.html
// TERLEWAT: halaman profil tetap menampilkan link "Beranda" dan brand yang
// bisa diklik — satu-satunya halaman yang belum jadi ruang pribadi.
//
// Regex menangkap KEDUANYA. Non-greedy supaya berhenti di penutup pertama —
// keamanan.html punya <nav> lain di dalam panel (daftar tab), dan itu tidak
// boleh tersentuh.
const POLA_HEADER = /<(?:header|nav) class="auth-nav">[\s\S]*?<\/(?:header|nav)>/;

// Header baru: logo saja, tidak bisa diklik.
const HEADER_BARU = (label) => `<!--
  ══════════════════════════════════════════════════════════════════════════════
  ── KEPALA: LOGO SAJA, TANPA NAVIGASI ────────────────────────────────────────
  ══════════════════════════════════════════════════════════════════════════════

  ── KENAPA TIDAK ADA MENU (Beranda / Harga / Panduan) ────────────────────────
  Halaman ini adalah RUANG PRIBADI. Pengguna yang sedang ${label}:

    • butuh fokus pada satu tugas
    • mungkin sedang panik (kalau lupa sandi)
    • mungkin memakai perangkat orang lain

  Menu navigasi mengundang mereka KELUAR dari alur. Satu klik tidak sengaja
  di halaman daftar berarti mengisi ulang seluruh form.

  Lima produk besar memakai pola yang sama — tidak satu pun menampilkan menu
  pemasaran di halaman login:
    Stripe · Linear · Vercel · GitHub · Google

  ── KENAPA LOGO TIDAK BISA DIKLIK ────────────────────────────────────────────
  Di halaman publik, logo yang bisa diklik adalah konvensi baik (pulang ke
  beranda). Di sini itu JEBAKAN: pengguna yang tidak sengaja menyentuhnya
  akan meninggalkan form dan kehilangan isinya.

  Logo tetap ada sebagai identitas — pengguna harus tahu mereka di situs yang
  benar. Tapi ia elemen visual, bukan pintu keluar.

  ── KENAPA PAKAI <div>, BUKAN <a> TANPA href ─────────────────────────────────
  <a> tanpa href tidak fokusabel dan tidak diumumkan sebagai tautan — jadi
  secara teknis sudah "tidak bisa diklik". Tapi memakai <a> untuk elemen yang
  bukan tautan adalah markup yang menyesatkan: pembaca kode akan mengira ada
  navigasi yang hilang.

  <div> menyatakan maksudnya dengan jujur: ini bukan tautan, ini identitas.
-->
<header class="auth-nav auth-nav-polos">
  <div class="auth-nav-brand" role="img" aria-label="VIVASTIC">
    <span class="auth-nav-mark" aria-hidden="true"></span>
    <span>VIVASTIC</span>
  </div>
</header>`;

let jumlah = 0;

for (const berkas of HALAMAN) {
  if (!existsSync(berkas)) {
    console.log(`  ⚠️  ${berkas} tidak ada — dilewati`);
    continue;
  }

  const isi = readFileSync(berkas, 'utf8');

  // ── SUDAH RUANG PRIBADI? ───────────────────────────────────────────────────
  // Skrip ini idempoten: halaman yang sudah ditransformasi dilewati dengan
  // pesan jelas, bukan peringatan "pola tidak ditemukan" yang menyesatkan.
  if (isi.includes('auth-nav-polos')) {
    console.log(`  ✅ ${berkas} — sudah ruang pribadi, dilewati`);
    continue;
  }

  const cocok = isi.match(POLA_HEADER);

  if (!cocok) {
    console.log(`  ⚠️  ${berkas}: pola header tidak ditemukan`);
    continue;
  }

  // Tentukan label untuk komentar, sesuai jenis halaman.
  const label = berkas.startsWith('sign-in') ? 'masuk'
    : berkas.startsWith('sign-up') ? 'mendaftar'
    : berkas.startsWith('reset-sandi') ? 'mengganti sandi'
    : berkas.startsWith('lupa-sandi') ? 'memulihkan akses'
    : berkas.startsWith('keamanan') ? 'mengelola profil'
    : 'memakai akun';

  const baru = isi.replace(POLA_HEADER, HEADER_BARU(label));
  writeFileSync(berkas, baru, 'utf8');
  jumlah += 1;

  // Verifikasi: hitung sisa link navigasi
  const sisaNav = (baru.match(/auth-nav-links/g) ?? []).length;
  const sisaBrandLink = (baru.match(/<a class="auth-nav-brand"/g) ?? []).length;
  console.log(`  ✅ ${berkas} — nav-links: ${sisaNav}, brand-link: ${sisaBrandLink}`);
}

console.log('');
console.log(`  ${jumlah}/${HALAMAN.length} halaman diperbarui`);
