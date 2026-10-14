/**
 * SENTINEL — CIRCUIT BREAKER PER ENDPOINT TUJUAN
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Kalau satu endpoint tujuan sedang gangguan berat, antrean tetap mencoba
 * mengirim ke sana berulang kali. Setiap percobaan menunggu sampai timeout —
 * dan dengan timeout 10 detik, 100 pesan berarti 1.000 detik pekerja yang
 * terbuang, semuanya untuk endpoint yang sudah jelas tidak bisa menerima.
 *
 * Sementara itu, endpoint LAIN yang sehat ikut tertahan di belakangnya.
 *
 * Circuit breaker memutus itu: setelah beberapa kegagalan beruntun, endpoint
 * itu DIANGGAP mati untuk sementara, dan pengiriman ke sana dilewati. Pesannya
 * tetap di antrean — tidak hilang — dan dicoba lagi saat sirkuitnya menutup.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TIGA KEADAAN — NAMA DAN PERILAKUNYA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   TERTUTUP (normal)
 *     Pengiriman lewat seperti biasa. Kegagalan dihitung.
 *
 *   TERBUKA (diputus)
 *     Pengiriman DILEWATI tanpa dicoba. Pesannya tetap menunggu di antrean.
 *     Setelah jendela tunggu lewat, keadaannya jadi SETENGAH TERBUKA.
 *
 *   SETENGAH TERBUKA (mencoba)
 *     SATU percobaan dikirim sebagai uji. Kalau berhasil → TERTUTUP.
 *     Kalau gagal → TERBUKA lagi dengan jendela tunggu yang lebih lama.
 *
 * ── KENAPA HARUS ADA SETENGAH TERBUKA ────────────────────────────────────────
 * Tanpa keadaan itu, sirkuit yang terbuka tidak akan pernah tahu kapan
 * endpointnya sudah pulih. Ia akan menutup berdasarkan waktu saja — dan kalau
 * endpointnya masih mati, percobaan pertama langsung memenuhi ambang kegagalan
 * dan sirkuitnya terbuka lagi. Hasilnya: siklus buka-tutup yang membuang
 * percobaan.
 *
 * Setengah terbuka menguji dengan SATU permintaan. Kalau berhasil, sirkuitnya
 * benar-benar pulih. Kalau gagal, tidak ada 99 percobaan yang terbuang.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA JENDELA TUNGGU NAIK SETIAP KALI GAGAL
 * ══════════════════════════════════════════════════════════════════════════════
 * Endpoint yang mati 5 detik berbeda dari endpoint yang mati 2 jam. Kalau
 * jendela tunggunya tetap, endpoint yang mati lama akan diuji setiap 30 detik
 * — selamanya — dan itu membuang percobaan tanpa hasil.
 *
 * Dengan jendela yang naik (30 detik, 1 menit, 2 menit, 5, 10, 30 menit),
 * endpoint yang benar-benar mati akhirnya diuji sangat jarang, dan endpoint
 * yang pulih cepat langsung terdeteksi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CIRCUIT BREAKER PER ENDPOINT, BUKAN GLOBAL
 * ══════════════════════════════════════════════════════════════════════════════
 * Ini keputusan yang penting. Kalau sirkuitnya global, satu endpoint yang mati
 * akan menghentikan pengiriman ke SEMUA endpoint — termasuk yang sehat.
 *
 * Kunci sirkuitnya adalah HOST TUJUAN, bukan URL lengkap. Alasannya: satu
 * layanan biasanya punya beberapa jalur webhook (`/webhook/a`, `/webhook/b`),
 * dan kalau layanannya mati, SEMUANYA mati. Mengunci per URL lengkap berarti
 * setiap jalur punya penghitungnya sendiri — dan endpoint yang punya 5 jalur
 * butuh 5× lebih banyak kegagalan sebelum sirkuitnya terbuka.
 */

import { getDb, now } from '../db.mjs';
import { nilai } from './mode.mjs';

/* ── Konfigurasi ────────────────────────────────────────────────────────── */

