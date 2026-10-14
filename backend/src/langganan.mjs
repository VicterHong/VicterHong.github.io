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
export const TRIAL_METRIK_PER_AKUN = 1;

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
 * Tiga jalur yang membuka akses, diperiksa berurutan dari yang paling murah:
 *
 *   1. Paket berbayar               → selalu boleh
 *   2. Sudah pakai trial proyek ini → boleh (dia sudah membayar dengan star)
 *   3. Belum pakai trial, sudah star → boleh SEKARANG, dan ini memakai jatahnya
 *
 * Mengembalikan `{ boleh, alasan, pakaiTrial }`. `pakaiTrial: true` berarti
 * PEMANGGIL harus mencatat pemakaiannya — kalau tidak, jatahnya tidak pernah
 * berkurang dan trialnya jadi tanpa batas.
 */
export function bolehLihatMetrik({ paket, sudahPakaiTrial, sudahStar, proyekSama }) {
  const paketBersih = PAKET_SAH.has(paket) ? paket : 'gratis';

  // 1. Langganan berbayar: selalu boleh, tidak menyentuh jatah trial.
  if (PAKET_BERBAYAR.has(paketBersih)) {
    return { boleh: true, alasan: 'langganan', pakaiTrial: false };
  }

  // ── 2. JATAH TRIAL SUDAH DIPAKAI ─────────────────────────────────────────
  //
  // ── DIKONFIRMASI: PER AKUN, BUKAN PER PROYEK ───────────────────────────
  // Jatahnya satu untuk SEMUA proyek. Jadi kalau sudah dipakai:
  //
  //   · proyek yang SAMA  → tetap boleh dibuka (dia sudah membayar jatahnya
  //                         untuk proyek ini; me-refresh tidak boleh
  //                         menghilangkan akses yang sudah dia dapat)
  //   · proyek LAIN       → TIDAK boleh (jatahnya sudah habis)
  //
  // `proyekSama` dikirim pemanggil: dia yang tahu proyek mana yang dipakai
  // saat trial dibuka.
  if (sudahPakaiTrial) {
    if (proyekSama) {
      return { boleh: true, alasan: 'trial-terpakai', pakaiTrial: false };
    }
    return { boleh: false, alasan: 'trial-habis-proyek-lain', pakaiTrial: false };
  }

  // 3. Belum pakai trial, sudah star: boleh SEKARANG, dan ini memakai jatahnya.
  if (sudahStar) {
    return { boleh: true, alasan: 'trial-baru', pakaiTrial: true };
  }

  return { boleh: false, alasan: 'perlu-star', pakaiTrial: false };
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
    case 'perlu-star':
      return 'Beri star di repo GitHub portofolio untuk membuka data metrik satu kali.';
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
      return 'Jatah melihat data metrik gratis sudah dipakai untuk proyek lain. Berlangganan untuk membuka semua proyek.';
    default:
      return 'Akses ditolak.';
  }
}
