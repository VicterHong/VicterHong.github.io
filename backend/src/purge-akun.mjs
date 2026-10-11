/**
 * Pembersih akun dalam masa tenggang.
 *
 * ── KENAPA MODUL TERPISAH, BUKAN DI DALAM auth-routes.mjs ───────────────────
 *
 * Penghapusan permanen adalah operasi yang TIDAK BISA DIBATALKAN. Ia harus:
 *   • Bisa diuji tanpa menyalakan server HTTP
 *   • Bisa dijalankan manual oleh operator (mis. untuk audit)
 *   • Punya satu tempat yang jelas dibaca saat ada pertanyaan "apa yang dihapus?"
 *
 * Menaruhnya di dalam handler HTTP berarti satu-satunya cara mengujinya adalah
 * lewat request — dan satu-satunya cara menjalankannya adalah menunggu jadwal.
 *
 * ── URUTAN YANG BENAR (dan kenapa urutannya penting) ────────────────────────
 *
 *   1. Anonymize pembayaran  → retensi pajak WAJIB, tapi PII harus hilang
 *   2. Bersihkan audit       → IP + user-agent adalah data pribadi (Recital 30)
 *   3. Hapus data pribadi    → identitas, sesi, token, 2FA
 *   4. Hapus baris users     → induk terakhir
 *
 * Kalau urutannya dibalik, langkah 3 dan 4 kehilangan data yang dibutuhkan
 * untuk menemukan baris di langkah 1 dan 2.
 */

import { getDb, transaction, now } from './db.mjs';
import { recordEvent } from './audit.mjs';

/** Masa tenggang dalam hari. */
export const HARI_TENGGANG = 30;

const HARI_MS = 24 * 60 * 60 * 1000;

/**
 * Email pengganti untuk data yang di-anonymize.
 *
 * ── KENAPA `.invalid` ──────────────────────────────────────────────────────
 *
 * RFC 6761 menetapkan `.invalid` sebagai TLD yang DIJAMIN tidak akan pernah
 * ada. Kalau ada bug yang mengirim email ke alamat ini, tidak ada orang
 * sungguhan yang menerimanya.
 *
 * Memakai domain sungguhan berisiko: kalau domainnya nanti terdaftar, email
 * bisa sampai ke orang yang salah — dan itu kebocoran data.
 */
export const EMAIL_ANON = 'dihapus@erased.invalid';

/** Akun yang sudah lewat masa tenggang. */
export function akunSiapHapus(batas = now() - HARI_TENGGANG * HARI_MS) {
  return getDb().prepare(`
    SELECT id, email, token_id, nama, dihapus_pada
    FROM users
    WHERE status = 'menunggu_hapus'
      AND dihapus_pada IS NOT NULL
      AND dihapus_pada <= ?
  `).all(batas);
}

/**
 * Hapus permanen satu akun.
 *
 * ── KENAPA SATU TRANSAKSI ───────────────────────────────────────────────────
 *
 * Kalau ada kegagalan di tengah (mis. kolom tidak ada karena migrasi gagal),
 * seluruh penghapusan dibatalkan. Hasilnya: tidak ada data setengah terhapus
 * yang sulit dibersihkan manual.
 *
 * ── KENAPA PENGUMPULAN TOKEN DIPISAH ────────────────────────────────────────
 *
 * Satu pengguna bisa punya BANYAK token: satu di `users.token_id`, dan
 * sisanya di tabel `tokens` (per perangkat, per integrasi API). Memakai satu
 * token saja meninggalkan sesi di perangkat lain tetap hidup.
 *
 * Bug ini pernah terjadi: akun terhapus, tapi sesi di perangkat kedua masih
 * bisa masuk. Ditemukan lewat uji end-to-end dengan akun ber-token dua.
 */
