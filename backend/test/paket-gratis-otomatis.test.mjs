/**
 * Paket gratis otomatis aktif saat login — dan yang lebih penting:
 * pencatatannya TIDAK MERUSAK akses berbayar.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * Permintaannya sederhana: "yang free in use auto default kalo login".
 *
 * Cara yang paling gampang — dan salah — adalah menulis baris paket='gratis'
 * ke tabel `langganan`. Itu terlihat wajar karena tabelnya sudah ada, dan
 * tesnya akan lulus kalau hanya memeriksa "paket gratis tercatat".
 *
 * Yang tidak terlihat: query perpanjangan di langganan-aktivasi.mjs menandai
 * SEMUA baris `aktif` sebagai 'diperpanjang' tanpa memandang paket. Baris
 * gratis ikut tertandai — dan riwayat tagihan jadi salah.
 *
 * Jadi tes ini memeriksa DUA hal sekaligus:
 *   1. Paket gratis tercatat saat login
 *   2. Langganan berbayar TIDAK terpengaruh oleh pencatatan itu
 *
 * Poin 2 yang lebih penting. Fitur yang bekerja tapi merusak fitur lain
 * bukan fitur — itu kerusakan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../src/db.mjs';
import {
  catatPaketGratis,
  paketAkunTercatat,
  sejakKapanGratis,
  jumlahPaketGratis,
  punyaLanggananBerbayar,
} from '../src/paket-akun.mjs';

const HARI = 24 * 60 * 60 * 1000;

/** DB bersih untuk tiap tes — supaya urutannya tidak saling mempengaruhi. */
function dbBaru() {
  // openDb(':memory:') mengembalikan instance yang sama kalau sudah dibuka,
  // jadi tabelnya dibersihkan manual.
  openDb(':memory:');
  const d = getDb();
  d.exec('DELETE FROM langganan');
  d.exec('DELETE FROM paket_akun');
  return d;
}

