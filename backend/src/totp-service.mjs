/**
 * 2FA berbasis TOTP — logika tingkat aplikasi.
 *
 * Modul ini menyambungkan `totp.mjs` (algoritma RFC 6238) ke database:
 * pendaftaran, verifikasi, kode pemulihan, dan audit percobaan.
 *
 * ── KEPUTUSAN DESAIN YANG PENTING ───────────────────────────────────────────
 *
 * 1. IDENTITAS = `issued_to`, BUKAN token.
 *    Satu klien bisa punya beberapa token (mis. proyek berbeda). 2FA-nya
 *    satu — terikat pada ORANGNYA, bukan pada tokennya. Kalau token
 *    diterbitkan ulang, klien tidak perlu daftar ulang authenticator.
 *
 * 2. ENROLLMENT HARUS DIBUKTIKAN.
 *    Secret dibuat dengan status `terverifikasi = 0`. 2FA baru benar-benar
 *    aktif setelah klien memasukkan satu kode yang benar dari
 *    authenticator-nya. Tanpa langkah ini, klien yang salah scan QR akan
 *    terkunci dari akunnya sendiri — dan tidak ada cara masuk.
 *
 * 3. DETEKSI REPLAY.
 *    Kode TOTP berlaku 30-90 detik. Kalau penyerang bisa membaca kode itu
 *    (mis. melihat layar, atau mencegat di jaringan), ia bisa memakainya
 *    lagi dalam jendela waktu yang sama. Kolom `langkah_terakhir` menolak
 *    kode yang langkah waktunya sudah pernah dipakai.
 *
 * 4. RATE LIMIT PER IDENTITAS.
 *    Kode 6 digit = 1 juta kemungkinan. Dengan jendela 90 detik, penyerang
 *    yang mencoba cepat punya peluang kecil — TAPI hanya kalau percobaan
 *    dibatasi. Tanpa batas, 1 juta percobaan bisa diselesaikan dalam
 *    hitungan menit. Batas: 5 percobaan gagal per 15 menit.
 *
 * 5. KODE PEMULIHAN SEKALI PAKAI.
 *    Setiap kode langsung ditandai terpakai saat berhasil. Kalau tidak,
 *    satu kode yang bocor bisa dipakai selamanya.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getDb, now } from './db.mjs';
import {
  buatSecret, buatTotp, verifikasiTotp, uriOtp,
  enkripsiSecret, dekripsiSecret, buatKodePemulihan, hashKodePemulihan,
  LANGKAH_DETIK,
} from './totp.mjs';

// ══ Pengaturan ═══════════════════════════════════════════════════════════════

const MAKS_GAGAL = 5;             // percobaan gagal sebelum diblokir sementara
const JENDELA_BLOKIR_MS = 15 * 60 * 1000;   // 15 menit
const JUMLAH_KODE_PEMULIHAN = 8;

// ══ Kunci enkripsi ═══════════════════════════════════════════════════════════

/**
 * Ambil SERVICE_SECRET dari config.
 *
 * Dipakai untuk menurunkan kunci enkripsi secret TOTP. Kalau secret ini
 * berubah, semua secret TOTP yang tersimpan menjadi tidak bisa dibaca —
 * karena itu modul ini MELEMPAR galat, bukan diam-diam memakai nilai
 * lemah. Lebih baik gagal jelas daripada mengunci semua klien tanpa
 * penjelasan.
 */
function ambilServiceSecret(config) {
  const s = config?.secret;
  if (!s || String(s).length < 16) {
    throw new Error('SERVICE_SECRET belum diset atau terlalu pendek (min 16 karakter)');
  }
  return String(s);
}

// ══ Audit ════════════════════════════════════════════════════════════════════

