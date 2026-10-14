/**
 * SANDBOX — DATA CONTOH UNTUK DEMO.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Calon klien tidak bisa mencoba sistem tanpa memasangnya dulu. Memasang butuh
 * server, database, dan waktu — dan kebanyakan orang tidak akan melakukannya
 * hanya untuk melihat apakah sistemnya cocok.
 *
 * Akibatnya: keputusan diambil dari tangkapan layar. Dan tangkapan layar bisa
 * menampilkan apa saja.
 *
 * Sandbox ini memberi yang tidak bisa diberikan tangkapan layar: antarmuka
 * yang BENAR-BENAR bisa diklik.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BATAS YANG TIDAK BOLEH DILEWATI
 * ══════════════════════════════════════════════════════════════════════════════
 * Sandbox yang salah rancang lebih berbahaya daripada tidak punya sandbox.
 * Empat aturan yang dipegang di seluruh berkas ini:
 *
 *   1. TIDAK ADA DATA NYATA. Semua nama, angka, dan email di sini dibuat.
 *      Memakai data pelanggan sungguhan di halaman publik adalah kebocoran,
 *      bukan demo.
 *
 *   2. TIDAK ADA TULIS KE SERVER. Sandbox sepenuhnya di browser. Tidak ada
 *      permintaan POST ke backend. Kalau tidak, siapa pun bisa mengisi database
 *      produksi kita dengan data sampah.
 *
 *   3. TIDAK ADA KLAIM KEMAMPUAN. Yang ditampilkan adalah BENTUK antarmukanya,
 *      bukan kemampuan sistem sebenarnya. Tombol yang tidak melakukan apa pun
 *      diberi label jelas — bukan dibiarkan seolah-olah bekerja.
 *
 *   4. DIKATAKAN SEBAGAI DEMO. Pengunjung harus tahu ia melihat contoh, bukan
 *      data nyata. Kebingungan tentang itu akan membuatnya merasa ditipu saat
 *      menyadarinya.
 */

/* ══ KATALOG SPAREPARTS ════════════════════════════════════════════════════ */

/**
 * Data contoh untuk demo inventaris.
 *
 * ── KENAPA NAMANYA SPESIFIK, BUKAN "Barang A", "Barang B" ──────────────────
 * Data yang terlalu generik terlihat seperti tempat sampah, dan pengunjung
 * tidak bisa membayangkan sistemnya dipakai untuk pekerjaannya. Nama yang
 * spesifik (tapi jelas fiktif) membuatnya terasa seperti sistem sungguhan.
 *
 * Semua angka dan nama di sini dibuat untuk demo.
 */
export const contohParts = [
  { kode: 'BRG-1001', nama: 'Bearing 6204', kategori: 'Bearing', stok: 24, min: 10, harga: 45_000, satuan: 'pcs' },
  { kode: 'BRG-1002', nama: 'Bearing 6305', kategori: 'Bearing', stok: 6, min: 10, harga: 78_000, satuan: 'pcs' },
  { kode: 'VLT-2001', nama: 'V-Belt A-42', kategori: 'Belt', stok: 15, min: 8, harga: 62_000, satuan: 'pcs' },
  { kode: 'VLT-2002', nama: 'V-Belt B-55', kategori: 'Belt', stok: 3, min: 8, harga: 95_000, satuan: 'pcs' },
  { kode: 'OLI-3001', nama: 'Oli Mesin SAE 40', kategori: 'Pelumas', stok: 42, min: 12, harga: 55_000, satuan: 'liter' },
  { kode: 'OLI-3002', nama: 'Grease Lithium EP2', kategori: 'Pelumas', stok: 9, min: 6, harga: 120_000, satuan: 'kg' },
  { kode: 'FLT-4001', nama: 'Filter Udara', kategori: 'Filter', stok: 18, min: 5, harga: 135_000, satuan: 'pcs' },
  { kode: 'FLT-4002', nama: 'Filter Oli', kategori: 'Filter', stok: 4, min: 6, harga: 88_000, satuan: 'pcs' },
  { kode: 'SLN-5001', nama: 'Seal Kit Hidrolik', kategori: 'Seal', stok: 11, min: 4, harga: 210_000, satuan: 'set' },
  { kode: 'SLN-5002', nama: 'O-Ring 50mm', kategori: 'Seal', stok: 65, min: 20, harga: 12_000, satuan: 'pcs' },
];

