/**
 * SENTINEL — MODE KEAMANAN
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Pengaturan keamanan punya dua sisi yang bertabrakan:
 *
 *   TERLALU LONGGAR → celah yang bisa dieksploitasi
 *   TERLALU KETAT   → webhook SAH ikut ditolak, dan orang mematikan
 *                     verifikasinya sepenuhnya karena "dipakai tidak jalan"
 *
 * Yang kedua lebih berbahaya dalam praktik. Sistem yang terlalu ketat akan
 * dimatikan, dan setelah dimatikan tidak ada perlindungan sama sekali.
 *
 * Karena itu nilai default sengaja LONGGAAR (aman, tapi tidak mengganggu),
 * dan ada mode PRO untuk yang memang butuh lebih ketat.
 *
 * ── KENAPA HARUS BISA DIKEMBALIKAN ──────────────────────────────────────────
 * Mode ketat dipakai saat ada indikasi gangguan, atau untuk sementara waktu.
 * Kalau tidak bisa dikembalikan, orang akan enggan mencobanya — dan fitur
 * yang tidak pernah dicoba sama dengan fitur yang tidak ada.
 *
 * ── KENAPA DISIMPAN DI DATABASE, BUKAN ENV ──────────────────────────────────
 * Mode di env berarti harus restart service untuk mengubahnya. Itu membuat
 * "perketat sekarang karena ada gangguan" menjadi tidak praktis — gangguan
 * selesai dalam menit, restart butuh waktu lebih lama.
 *
 * Disimpan di database, mode berubah seketika dan bertahan setelah restart.
 */

import { getDb } from '../db.mjs';

/* ══ PROFIL ════════════════════════════════════════════════════════════════ */

/**
 * Dua profil keamanan.
 *
 * ── CARA MEMILIH NILAI ──────────────────────────────────────────────────────
 * Tiap nilai di mode PRO dipilih dengan pertanyaan: "apakah ini masih
 * menerima webhook SAH?" Kalau jawabannya tidak, nilainya terlalu ketat.
 *
 * Contoh: toleransi timestamp 30 detik TERLALU KETAT. Server yang jamnya
 * meleset 1 menit akan menolak SEMUA webhook Stripe, dan itu terlihat
 * seperti "Stripe rusak" padahal jamnya yang beda.
 */
export const PROFIL = {
  normal: {
    label: 'Normal',
    keterangan: 'Pengaturan seimbang — aman, dan menerima semua webhook yang sah.',

    /** Toleransi selisih jam pada tanda tangan Stripe. */
    toleransiTandaTanganDetik: 300,

    /** Kegagalan beruntun sebelum sirkuit tujuan diputus. */
    ambangGagalSirkuit: 5,

    /** Berapa lama isi yang sama dianggap kiriman ulang. */
    jendelaDuplikatMs: 60 * 60 * 1000, // 1 jam

    /** Batas ukuran body yang diterima pintu masuk. */
    batasBodyByte: 64 * 1024, // 64 KB

    /** Batas permintaan per IP per menit ke pintu masuk. */
    batasLajuPerMenit: 120,
  },

  pro: {
    label: 'Sentinel Pro',
    keterangan: 'Lebih ketat — jendela serangan dipersempit, kiriman ulang ditangkap lebih lama.',

    /**
     * 60 detik, bukan 30.
     *
     * ── KENAPA BUKAN LEBIH KECIL ────────────────────────────────────────────
     * Stripe menandatangani dengan jam SERVERNYA. Kalau jam VPS kita meleset
     * 45 detik (NTP belum sinkron, atau baru boot), toleransi 30 detik menolak
     * SEMUA webhook Stripe — dan penyebabnya tidak terlihat dari sisi kita.
     *
     * 60 detik: cukup ketat untuk mempersempit replay, cukup longgar untuk
     * tahan terhadap selisih jam yang wajar.
     */
    toleransiTandaTanganDetik: 60,

    /** 3, bukan 1. Satu kegagalan bisa kebetulan — endpoint sempat sibuk. */
    ambangGagalSirkuit: 3,

    /**
     * 24 jam, bukan selamanya.
     *
     * Provider mengirim ulang dalam hitungan menit sampai jam, bukan hari.
     * 24 jam menangkap semua kiriman ulang nyata tanpa menyimpan sidik jari
     * yang tidak berguna lagi.
     */
    jendelaDuplikatMs: 24 * 60 * 60 * 1000,

    /** 32 KB — webhook wajar jarang lebih besar dari ini. */
    batasBodyByte: 32 * 1024,

    /** 60/menit — masih longgar untuk provider sah, lebih ketat dari 120. */
    batasLajuPerMenit: 60,
  },
};

export const MODE_SAH = new Set(Object.keys(PROFIL));

/* ══ PENYIMPANAN ═══════════════════════════════════════════════════════════ */

