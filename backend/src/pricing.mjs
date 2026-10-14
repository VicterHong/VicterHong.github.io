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

// ══════════════════════════════════════════════════════════════════════════════
// ANGKA KUOTA DIAMBIL DARI SISTEM LANGGANAN — BUKAN DIKETIK ULANG
//
// ── BUG YANG DIPERBAIKI ──────────────────────────────────────────────────────
// Sebelumnya baris fitur berbunyi `'1 token akses per bulan'` sebagai TEKS
// biasa, sementara komentar di sebelahnya berbunyi "angka ini HARUS cocok
// dengan KUOTA_DASAR di langganan.mjs".
//
// Komentar tidak bisa menegakkan apa pun. Kalau kuota sistem diubah jadi 3,
// halaman harga tetap menjanjikan 1 — dan itu jenis kesalahan yang paling
// merugikan: pelanggan membayar berdasarkan janji yang tidak bisa dipenuhi.
//
// Sekarang angkanya diambil langsung dari KUOTA_DASAR, jadi tidak ada dua
// tempat yang bisa berbeda.
// ══════════════════════════════════════════════════════════════════════════════
import { KUOTA_DASAR, BONUS_STAR } from './langganan.mjs';

/**
 * Baris fitur kuota token untuk sebuah paket — dihitung dari KUOTA_DASAR.
 *
 * ── KENAPA FUNGSI, BUKAN TEKS LANGSUNG ──────────────────────────────────────
 * Karena teks langsung adalah masalahnya. Dengan fungsi ini, mengubah kuota
 * di langganan.mjs otomatis mengubah halaman harga.
 */
function fiturKuota(paketId) {
  const kuota = KUOTA_DASAR[paketId];

  // null berarti tanpa batas — bukan nol.
  //   null → sebut MEKANISME sekaligus HASILNYA
  //   0    → tidak ditampilkan sama sekali (paket Gratis tidak punya token)
  //
  // ── KENAPA MENYEBUT HASILNYA, BUKAN CUMA "TANPA BATAS" ─────────────────────
  // "Token akses tanpa batas" benar, tapi tidak menjawab pertanyaan berikutnya
  // yang muncul di kepala pembaca: "lalu apa artinya buat saya?". Menambahkan
  // "jadi seluruh proyek selalu terbuka" menjawabnya di baris yang sama.
  //
  // ── KENAPA DITULIS DI SINI, BUKAN DI DAFTAR FITUR ENTERPRISE ───────────────
  // Baris ini DIHASILKAN dari KUOTA_DASAR, jadi angkanya tidak bisa berbohong
  // kalau kuota sistemnya berubah. Menuliskannya terpisah di daftar fitur
  // Enterprise akan membuat dua tempat yang bisa berbeda.
  if (kuota === null) {
    return { teks: 'Token tanpa batas, jadi seluruh proyek selalu terbuka', termasuk: true, tebal: true };
  }
  return {
    teks: `${kuota} token akses per bulan`,
    termasuk: true,
    tebal: true,
  };
}

/**
 * Baris "hasil bonus star" untuk sebuah paket — dihitung dari KUOTA_DASAR.
 *
 * ── KENAPA PAKET GRATIS BERBEDA ─────────────────────────────────────────────
 * Pengguna gratis yang memberi star mendapat PRATINJAU METRIK, bukan token —
 * sistem tidak memberi token ke paket gratis. Menuliskan "1 token" di sini
 * akan menjanjikan yang tidak bisa dipenuhi.
 */