/**
 * Berapa kegagalan BERUNTUN sebelum sirkuit terbuka.
 *
 * ── KENAPA 5, BUKAN 3 ATAU 10 ────────────────────────────────────────────────
 * 3 terlalu sensitif: dua permintaan yang kebetulan timeout bersamaan sudah
 * cukup memutus endpoint yang sebenarnya sehat.
 *
 * 10 terlalu longgar: 10 percobaan dengan timeout 10 detik = 100 detik
 * terbuang sebelum sirkuitnya memutus — dan itu sudah cukup untuk menahan
 * endpoint lain di belakangnya.
 */
export const AMBANG_GAGAL = 5;

/**
 * Jendela tunggu sebelum mencoba lagi, dalam milidetik.
 *
 * Naik setiap kali percobaan uji GAGAL. Yang terakhir dipakai seterusnya.
 */
export const JENDELA_TUNGGU_MS = [
  30_000,          // 30 detik
  60_000,          // 1 menit
  2 * 60_000,      // 2 menit
  5 * 60_000,      // 5 menit
  10 * 60_000,     // 10 menit
  30 * 60_000,     // 30 menit
];

/** Keadaan yang sah. Ditulis sekali supaya tidak ada salah ketik. */
export const KEADAAN = {
  TERTUTUP: 'tertutup',
  TERBUKA: 'terbuka',
  SETENGAH: 'setengah_terbuka',
};

/* ── Skema ──────────────────────────────────────────────────────────────── */

