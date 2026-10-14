/**
 * LANGGANAN — aturan kuota token akses, TERPUSAT di satu tempat.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SATU MODUL, BUKAN TERSebar DI ROUTE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Aturan kuota ini punya lima variabel yang saling bergantung:
 *
 *   1. Paket apa (gratis / standar / profesional / enterprise)
 *   2. Berapa kuota dasar bulanan paket itu
 *   3. Apakah pengguna sudah klaim bonus star
 *   4. Berapa yang sudah terpakai bulan ini
 *   5. Bulan apa yang sedang dihitung
 *
 * Kalau pemeriksaan ini ditulis di dalam route, setiap route baru harus
 * mengulang kelima langkah itu — dan satu route yang lupa memeriksa berarti
 * kuota bisa dilampaui lewat jalur itu. Menaruhnya di satu modul membuat
 * "berapa token yang boleh dibuat" hanya punya SATU jawaban.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ATURAN YANG DIMINTA PEMILIK PROYEK
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   Paket         Kuota dasar   12 bulan    Bonus star
 *   ─────────     ───────────   ────────    ─────────────────────────
 *   gratis        0             0           +1 lihat metrik (sekali)
 *   standar       1/bulan       12          +1 token (sekali)
 *   profesional   5/bulan       60          +1 token (sekali)
 *   enterprise    tanpa batas   —           +1 token (sekali)
 *
 * ── KENAPA ENTERPRISE TANPA BATAS ─────────────────────────────────────────
 * Pemilik proyek tidak menyebut angka untuk Enterprise. Paket ini sudah
 * dijanjikan "proyek tanpa batas" di halaman harga, jadi memberi batas token
 * di sini akan bertentangan dengan janji itu. Yang tetap dijaga: batas laju
 * per menit (ada di guard.mjs) supaya tidak jadi jalan penyalahgunaan.
 *
 * ── KENAPA BONUS STAR HANYA SEKALI ────────────────────────────────────────
 * Pemilik proyek: "hanya bisa terbaca 1". Dibaca sebagai: bonus diklaim SEKALI
 * seumur akun, bukan setiap bulan. Kalau berulang, memberi star sekali akan
 * menambah kuota selamanya — dan itu bukan "bonus", itu perubahan paket.
 */

/** Kuota dasar per paket, per bulan. `null` = tanpa batas. */
export const KUOTA_DASAR = {
  gratis: 0,
  standar: 1,
  profesional: 5,
  enterprise: null,
};

/** Bonus token dari klaim star. Sekali seumur akun, untuk semua paket berbayar. */
export const BONUS_STAR = 1;

/**
 * Berapa proyek yang boleh dibuka dengan trial, per akun.
 *
 * ── DIKONFIRMASI PEMILIK PROYEK: PER AKUN, BUKAN PER PROYEK ────────────────
 * "Per akun — total 1× saja untuk semua proyek."
 *
 * Jadi pengguna gratis memilih SATU proyek yang ingin dinilai, dan setelah
 * itu jatahnya habis untuk semua proyek lain.
 *
 * ── KONSEKUENSI YANG PERLU DIKETAHUI ───────────────────────────────────────
 * Kalau dia salah pilih, dia tidak bisa mencoba yang lain. Itu memang
 * aturannya: trial ini untuk menilai KUALITAS data, bukan untuk menjelajahi
 * seluruh koleksi.
 *
 * Karena itu halaman pemilihan proyek harus jelas menyebutkan bahwa jatahnya
 * hanya satu — supaya tidak ada yang merasa tertipu setelah memilih.
 */
// ══════════════════════════════════════════════════════════════════════════════
// KUOTA METRIK UNTUK PAKET GRATIS
//
// ── ATURAN LAMA (diganti) ═════════════════════════════════════════════════════
// Satu proyek per akun, dan harus memberi star dulu baru bisa membuka.
// Angkanya disimpan sebagai TRIAL_METRIK_PER_AKUN = 1.
//
// Masalahnya: pengguna baru tidak bisa melihat APA PUN sebelum memberi star.
// Padahal dia belum tahu kualitas datanya — jadi tidak ada alasan baginya
// untuk memberi star. Itu lingkaran yang tidak bisa diputus.
//
// ── ATURAN BARU ═══════════════════════════════════════════════════════════════
// Lima proyek per akun untuk paket Gratis:
//     · Login  memberi 3 proyek — langsung bisa dibuka, tanpa star
//     · Star   menambah 2 proyek lagi (total 5)
//
// ── KENAPA LOGIN DIBERI JATAH ═════════════════════════════════════════════════
// Supaya pengguna bisa menilai kualitas data SEBELUM diminta memberi star.
// Setelah melihat tiga proyek dan merasa datanya berguna, barulah masuk akal
// meminta star — dan star itu membuka dua proyek lagi.
//
// Urutannya jadi: lihat dulu, baru beri. Bukan sebaliknya.
//
// ── KENAPA 3 DAN 2, BUKAN 5 LANGSUNG ═════════════════════════════════════════
// Angka 3 dari login cukup untuk menilai apakah datanya konsisten antar proyek
// — satu proyek bisa kebetulan bagus, tiga proyek menunjukkan polanya.
//
// Dua tambahan dari star memberi ALASAN untuk memberi star selain rasa terima
// kasih, dan itu membuat konversinya terukur.
// ══════════════════════════════════════════════════════════════════════════════
export const KUOTA_METRIK_GRATIS = {
  /** Jatah yang langsung tersedia begitu pengguna masuk. */
  login: 3,
  /** Tambahan setelah memberi star — sekali per akun. */
  star: 2,
};

