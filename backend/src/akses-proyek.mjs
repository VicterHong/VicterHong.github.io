/**
 * AKSES PROYEK — menentukan siapa boleh melihat apa, dan mencatatnya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SEMUA KEPUTUSAN DI SATU BERKAS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Halaman area klien butuh jawaban untuk empat pertanyaan yang saling
 * bergantung:
 *
 *   1. Paket apa yang dimiliki pengguna ini?
 *   2. Berapa token yang boleh dia buat bulan ini?
 *   3. Boleh dia membuka data metrik proyek ini?
 *   4. Kalau boleh karena trial — apakah jatahnya habis sekarang?
 *
 * Kalau tiap endpoint menghitung sendiri, jawabannya bisa BERBEDA antar
 * endpoint — dan yang paling berbahaya: satu endpoint yang lupa memeriksa
 * berarti akses terbuka lewat jalur itu. Di sini semua jawaban dihitung dari
 * satu tempat, dan `langganan.mjs` yang menentukan aturannya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * URUTAN PEMERIKSAAN: MURAH DULU
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Panggilan jaringan (GitHub API) adalah yang termahal — ratusan milidetik,
 * dan bisa gagal. Jadi urutannya:
 *
 *   1. Cek langganan dari database      (mikro-detik)
 *   2. Kalau berbayar → selesai, tidak perlu cek star sama sekali
 *   3. Cek cache star                   (mikro-detik)
 *   4. Baru panggil GitHub              (hanya kalau cache kosong/basi)
 *
 * Akibatnya: pelanggan berbayar TIDAK PERNAH memicu panggilan GitHub. Yang
 * memicunya hanya pengguna gratis yang mencoba membuka metrik — dan itu
 * jumlahnya kecil.
 */

import { randomUUID } from 'node:crypto';

import { getDb, now, transaction } from './db.mjs';
import {
  hitungKuota,
  bolehLihatMetrik,
  bulanSekarang,
  pesanTolak,
  PAKET_BERBAYAR,
  KUOTA_METRIK_GRATIS,
  TOTAL_METRIK_GRATIS,
} from './langganan.mjs';

// ── 1. PAKET PENGGUNA ────────────────────────────────────────────────────────

/**
 * Paket aktif pengguna. `gratis` kalau tidak ada langganan berjalan.
 *
 * ── KENAPA MEMERIKSA TANGGAL, BUKAN HANYA status = 'aktif' ──────────────────
 * Baris langganan bisa tertinggal dalam status 'aktif' padahal tanggal
 * berakhirnya sudah lewat — misalnya webhook pembayaran gagal memperbarui
 * baris. Kalau kode hanya membaca kolom `status`, pengguna itu tetap dapat
 * akses berbayar tanpa membayar.
 *
 * Memeriksa `selesai_at` membuat akses berhenti sendiri saat waktunya habis,
 * tanpa bergantung pada pekerjaan terjadwal yang bisa gagal berjalan.
 */
export function paketPengguna(userId) {
  if (!userId) return 'gratis';

  const baris = getDb().prepare(`
    SELECT paket FROM langganan
    WHERE user_id = ?
      AND status = 'aktif'
      AND (selesai_at IS NULL OR selesai_at > ?)
    ORDER BY mulai_at DESC
    LIMIT 1
  `).get(userId, now());

  if (!baris) return 'gratis';
  return PAKET_BERBAYAR.has(baris.paket) ? baris.paket : 'gratis';
}

// ── 2. BONUS STAR ────────────────────────────────────────────────────────────

/** Apakah pengguna sudah pernah mengklaim bonus star. Sekali seumur akun. */
export function sudahKlaimBonus(userId) {
  if (!userId) return false;
  const baris = getDb()
    .prepare('SELECT 1 FROM bonus_star WHERE user_id = ? LIMIT 1')
    .get(userId);
  return Boolean(baris);
}