function hasilBonusStar(paketId) {
  const kuota = KUOTA_DASAR[paketId];

  if (kuota === 0) return 'Buka data metrik satu proyek, sekali';
  if (kuota === null) return 'Sudah tanpa batas';

  // Frasa harus menyebut satuan ("jadi 2 token") — versi lama "jadi 2 bulan
  // itu" bisa dibaca sebagai durasi, bukan jumlah.
  return `Kuota bulan itu jadi ${kuota + BONUS_STAR} token`;
}
// ══════════════════════════════════════════════════════════════════════════════
// ATURAN PENULISAN FITUR — BACA SEBELUM MENAMBAH PAKET
//
// ── FITUR POSITIF: TIDAK DIULANG ─────────────────────────────────────────────
// Fitur yang sudah ada di paket bawah tidak ditulis lagi di paket atas,
// karena paket atas sudah menyatakan "Mencakup seluruh fitur paket X".
//
// Mengulanginya merusak kepercayaan pada baris itu: kalau fitur paket bawah
// benar-benar tercakup, kenapa satu di antaranya ditulis lagi?
//
// ── FITUR NEGATIF: SELALU DIULANG — DAN ITU DISENGAJA ────────────────────────
// Batasan ("Belum bisa membaca kode sumber") ditulis di SETIAP paket yang
// masih memilikinya. Ini bukan kelalaian, dan jangan "dirapikan".
//
// Alasannya: "Mencakup seluruh fitur paket Gratis" hanya mencakup fitur
// POSITIF — batasan tidak ikut terbawa. Pengunjung yang membaca kartu
// Standar tidak boleh dipaksa menyimpulkan sendiri bahwa kode sumber masih
// terkunci.
//
// Efek sampingnya justru berguna: jumlah batasan berkurang di tiap tingkat
// (Gratis 3 → Standar 2 → Profesional 1 → Enterprise 0), dan pengunjung
// melihat kemajuannya sekilas.
// ══════════════════════════════════════════════════════════════════════════════
export const PAKET = [
  {
    // ── PAKET GRATIS: DITARUH PERTAMA ────────────────────────────────────────
    //
    // ── KENAPA ADA PAKET GRATIS ──────────────────────────────────────────────
    // Sistemnya SUDAH ada: pengguna tanpa langganan otomatis masuk paket
    // gratis (KUOTA_DASAR.gratis = 0), dan bisa membuka satu proyek dengan
    // memberi star. Tapi halaman harga tidak menyebutnya — jadi pengunjung
    // mengira harus membayar untuk mencoba.
    //
    // Referensi: "Three or four plans covers most SaaS products: an entry
    // plan, a plan for your core buyer, a larger team plan and an enterprise
    // path." Tanpa paket gratis, tiga paket berbayar terasa seperti tembok
    // di depan pintu masuk.
    //
    // ── KENAPA DIURUTKAN PERTAMA (KIRI) ──────────────────────────────────────
    // Alasan pertama: HARGA NOL MEMBERI KONTEKS. Melihat "Rp0" di kiri membuat
    // "Rp63.200" di sebelahnya terbaca sebagai pilihan, bukan sebagai syarat.
    //
    // Alasan kedua (dan lebih penting): paket gratis punya fitur paling
    // sedikit. Kalau ditaruh di tengah atau kanan, kolomnya terlihat seperti
    // penurunan setelah paket yang lebih lengkap. Di kiri, ia terbaca sebagai
    // titik awal yang wajar.
    //
    // ── KENAPA TIDAK DITANDAI "REKOMENDASI" ──────────────────────────────────
    // Yang unggulan tetap Profesional. Menandai paket gratis sebagai
    // rekomendasi akan bertentangan dengan tujuannya sendiri — ia pintu
    // masuk, bukan tujuan.
    id: 'gratis',
    // ── NAMA: "Gratis", BUKAN NAMA KREATIF ────────────────────────────────────
    //
    // Referensi korporasi, dan mana yang dipakai:
    //   Linear, Notion, GitHub, Supabase, Cloudflare → "Free"
    //   Vercel → "Hobby"   ·   Figma → "Starter"
    //
    // Yang paling banyak dipakai perusahaan besar adalah kata biasa: "Free".
    // Alasannya bukan kurang kreatif — nama kreatif memaksa pengunjung
    // MEMPELAJARI artinya. "Gratis" langsung dipahami, dan di halaman harga
    // kejelasan mengalahkan kepintaran.
    //
    // Vercel memakai "Hobby" karena paket itu melarang penggunaan komersial —
    // namanya harus menyampaikan batas itu. Di sini tidak ada batas seperti
    // itu, jadi tidak ada alasan menyimpang dari kata biasa.
    nama: 'Gratis',

    // ── DESKRIPSI: "UNTUK SIAPA", BUKAN "APA ISINYA" ──────────────────────────
    //
    // Setiap paket gratis korporasi punya baris ini:
    //   Vercel      "The perfect starting place for your web app or personal project"
    //   Notion      "For individuals to organize personal projects and life"
    //   Cloudflare  "For personal or hobby projects that aren't business-critical"
    //
    // Baris itu melakukan kerja yang tidak bisa dilakukan daftar fitur: ia
    // membuat pengunjung MEMILIH SENDIRI, bukan membandingkan fitur satu per
    // satu. Versi pertama saya ("Untuk melihat cara kerjanya sebelum
    // memutuskan") menjelaskan NIAT, bukan ORANG — dan itu tidak membantu
    // siapa pun memutuskan.
    deskripsi: 'Untuk yang ingin menilai kualitas sebelum berkomitmen.',
    // ── HARGA: NOL, DAN ITU ANGKA SUNGGUHAN ─────────────────────────────────
    // `hargaNormal: 0` — bukan null. Bedanya penting:
    //   null → frontend menampilkan `teksHarga` ("Sesuai kebutuhan")
    //   0    → frontend menampilkan "Rp0" yang bisa dibandingkan dengan paket lain
    //
    // Kalau memakai null + teksHarga "Gratis", kolomnya tidak bisa dibandingkan
    // secara angka — dan justru itulah gunanya paket gratis di daftar harga.
    hargaNormal: 0,
    diskon: null,
    // ── CATATAN: MENJAWAB "NANTI BAYAR?" ─────────────────────────────────────
    // GitHub menulis "$0 USD per month forever" — kata "forever" ada di sana
    // dengan sengaja: kekhawatiran terbesar pada paket gratis bukan "apa
    // isinya", tapi "sampai kapan ini gratis".
    //
    // Tiga hal yang dijawab sekaligus: tidak ada kartu kredit (tidak akan
    // ditagih diam-diam), tidak ada batas waktu (tidak akan berhenti), dan
    // tidak ada kejutan.
    catatan: 'Gratis selamanya, tanpa kartu kredit',
    unggulan: false,
    lencana: null,
    cta: { teks: 'Mulai gratis', gaya: 'seragam' },
    urutan: 0,
    fitur: [
      // ── LIMIT DITULIS EKSPLISIT — POLA SUPABASE ────────────────────────────
      //
      // Supabase menulis "500 MB database size", "Limit of 2 active projects".
      // Bukan "penyimpanan terbatas" — ANGKANYA disebut.
      //
      // Alasannya: pengunjung yang tidak tahu batasnya akan menganggap ada
      // jebakan. Angka yang jelas membuat dia bisa menilai sendiri apakah
      // paket ini cukup — dan itu justru mempercepat keputusan.
      { teks: 'Akses daftar lengkap proyek beserta ringkasannya', termasuk: true },
      { teks: 'Baca dokumentasi publik tanpa batas', termasuk: true },
      // Bonus star untuk paket gratis: PRATINJAU METRIK, bukan token.
      // Menuliskan "1 token" di sini akan bohong — sistem tidak memberi token
      // ke paket gratis (lihat catatan di langganan.mjs).
      { teks: 'Beri star, buka data metrik satu proyek penuh', termasuk: true, tebal: true },
      { teks: 'Token akses belum termasuk', termasuk: false },
      { teks: 'Kode sumber belum termasuk', termasuk: false },
      { teks: 'Hak pakai ulang kode belum termasuk', termasuk: false },
    ],
  },
  {
    id: 'standar',
    nama: 'Standar',
    deskripsi: 'Untuk yang ingin menilai kode dan metrik dengan data sendiri.',
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
    catatan: 'Bisa berhenti kapan saja, tanpa penalti',
    unggulan: false,
    lencana: null,
    // ── GAYA TOMBOL: SERAGAM ─────────────────────────────────────────────
    // Ketiga kartu memakai gaya yang sama. Sebelumnya kartu unggulan
    // memakai tombol kuning solid sementara yang lain outline — terlihat
    // seperti satu kartu "dijual" dan dua lainnya tidak.
    //
    // Yang membedakan kartu unggulan sekarang: lencana, warna tepi, dan
    // glow, bukan warna tombolnya.
    cta: { teks: 'Mulai Standar', gaya: 'seragam' },
    urutan: 1,
    fitur: [
      // ── "Dokumentasi publik" DIHAPUS DARI SINI ───────────────────────────
      //
      // Fitur itu sudah tercantum di kartu Gratis, dan kartu ini sudah menulis
      // "Mencakup seluruh fitur paket Gratis" di bawah.
      //
      // Mengulanginya membuat baris "Mencakup seluruh fitur paket Gratis"
      // terlihat tidak bisa dipercaya — kalau fitur paket bawah benar-benar
      // tercakup, kenapa satu di antaranya ditulis lagi?
      //
      // Aturan yang dipakai: fitur yang sudah ada di paket bawah TIDAK diulang
      // di paket atas. Yang ditulis hanya yang BARU.
      { teks: 'Pratinjau isi repositori: struktur dan daftar berkas', termasuk: true },
      { teks: 'Hasil uji dan metrik seluruh proyek', termasuk: true },
      // ── KUOTA TOKEN: 1 PER BULAN ──────────────────────────────────────────
      // Angka ini HARUS cocok dengan KUOTA_DASAR di langganan.mjs. Kalau
      // berbeda, halaman menjanjikan yang tidak bisa dipenuhi sistem.
      fiturKuota('standar'),
      { teks: 'Dukungan email langsung dari pemilik proyek', termasuk: true },
      // ── POLA "EVERYTHING IN X, AND:" — NOTION & LINEAR ─────────────────────
      //
      // Notion menulis "Everything in Free, and:" di paket Plus. Linear menulis
      // "All Free features +" di paket Basic.
      //
      // Fungsinya: pengunjung tidak perlu memeriksa ulang apakah fitur paket
      // bawah ikut terbawa. Satu baris menjawabnya.
      //
      // Tanpa baris ini, paket Standar terlihat seperti MENGGANTI paket
      // Gratis — padahal ia menambah.
      { teks: 'Mencakup seluruh fitur paket Gratis', termasuk: true },
      { teks: 'Kode sumber belum termasuk', termasuk: false },
      { teks: 'Hak pakai ulang kode belum termasuk', termasuk: false },
    ],
  },
  {
    id: 'profesional',
    nama: 'Profesional',
    deskripsi: 'Untuk developer yang belajar dari kode produksi nyata.',
    hargaNormal: 250000,
    diskon: { bulanan: 20, tahunan: 25 },
    catatan: 'Bisa berhenti kapan saja, tanpa penalti',
    unggulan: true,
    lencana: 'Paling sering dipilih',
    cta: { teks: 'Mulai Profesional', gaya: 'seragam' },
    urutan: 2,
    fitur: [
      { teks: 'Baca seluruh kode sumber, termasuk berkas internal', termasuk: true, tebal: true },
      fiturKuota('profesional'),
      // ── "TANPA PERANTARA" DIHAPUS ────────────────────────────────────────
      // Frasa itu menyiratkan hal negatif tentang produk LAIN: seolah yang
      // lain memakai perantara. Menjelekkan yang lain bukan cara menjual.
      //
      // Yang benar: sebut apa yang DIDAPAT, bukan apa yang tidak ada di
      // tempat lain. "Dengan saya langsung" sudah cukup — dan itu fakta,
      // karena pemiliknya memang satu orang.
      { teks: 'Diskusi teknis langsung dengan saya, pemilik proyek', termasuk: true, tebal: true },
      { teks: 'Dokumentasi arsitektur dan alasan di balik setiap keputusan', termasuk: true },
      // ── "DIDAHULUKAN DARI ANTREAN" DIHAPUS ───────────────────────────────
      // Frasa itu menyiratkan pengguna paket lain menunggu lebih lama. Itu
      // menjual dengan cara menakut-nakuti, bukan dengan menjelaskan nilai.
      //
      // Yang benar: sebut urutannya sebagai urutan, tanpa membandingkan.
      { teks: 'Balasan prioritas, selalu lebih dulu', termasuk: true },
      { teks: 'Mencakup seluruh fitur paket Standar', termasuk: true },
      { teks: 'Hak pakai ulang kode belum termasuk', termasuk: false },
    ],
  },
  {
    id: 'enterprise',
    nama: 'Enterprise',
    deskripsi: 'Untuk tim yang membangun produk di atas fondasi yang sudah terbukti.',
    // null = tidak ada angka. Frontend menampilkan `teksHarga`.
    hargaNormal: null,
    diskon: null,
    teksHarga: 'Sesuai kebutuhan',
    catatan: 'Satu percakapan singkat, tanpa kewajiban',
    unggulan: false,
    lencana: null,
    cta: { teks: 'Bicara dulu', gaya: 'seragam' },
    urutan: 3,
    fitur: [
      { teks: 'Akses penuh repositori privat, termasuk riwayat', termasuk: true, tebal: true },
      fiturKuota('enterprise'),
      // ── TIDAK ADA BARIS TOKEN DI SINI ────────────────────────────────────
      // Baris kuota token dihasilkan oleh fiturKuota('enterprise') di atas.
      //
      // Versi sebelumnya punya baris kedua di sini, dan hasilnya dua baris
      // yang artinya sama: "Token akses tanpa batas" dan "Token tanpa batas,
      // jadi seluruh proyek selalu terbuka". Pengunjung membacanya sebagai dua
      // fitur berbeda dan mulai bertanya apa bedanya.
      //
      // Satu baris per fitur. Kalau butuh diubah, ubah di fiturKuota().
      { teks: 'Hak pakai ulang kode di produk Anda sendiri', termasuk: true, tebal: true },
      { teks: 'Jaminan layanan yang disepakati bersama', termasuk: true },
      { teks: 'Pendampingan integrasi sampai berjalan', termasuk: true },
      { teks: 'Mencakup seluruh fitur paket Profesional', termasuk: true },
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
  { fitur: 'Dokumentasi publik tanpa batas', nilai: [true, true, true] },
  { fitur: 'Hasil uji dan metrik seluruh proyek', nilai: [true, true, true] },
  { fitur: 'Dukungan email langsung', nilai: [true, true, true] },
  { fitur: 'Pratinjau isi repositori', nilai: [true, true, true] },
  { fitur: 'Balasan prioritas', nilai: [false, true, true] },

  { bagian: 'Kode sumber' },

  { fitur: 'Baca seluruh kode sumber', nilai: [false, true, true] },
  { fitur: 'Diskusi teknis langsung', nilai: [false, true, true] },
  { fitur: 'Dokumentasi arsitektur', nilai: [false, true, true] },
  { fitur: 'Akses repositori privat penuh', nilai: [false, false, true] },

  { bagian: 'Penggunaan' },

  { fitur: 'Token tanpa batas, semua proyek terbuka', nilai: [false, false, true] },
  { fitur: 'Hak pakai ulang kode', nilai: [false, false, true] },
  { fitur: 'Jaminan layanan disepakati', nilai: [false, false, true] },
  { fitur: 'Pendampingan integrasi', nilai: [false, false, true] },
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
  // ══════════════════════════════════════════════════════════════════════════
  // URUTAN FAQ: YANG PALING SERING DITANYAKAN DI ATAS
  //
  // ── KENAPA FAQ GRATIS DI NOMOR SATU ──────────────────────────────────────
  // Referensi menyebut kesalahan yang membuat pengunjung berhenti:
  // "A free plan and a free trial side by side with no guidance on which
  // to pick."
  //
  // Halaman ini punya DUA jalur untuk mencoba tanpa membayar — paket Gratis
  // dan bonus star. Dua jalur tanpa penjelasan membuat pengunjung bertanya
  // "yang mana yang saya pakai?" — dan pertanyaan tanpa jawaban adalah
  // tempat orang berhenti.
  //
  // Ditaruh di atas pertanyaan soal Enterprise karena pengunjung menghadapi
  // pilihan ini SEBELUM dia memikirkan Enterprise.
  // ══════════════════════════════════════════════════════════════════════════
  {
    tanya: 'Apa bedanya paket Gratis dan bonus dari memberi star?',
    jawab: 'Keduanya jalan untuk mencoba, tapi di tingkat yang berbeda. Paket Gratis membuka daftar proyek dan dokumentasi publik, tanpa membayar dan tanpa batas waktu. Bonus star menambahkan akses data metrik satu proyek. Kalau ingin membuka semua proyek dan membuat token akses, di situ paket berbayar masuk. Ringkasnya: Gratis untuk melihat, star untuk menguji satu proyek, berlangganan untuk memakai sepenuhnya.',
  },
  {
    tanya: 'Apakah paket Gratis benar-benar gratis selamanya?',
    jawab: 'Ya. Tidak ada batas waktu, tidak ada kartu kredit, dan tidak ada tagihan yang muncul kemudian. Paket Gratis bukan uji coba yang berakhir. Ia paket yang bisa Anda pakai selama Anda mau. Anda hanya berpindah ke paket berbayar kalau memang butuh membuka kode sumber atau membuat token akses.',
  },
  {
    tanya: 'Apa bedanya Profesional dan Enterprise?',
    jawab: 'Profesional memberi akses membaca seluruh kode sumber, untuk belajar, memahami arsitektur, dan berdiskusi teknis. Anda tidak boleh memakai ulang kodenya di produk Anda. Enterprise menambahkan hak untuk memakai ulang kodenya di proyek Anda sendiri, tanpa batas jumlah proyek, plus jaminan layanan dan pendampingan langsung.',
  },
  {
    tanya: 'Kenapa Enterprise tidak ada harganya?',
    jawab: 'Karena kebutuhannya berbeda-beda, jumlah proyek, lama dukungan, seberapa jauh kode perlu disesuaikan. Menaruh satu angka akan salah untuk hampir semua orang. Percakapan singkat biasanya cukup untuk menentukan angkanya. Hubungi saya, tidak ada kewajiban setelahnya.',
  },
  {
    tanya: 'Bisakah saya berhenti kapan saja?',
    jawab: 'Bisa. Paket Standar dan Profesional ditagih bulanan, dan Anda bisa berhenti kapan saja tanpa penalti dan tanpa perlu memberi alasan. Tidak ada kontrak minimum. Akses tetap berjalan sampai akhir periode yang sudah Anda bayar, lalu berhenti sendiri. Untuk Enterprise, jangka waktunya dibicarakan saat menentukan kebutuhan karena biasanya melibatkan komitmen dukungan.',
  },
  {
    // ── FAQ INI DIPERBARUI, BUKAN DIHAPUS ────────────────────────────────────
    //
    // Versi lamanya menjawab "Apakah ada uji coba gratis?" dengan menyebut
    // dokumentasi publik dan garansi 7 hari — karena waktu itu TIDAK ADA
    // paket gratis. Jawaban itu sekarang menyesatkan: pengunjung bisa
    // menyimpulkan tidak ada cara mencoba tanpa membayar.
    //
    // Pertanyaannya tetap dipertahankan karena masih ditanyakan — tapi
    // jawabannya diarahkan ke paket Gratis yang sekarang ada.
    tanya: 'Apakah ada uji coba gratis?',
    jawab: 'Tidak ada uji coba berbatas waktu, karena paket Gratis tidak berakhir. Anda bisa memakainya selama yang Anda mau, tanpa kartu kredit. Kalau ingin mencoba lebih jauh sebelum berlangganan, beri star ke repositori dan Anda bisa membuka data metrik satu proyek. Untuk paket berbayar, ada garansi 7 hari: kalau ternyata tidak sesuai harapan, hubungi saya dan pembayaran bulan itu dikembalikan.',
  },
  {
    tanya: 'Kode yang saya lihat, apakah boleh saya pakai di proyek saya?',
    jawab: 'Tergantung paketnya, dan bedanya jelas. Standar: hanya pratinjau, yaitu struktur dan daftar berkas. Profesional: seluruh kode bisa dibaca dan dipelajari, tapi tidak boleh dipakai ulang di produk Anda. Enterprise: kode boleh dipakai ulang di produk Anda sendiri, tanpa batas jumlah proyek. Kalau tujuan Anda belajar dan memahami, Profesional cukup. Kalau tujuan Anda memakai kodenya, Enterprise yang tepat.',
  },
  {
    tanya: 'Apa itu token akses, dan berapa yang saya dapat?',
    // ── KENAPA FAQ INI ADA ─────────────────────────────────────────────────
    // Token akses adalah fitur inti yang membedakan paket ini, tapi istilahnya
    // tidak muncul di halaman harga sama sekali. Pengunjung yang membaca
    // "token akses" tanpa penjelasan harus menebak apa yang dia beli.
    jawab: 'Token akses adalah kode yang membuka data metrik dan kode sumber proyek. Standar memberi 1 token per bulan, Profesional 5 per bulan, Enterprise tanpa batas. Token dibuat sendiri di halaman Proyek Saya setelah masuk. Jatah bulanan Anda terlihat di sana, dan jatah baru tersedia saat bulan berganti.',
  },
  {
    tanya: 'Bagaimana cara mendapat bonus dari memberi star?',
    jawab: 'Beri star di repositori GitHub portofolio, lalu klaim bonusnya di halaman Proyek Saya dengan mengetik nama pengguna GitHub Anda. Sistem memeriksa langsung ke GitHub, jadi tidak perlu mengirim tangkapan layar atau bukti apa pun. Bonusnya berlaku sekali per akun: paket Gratis mendapat akses data metrik satu proyek, sedangkan Standar dan Profesional mendapat tambahan 1 token di bulan itu.',
  },
];

/** Judul bagian di halaman pricing. */
export const JUDUL = {
  title: 'Paket yang jelas, tanpa biaya tersembunyi',
  sub: 'Tiga paket untuk kebutuhan yang berbeda, dari melihat cara kerjanya, sampai membangun produk di atasnya. Semua bisa berhenti kapan saja.',
  judulTabel: 'Bandingkan paket',
  subTabel: 'Semua yang Anda dapatkan di setiap paket, berdampingan.',
  judulFaq: 'Pertanyaan yang sering muncul',
  subFaq: 'Hal-hal yang biasanya ditanyakan sebelum memutuskan.',
  ctaJudul: 'Masih ragu mana yang cocok?',
  ctaSub: 'Ceritakan kebutuhan Anda, saya bantu pilihkan paket yang paling sesuai, atau buat penyesuaian kalau memang perlu.',
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
    // ── CARA KERJA TOKEN AKSES ─────────────────────────────────────────────
    //
    // ── KENAPA BAGIAN INI ADA ──────────────────────────────────────────────
    // Fitur token akses dan bonus star sudah dibangun, tapi halaman harga
    // tidak menyebutnya sama sekali. Akibatnya pengunjung tidak tahu:
    //   · apa yang DIDAPAT dari kuota token
    //   · bahwa memberi star memberi bonus
    //
    // Dua hal itu justru yang membedakan paket ini dari langganan biasa —
    // dan yang membuat pengunjung mau mencoba.
    //
    // ── KENAPA ISINYA DI SINI, BUKAN DI HTML ───────────────────────────────
    // Angka kuotanya (1, 5, tanpa batas) HARUS cocok dengan KUOTA_DASAR di
    // langganan.mjs. Kalau ditulis di HTML, ada dua tempat yang bisa berbeda —
    // dan halaman akan menjanjikan yang tidak bisa dipenuhi sistem.
    langkahToken: [
      {
        nomor: '01',
        judul: 'Pilih paket',
        teks: 'Berlangganan Standar atau Profesional. Enterprise dibicarakan dulu karena kebutuhannya berbeda-beda.',
      },
      {
        nomor: '02',
        judul: 'Buat token di halaman Proyek Saya',
        teks: 'Setelah masuk, buka halaman Proyek Saya lalu tekan Buat token. Jatah bulanan Anda terlihat di sana.',
      },
      {
        nomor: '03',
        judul: 'Pakai token untuk membuka proyek',
        teks: 'Token membuka data metrik dan kode sumber, sesuai hak paket Anda. Sesi berlaku 24 jam, jadi tidak perlu memasukkan berulang.',
      },
    ],

    // ── BONUS STAR ─────────────────────────────────────────────────────────
    // Ditampilkan terpisah karena ia berlaku untuk SEMUA paket, termasuk yang
    // gratis — dan itulah yang membuat pengunjung mau mencoba lebih dulu.
    bonusStar: {
      judul: 'Beri star, dapat tambahan',
      teks: 'Beri star di repo GitHub portofolio, lalu klaim bonusnya di halaman Proyek Saya. Sekali per akun.',
      // Tiga baris ini menjelaskan HASIL yang berbeda per paket. Tanpa ini,
      // pengguna gratis akan mengira dia juga dapat token — padahal
      // bonusnya untuk dia adalah pratinjau metrik.
      // Hasil per paket DIHITUNG dari KUOTA_DASAR + BONUS_STAR — bukan diketik.
      // Kalau bonusnya diubah jadi 2, keempat baris ini ikut berubah sendiri.
      hasil: [
        { paket: 'Gratis', dapat: hasilBonusStar('gratis') },
        { paket: 'Standar', dapat: hasilBonusStar('standar') },
        { paket: 'Profesional', dapat: hasilBonusStar('profesional') },
        { paket: 'Enterprise', dapat: hasilBonusStar('enterprise') },
      ],
    },
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
