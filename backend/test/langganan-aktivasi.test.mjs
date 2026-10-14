/**
 * Tes aktivasi langganan dari pembayaran.
 *
 * ── KENAPA TES INI PENTING ──────────────────────────────────────────────────
 * Ini jalur yang mengubah UANG menjadi AKSES. Kesalahan di sini bukan bug
 * tampilan:
 *
 *   · Gagal mengaktifkan → pembeli sudah bayar, aksesnya tidak ada
 *   · Aktif dua kali     → satu pembayaran memberi 2× masa aktif
 *   · Menimpa perpanjangan → pembeli kehilangan hari yang sudah dibayar
 *
 * Semua diuji dengan DATABASE SUNGGUHAN, karena idempotensinya dijaga
 * UNIQUE di database — bukan hanya oleh pemeriksaan kode.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, getDb, now } from '../src/db.mjs';
import { siapkanTabelPengguna } from '../src/users.mjs';

openDb(':memory:');
siapkanTabelPengguna();

const { aktifkanLangganan, langgananPengguna } = await import('../src/langganan-aktivasi.mjs');

const HARI = 24 * 60 * 60 * 1000;

function bersihkan() {
  const db = getDb();
  for (const t of ['langganan', 'payments']) db.exec(`DELETE FROM ${t}`);
  db.exec('DELETE FROM users');
}

/** Buat pengguna uji dengan email tertentu. */
function buatPengguna(email = 'pembeli@contoh.id') {
  const id = 'u-' + Math.random().toString(36).slice(2, 10);
  getDb().prepare(`
    INSERT INTO users (id, email, nama, password_hash, token_id, status, dibuat_at)
    VALUES (?, ?, ?, 'x', ?, 'aktif', ?)
  `).run(id, email, 'Pembeli Uji', 't-' + id, now());
  return id;
}

beforeEach(bersihkan);
after(() => closeDb());

// ── 1. JALUR BAHAGIA ─────────────────────────────────────────────────────────

test('pembayaran berhasil → langganan aktif', () => {
  buatPengguna();
  const h = aktifkanLangganan({
    paymentId: 'pay-1', email: 'pembeli@contoh.id', paket: 'standar', periode: 'bulanan',
  });

  assert.equal(h.aktif, true);
  assert.equal(h.langganan.paket, 'standar');
  assert.equal(h.diperpanjang, false, 'langganan baru, bukan perpanjangan');
  assert.ok(h.langganan.selesai_at > now());
});

test('bulanan = 35 hari (30 + 5 tenggang), tahunan = 370 hari', () => {
  const id = buatPengguna();
  const h = aktifkanLangganan({
    paymentId: 'p-b', email: 'pembeli@contoh.id', paket: 'standar', periode: 'bulanan',
  });
  const hari = Math.round((h.langganan.selesai_at - h.langganan.mulai_at) / HARI);
  assert.equal(hari, 35, 'bulanan harus 35 hari');

  const h2 = aktifkanLangganan({
    paymentId: 'p-t', email: 'pembeli@contoh.id', paket: 'profesional', periode: 'tahunan',
  });
  const hari2 = Math.round((h2.langganan.selesai_at - h2.langganan.mulai_at) / HARI);
  assert.equal(hari2, 370, 'tahunan harus 370 hari');
  assert.ok(id);
});

test('paket tersimpan apa adanya (standar/profesional/enterprise)', () => {
  buatPengguna();
  for (const paket of ['standar', 'profesional', 'enterprise']) {
    bersihkan();
    buatPengguna();
    const h = aktifkanLangganan({ paymentId: 'p-' + paket, email: 'pembeli@contoh.id', paket });
    assert.equal(h.aktif, true, `${paket} harus bisa diaktifkan`);
    assert.equal(h.langganan.paket, paket);
  }
});

// ── 2. PERPANJANGAN BERSAMBUNG ───────────────────────────────────────────────

