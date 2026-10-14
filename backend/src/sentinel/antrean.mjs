/**
 * SENTINEL — ANTREAN WEBHOOK PERSISTEN
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Webhook yang diterima lalu LANGSUNG diteruskan ke layanan tujuan punya satu
 * kelemahan mendasar: kalau layanan tujuan sedang mati, pesannya HILANG.
 *
 * Bukan "tertunda" — hilang. Pengirimnya sudah menerima balasan 200, jadi dia
 * tidak akan mencoba lagi. Dan kita tidak punya salinannya.
 *
 * Untuk webhook pembayaran, itu berarti pesanan yang dibayar tidak pernah
 * diproses, dan tidak ada yang tahu sampai pelanggan menghubungi.
 *
 * ── YANG DILAKUKAN MODUL INI ─────────────────────────────────────────────────
 * Setiap webhook yang masuk DISIMPAN DULU ke SQLite sebelum diproses. Baru
 * setelah tersimpan, pengirimnya dibalas 200.
 *
 * Dengan begitu, kalau layanan tujuan mati, pesannya tetap ada — dan bisa
 * dikirim ulang saat layanannya hidup lagi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA SQLITE, BUKAN REDIS ATAU RABBITMQ
 * ══════════════════════════════════════════════════════════════════════════════
 * Yang dibutuhkan dari antrean ini: PERSISTEN (bertahan saat proses mati) dan
 * TIDAK HILANG saat listrik padam.
 *
 * Redis dengan AOF bisa begitu, tapi menambah satu layanan yang harus dijaga,
 * di-backup, dan dipantau. RabbitMQ lebih berat lagi. Untuk volume webhook
 * portal ini, keduanya berlebihan.
 *
 * SQLite sudah ada di proyek ini, sudah berjalan di mode WAL (Write-Ahead
 * Logging), dan WAL memberi yang dibutuhkan: transaksi yang sudah commit tetap
 * ada walau prosesnya mati mendadak.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EXPONENTIAL BACKOFF — KENAPA TIDAK MENGULANG TERUS-MENERUS
 * ══════════════════════════════════════════════════════════════════════════════
 * Kalau layanan tujuan mati, mengulang setiap detik berarti:
 *   · Membebani CPU dan jaringan tanpa hasil
 *   · Membanjiri log dengan kegagalan yang sama
 *   · Kalau layanannya hidup lagi, ia langsung dibanjiri ribuan percobaan
 *
 * Backoff eksponensial menunggu makin lama setiap kali gagal: 1 detik, 2, 4,
 * 8, 16, 32... Sampai batas maksimum.
 *
 * ── KENAPA ADA JITTER (WAKTU ACAK) ───────────────────────────────────────────
 * Tanpa jitter, semua pesan yang gagal pada waktu yang sama akan dicoba ulang
 * pada waktu yang sama juga — dan layanan tujuan yang baru hidup langsung
 * menerima ledakan permintaan serentak. Itu bisa menjatuhkannya lagi.
 *
 * Jitter menyebar percobaan itu ke rentang waktu, jadi beban saat pemulihan
 * tetap rata.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DEAD-LETTER QUEUE — KENAPA PESAN YANG GAGAL TIDAK DIHAPUS
 * ══════════════════════════════════════════════════════════════════════════════
 * Setelah beberapa percobaan, pesan yang tetap gagal dipindahkan ke DLQ —
 * bukan dihapus.
 *
 * Alasannya: kegagalan yang berulang biasanya berarti ADA YANG SALAH, bukan
 * "layanan tujuan sedang sibuk". Bisa jadi URL-nya salah, formatnya tidak
 * diterima, atau endpoint-nya sudah tidak ada.
 *
 * Pesan di DLQ bisa diperiksa manusia, diperbaiki, lalu dikirim ulang. Kalau
 * dihapus, satu-satunya bukti bahwa webhook itu pernah ada ikut hilang.
 */

import { randomUUID, createHash } from 'node:crypto';
import { getDb, now } from '../db.mjs';

/* ── Konfigurasi ────────────────────────────────────────────────────────── */

