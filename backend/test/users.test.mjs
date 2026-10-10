/**
 * Uji unit modul users.mjs — auth email + password.
 *
 * Dijalankan tanpa server HTTP: hanya logika hashing, validasi, dan
 * penguncian akun. Uji ini harus CEPAT (scrypt 45ms × beberapa kasus).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DB_PATH harus diset SEBELUM modul db dimuat.
const DIR = mkdtempSync(join(tmpdir(), 'uji-users-'));
process.env.DB_PATH = join(DIR, 'uji.db');

// ── Buka database SECARA EKSPLISIT ───────────────────────────────────────────
// Modul db.mjs TIDAK membuka database sendiri saat di-import — ia menunggu
// pemanggil memanggil openDb(). Tanpa baris ini, setiap fungsi users.mjs
// melempar "database belum dibuka — panggil openDb() lebih dulu".
const { openDb } = await import('../src/db.mjs');
openDb(join(DIR, 'uji.db'));

const {
  hashPassword, verifyPassword, normalEmail, emailValid,
  periksaSandi, siapkanTabelPengguna, buatPengguna, cariPengguna,
  ubahSandi, catatGagalMasuk, catatMasukBerhasil, sisaKunci,
  buatTokenReset, pakaiTokenReset, PANJANG_SANDI_MIN,
} = await import('../src/users.mjs');

siapkanTabelPengguna();

// ════════════════════════════════════════════════════════════════════════════
//  HASH & VERIFIKASI SANDI
// ════════════════════════════════════════════════════════════════════════════

test('hashPassword menghasilkan format scrypt$N$r$p$salt$hash', async () => {
  const h = await hashPassword('sandi-yang-panjang-123');
  const bagian = h.split('$');
  assert.equal(bagian.length, 6, 'harus 6 bagian');
  assert.equal(bagian[0], 'scrypt');
  assert.equal(bagian[1], '16384', 'N tersimpan di hash');
  assert.equal(bagian[2], '8');
  assert.equal(bagian[3], '1');
  assert.ok(bagian[4].length > 0, 'salt ada');
  assert.ok(bagian[5].length > 0, 'hash ada');
});

test('dua hash untuk sandi SAMA berbeda (salt acak)', async () => {
  const a = await hashPassword('sandi-yang-panjang-123');
  const b = await hashPassword('sandi-yang-panjang-123');
  assert.notEqual(a, b, 'salt harus berbeda setiap kali');
  // Keduanya tetap harus memverifikasi sandi yang sama
  assert.equal(await verifyPassword('sandi-yang-panjang-123', a), true);
  assert.equal(await verifyPassword('sandi-yang-panjang-123', b), true);
});

test('verifyPassword menerima sandi benar', async () => {
  const h = await hashPassword('KataSandiPanjang2024');
  assert.equal(await verifyPassword('KataSandiPanjang2024', h), true);
});

test('verifyPassword menolak sandi salah', async () => {
  const h = await hashPassword('KataSandiPanjang2024');
  assert.equal(await verifyPassword('KataSandiPanjang2025', h), false);
  assert.equal(await verifyPassword('katasandipanjang2024', h), false, 'case-sensitive');
  assert.equal(await verifyPassword('', h), false);
});

test('verifyPassword TIDAK melempar untuk hash rusak', async () => {
  // Semua ini harus mengembalikan false, bukan melempar exception —
  // pemanggil tidak boleh perlu try/catch hanya untuk data rusak.
  for (const rusak of [
    null, undefined, '', 'bukan-hash', 'scrypt$abc$def',
    'scrypt$16384$8$1$!!!$???', 'bcrypt$16384$8$1$aaa$bbb',
    'scrypt$999999999$8$1$YWFh$YmJi',  // N tidak masuk akal
  ]) {
    const hasil = await verifyPassword('apa-saja', rusak);
    assert.equal(hasil, false, `harus false untuk: ${String(rusak).slice(0, 40)}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  NORMALISASI & VALIDASI EMAIL
// ════════════════════════════════════════════════════════════════════════════

test('normalEmail menyeragamkan huruf besar & spasi', () => {
  assert.equal(normalEmail('  Budi@Perusahaan.COM  '), 'budi@perusahaan.com');
  assert.equal(normalEmail('A@B.CO'), 'a@b.co');
  assert.equal(normalEmail(null), '');
  assert.equal(normalEmail(undefined), '');
});

test('emailValid menerima format wajar', () => {
  for (const e of ['a@b.co', 'nama.belakang@perusahaan.co.id', 'x+tag@mail.com']) {
    assert.equal(emailValid(e), true, `harus valid: ${e}`);
  }
});

test('emailValid menolak format salah', () => {
  for (const e of ['', 'bukan-email', 'a@b', 'a b@c.com', '@b.com', 'a@.com']) {
    assert.equal(emailValid(e), false, `harus tidak valid: ${e}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  KEKUATAN SANDI
// ════════════════════════════════════════════════════════════════════════════

test('periksaSandi menolak sandi terlalu pendek', () => {
  const r = periksaSandi('pendek');
  assert.equal(r.ok, false);
  assert.match(r.pesan, /minimal/i);
});

test(`periksaSandi menerima sandi >= ${PANJANG_SANDI_MIN} karakter`, () => {
  assert.equal(periksaSandi('duabelaschar').ok, true);
  assert.equal(periksaSandi('sandi-panjang-sekali-123').ok, true);
});

test('periksaSandi menolak sandi umum', () => {
  assert.equal(periksaSandi('password1234').ok, false);
  assert.equal(periksaSandi('PASSWORD1234').ok, false, 'harus case-insensitive');
});

test('periksaSandi menolak sandi hanya angka', () => {
  assert.equal(periksaSandi('123456789012').ok, false);
});

test('periksaSandi menolak satu karakter berulang', () => {
  assert.equal(periksaSandi('aaaaaaaaaaaaaa').ok, false);
});

test('periksaSandi menolak sandi sangat panjang (anti-DoS)', () => {
  const r = periksaSandi('a'.repeat(201));
  assert.equal(r.ok, false);
  assert.match(r.pesan, /200/);
});

// ════════════════════════════════════════════════════════════════════════════
//  PENGUNGGUNA
// ════════════════════════════════════════════════════════════════════════════

test('buatPengguna + cariPengguna', async () => {
  const u = await buatPengguna({
    email: 'Budi@Perusahaan.com', nama: 'Budi', perusahaan: 'PT Uji',
    sandi: 'sandi-panjang-budi-1', tokenId: 'tok-1',
  });
  assert.ok(u.id, 'dapat id');
  assert.equal(u.email, 'budi@perusahaan.com', 'email dinormalisasi');

  const cari = cariPengguna('BUDI@PERUSAHAAN.COM');
  assert.ok(cari, 'ditemukan meski beda kapitalisasi');
  assert.equal(cari.nama, 'Budi');
  assert.equal(cari.token_id, 'tok-1');
  assert.equal(cari.status, 'aktif');
  assert.ok(cari.password_hash.startsWith('scrypt$'), 'sandi di-hash');
});

test('cariPengguna mengembalikan undefined untuk email tak dikenal', () => {
  assert.equal(cariPengguna('tidak-ada@mana.com'), undefined);
});

test('email duplikat ditolak (UNIQUE)', async () => {
  await assert.rejects(
    () => buatPengguna({ email: 'budi@perusahaan.com', nama: 'Budi Lain',
      perusahaan: 'PT Lain', sandi: 'sandi-panjang-lain', tokenId: 'tok-2' }),
    /UNIQUE|constraint/i,
  );
});

test('ubahSandi mengganti sandi lama', async () => {
  const u = await buatPengguna({ email: 'ubah@uji.com', nama: 'Ubah',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-1', tokenId: 'tok-3' });

  await ubahSandi(u.id, 'sandi-baru-panjang-2');

  const row = cariPengguna('ubah@uji.com');
  assert.equal(await verifyPassword('sandi-baru-panjang-2', row.password_hash), true);
  assert.equal(await verifyPassword('sandi-lama-panjang-1', row.password_hash), false);
});

// ════════════════════════════════════════════════════════════════════════════
//  PENGUNCIAN AKUN
// ════════════════════════════════════════════════════════════════════════════

test('akun terkunci setelah 10 kegagalan', async () => {
  const u = await buatPengguna({ email: 'kunci@uji.com', nama: 'Kunci',
    perusahaan: 'PT', sandi: 'sandi-panjang-kunci', tokenId: 'tok-4' });

  assert.equal(sisaKunci(u.id), 0, 'awalnya tidak terkunci');

  for (let i = 1; i <= 9; i++) {
    catatGagalMasuk(u.id);
    assert.equal(sisaKunci(u.id), 0, `belum terkunci di percobaan ${i}`);
  }

  catatGagalMasuk(u.id);   // ke-10
  const sisa = sisaKunci(u.id);
  assert.ok(sisa > 0, 'terkunci setelah 10 kegagalan');
  assert.ok(sisa <= 15 * 60, 'masa kunci <= 15 menit');
});

test('masuk berhasil membuka kunci & mereset penghitung', async () => {
  const u = await buatPengguna({ email: 'buka@uji.com', nama: 'Buka',
    perusahaan: 'PT', sandi: 'sandi-panjang-buka', tokenId: 'tok-5' });

  for (let i = 0; i < 10; i++) catatGagalMasuk(u.id);
  assert.ok(sisaKunci(u.id) > 0, 'terkunci dulu');

  catatMasukBerhasil(u.id);
  assert.equal(sisaKunci(u.id), 0, 'kunci terbuka');
  assert.equal(cariPengguna('buka@uji.com').gagal_masuk, 0, 'penghitung direset');
});

// ════════════════════════════════════════════════════════════════════════════
//  TOKEN RESET SANDI
// ════════════════════════════════════════════════════════════════════════════

test('token reset HANYA disimpan sebagai hash', async () => {
  const u = await buatPengguna({ email: 'reset@uji.com', nama: 'Reset',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-x', tokenId: 'tok-6' });

  const token = buatTokenReset(u.id);
  assert.ok(token.length > 30, 'token cukup panjang');

  // Token mentah TIDAK boleh ada di database
  const { getDb } = await import('../src/db.mjs');
  const rows = getDb().prepare('SELECT token_hash FROM password_resets WHERE user_id = ?').all(u.id);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token, 'yang disimpan harus hash, bukan token');
  assert.equal(rows[0].token_hash.length, 64, 'sha256 hex = 64 karakter');
});

test('pakaiTokenReset mengganti sandi', async () => {
  const u = await buatPengguna({ email: 'pakai@uji.com', nama: 'Pakai',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-y', tokenId: 'tok-7' });

  const token = buatTokenReset(u.id);
  const hasil = await pakaiTokenReset(token, 'sandi-baru-panjang-z');

  assert.equal(hasil.ok, true);
  assert.equal(hasil.userId, u.id);

  const row = cariPengguna('pakai@uji.com');
  assert.equal(await verifyPassword('sandi-baru-panjang-z', row.password_hash), true);
  assert.equal(await verifyPassword('sandi-lama-panjang-y', row.password_hash), false);
});

test('token reset tidak bisa dipakai DUA kali', async () => {
  const u = await buatPengguna({ email: 'sekali@uji.com', nama: 'Sekali',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-a', tokenId: 'tok-8' });

  const token = buatTokenReset(u.id);
  assert.equal((await pakaiTokenReset(token, 'sandi-baru-panjang-b')).ok, true);
  assert.equal((await pakaiTokenReset(token, 'sandi-baru-panjang-c')).ok, false);
});

test('token reset palsu ditolak', async () => {
  const hasil = await pakaiTokenReset('token-karangan-yang-tidak-ada', 'sandi-panjang-baru-1');
  assert.equal(hasil.ok, false);
  assert.match(hasil.pesan, /tidak valid|kedaluwarsa/i);
});

test('token reset baru membatalkan token lama', async () => {
  const u = await buatPengguna({ email: 'ganti@uji.com', nama: 'Ganti',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-c', tokenId: 'tok-9' });

  const t1 = buatTokenReset(u.id);
  const t2 = buatTokenReset(u.id);   // permintaan kedua

  // Token pertama harus sudah tidak berlaku
  assert.equal((await pakaiTokenReset(t1, 'sandi-baru-panjang-d')).ok, false);
  assert.equal((await pakaiTokenReset(t2, 'sandi-baru-panjang-e')).ok, true);
});

test('pakaiTokenReset menolak sandi lemah', async () => {
  const u = await buatPengguna({ email: 'lemah@uji.com', nama: 'Lemah',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-d', tokenId: 'tok-10' });

  const token = buatTokenReset(u.id);
  const hasil = await pakaiTokenReset(token, 'pendek');

  assert.equal(hasil.ok, false);
  assert.match(hasil.pesan, /minimal/i);
  // Token harus MASIH bisa dipakai — kegagalan validasi sandi tidak boleh
  // menghanguskan token, kalau tidak pengguna terjebak tanpa jalan.
  assert.equal((await pakaiTokenReset(token, 'sandi-panjang-yang-benar')).ok, true);
});

test('reset sandi membuka akun yang terkunci', async () => {
  const u = await buatPengguna({ email: 'bukareset@uji.com', nama: 'BukaReset',
    perusahaan: 'PT', sandi: 'sandi-lama-panjang-e', tokenId: 'tok-11' });

  for (let i = 0; i < 10; i++) catatGagalMasuk(u.id);
  assert.ok(sisaKunci(u.id) > 0, 'terkunci dulu');

  const token = buatTokenReset(u.id);
  await pakaiTokenReset(token, 'sandi-baru-panjang-f');

  assert.equal(sisaKunci(u.id), 0, 'reset membuka kunci');
});

// ── Bersih-bersih ────────────────────────────────────────────────────────────
process.on('exit', () => {
  try { rmSync(DIR, { recursive: true, force: true }); } catch {}
});
