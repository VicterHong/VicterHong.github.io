/**
 * Auth berbasis EMAIL + PASSWORD — modul identitas pengguna.
 *
 * ── KENAPA MODUL INI ADA ────────────────────────────────────────────────────
 * Sebelumnya satu-satunya cara masuk adalah "token akses": string acak
 * 19 karakter (VP-XXXX-XXXX-XXXX-XXXX) yang harus disalin pengguna.
 *
 * Itu buruk karena:
 *   1. Bukan pola korporasi — tujuh halaman login besar (Linear, Vercel,
 *      GitHub, Stripe, Cloudflare, Notion, Resend) memakai email + password
 *      atau SSO, tidak ada yang meminta token tempel.
 *   2. Gesekan tinggi: menyalin string acak 19 karakter rawan salah.
 *   3. Tidak ada pemulihan mandiri: lupa token = harus menghubungi admin.
 *   4. Karena sulit diingat, pengguna menyimpannya di catatan/chat —
 *      itu justru MELEMAHKAN keamanan.
 *
 * ── KENAPA SCRYPT, BUKAN BCRYPT/ARGON2 ──────────────────────────────────────
 * `node:crypto` sudah menyediakan scrypt. Proyek ini sengaja nol dependensi
 * (lihat package.json — tidak ada `dependencies` sama sekali). Menambah
 * bcrypt/argon2 berarti menambah paket native yang harus dikompilasi ulang
 * setiap kali Node di-upgrade — biaya operasional nyata untuk keuntungan
 * keamanan yang kecil di skala ini.
 *
 * scrypt adalah KDF yang diakui (RFC 7914), tahan terhadap serangan
 * GPU/ASIC, dan terukur 45ms di server ini dengan N=16384 — cukup lambat
 * untuk mempersulit brute force, cukup cepat untuk login.
 *
 * ── PARAMETER (jangan diubah tanpa memahami akibatnya) ──────────────────────
 *   N = 16384  biaya CPU/memori (2^14). Naikkan 2× = 2× lebih lambat.
 *   r = 8      ukuran blok
 *   p = 1      paralelisasi
 *   keylen=64  panjang hash keluaran
 *
 * N dinaikkan berarti hash LAMA tetap valid — parameter disimpan di dalam
 * string hash, jadi verifikasi selalu memakai parameter asli hash itu.
 */

import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb } from './db.mjs';

const scryptAsync = promisify(scrypt);

// ── Parameter scrypt ─────────────────────────────────────────────────────────
const N = 16384;       // 2^14
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Format hash: `scrypt$N$r$p$salt_b64$hash_b64`
 *
 *  Parameter ikut disimpan supaya hash lama tetap bisa diverifikasi setelah
 *  parameter dinaikkan. Tanpa ini, menaikkan N akan mengunci semua pengguna
 *  lama di luar — kesalahan yang mahal dan sulit diperbaiki. */
export function hashPassword(sandi) {
  const salt = randomBytes(SALT_BYTES);
  return scryptAsync(sandi, salt, KEYLEN, { N, r, p }).then(
    (kunci) => `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${kunci.toString('base64')}`,
  );
}

/**
 * Verifikasi sandi terhadap hash tersimpan.
 *
 * Selalu mengembalikan Promise<boolean> dan TIDAK melempar — pemanggil tidak
 * perlu try/catch hanya untuk menangani format hash rusak.
 *
 * Perbandingan memakai timingSafeEqual, bukan `===`. Perbandingan string
 * biasa berhenti di karakter pertama yang berbeda, sehingga waktu eksekusinya
 * membocorkan berapa banyak karakter awal yang benar — cukup untuk
 * merekonstruksi hash karakter demi karakter.
 */
