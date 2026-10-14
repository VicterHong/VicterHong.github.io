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

import { getDb, now } from './db.mjs';
import {
  hitungKuota,
  bolehLihatMetrik,
  bulanSekarang,
  pesanTolak,
  PAKET_BERBAYAR,
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

  db.exec('BEGIN IMMEDIATE');
  try {
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

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return keadaanKuota(userId);
}

// ── 4. TRIAL METRIK ──────────────────────────────────────────────────────────

/** Baris trial pengguna, kalau ada. Per AKUN — jadi paling banyak satu baris. */
export function trialPengguna(userId) {
  if (!userId) return null;
  return getDb()
    .prepare('SELECT project_slug, dibuka_at FROM trial_metrik WHERE user_id = ? LIMIT 1')
    .get(userId) ?? null;
}

/**
 * Boleh tidaknya pengguna membuka metrik proyek ini, LENGKAP dengan pencatatan.
 *
 * Mengembalikan `{ boleh, alasan, pakaiTrial }`. Kalau `pakaiTrial` true,
 * fungsi ini SUDAH mencatatnya — pemanggil tidak perlu melakukan apa pun lagi.
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
export function periksaAksesMetrik(userId, projectSlug, { sudahStar }) {
  const paket = paketPengguna(userId);
  const trial = trialPengguna(userId);
  const proyekSama = Boolean(trial && trial.project_slug === projectSlug);

  const hasil = bolehLihatMetrik({
    paket,
    sudahPakaiTrial: Boolean(trial),
    sudahStar,
    proyekSama,
  });

  if (hasil.boleh && hasil.pakaiTrial) {
    getDb().prepare(`
      INSERT INTO trial_metrik (id, user_id, project_slug, dibuka_at)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), userId, projectSlug, now());
  }

  return hasil;
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
  const kuota = keadaanKuota(userId);
  const trial = trialPengguna(userId);

  return {
    paket,
    berbayar: PAKET_BERBAYAR.has(paket),
    kuota,
    bonusStar: sudahKlaimBonus(userId),
    trial: trial
      ? { proyek: trial.project_slug, dibukaPada: trial.dibuka_at }
      : null,
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
export function daftarProyekDenganAkses(userId, proyek) {
  const paket = paketPengguna(userId);
  const berbayar = PAKET_BERBAYAR.has(paket);
  const trial = trialPengguna(userId);

  return proyek.map((p) => {
    const proyekSama = Boolean(trial && trial.project_slug === p.slug);

    let status;
    if (berbayar) status = 'terbuka';
    else if (proyekSama) status = 'trial-terpakai';
    else if (trial) status = 'terkunci-jatah-habis';
    else status = 'terkunci-perlu-star';

    return {
      slug: p.slug,
      nama: p.name,
      ringkas: p.summary,
      subtitle: p.subtitle,
      stack: p.stack,
      // Data metrik TIDAK ikut dikirim ke browser kalau terkunci. Menyembunyikan
      // di CSS berarti datanya tetap ada di jaringan — dan itu bukan penguncian,
      // itu sekadar tidak menampilkan.
      metrik: status === 'terbuka' || status === 'trial-terpakai' ? p.metrics : null,
      status,
    };
  });
}

export { pesanTolak };
