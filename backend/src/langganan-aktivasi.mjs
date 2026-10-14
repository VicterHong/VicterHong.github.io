/**
 * AKTIVASI LANGGANAN — dari pembayaran jadi paket aktif.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA MODUL INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Webhook Midtrans sudah menerbitkan TOKEN AKSES saat pembayaran berhasil —
 * itu bagian lama yang sudah bekerja. Tapi token saja tidak cukup: paket
 * pengguna dibaca dari tabel `langganan` (lihat akses-proyek.mjs), dan tabel
 * itu TIDAK PERNAH DIISI.
 *
 * Akibatnya, sebelum modul ini ada: pengguna yang sudah membayar tetap
 * dianggap GRATIS. Dia bisa membuka halaman /klien, tapi semua proyek
 * terkunci dan dia tidak bisa membuat token. Uangnya masuk, aksesnya tidak.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PERPANJANGAN: DITAMBAH, BUKAN DITIMPA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kalau pengguna membayar lagi saat langganannya masih berjalan (mis. bulan
 * kedua), yang benar adalah MENAMBAH masa aktif — bukan menggantinya.
 *
 * Contoh: langganan berjalan sampai 20 November, dia bayar lagi tanggal 15.
 *   Salah: selesai_at = 15 Desember (dia kehilangan 5 hari yang sudah dibayar)
 *   Benar: selesai_at = 20 Desember (masa aktifnya bersambung)
 *
 * Modul ini menghitung dari `selesai_at` yang PALING AKHIR, bukan dari
 * sekarang — jadi tidak ada hari yang hilang.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * IDEMPOTEN: SATU PEMBAYARAN, SATU LANGGANAN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Midtrans bisa mengirim webhook yang sama lebih dari sekali (kalau balasan
 * kita lambat atau gagal). Kalau setiap webhook menambah masa aktif, pembeli
 * bisa mendapat 2× masa aktif dari 1× pembayaran.
 *
 * Modul ini mencatat `payment_id` di baris langganan. Kalau pembayaran itu
 * sudah pernah diaktifkan, permintaan kedua diabaikan — dan itu ditegakkan
 * oleh UNIQUE di database, bukan hanya oleh pemeriksaan kode.
 */

import { randomUUID } from 'node:crypto';

import { getDb, now } from './db.mjs';
import { PAKET_BERBAYAR } from './langganan.mjs';

/** Berapa hari masa aktif per periode. Sama dengan masa berlaku token. */
const MASA_HARI = {
  bulanan: 35,   // 30 + 5 hari tenggang
  tahunan: 370,  // 365 + 5
};

/**
 * Cari pengguna dari email.
 *
 * ── KENAPA LEWAT EMAIL, BUKAN USER_ID ──────────────────────────────────────
 * Pembayaran Midtrans tidak tahu `user_id` — yang dikirim pembeli adalah
 * emailnya. Jadi email adalah satu-satunya penghubung antara pembayaran dan
 * akun.
 *
 * ── KENAPA `normalEmail()` DIPAKAI ─────────────────────────────────────────
 * Email dari Midtrans bisa berbeda huruf besar/kecilnya dari yang didaftarkan
 * (mis. "Budi@Gmail.com" vs "budi@gmail.com"). Tanpa normalisasi, pencarian
 * gagal dan pembeli tidak mendapat aksesnya — padahal akunnya ada.
 */
function cariPenggunaDariEmail(email) {
  if (!email) return null;
  const bersih = String(email).trim().toLowerCase();
  return getDb()
    .prepare('SELECT id, email, nama FROM users WHERE lower(email) = ? AND status = ?')
    .get(bersih, 'aktif') ?? null;
}

/**
 * Aktifkan atau perpanjang langganan dari pembayaran yang sudah dibayar.
 *
 * Mengembalikan `{ aktif, langganan, pengguna, diperpanjang, pesan }`.
 *
 * `aktif: false` berarti langganan TIDAK dibuat — dan `pesan` menjelaskan
 * kenapa. Pemanggil harus mencatatnya, karena itu berarti pembeli sudah
 * membayar tapi belum bisa memakai aksesnya.
 */