export async function verifyPassword(sandi, hashTersimpan) {
  if (typeof hashTersimpan !== 'string') return false;

  const bagian = hashTersimpan.split('$');
  if (bagian.length !== 6 || bagian[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = bagian;
  const nH = Number(nStr), rH = Number(rStr), pH = Number(pStr);
  if (!Number.isFinite(nH) || !Number.isFinite(rH) || !Number.isFinite(pH)) return false;

  let salt, hashAsli;
  try {
    salt = Buffer.from(saltB64, 'base64');
    hashAsli = Buffer.from(hashB64, 'base64');
  } catch { return false; }

  if (salt.length === 0 || hashAsli.length === 0) return false;

  try {
    const kunci = await scryptAsync(sandi, salt, hashAsli.length, { N: nH, r: rH, p: pH });
    return timingSafeEqual(kunci, hashAsli);
  } catch {
    return false;
  }
}

// ── Normalisasi email ────────────────────────────────────────────────────────

/**
 * Normalisasi email untuk dipakai sebagai kunci unik.
 *
 * Trim + lowercase. Tanpa ini, `Budi@Perusahaan.com` dan
 * `budi@perusahaan.com` menjadi dua akun berbeda — pengguna mendaftar dua
 * kali dan bingung kenapa sandinya "salah".
 */
export function normalEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** Validasi format email — sama dengan yang dipakai /api/contact/sales
 *  supaya aturannya konsisten di seluruh layanan. */
export function emailValid(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? ''));
}

// ── Kekuatan sandi ───────────────────────────────────────────────────────────

/** Panjang minimum sandi.
 *
 *  12 dipilih dari NIST SP 800-63B: panjang adalah faktor terpenting, dan
 *  sandi 12+ karakter tanpa aturan komposisi yang rumit lebih baik daripada
 *  8 karakter dengan wajib simbol — yang justru mendorong pola mudah ditebak
 *  seperti `Password1!`.
 */
export const PANJANG_SANDI_MIN = 12;

/** Daftar sandi yang terlalu umum.
 *
 *  NIST menyarankan memblokir sandi yang muncul di daftar kebocoran. Ini
 *  daftar kecil untuk kasus paling sering; bukan pengganti pemeriksaan
 *  kebocoran penuh, tapi menutup yang paling nyata. */
const SANDI_UMUM = new Set([
  'password1234', 'password12345', 'qwertyuiop12', '123456789012',
  'passwordpassword', 'administrator1', 'letmeinletmein',
  'iloveyouilove', 'welcomewelcome', 'monkeymonkey12',
  'dragon123456', 'football1234', 'baseball1234', 'sunshine1234',
]);

/**
 * Periksa kekuatan sandi. Mengembalikan { ok, pesan }.
 *
 * Aturan sengaja sedikit dan dapat dijelaskan:
 *   • minimal 12 karakter (NIST)
 *   • maksimal 200 karakter — mencegah DoS lewat sandi raksasa yang membuat
 *     scrypt menghabiskan CPU. Batas ini jauh di atas kebutuhan manusia.
 *   • bukan sandi umum
 *   • tidak seluruhnya satu jenis karakter (mis. hanya angka)
 *
 * TIDAK ada aturan "wajib simbol" — aturan seperti itu mendorong pengguna
 * membuat pola yang mudah ditebak dan sering membuat mereka menuliskan sandi
 * di tempat yang tidak aman.
 */
export function periksaSandi(sandi) {
  const s = String(sandi ?? '');

  if (s.length < PANJANG_SANDI_MIN) {
    return { ok: false, pesan: `Sandi minimal ${PANJANG_SANDI_MIN} karakter.` };
  }
  if (s.length > 200) {
    return { ok: false, pesan: 'Sandi maksimal 200 karakter.' };
  }
  if (SANDI_UMUM.has(s.toLowerCase())) {
    return { ok: false, pesan: 'Sandi ini terlalu umum. Pilih yang lain.' };
  }
  // Seluruhnya angka / seluruhnya huruf sama
  if (/^\d+$/.test(s)) {
    return { ok: false, pesan: 'Sandi tidak boleh hanya berisi angka.' };
  }
  if (/^(.)\1+$/.test(s)) {
    return { ok: false, pesan: 'Sandi tidak boleh satu karakter berulang.' };
  }

  return { ok: true };
}

// ── Tabel pengguna ───────────────────────────────────────────────────────────