test('perpanjangan BERSAMBUNG — hari yang tersisa tidak hilang', () => {
  // ── INI TES PALING PENTING DI BERKAS INI ─────────────────────────────────
  // Kalau masa aktif baru dihitung dari SEKARANG, pembeli yang memperpanjang
  // lebih awal kehilangan hari yang sudah dia bayar.
  buatPengguna();
  const pertama = aktifkanLangganan({
    paymentId: 'p-1', email: 'pembeli@contoh.id', paket: 'standar', periode: 'bulanan',
  });

  const kedua = aktifkanLangganan({
    paymentId: 'p-2', email: 'pembeli@contoh.id', paket: 'standar', periode: 'bulanan',
  });

  assert.equal(kedua.diperpanjang, true, 'harus dikenali sebagai perpanjangan');
  assert.equal(kedua.langganan.mulai_at, pertama.langganan.selesai_at,
    'masa aktif baru harus MULAI dari akhir masa aktif lama');

  const totalHari = Math.round((kedua.langganan.selesai_at - pertama.langganan.mulai_at) / HARI);
  assert.equal(totalHari, 70, 'dua pembayaran bulanan = 70 hari, bukan 35');
});

test('langganan yang sudah KEDALUWARSA mulai dari sekarang, bukan dari masa lalu', () => {
  const id = buatPengguna();

  // Langganan lama yang sudah habis 10 hari lalu
  getDb().prepare(`
    INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at)
    VALUES ('lama', ?, 'standar', 'bulanan', ?, ?, 'aktif', ?)
  `).run(id, now() - 40 * HARI, now() - 10 * HARI, now() - 40 * HARI);

  const h = aktifkanLangganan({
    paymentId: 'p-baru', email: 'pembeli@contoh.id', paket: 'standar', periode: 'bulanan',
  });

  assert.equal(h.diperpanjang, false, 'tidak dihitung perpanjangan');
  assert.ok(Math.abs(h.langganan.mulai_at - now()) < 2000,
    'mulai dari SEKARANG, bukan dari tanggal yang sudah lewat');
});

test('langganan lama ditandai "diperpanjang", bukan dihapus', () => {
  // Riwayat dibutuhkan saat ada sengketa tagihan.
  const id = buatPengguna();
  aktifkanLangganan({ paymentId: 'p-1', email: 'pembeli@contoh.id', paket: 'standar' });
  aktifkanLangganan({ paymentId: 'p-2', email: 'pembeli@contoh.id', paket: 'standar' });

  const semua = getDb().prepare('SELECT status FROM langganan WHERE user_id = ? ORDER BY dibuat_at').all(id);
  assert.equal(semua.length, 2, 'kedua baris harus tetap ada');
  assert.equal(semua[0].status, 'diperpanjang');
  assert.equal(semua[1].status, 'aktif');
});

// ── 3. IDEMPOTENSI ───────────────────────────────────────────────────────────

test('webhook yang sama dua kali TIDAK menambah masa aktif dua kali', () => {
  // Midtrans bisa mengirim ulang webhook yang sama. Kalau setiap kiriman
  // menambah masa aktif, satu pembayaran memberi 2× akses.
  buatPengguna();
  const a = aktifkanLangganan({ paymentId: 'p-sama', email: 'pembeli@contoh.id', paket: 'standar' });
  const b = aktifkanLangganan({ paymentId: 'p-sama', email: 'pembeli@contoh.id', paket: 'standar' });

  assert.equal(b.aktif, true, 'permintaan kedua tetap dianggap berhasil');
  assert.equal(b.diperpanjang, false);
  assert.equal(b.langganan.selesai_at, a.langganan.selesai_at, 'masa aktif TIDAK bertambah');

  const jumlah = getDb().prepare('SELECT COUNT(*) n FROM langganan').get().n;
  assert.equal(jumlah, 1, 'hanya boleh ada SATU baris langganan');
});