/** Pergerakan stok contoh — riwayat yang menjelaskan keadaan sekarang. */
export const contohMovements = [
  { tanggal: '2026-10-14', kode: 'BRG-1001', jenis: 'masuk', jumlah: 20, oleh: 'Andi', catatan: 'Pembelian rutin' },
  { tanggal: '2026-10-14', kode: 'VLT-2002', jenis: 'keluar', jumlah: 5, oleh: 'Budi', catatan: 'Perawatan mesin #3' },
  { tanggal: '2026-10-13', kode: 'OLI-3001', jenis: 'keluar', jumlah: 8, oleh: 'Andi', catatan: 'Servis berkala' },
  { tanggal: '2026-10-13', kode: 'FLT-4002', jenis: 'keluar', jumlah: 6, oleh: 'Budi', catatan: 'Ganti filter' },
  { tanggal: '2026-10-12', kode: 'SLN-5001', jenis: 'masuk', jumlah: 4, oleh: 'Andi', catatan: 'Stok cadangan' },
  { tanggal: '2026-10-12', kode: 'BRG-1002', jenis: 'keluar', jumlah: 4, oleh: 'Cahyo', catatan: 'Perbaikan conveyor' },
];

/* ══ PERHITUNGAN DEMO ══════════════════════════════════════════════════════ */

/**
 * Barang yang stoknya di bawah minimum.
 *
 * ── KENAPA INI YANG DITONJOLKAN ─────────────────────────────────────────────
 * Fitur yang paling terasa manfaatnya bukan daftar stok — itu yang sudah bisa
 * dilakukan spreadsheet. Yang tidak bisa dilakukan spreadsheet dengan baik
 * adalah MEMBERI TAHU saat ada yang perlu ditindak.
 */
export function partsMenipis(parts = contohParts) {
  return parts.filter((p) => p.stok < p.min);
}

/** Total nilai stok. */
export function nilaiStok(parts = contohParts) {
  return parts.reduce((total, p) => total + p.stok * p.harga, 0);
}

/** Ringkasan untuk kartu di atas dashboard. */
export function ringkasDemo(parts = contohParts) {
  const menipis = partsMenipis(parts);

  return {
    jumlahJenis: parts.length,
    totalNilai: nilaiStok(parts),
    menipis: menipis.length,
    menipisDaftar: menipis,
    // ── KENAPA KATEGORI DIHITUNG, BUKAN DITULIS ─────────────────────────────
    // Kategori yang ditulis ulang akan berbeda dari datanya begitu ada yang
    // mengubah daftar barang. Dihitung, keduanya tidak bisa berbeda.
    kategori: [...new Set(parts.map((p) => p.kategori))].length,
  };
}

/* ══ KONFIGURASI SANDBOX ═══════════════════════════════════════════════════ */

/**
 * Pemberitahuan yang ditampilkan di sandbox.
 *
 * ── KENAPA DITULIS DI SINI, BUKAN DI HTML ───────────────────────────────────
 * Teks ini bagian dari kontrak sandbox — ia yang membedakan demo dari sistem
 * sungguhan. Menaruhnya di data berarti ia tidak bisa terlewat saat tampilannya
 * diubah, dan bisa diuji.
 */
export const PEMBERITAHUAN_SANDBOX = {
  judul: 'Ini demo, bukan sistem sungguhan',
  poin: [
    'Semua data di sini dibuat untuk contoh — bukan data pelanggan.',
    'Tidak ada perubahan yang tersimpan. Anda bisa mengklik apa pun tanpa merusak apa pun.',
    'Tombol yang tidak bekerja diberi label "contoh" supaya jelas.',
    'Ini bentuk antarmukanya, bukan kemampuan penuh sistemnya.',
  ],
};

/**
 * Tombol mana yang benar-benar bekerja di sandbox.
 *
 * ── KENAPA ADA DAFTAR INI ───────────────────────────────────────────────────
 * Sandbox yang tombolnya tidak bekerja TANPA penjelasan membuat pengunjung
 * mengira sistemnya rusak. Yang bekerja juga harus jelas, supaya ia tahu mana
 * yang benar-benar bisa ia coba.
 *
 * Tombol di luar daftar ini diberi label "contoh" dan tidak bisa ditekan.
 */
export const AKSI_BEKERJA = new Set([
  'cari',        // pencarian & filter — murni di browser
  'urutkan',     // pengurutan kolom
  'lihat-detail', // panel detail barang
]);

/** Apakah sebuah aksi benar-benar bekerja di sandbox. */
export function aksiBekerja(nama) {
  return AKSI_BEKERJA.has(nama);
}