/**
 * Buat tabel `users` kalau belum ada.
 *
 * ── HUBUNGAN DENGAN TABEL `tokens` ──────────────────────────────────────────
 * Setiap pengguna punya SATU baris di `tokens` yang menjadi identitasnya.
 * Kolom `sessions.token_id` mengacu ke situ, begitu juga pencatatan 2FA dan
 * audit. Jadi login email+password tidak menggantikan sistem token — ia
 * menjadi CARA MASUK yang lebih baik ke sistem yang sama.
 *
 * Dengan begitu semua yang sudah dibangun tetap bekerja:
 *   • sesi & batas perangkat
 *   • 2FA TOTP (menempel pada identitas, bukan pada cara masuk)
 *   • audit & pencabutan akses oleh admin
 */
export function siapkanTabelPengguna() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      nama          TEXT NOT NULL DEFAULT '',
      perusahaan    TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      token_id      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'aktif',
      dibuat_at     INTEGER NOT NULL,
      masuk_terakhir INTEGER,
      gagal_masuk   INTEGER NOT NULL DEFAULT 0,
      terkunci_sampai INTEGER,
      -- ── FOTO PROFIL ───────────────────────────────────────────────────────
      -- Menyimpan KUNCI objek di R2 (avatar/ID-HASH.webp), bukan URL
      -- lengkap dan bukan gambar itu sendiri:
      --
      --   • Kunci, bukan URL: alamat R2 bisa berubah (domain sendiri, CDN)
      --     tanpa harus memperbarui setiap baris database.
      --   • Kunci, bukan data gambar: blob di database akan menggandakan
      --     penyimpanan dan membuat setiap SELECT pengguna menarik megabyte.
      --
      -- Kosong = pengguna belum mengunggah foto. Halaman lalu jatuh ke
      -- avatar OAuth, lalu ke inisial otomatis — jadi kosong adalah keadaan
      -- yang sah, bukan data yang hilang.
      avatar_key    TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

    -- Token reset sandi: HANYA hash yang disimpan, bukan tokennya.
    -- Kalau database bocor, penyerang tidak bisa memakai token reset —
    -- sama seperti sandi, token disimpan dalam bentuk hash.
    CREATE TABLE IF NOT EXISTS password_resets (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      dibuat_at  INTEGER NOT NULL,
      kedaluwarsa INTEGER NOT NULL,
      dipakai_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_resets_hash  ON password_resets(token_hash);
    CREATE INDEX IF NOT EXISTS idx_resets_user  ON password_resets(user_id);
  `);
}

// ── Operasi pengguna ─────────────────────────────────────────────────────────

const now = () => Date.now();

/** Cari pengguna berdasarkan email (dinormalisasi). */
export function cariPengguna(email) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(normalEmail(email));
}

/** Cari pengguna berdasarkan id. */
export function penggunaById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(String(id ?? ''));
}

/** Buat pengguna baru + baris token identitasnya. */
export async function buatPengguna({ email, nama, perusahaan, sandi, tokenId, id }) {
  const userId = id ?? randomBytes(16).toString('hex');
  const hash = await hashPassword(sandi);
  const at = now();

  getDb().prepare(`
    INSERT INTO users (id, email, nama, perusahaan, password_hash, token_id, status, dibuat_at)
    VALUES (?, ?, ?, ?, ?, ?, 'aktif', ?)
  `).run(userId, normalEmail(email), String(nama ?? '').trim(),
         String(perusahaan ?? '').trim(), hash, tokenId, at);

  return { id: userId, email: normalEmail(email), tokenId };
}

/** Ubah sandi pengguna. */
export async function ubahSandi(userId, sandiBaru) {
  const hash = await hashPassword(sandiBaru);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, String(userId));
}

/**
 * Catat percobaan masuk yang gagal.
 *
 * ── KENAPA ADA PENGUNCIAN ───────────────────────────────────────────────────
 * Tanpa batas, penyerang bisa mencoba ribuan sandi. Rate limit per-IP saja
 * tidak cukup: penyerang bisa memakai banyak IP. Penguncian per-AKUN
 * melindungi akun itu sendiri, apa pun IP-nya.
 *
 * Setelah 10 kegagalan, akun terkunci 15 menit. Cukup untuk menghentikan
 * brute force, tidak cukup untuk mengganggu pengguna yang salah ketik
 * beberapa kali.
 */
export function catatGagalMasuk(userId) {
  const row = penggunaById(userId);
  const jumlah = (row?.gagal_masuk ?? 0) + 1;
  const KUNCI_MS = 15 * 60 * 1000;

  if (jumlah >= 10) {
    getDb().prepare('UPDATE users SET gagal_masuk = ?, terkunci_sampai = ? WHERE id = ?')
      .run(jumlah, now() + KUNCI_MS, userId);
  } else {
    getDb().prepare('UPDATE users SET gagal_masuk = ? WHERE id = ?').run(jumlah, userId);
  }
  return jumlah;
}

/** Reset penghitung gagal setelah masuk berhasil. */
export function catatMasukBerhasil(userId) {
  getDb().prepare('UPDATE users SET gagal_masuk = 0, terkunci_sampai = NULL, masuk_terakhir = ? WHERE id = ?')
    .run(now(), userId);
}

/** Apakah akun sedang terkunci? Mengembalikan sisa detik, atau 0 kalau tidak. */
export function sisaKunci(userId) {
  const row = penggunaById(userId);
  if (!row?.terkunci_sampai) return 0;
  const sisa = row.terkunci_sampai - now();
  return sisa > 0 ? Math.ceil(sisa / 1000) : 0;
}

// ── Token reset sandi ────────────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000;   // 1 jam

/**
 * Buat token reset sandi.
 *
 * Mengembalikan token MENTAH (untuk dikirim lewat email) — yang disimpan di
 * database hanya hash-nya. Kalau database bocor, token tidak bisa dipakai.
 *
 * TTL 1 jam: cukup untuk membuka email dan mengganti sandi, cukup pendek
 * supaya tautan lama di inbox tidak menjadi pintu masuk permanen.
 */
export function buatTokenReset(userId) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const at = now();

  // Batalkan token lama yang belum dipakai — satu token aktif per pengguna.
  // Tanpa ini, setiap permintaan reset menumpuk token yang semuanya sah.
  getDb().prepare('DELETE FROM password_resets WHERE user_id = ? AND dipakai_at IS NULL').run(userId);

  getDb().prepare(`
    INSERT INTO password_resets (id, user_id, token_hash, dibuat_at, kedaluwarsa)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomBytes(16).toString('hex'), userId, hash, at, at + RESET_TTL_MS);

  return token;
}

