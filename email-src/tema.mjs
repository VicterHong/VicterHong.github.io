/**
 * Tema warna email — VIVASTIC (brand) dan GITHUB (referensi).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DUA TEMA, BUKAN SATU ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Desain email yang baik bukan soal "mana yang lebih bagus", tapi "mana yang
 * cocok untuk konteksnya":
 *
 *   • BRAND   — email pemasaran, sambutan, struk. Warna emas VIVASTIC
 *               memberi identitas. Ini yang dipakai secara bawaan.
 *
 *   • GITHUB  — email notifikasi teknis (aktivitas token, peringatan sistem,
 *               log keamanan). Nada netral-abu GitHub lebih cocok: terbaca
 *               seperti laporan sistem, bukan promosi.
 *
 * Dengan dua tema, jenis email bisa memilih nada yang tepat — tanpa
 * menduplikasi template.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── NILAI GITHUB DIAMBIL DARI SUMBER RESMI ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Dari paket `@primer/primitives` v11.10.0 (design system GitHub, MIT):
 * diambil dengan `npm pack` lalu membaca `dist/internalCss/dark.css` dan
 * nilai `--base-color-neutral-*`.
 *
 * Ini bukan perkiraan dari screenshot — angkanya persis seperti yang dipakai
 * GitHub di tema gelapnya.
 *
 *   neutral-1  #0d1117  → canvas default (latar paling dalam)
 *   neutral-2  #151b23  → canvas subtle (kartu)
 *   neutral-3  #212830  → border muted / inset
 *   neutral-4  #262c36  → border default
 *   neutral-5  #2a313c  → border emphasis
 *   neutral-10 #b7bdc8  → teks muted
 *   neutral-12 #f0f6fc  → teks default
 */

// ══════════════════════════════════════════════════════════════════════════════
// ── TEMA 1: VIVASTIC (brand) ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Kanvas sedikit hangat (bukan hitam murni) supaya terasa seperti material.
// Aksen emas dipakai hemat: hanya tombol utama dan satu garis di tepi kartu.
export const TEMA_VIVASTIC = {
  nama: 'vivastic',

  // Tangga permukaan
  kanvas: '#08080a',
  latar: '#0a0a0b',
  permukaan1: '#111113',
  permukaan2: '#16161a',
  permukaan3: '#1c1c21',
  kartuLembut: '#111113',

  // Garis rambut
  garisHalus: '#1a1a1f',
  garisLembut: '#232329',
  garis: '#2e2e36',

  // Teks
  teks: '#f5f5f7',
  teksRedup: '#a8a8b3',
  teksSamar: '#9d9da8',
  teksBisu: '#6e6e78',

  // Aksen
  aksen: '#f5c542',
  aksenTerang: '#ffd970',
  aksenGelap: '#c9a02c',
  emas: '#f5c542',
  emasTerang: '#ffd970',
  emasGelap: '#c9a02c',

  // Semantik
  hijau: '#34d399',
  merah: '#f87171',

  // Khusus: gradient atmosferik di latar atas (rgba)
  atmosferik: 'rgba(245,197,66,0.07)',
  atmosferikTengah: 'rgba(245,197,66,0.02)',

  // Khusus: warna teks di atas tombol aksen
  teksDiAtasAksen: '#0a0a0b',
};

// ══════════════════════════════════════════════════════════════════════════════
// ── TEMA 2: GITHUB (netral) ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// ── APA YANG MEMBUAT GITHUB TERASA "GITHUB" ─────────────────────────────────
//
// 1. Latar #0d1117 — biru-abu sangat gelap, BUKAN hitam. Ini warna kanvas
//    GitHub yang paling dikenali.
//
// 2. TIDAK ADA aksen berwarna. Semua hierarki dibangun dari tingkat abu.
//    Tombol utama memakai hijau GitHub (#238636) — satu-satunya warna.
//
// 3. Border SELALU ada dan terlihat (#30363d). GitHub tidak memakai
//    gradient atau glow; batas antar elemen dinyatakan dengan garis.
//
// 4. Teks muted #8b949e untuk keterangan — kontrasnya lebih rendah dari
//    brand, memberi kesan "dokumentasi" bukan "promosi".
export const TEMA_GITHUB = {
  nama: 'github',

  // Tangga permukaan (nilai asli Primer)
  kanvas: '#010409',        // paling dalam (GitHub pakai ini untuk area luar)
  latar: '#0d1117',         // canvas default — warna ikonik GitHub
  permukaan1: '#151b23',    // canvas subtle
  permukaan2: '#0d1117',    // kartu = canvas (GitHub tidak "menaikkan" kartu)
  permukaan3: '#212830',    // inset
  kartuLembut: '#151b23',

  // Garis (GitHub selalu punya border yang terlihat)
  garisHalus: '#21262d',
  garisLembut: '#30363d',
  garis: '#30363d',

  // Teks (nilai Primer)
  teks: '#f0f6fc',          // neutral-12
  teksRedup: '#b7bdc8',     // neutral-10
  teksSamar: '#8b949e',     // fgColor-muted
  teksBisu: '#6e7681',      // fgColor-subtle

  // Aksen — GitHub hijau (bukan emas)
  aksen: '#238636',         // bgColor-open-emphasis
  aksenTerang: '#2ea043',
  aksenGelap: '#1a7f37',
  emas: '#238636',          // nama lama dipertahankan supaya template tetap jalan
  emasTerang: '#2ea043',
  emasGelap: '#1a7f37',

  // Semantik (nilai Primer)
  hijau: '#3fb950',
  merah: '#f85149',

  // GitHub TIDAK memakai gradient atmosferik — latarnya rata
  atmosferik: 'rgba(0,0,0,0)',
  atmosferikTengah: 'rgba(0,0,0,0)',

  teksDiAtasAksen: '#ffffff',
};

/** Tema bawaan kalau tidak disebutkan. */
export const TEMA_BAWAAN = TEMA_VIVASTIC;

/** Daftar tema yang tersedia — untuk diagnosa. */
export const TEMA_TERSEDIA = {
  vivastic: TEMA_VIVASTIC,
  github: TEMA_GITHUB,
};

/** Ambil tema berdasarkan nama; jatuh ke bawaan kalau tidak dikenal. */
export function ambilTema(nama) {
  return TEMA_TERSEDIA[nama] ?? TEMA_BAWAAN;
}
