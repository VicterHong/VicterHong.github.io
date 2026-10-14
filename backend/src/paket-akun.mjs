/**
 * Paket yang sedang berlaku untuk sebuah akun — pencatatannya.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DISELESAIKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * `paketPengguna()` sudah mengembalikan 'gratis' kalau tidak ada baris
 * langganan. Jadi secara FUNGSI, default-nya sudah bekerja — pengguna baru
 * memang mendapat paket gratis.
 *
 * Yang tidak ada: JEJAKNYA. Paket gratis hanya dihitung saat dibaca, tidak
 * pernah dicatat. Akibatnya tiga pertanyaan ini tidak bisa dijawab:
 *
 *   1. "Sejak kapan akun ini memakai paket gratis?"
 *      `users.dibuat_at` bukan jawabannya — pengguna yang pernah berlangganan
 *      lalu berhenti tetap memakai gratis, tapi dibuat_at-nya jauh lebih awal.
 *
 *   2. "Siapa saja yang memakai paket gratis?"
 *      Tanpa baris, daftar itu tidak bisa dibuat. Yang bisa dihitung hanya
 *      "semua akun dikurangi yang berbayar" — dan itu salah untuk akun yang
 *      langganannya sudah habis tapi belum pernah dicatat kembali.
 *
 *   3. "Kenapa paket akun ini begini?"
 *      Saat ada masalah akun, tidak ada catatan yang bisa diperiksa.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TIDAK DITARUH DI TABEL `langganan`
 * ══════════════════════════════════════════════════════════════════════════════
 * Ini keputusan yang sudah dibuktikan sebelum kode ini ditulis. Menaruh baris
 * paket='gratis' di tabel langganan merusak dua hal:
 *
 *   1. PERPANJANGAN MENANDAI BARIS GRATIS
 *      `langganan-aktivasi.mjs` menjalankan:
 *        UPDATE langganan SET status = 'diperpanjang'
 *        WHERE user_id = ? AND status = 'aktif'
 *      tanpa memandang paket. Baris gratis ikut tertandai "diperpanjang".
 *
 *   2. PAKET YANG TERBACA BISA SALAH
 *      `paketPengguna()` mengambil baris dengan mulai_at PALING BARU. Kalau
 *      baris gratis dibuat setelah baris berbayar (misalnya pengguna login
 *      ulang), pengguna BERBAYAR akan terbaca sebagai GRATIS.
 *
 * Tabel langganan adalah catatan TRANSAKSI — payment_id, periode, selesai_at.
 * Paket gratis tidak punya satu pun dari ketiganya.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PRINSIP: PAKET BERBAYAR TIDAK PERNAH DIBACA DARI SINI
 * ══════════════════════════════════════════════════════════════════════════════
 * Tabel `paket_akun` hanya mencatat paket GRATIS. Paket berbayar selalu dibaca
 * dari tabel langganan.
 *
 * Dengan begitu tidak ada dua sumber yang bisa bertentangan: kalau langganan
 * berbayar habis waktunya, paketnya kembali gratis tanpa perlu ada yang
 * memperbarui tabel ini. Tidak ada pekerjaan terjadwal yang bisa gagal.
 */

import { getDb, now } from './db.mjs';

/**
 * Catat bahwa akun ini memakai paket gratis — kalau belum pernah dicatat.
 *
 * ── KENAPA "KALAU BELUM PERNAH", BUKAN SELALU DIPERBARUI ────────────────────
 * `mulai_at` harus tetap menunjukkan kapan akun ini PERTAMA memakai gratis.
 * Kalau setiap login menimpanya, tanggalnya terus bergeser dan pertanyaan
 * "sejak kapan?" tetap tidak terjawab.
 *
 * Yang diperbarui hanya `diperbarui_at` — itu menunjukkan kapan terakhir
 * dilihat, bukan kapan mulai.
 *
 * ── KENAPA TIDAK ERROR KALAU TABELNYA BERMASALAH ────────────────────────────
 * Fungsi ini dipanggil di jalur login. Kalau ia melempar error, pengguna
 * tidak bisa masuk — padahal kegagalannya hanya soal CATATAN, bukan soal hak
 * akses. Paket gratis tetap bekerja tanpa baris ini (paketPengguna()
 * mengembalikan 'gratis' sebagai default).
 *
 * Jadi kegagalan di sini dilaporkan, tapi tidak menghentikan login.
 *
 * @param {string} userId  id pengguna (UUID dari tabel users)
 * @returns {{dicatat: boolean, baru: boolean, alasan?: string}}
 */
