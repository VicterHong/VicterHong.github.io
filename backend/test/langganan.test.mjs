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

// ── 4. AKSES METRIK — ATURAN 3 DARI LOGIN + 2 DARI STAR ──────────────────────
//
// ── PERUBAHAN ATURAN ─────────────────────────────────────────────────────────
// Aturan lama: satu proyek per akun, WAJIB star dulu.
// Aturan baru: lima proyek — tiga langsung dari login, dua lagi dari star.
//
// ── KENAPA ATURANNYA DIUBAH ──────────────────────────────────────────────────
// Aturan lama punya lingkaran yang tidak bisa diputus: pengguna baru tidak bisa
// melihat apa pun sebelum memberi star, padahal dia belum tahu kualitas
// datanya — jadi tidak ada alasan baginya memberi star.
//
// Sekarang: lihat dulu tiga proyek, baru beri star untuk dua lagi.

test('metrik: paket berbayar selalu boleh, tanpa memakai jatah gratis', () => {
  for (const paket of ['standar', 'profesional', 'enterprise']) {
    const r = bolehLihatMetrik({ paket, jumlahTerbuka: 0, sudahStar: false });
    assert.equal(r.boleh, true, `${paket} harus boleh`);
    assert.equal(r.alasan, 'langganan');
    assert.equal(r.pakaiJatah, false, 'jangan pakai jatah gratis kalau sudah langganan');
  }
});

test('metrik: gratis langsung dapat 3 proyek TANPA star', () => {
  for (let i = 0; i < 3; i++) {
    const r = bolehLihatMetrik({ paket: 'gratis', jumlahTerbuka: i, sudahStar: false });
    assert.equal(r.boleh, true, `proyek ke-${i + 1} harus boleh tanpa star`);
    assert.equal(r.pakaiJatah, true);
    assert.equal(r.sumber, 'login', `proyek ke-${i + 1} memakai jatah login`);
  }
});

test('metrik: proyek ke-4 tanpa star ditolak, dengan jalan keluar', () => {
  const r = bolehLihatMetrik({ paket: 'gratis', jumlahTerbuka: 3, sudahStar: false });
  assert.equal(r.boleh, false);
  assert.equal(r.alasan, 'jatah-habis-bisa-star',
    'harus menyebut star sebagai jalan keluar, bukan langsung menyuruh berlangganan');
});

test('metrik: star menambah 2 proyek lagi (total 5)', () => {
  // Setelah star, proyek ke-4 dan ke-5 boleh — dan sumbernya ditandai 'star'.
  for (const i of [3, 4]) {
    const r = bolehLihatMetrik({ paket: 'gratis', jumlahTerbuka: i, sudahStar: true });
    assert.equal(r.boleh, true, `proyek ke-${i + 1} harus boleh setelah star`);
    assert.equal(r.sumber, 'star', `proyek ke-${i + 1} memakai jatah star`);
  }
});

test('metrik: proyek ke-6 ditolak walau sudah star', () => {
  const r = bolehLihatMetrik({ paket: 'gratis', jumlahTerbuka: 5, sudahStar: true });
  assert.equal(r.boleh, false);
  assert.equal(r.alasan, 'jatah-habis',
    'sudah star, jadi jangan sebut star lagi sebagai jalan keluar');
});

// ── PROYEK YANG SUDAH TERBUKA TETAP TERBUKA ──────────────────────────────────

test('metrik: proyek yang SAMA tetap boleh dibuka ulang', () => {
  // Me-refresh halaman tidak boleh menghilangkan akses yang sudah didapat, dan
  // tidak boleh memakan jatah kedua.
  const r = bolehLihatMetrik({
    paket: 'gratis', jumlahTerbuka: 3, sudahStar: false, proyekSama: true,
  });
  assert.equal(r.boleh, true, 'refresh tidak boleh menghilangkan akses');
  assert.equal(r.alasan, 'sudah-terbuka');
  assert.equal(r.pakaiJatah, false, 'jangan catat pemakaian dua kali');
});

test('metrik: proyek yang sudah terbuka boleh dibuka walau jatah habis', () => {
  // Ini kasus paling penting: pengguna yang sudah memakai kelima jatahnya
  // harus tetap bisa membuka proyek yang sudah dia buka.
  const r = bolehLihatMetrik({
    paket: 'gratis', jumlahTerbuka: 5, sudahStar: true, proyekSama: true,
  });
  assert.equal(r.boleh, true, 'jatah habis tidak boleh mengunci proyek yang sudah terbuka');
});

test('metrik: langganan berbayar tidak terpengaruh proyekSama', () => {
  for (const paket of ['standar', 'profesional', 'enterprise']) {
    const r = bolehLihatMetrik({
      paket, jumlahTerbuka: 5, sudahStar: true, proyekSama: false,
    });
    assert.equal(r.boleh, true, `${paket} tidak boleh terkunci oleh jatah gratis`);
  }
});

test('metrik: paket palsu diperlakukan sebagai gratis', () => {
  // ── NIAT TES INI TIDAK BERUBAH ────────────────────────────────────────────
  // Paket yang tidak dikenal TIDAK BOLEH membuka akses berbayar. Kalau string
  // paket palsu diperlakukan sebagai berbayar, siapa pun bisa mengirim
  // paket='enterprise' dari klien dan mendapat akses penuh.
  //
  // Yang berubah hanya ARGUMENNYA: aturan baru memakai `jumlahTerbuka`, bukan
  // `sudahPakaiTrial`.
  //
  // ── PAKET PALSU = GRATIS, DAN ITU ARTINYA MASIH DAPAT JATAH GRATIS ────────
  // Versi pertama tes ini mengharapkan `boleh: false` — benar untuk aturan
  // LAMA, di mana pengguna gratis tanpa star memang ditolak.
  //
  // Di aturan baru, pengguna gratis tanpa star BOLEH membuka tiga proyek
  // pertama. Jadi paket palsu pun boleh — TAPI sebagai gratis (memakai jatah
  // login), bukan sebagai berbayar.
  //
  // Yang harus diuji: paket palsu tidak mendapat perlakuan BERBAYAR.
  const r = bolehLihatMetrik({ paket: 'enterprise-gratis', jumlahTerbuka: 0, sudahStar: false });
  assert.equal(r.boleh, true, 'paket palsu diperlakukan sebagai gratis, dan gratis punya jatah');
  assert.equal(r.alasan, 'jatah-pertama', 'perlakuannya sebagai gratis, bukan berbayar');
  assert.equal(r.sumber, 'login');

  // Dan setelah jatah gratisnya habis, paket palsu TIDAK boleh membuka
  const habis = bolehLihatMetrik({ paket: 'enterprise-gratis', jumlahTerbuka: 5, sudahStar: true });
  assert.equal(habis.boleh, false, 'paket palsu tidak boleh melewati batas gratis');
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
