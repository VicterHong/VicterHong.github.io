/**
 * Monogram VIVASTIC — pengganti logo `{ }` animasi.
 *
 * ── KENAPA LOGO LAMA DIGANTI ────────────────────────────────────────────────
 * Logo sebelumnya adalah kurung kurawal `{ }` dengan kursor berkedip, yang
 * membuka saat hover dan berputar saat diklik.
 *
 * Masalahnya bukan tekniknya — semuanya berfungsi. Masalahnya adalah MAKNA:
 * kurung kurawal adalah metafora "coding" yang dipakai di hampir setiap
 * portofolio developer, template starter, dan proyek latihan. Bentuknya tidak
 * membawa informasi apa pun tentang VIVASTIC.
 *
 * Efeknya justru terbalik: alih-alih terlihat seperti perusahaan, ia terlihat
 * seperti template yang belum diganti. Itu definisi "AI slop" secara visual.
 *
 * ── YANG DIPAKAI SEBAGAI GANTI ──────────────────────────────────────────────
 * Monogram. Ini pola tertua dan paling teruji dalam identitas korporat —
 * IBM, GE, HP, 3M, Louis Vuitton, Chanel semuanya memakai inisial, bukan
 * gambar metaforis.
 *
 * Alasannya: monogram hanya bisa dibuat setelah Anda tahu nama apa yang
 * diwakilinya. Ia tidak bisa diambil dari template. Itu yang membuatnya
 * terasa seperti identitas, bukan dekorasi.
 *
 * ── BENTUKNYA ───────────────────────────────────────────────────────────────
 * Dua huruf V bertumpuk secara VERTIKAL — bukan bersilangan. Ini perbedaan
 * penting yang ditemukan lewat pengujian visual:
 *
 *   Percobaan pertama: dua V berlawanan yang ujungnya BERTEMU di tengah
 *   (M10 10 L16 17 L22 10  +  M10 22 L16 15 L22 22)
 *
 *   Hasilnya: kedua V menyatu menjadi satu bentuk X/silang. Mata membacanya
 *   sebagai "X" atau tanda silang — bukan "VV". Konsepnya ada di kode, tapi
 *   tidak sampai ke mata.
 *
 *   Perbaikan: kedua V DIPISAH dengan celah vertikal. V atas lebih kecil dan
 *   duduk di atas; V bawah lebih besar dan membuka ke bawah. Dengan celah di
 *   antaranya, masing-masing terbaca sebagai huruf tersendiri.
 *
 * Pelajaran yang berlaku umum untuk monogram: kalau dua huruf digabung, uji
 * apakah keduanya MASIH TERBACA sebagai huruf. Monogram yang hanya indah di
 * kepala perancangnya, tapi terbaca sebagai bentuk lain oleh orang lain,
 * gagal pada tugas utamanya.
 *
 * ── KENAPA STATIS ───────────────────────────────────────────────────────────
 * Logo korporat tidak berputar, tidak berkedip, dan tidak menari saat disentuh.
 * Ia diam. Yang bergerak hanyalah umpan balik halus saat kursor menyentuh
 * (perubahan warna), dan itu pun opsional.
 *
 * Animasi pada logo adalah tanda identitas yang belum matang — perusahaan
 * yang sudah mapan tidak perlu menghibur pengunjung dengan logonya.
 */

/**
 * Buat elemen monogram sebagai SVG.
 * @param {number} ukuran - tinggi dalam px (default 26)
 * @returns {SVGElement}
 */
export function buatMonogram(ukuran = 26) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');

  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(ukuran));
  svg.setAttribute('height', String(ukuran));
  svg.setAttribute('class', 'brand-monogram');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'VIVASTIC');
  svg.setAttribute('fill', 'none');

  // ── Belah ketupat luar ────────────────────────────────────────────────────
  // Garis tipis sebagai bingkai. Memberi bentuk yang jelas saat monogram
  // ditempatkan di latar gelap, tanpa perlu blok warna solid yang berat.
  const bingkai = document.createElementNS(NS, 'path');
  bingkai.setAttribute('d', 'M16 2 L30 16 L16 30 L2 16 Z');
  bingkai.setAttribute('class', 'monogram-bingkai');
  bingkai.setAttribute('stroke', 'currentColor');
  bingkai.setAttribute('stroke-width', '1.25');
  bingkai.setAttribute('stroke-linejoin', 'round');

  // ── Huruf V atas ──────────────────────────────────────────────────────────
  // Lebih kecil, duduk di bagian atas belah ketupat. Ujungnya berhenti di
  // y=13 — menyisakan celah 2px sebelum V bawah mulai di y=15.
  const vAtas = document.createElementNS(NS, 'path');
  vAtas.setAttribute('d', 'M11 9 L16 13 L21 9');
  vAtas.setAttribute('class', 'monogram-v monogram-v-atas');
  vAtas.setAttribute('stroke', 'currentColor');
  vAtas.setAttribute('stroke-width', '1.9');
  vAtas.setAttribute('stroke-linecap', 'round');
  vAtas.setAttribute('stroke-linejoin', 'round');

  // ── Huruf V bawah ─────────────────────────────────────────────────────────
  // Lebih besar, membuka ke bawah — menyeimbangkan bentuk keseluruhan di
  // dalam belah ketupat. Celah 2px dari V atas membuat keduanya terbaca
  // sebagai dua huruf terpisah, bukan satu silang.
  const vBawah = document.createElementNS(NS, 'path');
  vBawah.setAttribute('d', 'M10 17 L16 23 L22 17');
  vBawah.setAttribute('class', 'monogram-v monogram-v-bawah');
  vBawah.setAttribute('stroke', 'currentColor');
  vBawah.setAttribute('stroke-width', '1.9');
  vBawah.setAttribute('stroke-linecap', 'round');
  vBawah.setAttribute('stroke-linejoin', 'round');

  svg.append(bingkai, vAtas, vBawah);
  return svg;
}

/**
 * Ganti elemen mark statis dengan monogram.
 *
 * Aman dipanggil berkali-kali — kalau elemennya tidak ada, keluar diam-diam.
 * Itu penting karena halaman yang berbeda punya header yang berbeda.
 *
 * @param {string} selector - selektor elemen yang akan diganti
 */
export function pasangMonogram(selector = '.brand-mark') {
  const elemen = document.querySelectorAll(selector);
  if (!elemen.length) return;

  // Instance terpisah untuk tiap tempat — node yang sama tidak bisa berada
  // di dua lokasi DOM sekaligus, dan memindahkannya akan membuat yang
  // pertama menghilang.
  for (const el of elemen) {
    el.replaceWith(buatMonogram());
  }
}
