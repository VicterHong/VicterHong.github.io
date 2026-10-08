/**
 * Data harga — satu sumber kebenaran untuk paket langganan.
 *
 * ── KENAPA DI BACKEND ──────────────────────────────────────────────────────
 * Harga yang ditulis di HTML berarti:
 *   • Harus diubah di setiap halaman yang menampilkannya
 *   • Bisa berbeda antar halaman kalau ada yang terlewat
 *   • Angka di frontend dan di sistem pembayaran bisa tidak sinkron
 *
 * Dengan data di sini, frontend hanya menampilkan apa yang dikirim server.
 * Mengubah harga = mengubah satu tempat.
 *
 * ── KENAPA ANGKA MENTAH, BUKAN TEKS ────────────────────────────────────────
 * `harga: 149` — bukan `"Rp 149"`. Angka mentah supaya frontend bisa:
 *   • Memformat sesuai lokal (Rp 149.000 vs Rp 149rb)
 *   • Menghitung total kalau nanti perlu
 *   • Membandingkan, mengurutkan, menampilkan dalam grafik
 *
 * Kalau yang dikirim string "Rp 149", semuanya harus mem-parsing teks.
 *
 * ── KENAPA enterprise TANPA ANGKA ──────────────────────────────────────────
 * Kebutuhannya berbeda-beda — jumlah proyek, lama dukungan, hak komersial.
 * Menaruh satu angka akan salah untuk hampir semua orang. Karena itu
 * `harga: null` dan frontend menampilkan teksnya.
 */

/**
 * Definisi paket.
 *
 * `urutan` menentukan tampilan kiri-ke-kanan. Angka lebih kecil = lebih kiri.
 * `unggulan: true` menandai paket yang disarankan — hanya satu yang boleh.
 */
export const PAKET = [
  {
    id: 'standar',
    nama: 'Standar',
    deskripsi: 'Untuk yang ingin melihat cara kerjanya dulu sebelum memutuskan.',
    // ── HARGA ────────────────────────────────────────────────────────────
      // `hargaNormal` — harga patokan, selalu ditampilkan dicoret.
      // `diskon`     — potongan per periode, dalam persen.
      //
      // Harga akhir TIDAK ditulis di sini — dihitung dari hargaNormal ×
      // (100 − diskon). Satu tempat, tidak mungkin tidak sinkron.
      //
      // Angka penuh (79000), bukan dalam ribu — supaya frontend bisa
      // memformat sendiri dan tidak ada kesalahan satuan.
      hargaNormal: 79000,
      diskon: { bulanan: 20, tahunan: 25 },
    catatan: 'Bisa berhenti kapan saja',
    unggulan: false,
    lencana: null,
    // ── GAYA TOMBOL: SERAGAM ─────────────────────────────────────────────
    // Ketiga kartu memakai gaya yang sama. Sebelumnya kartu unggulan
    // memakai tombol kuning solid sementara yang lain outline — terlihat
    // seperti satu kartu "dijual" dan dua lainnya tidak.
    //
    // Yang membedakan kartu unggulan sekarang: lencana, warna tepi, dan
    // glow, bukan warna tombolnya.
    cta: { teks: 'Mulai dari sini', gaya: 'seragam' },
    urutan: 1,
    fitur: [
      { teks: 'Pratinjau isi repo — struktur & daftar berkas', termasuk: true },
      { teks: 'Dokumentasi publik', termasuk: true },
      { teks: 'Lihat hasil uji & metrik proyek', termasuk: true },
      { teks: 'Dukungan lewat email', termasuk: true },
      { teks: 'Belum bisa membaca kode sumber', termasuk: false },
      { teks: 'Belum boleh memakai ulang kodenya', termasuk: false },
    ],
  },
  {
    id: 'profesional',
    nama: 'Profesional',
    deskripsi: 'Untuk developer yang belajar dari implementasi nyata.',
    hargaNormal: 250000,
      diskon: { bulanan: 20, tahunan: 25 },
    catatan: 'Bisa berhenti kapan saja',
    unggulan: true,
    lencana: 'Paling sering dipilih',
    cta: { teks: 'Mulai dari sini', gaya: 'seragam' },
    urutan: 2,
    fitur: [
      { teks: 'Baca kode sumber penuh', termasuk: true, tebal: true },
      { teks: 'Diskusi teknis langsung', termasuk: true, tebal: true },
      { teks: 'Dokumentasi arsitektur & keputusan desain', termasuk: true },
      { teks: 'Balasan prioritas', termasuk: true },
      { teks: 'Semua yang ada di Standar', termasuk: true },
      { teks: 'Belum boleh memakai ulang kodenya', termasuk: false },
    ],
  },
  {
    id: 'enterprise',
    nama: 'Enterprise',
    deskripsi: 'Untuk tim yang membangun produk di atasnya.',
    // null = tidak ada angka. Frontend menampilkan `teksHarga`.
    hargaNormal: null,
      diskon: null,
    teksHarga: 'Sesuai kebutuhan',
    catatan: 'Dibicarakan lewat percakapan singkat',
    unggulan: false,
    lencana: null,
    cta: { teks: 'Bicara dulu', gaya: 'seragam' },
    urutan: 3,
    fitur: [
      { teks: 'Akses penuh repositori privat', termasuk: true, tebal: true },
      { teks: 'Proyek tanpa batas', termasuk: true, tebal: true },
      { teks: 'Boleh memakai ulang kodenya', termasuk: true, tebal: true },
      { teks: 'Jaminan layanan (SLA)', termasuk: true },
      { teks: 'Pendampingan langsung', termasuk: true },
      { teks: 'Semua yang ada di Profesional', termasuk: true },
    ],
  },
];

