/**
 * KALKULATOR ROI — logika murni, tanpa DOM.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IDE YANG MEMBUAT INI JUJUR
 * ══════════════════════════════════════════════════════════════════════════════
 * Halaman ini tidak bisa mengklaim "menghemat 12 jam per minggu" — saya tidak
 * punya data klien untuk mendukungnya.
 *
 * Tapi pengunjung PUNYA datanya sendiri: ia tahu berapa jam timnya menghabiskan
 * waktu untuk pencatatan manual, dan ia tahu berapa yang dibayar untuk langganan
 * SaaS.
 *
 * Jadi kalkulator ini menghitung dari angka yang DIKETIK PENGUNJUNG. Hasilnya
 * tidak perlu dipercaya — ia bisa diperiksa sendiri dengan kalkulator biasa.
 *
 * Itu lebih kuat daripada klaim apa pun: kesimpulannya datang dari data
 * pembacanya, bukan dari saya.
 *
 * ── KENAPA LOGIKA DIPISAH DARI TAMPILAN ─────────────────────────────────────
 * Perhitungan keuangan yang salah lebih berbahaya daripada tampilan yang salah.
 * Dipisah begini, ia bisa diuji di Node tanpa browser — dan diuji dengan angka
 * yang sulit (nol, negatif, nilai sangat besar).
 */

/* ══ TARIF DEFAULT ═════════════════════════════════════════════════════════ */

/**
 * Nilai waktu kerja per jam (Rupiah).
 *
 * ── KENAPA 50.000 SEBAGAI DEFAULT ───────────────────────────────────────────
 * Ini bukan klaim tentang tarif siapa pun — ini titik awal yang bisa diubah.
 * Angka ini dipilih sebagai perkiraan tengah untuk pekerja administrasi di
 * Indonesia, dan pengunjung WAJIB mengubahnya kalau tarifnya berbeda.
 *
 * Kalkulator yang tidak bisa diubah tarifnya memaksa pengunjung memakai asumsi
 * kita — dan itu membuat hasilnya tidak berguna untuk keadaannya.
 */
export const TARIF_DEFAULT = 50_000;

/**
 * Perkiraan harga langganan SaaS per pengguna per bulan (Rupiah).
 *
 * Rentangnya lebar: alat pencatatan sederhana bisa Rp50 ribu, ERP bisa
 * Rp500 ribu. Default di tengah bawah supaya tidak terkesan melebih-lebihkan.
 */
export const SAAS_DEFAULT = 150_000;

/* ══ PERHITUNGAN ═══════════════════════════════════════════════════════════ */

/**
 * Batas nilai yang masuk akal.
 *
 * ── KENAPA DIBATASI ─────────────────────────────────────────────────────────
 * Tanpa batas, pengunjung bisa mengetik 999999999 jam dan hasilnya angka yang
 * tidak berarti apa-apa. Membatasi di sini membuat hasilnya tetap masuk akal —
 * dan mencegah angka tak hingga masuk ke perhitungan.
 */
const BATAS = {
  jamPerMinggu: { min: 0, max: 168 }, // 168 jam = 24 jam × 7 hari
  jumlahOrang: { min: 1, max: 1000 },
  tarifPerJam: { min: 0, max: 10_000_000 },
  biayaSaas: { min: 0, max: 50_000_000 },
  jumlahPenggunaSaas: { min: 0, max: 10_000 },
  biayaPemeliharaanBulanan: { min: 0, max: 100_000_000 },
};

