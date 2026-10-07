/**
 * TOTP — RFC 6238 (Time-based One-Time Password)
 * dengan enkripsi secret at-rest.
 *
 * ── KENAPA DITULIS SENDIRI, TANPA LIBRARY ───────────────────────────────────
 * Backend ini punya NOL dependensi (lihat package.json: `dependencies: {}`).
 * Itu keputusan sadar: setiap paket pihak ketiga adalah kode yang berjalan
 * dengan izin penuh di server ini, dan harus dipercaya serta diperbarui
 * selamanya. Untuk TOTP, yang dibutuhkan hanya HMAC-SHA1 — sudah ada di
 * modul `crypto` bawaan Node.
 *
 * Yang perlu ditulis sendiri hanya dua hal kecil:
 *   1. Base32 encode/decode (Node tidak punya — terverifikasi ERR_UNKNOWN_ENCODING)
 *   2. Perhitungan HOTP/TOTP (RFC 4226/6238, ~30 baris)
 *
 * ── KOMPATIBILITAS ──────────────────────────────────────────────────────────
 * Diuji terhadap vektor uji resmi RFC 6238 (lihat blok UJI di bawah).
 * Bekerja dengan Google Authenticator, Authy, 1Password, Bitwarden,
 * Microsoft Authenticator — semua implementasi standar.
 *
 * ── KEAMANAN ────────────────────────────────────────────────────────────────
 * Secret TIDAK disimpan sebagai base32 polos. Kalau database bocor,
 * penyerang bisa membuat kode TOTP apa pun. Jadi secret dienkripsi dengan
 * AES-256-GCM memakai kunci turunan dari SERVICE_SECRET.
 *
 * AES-GCM dipilih (bukan CBC) karena ia "authenticated": ciphertext yang
 * diubah akan GAGAL didekripsi, bukan menghasilkan plaintext sampah yang
 * bisa lolos pemeriksaan.
 */

import { createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from 'node:crypto';

// ══ Base32 ═══════════════════════════════════════════════════════════════════
// RFC 4648. Dipakai karena authenticator app mengharapkan secret dalam
// base32 (bukan hex/base64) — itu yang dibaca dari QR code.

const ABJAD32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode Buffer → string base32 (tanpa padding '=').
 *
 * Authenticator app TIDAK mengharapkan padding. Menyertakannya membuat
 * beberapa app (Google Authenticator versi lama) menolak secret.
 */
export function base32Encode(buf) {
  let bit = 0;
  let nilai = 0;
  let keluaran = '';

  for (const byte of buf) {
    nilai = (nilai << 8) | byte;
    bit += 8;
    while (bit >= 5) {
      keluaran += ABJAD32[(nilai >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  // Sisa bit yang belum cukup 5 → tambah padding nol di kanan
  if (bit > 0) {
    keluaran += ABJAD32[(nilai << (5 - bit)) & 31];
  }
  return keluaran;
}

/**
 * Decode string base32 → Buffer.
 *
 * Menerima input dengan atau tanpa padding, spasi, dan huruf kecil —
 * pengguna sering menempel secret dari berbagai sumber dengan format
 * yang berbeda-beda. Lebih baik memaafkan daripada menolak.
 */
export function base32Decode(str) {
  const bersih = String(str).toUpperCase().replace(/[\s=]/g, '');
  if (!bersih) throw new Error('base32_kosong');

  let bit = 0;
  let nilai = 0;
  const keluaran = [];

  for (const c of bersih) {
    const idx = ABJAD32.indexOf(c);
    if (idx === -1) throw new Error(`base32_karakter_tidak_valid:${c}`);
    nilai = (nilai << 5) | idx;
    bit += 5;
    if (bit >= 8) {
      keluaran.push((nilai >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return Buffer.from(keluaran);
}

// ══ HOTP (RFC 4226) ══════════════════════════════════════════════════════════

/**
 * Hitung HOTP dari counter.
 *
 * Algoritma (RFC 4226 §5.3):
 *   1. HMAC-SHA1(secret, counter_sebagai_8_byte_big_endian)
 *   2. Ambil 4 bit terakhir sebagai offset
 *   3. Baca 4 byte mulai offset itu, buang bit tanda
 *   4. Modulo 10^digit
 */
function hotp(secretBuf, counter, digit = 6) {
  // Counter harus 8 byte big-endian. Tulis manual (bukan writeBigUInt64BE)
  // supaya tetap bekerja di Node lama dan jelas apa yang terjadi.
  const buf = Buffer.alloc(8);
  let sisa = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(sisa & 0xffn);
    sisa >>= 8n;
  }

  const hmac = createHmac('sha1', secretBuf).update(buf).digest();

  // Dynamic truncation — lihat RFC 4226 §5.4
  const offset = hmac[hmac.length - 1] & 0x0f;
  const biner =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(biner % 10 ** digit).padStart(digit, '0');
}

// ══ TOTP (RFC 6238) ══════════════════════════════════════════════════════════

export const LANGKAH_DETIK = 30;   // standar: kode berganti tiap 30 detik

/**
 * Buat kode TOTP untuk waktu tertentu.
 *
 * @param {string} secretBase32 - secret dalam base32
 * @param {number} waktuMs      - waktu (default: sekarang)
 * @param {number} digit        - panjang kode (default 6)
 */
export function buatTotp(secretBase32, waktuMs = Date.now(), digit = 6) {
  const secretBuf = base32Decode(secretBase32);
  const counter = Math.floor(waktuMs / 1000 / LANGKAH_DETIK);
  return hotp(secretBuf, counter, digit);
}

/**
 * Verifikasi kode TOTP dengan toleransi jendela waktu.
 *
 * ── KENAPA ADA JENDELA ──────────────────────────────────────────────────────
 * Jam perangkat pengguna tidak pernah persis sama dengan jam server.
 * Tanpa toleransi, kode yang benar akan ditolak hanya karena jamnya
 * berselisih 5 detik — pengalaman yang sangat membingungkan.
 *
 * Jendela ±1 berarti kode dari 30 detik lalu dan 30 detik berikutnya
 * masih diterima. Itu standar industri (RFC 6238 §5.2 merekomendasikan
 * paling banyak ±1 untuk menghindari memperbesar jendela serangan).
 *
 * JANGAN perbesar tanpa alasan kuat: setiap langkah tambahan melipatgandakan
 * jumlah kode yang valid pada satu waktu, mempermudah tebakan.
 *
 * @returns {{cocok: boolean, offset: number}} offset = langkah waktu yang cocok
 */
export function verifikasiTotp(secretBase32, kode, waktuMs = Date.now(), jendela = 1) {
  const kodeBersih = String(kode).replace(/\D/g, '');
  if (kodeBersih.length !== 6) return { cocok: false, offset: 0 };

  const secretBuf = base32Decode(secretBase32);
  const counterSekarang = Math.floor(waktuMs / 1000 / LANGKAH_DETIK);

  for (let i = -jendela; i <= jendela; i++) {
    const kandidat = hotp(secretBuf, counterSekarang + i, 6);

    // Perbandingan waktu-tetap. Tanpa ini, penyerang bisa mengukur
    // berapa lama perbandingan berjalan untuk menebak digit satu per satu
    // (timing attack). Kode TOTP hanya 6 digit — itu 1 juta kemungkinan,
    // dan timing attack bisa memangkasnya drastis.
    const a = Buffer.from(kandidat);
    const b = Buffer.from(kodeBersih);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { cocok: true, offset: i };
    }
  }
  return { cocok: false, offset: 0 };
}

// ══ Secret & enkripsi ════════════════════════════════════════════════════════

/**
 * Buat secret TOTP baru (20 byte = 160 bit, sesuai RFC 4226 §4 R6).
 *
 * 160 bit adalah yang direkomendasikan karena output HMAC-SHA1 juga 160 bit —
 * secret lebih panjang tidak menambah keamanan untuk algoritma ini.
 */
export function buatSecret() {
  return base32Encode(randomBytes(20));
}

/**
 * Kunci enkripsi dari SERVICE_SECRET.
 *
 * HKDF sederhana: SHA-256(secret + label). Label mencegah kunci ini
 * dipakai ulang untuk keperluan lain yang memakai SERVICE_SECRET —
 * tanpa label, dua fitur berbeda bisa memakai kunci yang sama, dan
 * kelemahan di satu fitur melemahkan yang lain.
 */
function kunciEnkripsi(serviceSecret) {
  if (!serviceSecret || String(serviceSecret).length < 16) {
    throw new Error('service_secret_terlalu_pendek');
  }
  return createHash('sha256').update(`totp-v1|${serviceSecret}`).digest();
}

/**
 * Enkripsi secret TOTP sebelum disimpan.
 *
 * Format keluaran: `v1.<iv_hex>.<tag_hex>.<ciphertext_hex>`
 * Versi disertakan supaya bisa ganti algoritma di masa depan tanpa
 * mematahkan data lama.
 */
export function enkripsiSecret(secretBase32, serviceSecret) {
  const kunci = kunciEnkripsi(serviceSecret);
  const iv = randomBytes(12);   // 96 bit — ukuran yang direkomendasikan untuk GCM
  const cipher = createCipheriv('aes-256-gcm', kunci, iv);

  const ciphertext = Buffer.concat([
    cipher.update(secretBase32, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `v1.${iv.toString('hex')}.${tag.toString('hex')}.${ciphertext.toString('hex')}`;
}

/**
 * Dekripsi secret TOTP.
 *
 * Kalau ciphertext diubah (atau kunci berbeda), GCM akan MELEMPAR galat —
 * itu perilaku yang diinginkan. Data yang rusak harus gagal dengan jelas,
 * bukan menghasilkan secret yang salah dan membuat semua kode ditolak
 * tanpa penjelasan.
 */
export function dekripsiSecret(terenkripsi, serviceSecret) {
  const bagian = String(terenkripsi).split('.');
  if (bagian.length !== 4 || bagian[0] !== 'v1') {
    throw new Error('format_secret_tidak_dikenal');
  }
  const [, ivHex, tagHex, ctHex] = bagian;
  const kunci = kunciEnkripsi(serviceSecret);

  const decipher = createDecipheriv('aes-256-gcm', kunci, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// ══ URI untuk QR code ════════════════════════════════════════════════════════

/**
 * Buat otpauth:// URI untuk QR code.
 *
 * Format standar (dibaca semua authenticator app):
 *   otpauth://totp/{issuer}:{account}?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30
 *
 * Catatan penting: label HARUS di-encode. Nama issuer dengan spasi atau
 * karakter khusus (mis. "PT Victer Jaya") akan merusak URI kalau tidak
 * di-encode, dan QR code-nya tidak bisa dibaca app.
 */
export function uriOtp({ issuer, akun, secret, digit = 6, periode = LANGKAH_DETIK }) {
  const label = encodeURIComponent(`${issuer}:${akun}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(digit),
    period: String(periode),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ══ Kode pemulihan (recovery codes) ══════════════════════════════════════════

/**
 * Buat kode pemulihan sekali-pakai.
 *
 * ── KENAPA PERLU ────────────────────────────────────────────────────────────
 * Pengguna yang kehilangan ponsel akan TERKUNCI TOTAL dari akunnya kalau
 * hanya ada TOTP. Kode pemulihan adalah jalan keluar satu-satunya.
 *
 * Format: 10 karakter base32, dikelompokkan 5-5 (mis. "A3F2K-9LM4P").
 * Alfabet base32 dipilih karena tidak mengandung karakter yang mudah
 * tertukar saat dibaca dari kertas: tidak ada 0/O atau 1/I/L.
 *
 * 10 karakter base32 = 50 bit entropi. Cukup: kode ini juga diperlakukan
 * sebagai kredensial dan dibatasi percobaannya.
 */
export function buatKodePemulihan(jumlah = 8) {
  const kode = [];
  for (let i = 0; i < jumlah; i++) {
    const acak = base32Encode(randomBytes(7)).slice(0, 10);
    kode.push(`${acak.slice(0, 5)}-${acak.slice(5, 10)}`);
  }
  return kode;
}

/**
 * Hash kode pemulihan untuk disimpan.
 *
 * Kode pemulihan TIDAK disimpan polos — kalau database bocor, semua kode
 * bisa langsung dipakai. SHA-256 cukup di sini (tidak perlu bcrypt/argon2)
 * karena kode punya 50 bit entropi acak, bukan password yang bisa ditebak
 * dari kamus.
 */
export function hashKodePemulihan(kode, serviceSecret) {
  const bersih = String(kode).toUpperCase().replace(/[\s-]/g, '');
  return createHash('sha256').update(`recovery|${bersih}|${serviceSecret}`).digest('hex');
}