/**
 * Jadwal backoff dalam milidetik.
 *
 * ── KENAPA JADWAL TETAP, BUKAN PERHITUNGAN PANGKAT ───────────────────────────
 * `Math.pow(2, percobaan) * 1000` terlihat elegan, tapi:
 *   · Percobaan ke-10 = 17 menit, ke-20 = 12 hari — tidak ada gunanya
 *   · Sulit dibaca saat menyesuaikan
 *
 * Jadwal tetap lebih mudah dipahami, dan yang paling penting: BATASNYA JELAS.
 * Setelah percobaan ke-7, pesannya masuk DLQ — tidak menunggu berhari-hari.
 */
export const JADWAL_BACKOFF_MS = [
  1_000,      // 1 detik
  5_000,      // 5 detik
  30_000,     // 30 detik
  2 * 60_000, // 2 menit
  10 * 60_000, // 10 menit
  60 * 60_000, // 1 jam
  6 * 60 * 60_000, // 6 jam
];

/** Jumlah maksimum percobaan sebelum masuk DLQ. */
export const MAKS_PERCOBAAN = JADWAL_BACKOFF_MS.length;

/** Batas jitter: sampai 20% dari jeda. */
export const JITTER_RASIO = 0.2;

/** Batas ukuran body yang disimpan, dalam byte. */
export const BATAS_BODY_BYTE = 256 * 1024;

/* ── Skema ──────────────────────────────────────────────────────────────── */

/**
 * Tabel antrean webhook.
 *
 * ── KENAPA `UNIQUE (sumber, id_peristiwa)` ───────────────────────────────────
 * Provider webhook MENGIRIM ULANG pesan yang sama kalau balasan kita lambat
 * atau gagal. Tanpa batasan unik, kiriman ulang itu masuk antrean sebagai
 * pesan BARU — dan pelanggan mendapat dua kali efeknya (dua kali email, dua
 * kali aktivasi langganan).
 *
 * Batasan ini ditegakkan DATABASE, bukan hanya kode. Pemeriksaan di kode punya
 * celah: dua kiriman ulang yang datang BERSAMAAN bisa dua-duanya membaca
 * "belum ada" sebelum salah satunya menulis.
 *
 * ── KENAPA `id_peristiwa` BOLEH NULL ─────────────────────────────────────────
 * Tidak semua provider menyertakan ID peristiwa. Yang tidak menyertakan tetap
 * harus bisa masuk antrean — dan NULL tidak bentrok dengan NULL di SQLite
 * (dianggap selalu berbeda), jadi perilakunya benar: tanpa ID, setiap kiriman
 * dianggap pesan baru.
 */