/** Total jatah metrik untuk paket Gratis: 3 + 2 = 5. */
export const TOTAL_METRIK_GRATIS = KUOTA_METRIK_GRATIS.login + KUOTA_METRIK_GRATIS.star;

/**
 * Paket yang dikenal. Dipakai untuk memvalidasi masukan dari luar —
 * jangan pernah percaya string paket yang datang dari klien.
 */
export const PAKET_SAH = new Set(['gratis', 'standar', 'profesional', 'enterprise']);

/** Paket berbayar — yang boleh membuat token. */
export const PAKET_BERBAYAR = new Set(['standar', 'profesional', 'enterprise']);

/**
 * Kunci bulan dalam format YYYY-MM, memakai waktu Asia/Jakarta.
 *
 * ── KENAPA ZONA WAKTU DIPAKSA, BUKAN WAKTU SERVER ─────────────────────────
 * Server berjalan di UTC. Kalau kunci bulan dihitung dari UTC, pengguna di
 * Indonesia akan melihat kuotanya "reset" pada pukul 07:00 pagi tanggal 1 —
 * bukan tengah malam. Yang lebih membingungkan: token yang dibuat pukul 06:00
 * tanggal 1 masuk ke bulan SEBELUMNYA, jadi kuota bulan baru terlihat sudah
 * terpakai 1 padahal dia belum membuat apa pun.
 *
 * `en-CA` dipakai karena formatnya persis YYYY-MM (locale ini memakai ISO).
 */
export function bulanSekarang(tanggal = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).format(tanggal);
}

/** Awal bulan berikutnya dalam epoch ms, untuk menghitung sisa hari. */
export function awalBulanDepan(tanggal = new Date()) {
  const [tahun, bulan] = bulanSekarang(tanggal).split('-').map(Number);
  // `bulan` adalah 1-12, dan Date memakai 0-11 — jadi `bulan` (bukan bulan-1)
  // sudah menunjuk bulan berikutnya. Ini disengaja, bukan salah ketik.
  const berikutnya = new Date(Date.UTC(tahun, bulan, 1, 0, 0, 0));
  // Dikurangi 7 jam karena tengah malam Jakarta = 17:00 UTC hari sebelumnya.
  return berikutnya.getTime() - 7 * 60 * 60 * 1000;
}

/**
 * Hitung keadaan kuota seorang pengguna untuk bulan ini.
 *
 * Mengembalikan angka yang siap ditampilkan — bukan keputusan boolean. UI perlu
 * tahu SISA kuota ("2 dari 5 tersisa"), bukan hanya boleh/tidak.
 *
 * @param {object} p
 * @param {string} p.paket          paket aktif: gratis|standar|profesional|enterprise
 * @param {number} p.terpakai       jumlah token yang sudah dibuat bulan ini
 * @param {boolean} p.bonusStar     apakah bonus star sudah diklaim
 * @param {Date}   [p.sekarang]     untuk pengujian
 */
export function hitungKuota({ paket, terpakai = 0, bonusStar = false, sekarang = new Date() }) {
  const paketBersih = PAKET_SAH.has(paket) ? paket : 'gratis';
  const dasar = KUOTA_DASAR[paketBersih];

  // Bonus star hanya berlaku untuk paket berbayar. Pengguna gratis yang
  // memberi star mendapat TRIAL METRIK, bukan token — lihat catatan di atas.
  const bonus = bonusStar && PAKET_BERBAYAR.has(paketBersih) ? BONUS_STAR : 0;

  const tanpaBatas = dasar === null;
  const total = tanpaBatas ? null : dasar + bonus;
  const sisa = tanpaBatas ? null : Math.max(0, total - terpakai);

  return {
    paket: paketBersih,
    bulan: bulanSekarang(sekarang),
    dasar,
    bonus,
    bonusStarDipakai: Boolean(bonusStar) && bonus > 0,
    tanpaBatas,
    total,
    terpakai,
    sisa,
    bolehBuat: tanpaBatas ? true : sisa > 0,
    resetPada: awalBulanDepan(sekarang),
    // Untuk pesan ke pengguna: "kuota bulan ini habis, kembali dalam 12 hari".
    hariSampaiReset: Math.max(
      0,
      Math.ceil((awalBulanDepan(sekarang) - sekarang.getTime()) / (24 * 60 * 60 * 1000)),
    ),
  };
}