test('payment_id unik ditegakkan DATABASE, bukan hanya kode', () => {
  const id = buatPengguna();
  const db = getDb();
  const dasar = [id, 'standar', 'bulanan', now(), now() + 35 * HARI, now()];

  db.prepare(`INSERT INTO langganan (id,user_id,paket,periode,mulai_at,selesai_at,status,dibuat_at,payment_id)
    VALUES ('a',?,?,?,?,?,'aktif',?,'p-uniq')`).run(...dasar);

  assert.throws(() => {
    db.prepare(`INSERT INTO langganan (id,user_id,paket,periode,mulai_at,selesai_at,status,dibuat_at,payment_id)
      VALUES ('b',?,?,?,?,?,'aktif',?,'p-uniq')`).run(...dasar);
  }, /UNIQUE/i, 'database harus MENOLAK payment_id yang sama');
});

// ── 4. KEGAGALAN YANG HARUS TERLIHAT ─────────────────────────────────────────

test('email belum terdaftar → langganan TIDAK dibuat, dengan pesan jelas', () => {
  // Pembeli bisa membayar dengan email yang belum didaftarkan. Pembayarannya
  // SAH, tapi aksesnya tidak bisa dibuat otomatis — dan itu harus terlihat.
  const h = aktifkanLangganan({
    paymentId: 'p-x', email: 'belum-terdaftar@contoh.id', paket: 'standar',
  });

  assert.equal(h.aktif, false);
  assert.match(h.pesan, /tidak ada akun/i);
  assert.match(h.pesan, /belum-terdaftar@contoh\.id/, 'pesan harus menyebut emailnya');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM langganan').get().n, 0, 'tidak ada baris dibuat');
});

test('paket tidak dikenal ditolak', () => {
  buatPengguna();
  for (const paket of ['gratis', 'super-admin', '', null, undefined]) {
    const h = aktifkanLangganan({ paymentId: 'p-' + paket, email: 'pembeli@contoh.id', paket });
    assert.equal(h.aktif, false, `paket "${paket}" tidak boleh diaktifkan`);
  }
});

test('email dicocokkan tanpa peduli huruf besar/kecil', () => {
  // Midtrans bisa mengirim "Budi@Gmail.com" padahal yang didaftarkan
  // "budi@gmail.com". Tanpa normalisasi, pembeli tidak mendapat aksesnya.
  buatPengguna('Budi@Contoh.id');
  const h = aktifkanLangganan({
    paymentId: 'p-1', email: 'budi@contoh.id', paket: 'standar',
  });
  assert.equal(h.aktif, true, 'email harus dicocokkan tanpa peduli besar/kecil');
});

test('akun yang tidak aktif tidak mendapat langganan', () => {
  const id = buatPengguna();
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run('nonaktif', id);

  const h = aktifkanLangganan({ paymentId: 'p-1', email: 'pembeli@contoh.id', paket: 'standar' });
  assert.equal(h.aktif, false, 'akun nonaktif tidak boleh dapat langganan');
});

// ── 5. RINGKASAN UNTUK HALAMAN ───────────────────────────────────────────────

test('langgananPengguna: mengembalikan paket + sisa hari', () => {
  const id = buatPengguna();
  aktifkanLangganan({ paymentId: 'p-1', email: 'pembeli@contoh.id', paket: 'profesional', periode: 'bulanan' });

  const r = langgananPengguna(id);
  assert.equal(r.paket, 'profesional');
  assert.ok(r.sisaHari >= 34 && r.sisaHari <= 35, `sisa hari harus ~35, dapat ${r.sisaHari}`);
});

test('langgananPengguna: null kalau tidak ada langganan aktif', () => {
  const id = buatPengguna();
  assert.equal(langgananPengguna(id), null);

  // Langganan yang sudah lewat tidak dihitung
  getDb().prepare(`
    INSERT INTO langganan (id,user_id,paket,periode,mulai_at,selesai_at,status,dibuat_at)
    VALUES ('lama',?, 'standar','bulanan',?,?,'aktif',?)
  `).run(id, now() - 40 * HARI, now() - 10 * HARI, now() - 40 * HARI);

  assert.equal(langgananPengguna(id), null, 'langganan kedaluwarsa tidak dihitung aktif');
});

test('langgananPengguna: tanpa userId mengembalikan null, tanpa error', () => {
  for (const kosong of [null, undefined, '']) {
    assert.equal(langgananPengguna(kosong), null);
  }
});