/**
 * Pakai token reset: verifikasi + ganti sandi + tandai terpakai.
 *
 * Mengembalikan { ok, userId, pesan }. Semua kegagalan memakai pesan yang
 * SAMA ke pengguna ("Tautan tidak valid atau sudah kedaluwarsa") supaya
 * penyerang tidak bisa membedakan token yang salah dari yang kedaluwarsa.
 */
export async function pakaiTokenReset(token, sandiBaru) {
  const hash = createHash('sha256').update(String(token ?? '')).digest('hex');
  const row = getDb().prepare(
    'SELECT * FROM password_resets WHERE token_hash = ? AND dipakai_at IS NULL'
  ).get(hash);

  if (!row) return { ok: false, pesan: 'Tautan tidak valid atau sudah kedaluwarsa.' };
  if (row.kedaluwarsa < now()) return { ok: false, pesan: 'Tautan tidak valid atau sudah kedaluwarsa.' };

  const periksa = periksaSandi(sandiBaru);
  if (!periksa.ok) return { ok: false, pesan: periksa.pesan };

  await ubahSandi(row.user_id, sandiBaru);
  getDb().prepare('UPDATE password_resets SET dipakai_at = ? WHERE id = ?').run(now(), row.id);

  // Buka kunci akun — pengguna yang berhasil reset tidak boleh tetap terkunci.
  getDb().prepare('UPDATE users SET gagal_masuk = 0, terkunci_sampai = NULL WHERE id = ?').run(row.user_id);

  return { ok: true, userId: row.user_id };
}

/** Bersihkan token reset yang sudah kedaluwarsa/dipakai. */
export function bersihkanTokenReset() {
  const hasil = getDb().prepare(
    'DELETE FROM password_resets WHERE kedaluwarsa < ? OR dipakai_at IS NOT NULL'
  ).run(now() - 24 * 60 * 60 * 1000);   // simpan 24 jam untuk audit
  return hasil.changes ?? 0;
}

