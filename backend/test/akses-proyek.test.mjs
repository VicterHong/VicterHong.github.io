/**
 * Tes modul akses proyek — dengan DATABASE SUNGGUHAN.
 *
 * ── KENAPA DATABASE SUNGGUHAN, BUKAN MOCK ──────────────────────────────────
 * Modul ini bergantung pada tiga batasan database yang tidak bisa ditiru mock:
 *
 *   UNIQUE(user_id)                 di bonus_star
 *   UNIQUE(user_id)                 di trial_metrik
 *   UNIQUE(user_id, bulan)          di kuota_token
 *
 * Mock yang "selalu menerima INSERT" akan meloloskan tes yang seharusnya
 * gagal — dan kegagalan yang lolos itu adalah orang mengklaim bonus dua kali.
 * Jadi tes ini memakai SQLite sungguhan di memori.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, getDb } from '../src/db.mjs';

// Modul akses membaca database lewat getDb(), jadi database harus dibuka
// SEBELUM modulnya diimpor.
openDb(':memory:');
const akses = await import('../src/akses-proyek.mjs');
const { hitungKuota, bulanSekarang } = await import('../src/langganan.mjs');

const USER = 'u-uji-1';
const USER2 = 'u-uji-2';

function bersihkan() {
  const db = getDb();
  for (const t of ['langganan', 'kuota_token', 'bonus_star', 'trial_metrik', 'star_cache']) {
    db.exec(`DELETE FROM ${t}`);
  }
}

function beriLangganan(userId, paket, { selesaiAt = null } = {}) {
  getDb().prepare(`
    INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at)
    VALUES (?, ?, ?, 'bulanan', ?, ?, 'aktif', ?)
  `).run('l-' + userId, userId, paket, Date.now(), selesaiAt, Date.now());
}

beforeEach(bersihkan);
after(() => closeDb());

// ── 1. PAKET PENGGUNA ────────────────────────────────────────────────────────

test('tanpa langganan: paket gratis', () => {
  assert.equal(akses.paketPengguna(USER), 'gratis');
});

test('langganan aktif: paket terbaca', () => {
  beriLangganan(USER, 'profesional');
  assert.equal(akses.paketPengguna(USER), 'profesional');
});

test('langganan KEDALUWARSA dianggap gratis, walau status masih aktif', () => {
  // ── KENAPA INI PENTING ───────────────────────────────────────────────────
  // Baris bisa tertinggal 'aktif' padahal waktunya sudah habis — misalnya
  // webhook pembayaran gagal memperbarui. Kalau kode hanya membaca `status`,
  // orang itu tetap dapat akses berbayar tanpa membayar.
  beriLangganan(USER, 'profesional', { selesaiAt: Date.now() - 1000 });
  assert.equal(akses.paketPengguna(USER), 'gratis',
    'langganan yang tanggalnya lewat harus berhenti sendiri');
});

test('langganan tanpa tanggal berakhir: tetap aktif', () => {
  beriLangganan(USER, 'standar', { selesaiAt: null });
  assert.equal(akses.paketPengguna(USER), 'standar');
});

test('paket tidak dikenal di database dianggap gratis (aman)', () => {
  beriLangganan(USER, 'super-admin');
  assert.equal(akses.paketPengguna(USER), 'gratis');
});

test('tanpa userId: gratis, tanpa error', () => {
  for (const kosong of [null, undefined, '']) {
    assert.equal(akses.paketPengguna(kosong), 'gratis');
  }
});

// ── 2. BONUS STAR ────────────────────────────────────────────────────────────

test('bonus star: klaim pertama berhasil, kedua DITOLAK', () => {
  assert.equal(akses.sudahKlaimBonus(USER), false);
  assert.equal(akses.catatBonusStar(USER, { paket: 'standar' }), true);
  assert.equal(akses.sudahKlaimBonus(USER), true);
  assert.equal(akses.catatBonusStar(USER, { paket: 'standar' }), false,
    'klaim kedua harus ditolak — sekali seumur akun');
});

test('bonus star: pengguna berbeda punya jatah sendiri', () => {
  akses.catatBonusStar(USER, { paket: 'standar' });
  assert.equal(akses.catatBonusStar(USER2, { paket: 'standar' }), true);
});

test('bonus star menambah kuota paket berbayar', () => {
  beriLangganan(USER, 'standar');
  assert.equal(akses.keadaanKuota(USER).total, 1);

  akses.catatBonusStar(USER, { paket: 'standar' });
  assert.equal(akses.keadaanKuota(USER).total, 2, 'standar + bonus = 2');
});

test('bonus star TIDAK memberi token ke pengguna gratis', () => {
  akses.catatBonusStar(USER, { paket: 'gratis' });
  const k = akses.keadaanKuota(USER);
  assert.equal(k.total, 0, 'gratis tetap 0 token');
  assert.equal(k.bolehBuat, false);
});

// ── 3. KUOTA TOKEN ───────────────────────────────────────────────────────────

test('kuota awal: terpakai 0', () => {
  beriLangganan(USER, 'standar');
  assert.equal(akses.terpakaiBulanIni(USER), 0);
});

test('pakaiKuota menambah hitungan', () => {
  beriLangganan(USER, 'standar');
  assert.equal(akses.pakaiKuota(USER).terpakai, 1);
  assert.equal(akses.pakaiKuota(USER).terpakai, 2);
});

test('kuota habis setelah dipakai sesuai batas', () => {
  beriLangganan(USER, 'standar');
  akses.pakaiKuota(USER);
  const k = akses.keadaanKuota(USER);
  assert.equal(k.sisa, 0);
  assert.equal(k.bolehBuat, false);
});

test('profesional: 5 token, keenam ditolak', () => {
  beriLangganan(USER, 'profesional');
  for (let i = 0; i < 5; i++) akses.pakaiKuota(USER);
  const k = akses.keadaanKuota(USER);
  assert.equal(k.terpakai, 5);
  assert.equal(k.bolehBuat, false);
});

test('enterprise: tanpa batas, terpakai berapa pun tetap boleh', () => {
  beriLangganan(USER, 'enterprise');
  for (let i = 0; i < 30; i++) akses.pakaiKuota(USER);
  const k = akses.keadaanKuota(USER);
  assert.equal(k.tanpaBatas, true);
  assert.equal(k.bolehBuat, true);
});

test('kuota terpisah per bulan', () => {
  beriLangganan(USER, 'standar');
  akses.pakaiKuota(USER);

  // Sisipkan pemakaian bulan lain secara manual
  getDb().prepare('INSERT INTO kuota_token (id, user_id, bulan, terpakai, updated_at) VALUES (?,?,?,?,?)')
    .run('k-lalu', USER, '2020-01', 99, Date.now());

  assert.equal(akses.terpakaiBulanIni(USER), 1, 'bulan ini tetap 1');
  assert.equal(akses.terpakaiBulanIni(USER, '2020-01'), 99, 'bulan lain terpisah');
});

test('kuota terpisah per pengguna', () => {
  beriLangganan(USER, 'standar');
  beriLangganan(USER2, 'standar');
  akses.pakaiKuota(USER);
  assert.equal(akses.terpakaiBulanIni(USER), 1);
  assert.equal(akses.terpakaiBulanIni(USER2), 0);
});

// ── 4. AKSES METRIK ──────────────────────────────────────────────────────────

test('metrik: gratis tanpa star ditolak', () => {
  const r = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  assert.equal(r.boleh, false);
  assert.equal(r.alasan, 'perlu-star');
  assert.equal(akses.trialPengguna(USER), null, 'jatah tidak boleh terpakai saat ditolak');
});

test('metrik: gratis + star boleh, dan jatahnya TERCATAT otomatis', () => {
  const r = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  assert.equal(r.boleh, true);
  assert.equal(r.pakaiTrial, true);
  assert.ok(akses.trialPengguna(USER), 'pemakaian harus tercatat oleh fungsi ini');
  assert.equal(akses.trialPengguna(USER).project_slug, 'mina');
});

test('metrik: proyek SAMA boleh dibuka ulang', () => {
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  const lagi = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  assert.equal(lagi.boleh, true, 'refresh tidak boleh menghilangkan akses');
  assert.equal(lagi.pakaiTrial, false, 'jangan pakai jatah dua kali');
});

test('metrik: proyek LAIN terkunci — jatah per akun', () => {
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  const lain = akses.periksaAksesMetrik(USER, 'spareparts', { sudahStar: true });
  assert.equal(lain.boleh, false, 'jatahnya satu untuk semua proyek');
  assert.equal(lain.alasan, 'trial-habis-proyek-lain');
});

test('metrik: jatah tidak terpakai saat akses DITOLAK', () => {
  // Kalau pemakaian dicatat walau ditolak, pengguna kehilangan jatahnya
  // tanpa pernah melihat apa pun.
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  assert.equal(akses.trialPengguna(USER), null);
});

test('metrik: pelanggan berbayar tidak menyentuh jatah trial', () => {
  beriLangganan(USER, 'standar');
  const r = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  assert.equal(r.boleh, true);
  assert.equal(r.alasan, 'langganan');
  assert.equal(akses.trialPengguna(USER), null, 'langganan tidak memakai jatah trial');
});

// ── 5. DAFTAR PROYEK ─────────────────────────────────────────────────────────

const PROYEK = [
  { slug: 'mina', name: 'MINA', summary: 's', subtitle: 't', stack: ['Python'], metrics: [{ label: 'tes', value: '231' }] },
  { slug: 'spareparts', name: 'Spareparts', summary: 's', subtitle: 't', stack: ['FastAPI'], metrics: [] },
];

test('daftar: gratis tanpa star — semua terkunci, METRIK TIDAK DIKIRIM', () => {
  const d = akses.daftarProyekDenganAkses(USER, PROYEK);
  assert.equal(d.length, 2);
  for (const p of d) {
    assert.equal(p.status, 'terkunci-perlu-star');
    assert.equal(p.metrik, null, 'data metrik tidak boleh ikut dikirim saat terkunci');
  }
});

test('daftar: berbayar — semua terbuka, metrik ikut', () => {
  beriLangganan(USER, 'standar');
  const d = akses.daftarProyekDenganAkses(USER, PROYEK);
  for (const p of d) {
    assert.equal(p.status, 'terbuka');
    assert.ok(p.metrik !== null, 'metrik harus ikut saat terbuka');
  }
});

test('daftar: trial terpakai — proyek itu terbuka, sisanya terkunci', () => {
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  const d = akses.daftarProyekDenganAkses(USER, PROYEK);
  const mina = d.find((p) => p.slug === 'mina');
  const sp = d.find((p) => p.slug === 'spareparts');
  assert.equal(mina.status, 'trial-terpakai');
  assert.ok(mina.metrik !== null);
  assert.equal(sp.status, 'terkunci-jatah-habis');
  assert.equal(sp.metrik, null, 'proyek lain tidak boleh bocor metriknya');
});

// ── 6. RINGKASAN AKUN ────────────────────────────────────────────────────────

test('ringkasan: bentuknya lengkap untuk UI', () => {
  beriLangganan(USER, 'profesional');
  const r = akses.ringkasanAkun(USER);
  assert.equal(r.paket, 'profesional');
  assert.equal(r.berbayar, true);
  assert.equal(r.kuota.total, 5);
  assert.equal(r.bonusStar, false);
  assert.equal(r.trial, null);
});

test('ringkasan: pengguna gratis menyertakan status bonus & trial', () => {
  akses.catatBonusStar(USER, { paket: 'gratis' });
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  const r = akses.ringkasanAkun(USER);
  assert.equal(r.paket, 'gratis');
  assert.equal(r.berbayar, false);
  assert.equal(r.bonusStar, true);
  assert.equal(r.trial.proyek, 'mina');
});
