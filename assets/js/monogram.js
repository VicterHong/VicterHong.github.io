/**
 * Logo VIVASTIC — dari icon "Vic's Private HQ".
 *
 * ── ASAL USUL ───────────────────────────────────────────────────────────────
 * Icon ini diambil dari server Discord "Vic's Private HQ" (guild 1462563643760836610)
 * lewat Discord REST API, pada resolusi maksimum yang tersedia (256×256).
 *
 * Bentuknya: huruf V dari pita geometris berwarna emas (#f8bb25) di atas latar
 * gelap (#0e1116). Bukan gambar metaforis — ini inisial, dan itu yang membuatnya
 * bekerja sebagai identitas.
 *
 * ── SEJARAH: KENAPA BUKAN `{ }` DAN BUKAN MONOGRAM BUATAN SENDIRI ───────────
 * Versi pertama logo situs ini adalah kurung kurawal `{ }` beranimasi. Itu
 * metafora coding yang dipakai di hampir setiap template portofolio developer —
 * bentuknya tidak membawa informasi apa pun tentang VIVASTIC, sehingga justru
 * terlihat seperti template yang belum diganti.
 *
 * Versi kedua adalah monogram VV yang digambar manual. Lebih baik, tapi tetap
 * ada masalah: dua V yang bertemu di tengah terbaca sebagai satu bentuk X.
 *
 * Versi ketiga (ini): icon yang SUDAH ADA dan sudah dipakai. Bentuknya dibuat
 * untuk server ini, dan sudah terbukti terbaca di ukuran kecil (Discord
 * menampilkannya 32px di daftar server). Tidak ada yang perlu ditebak.
 *
 * ── KENAPA BITMAP, BUKAN SVG PATH ───────────────────────────────────────────
 * Idealnya logo adalah path SVG — tajam di ukuran apa pun dan bisa diwarnai
 * lewat CSS. Tapi menjiplak bentuk ini jadi path manual berarti menebak
 * koordinat setiap sudut, dan hasilnya hampir pasti berbeda dari aslinya.
 *
 * Icon 256×256 ditampilkan pada 28px di header. Layar retina (2×) memakai
 * 56px dari 256px yang tersedia — oversample ~4,5×. Pada rasio itu, bitmap
 * dan vektor tidak bisa dibedakan mata.
 *
 * ── EFEK: GLOW HALUS, BUKAN ANIMASI ─────────────────────────────────────────
 * Yang ditambahkan hanya dua hal:
 *
 *   1. Glow lembut (drop-shadow) — memisahkan logo dari latar gelap dan
 *      memberi kesan "menyala" seperti panel instrumen. Statis.
 *
 *   2. Umpan balik hover — glow sedikit menguat saat kursor menyentuh.
 *      Satu-satunya perubahan, dan hanya pada intensitas, bukan bentuk.
 *
 * Logo korporat tidak berputar, tidak berkedip, tidak menari. Efek yang
 * mengubah BENTUK saat interaksi adalah tanda identitas yang belum matang.
 */

const ASET_LOGO = 'assets/brand-vics.png';

/**
 * Buat elemen logo sebagai <img>.
 *
 * @param {number} ukuran - tinggi dalam px (default 28)
 * @returns {HTMLImageElement}
 */
export function buatLogo(ukuran = 28) {
  const img = document.createElement('img');

  img.src = ASET_LOGO;
  img.alt = '';                          // teks brand di sebelahnya sudah cukup
  img.width = ukuran;
  img.height = ukuran;
  img.className = 'brand-logo';
  img.decoding = 'async';
  img.loading = 'eager';                 // logo harus muncul segera

  // ── Fallback kalau gambar gagal dimuat ────────────────────────────────────
  // Bukan penanganan error yang rumit — hanya memastikan header tidak
  // menyisakan kotak kosong kalau asetnya hilang. Logo yang hilang lebih
  // buruk daripada logo yang diganti inisial teks.
  img.addEventListener('error', () => {
    const cadangan = document.createElement('span');
    cadangan.className = 'brand-logo-cadangan';
    cadangan.textContent = 'V';
    cadangan.setAttribute('aria-hidden', 'true');
    img.replaceWith(cadangan);
  }, { once: true });

  return img;
}

/**
 * Ganti elemen mark statis dengan logo.
 *
 * Aman dipanggil berkali-kali — kalau elemennya tidak ada, keluar diam-diam.
 * Itu penting karena halaman yang berbeda punya header yang berbeda.
 *
 * @param {string} selector - selektor elemen yang akan diganti
 */
export function pasangLogo(selector = '.brand-mark') {
  const elemen = document.querySelectorAll(selector);
  if (!elemen.length) return;

  // Instance terpisah untuk tiap tempat — node yang sama tidak bisa berada
  // di dua lokasi DOM sekaligus.
  for (const el of elemen) {
    el.replaceWith(buatLogo());
  }
}

/* ── NAMA LAMA, UNTUK KOMPATIBILITAS ─────────────────────────────────────────
   Beberapa berkas masih memanggil pasangMonogram(). Alih-alih menyunting
   setiap pemanggil (dan berisiko melewatkan satu), nama lamanya tetap
   diekspor sebagai alias. Satu tempat perubahan, tidak ada yang rusak. */
export const pasangMonogram = pasangLogo;