export function aktifkanLangganan({ paymentId, email, paket, periode = 'bulanan', nama = '' }) {
  const db = getDb();

  // ── 1. Paket harus dikenal ────────────────────────────────────────────────
  const paketBersih = String(paket || '').toLowerCase().trim();
  if (!PAKET_BERBAYAR.has(paketBersih)) {
    return {
      aktif: false,
      pesan: `Paket "${paket}" tidak dikenal. Langganan tidak dibuat.`,
    };
  }

  // ── 2. Periode harus dikenal ──────────────────────────────────────────────
  const periodeBersih = MASA_HARI[periode] ? periode : 'bulanan';
  const hari = MASA_HARI[periodeBersih];

  // ── 3. Pengguna harus ada ─────────────────────────────────────────────────
  // Kalau tidak ada, pembeli membayar dengan email yang belum terdaftar.
  // Langganannya tidak bisa dibuat — dan itu harus terlihat, bukan diam-diam.
  const pengguna = cariPenggunaDariEmail(email);
  if (!pengguna) {
    return {
      aktif: false,
      pesan: `Tidak ada akun aktif dengan email "${email}". Pembeli perlu mendaftar dulu dengan email itu.`,
    };
  }

  // ── 4. Sudah pernah diaktifkan? ───────────────────────────────────────────
  // Webhook Midtrans bisa datang dua kali. Tanpa pemeriksaan ini, satu
  // pembayaran menambah masa aktif dua kali.
  if (paymentId) {
    const sudah = db
      .prepare('SELECT id, selesai_at FROM langganan WHERE payment_id = ?')
      .get(paymentId);
    if (sudah) {
      return {
        aktif: true,
        langganan: sudah,
        pengguna,
        diperpanjang: false,
        pesan: 'Pembayaran ini sudah pernah diaktifkan.',
      };
    }
  }

  // ── 5. Hitung awal masa aktif ─────────────────────────────────────────────
  //
  // ── KENAPA DARI `selesai_at` TERAKHIR, BUKAN DARI SEKARANG ───────────────
  // Perpanjangan harus BERSAMBUNG. Kalau langganan berjalan sampai 20 Nov dan
  // pembeli memperpanjang tanggal 15, masa aktif barunya mulai 20 Nov —
  // bukan 15 Nov. Kalau mulai dari sekarang, 5 hari yang sudah dia bayar
  // hilang.
  //
  // Kalau langganan sebelumnya sudah lewat, baru mulai dari sekarang.
  const terakhir = db.prepare(`
    SELECT selesai_at FROM langganan
    WHERE user_id = ? AND status = 'aktif'
    ORDER BY selesai_at DESC LIMIT 1
  `).get(pengguna.id);

  const sekarang = now();
  const mulaiDari = terakhir?.selesai_at && terakhir.selesai_at > sekarang
    ? terakhir.selesai_at
    : sekarang;

  const selesaiAt = mulaiDari + hari * 24 * 60 * 60 * 1000;

  // ── 6. Tandai langganan lama sebagai digantikan ───────────────────────────
  //
  // ── KENAPA DITANDAI, BUKAN DIHAPUS ────────────────────────────────────────
  // Riwayat langganan dibutuhkan saat ada sengketa tagihan: "bulan lalu saya
  // bayar paket apa?". Menghapusnya berarti kehilangan jawaban itu.
  //
  // `status = 'diperpanjang'` membedakannya dari 'berakhir' (habis waktu)
  // dan 'dibatalkan' (berhenti atas permintaan).
  db.prepare(`
    UPDATE langganan SET status = 'diperpanjang'
    WHERE user_id = ? AND status = 'aktif'
  `).run(pengguna.id);

  // ── 7. Buat baris langganan baru ──────────────────────────────────────────
  const id = randomUUID();

  try {
    db.prepare(`
      INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at, payment_id)
      VALUES (?, ?, ?, ?, ?, ?, 'aktif', ?, ?)
    `).run(id, pengguna.id, paketBersih, periodeBersih, mulaiDari, selesaiAt, sekarang, paymentId || null);
  } catch (err) {
    // UNIQUE(payment_id) menolak kalau dua webhook datang BERSAMAAN — kasus
    // yang tidak tertangkap pemeriksaan di langkah 4, karena keduanya membaca
    // "belum ada" sebelum salah satunya menulis.
    //
    // Ini yang membuat idempotensinya benar-benar terjaga: database yang
    // memutuskan, bukan kode.
    if (/UNIQUE/i.test(err.message)) {
      return {
        aktif: true,
        langganan: db.prepare('SELECT id, selesai_at FROM langganan WHERE payment_id = ?').get(paymentId),
        pengguna,
        diperpanjang: false,
        pesan: 'Pembayaran ini sudah diaktifkan oleh permintaan lain.',
      };
    }
    throw err;
  }

  const diperpanjang = mulaiDari > sekarang;

  return {
    aktif: true,
    langganan: { id, paket: paketBersih, periode: periodeBersih, mulai_at: mulaiDari, selesai_at: selesaiAt },
    pengguna,
    diperpanjang,
    pesan: diperpanjang
      ? `Langganan ${paketBersih} diperpanjang ${hari} hari untuk ${pengguna.email}.`
      : `Langganan ${paketBersih} aktif ${hari} hari untuk ${pengguna.email}.`,
  };
}

/**
 * Ringkasan langganan seorang pengguna — untuk ditampilkan di halaman pesanan.
 */
export function langgananPengguna(userId) {
  if (!userId) return null;

  const aktif = getDb().prepare(`
    SELECT paket, periode, mulai_at, selesai_at FROM langganan
    WHERE user_id = ? AND status = 'aktif' AND (selesai_at IS NULL OR selesai_at > ?)
    ORDER BY selesai_at DESC LIMIT 1
  `).get(userId, now());

  if (!aktif) return null;

  const sisaHari = aktif.selesai_at
    ? Math.max(0, Math.ceil((aktif.selesai_at - now()) / (24 * 60 * 60 * 1000)))
    : null;

  return { ...aktif, sisaHari };
}