export function siapkanTabelAntrean(handle = getDb()) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS sentinel_antrean (
      id              TEXT PRIMARY KEY,
      -- Dari mana webhook ini datang: 'stripe' | 'github' | 'telegram' | ...
      sumber          TEXT NOT NULL,
      -- ID peristiwa dari provider, kalau ada. Dipakai menolak kiriman ulang.
      id_peristiwa    TEXT,
      -- URL tujuan pengiriman
      url             TEXT NOT NULL,
      -- Body yang akan dikirim, disimpan apa adanya
      body            TEXT NOT NULL,
      -- Header yang akan disertakan, sebagai JSON
      headers         TEXT NOT NULL DEFAULT '{}',
      -- ── KENAPA ISI DIHITUNG DARI BODY ────────────────────────────────────
      -- Dipakai untuk mengenali isi yang SAMA persis dari sumber yang sama,
      -- walau provider tidak mengirim ID peristiwa. Tanpa ini, webhook tanpa
      -- ID tidak punya perlindungan apa pun terhadap kiriman ulang.
      sidik_jari       TEXT NOT NULL,

      status          TEXT NOT NULL DEFAULT 'menunggu',
      -- menunggu | dikirim | gagal | dlq
      --   menunggu : siap dicoba
      --   dikirim  : berhasil, punya kode balasan 2xx
      --   gagal    : percobaan terakhir gagal, akan dicoba lagi
      --   dlq      : habis percobaan, menunggu diperiksa manusia

      percobaan       INTEGER NOT NULL DEFAULT 0,
      -- Kapan boleh dicoba lagi. 0 = sekarang.
      jadwal_berikut  INTEGER NOT NULL DEFAULT 0,

      -- Hasil percobaan terakhir
      kode_balasan    INTEGER,
      pesan_galat     TEXT NOT NULL DEFAULT '',
      -- Latensi percobaan terakhir, milidetik
      latensi_ms      INTEGER,

      diterima_at     INTEGER NOT NULL,
      terakhir_coba_at INTEGER,
      selesai_at      INTEGER
    );

    -- ── INDEKS UNTUK PENGAMBILAN ANTREAN ─────────────────────────────────────
    -- Query pengambilan selalu menyaring status + jadwal_berikut, jadi indeks
    -- gabungan itu yang paling berguna.
    CREATE INDEX IF NOT EXISTS idx_sentinel_antrean_kerja
      ON sentinel_antrean(status, jadwal_berikut);

    CREATE INDEX IF NOT EXISTS idx_sentinel_antrean_sumber
      ON sentinel_antrean(sumber, diterima_at DESC);

    -- ── KEUNIKAN UNTUK MENOLAK KIRIMAN ULANG ─────────────────────────────────
    -- Parsial: hanya berlaku kalau id_peristiwa TIDAK NULL. Kalau kolomnya
    -- nullable dan indeksnya tidak parsial, NULL akan dianggap sama di beberapa
    -- versi SQLite — dan webhook tanpa ID akan saling menolak.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sentinel_antrean_unik
      ON sentinel_antrean(sumber, id_peristiwa)
      WHERE id_peristiwa IS NOT NULL;

    -- Sidik jari isi: menolak kiriman ulang yang sama persis.
    -- Jendela 1 jam: cukup lama untuk menangkap kiriman ulang provider,
    -- cukup pendek supaya webhook sah yang isinya kebetulan sama (misalnya
    -- dua pesan identik di hari berbeda) tetap bisa masuk.
    CREATE INDEX IF NOT EXISTS idx_sentinel_antrean_sidik
      ON sentinel_antrean(sumber, sidik_jari, diterima_at);
  `);
}

/* ── Sidik jari isi ─────────────────────────────────────────────────────── */

/**
 * Hitung sidik jari dari isi webhook.
 *
 * ── KENAPA DARI BODY DAN URL, BUKAN DARI HEADER ──────────────────────────────
 * Header sering memuat nilai yang berubah setiap kiriman (timestamp, nonce,
 * tanda tangan baru) — memasukkannya membuat kiriman ulang terlihat berbeda.
 *
 * Body dan URL adalah bagian yang STABIL: kalau provider mengirim ulang pesan
 * yang sama, keduanya identik.
 */
export function sidikJari(body, url) {
  return createHash('sha256')
    .update(String(url ?? ''))
    .update('\n')
    .update(String(body ?? ''))
    .digest('hex');
}

/* ── Masuk antrean ──────────────────────────────────────────────────────── */

/**
 * Simpan webhook ke antrean.
 *
 * Mengembalikan `{ ok, id, duplikat, alasan }`.
 *
 * ── KENAPA MENGEMBALIKAN `duplikat: true`, BUKAN ERROR ───────────────────────
 * Kiriman ulang adalah HAL NORMAL dalam sistem webhook — provider memang
 * mengirim ulang kalau balasannya lambat. Memperlakukannya sebagai error akan
 * membanjiri log dengan kegagalan yang sebenarnya bukan masalah.
 *
 * Yang penting: pemanggilnya tahu bahwa pesannya TIDAK ditambahkan, dan bisa
 * membalas 200 supaya provider berhenti mengirim ulang.
 */
export function masukAntrean({ sumber, idPeristiwa = null, url, body, headers = {}, diterimaAt = now() }) {
  if (!sumber) return { ok: false, alasan: 'sumber_kosong' };
  if (!url) return { ok: false, alasan: 'url_kosong' };

  const teksBody = typeof body === 'string' ? body : String(body ?? '');

  // ── BATAS UKURAN BODY ─────────────────────────────────────────────────────
  // Tanpa batas, satu webhook raksasa bisa menghabiskan ruang database — dan
  // itu tidak bisa diperbaiki tanpa menghapus data.
  //
  // Yang dilakukan saat melebihi batas: DITOLAK, bukan dipotong. Body yang
  // dipotong membuat tanda tangannya tidak cocok lagi saat dikirim ulang, jadi
  // menyimpannya hanya menunda kegagalan.
  if (Buffer.byteLength(teksBody, 'utf8') > BATAS_BODY_BYTE) {
    return { ok: false, alasan: 'body_terlalu_besar', batas: BATAS_BODY_BYTE };
  }

  const db = getDb();
  const jari = sidikJari(teksBody, url);

  // ── PERIKSA DUPLIKAT LEBIH DULU ───────────────────────────────────────────
  // Pemeriksaan ini punya celah (dua permintaan bersamaan), dan celah itu
  // ditutup indeks unik di database. Pemeriksaan di sini hanya supaya kasus
  // yang jelas bisa dibalas cepat tanpa menyentuh jalur error.
  if (idPeristiwa) {
    const ada = db.prepare(
      'SELECT id FROM sentinel_antrean WHERE sumber = ? AND id_peristiwa = ? LIMIT 1',
    ).get(sumber, idPeristiwa);

    if (ada) return { ok: true, id: ada.id, duplikat: true, alasan: 'id_peristiwa_sudah_ada' };
  }

  // ── SIDIK JARI ISI: HANYA KALAU PROVIDER TIDAK KIRIM ID PERISTIWA ──────────
  //
  // ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────────
  // Versi sebelumnya memeriksa sidik jari isi UNTUK SEMUA webhook, termasuk
  // yang punya id_peristiwa.
  //
  // Akibatnya: provider yang mengirim DUA peristiwa BERBEDA dengan isi yang
  // sama (misalnya dua notifikasi "status: aktif" untuk dua pesanan berbeda
  // yang kebetulan serupa) akan salah ditolak — peristiwa kedua dianggap
  // kiriman ulang dari yang pertama.
  //
  // ── URUTAN KEPERCAYAAN: ID PERISTIWA LEBIH KUAT ───────────────────────────
  // `id_peristiwa` adalah pernyataan EKSPLISIT dari provider: "ini peristiwa
  // yang berbeda". Sidik jari isi hanya TEBAKAN kita.
  //
  // Kalau provider sudah menyatakan ID-nya, tebakan kita tidak boleh
  // membatalkannya. Sidik jari dipakai hanya saat tidak ada ID — di situ ia
  // satu-satunya perlindungan.
  if (!idPeristiwa) {
    const jendela = diterimaAt - 60 * 60 * 1000;
    const kembar = db.prepare(`
      SELECT id FROM sentinel_antrean
      WHERE sumber = ? AND sidik_jari = ? AND diterima_at > ?
      LIMIT 1
    `).get(sumber, jari, jendela);

    if (kembar) return { ok: true, id: kembar.id, duplikat: true, alasan: 'isi_sama_dalam_1_jam' };
  }

  const id = randomUUID();

  try {
    db.prepare(`
      INSERT INTO sentinel_antrean
        (id, sumber, id_peristiwa, url, body, headers, sidik_jari, status, diterima_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'menunggu', ?)
    `).run(id, sumber, idPeristiwa, url, teksBody, JSON.stringify(headers ?? {}), jari, diterimaAt);

    return { ok: true, id, duplikat: false };
  } catch (err) {
    // ── UNIQUE MENANGKAP BALAPAN ──────────────────────────────────────────────
    // Dua kiriman ulang yang datang bersamaan bisa dua-duanya lolos pemeriksaan
    // di atas. Indeks unik yang menolaknya, dan di sini errornya diterjemahkan
    // jadi "duplikat" — bukan kegagalan.
    if (/UNIQUE/i.test(err?.message ?? '')) {
      const ada = idPeristiwa
        ? db.prepare('SELECT id FROM sentinel_antrean WHERE sumber = ? AND id_peristiwa = ?').get(sumber, idPeristiwa)
        : null;
      return { ok: true, id: ada?.id ?? null, duplikat: true, alasan: 'balapan_insert' };
    }
    throw err;
  }
}

/* ── Ambil untuk dikirim ────────────────────────────────────────────────── */

/**
 * Ambil sekumpulan pesan yang siap dikirim.
 *
 * ── KENAPA `BEGIN IMMEDIATE` ─────────────────────────────────────────────────
 * Pola "baca yang siap, lalu tandai sedang diproses" punya celah: dua pekerja
 * yang berjalan bersamaan bisa membaca pesan yang SAMA, lalu dua-duanya
 * mengirimkannya. Pelanggan menerima efeknya dua kali.
 *
 * `BEGIN IMMEDIATE` mengunci database untuk menulis sejak awal, jadi pekerja
 * kedua menunggu — dan saat dia membaca, pesannya sudah ditandai.
 *
 * ── KENAPA `jadwal_berikut <= sekarang` ──────────────────────────────────────
 * Itu yang membuat backoff bekerja: pesan yang gagal disetel `jadwal_berikut`
 * ke masa depan, jadi ia tidak diambil sampai waktunya tiba.
 */
export function ambilSiapKirim(batas = 10, sekarang = now()) {
  const db = getDb();

  db.exec('BEGIN IMMEDIATE');
  try {
    const baris = db.prepare(`
      SELECT id, sumber, id_peristiwa, url, body, headers, percobaan, diterima_at
      FROM sentinel_antrean
      WHERE status = 'menunggu' AND jadwal_berikut <= ?
      ORDER BY jadwal_berikut ASC, diterima_at ASC
      LIMIT ?
    `).all(sekarang, batas);

    if (baris.length) {
      // Tandai "sedang diproses" dengan menggeser jadwalnya jauh ke depan.
      // Kalau prosesnya mati di tengah jalan, jadwal itu mencegah pesannya
      // dikirim dua kali saat layanan hidup lagi.
      const t = db.prepare('UPDATE sentinel_antrean SET jadwal_berikut = ? WHERE id = ?');
      for (const b of baris) t.run(sekarang + 5 * 60_000, b.id);
    }

    db.exec('COMMIT');
    return baris;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ── Hasil pengiriman ───────────────────────────────────────────────────── */

/**
 * Hitung jeda berikutnya dengan backoff eksponensial + jitter.
 *
 * ── KENAPA JITTER PENTING ────────────────────────────────────────────────────
 * Tanpa jitter, semua pesan yang gagal pada gelombang yang sama akan dicoba
 * ulang pada waktu yang sama juga. Layanan tujuan yang baru hidup langsung
 * menerima ledakan permintaan serentak — dan itu bisa menjatuhkannya lagi.
 *
 * Jitter menyebar percobaan ke rentang waktu, jadi beban saat pemulihan rata.
 *
 * @param {number} percobaan  jumlah percobaan yang SUDAH dilakukan (1 = baru gagal sekali)
 * @param {() => number} acak  sumber angka acak, bisa diganti di tes
 */
export function hitungJedaBerikut(percobaan, acak = Math.random) {
  // Percobaan ke-1 → indeks 0, ke-2 → indeks 1, dst.
  const idx = Math.min(Math.max(percobaan - 1, 0), JADWAL_BACKOFF_MS.length - 1);
  const dasar = JADWAL_BACKOFF_MS[idx];

  // Jitter: sampai 20% dari jeda, DIKURANGI dan DITAMBAH.
  // Dikurangi supaya jeda rata-ratanya tetap sama dengan jadwalnya.
  const maks = dasar * JITTER_RASIO;
  const geser = (acak() * 2 - 1) * maks;

  return Math.max(1000, Math.round(dasar + geser));
}

/**
 * Catat hasil pengiriman.
 *
 * ── KENAPA SUKSES HANYA UNTUK 2xx ────────────────────────────────────────────
 * Kode 3xx adalah pengalihan — layanan tujuan memindahkan webhook ke tempat
 * lain, dan kita tidak mengikutinya. Kode 4xx berarti permintaannya DITOLAK
 * (format salah, tanda tangan tidak diterima) — mengulanginya tidak akan
 * berhasil, tapi tetap dicoba beberapa kali karena 429 (terlalu banyak
 * permintaan) memang perlu diulang.
 */
export function catatHasil(id, { sukses, kodeBalasan = null, pesanGalat = '', latensiMs = null, sekarang = now() }) {
  const db = getDb();
  const baris = db.prepare('SELECT percobaan, status FROM sentinel_antrean WHERE id = ?').get(id);
  if (!baris) return { ok: false, alasan: 'tidak_ditemukan' };

  const percobaanBaru = baris.percobaan + 1;

  if (sukses) {
    db.prepare(`
      UPDATE sentinel_antrean
      SET status = 'dikirim', percobaan = ?, kode_balasan = ?, pesan_galat = '',
          latensi_ms = ?, terakhir_coba_at = ?, selesai_at = ?, jadwal_berikut = 0
      WHERE id = ?
    `).run(percobaanBaru, kodeBalasan, latensiMs, sekarang, sekarang, id);

    return { ok: true, status: 'dikirim', percobaan: percobaanBaru };
  }

  // ── GAGAL: MASIH ADA JATAH PERCOBAAN? ─────────────────────────────────────
  if (percobaanBaru >= MAKS_PERCOBAAN) {
    // Habis percobaan → DLQ. TIDAK dihapus.
    db.prepare(`
      UPDATE sentinel_antrean
      SET status = 'dlq', percobaan = ?, kode_balasan = ?, pesan_galat = ?,
          latensi_ms = ?, terakhir_coba_at = ?, selesai_at = ?
      WHERE id = ?
    `).run(percobaanBaru, kodeBalasan, String(pesanGalat).slice(0, 500), latensiMs, sekarang, sekarang, id);

    return { ok: true, status: 'dlq', percobaan: percobaanBaru };
  }

  const jeda = hitungJedaBerikut(percobaanBaru);
  db.prepare(`
    UPDATE sentinel_antrean
    SET status = 'menunggu', percobaan = ?, kode_balasan = ?, pesan_galat = ?,
        latensi_ms = ?, terakhir_coba_at = ?, jadwal_berikut = ?
    WHERE id = ?
  `).run(percobaanBaru, kodeBalasan, String(pesanGalat).slice(0, 500), latensiMs, sekarang, sekarang + jeda, id);

  return { ok: true, status: 'menunggu', percobaan: percobaanBaru, jedaBerikutMs: jeda };
}

/* ── Statistik & pembersihan ────────────────────────────────────────────── */

/** Ringkasan antrean untuk ditampilkan di UI. */
export function statistikAntrean() {
  const db = getDb();

  const perStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM sentinel_antrean GROUP BY status
  `).all();

  const ringkas = { menunggu: 0, dikirim: 0, gagal: 0, dlq: 0 };
  for (const r of perStatus) ringkas[r.status] = r.n;

  // Latensi rata-rata dari yang BERHASIL — kegagalan punya latensi timeout
  // yang tidak menggambarkan performa sebenarnya.
  const lat = db.prepare(`
    SELECT AVG(latensi_ms) AS rata, MAX(latensi_ms) AS maks, COUNT(*) AS n
    FROM sentinel_antrean WHERE status = 'dikirim' AND latensi_ms IS NOT NULL
  `).get();

  return {
    ...ringkas,
    total: Object.values(ringkas).reduce((a, b) => a + b, 0),
    latensi: {
      rataMs: lat?.rata != null ? Math.round(lat.rata) : null,
      maksMs: lat?.maks ?? null,
      sampel: lat?.n ?? 0,
    },
  };
}

/**
 * Hapus pesan yang sudah selesai dan sudah lama.
 *
 * ── KENAPA HANYA YANG BERHASIL, BUKAN YANG DLQ ───────────────────────────────
 * Pesan DLQ justru yang paling perlu disimpan: itu bukti ada yang salah, dan
 * mungkin perlu dikirim ulang setelah diperbaiki. Menghapusnya otomatis
 * berarti membuang satu-satunya jejaknya.
 */
export function bersihkanSelesai({ lebihTuaDariMs = 7 * 24 * 60 * 60 * 1000, sekarang = now() } = {}) {
  const batas = sekarang - lebihTuaDariMs;
  const hasil = getDb().prepare(`
    DELETE FROM sentinel_antrean WHERE status = 'dikirim' AND selesai_at IS NOT NULL AND selesai_at < ?
  `).run(batas);
  return { dihapus: hasil.changes };
}