/**
 * Baris tabel perbandingan.
 *
 * ── KENAPA TERPISAH DARI `fitur` ───────────────────────────────────────────
 * `fitur` di atas adalah daftar singkat di kartu — yang paling penting saja.
 * Tabel perbandingan menampilkan lebih banyak baris, termasuk yang tidak
 * muncul di kartu.
 *
 * `bagian` menandai baris pemisah. Baris dengan `bagian` bukan fitur —
 * nilainya tidak dibaca, hanya judul pengelompokannya.
 *
 * `nilai` berisi salah satu:
 *   true          → centang
 *   false         → strip
 *   string        → teks (mis. "8 jam")
 */
export const TABEL = [
  { fitur: 'Dokumentasi publik', nilai: [true, true, true] },
  { fitur: 'Lihat hasil uji & metrik', nilai: [true, true, true] },
  { fitur: 'Dukungan lewat email', nilai: [true, true, true] },
  { fitur: 'Pratinjau isi repo', nilai: [true, true, true] },
  { fitur: 'Balasan prioritas', nilai: [false, true, true] },

  { bagian: 'Kode sumber' },

  { fitur: 'Baca kode sumber penuh', nilai: [false, true, true] },
  { fitur: 'Diskusi teknis langsung', nilai: [false, true, true] },
  { fitur: 'Dokumentasi arsitektur', nilai: [false, true, true] },
  { fitur: 'Akses repositori privat', nilai: [false, false, true] },

  { bagian: 'Penggunaan' },

  { fitur: 'Proyek tanpa batas', nilai: [false, false, true] },
  { fitur: 'Boleh memakai ulang kodenya', nilai: [false, false, true] },
  { fitur: 'Jaminan layanan (SLA)', nilai: [false, false, true] },
  { fitur: 'Pendampingan langsung', nilai: [false, false, true] },
];

/**
 * Pertanyaan yang sering muncul.
 *
 * ── KENAPA DI BACKEND JUGA ─────────────────────────────────────────────────
 * Jawabannya sering menyebut harga ("Standar Rp 149rb..."). Kalau harga
 * berubah, jawabannya ikut berubah — dan itu hanya bisa dijamin kalau
 * keduanya ada di tempat yang sama.
 */
export const FAQ = [
  {
    tanya: 'Apa bedanya Profesional dan Enterprise?',
    jawab: 'Profesional memberi akses membaca seluruh kode sumber — untuk belajar, memahami arsitektur, dan berdiskusi teknis. Anda tidak boleh memakai ulang kodenya di produk Anda. Enterprise menambahkan hak untuk memakai ulang kodenya di proyek Anda sendiri, tanpa batas jumlah proyek, plus jaminan layanan dan pendampingan langsung.',
  },
  {
    tanya: 'Kenapa Enterprise tidak ada harganya?',
    jawab: 'Karena kebutuhannya berbeda-beda — jumlah proyek, lama dukungan, seberapa jauh kode perlu disesuaikan. Menaruh satu angka akan salah untuk hampir semua orang. Percakapan singkat biasanya cukup untuk menentukan angkanya. Hubungi saya — tidak ada kewajiban setelahnya.',
  },
  {
    tanya: 'Bisakah saya berhenti kapan saja?',
    jawab: 'Bisa. Paket Standar dan Profesional ditagih bulanan, dan Anda bisa berhenti kapan saja tanpa penalti. Untuk Enterprise, jangka waktunya dibicarakan saat menentukan kebutuhan — karena biasanya melibatkan komitmen dukungan.',
  },
  {
    tanya: 'Apakah ada uji coba gratis?',
    jawab: 'Untuk Standar, dokumentasi publik dan hasil uji proyek bisa dilihat gratis — jadi Anda bisa menilai kualitasnya sebelum berlangganan. Kalau setelah berlangganan ternyata tidak sesuai harapan, hubungi saya dalam 7 hari dan pembayaran bulan itu dikembalikan.',
  },
  {
    tanya: 'Kode yang saya lihat, apakah boleh saya pakai di proyek saya?',
    jawab: 'Tergantung paketnya. Standar — hanya pratinjau (struktur & daftar berkas). Profesional — boleh dibaca dan dipelajari, tapi tidak boleh dipakai ulang di produk Anda. Enterprise — boleh dipakai ulang, tanpa batas proyek.',
  },
];