/**
 * Apakah pengguna boleh membuka data metrik proyek ini?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ATURAN UNTUK PAKET GRATIS: 5 PROYEK PER AKUN
 * ══════════════════════════════════════════════════════════════════════════════
 *   · Login  memberi 3 proyek — langsung bisa dibuka, tanpa star
 *   · Star   menambah 2 proyek lagi (total 5)
 *
 * ── PERBEDAAN DARI ATURAN LAMA ───────────────────────────────────────────────
 * Aturan lama: satu proyek per akun, WAJIB star dulu.
 *
 * Masalahnya: pengguna baru tidak bisa melihat apa pun sebelum memberi star,
 * padahal dia belum tahu kualitas datanya — jadi tidak ada alasan baginya
 * memberi star. Lingkaran yang tidak bisa diputus.
 *
 * Sekarang: lihat dulu tiga proyek, baru beri star untuk dua lagi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * JATAH TIDAK PERNAH BERKURANG KARENA MEMBUKA ULANG
 * ══════════════════════════════════════════════════════════════════════════════
 * Proyek yang SUDAH terbuka tetap terbuka — me-refresh halaman tidak boleh
 * menghilangkan akses yang sudah didapat, dan tidak boleh memakan jatah kedua.
 *
 * Itu ditegakkan pemanggil lewat UNIQUE(user_id, project_slug) di tabel
 * metrik_terbuka, bukan oleh fungsi ini.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * URUTAN SUMBER JATAH
 * ══════════════════════════════════════════════════════════════════════════════
 * Jatah login dipakai LEBIH DULU, baru jatah star. Alasannya: jatah login
 * selalu ada sejak awal, sedangkan jatah star baru ada setelah diklaim. Kalau
 * urutannya dibalik, pengguna yang belum star akan selalu ditolak walaupun
 * jatah loginnya masih penuh.
 *
 * @param {object} p
 * @param {string} p.paket           paket aktif pengguna
 * @param {number} p.jumlahTerbuka   berapa proyek yang sudah dibuka
 * @param {boolean} p.sudahStar      apakah bonus star sudah diklaim
 * @param {boolean} p.proyekSama     apakah proyek ini sudah termasuk yang terbuka
 */
export function bolehLihatMetrik({ paket, jumlahTerbuka = 0, sudahStar = false, proyekSama = false }) {
  const paketBersih = PAKET_SAH.has(paket) ? paket : 'gratis';

  // ── 1. LANGGANAN BERBAYAR: SELALU BOLEH ────────────────────────────────────
  // Tidak menyentuh jatah gratis sama sekali. Kalau langganannya habis nanti,
  // jatah gratisnya masih utuh — dan itu adil: dia tidak pernah memakainya.
  if (PAKET_BERBAYAR.has(paketBersih)) {
    return { boleh: true, alasan: 'langganan', pakaiJatah: false, sumber: null };
  }

  // ── 2. PROYEK INI SUDAH TERBUKA: TETAP TERBUKA ─────────────────────────────
  // Me-refresh halaman tidak boleh menghilangkan akses yang sudah didapat,
  // dan tidak boleh memakan jatah kedua.
  if (proyekSama) {
    return { boleh: true, alasan: 'sudah-terbuka', pakaiJatah: false, sumber: null };
  }

  // ── 3. HITUNG JATAH YANG TERSEDIA ─────────────────────────────────────────
  const jatahLogin = KUOTA_METRIK_GRATIS.login;
  const jatahTotal = sudahStar ? TOTAL_METRIK_GRATIS : jatahLogin;
  const sisa = Math.max(0, jatahTotal - jumlahTerbuka);

  if (sisa <= 0) {
    // ── KENAPA PESANNYA BEDA TERGANTUNG SUDAH STAR ATAU BELUM ────────────────
    // Pengguna yang BELUM star masih punya jalan keluar: memberi star menambah
    // dua proyek. Menyuruhnya berlangganan tanpa menyebut itu berarti
    // menyembunyikan pilihan yang paling mudah baginya.
    //
    // Pengguna yang SUDAH star tidak punya jalan keluar selain berlangganan —
    // dan mengatakan sebaliknya akan membuatnya mencoba star lagi, gagal, lalu
    // merasa sistemnya rusak.
    return {
      boleh: false,
      alasan: sudahStar ? 'jatah-habis' : 'jatah-habis-bisa-star',
      pakaiJatah: false,
      sumber: null,
      sisa: 0,
      jatahTotal,
    };
  }

  // ── 4. BOLEH — DAN INI MEMAKAI SATU JATAH ─────────────────────────────────
  // Sumbernya ditentukan dari mana jatahnya diambil: login dulu, baru star.
  // Penandanya berguna saat menjawab "kenapa proyek ini terbuka?" nanti.
  const dariLogin = jumlahTerbuka < jatahLogin;

  return {
    boleh: true,
    alasan: jumlahTerbuka === 0 ? 'jatah-pertama' : 'jatah-berikutnya',
    pakaiJatah: true,
    sumber: dariLogin ? 'login' : 'star',
    sisa: sisa - 1,
    jatahTotal,
  };
}

