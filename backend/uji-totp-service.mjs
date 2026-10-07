/**
 * Uji alur 2FA end-to-end dengan database SEMENTARA.
 *
 * ── KENAPA DB SEMENTARA ─────────────────────────────────────────────────────
 * Uji ini membuat/menghapus data 2FA. Menjalankannya di database produksi
 * akan mengacaukan data klien nyata. Jadi setiap uji memakai file DB di
 * /tmp yang dihapus setelah selesai.
 *
 * Diuji: enrollment → verifikasi → login → kode pemulihan → cabut.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set HERMES/DB path SEBELUM modul db dimuat — db.mjs membaca env saat import.
const DIR = mkdtempSync(join(tmpdir(), 'uji-totp-'));
process.env.TOKEN_DB_PATH = join(DIR, 'uji.db');

const { openDb, getDb } = await import('./src/db.mjs');
const {
  mulaiEnrollment, selesaikanEnrollment, verifikasi2fa,
  totpAktif, totpMenungguVerifikasi, statusTotp,
  cabut2fa, buatUlangKodePemulihan, riwayatPercobaan,
} = await import('./src/totp-service.mjs');
const { buatTotp } = await import('./src/totp.mjs');

const CONFIG = { secret: 'uji-service-secret-panjang-minimal-16-karakter-12345' };

let lulus = 0, gagal = 0;
const cek = (nama, hasil, harapan) => {
  const ok = hasil === harapan;
  if (ok) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}\n     dapat: ${JSON.stringify(hasil)}\n     harus: ${JSON.stringify(harapan)}`); }
};

// ── Buka DB ────────────────────────────────────────────────────────────────
openDb(process.env.TOKEN_DB_PATH);

console.log('══ 0. SKEMA DATABASE ══');
const tabel = getDb().prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'totp%' ORDER BY name`
).all().map((r) => r.name);
cek('tabel totp_secrets dibuat', tabel.includes('totp_secrets'), true);
cek('tabel totp_recovery dibuat', tabel.includes('totp_recovery'), true);
cek('tabel totp_attempts dibuat', tabel.includes('totp_attempts'), true);
console.log();

const KLIEN = 'klien@perusahaan.co.id';

console.log('══ 1. STATUS AWAL ══');
cek('2FA belum aktif', totpAktif(KLIEN), false);
cek('tidak menunggu verifikasi', totpMenungguVerifikasi(KLIEN), false);
cek('status kosong', statusTotp(KLIEN).aktif, false);
console.log();

console.log('══ 2. ENROLLMENT ══');
const enroll = mulaiEnrollment(KLIEN, CONFIG);
cek('secret dibuat (32 char base32)', enroll.secret.length, 32);
cek('URI otpauth dibuat', enroll.uri.startsWith('otpauth://totp/'), true);
cek('issuer benar', enroll.issuer, 'Victer Portfolio');
cek('akun = identitas', enroll.akun, KLIEN);
cek('digit 6', enroll.digit, 6);
cek('periode 30', enroll.periode, 30);
cek('setelah enroll: menunggu verifikasi', totpMenungguVerifikasi(KLIEN), true);
cek('setelah enroll: BELUM aktif', totpAktif(KLIEN), false);
console.log();

console.log('══ 3. ENROLLMENT DENGAN KODE SALAH ══');
const salah = selesaikanEnrollment(KLIEN, '000000', CONFIG);
cek('kode salah ditolak', salah.ok, false);
cek('alasan kode_salah', salah.alasan, 'kode_salah');
cek('sisa percobaan dilaporkan', salah.sisa_percobaan, 4);
cek('masih menunggu (belum aktif)', totpAktif(KLIEN), false);
console.log();

console.log('══ 4. ENROLLMENT DENGAN KODE BENAR ══');
const kodeBenar = buatTotp(enroll.secret);
const selesai = selesaikanEnrollment(KLIEN, kodeBenar, CONFIG);
cek('enrollment berhasil', selesai.ok, true);
cek('8 kode pemulihan dibuat', selesai.kode_pemulihan.length, 8);
cek('format kode pemulihan', /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(selesai.kode_pemulihan[0]), true);
cek('sekarang 2FA AKTIF', totpAktif(KLIEN), true);
cek('tidak lagi menunggu', totpMenungguVerifikasi(KLIEN), false);
const st = statusTotp(KLIEN);
cek('status: aktif', st.aktif, true);
cek('status: 8 kode pemulihan tersisa', st.kode_pemulihan_tersisa, 8);
console.log();

console.log('══ 5. ENROLLMENT ULANG SAAT SUDAH AKTIF ══');
let ditolak = false;
try { mulaiEnrollment(KLIEN, CONFIG); } catch (e) { ditolak = e.kode === 'totp_sudah_aktif'; }
cek('enrollment ulang ditolak', ditolak, true);
console.log();

console.log('══ 6. VERIFIKASI LOGIN ══');
// Pakai waktu sekarang supaya kode valid
const kodeLogin = buatTotp(enroll.secret);
const login = verifikasi2fa(KLIEN, kodeLogin, CONFIG, { ip: '10.0.0.1' });
cek('login dengan kode benar', login.ok, true);
cek('metode totp', login.metode, 'totp');
console.log();

console.log('══ 7. DETEKSI REPLAY (kode sama dua kali) ══');
const replay = verifikasi2fa(KLIEN, kodeLogin, CONFIG, { ip: '10.0.0.1' });
cek('kode sama DITOLAK', replay.ok, false);
cek('alasan kode_dipakai_ulang', replay.alasan, 'kode_dipakai_ulang');
console.log();

console.log('══ 8. KODE SALAH DIULANG (batas percobaan) ══');
let terakhir;
for (let i = 0; i < 6; i++) {
  terakhir = verifikasi2fa(KLIEN, '111111', CONFIG, { ip: '10.0.0.2' });
}
cek('akhirnya diblokir sementara', terakhir.alasan, 'diblokir_sementara');
cek('pesan menyebut menit', /menit/.test(terakhir.pesan), true);
console.log();

console.log('══ 9. KODE BENAR SAAT DIBLOKIR ══');
// Kode baru (langkah waktu berbeda) — tapi tetap diblokir karena batas percobaan
const kodeSetelahBlokir = buatTotp(enroll.secret, Date.now() + 30000);
const saatBlokir = verifikasi2fa(KLIEN, kodeSetelahBlokir, CONFIG, { ip: '10.0.0.3' });
cek('kode benar tetap ditolak saat diblokir', saatBlokir.ok, false);
cek('alasan diblokir_sementara', saatBlokir.alasan, 'diblokir_sementara');
console.log();

console.log('══ 10. KODE PEMULIHAN ══');
// Kode pemulihan melewati batas? Tidak — tapi kita uji dengan cara
// membersihkan riwayat percobaan dulu supaya bisa menguji jalur pemulihan.
getDb().prepare(`DELETE FROM totp_attempts WHERE identity = ?`).run(KLIEN);

const kodePulih = selesai.kode_pemulihan[0];
const pakaiPulih = verifikasi2fa(KLIEN, kodePulih, CONFIG, { ip: '10.0.0.4' });
cek('kode pemulihan diterima', pakaiPulih.ok, true);
cek('metode kode_pemulihan', pakaiPulih.metode, 'kode_pemulihan');
cek('sisa 7 kode', pakaiPulih.kode_pemulihan_tersisa, 7);

// Pakai lagi → harus ditolak (sekali pakai)
getDb().prepare(`DELETE FROM totp_attempts WHERE identity = ?`).run(KLIEN);
const pulihLagi = verifikasi2fa(KLIEN, kodePulih, CONFIG, { ip: '10.0.0.5' });
cek('kode pemulihan SEKALI PAKAI', pulihLagi.ok, false);
console.log();

console.log('══ 11. BUAT ULANG KODE PEMULIHAN ══');
getDb().prepare(`DELETE FROM totp_attempts WHERE identity = ?`).run(KLIEN);
const ulang = buatUlangKodePemulihan(KLIEN, CONFIG);
cek('kode baru dibuat', ulang.ok, true);
cek('8 kode baru', ulang.kode_pemulihan.length, 8);
cek('kode lama tidak berlaku', ulang.kode_pemulihan[0] !== kodePulih, true);
cek('status: 8 kode tersisa', statusTotp(KLIEN).kode_pemulihan_tersisa, 8);
console.log();

console.log('══ 12. AUDIT RIWAYAT ══');
// Catatan: beberapa langkah sebelumnya menghapus riwayat percobaan supaya
// bisa menguji jalur kode pemulihan tanpa terblokir batas percobaan.
// Jadi di sini kita lakukan percobaan BARU dulu, baru periksa.
verifikasi2fa(KLIEN, '999999', CONFIG, { ip: '10.0.0.9' });   // gagal, tercatat

// Kode untuk jalur BERHASIL harus dari langkah waktu yang MASIH dalam
// jendela. +30 detik = 1 langkah ke depan → masih diterima.
// (+60 detik = 2 langkah → DITOLAK, dan itu memang benar.)
const kodeAudit = buatTotp(enroll.secret, Date.now() + 30000);
const auditLogin = verifikasi2fa(KLIEN, kodeAudit, CONFIG, { ip: '10.0.0.10' });
cek('login audit berhasil', auditLogin.ok, true);

const riwayat = riwayatPercobaan(KLIEN, 50);
cek('riwayat tercatat', riwayat.length >= 2, true);
cek('ada catatan berhasil', riwayat.some((r) => r.berhasil === 1), true);
cek('ada catatan gagal', riwayat.some((r) => r.berhasil === 0), true);
cek('IP tercatat di audit', riwayat.some((r) => r.ip === '10.0.0.9' || r.ip === '10.0.0.10'), true);
console.log();

console.log('══ 13. IDENTITAS LAIN TIDAK TERPENGARUH ══');
const LAIN = 'orang-lain@example.com';
cek('2FA orang lain tidak aktif', totpAktif(LAIN), false);
const loginLain = verifikasi2fa(LAIN, '123456', CONFIG);
cek('login orang lain ditolak', loginLain.alasan, 'tidak_aktif');
console.log();

console.log('══ 14. SECRET TIDAK DISIMPAN POLOS ══');
const baris = getDb().prepare(
  `SELECT secret_enc FROM totp_secrets WHERE identity = ?`
).get(KLIEN);
cek('secret_enc bukan base32 polos', baris.secret_enc.includes(enroll.secret), false);
cek('format terenkripsi v1', baris.secret_enc.startsWith('v1.'), true);
console.log();

console.log('══ 15. CABUT 2FA ══');
const cabut = cabut2fa(KLIEN);
cek('cabut berhasil', cabut.ok, true);
cek('2FA tidak aktif lagi', totpAktif(KLIEN), false);
cek('kode pemulihan ikut terhapus', statusTotp(KLIEN).kode_pemulihan_tersisa, 0);
const loginSetelahCabut = verifikasi2fa(KLIEN, '123456', CONFIG);
cek('login ditolak setelah cabut', loginSetelahCabut.alasan, 'tidak_aktif');
console.log();

console.log('══ 16. KASUS TEPI ══');
cek('identity kosong ditolak', (() => { try { mulaiEnrollment('', CONFIG); return false; } catch { return true; } })(), true);
cek('service secret pendek ditolak', (() => { try { mulaiEnrollment('x@y.z', { secret: 'pendek' }); return false; } catch { return true; } })(), true);
cek('verifikasi identity tak dikenal', verifikasi2fa('tidak-ada@x.y', '123456', CONFIG).alasan, 'tidak_aktif');
console.log();

// ── Bersihkan ──────────────────────────────────────────────────────────────
try { getDb().close(); } catch {}
rmSync(DIR, { recursive: true, force: true });

console.log('═'.repeat(62));
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('═'.repeat(62));
if (gagal === 0) {
  console.log('\n  ✅ Alur 2FA lengkap bekerja end-to-end.');
} else {
  console.log('\n  ⚠ Ada yang gagal — periksa sebelum dipakai.');
  process.exit(1);
}