/** Judul bagian di halaman pricing. */
export const JUDUL = {
  eyebrow: 'Harga',
  title: 'Paket yang jelas, tanpa biaya tersembunyi',
  sub: 'Tiga paket untuk kebutuhan yang berbeda — dari melihat cara kerjanya, sampai membangun produk di atasnya. Semua bisa berhenti kapan saja.',
  judulTabel: 'Bandingkan paket',
  subTabel: 'Semua yang Anda dapatkan di setiap paket, berdampingan.',
  judulFaq: 'Pertanyaan yang sering muncul',
  subFaq: 'Hal-hal yang biasanya ditanyakan sebelum memutuskan.',
  ctaJudul: 'Masih ragu mana yang cocok?',
  ctaSub: 'Ceritakan kebutuhan Anda — saya bantu pilihkan paket yang paling sesuai, atau buat penyesuaian kalau memang perlu.',
};

/**
 * Bangun payload lengkap untuk endpoint `/api/pricing`.
 *
 * ── KENAPA DIURUTKAN DI SINI ───────────────────────────────────────────────
 * Urutan array di JS sebenarnya sudah menentukan urutan tampil, tapi
 * mengurutkan secara eksplisit berarti urutannya tidak bergantung pada
 * urutan penulisan — kalau nanti ada yang menyisipkan paket di tengah
 * daftar, tampilannya tetap benar.
 */
/**
 * Pilihan periode pembayaran.
 *
 * ── KENAPA DI BACKEND ─────────────────────────────────────────────────────
 * Label dan urutannya ditentukan di sini supaya frontend tidak menyimpan
 * daftar kedua yang harus dijaga sinkron. Kalau nanti ada periode lain
 * (mis. 2 tahun), cukup ditambah di sini.
 *
 * `default` menentukan mana yang terpilih saat halaman dibuka. Tahunan
 * dipilih karena itu yang menguntungkan kedua pihak — pembeli dapat lebih
 * murah, pemilik dapat kepastian.
 */
export const PERIODE = {
  opsi: [
    { id: 'bulanan', label: 'Bulanan', catatan: null },
    // Catatan diskon di sini SENGAJA tidak diisi teks.
    //
    // Diskonnya berbeda per paket (Standar dan Profesional sama, tapi bisa
    // berubah nanti), dan label toggle tidak boleh mengklaim angka yang
    // mungkin tidak berlaku untuk semua paket.
    //
    // Frontend mengambil persennya dari paket itu sendiri — lihat
    // `gambarToggle()` di assets/js/pricing.js.
    { id: 'tahunan', label: 'Tahunan', catatan: null, tampilkanDiskon: true },
  ],
  default: 'tahunan',
};

/**
 * Hitung harga akhir dari harga normal dikurangi diskon.
 *
 * ── KENAPA DIHITUNG, BUKAN DITULIS ────────────────────────────────────────
 * Kalau harga akhir ditulis manual di samping persennya, keduanya bisa
 * berbeda — dan tidak ada yang tahu mana yang benar. Menghitung dari satu
 * sumber berarti perubahan harga normal otomatis ikut ke semua periode.
 *
 * `Math.round` karena harga dalam rupiah selalu bilangan bulat — tidak ada
 * harga seperti "Rp 63.200,5".
 */
function hargaSetelahDiskon(hargaNormal, persen) {
  if (hargaNormal == null) return null;
  if (!persen) return hargaNormal;
  return Math.round(hargaNormal * (100 - persen) / 100);
}

export function buildPricing() {
  const paket = [...PAKET].sort((a, b) => a.urutan - b.urutan).map((p) => {
    // Sisipkan harga akhir per periode — frontend tidak perlu menghitung.
    // Perhitungan di server berarti satu rumus, satu tempat.
    const bulanan = p.diskon?.bulanan ?? 0;
    const tahunan = p.diskon?.tahunan ?? 0;

    return {
      ...p,
      harga: {
        normal: p.hargaNormal,
        bulanan: hargaSetelahDiskon(p.hargaNormal, bulanan),
        tahunan: hargaSetelahDiskon(p.hargaNormal, tahunan),
        diskonBulananPersen: p.hargaNormal == null ? null : bulanan,
        diskonTahunanPersen: p.hargaNormal == null ? null : tahunan,
      },
    };
  });

  return {
    ok: true,
    judul: JUDUL,
    periode: PERIODE,
    paket,
    // Nama kolom tabel diambil dari paket — supaya tidak ada daftar kedua
    // yang harus dijaga sinkron.
    kolom: paket.map((p) => ({ id: p.id, nama: p.nama, unggulan: p.unggulan })),
    tabel: TABEL,
    faq: FAQ,
    // Versi skema. Berguna kalau nanti bentuk payload berubah: frontend lama
    // bisa memeriksa ini dan memutuskan apakah ia mengerti bentuk barunya.
    versi: 1,
  };
}