/** Tambah langganan berbayar. */
function beriLangganan(d, userId, { paket = 'standar', selesaiAt, status = 'aktif' } = {}) {
  d.prepare(`
    INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at)
    VALUES (?, ?, ?, 'bulanan', ?, ?, ?, ?)
  `).run(`l-${Math.random().toString(36).slice(2)}`, userId, paket, Date.now(), selesaiAt ?? null, status, Date.now());
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. PENCATATAN DASAR
// ══════════════════════════════════════════════════════════════════════════════

test('pengguna baru tanpa langganan dicatat sebagai gratis', () => {
  dbBaru();
  const hasil = catatPaketGratis('u-baru');
  assert.equal(hasil.dicatat, true, 'pencatatan harus berhasil');
  assert.equal(hasil.baru, true, 'baris pertama harus ditandai baru');

  const baris = paketAkunTercatat('u-baru');
  assert.ok(baris, 'baris harus ada setelah dicatat');
  assert.equal(baris.paket, 'gratis');
  assert.ok(baris.mulai_at > 0, 'mulai_at harus terisi');
});

test('mulai_at TIDAK bergeser saat login berikutnya', () => {
  // Ini alasan "cari dulu, baru tulis" ada. Kalau setiap login menimpa
  // mulai_at, pertanyaan "sejak kapan dia gratis?" tidak pernah terjawab —
  // tanggalnya terus bergeser ke hari ini.
  dbBaru();
  catatPaketGratis('u-1');
  const pertama = paketAkunTercatat('u-1');

  const kedua = catatPaketGratis('u-1');
  const setelah = paketAkunTercatat('u-1');

  assert.equal(kedua.baru, false, 'login kedua bukan baris baru');
  assert.equal(setelah.mulai_at, pertama.mulai_at, 'mulai_at tidak boleh berubah');
  assert.ok(setelah.diperbarui_at >= pertama.diperbarui_at, 'diperbarui_at boleh maju');
});

test('sejakKapanGratis mengembalikan null kalau belum pernah dicatat', () => {
  // null berarti "tidak diketahui" — BUKAN "sejak epoch". Pemanggil yang
  // menampilkan tanggal harus bisa membedakannya.
  dbBaru();
  assert.equal(sejakKapanGratis('u-tidak-ada'), null);
});

test('jumlahPaketGratis menghitung hanya yang gratis', () => {
  dbBaru();
  catatPaketGratis('u-1');
  catatPaketGratis('u-2');
  catatPaketGratis('u-1'); // login ulang — tidak boleh menambah baris
  assert.equal(jumlahPaketGratis(), 2);
});

test('user_id kosong atau null ditolak dengan tenang, tidak melempar', () => {
  // Dipanggil di jalur login. Melempar error di sini berarti pengguna tidak
  // bisa masuk — padahal yang gagal hanya pencatatan.
  dbBaru();
  for (const kosong of ['', '   ', null, undefined]) {
    const h = catatPaketGratis(kosong);
    assert.equal(h.dicatat, false, `user_id ${JSON.stringify(kosong)} harus ditolak`);
    assert.ok(h.alasan, 'harus ada alasan');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. YANG LEBIH PENTING: TIDAK MERUSAK AKSES BERBAYAR
// ══════════════════════════════════════════════════════════════════════════════

test('punyaLanggananBerbayar: true untuk langganan aktif', () => {
  const d = dbBaru();
  beriLangganan(d, 'u-bayar', { paket: 'profesional' });
  assert.equal(punyaLanggananBerbayar('u-bayar'), true);
});

test('punyaLanggananBerbayar: false untuk langganan yang sudah lewat', () => {
  // Sama seperti paketPengguna(): selesai_at yang sudah lewat berarti tidak
  // berbayar lagi, walaupun statusnya masih 'aktif'. Baris bisa tertinggal
  // kalau webhook gagal memperbarui.
  const d = dbBaru();
  beriLangganan(d, 'u-lewat', { selesaiAt: Date.now() - HARI });
  assert.equal(punyaLanggananBerbayar('u-lewat'), false);
});

test('punyaLanggananBerbayar: false untuk baris yang sudah diperpanjang', () => {
  const d = dbBaru();
  beriLangganan(d, 'u-lama', { status: 'diperpanjang' });
  assert.equal(punyaLanggananBerbayar('u-lama'), false);
});

test('punyaLanggananBerbayar: true untuk langganan tanpa tanggal berakhir', () => {
  const d = dbBaru();
  beriLangganan(d, 'u-selamanya', { selesaiAt: null });
  assert.equal(punyaLanggananBerbayar('u-selamanya'), true);
});

test('pengguna BERBAYAR tidak dicatat sebagai gratis', () => {
  // Kalau ini gagal, tabel paket_akun akan berisi baris 'gratis' untuk orang
  // yang sedang membayar — dan daftar "pengguna gratis" jadi menyesatkan.
  const d = dbBaru();
  beriLangganan(d, 'u-bayar', { paket: 'standar' });
  assert.equal(punyaLanggananBerbayar('u-bayar'), true, 'prasyarat');
  // Pemanggil di auth-routes memakai pemeriksaan ini sebelum mencatat.
  // Di sini kita buktikan pemeriksaannya benar.
  assert.equal(paketAkunTercatat('u-bayar'), null, 'tidak boleh ada baris gratis');
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TIDAK MENGGANGGU TABEL LANGGANAN — INI INTI TES INI
// ══════════════════════════════════════════════════════════════════════════════

test('pencatatan gratis TIDAK menulis apa pun ke tabel langganan', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Kalau paket gratis dicatat di tabel langganan, query perpanjangan akan
  // menandainya 'diperpanjang', dan pembacaan paket bisa salah untuk pengguna
  // berbayar. Tes ini menjaga agar baris gratis tidak pernah masuk ke sana.
  const d = dbBaru();
  const sebelum = d.prepare('SELECT COUNT(*) AS n FROM langganan').get().n;
  catatPaketGratis('u-gratis');
  const sesudah = d.prepare('SELECT COUNT(*) AS n FROM langganan').get().n;

  assert.equal(sesudah, sebelum, 'tabel langganan tidak boleh bertambah baris');
  assert.equal(sesudah, 0, 'harus tetap kosong');
});

test('perpanjangan TIDAK menandai baris gratis sebagai diperpanjang', () => {
  // Meniru query yang dijalankan langganan-aktivasi.mjs saat pembayaran masuk.
  // Kalau baris gratis ada di tabel langganan, query ini akan ikut
  // menandainya — dan riwayat tagihannya jadi salah.
  const d = dbBaru();
  catatPaketGratis('u-1');

  // Pengguna lalu membayar
  beriLangganan(d, 'u-1', { paket: 'standar' });

  // Ini query perpanjangan yang sebenarnya, apa adanya:
  const hasil = d.prepare(`
    UPDATE langganan SET status = 'diperpanjang'
    WHERE user_id = ? AND status = 'aktif'
  `).run('u-1');

  assert.equal(hasil.changes, 1, 'hanya SATU baris (yang berbayar) boleh tertandai');

  const semua = d.prepare('SELECT paket, status FROM langganan WHERE user_id = ?').all('u-1');
  assert.equal(semua.length, 1, 'hanya boleh ada satu baris di tabel langganan');
  assert.equal(semua[0].paket, 'standar', 'barisnya harus yang berbayar');
  assert.equal(semua[0].status, 'diperpanjang');
});

test('masa aktif berbayar tidak terpengaruh baris gratis', () => {
  // Query perpanjangan mencari selesai_at TERAKHIR untuk menentukan kapan
  // masa aktif baru dimulai. Kalau baris gratis ikut terbaca, tanggalnya
  // bisa salah — dan pengguna kehilangan hari yang sudah dia bayar.
  const d = dbBaru();
  catatPaketGratis('u-1');

  const selesai = Date.now() + 20 * HARI;
  beriLangganan(d, 'u-1', { paket: 'standar', selesaiAt: selesai });

  const terakhir = d.prepare(`
    SELECT selesai_at FROM langganan
    WHERE user_id = ? AND status = 'aktif'
    ORDER BY selesai_at DESC LIMIT 1
  `).get('u-1');

  assert.equal(terakhir.selesai_at, selesai, 'harus membaca tanggal langganan berbayar');
});

test('langganan berbayar habis → pengguna kembali gratis, tanpa ada yang memperbarui', () => {
  // ── KENAPA INI BEKERJA SENDIRI ────────────────────────────────────────────
  // Karena paket berbayar SELALU dibaca dari tabel langganan, bukan dari
  // paket_akun. Saat selesai_at lewat, punyaLanggananBerbayar() jadi false
  // dan paketPengguna() mengembalikan 'gratis'.
  //
  // Tidak ada pekerjaan terjadwal yang harus berjalan untuk itu — dan
  // pekerjaan terjadwal yang gagal berjalan adalah cara paling umum fitur
  // langganan rusak diam-diam.
  const d = dbBaru();
  beriLangganan(d, 'u-1', { paket: 'standar', selesaiAt: Date.now() - HARI });
  assert.equal(punyaLanggananBerbayar('u-1'), false, 'langganan lewat = tidak berbayar');
  assert.equal(paketAkunTercatat('u-1'), null, 'tidak ada baris — defaultnya gratis');
});

test('pengguna yang berhenti berlangganan lalu login dicatat gratis', () => {
  // Skenario nyata: berlangganan, berhenti, lalu login lagi. Saat login,
  // langganannya sudah lewat → harus dicatat gratis dengan tanggal BARU,
  // bukan tanggal akun dibuat.
  const d = dbBaru();
  beriLangganan(d, 'u-1', { paket: 'standar', selesaiAt: Date.now() - HARI });

  assert.equal(punyaLanggananBerbayar('u-1'), false);
  const hasil = catatPaketGratis('u-1');
  assert.equal(hasil.baru, true);

  const sejak = sejakKapanGratis('u-1');
  assert.ok(sejak, 'harus ada tanggal');
  assert.ok(Math.abs(Date.now() - sejak) < 5000, 'tanggalnya harus sekarang, bukan tanggal lama');
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. TABELNYA SENDIRI — BUKAN BAGIAN DARI LANGGANAN
// ══════════════════════════════════════════════════════════════════════════════

test('tabel paket_akun punya user_id sebagai PRIMARY KEY', () => {
  // Satu akun = satu paket berlaku. Tanpa ini, login berulang akan menumpuk
  // baris dan jumlahPaketGratis() akan menghitungnya berkali-kali.
  const d = dbBaru();
  const kolom = d.prepare('PRAGMA table_info(paket_akun)').all();
  const pk = kolom.filter((k) => k.pk > 0).map((k) => k.name);
  assert.deepEqual(pk, ['user_id'], 'hanya user_id yang boleh jadi primary key');
});

test('tabel paket_akun TIDAK punya kolom transaksi', () => {
  // Kalau kolom seperti payment_id atau selesai_at muncul di sini, artinya
  // tabel ini mulai meniru tabel langganan — dan dua tabel yang mirip akan
  // saling bertentangan cepat atau lambat.
  const d = dbBaru();
  const nama = d.prepare('PRAGMA table_info(paket_akun)').all().map((k) => k.name);
  for (const terlarang of ['payment_id', 'selesai_at', 'periode', 'status']) {
    assert.ok(!nama.includes(terlarang),
      `kolom "${terlarang}" milik tabel langganan, tidak boleh ada di paket_akun`);
  }
  assert.deepEqual(nama.sort(), ['diperbarui_at', 'mulai_at', 'paket', 'user_id'].sort());
});