export function hapusAkunPermanen(userId) {
  const db = getDb();

  const pengguna = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!pengguna) return { dihapus: false, alasan: 'tidak_ada' };

  return transaction(() => {
    const email = pengguna.email;
    const uid = pengguna.id;

    // ── 1. SEMUA TOKEN MILIK PENGGUNA INI ──────────────────────────────────
    const semuaToken = new Set();
    if (pengguna.token_id) semuaToken.add(pengguna.token_id);
    for (const r of db.prepare('SELECT id FROM tokens WHERE issued_to = ?').all(email)) {
      if (r.id) semuaToken.add(r.id);
    }

    // ── 2. PEMBAYARAN — ANONYMIZE, JANGAN HAPUS ────────────────────────────
    //
    // Hukum pajak mewajibkan catatan transaksi disimpan (Indonesia: UU KUP
    // Pasal 28; EU: 7 tahun). GDPR sendiri MENGIZINKAN pengecualian ini
    // (Pasal 17(3)).
    //
    // Yang dihapus: identitas pembeli (email, nama).
    // Yang disimpan: jumlah, tanggal, tier — untuk pembukuan.
    const bayarDiubah = db.prepare(`
      UPDATE payments SET email = ?, nama = '' WHERE email = ?
    `).run(EMAIL_ANON, email).changes;

    // ── 3. AUDIT — IP DAN USER-AGENT JUGA DATA PRIBADI ─────────────────────
    //
    // GDPR Recital 30: IP address dan user-agent mengidentifikasi orang.
    // Menyimpannya berarti hak penghapusan belum dipenuhi, walaupun token_id
    // sudah diputus.
    //
    // Catatannya TETAP ADA — jejak keamanan mungkin dibutuhkan untuk
    // investigasi. Yang hilang adalah identitasnya.
    let auditDiubah = 0;
    for (const t of semuaToken) {
      auditDiubah += db.prepare(`
        UPDATE access_events SET token_id = NULL, ip = '', user_agent = ''
        WHERE token_id = ?
      `).run(t).changes;

      db.prepare(`
        UPDATE analytics_events SET token_id = NULL WHERE token_id = ?
      `).run(t);
    }

    // ── 4. DATA PRIBADI — ANAK DULU, INDUK TERAKHIR ────────────────────────
    db.prepare('DELETE FROM auth_identities WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(uid);

    for (const t of semuaToken) {
      db.prepare('DELETE FROM device_fingerprints WHERE token_id = ?').run(t);
      db.prepare('DELETE FROM sessions WHERE token_id = ?').run(t);
      db.prepare('DELETE FROM revocations WHERE token_id = ?').run(t);
      db.prepare('DELETE FROM consents WHERE token_id = ?').run(t);
    }

    // ── 5. 2FA — PAKAI `identity` (EMAIL), BUKAN `user_id` ─────────────────
    //
    // Tabel-tabel TOTP memakai kolom `identity` yang berisi email.
    // Diperiksa lewat PRAGMA table_info, bukan dari ingatan — asumsi pertama
    // saya (`user_id`) akan gagal karena kolomnya tidak ada.
    db.prepare('DELETE FROM totp_secrets WHERE identity = ?').run(email);
    db.prepare('DELETE FROM totp_recovery WHERE identity = ?').run(email);
    db.prepare('DELETE FROM totp_attempts WHERE identity = ?').run(email);

    // ── 6. SALES LEADS ─────────────────────────────────────────────────────
    db.prepare('DELETE FROM sales_leads WHERE email = ?').run(email);

    // ── 7. TOKEN AKSES ─────────────────────────────────────────────────────
    //
    // Token masih bisa dipakai mengakses API. Membiarkannya berarti akun
    // "sudah dihapus" tapi token-nya masih hidup.
    db.prepare('DELETE FROM tokens WHERE issued_to = ?').run(email);

    // ── 8. INDUK TERAKHIR ──────────────────────────────────────────────────
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);

    return {
      dihapus: true,
      email,
      pembayaranDiAnonymize: bayarDiubah,
      auditDibersihkan: auditDiubah,
      tokenDihapus: semuaToken.size,
    };
  });
}

/**
 * Jalankan pembersihan untuk semua akun yang sudah lewat masa tenggang.
 *
 * ── KENAPA MENGEMBALIKAN RINGKASAN, BUKAN void ─────────────────────────────
 *
 * Pemanggilnya (penjadwal di server) mencatat hasilnya ke log. Tanpa
 * ringkasan, log hanya bisa bilang "selesai" — dan operator tidak tahu
 * berapa akun yang diproses atau apakah ada yang gagal.
 */