/**
 * Pesan untuk pengguna saat akses ditolak. Ditulis di sini, bukan di route,
 * supaya kalimatnya konsisten di semua tempat yang menolak.
 *
 * ── ATURAN PENULISANNYA ────────────────────────────────────────────────────
 * Pembaca pesan ini adalah calon pembeli, bukan engineer. Setiap pesan harus:
 *
 *   1. Menyebut APA yang menghalangi, dengan kata sehari-hari
 *   2. Menyebut APA yang harus dilakukan untuk membukanya
 *
 * ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────────
 * Versi pertama berbunyi "Kuota token bulan ini sudah habis." Tes menangkap
 * bahwa kata "kuota" itu sendiri adalah istilah yang tidak saya izinkan di
 * pesan pengguna — dan tesnya benar: orang yang membaca "kuota" harus menebak
 * apakah itu batas bulanan, batas total, atau batas perangkat.
 *
 * Sekarang: "jatah" + angka yang jelas. "Jatah" adalah kata yang dipakai
 * sehari-hari untuk hal yang sama.
 */
export function pesanTolak(alasan, konteks = {}) {
  switch (alasan) {
    // ══ JATAH GRATIS: PESANNYA BEDA TERGANTUNG MASIH ADA JALAN KELUAR ════════
    //
    // Pengguna yang BELUM star masih punya pilihan gratis: memberi star
    // menambah dua proyek. Menyembunyikan itu lalu menyuruhnya langsung
    // berlangganan berarti menahan pilihan yang paling mudah baginya.
    //
    // Pengguna yang SUDAH star tidak punya pilihan gratis lagi. Mengatakan
    // sebaliknya akan membuatnya mencoba star kedua kali, gagal, lalu merasa
    // sistemnya rusak.
    case 'jatah-habis-bisa-star': {
      const total = konteks.jatahTotal ?? TOTAL_METRIK_GRATIS;
      return `Jatah gratis Anda sudah dipakai untuk ${total} proyek. Beri star di repo GitHub portofolio untuk membuka 2 proyek lagi.`;
    }
    case 'jatah-habis': {
      const total = konteks.jatahTotal ?? TOTAL_METRIK_GRATIS;
      return `Jatah gratis Anda sudah dipakai untuk ${total} proyek, termasuk bonus star. Berlangganan untuk membuka metrik seluruh proyek.`;
    }

    // Alasan lama — dipertahankan supaya database atau klien yang belum
    // diperbarui tidak menampilkan pesan kosong.
    case 'perlu-star':
      return 'Beri star di repo GitHub portofolio untuk membuka 2 proyek lagi.';

    case 'kuota-habis': {
      // Angka disebut kalau ada — "kembali dalam 12 hari" jauh lebih berguna
      // daripada "bulan depan".
      const hari = konteks.hariSampaiReset;
      return hari
        ? `Jatah token akses bulan ini sudah habis. Jatah baru tersedia dalam ${hari} hari.`
        : 'Jatah token akses bulan ini sudah habis. Jatah baru tersedia saat bulan berganti.';
    }
    case 'bukan-langganan':
      return 'Membuat token akses tersedia untuk paket Standar, Profesional, dan Enterprise.';
    case 'trial-habis-proyek-lain':
      return 'Jatah melihat data metrik gratis sudah dipakai. Beri star untuk 2 proyek lagi, atau berlangganan untuk membuka seluruh proyek.';
    default:
      return 'Akses ditolak.';
  }
}