export function siapkanTabelSirkuit(handle = getDb()) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS sentinel_sirkuit (
      -- Kunci sirkuit: HOST tujuan, bukan URL lengkap.
      host              TEXT PRIMARY KEY,
      keadaan           TEXT NOT NULL DEFAULT 'tertutup',

      -- Kegagalan BERUNTUN saat ini. Direset ke 0 begitu satu pengiriman
      -- berhasil — satu keberhasilan berarti endpointnya hidup.
      gagal_beruntun    INTEGER NOT NULL DEFAULT 0,

      -- Berapa kali sirkuit ini sudah dibuka. Dipakai memilih jendela tunggu.
      sudah_dibuka      INTEGER NOT NULL DEFAULT 0,

      -- Kapan boleh diuji lagi. Diisi saat sirkuit dibuka.
      buka_sampai       INTEGER NOT NULL DEFAULT 0,

      -- Statistik untuk ditampilkan di UI
      terakhir_gagal_at INTEGER,
      terakhir_sukses_at INTEGER,
      terakhir_galat    TEXT NOT NULL DEFAULT '',
      total_gagal       INTEGER NOT NULL DEFAULT 0,
      total_sukses      INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sentinel_sirkuit_keadaan
      ON sentinel_sirkuit(keadaan, buka_sampai);
  `);
}

/* ── Kunci sirkuit ──────────────────────────────────────────────────────── */

/**
 * Ambil host dari URL — itu kunci sirkuitnya.
 *
 * ── KENAPA HOST, BUKAN URL LENGKAP ──────────────────────────────────────────
 * Satu layanan biasanya punya beberapa jalur webhook. Kalau layanannya mati,
 * SEMUA jalur mati — jadi memisahkan penghitung per jalur berarti endpoint
 * dengan 5 jalur butuh 5× lebih banyak kegagalan sebelum sirkuitnya terbuka.
 *
 * ── KENAPA TETAP MEMBEDAKAN PORT ────────────────────────────────────────────
 * `api.contoh.id:8080` dan `api.contoh.id:9090` bisa jadi layanan yang berbeda
 * sama sekali. Menggabungkannya akan memutus layanan sehat karena layanan lain
 * di host yang sama sedang mati.
 *
 * URL yang tidak bisa di-parse mengembalikan string apa adanya — lebih baik
 * memakai kunci yang aneh daripada crash.
 */
export function hostDari(url) {
  try {
    const u = new URL(String(url));
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return String(url ?? '').slice(0, 200);
  }
}

/* ── Baca keadaan ───────────────────────────────────────────────────────── */

function barisSirkuit(host, db = getDb()) {
  return db.prepare('SELECT * FROM sentinel_sirkuit WHERE host = ?').get(host) ?? null;
}

/**
 * Keadaan sirkuit untuk sebuah URL tujuan.
 *
 * Mengembalikan `{ host, keadaan, bolehKirim, tungguSampai, gagalBeruntun }`.
 *
 * ── KENAPA FUNGSI INI TIDAK MENGUBAH APA PUN ────────────────────────────────
 * Ia hanya MEMBACA. Perubahan keadaan terjadi di `catatSukses` dan
 * `catatGagal`.
 *
 * Memisahkan baca dan tulis penting karena `bolehKirim` dipanggil untuk SETIAP
 * pesan, sementara perubahan keadaan hanya terjadi saat ada hasil. Kalau
 * fungsinya ikut mengubah, satu pesan bisa memindahkan sirkuit dari setengah
 * terbuka ke tertutup tanpa ada pengiriman yang benar-benar berhasil.
 */
export function keadaanSirkuit(url, sekarang = now()) {
  const host = hostDari(url);
  const baris = barisSirkuit(host);

  // Belum pernah ada catatan → sirkuit baru, tertutup.
  if (!baris) {
    return { host, keadaan: KEADAAN.TERTUTUP, bolehKirim: true, tungguSampai: 0, gagalBeruntun: 0 };
  }

  // ── TERBUKA: PERIKSA APAKAH SUDAH WAKTUNYA DIUJI ──────────────────────────
  // Jendela tunggu yang lewat mengubah keadaannya jadi SETENGAH TERBUKA — tapi
  // perubahan itu ditulis ke database oleh `catatUjiMulai`, bukan di sini.
  // Fungsi baca tidak boleh menulis.
  if (baris.keadaan === KEADAAN.TERBUKA) {
    const sudahWaktunya = baris.buka_sampai <= sekarang;
    return {
      host,
      keadaan: sudahWaktunya ? KEADAAN.SETENGAH : KEADAAN.TERBUKA,
      // Setengah terbuka: percobaan uji boleh lewat — tapi hanya lewat
      // `catatUjiMulai`, yang memindahkan keadaannya dan menandai bahwa uji
      // sedang berjalan.
      bolehKirim: sudahWaktunya,
      tungguSampai: baris.buka_sampai,
      gagalBeruntun: baris.gagal_beruntun,
      sudahDibuka: baris.sudah_dibuka,
    };
  }

  // ── SETENGAH TERBUKA: PENGIRIMAN DITOLAK SAMPAI ADA HASIL ──────────────────
  //
  // ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────────
  // Versi sebelumnya mengembalikan `bolehKirim: true` untuk SEMUA keadaan
  // selain TERBUKA — termasuk SETENGAH TERBUKA.
  //
  // Akibatnya: setelah percobaan uji dikirim, 50 pesan berikutnya yang menunggu
  // semuanya melihat "boleh kirim" dan ikut terkirim. Endpoint yang masih mati
  // langsung dibanjiri — persis yang ingin dicegah oleh keadaan setengah
  // terbuka.
  //
  // ── KENAPA HARUS MENUNGGU HASILNYA ────────────────────────────────────────
  // Percobaan uji itu PERTANYAAN: "endpointnya sudah hidup?". Selama belum ada
  // jawabannya, mengirim yang lain berarti menebak — dan kalau tebakannya
  // salah, kita sudah membuang 50 percobaan plus 50 timeout.
  //
  // `bolehKirim: false` di sini berarti pengiriman dilewati; pesannya TETAP di
  // antrean dan akan dicoba setelah hasilnya diketahui.
  if (baris.keadaan === KEADAAN.SETENGAH) {
    return {
      host,
      keadaan: KEADAAN.SETENGAH,
      bolehKirim: false,
      tungguSampai: 0,
      gagalBeruntun: baris.gagal_beruntun,
      sudahDibuka: baris.sudah_dibuka,
    };
  }

  return {
    host,
    keadaan: baris.keadaan,
    bolehKirim: true,
    tungguSampai: baris.buka_sampai,
    gagalBeruntun: baris.gagal_beruntun,
    sudahDibuka: baris.sudah_dibuka,
  };
}

/** Apakah pengiriman ke URL ini boleh dicoba. */
export function bolehKirim(url, sekarang = now()) {
  return keadaanSirkuit(url, sekarang).bolehKirim;
}

/* ── Tulis keadaan ──────────────────────────────────────────────────────── */

function pastikanBaris(host, db = getDb()) {
  db.prepare(`
    INSERT INTO sentinel_sirkuit (host, keadaan) VALUES (?, 'tertutup')
    ON CONFLICT(host) DO NOTHING
  `).run(host);
}

/**
 * Tandai bahwa percobaan uji (setengah terbuka) sedang berjalan.
 *
 * ── KENAPA INI PERLU ────────────────────────────────────────────────────────
 * Di keadaan setengah terbuka, HANYA SATU percobaan yang boleh lewat. Kalau
 * tidak ada penandaan, 50 pesan yang menunggu akan semuanya lolos saat jendela
 * tunggunya lewat — dan endpoint yang masih mati langsung dibanjiri.
 *
 * Fungsi ini memindahkan sirkuit dari TERBUKA ke SETENGAH secara EKSPLISIT,
 * dan setelah itu `keadaanSirkuit` akan melaporkan `bolehKirim: false` untuk
 * pesan berikutnya.
 */
export function catatUjiMulai(url, sekarang = now()) {
  const host = hostDari(url);
  const db = getDb();

  pastikanBaris(host, db);

  const baris = barisSirkuit(host, db);
  if (!baris || baris.keadaan !== KEADAAN.TERBUKA || baris.buka_sampai > sekarang) {
    return { ok: false, alasan: 'bukan_waktunya' };
  }

  // ── PEMINDAHAN KE SETENGAH TERBUKA DENGAN SYARAT ──────────────────────────
  // `WHERE keadaan = 'terbuka' AND buka_sampai <= ?` memastikan hanya SATU
  // pemanggil yang berhasil memindahkannya — dua pekerja yang bersamaan akan
  // satu berhasil dan satu tidak.
  const hasil = db.prepare(`
    UPDATE sentinel_sirkuit
    SET keadaan = 'setengah_terbuka'
    WHERE host = ? AND keadaan = 'terbuka' AND buka_sampai <= ?
  `).run(host, sekarang);

  return { ok: hasil.changes > 0, host };
}

/**
 * Catat pengiriman yang BERHASIL.
 *
 * ── KENAPA SATU KEBERHASILAN LANGSUNG MERESET ───────────────────────────────
 * Circuit breaker bukan penghitung rasio kegagalan — ia penjaga "apakah
 * endpointnya hidup SEKARANG". Satu pengiriman yang berhasil membuktikan
 * endpointnya hidup, dan tidak ada alasan menahan pengiriman berikutnya.
 *
 * Menunggu beberapa keberhasilan berturut-turut akan menahan pesan yang sah
 * lebih lama dari yang perlu.
 */
export function catatSukses(url, { sekarang = now() } = {}) {
  const host = hostDari(url);
  const db = getDb();
  pastikanBaris(host, db);

  db.prepare(`
    UPDATE sentinel_sirkuit
    SET keadaan = 'tertutup',
        gagal_beruntun = 0,
        buka_sampai = 0,
        sudah_dibuka = 0,
        terakhir_sukses_at = ?,
        total_sukses = total_sukses + 1
    WHERE host = ?
  `).run(sekarang, host);

  return { ok: true, host, keadaan: KEADAAN.TERTUTUP };
}

/**
 * Catat pengiriman yang GAGAL.
 *
 * Mengembalikan `{ ok, keadaan, gagalBeruntun, bukaSampai }`.
 */
export function catatGagal(url, { pesanGalat = '', sekarang = now() } = {}) {
  const host = hostDari(url);
  const db = getDb();
  pastikanBaris(host, db);

  const baris = barisSirkuit(host, db);
  const gagalBaru = (baris?.gagal_beruntun ?? 0) + 1;

  // ── GAGAL SAAT SETENGAH TERBUKA → LANGSUNG TERBUKA LAGI ───────────────────
  // Percobaan uji itu jawabannya: endpointnya masih mati. Tidak perlu menghitung
  // sampai ambang lagi — satu percobaan sudah cukup membuktikan.
  const sedangUji = baris?.keadaan === KEADAAN.SETENGAH;

  // ── AMBANG DARI MODE KEAMANAN ────────────────────────────────────────────
  // Mode Normal: 5 kegagalan. Mode Pro: 3 — gangguan terdeteksi lebih cepat.
  const harusBuka = sedangUji || gagalBaru >= nilai('ambangGagalSirkuit');

  if (!harusBuka) {
    db.prepare(`
      UPDATE sentinel_sirkuit
      SET gagal_beruntun = ?, terakhir_gagal_at = ?, terakhir_galat = ?,
          total_gagal = total_gagal + 1
      WHERE host = ?
    `).run(gagalBaru, sekarang, String(pesanGalat).slice(0, 300), host);

    return { ok: true, host, keadaan: KEADAAN.TERTUTUP, gagalBeruntun: gagalBaru, bukaSampai: 0 };
  }

  // ── BUKA SIRKUIT ──────────────────────────────────────────────────────────
  // Jendela tunggu dipilih berdasarkan berapa kali sirkuit ini sudah dibuka —
  // makin sering dibuka, makin lama menunggunya.
  const sudahDibuka = (baris?.sudah_dibuka ?? 0) + 1;
  const idx = Math.min(sudahDibuka - 1, JENDELA_TUNGGU_MS.length - 1);
  const tunggu = JENDELA_TUNGGU_MS[idx];
  const bukaSampai = sekarang + tunggu;

  db.prepare(`
    UPDATE sentinel_sirkuit
    SET keadaan = 'terbuka', gagal_beruntun = ?, sudah_dibuka = ?,
        buka_sampai = ?, terakhir_gagal_at = ?, terakhir_galat = ?,
        total_gagal = total_gagal + 1
    WHERE host = ?
  `).run(gagalBaru, sudahDibuka, bukaSampai, sekarang, String(pesanGalat).slice(0, 300), host);

  return { ok: true, host, keadaan: KEADAAN.TERBUKA, gagalBeruntun: gagalBaru, bukaSampai, tungguMs: tunggu };
}

/* ── Reset manual ───────────────────────────────────────────────────────── */

/**
 * Tutup paksa sebuah sirkuit.
 *
 * ── KENAPA PERLU ────────────────────────────────────────────────────────────
 * Kadang endpointnya sudah diperbaiki sebelum jendela tunggunya habis. Tanpa
 * cara menutup paksa, pengiriman harus menunggu sampai 30 menit — dan itu
 * membuat pengguna mengira perbaikannya tidak berhasil.
 *
 * Disediakan lewat UI inspector, jadi orang yang memperbaiki endpoint bisa
 * langsung mengujinya.
 */
export function tutupPaksa(url, { sekarang = now() } = {}) {
  const host = hostDari(url);
  const db = getDb();
  pastikanBaris(host, db);

  db.prepare(`
    UPDATE sentinel_sirkuit
    SET keadaan = 'tertutup', gagal_beruntun = 0, buka_sampai = 0, sudah_dibuka = 0
    WHERE host = ?
  `).run(host);

  return { ok: true, host, keadaan: KEADAAN.TERTUTUP };
}

/* ── Daftar untuk UI ────────────────────────────────────────────────────── */

/** Semua sirkuit yang punya catatan, untuk ditampilkan di inspector. */
export function daftarSirkuit(sekarang = now()) {
  const baris = getDb().prepare(`
    SELECT * FROM sentinel_sirkuit ORDER BY
      CASE keadaan WHEN 'terbuka' THEN 0 WHEN 'setengah_terbuka' THEN 1 ELSE 2 END,
      terakhir_gagal_at DESC
  `).all();

  return baris.map((b) => ({
    host: b.host,
    keadaan: b.keadaan,
    gagalBeruntun: b.gagal_beruntun,
    sudahDibuka: b.sudah_dibuka,
    bukaSampai: b.buka_sampai,
    // Sisa waktu tunggu — berguna ditampilkan sebagai hitung mundur.
    sisaTungguMs: b.keadaan === KEADAAN.TERBUKA ? Math.max(0, b.buka_sampai - sekarang) : 0,
    terakhirGagalAt: b.terakhir_gagal_at,
    terakhirSuksesAt: b.terakhir_sukses_at,
    terakhirGalat: b.terakhir_galat,
    totalGagal: b.total_gagal,
    totalSukses: b.total_sukses,
  }));
}

/** Hapus catatan sirkuit untuk host yang sudah tidak dipakai. */
export function bersihkanSirkuit({ lebihTuaDariMs = 30 * 24 * 60 * 60 * 1000, sekarang = now() } = {}) {
  const batas = sekarang - lebihTuaDariMs;
  const hasil = getDb().prepare(`
    DELETE FROM sentinel_sirkuit
    WHERE keadaan = 'tertutup'
      AND COALESCE(terakhir_gagal_at, 0) < ?
      AND COALESCE(terakhir_sukses_at, 0) < ?
  `).run(batas, batas);
  return { dihapus: hasil.changes };
}