export function catatPaketGratis(userId) {
  const id = String(userId ?? '').trim();
  if (!id) return { dicatat: false, baru: false, alasan: 'user_id kosong' };

  try {
    const db = getDb();
    const waktu = now();

    // Cari dulu, baru tulis — supaya `mulai_at` tidak pernah bergeser.
    const ada = db
      .prepare('SELECT user_id FROM paket_akun WHERE user_id = ?')
      .get(id);

    if (ada) {
      db.prepare('UPDATE paket_akun SET diperbarui_at = ? WHERE user_id = ?')
        .run(waktu, id);
      return { dicatat: true, baru: false };
    }

    db.prepare(`
      INSERT INTO paket_akun (user_id, paket, mulai_at, diperbarui_at)
      VALUES (?, 'gratis', ?, ?)
    `).run(id, waktu, waktu);

    return { dicatat: true, baru: true };
  } catch (err) {
    // Dilaporkan, tidak dilempar. Lihat catatan di atas.
    console.error('[paket-akun] gagal mencatat paket gratis:', err?.message ?? err);
    return { dicatat: false, baru: false, alasan: err?.message ?? String(err) };
  }
}

/**
 * Catatan paket gratis sebuah akun, atau null kalau belum pernah dicatat.
 *
 * ── KENAPA MENGEMBALIKAN null, BUKAN OBJEK KOSONG ───────────────────────────
 * "Belum pernah dicatat" dan "dicatat sebagai gratis" adalah dua keadaan yang
 * berbeda. Pemanggil perlu bisa membedakannya — misalnya halaman tagihan yang
 * ingin menulis "sejak <tanggal>" hanya kalau tanggalnya memang diketahui.
 */
export function paketAkunTercatat(userId) {
  const id = String(userId ?? '').trim();
  if (!id) return null;

  try {
    return getDb()
      .prepare('SELECT user_id, paket, mulai_at, diperbarui_at FROM paket_akun WHERE user_id = ?')
      .get(id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sejak kapan akun ini memakai paket gratis — dalam milidetik, atau null.
 *
 * Kalau belum pernah dicatat, hasilnya null. Pemanggil TIDAK boleh menebak
 * dengan memakai `users.dibuat_at`: pengguna yang pernah berlangganan lalu
 * berhenti memakai gratis jauh setelah akunnya dibuat.
 */
export function sejakKapanGratis(userId) {
  const baris = paketAkunTercatat(userId);
  return baris?.paket === 'gratis' ? baris.mulai_at : null;
}

/**
 * Apakah akun ini punya langganan berbayar yang sedang aktif?
 *
 * ── KENAPA DI SINI, BUKAN MEMANGGIL paketPengguna() ─────────────────────────
 * `paketPengguna()` ada di akses-proyek.mjs, dan auth-routes.mjs belum
 * mengimpornya. Menambah impor baru ke auth-routes berarti menambah satu lagi
 * ketergantungan di berkas yang sudah besar — dan ketergantungan itu bisa
 * melingkar kalau nanti akses-proyek butuh sesuatu dari auth-routes.
 *
 * Query-nya tiga baris. Menaruhnya di sini membuat modul ini berdiri sendiri:
 * ia hanya butuh db.mjs, dan tidak ada risiko melingkar.
 *
 * ── SYARAT YANG HARUS SAMA DENGAN paketPengguna() ───────────────────────────
 * Tiga syarat ini harus persis sama dengan yang dipakai paketPengguna():
 *   status = 'aktif'  ·  selesai_at NULL atau belum lewat  ·  paket berbayar
 *
 * Kalau berbeda, bisa terjadi keadaan di mana pencatatan mengira pengguna ini
 * gratis padahal aksesnya berbayar — dan tabel paket_akun terisi baris yang
 * salah. Karena itu keduanya diuji berdampingan.
 */
export function punyaLanggananBerbayar(userId) {
  const id = String(userId ?? '').trim();
  if (!id) return false;

  try {
    const baris = getDb().prepare(`
      SELECT paket FROM langganan
      WHERE user_id = ?
        AND status = 'aktif'
        AND (selesai_at IS NULL OR selesai_at > ?)
        AND paket IN ('standar', 'profesional', 'enterprise')
      LIMIT 1
    `).get(id, now());

    return Boolean(baris);
  } catch {
    // Kalau query gagal, jawabannya "tidak tahu". Untuk pemanggilnya, itu
    // sama dengan "jangan catat" — lebih baik tidak mencatat daripada
    // mencatat baris gratis untuk pengguna berbayar.
    return true;
  }
}

/** Berapa akun yang tercatat memakai paket gratis. */
export function jumlahPaketGratis() {
  try {
    return getDb()
      .prepare("SELECT COUNT(*) AS n FROM paket_akun WHERE paket = 'gratis'")
      .get().n;
  } catch {
    return 0;
  }
}
