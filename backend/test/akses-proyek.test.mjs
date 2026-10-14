/**
 * Tes modul akses proyek — dengan DATABASE SUNGGUHAN.
 *
 * ── KENAPA DATABASE SUNGGUHAN, BUKAN MOCK ──────────────────────────────────
 * Modul ini bergantung pada batasan database yang tidak bisa ditiru mock:
 *
 *   UNIQUE(user_id)                 di bonus_star
 *   UNIQUE(user_id, project_slug)   di metrik_terbuka
 *   UNIQUE(user_id, bulan)          di kuota_token
 *
 * Mock yang "selalu menerima INSERT" akan meloloskan tes yang seharusnya
 * gagal — dan kegagalan yang lolos itu adalah orang mengklaim bonus dua kali,
 * atau memakai satu jatah metrik berkali-kali.
 *
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
  // ── `metrik_terbuka` HARUS ADA DI DAFTAR INI ─────────────────────────────
  // Versi pertama masih menghapus `trial_metrik` — tabel LAMA yang sudah tidak
  // dipakai. Akibatnya data antar tes menumpuk: tes "buka proyek yang sama 3x"
  // menemukan 5 baris, bukan 1, dan gagal karena alasan yang tidak ada
  // hubungannya dengan yang diuji.
  //
  // `trial_metrik` tetap dibersihkan supaya migrasi tidak membawa sisa data
  // dari tes sebelumnya.
  for (const t of ['langganan', 'kuota_token', 'bonus_star', 'metrik_terbuka', 'trial_metrik', 'star_cache']) {
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

// ── 4. AKSES METRIK — ATURAN BARU: 3 DARI LOGIN + 2 DARI STAR ────────────────
//
// ── PERUBAHAN ATURAN ─────────────────────────────────────────────────────────
// Aturan LAMA: satu proyek per akun, dan WAJIB star dulu.
// Aturan BARU: lima proyek — tiga langsung dari login, dua lagi dari star.
//
// Tes di bawah menguji aturan baru. Yang lama diganti, bukan ditambal, supaya
// tidak ada tes yang lulus karena kebetulan.

const PROYEK_5 = [
  'mina', 'spareparts', 'p1', 'p2', 'p3', 'p4',
];

test('metrik: login langsung memberi 3 proyek TANPA star', () => {
  // Ini inti perubahan aturannya: pengguna baru bisa menilai kualitas data
  // sebelum diminta memberi star.
  for (let i = 0; i < 3; i++) {
    const r = akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: false });
    assert.equal(r.boleh, true, `proyek ke-${i + 1} harus boleh tanpa star`);
    assert.equal(r.pakaiJatah, true);
    assert.equal(r.sumber, 'login', `proyek ke-${i + 1} harus memakai jatah login`);
  }
  assert.equal(akses.jumlahMetrikTerbuka(USER), 3, 'tiga proyek tercatat');
});

test('metrik: proyek ke-4 DITOLAK kalau belum star, dengan alasan yang memberi jalan keluar', () => {
  for (let i = 0; i < 3; i++) akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: false });

  const r = akses.periksaAksesMetrik(USER, PROYEK_5[3], { sudahStar: false });
  assert.equal(r.boleh, false, 'jatah login sudah habis');
  assert.equal(r.alasan, 'jatah-habis-bisa-star',
    'alasannya harus menyebut star sebagai jalan keluar — bukan langsung menyuruh berlangganan');
  assert.equal(akses.jumlahMetrikTerbuka(USER), 3, 'yang ditolak tidak boleh menambah catatan');
});

test('metrik: star menambah 2 proyek lagi (total 5)', () => {
  for (let i = 0; i < 3; i++) akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: false });

  // Klaim star, lalu dua proyek berikutnya boleh
  for (let i = 3; i < 5; i++) {
    const r = akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: true });
    assert.equal(r.boleh, true, `proyek ke-${i + 1} harus boleh setelah star`);
    assert.equal(r.sumber, 'star', `proyek ke-${i + 1} harus memakai jatah star`);
  }
  assert.equal(akses.jumlahMetrikTerbuka(USER), 5, 'lima proyek tercatat');
});

test('metrik: proyek ke-6 ditolak walau sudah star', () => {
  for (let i = 0; i < 3; i++) akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: false });
  for (let i = 3; i < 5; i++) akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: true });

  const r = akses.periksaAksesMetrik(USER, PROYEK_5[5], { sudahStar: true });
  assert.equal(r.boleh, false);
  assert.equal(r.alasan, 'jatah-habis',
    'sudah star, jadi tidak ada jalan gratis lagi — jangan sebut star lagi');
});

test('metrik: proyek yang SUDAH terbuka boleh dibuka ulang tanpa makan jatah', () => {
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  const lagi = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });

  assert.equal(lagi.boleh, true, 'refresh tidak boleh menghilangkan akses');
  assert.equal(lagi.pakaiJatah, false, 'jangan pakai jatah dua kali');
  assert.equal(lagi.alasan, 'sudah-terbuka');
  assert.equal(akses.jumlahMetrikTerbuka(USER), 1, 'tetap satu baris, tidak menumpuk');
});

test('metrik: membuka proyek yang sama 3x tetap hanya 1 jatah terpakai', () => {
  for (let i = 0; i < 3; i++) akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  assert.equal(akses.jumlahMetrikTerbuka(USER), 1);
});

test('metrik: jatah tidak terpakai saat akses DITOLAK', () => {
  // Kalau pemakaian dicatat walau ditolak, pengguna kehilangan jatahnya
  // tanpa pernah melihat apa pun.
  for (let i = 0; i < 3; i++) akses.periksaAksesMetrik(USER, PROYEK_5[i], { sudahStar: false });
  const sebelum = akses.jumlahMetrikTerbuka(USER);

  akses.periksaAksesMetrik(USER, PROYEK_5[3], { sudahStar: false });
  assert.equal(akses.jumlahMetrikTerbuka(USER), sebelum, 'yang ditolak tidak menambah catatan');
});

test('metrik: pelanggan berbayar selalu boleh dan tidak menyentuh jatah gratis', () => {
  beriLangganan(USER, 'standar');
  const r = akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });

  assert.equal(r.boleh, true);
  assert.equal(r.alasan, 'langganan');
  assert.equal(r.pakaiJatah, false);
  assert.equal(akses.jumlahMetrikTerbuka(USER), 0, 'langganan tidak memakai jatah gratis');
});

test('keadaanMetrik: angka untuk UI benar', () => {
  // Belum buka apa pun, belum star → 3 tersedia
  let k = akses.keadaanMetrik(USER);
  assert.equal(k.total, 3, 'tanpa star, totalnya 3');
  assert.equal(k.terpakai, 0);
  assert.equal(k.sisa, 3);
  assert.equal(k.bonusStarTersedia, 2, 'star masih bisa menambah 2');

  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  k = akses.keadaanMetrik(USER);
  assert.equal(k.sisa, 2, 'sisa berkurang satu');
  assert.equal(k.terpakai, 1);

  // ── KENAPA keadaanMetrik MEMBACA STAR DARI DATABASE ────────────────────────
  // Argumen `sudahStar` hanya dipakai periksaAksesMetrik untuk MEMUTUSKAN.
  // keadaanMetrik menghitung dari database — supaya angkanya tidak bisa
  // berbeda dari keadaan sebenarnya.
  //
  // Di tes ini belum ada baris di bonus_star, jadi totalnya masih 3.
  assert.equal(k.total, 3, 'belum klaim star, jadi totalnya 3');

  // Klaim star lewat tabel, lalu totalnya harus jadi 5
  getDb().prepare(`
    INSERT INTO bonus_star (id, user_id, paket_saat_itu, sumber, github_user, diberikan_at, catatan)
    VALUES (?, ?, 'gratis', 'github', 'ujites', ?, '')
  `).run('bs-uji', USER, Date.now());

  const k2 = akses.keadaanMetrik(USER);
  assert.equal(k2.total, 5, 'setelah klaim star, totalnya 5');
  assert.equal(k2.sisa, 4, 'satu sudah terpakai, jadi sisa 4');
  assert.equal(k2.sudahStar, true);
  assert.equal(k2.bonusStarTersedia, 0, 'star sudah diklaim, tidak ada lagi');
});

// ── 5. DAFTAR PROYEK ─────────────────────────────────────────────────────────

const PROYEK = [
  { slug: 'mina', name: 'MINA', summary: 's', subtitle: 't', stack: ['Python'], metrics: [{ label: 'tes', value: '231' }] },
  { slug: 'spareparts', name: 'Spareparts', summary: 's', subtitle: 't', stack: ['FastAPI'], metrics: [] },
];

test('daftar: gratis tanpa star — statusnya BISA DIBUKA, bukan terkunci', () => {
  // ── PERUBAHAN ATURAN ──────────────────────────────────────────────────────
  // Aturan lama: pengguna gratis tanpa star melihat SEMUA proyek terkunci.
  // Aturan baru: tiga proyek pertama bisa langsung dibuka.
  //
  // Statusnya 'terkunci-bisa-buka', bukan 'terkunci-perlu-star' — dan bedanya
  // penting bagi UI: yang pertama menampilkan tombol "Buka", yang kedua
  // menampilkan ajakan memberi star.
  const d = akses.daftarProyekDenganAkses(USER, PROYEK);
  assert.equal(d.length, 2);
  for (const p of d) {
    assert.equal(p.status, 'terkunci-bisa-buka', 'masih ada jatah login, jadi bisa dibuka');
    assert.equal(p.metrik, null, 'data metrik tetap tidak dikirim sebelum benar-benar dibuka');
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

test('daftar: proyek yang sudah dibuka ditandai, sisanya masih bisa dibuka', () => {
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: false });
  const d = akses.daftarProyekDenganAkses(USER, PROYEK);

  const mina = d.find((p) => p.slug === 'mina');
  const sp = d.find((p) => p.slug === 'spareparts');

  assert.equal(mina.status, 'sudah-dibuka', 'proyek yang sudah dibuka ditandai');
  assert.ok(mina.metrik !== null, 'metrik proyek yang sudah dibuka harus ikut');
  assert.equal(sp.status, 'terkunci-bisa-buka', 'masih ada jatah, jadi bisa dibuka');
  assert.equal(sp.metrik, null, 'proyek yang belum dibuka tidak boleh bocor metriknya');
});

test('daftar: jatah habis dan belum star — ajakan memberi star', () => {
  // Tiga proyek dihabiskan, lalu periksa proyek keempat
  const banyak = [...PROYEK, { slug: 'p3', name: 'P3', summary: 's', stack: [] }];
  for (const s of ['mina', 'spareparts', 'p3']) {
    akses.periksaAksesMetrik(USER, s, { sudahStar: false });
  }

  const d = akses.daftarProyekDenganAkses(USER, banyak);
  const p3 = d.find((p) => p.slug === 'p3');
  assert.equal(p3.status, 'sudah-dibuka');
  // Tambah proyek keempat untuk memeriksa statusnya
  const lebih = [...banyak, { slug: 'p4', name: 'P4', summary: 's', stack: [] }];
  const d2 = akses.daftarProyekDenganAkses(USER, lebih);
  assert.equal(d2.find((p) => p.slug === 'p4').status, 'terkunci-perlu-star',
    'jatah login habis, belum star → ajakan star');
});

test('daftar: jatah habis dan SUDAH star — ajakan berlangganan', () => {
  akses.catatBonusStar(USER, { paket: 'gratis' });
  for (const s of ['mina', 'spareparts', 'p1', 'p2', 'p3']) {
    akses.periksaAksesMetrik(USER, s, { sudahStar: true });
  }
  assert.equal(akses.jumlahMetrikTerbuka(USER), 5, 'prasyarat: lima sudah terpakai');

  const lebih = [...PROYEK, { slug: 'p6', name: 'P6', summary: 's', stack: [] }];
  const d = akses.daftarProyekDenganAkses(USER, lebih);
  assert.equal(d.find((p) => p.slug === 'p6').status, 'terkunci-jatah-habis',
    'sudah star, jatah habis → tidak ada jalan gratis lagi');
});

// ── 6. RINGKASAN AKUN ────────────────────────────────────────────────────────

test('ringkasan: bentuknya lengkap untuk UI', () => {
  beriLangganan(USER, 'profesional');
  const r = akses.ringkasanAkun(USER);
  assert.equal(r.paket, 'profesional');
  assert.equal(r.berbayar, true);
  assert.equal(r.kuota.total, 5);
  assert.equal(r.bonusStar, false);
  // ── `metrik` MENGGANTIKAN `trial` ─────────────────────────────────────────
  // Aturan lama menyimpan satu baris trial. Aturan baru menyimpan daftar
  // proyek yang terbuka, plus angka jatahnya.
  assert.ok(r.metrik, 'ringkasan harus menyertakan keadaan metrik');
  assert.equal(r.metrik.berbayar, true);
  assert.equal(r.metrik.total, null, 'paket berbayar tidak punya batas');
  assert.equal(r.metrik.sisa, null);
  assert.deepEqual(r.metrik.proyek, []);
});

test('ringkasan: pengguna gratis menyertakan jatah metrik & bonus star', () => {
  akses.catatBonusStar(USER, { paket: 'gratis' });
  akses.periksaAksesMetrik(USER, 'mina', { sudahStar: true });
  const r = akses.ringkasanAkun(USER);

  assert.equal(r.paket, 'gratis');
  assert.equal(r.berbayar, false);
  assert.equal(r.bonusStar, true);

  // ── BENTUK BARUNYA: ANGKA + DAFTAR PROYEK ─────────────────────────────────
  // Aturan lama hanya menyimpan satu baris trial, jadi cukup `r.trial.proyek`.
  // Aturan baru menyimpan sampai lima proyek, jadi yang dikirim adalah angka
  // jatah DAN daftar proyeknya.
  assert.equal(r.metrik.total, 5, 'sudah star, jadi totalnya 5');
  assert.equal(r.metrik.terpakai, 1);
  assert.equal(r.metrik.sisa, 4);
  assert.equal(r.metrik.sudahStar, true);
  assert.deepEqual(r.metrik.proyek, ['mina'], 'daftar proyek yang sudah terbuka');
});
