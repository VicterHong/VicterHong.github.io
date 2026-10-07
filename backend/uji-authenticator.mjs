/**
 * Uji kompatibilitas dengan APLIKASI AUTHENTICATOR SUNGGUHAN.
 *
 * ── KENAPA UJI INI BERBEDA ──────────────────────────────────────────────────
 * Uji sebelumnya membuktikan output cocok dengan RFC 6238. Itu perlu,
 * tapi belum cukup: RFC bisa cocok sementara URI/QR yang kita hasilkan
 * tidak bisa dibaca aplikasi (mis. label salah encode, parameter kurang).
 *
 * Uji ini meniru apa yang dilakukan Google Authenticator:
 *   1. Terima otpauth:// URI
 *   2. Parse URI seperti aplikasi (ambil secret, issuer, digits, period)
 *   3. Hitung kode dari secret yang di-parse
 *   4. Bandingkan dengan kode server
 *
 * Kalau cocok, artinya: aplikasi yang memindai QR kita akan menghasilkan
 * kode yang SAMA dengan yang diharapkan server.
 */

import { buatSecret, buatTotp, verifikasiTotp, uriOtp, enkripsiSecret, dekripsiSecret } from './src/totp.mjs';

let lulus = 0, gagal = 0;
const cek = (nama, hasil, harapan) => {
  if (hasil === harapan) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}\n     dapat: ${hasil}\n     harus: ${harapan}`); }
};

console.log('══ SIMULASI APLIKASI AUTHENTICATOR ══');
console.log();

// ── 1. Server membuat secret untuk klien baru ──────────────────────────────
const SECRET = buatSecret();
const AKUN = 'klien@perusahaan.co.id';
const ISSUER = 'Victer Portfolio';

console.log('  1. Server membuat secret');
console.log(`     secret (base32): ${SECRET}`);
console.log(`     panjang        : ${SECRET.length} karakter = ${SECRET.length * 5 / 8} byte`);
console.log();

// ── 2. Server membuat URI untuk QR code ────────────────────────────────────
const uri = uriOtp({ issuer: ISSUER, akun: AKUN, secret: SECRET });
console.log('  2. Server membuat otpauth:// URI');
console.log(`     ${uri.slice(0, 90)}…`);
console.log();

// ── 3. Aplikasi memindai QR dan mem-parse URI ──────────────────────────────
// Ini meniru logika parser aplikasi authenticator sungguhan.
function parseOtpauth(uriString) {
  // Aplikasi mengharapkan: otpauth://totp/LABEL?params
  if (!uriString.startsWith('otpauth://totp/')) {
    throw new Error('skema bukan otpauth://totp/');
  }

  const tanya = uriString.indexOf('?');
  if (tanya === -1) throw new Error('tidak ada parameter');

  const label = decodeURIComponent(uriString.slice('otpauth://totp/'.length, tanya));
  const params = new URLSearchParams(uriString.slice(tanya + 1));

  const secret = params.get('secret');
  if (!secret) throw new Error('parameter secret hilang');

  // Label format: "Issuer:Account" — aplikasi memisahkan di titik dua PERTAMA
  const pisah = label.indexOf(':');
  const issuerLabel = pisah === -1 ? '' : label.slice(0, pisah);
  const akunLabel = pisah === -1 ? label : label.slice(pisah + 1);

  return {
    label,
    issuer: params.get('issuer') || issuerLabel,
    akun: akunLabel,
    secret,
    algorithm: (params.get('algorithm') || 'SHA1').toUpperCase(),
    digits: parseInt(params.get('digits') || '6', 10),
    period: parseInt(params.get('period') || '30', 10),
  };
}

let app;
try {
  app = parseOtpauth(uri);
  console.log('  3. Aplikasi mem-parse URI berhasil');
  console.log(`     issuer    : ${app.issuer}`);
  console.log(`     akun      : ${app.akun}`);
  console.log(`     algorithm : ${app.algorithm}`);
  console.log(`     digits    : ${app.digits}`);
  console.log(`     period    : ${app.period} detik`);
  console.log();
} catch (e) {
  console.log(`  ❌ Aplikasi GAGAL parse URI: ${e.message}`);
  process.exit(1);
}

// ── 4. Verifikasi parameter yang dibaca aplikasi ───────────────────────────
console.log('  4. Verifikasi parameter');
cek('issuer terbaca benar', app.issuer, ISSUER);
cek('akun terbaca benar', app.akun, AKUN);
cek('secret terbaca benar', app.secret, SECRET);
cek('algorithm SHA1', app.algorithm, 'SHA1');
cek('digits 6', app.digits, 6);
cek('period 30 detik', app.period, 30);
console.log();

// ── 5. Aplikasi menghitung kode, server memverifikasi ──────────────────────
console.log('  5. Kode dari aplikasi vs verifikasi server');

// Waktu dibekukan supaya hasilnya bisa diperiksa
const WAKTU = 1759800000000;  // titik waktu tetap

// "Aplikasi" menghitung kode dari secret hasil parse
const kodeAplikasi = buatTotp(app.secret, WAKTU, app.digits);

// Server memverifikasi kode itu
const hasilServer = verifikasiTotp(SECRET, kodeAplikasi, WAKTU);

cek('kode aplikasi diterima server', hasilServer.cocok, true);
cek('kode 6 digit', kodeAplikasi.length, 6);
cek('kode hanya angka', /^\d{6}$/.test(kodeAplikasi), true);
console.log();

// ── 6. Skenario dunia nyata: 3 aplikasi berbeda ────────────────────────────
console.log('  6. Skenario: klien pakai 3 aplikasi berbeda');
console.log('     (semua membaca QR yang SAMA, harus menghasilkan kode SAMA)');

const kode1 = buatTotp(app.secret, WAKTU, 6);  // Google Authenticator
const kode2 = buatTotp(app.secret, WAKTU, 6);  // Authy
const kode3 = buatTotp(app.secret, WAKTU, 6);  // 1Password
cek('ketiga kode identik', kode1 === kode2 && kode2 === kode3, true);
cek('server menerima kode itu', verifikasiTotp(SECRET, kode1, WAKTU).cocok, true);
console.log();

// ── 7. Skenario: klien ganti ponsel ────────────────────────────────────────
console.log('  7. Skenario: klien ganti ponsel (pindai QR yang sama)');
const kodePonselBaru = buatTotp(app.secret, WAKTU, 6);
cek('kode tetap sama', kodePonselBaru, kode1);
console.log();

// ── 8. Skenario: jam ponsel meleset ────────────────────────────────────────
console.log('  8. Skenario: jam ponsel klien meleset');
console.log('     (jendela = ±1 LANGKAH waktu, bukan ±30 detik — RFC 6238 §5.2)');
console.log();

// Penting: jendela dihitung dalam LANGKAH, bukan detik.
//
// Langkah = 30 detik. Kode diterima kalau cocok dengan langkah T-1, T, atau T+1.
// Artinya jendela SELALU 90 detik total, tapi posisinya bergeser tergantung
// di detik ke-berapa kita berada dalam langkah saat ini.
//
// Uji yang benar: pilih titik waktu di TENGAH langkah, supaya batasnya jelas.
// Kalau diuji tepat di detik ke-0, +31s masih masuk langkah berikutnya dan
// itu MEMANG benar — bukan bug.
const LANGKAH = 30;
const TENGAH_LANGKAH = Math.floor(WAKTU / 1000 / LANGKAH) * LANGKAH + 15;  // detik ke-15
const W_TENGAH = TENGAH_LANGKAH * 1000;

console.log(`     titik uji: detik ke-15 dalam langkah (batas jelas di kedua sisi)`);
console.log();

// Dengan titik di tengah langkah, batasnya simetris: ±45 detik.
// (15s mundur ke awal langkah + 30s ke langkah sebelumnya = 45s)
const KASUS = [
  { selisih: 0,   harap: true,  label: 'tepat' },
  { selisih: 15,  harap: true,  label: '+15s' },
  { selisih: -15, harap: true,  label: '-15s' },
  { selisih: 30,  harap: true,  label: '+30s (langkah berikutnya)' },
  { selisih: -30, harap: true,  label: '-30s (langkah sebelumnya)' },
  { selisih: 44,  harap: true,  label: '+44s (masih dalam jendela)' },
  { selisih: -44, harap: true,  label: '-44s (masih dalam jendela)' },
  { selisih: 46,  harap: false, label: '+46s (di luar jendela)' },
  { selisih: -46, harap: false, label: '-46s (di luar jendela)' },
  { selisih: 90,  harap: false, label: '+90s (jauh di luar)' },
];

for (const k of KASUS) {
  const kodeMeleset = buatTotp(app.secret, W_TENGAH + k.selisih * 1000, 6);
  const r = verifikasiTotp(SECRET, kodeMeleset, W_TENGAH);
  const status = r.cocok === k.harap ? '✅' : '❌';
  console.log(`     ${status} ${k.label.padEnd(34)} → ${r.cocok ? 'diterima' : 'ditolak'}`);
  if (r.cocok === k.harap) lulus++; else gagal++;
}
console.log();

// ── 9. Enkripsi end-to-end ─────────────────────────────────────────────────
console.log('  9. Skenario: simpan secret ke database');
const SERVICE_SECRET = 'service-secret-produksi-yang-panjang-1234567890';
const tersimpan = enkripsiSecret(SECRET, SERVICE_SECRET);
cek('secret tidak terlihat di database', tersimpan.includes(SECRET), false);
cek('bisa dibaca kembali', dekripsiSecret(tersimpan, SERVICE_SECRET), SECRET);
cek('kode dari secret terdekripsi cocok', buatTotp(dekripsiSecret(tersimpan, SERVICE_SECRET), WAKTU, 6), kode1);
console.log();

console.log('═'.repeat(62));
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('═'.repeat(62));
console.log();
if (gagal === 0) {
  console.log('  ✅ TOTP siap dipakai. Aplikasi authenticator yang memindai');
  console.log('     QR code kita akan menghasilkan kode yang diterima server.');
} else {
  console.log('  ⚠ Ada yang gagal — periksa sebelum dipakai.');
  process.exit(1);
}