/** Nama tabel pengaturan. Satu baris, kunci unik. */
export function siapkanTabelPengaturan(handle = getDb()) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS sentinel_pengaturan (
      kunci       TEXT PRIMARY KEY,
      nilai       TEXT NOT NULL,
      diperbarui_at INTEGER NOT NULL
    );
  `);
}

const KUNCI_MODE = 'mode';

/* ══ CACHE ═════════════════════════════════════════════════════════════════ */

/**
 * Cache mode, supaya jalur panas tidak menanyai database setiap saat.
 *
 * ── KENAPA ADA CACHE SAMA SEKALI ────────────────────────────────────────────
 * `modeSekarang()` dipanggil di jalur yang sering dilewati: setiap webhook
 * masuk, setiap percobaan pengiriman. Membaca database SQLite memang cepat,
 * tapi jalur panas sebaiknya tidak menambah I/O yang bisa dihindari.
 *
 * ── KENAPA TTL-NYA PENDEK ───────────────────────────────────────────────────
 * Cache yang tidak pernah kedaluwarsa berarti perubahan mode dari proses lain
 * (mis. lewat CLI admin) tidak akan terlihat sampai service di-restart — dan
 * itu persis masalah yang ingin dihindari dengan menyimpan di database.
 *
 * 2 detik: perubahan terasa "seketika" bagi manusia, tapi jalur panas tetap
 * hemat.
 */
const TTL_CACHE_MS = 2000;
let cache = { nilai: null, dibacaAt: 0 };

/** Paksa baca ulang pada panggilan berikutnya. Dipakai setelah menulis mode. */
export function lupakanCache() {
  cache = { nilai: null, dibacaAt: 0 };
}

/* ══ BACA & TULIS ══════════════════════════════════════════════════════════ */

/** Nama mode yang sedang aktif. Default 'normal'. */
export function modeSekarang(sekarang = Date.now()) {
  if (cache.nilai && sekarang - cache.dibacaAt < TTL_CACHE_MS) return cache.nilai;

  let mode = 'normal';
  try {
    const baris = getDb()
      .prepare('SELECT nilai FROM sentinel_pengaturan WHERE kunci = ?')
      .get(KUNCI_MODE);

    // ── MODE TIDAK DIKENAL DIANGGAP NORMAL ──────────────────────────────────
    // Kalau barisnya berisi nama mode yang tidak ada (mis. sisa dari versi
    // lama), memakai PROFIL[mode] akan menghasilkan undefined dan SEMUA
    // pembacaan nilai melempar. Jatuh ke 'normal' membuat layanan tetap
    // jalan, dan itu yang benar: mode tidak dikenal bukan alasan untuk
    // menolak webhook.
    if (baris?.nilai && MODE_SAH.has(baris.nilai)) mode = baris.nilai;
  } catch {
    // Tabel belum ada (mis. saat tes yang tidak menyiapkannya) → default.
  }

  cache = { nilai: mode, dibacaAt: sekarang };
  return mode;
}

/**
 * Ubah mode.
 *
 * @returns {{ ok: boolean, mode?: string, alasan?: string }}
 */
export function setMode(modeBaru) {
  if (!MODE_SAH.has(modeBaru)) {
    return { ok: false, alasan: 'mode_tidak_dikenal' };
  }

  try {
    getDb()
      .prepare(`
        INSERT INTO sentinel_pengaturan (kunci, nilai, diperbarui_at)
        VALUES (?, ?, ?)
        ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diperbarui_at = excluded.diperbarui_at
      `)
      .run(KUNCI_MODE, modeBaru, Date.now());
  } catch (err) {
    return { ok: false, alasan: 'gagal_menyimpan', pesan: err?.message ?? String(err) };
  }

  // ── CACHE DILUPAKAN SEGERA ──────────────────────────────────────────────────
  // Tanpa ini, perubahan mode baru berlaku setelah TTL habis. Operator yang
  // baru menekan tombol akan mengira tombolnya tidak bekerja.
  lupakanCache();

  return { ok: true, mode: modeBaru };
}

/* ══ NILAI EFEKTIF ═════════════════════════════════════════════════════════ */

/**
 * Ambil satu nilai dari profil yang sedang aktif.
 *
 * Dipakai di jalur panas, jadi ia sengaja sederhana: baca mode (dari cache),
 * lalu ambil nilainya.
 *
 * @param {string} kunci  nama nilai, mis. 'toleransiTandaTanganDetik'
 */
export function nilai(kunci) {
  const profil = PROFIL[modeSekarang()];
  const v = profil[kunci];

  // ── NILAI YANG TIDAK ADA DIKEMBALIKAN SEBAGAI undefined ──────────────────
  // Bukan dilempar, bukan dikembalikan sebagai 0. `undefined` membuat
  // pemanggil yang memakai nilai default (`?? 300`) tetap bekerja, sedangkan
  // `0` akan membuat pemeriksaan "selisih > 0" menolak SEMUA permintaan.
  //
  // Kesalahan ketik nama kunci tidak boleh menjadi penguncian total.
  return v;
}

/**
 * Ringkasan untuk ditampilkan di inspector.
 *
 * ── KENAPA NILAI EFEKTIF IKUT DIKEMBALIKAN ──────────────────────────────────
 * Yang perlu diketahui operator bukan hanya "mode apa yang aktif", tapi
 * "angka apa yang sedang berlaku". Tanpa itu, ia harus membuka kode untuk
 * tahu apa arti perbedaan kedua mode.
 */
export function ringkasMode() {
  const aktif = modeSekarang();
  return {
    mode: aktif,
    label: PROFIL[aktif].label,
    keterangan: PROFIL[aktif].keterangan,
    nilai: { ...PROFIL[aktif] },

    // ── NILAI KEDUA MODE IKUT DIKIRIM ─────────────────────────────────────────
    // Inspector menampilkan tabel perbandingan "Normal vs Pro". Kalau hanya
    // nilai mode aktif yang dikirim, kolom mode lain harus ditulis ulang di
    // frontend — dan angka yang diketik ulang akan berbeda dari kenyataan
    // begitu ada yang mengubahnya di backend.
    //
    // Dikirim dari sini: satu sumber kebenaran.
    semuaNilai: Object.fromEntries(
      Object.entries(PROFIL).map(([id, p]) => [id, { ...p }]),
    ),

    tersedia: Object.entries(PROFIL).map(([id, p]) => ({
      id,
      label: p.label,
      keterangan: p.keterangan,
      aktif: id === aktif,
    })),
  };
}
