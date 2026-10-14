/**
 * Tes aturan langganan & kuota token.
 *
 * ── KENAPA TES INI PENTING ──────────────────────────────────────────────────
 * Ini modul yang menentukan siapa boleh apa. Kesalahan di sini bukan bug
 * tampilan — ia berarti orang bisa memakai layanan yang belum dia bayar, atau
 * sebaliknya: pelanggan yang sudah bayar tetap terkunci.
 *
 * Yang diuji bukan "apakah fungsinya jalan", tapi "apakah aturannya benar
 * untuk SETIAP kombinasi paket dan keadaan". Karena itu hampir semua tes di
 * bawah memakai tabel — satu baris per kombinasi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KUOTA_DASAR,
  BONUS_STAR,
  PAKET_SAH,
  PAKET_BERBAYAR,
  bulanSekarang,
  awalBulanDepan,
  hitungKuota,
  bolehLihatMetrik,
  pesanTolak,
} from '../src/langganan.mjs';

// ── 1. KUOTA DASAR PER PAKET ─────────────────────────────────────────────────

test('kuota dasar: gratis 0, standar 1, profesional 5, enterprise tanpa batas', () => {
  assert.equal(KUOTA_DASAR.gratis, 0);
  assert.equal(KUOTA_DASAR.standar, 1);
  assert.equal(KUOTA_DASAR.profesional, 5);
  assert.equal(KUOTA_DASAR.enterprise, null, 'null = tanpa batas');
});

test('kuota 12 bulan sesuai yang diminta pemilik proyek', () => {
  // Standar 1/bulan × 12 = 12 · Profesional 5/bulan × 12 = 60
  assert.equal(KUOTA_DASAR.standar * 12, 12);
  assert.equal(KUOTA_DASAR.profesional * 12, 60);
});

test('paket sah: empat paket, tiga berbayar', () => {
  assert.equal(PAKET_SAH.size, 4);
  assert.equal(PAKET_BERBAYAR.size, 3);
  assert.ok(!PAKET_BERBAYAR.has('gratis'), 'gratis TIDAK boleh membuat token');
});

// ── 2. BULAN — ZONA WAKTU ────────────────────────────────────────────────────

test('bulanSekarang memakai zona Asia/Jakarta, bukan UTC', () => {
  // 31 Des 2026, 18:00 UTC = 1 Jan 2027, 01:00 WIB (UTC+7)
  // Kalau memakai UTC, ini terbaca "2026-12" — padahal di Jakarta sudah 2027.
  const malamTahunBaru = new Date('2026-12-31T18:00:00Z');
  assert.equal(bulanSekarang(malamTahunBaru), '2027-01',
    'harus ikut waktu Jakarta, bukan UTC');
});

test('bulanSekarang: tengah malam Jakarta tetap bulan yang benar', () => {
  // 1 Okt 2026, 00:00 WIB = 30 Sep 2026, 17:00 UTC
  const tengahMalam = new Date('2026-09-30T17:00:00Z');
  assert.equal(bulanSekarang(tengahMalam), '2026-10');
});

test('awalBulanDepan selalu di masa depan, dan tidak lebih dari 32 hari', () => {
  for (const iso of ['2026-01-15T00:00:00Z', '2026-02-28T12:00:00Z', '2026-12-31T23:00:00Z']) {
    const d = new Date(iso);
    const selisih = awalBulanDepan(d) - d.getTime();
    assert.ok(selisih > 0, `${iso}: reset harus di masa depan`);
    assert.ok(selisih <= 32 * 24 * 60 * 60 * 1000, `${iso}: reset terlalu jauh`);
  }
});

// ── 3. HITUNG KUOTA ──────────────────────────────────────────────────────────

test('gratis: tidak boleh membuat token sama sekali', () => {
  const k = hitungKuota({ paket: 'gratis', terpakai: 0, bonusStar: false });
  assert.equal(k.total, 0);
  assert.equal(k.bolehBuat, false);
});

test('gratis + bonus star: TETAP tidak boleh buat token', () => {
  // Bonus star untuk pengguna gratis adalah TRIAL METRIK, bukan token.
  // Kalau ini lolos, pengguna gratis bisa membuat token — pelanggaran aturan.
  const k = hitungKuota({ paket: 'gratis', terpakai: 0, bonusStar: true });
  assert.equal(k.bonus, 0, 'bonus tidak berlaku untuk paket gratis');
  assert.equal(k.total, 0);
  assert.equal(k.bolehBuat, false);
});

test('standar: 1 token, habis setelah dipakai', () => {
  const belum = hitungKuota({ paket: 'standar', terpakai: 0 });
  assert.equal(belum.total, 1);
  assert.equal(belum.sisa, 1);
  assert.equal(belum.bolehBuat, true);

  const sudah = hitungKuota({ paket: 'standar', terpakai: 1 });
  assert.equal(sudah.sisa, 0);
  assert.equal(sudah.bolehBuat, false);
});

test('standar + bonus star: 1 + 1 = 2 (sesuai penjelasan pemilik proyek)', () => {
  const k = hitungKuota({ paket: 'standar', terpakai: 0, bonusStar: true });
  assert.equal(k.dasar, 1);
  assert.equal(k.bonus, 1);
  assert.equal(k.total, 2, 'kuota jadi 2, bukan 1');
  assert.equal(k.bolehBuat, true);
});

test('profesional: 5 token, dan 5 + 1 = 6 setelah bonus star', () => {
  assert.equal(hitungKuota({ paket: 'profesional' }).total, 5);
  assert.equal(hitungKuota({ paket: 'profesional', bonusStar: true }).total, 6);
});

test('profesional: habis tepat di token ke-5', () => {
  assert.equal(hitungKuota({ paket: 'profesional', terpakai: 4 }).bolehBuat, true);
  assert.equal(hitungKuota({ paket: 'profesional', terpakai: 5 }).bolehBuat, false);
});

test('enterprise: tanpa batas, terpakai berapa pun tetap boleh', () => {
  const k = hitungKuota({ paket: 'enterprise', terpakai: 9999 });
  assert.equal(k.tanpaBatas, true);
  assert.equal(k.total, null);
  assert.equal(k.sisa, null);
  assert.equal(k.bolehBuat, true);
});

test('paket tidak dikenal diperlakukan sebagai gratis (aman, bukan permisif)', () => {
  // Kalau string paket datang dari luar dan tidak dikenal, jawabannya harus
  // MENOLAK. Kalau jatuh ke "standar" atau "enterprise", penyusup bisa
  // mengirim paket palsu dan langsung dapat akses.
  for (const palsu of ['enterprise-plus', '', 'admin', 'STANDAR', null, undefined]) {
    const k = hitungKuota({ paket: palsu });
    assert.equal(k.paket, 'gratis', `"${palsu}" harus jadi gratis`);
    assert.equal(k.bolehBuat, false, `"${palsu}" tidak boleh membuat token`);
  }
});

test('terpakai melebihi kuota tidak menghasilkan sisa negatif', () => {
  const k = hitungKuota({ paket: 'standar', terpakai: 99 });
  assert.equal(k.sisa, 0, 'sisa tidak boleh negatif');
  assert.equal(k.bolehBuat, false);
});

test('kuota memuat info reset untuk ditampilkan ke pengguna', () => {
  const k = hitungKuota({ paket: 'standar', sekarang: new Date('2026-10-20T00:00:00Z') });
  assert.equal(k.bulan, '2026-10');
  assert.ok(k.resetPada > 0);
  assert.ok(k.hariSampaiReset >= 1 && k.hariSampaiReset <= 32);
});

// ── 4. AKSES METRIK ──────────────────────────────────────────────────────────

test('metrik: paket berbayar selalu boleh, tanpa memakai trial', () => {
  for (const paket of ['standar', 'profesional', 'enterprise']) {
    const r = bolehLihatMetrik({ paket, sudahPakaiTrial: false, sudahStar: false });
    assert.equal(r.boleh, true, `${paket} harus boleh`);
    assert.equal(r.alasan, 'langganan');
    assert.equal(r.pakaiTrial, false, 'jangan pakai jatah trial kalau sudah langganan');
  }
});

test('metrik: gratis tanpa star ditolak', () => {
  const r = bolehLihatMetrik({ paket: 'gratis', sudahPakaiTrial: false, sudahStar: false });
  assert.equal(r.boleh, false);
  assert.equal(r.alasan, 'perlu-star');
});

test('metrik: gratis + star boleh, dan MEMAKAI jatah trial', () => {
  const r = bolehLihatMetrik({ paket: 'gratis', sudahPakaiTrial: false, sudahStar: true });
  assert.equal(r.boleh, true);
  assert.equal(r.alasan, 'trial-baru');
  assert.equal(r.pakaiTrial, true, 'pemanggil WAJIB mencatat pemakaiannya');
});

// ── ATURAN PER AKUN — DIKONFIRMASI PEMILIK PROYEK ────────────────────────────
//
// "Per akun — total 1× saja untuk semua proyek."
//
// Jadi setelah trial dipakai di satu proyek, proyek LAIN terkunci. Yang tetap
// boleh: membuka ulang proyek yang SAMA — kalau tidak, me-refresh halaman akan
// menghilangkan akses yang sudah dia dapat.

test('metrik: trial sudah dipakai — proyek yang SAMA tetap boleh dibuka', () => {
  const r = bolehLihatMetrik({
    paket: 'gratis', sudahPakaiTrial: true, sudahStar: true, proyekSama: true,
  });
  assert.equal(r.boleh, true, 'refresh tidak boleh menghilangkan akses');
  assert.equal(r.alasan, 'trial-terpakai');
  assert.equal(r.pakaiTrial, false, 'jangan catat pemakaian dua kali');
});

test('metrik: trial sudah dipakai — proyek LAIN terkunci', () => {
  const r = bolehLihatMetrik({
    paket: 'gratis', sudahPakaiTrial: true, sudahStar: true, proyekSama: false,
  });
  assert.equal(r.boleh, false, 'jatahnya satu untuk semua proyek');
  assert.equal(r.alasan, 'trial-habis-proyek-lain');
  assert.equal(r.pakaiTrial, false);
});

test('metrik: tanpa proyekSama, trial terpakai dianggap proyek lain (aman)', () => {
  // Kalau pemanggil lupa mengirim `proyekSama`, jawabannya harus MENOLAK —
  // bukan membuka. Lupa mengirim argumen tidak boleh berubah jadi akses gratis.
  const r = bolehLihatMetrik({ paket: 'gratis', sudahPakaiTrial: true, sudahStar: true });
  assert.equal(r.boleh, false, 'argumen yang hilang harus menolak, bukan membuka');
});

test('metrik: langganan berbayar tidak terpengaruh proyekSama', () => {
  for (const paket of ['standar', 'profesional', 'enterprise']) {
    const r = bolehLihatMetrik({
      paket, sudahPakaiTrial: true, sudahStar: true, proyekSama: false,
    });
    assert.equal(r.boleh, true, `${paket} tidak boleh terkunci oleh jatah trial`);
  }
});

test('metrik: paket palsu diperlakukan sebagai gratis', () => {
  const r = bolehLihatMetrik({ paket: 'enterprise-gratis', sudahPakaiTrial: false, sudahStar: false });
  assert.equal(r.boleh, false, 'paket palsu tidak boleh membuka akses');
});

// ── 5. PESAN ─────────────────────────────────────────────────────────────────

test('setiap alasan penolakan punya pesan yang menjelaskan cara membukanya', () => {
  for (const alasan of ['perlu-star', 'kuota-habis', 'bukan-langganan']) {
    const p = pesanTolak(alasan);
    assert.ok(p.length > 20, `pesan "${alasan}" terlalu pendek`);
    assert.ok(/[.]$/.test(p), `pesan "${alasan}" harus kalimat lengkap`);
  }
});

test('pesan tidak menyebut istilah teknis yang tidak dipahami pembaca', () => {
  // Pengguna halaman ini calon pembeli, bukan engineer. Pesan yang menyebut
  // "tier", "quota", atau "subscription" tidak menjelaskan apa pun.
  const terlarang = /\b(tier|quota|kuota|subscription|endpoint|API|token invalid)\b/i;
  for (const alasan of ['perlu-star', 'kuota-habis', 'bukan-langganan']) {
    const p = pesanTolak(alasan);
    // "token akses" adalah istilah yang sudah dipakai di halaman lain, jadi
    // yang dilarang adalah "kuota" sebagai kata berdiri sendiri.
    const tanpaIstilahSah = p.replace(/token akses/gi, '');
    assert.ok(!terlarang.test(tanpaIstilahSah),
      `pesan "${alasan}" memakai istilah teknis: ${p}`);
  }
});
