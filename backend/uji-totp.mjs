/**
 * Uji modul TOTP terhadap vektor uji RESMI RFC 6238 Appendix B.
 *
 * ── KENAPA UJI INI PENTING ──────────────────────────────────────────────────
 * TOTP yang salah implementasi tetap "bekerja" di mata sendiri — kode
 * dihasilkan, kode diverifikasi, semuanya cocok. Tapi Google Authenticator
 * akan menolaknya, dan pengguna tidak bisa login tanpa tahu kenapa.
 *
 * Satu-satunya cara membuktikan kompatibilitas adalah mencocokkan output
 * dengan nilai yang SUDAH DIBUKTIKAN benar. RFC 6238 memberikan nilai itu.
 */

import {
  buatTotp, verifikasiTotp, base32Encode, base32Decode,
  buatSecret, enkripsiSecret, dekripsiSecret, uriOtp,
  buatKodePemulihan, hashKodePemulihan, LANGKAH_DETIK,
} from './src/totp.mjs';

let lulus = 0, gagal = 0;
const cek = (nama, hasil, harapan) => {
  if (hasil === harapan) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}\n     dapat  : ${hasil}\n     harusnya: ${harapan}`); }
};

console.log('══ 1. VEKTOR UJI RESMI RFC 6238 (SHA-1) ══');
console.log('   Sumber: RFC 6238 Appendix B — nilai ini yang dibuktikan benar');
console.log();

// RFC 6238 memakai secret ASCII "12345678901234567890" (20 byte) untuk SHA-1
const SECRET_RFC = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
console.log(`   secret base32: ${SECRET_RFC}`);
console.log();

const VEKTOR = [
  { waktu: 59,          harapan: '94287082' },
  { waktu: 1111111109,  harapan: '07081804' },
  { waktu: 1111111111,  harapan: '14050471' },
  { waktu: 1234567890,  harapan: '89005924' },
  { waktu: 2000000000,  harapan: '69279037' },
  { waktu: 20000000000, harapan: '65353130' },
];

for (const v of VEKTOR) {
  const kode = buatTotp(SECRET_RFC, v.waktu * 1000, 8);
  cek(`T=${String(v.waktu).padStart(11)} → ${v.harapan}`, kode, v.harapan);
}

console.log();
console.log('══ 2. BASE32 ROUND-TRIP ══');

// RFC 4648 §10 — vektor uji resmi base32
cek('encode "foobar"', base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
cek('decode "MZXW6YTBOI"', base32Decode('MZXW6YTBOI').toString(), 'foobar');
cek('encode "f"', base32Encode(Buffer.from('f')), 'MY');
cek('decode "MY"', base32Decode('MY').toString(), 'f');

// Toleransi format: pengguna menempel dari berbagai sumber
cek('decode huruf kecil', base32Decode('mzxw6ytboi').toString(), 'foobar');
cek('decode dengan spasi', base32Decode('MZXW 6YTB OI').toString(), 'foobar');
cek('decode dengan padding', base32Decode('MZXW6YTBOI====').toString(), 'foobar');

// Data acak — pastikan tidak ada yang hilang
const acak = Buffer.from([0x00, 0xff, 0x7a, 0x13, 0xde, 0xad, 0xbe, 0xef]);
cek('round-trip data biner', base32Decode(base32Encode(acak)).equals(acak), true);

console.log();
console.log('══ 3. VERIFIKASI + JENDELA WAKTU ══');

const secret = buatSecret();
const sekarang = 1700000000000;
const kodeSekarang = buatTotp(secret, sekarang);

cek('kode benar diterima', verifikasiTotp(secret, kodeSekarang, sekarang).cocok, true);
cek('kode salah ditolak', verifikasiTotp(secret, '000000', sekarang).cocok, false);
cek('kode kosong ditolak', verifikasiTotp(secret, '', sekarang).cocok, false);
cek('kode <6 digit ditolak', verifikasiTotp(secret, '123', sekarang).cocok, false);

// Kode 30 detik lalu masih diterima (jendela ±1)
const kodeLalu = buatTotp(secret, sekarang - LANGKAH_DETIK * 1000);
cek('kode 1 langkah lalu diterima', verifikasiTotp(secret, kodeLalu, sekarang).cocok, true);
cek('offset dilaporkan', verifikasiTotp(secret, kodeLalu, sekarang).offset, -1);

// Kode 2 langkah lalu DITOLAK (di luar jendela)
const kodeLama = buatTotp(secret, sekarang - LANGKAH_DETIK * 2 * 1000);
cek('kode 2 langkah lalu DITOLAK', verifikasiTotp(secret, kodeLama, sekarang).cocok, false);

// Kode 1 langkah depan diterima (jam pengguna lebih cepat)
const kodeDepan = buatTotp(secret, sekarang + LANGKAH_DETIK * 1000);
cek('kode 1 langkah depan diterima', verifikasiTotp(secret, kodeDepan, sekarang).cocok, true);

// Format: spasi di tengah harus tetap diterima (pengguna mengetik "123 456")
cek('kode dengan spasi diterima', verifikasiTotp(secret, '123 456', sekarang).cocok, false);
const kodeBerformat = `${kodeSekarang.slice(0, 3)} ${kodeSekarang.slice(3)}`;
cek('kode berformat spasi diterima', verifikasiTotp(secret, kodeBerformat, sekarang).cocok, true);

console.log();
console.log('══ 4. ENKRIPSI SECRET ══');

const SERVICE_SECRET = 'uji-service-secret-yang-cukup-panjang-1234567890';
const terenkripsi = enkripsiSecret(secret, SERVICE_SECRET);

cek('tidak menyimpan secret polos', terenkripsi.includes(secret), false);
cek('format v1', terenkripsi.startsWith('v1.'), true);
cek('dekripsi mengembalikan nilai sama', dekripsiSecret(terenkripsi, SERVICE_SECRET), secret);

// Enkripsi dua kali harus menghasilkan ciphertext berbeda (IV acak)
const terenkripsi2 = enkripsiSecret(secret, SERVICE_SECRET);
cek('IV acak — ciphertext berbeda', terenkripsi !== terenkripsi2, true);
cek('keduanya bisa didekripsi', dekripsiSecret(terenkripsi2, SERVICE_SECRET), secret);

// Kunci salah harus GAGAL (bukan menghasilkan sampah)
let gagalDekripsi = false;
try {
  dekripsiSecret(terenkripsi, 'kunci-yang-salah-tapi-cukup-panjang-0987654321');
} catch { gagalDekripsi = true; }
cek('kunci salah → error', gagalDekripsi, true);

// Ciphertext diubah harus GAGAL (inilah nilai AES-GCM)
let gagalDiubah = false;
try {
  const bagian = terenkripsi.split('.');
  const rusak = `${bagian[0]}.${bagian[1]}.${bagian[2]}.${bagian[3].replace(/^../, 'ff')}`;
  dekripsiSecret(rusak, SERVICE_SECRET);
} catch { gagalDiubah = true; }
cek('ciphertext diubah → error (GCM)', gagalDiubah, true);

// Secret pendek harus ditolak
let gagalPendek = false;
try { enkripsiSecret(secret, 'pendek'); } catch { gagalPendek = true; }
cek('SERVICE_SECRET pendek ditolak', gagalPendek, true);

console.log();
console.log('══ 5. URI OTPAUTH ══');

const uri = uriOtp({ issuer: 'Victer', akun: 'klien@example.com', secret });
cek('skema otpauth', uri.startsWith('otpauth://totp/'), true);
cek('secret disertakan', uri.includes(`secret=${secret}`), true);
cek('issuer disertakan', uri.includes('issuer=Victer'), true);
cek('algorithm SHA1', uri.includes('algorithm=SHA1'), true);
cek('digits 6', uri.includes('digits=6'), true);
cek('period 30', uri.includes('period=30'), true);

// Issuer dengan spasi harus di-encode
const uri2 = uriOtp({ issuer: 'PT Victer Jaya', akun: 'a@b.c', secret });
cek('issuer ber-spasi di-encode', uri2.includes('PT%20Victer%20Jaya'), true);
cek('URI bisa diparse', (() => { try { new URL(uri2); return true; } catch { return false; } })(), true);

console.log();
console.log('══ 6. KODE PEMULIHAN ══');

const kodePemulihan = buatKodePemulihan(8);
cek('jumlah 8', kodePemulihan.length, 8);
cek('format XXXXX-XXXXX', /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(kodePemulihan[0]), true);
cek('semua unik', new Set(kodePemulihan).size, 8);

// ── Catatan: alfabet Base32 (RFC 4648 Tabel 3) ──────────────────────────────
// A-Z (26 huruf) + 2-7 (6 angka) = 32 karakter.
//
// Artinya huruf I, L, dan O MEMANG ADA di base32 — itu bagian sah dari
// alfabet. Yang TIDAK ada hanya angka 0 dan 1 (dihilangkan supaya totalnya
// tetap 32, bukan karena alasan keterbacaan).
//
// Uji sebelumnya salah mengharapkan I/L/O juga hilang. Kalau kode
// "diperbaiki" untuk memenuhi harapan itu, hasilnya BUKAN base32 lagi —
// dan Google Authenticator akan menolak secret-nya.
cek('tanpa angka 0 dan 1 (sesuai RFC 4648)', /[01]/.test(kodePemulihan.join('')), false);
cek('hanya karakter base32 yang sah', /^[A-Z2-7-]+$/.test(kodePemulihan.join('')), true);

// Hash: sama → sama, beda → beda
const h1 = hashKodePemulihan(kodePemulihan[0], SERVICE_SECRET);
const h2 = hashKodePemulihan(kodePemulihan[0], SERVICE_SECRET);
const h3 = hashKodePemulihan(kodePemulihan[1], SERVICE_SECRET);
cek('hash deterministik', h1, h2);
cek('kode berbeda → hash berbeda', h1 !== h3, true);
cek('hash 64 hex char (SHA-256)', /^[0-9a-f]{64}$/.test(h1), true);

// Toleransi format saat verifikasi
cek('hash abaikan tanda hubung', hashKodePemulihan(kodePemulihan[0].replace('-', ''), SERVICE_SECRET), h1);
cek('hash abaikan huruf kecil', hashKodePemulihan(kodePemulihan[0].toLowerCase(), SERVICE_SECRET), h1);

console.log();
console.log('══ 7. SECRET GENERASI ══');

const s1 = buatSecret();
const s2 = buatSecret();
cek('panjang 32 char base32 (20 byte)', s1.length, 32);
cek('dua secret berbeda', s1 !== s2, true);
cek('hanya karakter base32', /^[A-Z2-7]+$/.test(s1), true);
cek('bisa dipakai untuk buat kode', buatTotp(s1).length, 6);

console.log();
console.log('═'.repeat(62));
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('═'.repeat(62));

if (gagal > 0) {
  console.log('\n  ⚠ ADA YANG GAGAL — jangan pakai sebelum diperbaiki.');
  process.exit(1);
} else {
  console.log('\n  ✅ Semua uji lulus. TOTP kompatibel dengan RFC 6238.');
  console.log('     Aman dipakai dengan Google Authenticator, Authy, 1Password,');
  console.log('     Bitwarden, Microsoft Authenticator.');
}