/** Jepit nilai ke rentang yang masuk akal, dan pastikan ia angka. */
export function jepit(nilai, { min, max }) {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/**
 * Bersihkan input mentah dari form ke rentang yang sah.
 *
 * ── KENAPA FUNGSI INI TIDAK MENERAPKAN NILAI DEFAULT ────────────────────────
 * Versi pertama menerapkan TARIF_DEFAULT dan SAAS_DEFAULT di sini. Akibatnya
 * `hitungHemat({})` — belum ada yang diisi — menghasilkan penghematan
 * Rp1.800.000 per tahun.
 *
 * Dua masalah dengan itu:
 *
 *   1. Angka itu MENGARANG data. Pengunjung belum bilang apa pun, tapi
 *      kalkulatornya sudah menyimpulkan angka.
 *   2. `adaIsian` jadi tidak berguna. Ia dipakai untuk membedakan "belum diisi"
 *      dari "hasilnya nol" — dan dengan default diterapkan, keduanya terlihat
 *      sama.
 *
 * Pemisahan yang benar:
 *   - DEFAULT hidup di FORM (field terisi saat halaman dibuka, pengunjung
 *     melihatnya dan bisa mengubahnya)
 *   - Fungsi hitung MURNI: ia menghitung apa yang diberikan, tidak lebih
 *
 * Jadi `hitungHemat({})` = nol. Itu jujur: tidak ada data, tidak ada hasil.
 */
export function bersihkanMasukan(mentah = {}) {
  return {
    jamPerMinggu: jepit(mentah.jamPerMinggu ?? 0, BATAS.jamPerMinggu),
    jumlahOrang: jepit(mentah.jumlahOrang ?? 1, BATAS.jumlahOrang),
    tarifPerJam: jepit(mentah.tarifPerJam ?? 0, BATAS.tarifPerJam),
    biayaSaas: jepit(mentah.biayaSaas ?? 0, BATAS.biayaSaas),
    jumlahPenggunaSaas: jepit(mentah.jumlahPenggunaSaas ?? 0, BATAS.jumlahPenggunaSaas),
    biayaPemeliharaanBulanan: jepit(mentah.biayaPemeliharaanBulanan ?? 0, BATAS.biayaPemeliharaanBulanan),
  };
}

/**
 * Hitung perkiraan penghematan.
 *
 * @param {object} mentah  masukan dari form (sudah/belum dibersihkan)
 * @returns {object} hasil lengkap dengan rincian perhitungannya
 */
export function hitungHemat(mentah = {}) {
  const m = bersihkanMasukan(mentah);

  /* ── 1. NILAI WAKTU YANG DIHEMAT ────────────────────────────────────────── */

  // Jam per minggu × jumlah orang yang terlibat.
  const jamPerMinggu = m.jamPerMinggu * m.jumlahOrang;

  // ── KENAPA 4,33 MINGGU, BUKAN 4 ───────────────────────────────────────────
  // Satu tahun = 52 minggu = 12 bulan, jadi satu bulan rata-rata 52/12 = 4,33
  // minggu. Memakai 4 membuang 3 minggu per tahun — dan pada angka besar,
  // selisihnya terlihat (Rp50 juta vs Rp54 juta).
  const MINGGU_PER_BULAN = 52 / 12;

  const jamPerBulan = jamPerMinggu * MINGGU_PER_BULAN;
  const jamPerTahun = jamPerMinggu * 52;

  const hematWaktuPerBulan = jamPerBulan * m.tarifPerJam;
  const hematWaktuPerTahun = jamPerTahun * m.tarifPerJam;

  /* ── 2. BIAYA SAAS YANG DIHILANGKAN ─────────────────────────────────────── */

  const biayaSaasPerBulan = m.biayaSaas * m.jumlahPenggunaSaas;
  const biayaSaasPerTahun = biayaSaasPerBulan * 12;

  /* ── 3. BIAYA SELF-HOSTED YANG MUNCUL ───────────────────────────────────── */

  // ── KENAPA BIAYA PEMELIHARAAN DIKURANGI, BUKAN DIABAIKAN ──────────────────
  // Sistem self-hosted TIDAK gratis: ada server, ada waktu pemeliharaan.
  // Kalkulator yang menyembunyikan biaya itu memberi hasil yang terlalu bagus —
  // dan pengunjung yang kemudian menemukan biaya nyatanya akan merasa ditipu.
  //
  // Menunjukkannya di depan membuat hasilnya bisa dipercaya.
  const biayaPemeliharaanPerTahun = m.biayaPemeliharaanBulanan * 12;

  /* ── 4. HASIL BERSIH ────────────────────────────────────────────────────── */

  const hematKotorPerTahun = hematWaktuPerTahun + biayaSaasPerTahun;
  const hematBersihPerTahun = hematKotorPerTahun - biayaPemeliharaanPerTahun;
  const hematBersihPerBulan = hematBersihPerTahun / 12;

  return {
    masukan: m,

    // Waktu
    jamPerMinggu,
    jamPerBulan: Math.round(jamPerBulan),
    jamPerTahun: Math.round(jamPerTahun),

    // Uang
    hematWaktuPerBulan,
    hematWaktuPerTahun,
    biayaSaasPerBulan,
    biayaSaasPerTahun,
    biayaPemeliharaanPerTahun,

    hematKotorPerTahun,
    hematBersihPerTahun,
    hematBersihPerBulan,

    // ── PENANDA: APAKAH HASILNYA MASUK AKAL ─────────────────────────────────
    // Kalau biaya pemeliharaan lebih besar dari penghematannya, hasilnya
    // negatif — dan itu artinya self-hosted BUKAN pilihan yang tepat untuk
    // keadaan pengunjung.
    //
    // Kalkulator yang selalu menampilkan hasil positif tidak berguna untuk
    // mengambil keputusan.
    menguntungkan: hematBersihPerTahun > 0,

    // Apakah pengunjung mengisi apa pun? Kalau semua nol, hasilnya nol juga —
    // dan itu harus terlihat sebagai "belum ada yang diisi", bukan "hemat Rp0".
    adaIsian: m.jamPerMinggu > 0 || m.biayaSaas > 0,
  };
}

/* ══ FORMAT ════════════════════════════════════════════════════════════════ */

/** Rupiah tanpa desimal, dengan pemisah ribuan gaya Indonesia. */
export function rupiah(n) {
  const angka = Math.round(Number(n) || 0);
  const negatif = angka < 0;
  const teks = Math.abs(angka).toLocaleString('id-ID');
  return `${negatif ? '-' : ''}Rp${teks}`;
}

/**
 * Rupiah versi ringkas untuk angka besar.
 *
 * ── KENAPA PERLU ────────────────────────────────────────────────────────────
 * "Rp1.234.567.890" sulit dibaca sekilas. "Rp1,2 miliar" langsung terbaca.
 * Yang panjang tetap dipakai di rincian — di sana ketepatannya penting.
 */
export function rupiahRingkas(n) {
  const angka = Number(n) || 0;
  const absolut = Math.abs(angka);
  const tanda = angka < 0 ? '-' : '';

  if (absolut >= 1_000_000_000) {
    return `${tanda}Rp${(absolut / 1_000_000_000).toFixed(1).replace('.', ',')} miliar`;
  }
  if (absolut >= 1_000_000) {
    return `${tanda}Rp${(absolut / 1_000_000).toFixed(1).replace('.', ',')} juta`;
  }
  if (absolut >= 1_000) {
    return `${tanda}Rp${(absolut / 1_000).toFixed(0)} ribu`;
  }
  return `${tanda}Rp${Math.round(absolut)}`;
}

/** Jam dengan pemisah Indonesia, maksimal satu desimal. */
export function jam(n) {
  const angka = Number(n) || 0;
  if (angka === 0) return '0 jam';
  if (Number.isInteger(angka)) return `${angka.toLocaleString('id-ID')} jam`;
  return `${angka.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`;
}

/**
 * Berapa bulan sampai biaya pemeliharaan tertutup oleh penghematan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KOREKSI KONSEP — VERSI PERTAMA SALAH
 * ══════════════════════════════════════════════════════════════════════════════
 * Versi pertama menghitung:
 *
 *     Math.ceil(biayaPemeliharaanPerTahun / 12 / hematPerBulan)
 *
 * Itu rumus yang SALAH, dan hasilnya selalu "1 bulan" untuk hampir semua
 * kasus. Alasannya: `biayaPemeliharaanPerTahun / 12` adalah biaya pemeliharaan
 * SATU BULAN, dan membaginya dengan `hematPerBulan` (yang juga sudah dikurangi
 * biaya pemeliharaan) menghasilkan angka yang hampir selalu ≤ 1.
 *
 * ── APA YANG SEBENARNYA DIMAKSUD "TITIK IMPAS" DI SINI ──────────────────────
 * Tidak ada biaya awal yang perlu "dibalik modal" — self-hosted tidak dibeli
 * di muka seperti mesin. Yang ada adalah penghematan yang berjalan setiap bulan.
 *
 * Jadi yang berguna dihitung bukan "kapan modal kembali", tapi:
 *
 *   → BERAPA PERSEN dari penghematan kotor yang habis untuk pemeliharaan
 *
 * Itu pertanyaan yang benar-benar dijawab angka ini: kalau 60% penghematan
 * habis untuk pemeliharaan, sistemnya masih untung tapi tidak sehebat
 * kelihatannya di angka kotor.
 *
 * ── KENAPA TETAP DISEBUT "TITIK IMPAS" ──────────────────────────────────────
 * Nama fungsinya dipertahankan supaya pemanggilnya tidak perlu diubah, tapi
 * yang dikembalikan sekarang adalah `null` — karena tidak ada titik impas
 * dalam arti modal kembali. Persentase biaya dihitung terpisah di
 * `persenUntukPemeliharaan()`.
 *
 * @returns {null} selalu null — tidak ada modal yang perlu dibalik.
 */
export function titikImpasBulan() {
  return null;
}

/**
 * Berapa persen penghematan kotor yang habis untuk biaya pemeliharaan.
 *
 * ── KENAPA INI BERGUNA ──────────────────────────────────────────────────────
 * "Hemat Rp44 juta per tahun" dan "60% habis untuk pemeliharaan" adalah dua
 * pernyataan tentang keadaan yang sama. Yang kedua lebih jujur — dan pengunjung
 * yang akan benar-benar membayar pemeliharaannya perlu tahu itu.
 *
 * @returns {number|null} persen 0–100, atau null kalau tidak ada penghematan
 */
export function persenUntukPemeliharaan(hasil) {
  if (hasil.hematKotorPerTahun <= 0) return null;
  const persen = (hasil.biayaPemeliharaanPerTahun / hasil.hematKotorPerTahun) * 100;
  return Math.round(Math.min(persen, 100));
}