export function bersihkanAkunKedaluwarsa() {
  // ── MEMAKAI akunSiapHapusOtomatis(), BUKAN akunSiapHapus() ─────────────────
  //
  // `akunSiapHapus()` hanya melihat akun `menunggu_hapus` yang lewat 30 hari.
  // Itu model LAMA (langsung hapus dengan masa tenggang pendek).
  //
  // Model korporat punya DUA jalur:
  //   1. Admin sudah menyetujui (status `siap_hapus`) → hapus segera
  //   2. Lewat 12 bulan nonaktif → hapus otomatis
  //
  // Memakai fungsi lama berarti akun yang sudah disetujui admin TIDAK PERNAH
  // terhapus — dan itu membuat tombol "Setujui" di panel admin tidak
  // berpengaruh apa pun.
  const siap = akunSiapHapusOtomatis();
  const hasil = { total: siap.length, berhasil: 0, gagal: 0, rincian: [] };

  for (const akun of siap) {
    try {
      const r = hapusAkunPermanen(akun.id);

      // ── CATAT KE AUDIT SETELAH PENGHAPUSAN ───────────────────────────────
      //
      // Tanpa token_id: akunnya sudah tidak ada, dan menyimpan token_id akan
      // membuat catatan ini bisa dikaitkan kembali ke orangnya.
      //
      // `jalur` dicatat supaya auditor bisa membedakan penghapusan karena
      // persetujuan manusia vs karena masa tunggu habis.
      recordEvent({
        tokenId: null,
        action: 'akun_dihapus_permanen',
        outcome: 'ok',
        detail: `${akun.disetujui_oleh ? 'disetujui ' + akun.disetujui_oleh : 'otomatis ' + BULAN_OTOMATIS + ' bulan'}; `
          + `${r.pembayaranDiAnonymize} pembayaran di-anonymize, ${r.auditDibersihkan} audit dibersihkan`,
      });

      hasil.berhasil++;
      hasil.rincian.push({ id: akun.id, status: 'ok' });
    } catch (err) {
      // ── SATU GAGAL TIDAK MENGHENTIKAN SISANYA ─────────────────────────────
      //
      // Kalau akun ke-3 gagal, akun ke-4 sampai terakhir tetap diproses.
      // Menghentikan seluruh batch karena satu kegagalan berarti akun-akun
      // lain tetap tertahan melewati batas GDPR.
      hasil.gagal++;
      hasil.rincian.push({ id: akun.id, status: 'gagal', pesan: err?.message ?? String(err) });
      console.error(`[purge] gagal hapus ${akun.id}:`, err?.message ?? err);

      recordEvent({
        tokenId: null,
        action: 'akun_hapus_gagal',
        outcome: 'galat',
        detail: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  return hasil;
}

/**
 * Batalkan permintaan hapus — kembalikan akun ke aktif.
 *
 * ── KENAPA TIDAK MEMERIKSA KODE DI SINI ────────────────────────────────────
 *
 * Verifikasi kode adalah urusan lapisan HTTP (butuh request, rate limit, dan
 * pencatatan IP). Fungsi ini hanya melakukan PERUBAHANNYA.
 *
 * Memisahkan keduanya berarti logika pembatalan bisa diuji tanpa HTTP — dan
 * itu penting untuk jalur yang menentukan apakah akun diselamatkan atau tidak.
 */
export function batalkanHapus(userId) {
  const db = getDb();
  const info = db.prepare(`
    UPDATE users SET status = 'aktif', dihapus_pada = NULL, alasan_hapus = ''
    WHERE id = ? AND status = 'menunggu_hapus'
  `).run(userId);

  return { dibatalkan: info.changes > 0 };
}

/** Sisa hari sampai penghapusan permanen. `null` kalau tidak menunggu hapus. */
export function sisaHariHapus(dihapusPada) {
  if (!dihapusPada) return null;
  const batasMs = Number(dihapusPada) + HARI_TENGGANG * HARI_MS;
  const sisaMs = batasMs - now();

  // ── KENAPA `Math.ceil` ───────────────────────────────────────────────────
  // `floor` menampilkan "29 hari" untuk permintaan yang baru dibuat 1 jam
  // lalu — lebih kecil dari kenyataan, dan membuat pengguna merasa lebih
  // terburu-buru daripada yang sebenarnya.
  if (sisaMs <= 0) return 0;
  return Math.ceil(sisaMs / HARI_MS);
}

// ══ PEMERIKSAAN LANGGANAN ══════════════════════════════════════════════════════
//
// ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────────────
//
// Versi pertama memakai status pembayaran YANG TIDAK ADA:
//
//   Kode saya:   status IN ('lunas', 'aktif', 'menunggu')
//   Sebenarnya:  'pending', 'dibayar', 'gagal', 'kedaluwarsa', 'dikembalikan'
//
// NOL dari tiga status itu cocok — jadi pemeriksaannya SELALU mengembalikan 0,
// dan pengguna dengan langganan aktif TETAP BISA menghapus akunnya.
//
// ── KENAPA ITU BERBAHAYA ──────────────────────────────────────────────────────
//
// Kalau akun dihapus sementara langganan berjalan:
//   • Pengguna tetap DITAGIH setiap bulan
//   • Tapi sudah kehilangan akses untuk membatalkannya
//   • Token akses API mereka juga terhapus
//   • Mereka harus menghubungi dukungan — dan mungkin sudah telanjur
//     ditagih beberapa kali sebelum menyadarinya
//
// ── KENAPA STATUS DIIMPOR, BUKAN DITULIS ULANG ────────────────────────────────
//
// Menulis `'dibayar'` sebagai string berarti dua tempat bisa menyimpang:
// perubahan nama di checkout.mjs tidak akan terlihat di sini, dan
// pemeriksaannya diam-diam berhenti bekerja.
import { STATUS as STATUS_BAYAR } from './checkout.mjs';

/**
 * Apakah pengguna punya langganan/tagihan yang menghalangi penghapusan?
 *
 * ── KENAPA `pending` IKUT MENGHALANGI ─────────────────────────────────────────
 *
 * Tagihan `pending` MASIH BISA DIBAYAR. Kalau akun dihapus saat tagihan
 * menggantung:
 *   • Pengguna membayar tagihan yang tidak lagi bisa diakses
 *   • Uang masuk tanpa layanan
 *   • Refund manual — memakan waktu dukungan
 *
 * ── KENAPA `gagal` DAN `kedaluwarsa` TIDAK MENGHALANGI ────────────────────────
 *
 * Keduanya sudah SELESAI — tidak ada uang yang akan berpindah, tidak ada
 * kewajiban tersisa. Menghalangi penghapusan karena percobaan bayar yang gagal
 * berarti mengunci pengguna selamanya hanya karena satu transaksi tidak jadi.
 *
 * ── KENAPA `dikembalikan` TIDAK MENGHALANGI ───────────────────────────────────
 *
 * Refund sudah selesai — uangnya sudah kembali.
 */
export function adaLanggananAktif(email, { sekarang = now() } = {}) {
  const baris = getDb().prepare(`
    SELECT id, status, tier, kedaluwarsa_pada FROM payments
    WHERE email = ? AND status IN (?, ?)
  `).all(email, STATUS_BAYAR.PENDING, STATUS_BAYAR.DIBAYAR);

  // ── PEMBAYARAN LAMA TIDAK MENGHALANGI ──────────────────────────────────────
  //
  // Pembayaran yang masa berlakunya sudah lewat bukan langganan aktif. Tanpa
  // pemeriksaan tanggal, pengguna yang pernah berlangganan 2 tahun lalu tidak
  // akan pernah bisa menghapus akunnya.
  //
  // `kedaluwarsa_pada` NULL berarti tidak ada batas waktu — diperlakukan
  // sebagai aktif, karena itu artinya langganan berjalan tanpa akhir.
  const aktif = baris.filter((b) => {
    if (!b.kedaluwarsa_pada) return true;
    return Number(b.kedaluwarsa_pada) > sekarang;
  });

  return { ada: aktif.length > 0, jumlah: aktif.length, rincian: aktif };
}

// ══ MODEL KORPORAT: NONAKTIF → PERSETUJUAN → HAPUS ═════════════════════════════
//
// ── KENAPA BUKAN "KLIK HAPUS → LANGSUNG HILANG" ───────────────────────────────
//
// Sistem korporat tidak pernah menghapus akun langsung. Alasannya bukan
// birokrasi — ada kerugian nyata yang dicegah:
//
//   • Klik salah / akun diretas → data hilang permanen, tidak bisa kembali
//   • Sengketa pembayaran berjalan → bukti transaksi hilang
//   • Investigasi penyalahgunaan → jejak dihapus sebelum diperiksa
//   • Akun diperebutkan kepemilikannya → pihak yang kalah menghapus datanya
//
// Manusia (CS/admin) bisa membedakan "pengguna ingin pergi" dari "penyerang
// ingin menghapus jejak". Otomatisasi tidak bisa.
//
// ── TIGA JALUR KELUAR ─────────────────────────────────────────────────────────
//
//   1. Admin menyetujui  → cepat, untuk permintaan yang jelas
//   2. Admin menolak     → akun kembali aktif, pengguna diberi tahu alasannya
//   3. Lewat 12 bulan    → otomatis, untuk akun yang benar-benar ditinggalkan
//
// Jalur 3 wajib ada: tanpa itu, akun yang tidak pernah ditinjau menumpuk
// selamanya — melanggar prinsip penyimpanan terbatas GDPR (Pasal 5(1)(e)).

/**
 * Masa tenggang otomatis, dalam bulan.
 *
 * ── KENAPA 12 BULAN ───────────────────────────────────────────────────────────
 *
 * Cukup lama untuk:
 *   • Pengguna berubah pikiran dan memulihkan akunnya
 *   • Admin meninjau tanpa terburu-buru
 *   • Siklus penagihan tahunan selesai
 *
 * Cukup pendek untuk:
 *   • Tidak melanggar prinsip penyimpanan terbatas
 *   • Tidak menyimpan data orang yang sudah lama pergi
 *
 * Korporat besar memakai 30 hari (Google) sampai 12 bulan (layanan enterprise).
 * Untuk layanan dengan langganan tahunan, 12 bulan mencegah penghapusan di
 * tengah periode berbayar.
 */
export const BULAN_OTOMATIS = 12;

const BULAN_MS = 30 * HARI_MS;

/**
 * TAHAP 1 — Nonaktifkan akun (bukan hapus).
 *
 * ── KENAPA INI YANG DILAKUKAN SAAT PENGGUNA MINTA HAPUS ───────────────────────
 *
 * Ini titik di mana sistem korporat berbeda dari sistem sederhana. Permintaan
 * pengguna TIDAK langsung menghapus apa pun — ia mengubah STATUS.
 *
 * Akibatnya:
 *   • Akun langsung tidak bisa dipakai (login ditolak)
 *   • Data 100% utuh — bisa dipulihkan
 *   • Admin punya waktu meninjau
 *   • Pengguna yang berubah pikiran bisa membatalkan
 */
export function nonaktifkanAkun(userId, alasan = 'permintaan pengguna') {
  const db = getDb();
  const info = db.prepare(`
    UPDATE users
    SET status = 'menunggu_hapus', dihapus_pada = ?, alasan_hapus = ?
    WHERE id = ? AND status = 'aktif'
  `).run(now(), String(alasan).slice(0, 200), userId);

  return { dinonaktifkan: info.changes > 0 };
}

/**
 * TAHAP 2a — Admin menyetujui penghapusan.
 *
 * ── KENAPA PEMERIKSAAN LANGGANAN ADA DI SINI JUGA ─────────────────────────────
 *
 * Sudah diperiksa saat pengguna meminta (di endpoint hapus-mulai). Tapi waktu
 * bisa berjalan antara permintaan dan persetujuan — pengguna mungkin
 * berlangganan lagi, atau tagihan baru muncul.
 *
 * Memeriksa ULANG di titik persetujuan menutup celah itu. Ini juga alasan
 * admin manusia lebih baik dari otomatisasi: keadaan bisa berubah.
 *
 * ── KENAPA ADMIN TIDAK BISA MENYETUJUI AKUN YANG SUDAH DISETUJUI ──────────────
 *
 * Menyetujui dua kali tidak ada gunanya, dan menimpa `disetujui_oleh` akan
 * menghapus jejak siapa yang sebenarnya menyetujui lebih dulu.
 */
export function setujuiPenghapusan(userId, { oleh = '', catatan = '' } = {}) {
  const db = getDb();
  const pengguna = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!pengguna) return { disetujui: false, alasan: 'akun tidak ditemukan' };

  if (pengguna.status !== 'menunggu_hapus') {
    return {
      disetujui: false,
      alasan: pengguna.status === 'siap_hapus'
        ? 'sudah disetujui sebelumnya'
        : `status akun "${pengguna.status}" — hanya akun menunggu_hapus yang bisa disetujui`,
    };
  }

  // ── PERIKSA ULANG KEWAJIBAN BERJALAN ───────────────────────────────────────
  const langganan = adaLanggananAktif(pengguna.email);
  if (langganan.ada) {
    return {
      disetujui: false,
      alasan: `masih ada ${langganan.jumlah} langganan/tagihan aktif — selesaikan dulu`,
      langganan: langganan.rincian,
    };
  }

  const info = db.prepare(`
    UPDATE users
    SET status = 'siap_hapus', disetujui_oleh = ?, disetujui_pada = ?, catatan_admin = ?
    WHERE id = ? AND status = 'menunggu_hapus'
  `).run(String(oleh), now(), String(catatan).slice(0, 500), userId);

  if (info.changes > 0) {
    recordEvent({
      tokenId: pengguna.token_id,
      action: 'akun_hapus_disetujui',
      outcome: 'ok',
      detail: `oleh ${oleh || 'admin'}; ${catatan || 'tanpa catatan'}`,
    });
  }

  return { disetujui: info.changes > 0 };
}

/**
 * TAHAP 2b — Admin menolak penghapusan.
 *
 * ── KENAPA AKUN KEMBALI AKTIF, BUKAN TETAP NONAKTIF ───────────────────────────
 *
 * Kalau ditolak tapi akun tetap nonaktif, pengguna kehilangan akses tanpa
 * alasan yang jelas — dan itu lebih buruk daripada permintaan yang tidak
 * pernah diproses.
 *
 * Menolak berarti: "permintaan Anda ditinjau, dan untuk sekarang tidak
 * dikabulkan". Pengguna harus bisa memakai akunnya kembali.
 *
 * ── KENAPA `disetujui_oleh` DIISI DENGAN PENOLAK ──────────────────────────────
 *
 * Kolom itu mencatat SIAPA yang mengambil keputusan — baik menyetujui maupun
 * menolak. Auditor ingin tahu keduanya, bukan hanya persetujuan.
 */
export function tolakPenghapusan(userId, { oleh = '', alasan = '' } = {}) {
  const db = getDb();
  const pengguna = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!pengguna) return { ditolak: false, alasan: 'akun tidak ditemukan' };

  if (pengguna.status !== 'menunggu_hapus') {
    return { ditolak: false, alasan: `status akun "${pengguna.status}" — tidak ada permintaan untuk ditolak` };
  }

  const info = db.prepare(`
    UPDATE users
    SET status = 'aktif', dihapus_pada = NULL, alasan_hapus = '',
        disetujui_oleh = ?, disetujui_pada = ?, catatan_admin = ?
    WHERE id = ? AND status = 'menunggu_hapus'
  `).run(String(oleh), now(), String(alasan).slice(0, 500), userId);

  if (info.changes > 0) {
    recordEvent({
      tokenId: pengguna.token_id,
      action: 'akun_hapus_ditolak',
      outcome: 'ok',
      detail: `oleh ${oleh || 'admin'}: ${alasan || 'tanpa alasan'}`,
    });
  }

  return { ditolak: info.changes > 0, alasan };
}

/**
 * Akun yang siap dihapus permanen — dua jalur.
 *
 * ── JALUR 1: DISETUJUI ADMIN ──────────────────────────────────────────────────
 *
 * Begitu admin menyetujui, penghapusan bisa langsung jalan. Tidak perlu
 * menunggu 12 bulan — persetujuan manusia sudah menggantikan masa tunggu.
 *
 * ── JALUR 2: LEWAT 12 BULAN ───────────────────────────────────────────────────
 *
 * Tanpa persetujuan, akun dihapus otomatis setelah 12 bulan nonaktif.
 * Ini yang mencegah penumpukan akun yang tidak pernah ditinjau.
 *
 * ── KENAPA DUA JALUR, BUKAN SATU ──────────────────────────────────────────────
 *
 * Kalau hanya jalur 1: akun tanpa tinjauan menumpuk selamanya.
 * Kalau hanya jalur 2: permintaan yang jelas harus menunggu 12 bulan —
 * dan itu melanggar hak penghapusan GDPR (batas 1 bulan).
 */
export function akunSiapHapusOtomatis() {
  const batasOtomatis = now() - BULAN_OTOMATIS * BULAN_MS;

  return getDb().prepare(`
    SELECT id, email, token_id, nama, status, dihapus_pada, disetujui_oleh
    FROM users
    WHERE status = 'siap_hapus'
       OR (status = 'menunggu_hapus'
           AND dihapus_pada IS NOT NULL
           AND dihapus_pada <= ?)
  `).all(batasOtomatis);
}