function catatPercobaan(identity, berhasil, alasan, ip) {
  try {
    getDb().prepare(
      `INSERT INTO totp_attempts (identity, berhasil, alasan, ip, dibuat_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(identity, berhasil ? 1 : 0, String(alasan).slice(0, 60), String(ip ?? '').slice(0, 60), now());
  } catch {
    // Audit tidak boleh menggagalkan login. Kalau pencatatan gagal,
    // verifikasi tetap berjalan — kehilangan satu baris audit jauh
    // lebih ringan daripada menolak klien yang kodenya benar.
  }
}

/**
 * Hitung percobaan gagal terakhir untuk satu identitas.
 *
 * Hanya menghitung yang GAGAL — percobaan berhasil tidak boleh ikut
 * menghitung, kalau tidak klien yang berhasil login beberapa kali
 * akan tiba-tiba diblokir.
 */
function percobaanGagalTerakhir(identity) {
  try {
    const batas = now() - JENDELA_BLOKIR_MS;
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM totp_attempts
       WHERE identity = ? AND berhasil = 0 AND dibuat_at >= ?`
    ).get(identity, batas);
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ══ Status ═══════════════════════════════════════════════════════════════════

/**
 * Apakah identitas ini punya 2FA aktif (sudah terverifikasi)?
 *
 * Hanya yang SUDAH TERVERIFIKASI dianggap aktif. Enrollment yang belum
 * selesai tidak boleh memblokir login — kalau memblokir, klien yang
 * gagal scan QR akan terkunci sebelum sempat mencoba.
 */
export function totpAktif(identity) {
  try {
    const row = getDb().prepare(
      `SELECT terverifikasi FROM totp_secrets WHERE identity = ?`
    ).get(String(identity));
    return row?.terverifikasi === 1;
  } catch {
    return false;
  }
}

/** Apakah ada enrollment yang belum selesai (menunggu verifikasi)? */
export function totpMenungguVerifikasi(identity) {
  try {
    const row = getDb().prepare(
      `SELECT terverifikasi FROM totp_secrets WHERE identity = ?`
    ).get(String(identity));
    return row !== undefined && row.terverifikasi === 0;
  } catch {
    return false;
  }
}

/** Ambil status lengkap untuk ditampilkan di UI. */
export function statusTotp(identity) {
  // Bentuk balasan SELALU sama, baik ada baris maupun tidak. Kalau bentuknya
  // berbeda-beda, pemanggil harus menebak-nebak apakah field ada — dan
  // `undefined` yang bocor ke UI tampil sebagai "undefined" ke pengguna.
  const kosong = {
    aktif: false,
    menunggu: false,
    dibuat_at: null,
    terakhir_dipakai: null,
    kode_pemulihan_tersisa: 0,
  };

  try {
    const row = getDb().prepare(
      `SELECT terverifikasi, dibuat_at, terakhir_dipakai FROM totp_secrets WHERE identity = ?`
    ).get(String(identity));
    if (!row) return kosong;

    const sisaKode = getDb().prepare(
      `SELECT COUNT(*) AS n FROM totp_recovery WHERE identity = ? AND dipakai_at IS NULL`
    ).get(String(identity));

    return {
      aktif: row.terverifikasi === 1,
      menunggu: row.terverifikasi === 0,
      dibuat_at: row.dibuat_at,
      terakhir_dipakai: row.terakhir_dipakai,
      kode_pemulihan_tersisa: sisaKode?.n ?? 0,
    };
  } catch {
    return kosong;
  }
}

// ══ Enrollment ═══════════════════════════════════════════════════════════════

/**
 * Mulai pendaftaran 2FA: buat secret baru + URI untuk QR code.
 *
 * ── PENTING: SECRET HANYA DIKEMBALIKAN SEKALI ───────────────────────────────
 * Secret dikembalikan dalam respons ini saja (untuk ditampilkan sebagai QR).
 * Setelah itu ia hanya tersimpan terenkripsi dan tidak bisa dibaca lagi.
 *
 * Kalau enrollment dipanggil ULANG untuk identitas yang sama, secret lama
 * ditimpa. Itu perilaku yang benar: klien yang gagal scan QR harus bisa
 * mencoba lagi, dan secret lama memang tidak pernah terpakai.
 *
 * TAPI kalau 2FA sudah AKTIF (terverifikasi), panggilan ini DITOLAK.
 * Mengganti secret yang sudah aktif akan mengunci klien — authenticator-nya
 * masih memegang secret lama. Untuk mengganti, klien harus mencabut 2FA
 * dulu (dengan kode pemulihan atau verifikasi kode yang ada).
 */
export function mulaiEnrollment(identity, config, { issuer = 'Victer Portfolio' } = {}) {
  const id = String(identity ?? '').trim();
  if (!id) throw new Error('identity_kosong');

  const serviceSecret = ambilServiceSecret(config);
  const db = getDb();

  // Tolak kalau sudah aktif — lihat penjelasan di atas.
  const ada = db.prepare(`SELECT terverifikasi FROM totp_secrets WHERE identity = ?`).get(id);
  if (ada?.terverifikasi === 1) {
    const err = new Error('totp_sudah_aktif');
    err.kode = 'totp_sudah_aktif';
    err.pesan = '2FA sudah aktif. Cabut dulu sebelum mendaftar ulang.';
    throw err;
  }

  const secret = buatSecret();
  const secretEnc = enkripsiSecret(secret, serviceSecret);
  const waktu = now();

  // UPSERT: identitas bisa sudah ada dari percobaan enrollment sebelumnya.
  db.prepare(
    `INSERT INTO totp_secrets (id, identity, secret_enc, terverifikasi, dibuat_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(identity) DO UPDATE SET
       secret_enc = excluded.secret_enc,
       terverifikasi = 0,
       terverifikasi_at = NULL,
       dibuat_at = excluded.dibuat_at,
       langkah_terakhir = 0`
  ).run(randomUUID(), id, secretEnc, waktu);

  // Hapus kode pemulihan lama — belum ada yang dipakai karena enrollment
  // belum selesai. Kalau dibiarkan, kode lama yang sudah dilihat klien
  // tapi belum tercatat akan tetap valid.
  db.prepare(`DELETE FROM totp_recovery WHERE identity = ?`).run(id);

  return {
    secret,                                    // hanya dikembalikan di sini
    uri: uriOtp({ issuer, akun: id, secret }),
    issuer,
    akun: id,
    digit: 6,
    periode: LANGKAH_DETIK,
  };
}

/**
 * Selesaikan enrollment: verifikasi satu kode dari authenticator.
 *
 * ── KENAPA LANGKAH INI WAJIB ────────────────────────────────────────────────
 * Kalau 2FA langsung aktif setelah QR dibuat, klien yang gagal scan
 * (kamera rusak, app salah, QR terpotong) akan terkunci dari akunnya.
 * Dia tidak punya kode yang benar, dan tidak punya kode pemulihan.
 *
 * Dengan langkah verifikasi ini, 2FA baru aktif setelah terbukti
 * authenticator klien benar-benar bisa menghasilkan kode yang cocok.
 *
 * Setelah verifikasi berhasil, kode pemulihan dibuat dan dikembalikan
 * SEKALI — itu satu-satunya kesempatan klien menyimpannya.
 */
export function selesaikanEnrollment(identity, kode, config, { ip = '' } = {}) {
  const id = String(identity ?? '').trim();
  const serviceSecret = ambilServiceSecret(config);
  const db = getDb();

  const row = db.prepare(
    `SELECT id, secret_enc, terverifikasi FROM totp_secrets WHERE identity = ?`
  ).get(id);

  if (!row) {
    catatPercobaan(id, false, 'enrollment_tidak_ada', ip);
    return { ok: false, alasan: 'enrollment_tidak_ada', pesan: 'Pendaftaran belum dimulai.' };
  }

  if (row.terverifikasi === 1) {
    return { ok: false, alasan: 'sudah_aktif', pesan: '2FA sudah aktif.' };
  }

  // Batas percobaan juga berlaku di sini — kalau tidak, penyerang bisa
  // memakai endpoint enrollment untuk menebak kode tanpa batas.
  const gagal = percobaanGagalTerakhir(id);
  if (gagal >= MAKS_GAGAL) {
    catatPercobaan(id, false, 'diblokir_sementara', ip);
    return {
      ok: false,
      alasan: 'diblokir_sementara',
      pesan: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(JENDELA_BLOKIR_MS / 60000)} menit.`,
    };
  }

  let secret;
  try {
    secret = dekripsiSecret(row.secret_enc, serviceSecret);
  } catch {
    // Secret tidak bisa didekripsi — biasanya karena SERVICE_SECRET berubah.
    // Ini kondisi serius: semua klien dengan 2FA akan terkunci.
    catatPercobaan(id, false, 'secret_tidak_terbaca', ip);
    return {
      ok: false,
      alasan: 'secret_tidak_terbaca',
      pesan: 'Data 2FA tidak bisa dibaca. Hubungi admin.',
    };
  }

  const hasil = verifikasiTotp(secret, kode);
  if (!hasil.cocok) {
    catatPercobaan(id, false, 'kode_salah', ip);
    const sisa = MAKS_GAGAL - (gagal + 1);
    return {
      ok: false,
      alasan: 'kode_salah',
      pesan: sisa > 0
        ? `Kode tidak cocok. Sisa ${sisa} percobaan.`
        : 'Kode tidak cocok. Akun diblokir sementara.',
      sisa_percobaan: Math.max(0, sisa),
    };
  }

  // ── Berhasil: aktifkan 2FA ────────────────────────────────────────────────
  //
  // CATATAN PENTING: `langkah_terakhir` SENGAJA TIDAK diset di sini.
  //
  // Kalau diset, klien yang baru selesai mendaftar langsung terkunci 30 detik:
  // kode yang dia pakai untuk verifikasi dianggap "sudah dipakai" saat dia
  // mencoba login. Secara teknis itu benar (kode sekali pakai), tapi dari
  // sisi pengguna sangat membingungkan — dia baru saja membuktikan
  // authenticator-nya bekerja, lalu ditolak dengan pesan "kode sudah dipakai".
  //
  // Enrollment dan login adalah dua konteks berbeda. Deteksi replay hanya
  // perlu berlaku di dalam satu konteks (login), bukan lintas konteks.
  const waktu = now();
  db.prepare(
    `UPDATE totp_secrets
     SET terverifikasi = 1, terverifikasi_at = ?, terakhir_dipakai = ?
     WHERE identity = ?`
  ).run(waktu, waktu, id);

  // Buat kode pemulihan baru.
  const kodePemulihan = buatKodePemulihan(JUMLAH_KODE_PEMULIHAN);
  db.prepare(`DELETE FROM totp_recovery WHERE identity = ?`).run(id);
  const stmt = db.prepare(
    `INSERT INTO totp_recovery (id, identity, kode_hash, dibuat_at) VALUES (?, ?, ?, ?)`
  );
  for (const k of kodePemulihan) {
    stmt.run(randomUUID(), id, hashKodePemulihan(k, serviceSecret), waktu);
  }

  catatPercobaan(id, true, 'enrollment_selesai', ip);

  return {
    ok: true,
    kode_pemulihan: kodePemulihan,   // hanya dikembalikan SEKALI
    pesan: '2FA aktif. Simpan kode pemulihan di tempat aman.',
  };
}

// ══ Verifikasi saat login ════════════════════════════════════════════════════

/**
 * Verifikasi kode TOTP saat login.
 *
 * Menerima kode 6 digit ATAU kode pemulihan (format XXXXX-XXXXX).
 * Kode pemulihan dideteksi dari panjangnya — 6 digit angka = TOTP,
 * selain itu dicoba sebagai kode pemulihan.
 */
export function verifikasi2fa(identity, kode, config, { ip = '' } = {}) {
  const id = String(identity ?? '').trim();
  const db = getDb();

  const row = db.prepare(
    `SELECT secret_enc, terverifikasi, langkah_terakhir FROM totp_secrets WHERE identity = ?`
  ).get(id);

  if (!row || row.terverifikasi !== 1) {
    return { ok: false, alasan: 'tidak_aktif', pesan: '2FA tidak aktif untuk identitas ini.' };
  }

  // ── Batas percobaan ───────────────────────────────────────────────────────
  const gagal = percobaanGagalTerakhir(id);
  if (gagal >= MAKS_GAGAL) {
    catatPercobaan(id, false, 'diblokir_sementara', ip);
    const sisaMs = JENDELA_BLOKIR_MS;
    return {
      ok: false,
      alasan: 'diblokir_sementara',
      pesan: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(sisaMs / 60000)} menit.`,
    };
  }

  const bersih = String(kode ?? '').trim();
  const serviceSecret = ambilServiceSecret(config);

  // ── Jalur 1: kode pemulihan ───────────────────────────────────────────────
  // Dideteksi dari bentuknya: mengandung tanda hubung, atau bukan 6 digit.
  const mungkinPemulihan = /-/.test(bersih) || !/^\d{6}$/.test(bersih);

  if (mungkinPemulihan) {
    const hash = hashKodePemulihan(bersih, serviceSecret);
    const kandidat = db.prepare(
      `SELECT id, kode_hash FROM totp_recovery WHERE identity = ? AND dipakai_at IS NULL`
    ).all(id);

    // Bandingkan dengan perbandingan waktu-tetap. Kode pemulihan adalah
    // kredensial — timing attack juga berlaku di sini.
    let cocokId = null;
    for (const k of kandidat) {
      const a = Buffer.from(k.kode_hash, 'hex');
      const b = Buffer.from(hash, 'hex');
      if (a.length === b.length && timingSafeEqual(a, b)) { cocokId = k.id; break; }
    }

    if (!cocokId) {
      catatPercobaan(id, false, 'kode_pemulihan_salah', ip);
      const sisa = MAKS_GAGAL - (gagal + 1);
      return {
        ok: false,
        alasan: 'kode_salah',
        pesan: `Kode pemulihan tidak cocok. Sisa ${Math.max(0, sisa)} percobaan.`,
        sisa_percobaan: Math.max(0, sisa),
      };
    }

    // Tandai terpakai — SEKALI PAKAI. Tanpa ini, kode yang bocor berlaku
    // selamanya.
    db.prepare(`UPDATE totp_recovery SET dipakai_at = ? WHERE id = ?`).run(now(), cocokId);
    db.prepare(`UPDATE totp_secrets SET terakhir_dipakai = ? WHERE identity = ?`).run(now(), id);
    catatPercobaan(id, true, 'kode_pemulihan', ip);

    const sisaKode = db.prepare(
      `SELECT COUNT(*) AS n FROM totp_recovery WHERE identity = ? AND dipakai_at IS NULL`
    ).get(id)?.n ?? 0;

    return {
      ok: true,
      metode: 'kode_pemulihan',
      kode_pemulihan_tersisa: sisaKode,
      pesan: sisaKode > 0
        ? `Berhasil. Sisa ${sisaKode} kode pemulihan.`
        : 'Berhasil. Kode pemulihan HABIS — segera buat yang baru.',
    };
  }

  // ── Jalur 2: kode TOTP ────────────────────────────────────────────────────
  let secret;
  try {
    secret = dekripsiSecret(row.secret_enc, serviceSecret);
  } catch {
    catatPercobaan(id, false, 'secret_tidak_terbaca', ip);
    return { ok: false, alasan: 'secret_tidak_terbaca', pesan: 'Data 2FA tidak bisa dibaca.' };
  }

  const hasil = verifikasiTotp(secret, bersih);

  if (!hasil.cocok) {
    catatPercobaan(id, false, 'kode_salah', ip);
    const sisa = MAKS_GAGAL - (gagal + 1);
    return {
      ok: false,
      alasan: 'kode_salah',
      pesan: sisa > 0
        ? `Kode tidak cocok. Sisa ${sisa} percobaan.`
        : 'Kode tidak cocok. Akun diblokir sementara.',
      sisa_percobaan: Math.max(0, sisa),
    };
  }

  // ── Deteksi replay ────────────────────────────────────────────────────────
  // Langkah waktu kode ini = langkah sekarang + offset yang cocok.
  // Kalau langkah itu sudah pernah dipakai, tolak — kode yang sama tidak
  // boleh berlaku dua kali.
  const langkahSekarang = Math.floor(Date.now() / 1000 / LANGKAH_DETIK);
  const langkahKode = langkahSekarang + hasil.offset;

  if (langkahKode <= (row.langkah_terakhir ?? 0)) {
    catatPercobaan(id, false, 'kode_dipakai_ulang', ip);
    return {
      ok: false,
      alasan: 'kode_dipakai_ulang',
      pesan: 'Kode ini sudah dipakai. Tunggu kode berikutnya.',
    };
  }

  const waktu = now();
  db.prepare(
    `UPDATE totp_secrets SET terakhir_dipakai = ?, langkah_terakhir = ? WHERE identity = ?`
  ).run(waktu, langkahKode, id);
  catatPercobaan(id, true, 'totp', ip);

  return { ok: true, metode: 'totp' };
}

// ══ Cabut 2FA ════════════════════════════════════════════════════════════════

/**
 * Cabut 2FA untuk satu identitas.
 *
 * HARUS dipanggil dengan verifikasi kode yang sah — kalau tidak, siapa pun
 * yang punya akses sesi bisa mematikan 2FA dan meniadakan manfaatnya.
 * Pemeriksaan itu dilakukan di lapisan route, bukan di sini.
 */
export function cabut2fa(identity) {
  const id = String(identity ?? '').trim();
  const db = getDb();
  const info = db.prepare(`DELETE FROM totp_secrets WHERE identity = ?`).run(id);
  db.prepare(`DELETE FROM totp_recovery WHERE identity = ?`).run(id);
  return { ok: true, dihapus: info.changes ?? 0 };
}

/**
 * Buat ulang kode pemulihan (setelah habis atau hilang).
 *
 * Memerlukan verifikasi kode TOTP yang sah — dilakukan di lapisan route.
 */
export function buatUlangKodePemulihan(identity, config) {
  const id = String(identity ?? '').trim();
  const serviceSecret = ambilServiceSecret(config);
  const db = getDb();

  const row = db.prepare(`SELECT terverifikasi FROM totp_secrets WHERE identity = ?`).get(id);
  if (row?.terverifikasi !== 1) {
    return { ok: false, alasan: 'tidak_aktif', pesan: '2FA tidak aktif.' };
  }

  const kode = buatKodePemulihan(JUMLAH_KODE_PEMULIHAN);
  const waktu = now();
  db.prepare(`DELETE FROM totp_recovery WHERE identity = ?`).run(id);
  const stmt = db.prepare(
    `INSERT INTO totp_recovery (id, identity, kode_hash, dibuat_at) VALUES (?, ?, ?, ?)`
  );
  for (const k of kode) stmt.run(randomUUID(), id, hashKodePemulihan(k, serviceSecret), waktu);

  return { ok: true, kode_pemulihan: kode };
}

// ══ Diagnostik ═══════════════════════════════════════════════════════════════

/** Ringkasan percobaan 2FA terakhir untuk audit. */
export function riwayatPercobaan(identity, limit = 20) {
  try {
    return getDb().prepare(
      `SELECT berhasil, alasan, ip, dibuat_at FROM totp_attempts
       WHERE identity = ? ORDER BY dibuat_at DESC LIMIT ?`
    ).all(String(identity), Math.min(Number(limit) || 20, 100));
  } catch {
    return [];
  }
}