/**
 * Perbarui profil pengguna — nama dan organisasi.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA HANYA NAMA DAN ORGANISASI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Email TIDAK bisa diubah di sini, dan itu disengaja:
 *
 *   • Email adalah identitas login. Mengubahnya berarti mengubah cara masuk
 *     — itu alur berbeda yang butuh verifikasi (kirim tautan konfirmasi ke
 *     alamat BARU, supaya tidak ada yang bisa membajak dengan salah ketik).
 *   • Kalau email bisa diubah bebas, seseorang yang sempat menguasai sesi
 *     bisa memindahkan akun ke alamatnya sendiri — dan pemilik asli
 *     kehilangan akses tanpa tahu.
 *   • Provider OAuth (Google, Microsoft) memakai email sebagai kunci
 *     identitas. Mengubahnya di sini akan membuat identitas berikutnya
 *     tidak cocok dan pengguna tidak bisa masuk lagi.
 *
 * Stripe melakukan hal yang sama: email di halaman profil ditampilkan
 * sebagai informasi, dengan alur terpisah untuk mengubahnya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * VALIDASI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Aturan nama sama dengan yang dipakai saat pendaftaran — konsisten, supaya
 * pengguna tidak menemukan aturan berbeda di dua tempat:
 *   • minimal 3 karakter
 *   • tidak boleh mengandung angka
 *
 * Organisasi opsional (boleh dikosongkan), tapi kalau diisi minimal 3 huruf.
 */
export function perbaruiProfil(userId, { nama, perusahaan } = {}) {
  if (!userId) return { ok: false, pesan: 'Pengguna tidak dikenal.' };

  const namaBaru = String(nama ?? '').trim();
  const perusahaanBaru = String(perusahaan ?? '').trim();

  // ── Validasi nama ────────────────────────────────────────────────────────
  if (namaBaru.length < 3 || /\d/.test(namaBaru)) {
    return { ok: false, pesan: 'Nama minimal 3 huruf, tanpa angka.' };
  }

  // ── Validasi organisasi (opsional) ───────────────────────────────────────
  if (perusahaanBaru && (perusahaanBaru.length < 3 || /^\d+$/.test(perusahaanBaru))) {
    return { ok: false, pesan: 'Nama organisasi minimal 3 huruf.' };
  }

  const info = getDb().prepare(
    'UPDATE users SET nama = ?, perusahaan = ? WHERE id = ?'
  ).run(namaBaru.slice(0, 200), perusahaanBaru.slice(0, 200), userId);

  if (!info.changes) return { ok: false, pesan: 'Profil tidak ditemukan.' };

  return { ok: true, nama: namaBaru, perusahaan: perusahaanBaru };
}

/**
 * Simpan kunci avatar pengguna.
 *
 * ── KENAPA HANYA KUNCI YANG DISIMPAN DI SINI ────────────────────────────────
 * Operasi R2 (unggah/hapus) dilakukan modul avatar.mjs SEBELUM fungsi ini
 * dipanggil. Pemisahan itu disengaja: kalau unggahan gagal, kunci di
 * database tidak boleh berubah — kalau tidak, baris pengguna menunjuk ke
 * berkas yang tidak ada, dan halamannya menampilkan gambar rusak.
 *
 * Urutannya di handler: unggah ke R2 → baru catat kuncinya di sini.
 */
export function simpanKunciAvatar(userId, kunci) {
  const id = String(userId ?? '');
  if (!id) return { ok: false, pesan: 'Pengguna tidak dikenal.' };

  const info = getDb()
    .prepare('UPDATE users SET avatar_key = ? WHERE id = ?')
    .run(String(kunci ?? '').slice(0, 200), id);

  if (!info.changes) return { ok: false, pesan: 'Profil tidak ditemukan.' };
  return { ok: true, kunci: String(kunci ?? '') };
}

/**
 * Ambil kunci avatar pengguna tanpa memuat seluruh barisnya.
 *
 * Dipakai saat MENGHAPUS foto: handler perlu tahu kunci lama untuk dihapus
 * dari R2, dan mengambil seluruh baris pengguna untuk satu kolom berarti
 * menarik password_hash serta kolom lain yang tidak dibutuhkan.
 */
export function kunciAvatarPengguna(userId) {
  const row = getDb()
    .prepare('SELECT avatar_key FROM users WHERE id = ?')
    .get(String(userId ?? ''));
  return row?.avatar_key ?? '';
}