/** Catat bonus star. Mengembalikan false kalau sudah pernah (UNIQUE menolak). */
export function catatBonusStar(userId, { paket, githubUser = '', sumber = 'github', catatan = '' } = {}) {
  try {
    getDb().prepare(`
      INSERT INTO bonus_star (id, user_id, paket_saat_itu, sumber, github_user, diberikan_at, catatan)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, paket || '', sumber, githubUser, now(), catatan);
    return true;
  } catch (err) {
    // UNIQUE(user_id) — klaim kedua ditolak database, bukan hanya oleh kode.
    // Ini disengaja: dua permintaan yang datang bersamaan tidak bisa
    // dua-duanya lolos hanya karena kode memeriksa lebih dulu.
    if (/UNIQUE/i.test(err.message)) return false;
    throw err;
  }
}

// ── 3. KUOTA TOKEN ───────────────────────────────────────────────────────────

/** Berapa token yang sudah dibuat pengguna di bulan ini. */
export function terpakaiBulanIni(userId, bulan = bulanSekarang()) {
  if (!userId) return 0;
  const baris = getDb()
    .prepare('SELECT terpakai FROM kuota_token WHERE user_id = ? AND bulan = ?')
    .get(userId, bulan);
  return baris ? Number(baris.terpakai) : 0;
}

/**
 * Keadaan kuota lengkap — siap dikirim ke UI.
 *
 * Mengembalikan angka, bukan boolean: UI perlu menampilkan "2 dari 5 tersisa",
 * bukan hanya boleh/tidak.
 */
export function keadaanKuota(userId) {
  const paket = paketPengguna(userId);
  const bulan = bulanSekarang();
  return hitungKuota({
    paket,
    terpakai: terpakaiBulanIni(userId, bulan),
    bonusStar: sudahKlaimBonus(userId),
    sekarang: new Date(),
  });
}

/**
 * Pakai satu jatah token. Mengembalikan keadaan kuota SETELAH dipakai.
 *
 * ── KENAPA MEMAKAI TRANSAKSI ───────────────────────────────────────────────
 * Pola "baca jumlah, periksa, lalu tulis jumlah+1" punya celah: dua permintaan
 * yang datang bersamaan bisa dua-duanya membaca "terpakai: 0", dua-duanya
 * menyimpulkan "boleh", dan dua-duanya menulis "terpakai: 1". Hasilnya:
 * pengguna dengan kuota 1 berhasil membuat 2 token.
 *
 * `BEGIN IMMEDIATE` mengunci database untuk menulis sejak awal transaksi,
 * jadi permintaan kedua menunggu yang pertama selesai — dan membacanya
 * sebagai "terpakai: 1", yang benar.
 */
export function pakaiKuota(userId) {
  const db = getDb();
  const bulan = bulanSekarang();

  return transaction(() => {
    const baris = db
      .prepare('SELECT terpakai FROM kuota_token WHERE user_id = ? AND bulan = ?')
      .get(userId, bulan);

    if (baris) {
      db.prepare('UPDATE kuota_token SET terpakai = terpakai + 1, updated_at = ? WHERE user_id = ? AND bulan = ?')
        .run(now(), userId, bulan);
    } else {
      db.prepare('INSERT INTO kuota_token (id, user_id, bulan, terpakai, updated_at) VALUES (?, ?, ?, 1, ?)')
        .run(randomUUID(), userId, bulan, now());
    }

    return keadaanKuota(userId);
  });
}

// ── 4. METRIK TERBUKA (paket Gratis) ─────────────────────────────────────────

/** Berapa proyek yang sudah dibuka metriknya oleh pengguna ini. */
export function jumlahMetrikTerbuka(userId) {
  if (!userId) return 0;
  return getDb()
    .prepare('SELECT COUNT(*) AS n FROM metrik_terbuka WHERE user_id = ?')
    .get(userId).n;
}

/** Daftar proyek yang sudah terbuka, untuk ditandai di halaman klien. */
export function daftarMetrikTerbuka(userId) {
  if (!userId) return [];
  return getDb()
    .prepare('SELECT project_slug, sumber, dibuka_at FROM metrik_terbuka WHERE user_id = ? ORDER BY dibuka_at')
    .all(userId);
}

/** Apakah proyek tertentu sudah terbuka untuk pengguna ini. */
export function metrikSudahTerbuka(userId, projectSlug) {
  if (!userId || !projectSlug) return false;
  const baris = getDb()
    .prepare('SELECT 1 FROM metrik_terbuka WHERE user_id = ? AND project_slug = ? LIMIT 1')
    .get(userId, projectSlug);
  return Boolean(baris);
}

/**
 * Keadaan jatah metrik — siap dikirim ke UI.
 *
 * ── KENAPA ANGKA, BUKAN BOOLEAN ─────────────────────────────────────────────
 * Halaman perlu menampilkan "2 dari 5 tersisa", bukan hanya boleh/tidak.
 * Tanpa angka, pengguna tidak tahu berapa proyek lagi yang bisa dia buka —
 * dan itu justru informasi yang menentukan apakah dia perlu berlangganan.
 */
export function keadaanMetrik(userId) {
  const paket = paketPengguna(userId);
  const sudahStar = sudahKlaimBonus(userId);
  const terpakai = jumlahMetrikTerbuka(userId);

  const total = sudahStar ? TOTAL_METRIK_GRATIS : KUOTA_METRIK_GRATIS.login;
  const berbayar = PAKET_BERBAYAR.has(paket);

  return {
    paket,
    berbayar,
    // Paket berbayar tidak punya batas — `total: null` menyatakan itu.
    total: berbayar ? null : total,
    terpakai: berbayar ? 0 : terpakai,
    sisa: berbayar ? null : Math.max(0, total - terpakai),
    sudahStar,
    // Berapa proyek lagi yang bisa dibuka dengan star, kalau belum diklaim.
    bonusStarTersedia: !sudahStar && !berbayar ? KUOTA_METRIK_GRATIS.star : 0,
    proyek: daftarMetrikTerbuka(userId).map((r) => r.project_slug),
  };
}

/**
 * Boleh tidaknya pengguna membuka metrik proyek ini, LENGKAP dengan pencatatan.
 *
 * Mengembalikan `{ boleh, alasan, pakaiJatah, sumber }`. Kalau `pakaiJatah`
 * true, fungsi ini SUDAH mencatatnya — pemanggil tidak perlu melakukan apa pun.
 *
 * ── KENAPA PENCATATAN DI SINI, BUKAN DI PEMANGGIL ──────────────────────────
 * Kalau pemanggil yang mencatat, ada dua cara gagal:
 *   1. Dia lupa → jatahnya tidak pernah berkurang, trial jadi tanpa batas
 *   2. Dia mencatat walau akses ditolak → pengguna kehilangan jatahnya
 *      tanpa pernah melihat apa pun
 *
 * Dengan pencatatan di sini, keduanya tidak mungkin terjadi: yang mencatat
 * adalah fungsi yang sama yang memutuskan, dan hanya saat keputusannya "boleh".
 */
export function periksaAksesMetrik(userId, projectSlug, { sudahStar, ip = '', userAgent = '' } = {}) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
  const paket = paketPengguna(userId);
  const jumlahTerbuka = jumlahMetrikTerbuka(userId);
  const proyekSama = metrikSudahTerbuka(userId, projectSlug);

  const hasil = bolehLihatMetrik({
    paket,
    jumlahTerbuka,
    sudahStar: sudahStar ?? sudahKlaimBonus(userId),
    proyekSama,
  });

  if (hasil.boleh && hasil.pakaiJatah) {
    // ── INSERT OR IGNORE: UNIQUE(user_id, project_slug) YANG MENENTUKAN ──────
    // Dua permintaan yang datang bersamaan untuk proyek yang sama tidak bisa
    // dua-duanya mencatat. Yang kedua diabaikan database, bukan oleh kode.
    //
    // Kalau barisnya sudah ada (proyek sudah terbuka), tidak ada jatah yang
    // terpakai — dan pemeriksaan `proyekSama` di atas sudah menanganinya lebih
    // dulu, jadi jalur ini hanya untuk proyek yang benar-benar baru.
      getDb().prepare(`
        INSERT OR IGNORE INTO metrik_terbuka
          (id, user_id, project_slug, sumber, dibuka_at, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), userId, projectSlug, hasil.sumber ?? 'login', now(), ip, String(userAgent).slice(0, 300));
  }

  db.exec('COMMIT');
  return hasil;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── 5. RINGKASAN UNTUK UI ────────────────────────────────────────────────────

/**
 * Semua yang dibutuhkan halaman area klien dalam SATU panggilan.
 *
 * ── KENAPA DIGABUNG, BUKAN TIGA ENDPOINT TERPISAH ──────────────────────────
 * Halaman ini menampilkan tiga hal yang saling bergantung: paket, kuota, dan
 * status trial. Kalau diambil lewat tiga permintaan, ada saat di mana halaman
 * menampilkan kombinasi yang tidak mungkin — misalnya "paket: gratis" dengan
 * "sisa token: 5", karena permintaan paket sudah selesai tapi kuota belum.
 *
 * Satu panggilan = satu keadaan yang konsisten.
 */
export function ringkasanAkun(userId) {
  const paket = paketPengguna(userId);

  return {
    paket,
    berbayar: PAKET_BERBAYAR.has(paket),
    kuota: keadaanKuota(userId),
    bonusStar: sudahKlaimBonus(userId),
    // ── metrik: JATAH PROYEK UNTUK PAKET GRATIS ──────────────────────────────
    // Berisi angka (total, terpakai, sisa) dan daftar proyek yang sudah
    // terbuka — supaya halaman bisa menampilkan "sisa 2 dari 5" dan menandai
    // proyek mana yang sudah dibuka.
    metrik: keadaanMetrik(userId),
  };
}

/**
 * Daftar proyek + status aksesnya untuk pengguna ini.
 *
 * ── KENAPA STATUS DIHITUNG DI SINI, BUKAN DI BROWSER ───────────────────────
 * Browser bisa menghitung sendiri "paket saya standar, berarti saya boleh".
 * Tapi keputusan yang dibuat di browser tidak bisa dipercaya — siapa pun bisa
 * mengubahnya. Yang dihitung di sini adalah TAMPILAN (label "terbuka" atau
 * "terkunci"); izin sebenarnya tetap diperiksa lagi saat data diminta.
 *
 * Dua lapis, dan lapis keduanya yang menentukan.
 */
/**
 * Status yang berarti "metrik proyek ini boleh dibaca".
 *
 * ── KENAPA DITULIS SEKALI DI SINI ────────────────────────────────────────────
 * Daftar ini dipakai dua tempat: untuk memutuskan status, dan untuk memutuskan
 * apakah data metriknya dikirim. Kalau ditulis dua kali, keduanya bisa berbeda
 * — dan itu persis yang terjadi: satu tempat memakai nama status lama
 * ('trial-terpakai') yang sudah tidak pernah dihasilkan lagi, sehingga data
 * metrik proyek yang sudah dibuka TIDAK PERNAH dikirim.
 *
 * Satu definisi, dipakai dua tempat. Tidak ada cara keduanya berbeda.
 */
const STATUS_TERBUKA = new Set(['terbuka', 'sudah-dibuka']);

export function daftarProyekDenganAkses(userId, proyek) {
  const paket = paketPengguna(userId);
  const berbayar = PAKET_BERBAYAR.has(paket);
  const sudahStar = sudahKlaimBonus(userId);
  const jumlahTerbuka = jumlahMetrikTerbuka(userId);
  const terbuka = new Set(daftarMetrikTerbuka(userId).map((r) => r.project_slug));

  const jatahTotal = sudahStar ? TOTAL_METRIK_GRATIS : KUOTA_METRIK_GRATIS.login;
  const sisa = Math.max(0, jatahTotal - jumlahTerbuka);

  return proyek.map((p) => {
    // ── EMPAT STATUS, BUKAN DUA ──────────────────────────────────────────────
    // Yang penting bagi pengguna bukan "terbuka atau terkunci", tapi APA YANG
    // HARUS DILAKUKAN untuk membukanya:
    //
    //   terbuka            → sudah bisa dibaca
    //   sudah-dibuka       → proyek ini termasuk yang sudah dia buka
    //   terkunci-bisa-buka → masih ada jatah, tinggal tekan
    //   terkunci-perlu-star→ jatah login habis, tapi star menambah 2
    //   terkunci-jatah-habis → tidak ada jalan gratis lagi, perlu berlangganan
    //
    // Tanpa pemisahan ini, semua yang terkunci terlihat sama — dan pengguna
    // tidak tahu mana yang bisa dia buka sekarang.
    let status;
    if (berbayar) status = 'terbuka';
    else if (terbuka.has(p.slug)) status = 'sudah-dibuka';
    else if (sisa > 0) status = 'terkunci-bisa-buka';
    else if (!sudahStar) status = 'terkunci-perlu-star';
    else status = 'terkunci-jatah-habis';

    return {
      slug: p.slug,
      nama: p.name,
      ringkas: p.summary,
      subtitle: p.subtitle,
      stack: p.stack,
      // ── DATA METRIK HANYA DIKIRIM KALAU MEMANG BOLEH DIBACA ────────────────
      //
      // Menyembunyikannya di CSS berarti datanya tetap ada di jaringan — dan
      // itu bukan penguncian, itu sekadar tidak menampilkan.
      //
      // ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────
      // Versi sebelumnya memeriksa `status === 'terbuka' || status ===
      // 'trial-terpakai'`. Nama status `trial-terpakai` sudah tidak ada lagi
      // sejak aturan berubah jadi 3+2 — statusnya sekarang `sudah-dibuka`.
      //
      // Akibatnya: pengguna yang SUDAH membuka sebuah proyek melihatnya
      // kembali terkunci tanpa data — akses yang sudah dia dapat hilang karena
      // nama status yang tertinggal.
      //
      // Pelajarannya: memeriksa status lewat DAFTAR NAMA selalu bisa
      // tertinggal saat statusnya berubah. Yang lebih tahan: periksa apakah
      // statusnya TERMASUK yang boleh dibaca, dan daftarnya ditulis sekali.
      metrik: STATUS_TERBUKA.has(status) ? p.metrics : null,
      status,
    };
  });
}

export { pesanTolak };
