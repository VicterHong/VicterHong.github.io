/**
 * Tes antrean webhook persisten.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA DATABASE SUNGGUHAN, BUKAN MOCK
 * ══════════════════════════════════════════════════════════════════════════════
 * Antrean ini bergantung pada tiga hal yang TIDAK BISA ditiru mock:
 *
 *   1. `UNIQUE (sumber, id_peristiwa)` — menolak kiriman ulang
 *   2. `BEGIN IMMEDIATE` — mencegah dua pekerja mengambil pesan yang sama
 *   3. Transaksi yang commit — bertahan walau prosesnya mati
 *
 * Mock yang "selalu menerima INSERT" akan meloloskan tes yang seharusnya gagal,
 * dan yang lolos itu adalah pelanggan menerima efek webhook DUA KALI.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG DIUJI: PERILAKU SAAT GAGAL, BUKAN SAAT BERHASIL
 * ══════════════════════════════════════════════════════════════════════════════
 * Antrean yang bekerja saat semuanya lancar tidak membuktikan apa pun — itu
 * jalur yang paling mudah. Yang membuktikan: apa yang terjadi saat layanan
 * tujuan mati, saat webhook dikirim ulang, saat percobaan habis.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, getDb } from '../src/db.mjs';

openDb(':memory:');
const antrean = await import('../src/sentinel/antrean.mjs');

const SUMBER = 'stripe';
const URL = 'https://contoh.id/webhook-tujuan';

function bersihkan() {
  // Tabelnya dibuat DULU — kalau tidak, DELETE akan gagal dengan "no such table".
  antrean.siapkanTabelAntrean();
  getDb().exec('DELETE FROM sentinel_antrean');
}

function tambah(opsi = {}) {
  return antrean.masukAntrean({
    sumber: SUMBER,
    url: URL,
    body: JSON.stringify({ id: 'evt_1', jumlah: 5000 }),
    ...opsi,
  });
}

// Tabel dibuat sekali di awal, lalu dibersihkan sebelum setiap tes.
antrean.siapkanTabelAntrean();
beforeEach(bersihkan);
after(() => closeDb());

/* ══════════════════════════════════════════════════════════════════════════════
   1. MASUK ANTREAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('webhook masuk antrean dengan status menunggu', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  assert.equal(r.ok, true);
  assert.equal(r.duplikat, false);

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.status, 'menunggu');
  assert.equal(baris.percobaan, 0);
  assert.equal(baris.jadwal_berikut, 0, 'pesan baru harus langsung siap dikirim');
});

test('sumber atau url kosong → ditolak', () => {
  assert.equal(tambah({ sumber: '' }).ok, false);
  assert.equal(tambah({ url: '' }).ok, false);
});

test('body kosong tetap diterima — beberapa webhook memang tanpa body', () => {
  const r = antrean.masukAntrean({ sumber: SUMBER, url: URL, body: '' });
  assert.equal(r.ok, true);
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. KIRIMAN ULANG — provider MENGIRIM ULANG, dan itu normal
   ══════════════════════════════════════════════════════════════════════════════ */

test('SERANGAN/BUG: id_peristiwa sama → TIDAK masuk dua kali', () => {
  // ── INI PERLINDUNGAN PALING PENTING ───────────────────────────────────────
  // Provider webhook mengirim ulang kalau balasan kita lambat. Tanpa
  // perlindungan ini, pelanggan mendapat efeknya dua kali: dua email, dua
  // aktivasi langganan, dua pengiriman barang.
  const a = tambah({ idPeristiwa: 'evt_sama' });
  const b = tambah({ idPeristiwa: 'evt_sama' });

  assert.equal(a.duplikat, false);
  assert.equal(b.duplikat, true, 'kiriman ulang harus dikenali sebagai duplikat');
  assert.equal(b.id, a.id, 'harus menunjuk ke pesan yang SAMA');

  const jumlah = getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n;
  assert.equal(jumlah, 1, 'hanya boleh ada SATU baris');
});

test('id_peristiwa BEDA → masuk sebagai pesan terpisah', () => {
  tambah({ idPeristiwa: 'evt_1' });
  const b = tambah({ idPeristiwa: 'evt_2' });

  assert.equal(b.duplikat, false);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 2);
});

test('isi SAMA PERSIS dalam 1 jam → dikenali duplikat walau tanpa id_peristiwa', () => {
  // ── KENAPA PERLU, PADAHAL SUDAH ADA id_peristiwa ──────────────────────────
  // Tidak semua provider menyertakan ID peristiwa. Untuk yang tidak, sidik jari
  // isi adalah satu-satunya perlindungan terhadap kiriman ulang.
  const body = JSON.stringify({ aksi: 'kirim', nilai: 100 });

  const a = tambah({ body });
  const b = tambah({ body });

  assert.equal(a.duplikat, false);
  assert.equal(b.duplikat, true);
});

test('isi sama tapi LEBIH DARI 1 jam → dianggap pesan baru', () => {
  // ── KENAPA ADA JENDELA WAKTU ──────────────────────────────────────────────
  // Tanpa jendela, dua webhook yang isinya kebetulan sama di hari berbeda akan
  // saling menolak — dan pesan yang SAH hilang.
  const body = JSON.stringify({ aksi: 'kirim', nilai: 100 });
  const duaJamLalu = Date.now() - 2 * 60 * 60 * 1000;

  const a = tambah({ body, diterimaAt: duaJamLalu });
  const b = tambah({ body });

  assert.equal(a.duplikat, false);
  assert.equal(b.duplikat, false, 'setelah 1 jam, isi yang sama dianggap pesan baru');
});

test('BUG: id_peristiwa BEDA dengan body IDENTIK → tetap masuk', () => {
  // ── BUG YANG DIJAGA TES INI ───────────────────────────────────────────────
  // Versi pertama modul ini memeriksa sidik jari isi UNTUK SEMUA webhook.
  //
  // Akibatnya: provider yang mengirim dua peristiwa BERBEDA dengan isi yang
  // sama — misalnya dua notifikasi status untuk dua pesanan yang kebetulan
  // serupa — akan salah ditolak. Peristiwa kedua dianggap kiriman ulang dari
  // yang pertama, dan pesan yang SAH hilang.
  //
  // ── URUTAN KEPERCAYAAN ────────────────────────────────────────────────────
  // `id_peristiwa` adalah pernyataan EKSPLISIT dari provider bahwa ini
  // peristiwa berbeda. Sidik jari isi hanya tebakan kita. Tebakan tidak boleh
  // membatalkan pernyataan.
  const bodySama = JSON.stringify({ status: 'aktif', nilai: 100 });

  const a = tambah({ idPeristiwa: 'evt_A', body: bodySama });
  const b = tambah({ idPeristiwa: 'evt_B', body: bodySama });

  assert.equal(a.duplikat, false);
  assert.equal(b.duplikat, false, 'ID berbeda dengan isi sama BUKAN duplikat');
  assert.notEqual(b.id, a.id, 'harus jadi pesan terpisah');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 2);
});

test('tanpa id_peristiwa, sidik jari isi TETAP melindungi', () => {
  // Kebalikan dari tes di atas: kalau provider TIDAK menyatakan ID, tebakan
  // kita yang berlaku — dan kiriman ulang harus tetap tertangkap.
  const bodySama = JSON.stringify({ status: 'aktif' });

  const a = tambah({ body: bodySama });
  const b = tambah({ body: bodySama });

  assert.equal(a.duplikat, false);
  assert.equal(b.duplikat, true, 'tanpa ID, isi sama tetap dianggap duplikat');
});

test('isi BEDA → tidak dianggap duplikat', () => {
  tambah({ body: '{"a":1}' });
  const b = tambah({ body: '{"a":2}' });
  assert.equal(b.duplikat, false);
});

test('url BEDA dengan isi sama → tidak dianggap duplikat', () => {
  // Isi yang sama dikirim ke tujuan berbeda adalah dua pesan yang sah.
  const body = '{"a":1}';
  tambah({ body, url: 'https://contoh.id/tujuan-a' });
  const b = tambah({ body, url: 'https://contoh.id/tujuan-b' });

  assert.equal(b.duplikat, false);
});

test('duplikat mengembalikan ok:true — supaya provider berhenti mengirim ulang', () => {
  // ── KENAPA BUKAN ERROR ────────────────────────────────────────────────────
  // Kiriman ulang adalah hal NORMAL. Kalau diperlakukan sebagai error, log
  // dibanjiri kegagalan yang sebenarnya bukan masalah — dan yang berbahaya,
  // pemanggil mungkin membalas 500, yang membuat provider mengirim ulang LAGI.
  const a = tambah({ idPeristiwa: 'evt_x' });
  const b = tambah({ idPeristiwa: 'evt_x' });

  assert.equal(b.ok, true, 'duplikat bukan error');
  assert.equal(b.duplikat, true);
  assert.ok(b.alasan, 'harus menyebut alasan duplikatnya');
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. BATAS UKURAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('body melebihi batas → DITOLAK, bukan dipotong', () => {
  // ── KENAPA TIDAK DIPOTONG ─────────────────────────────────────────────────
  // Body yang dipotong membuat tanda tangannya tidak cocok saat dikirim ulang.
  // Menyimpannya hanya menunda kegagalan sampai percobaan terakhir — dan
  // memakai ruang database untuk pesan yang PASTI gagal.
  const besar = 'x'.repeat(antrean.BATAS_BODY_BYTE + 1);
  const r = antrean.masukAntrean({ sumber: SUMBER, url: URL, body: besar });

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'body_terlalu_besar');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 0,
    'yang ditolak tidak boleh tersimpan');
});

test('body tepat di batas → diterima', () => {
  const pas = 'x'.repeat(antrean.BATAS_BODY_BYTE);
  assert.equal(antrean.masukAntrean({ sumber: SUMBER, url: URL, body: pas }).ok, true);
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. PENGAMBILAN — dan kenapa dua pekerja tidak boleh bentrok
   ══════════════════════════════════════════════════════════════════════════════ */

test('ambilSiapKirim mengembalikan pesan yang siap', () => {
  tambah({ idPeristiwa: 'evt_1' });
  tambah({ idPeristiwa: 'evt_2' });

  const siap = antrean.ambilSiapKirim(10);
  assert.equal(siap.length, 2);
});

test('pesan yang jadwalnya di masa depan TIDAK diambil', () => {
  // Ini yang membuat backoff bekerja.
  const r = tambah({ idPeristiwa: 'evt_1' });
  getDb().prepare('UPDATE sentinel_antrean SET jadwal_berikut = ? WHERE id = ?')
    .run(Date.now() + 60_000, r.id);

  assert.equal(antrean.ambilSiapKirim(10).length, 0, 'belum waktunya, jangan diambil');
});

test('BALAPAN: pesan yang sudah diambil TIDAK diambil lagi oleh pemanggilan kedua', () => {
  // ── INI PERLINDUNGAN TERHADAP PENGIRIMAN GANDA ────────────────────────────
  // Dua pekerja yang berjalan bersamaan tidak boleh mengirim pesan yang sama.
  // `ambilSiapKirim` menggeser `jadwal_berikut` ke depan saat mengambil, jadi
  // pemanggilan kedua tidak melihatnya sebagai siap.
  tambah({ idPeristiwa: 'evt_1' });

  const pertama = antrean.ambilSiapKirim(10);
  const kedua = antrean.ambilSiapKirim(10);

  assert.equal(pertama.length, 1);
  assert.equal(kedua.length, 0, 'pesan yang sudah diambil tidak boleh diambil lagi');
});

test('batas jumlah dihormati', () => {
  for (let i = 0; i < 5; i++) tambah({ idPeristiwa: `evt_${i}` });
  assert.equal(antrean.ambilSiapKirim(3).length, 3);
});

test('urutan pengambilan: yang paling lama menunggu didahulukan', () => {
  // Antrean yang adil: pesan lama jangan tertahan di belakang pesan baru.
  const lama = tambah({ idPeristiwa: 'evt_lama', diterimaAt: Date.now() - 60_000 });
  const baru = tambah({ idPeristiwa: 'evt_baru' });

  const siap = antrean.ambilSiapKirim(10);
  assert.equal(siap[0].id, lama.id, 'yang lama harus didahulukan');
  assert.equal(siap[1].id, baru.id);
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. BACKOFF — jadwalnya naik, dan ada jitter
   ══════════════════════════════════════════════════════════════════════════════ */

test('jeda berikutnya NAIK setiap kali gagal', () => {
  const jeda = [1, 2, 3, 4, 5].map((n) => antrean.hitungJedaBerikut(n, () => 0.5));

  for (let i = 1; i < jeda.length; i++) {
    assert.ok(jeda[i] > jeda[i - 1],
      `jeda ke-${i + 1} (${jeda[i]}ms) harus lebih lama dari ke-${i} (${jeda[i - 1]}ms)`);
  }
});

test('jeda mengikuti jadwal yang didefinisikan', () => {
  // Dengan acak() = 0.5, jitternya nol — jadi hasilnya persis jadwalnya.
  for (let i = 0; i < antrean.JADWAL_BACKOFF_MS.length; i++) {
    assert.equal(antrean.hitungJedaBerikut(i + 1, () => 0.5), antrean.JADWAL_BACKOFF_MS[i]);
  }
});

test('JITTER: jeda tidak pernah persis sama untuk percobaan yang sama', () => {
  // ── KENAPA JITTER PENTING ─────────────────────────────────────────────────
  // Tanpa jitter, semua pesan yang gagal bersamaan akan dicoba ulang bersamaan
  // juga — dan layanan tujuan yang baru hidup langsung dibanjiri.
  const nilai = new Set();
  for (let i = 0; i < 50; i++) nilai.add(antrean.hitungJedaBerikut(3));

  assert.ok(nilai.size > 10, `jitter harus menghasilkan nilai bervariasi, dapat ${nilai.size} nilai unik`);
});

test('JITTER tidak membuat jeda jadi nol atau negatif', () => {
  // Dengan acak() = 0 (jitter paling negatif), jedanya masih harus positif.
  for (let i = 1; i <= 7; i++) {
    const j = antrean.hitungJedaBerikut(i, () => 0);
    assert.ok(j >= 1000, `jeda percobaan ke-${i} harus minimal 1000ms, dapat ${j}ms`);
  }
});

test('percobaan melebihi jadwal → memakai jeda terakhir, tidak error', () => {
  const terakhir = antrean.JADWAL_BACKOFF_MS[antrean.JADWAL_BACKOFF_MS.length - 1];
  assert.equal(antrean.hitungJedaBerikut(99, () => 0.5), terakhir);
});

test('percobaan 0 atau negatif tidak error', () => {
  assert.doesNotThrow(() => antrean.hitungJedaBerikut(0, () => 0.5));
  assert.doesNotThrow(() => antrean.hitungJedaBerikut(-5, () => 0.5));
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. HASIL PENGIRIMAN — sukses, gagal, dan DLQ
   ══════════════════════════════════════════════════════════════════════════════ */

test('pengiriman berhasil → status dikirim, latensi tercatat', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  const hasil = antrean.catatHasil(r.id, { sukses: true, kodeBalasan: 200, latensiMs: 142 });

  assert.equal(hasil.status, 'dikirim');

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.status, 'dikirim');
  assert.equal(baris.kode_balasan, 200);
  assert.equal(baris.latensi_ms, 142);
  assert.ok(baris.selesai_at, 'selesai_at harus diisi');
});

test('pengiriman gagal → status tetap menunggu, jadwal digeser ke depan', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  const hasil = antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500, pesanGalat: 'Server mati' });

  assert.equal(hasil.status, 'menunggu', 'harus siap dicoba lagi nanti');
  assert.ok(hasil.jedaBerikutMs > 0, 'harus menjadwalkan percobaan berikutnya');

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.percobaan, 1);
  assert.ok(baris.jadwal_berikut > Date.now(), 'jadwal berikutnya harus di masa depan');
  assert.equal(baris.pesan_galat, 'Server mati');
});

test('setelah gagal, pesannya TIDAK langsung diambil lagi', () => {
  // Ini yang mencegah percobaan beruntun membebani CPU.
  const r = tambah({ idPeristiwa: 'evt_1' });
  antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500 });

  assert.equal(antrean.ambilSiapKirim(10).length, 0,
    'setelah gagal, harus menunggu jadwal berikutnya');
});

test('percobaan habis → masuk DLQ, TIDAK dihapus', () => {
  // ── KENAPA TIDAK DIHAPUS ──────────────────────────────────────────────────
  // Kegagalan berulang biasanya berarti ADA YANG SALAH (URL salah, format tidak
  // diterima). Pesan di DLQ bisa diperiksa manusia, diperbaiki, lalu dikirim
  // ulang. Kalau dihapus, satu-satunya bukti webhook itu pernah ada ikut hilang.
  const r = tambah({ idPeristiwa: 'evt_1' });

  let hasil;
  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    hasil = antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500, pesanGalat: 'gagal terus' });
  }

  assert.equal(hasil.status, 'dlq', `setelah ${antrean.MAKS_PERCOBAAN} percobaan harus masuk DLQ`);

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.ok(baris, 'pesan DLQ harus TETAP ADA di database');
  assert.equal(baris.status, 'dlq');
  assert.equal(baris.percobaan, antrean.MAKS_PERCOBAAN);
});

test('pesan DLQ tidak diambil lagi', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500 });
  }

  assert.equal(antrean.ambilSiapKirim(10).length, 0, 'DLQ bukan antrean kerja');
});

test('pesan gagal 3x lalu BERHASIL → status dikirim', () => {
  // Yang gagal sementara harus bisa pulih. Kalau tidak, layanan tujuan yang
  // sempat mati 10 menit akan membuat semua webhook masuk DLQ.
  const r = tambah({ idPeristiwa: 'evt_1' });

  for (let i = 0; i < 3; i++) antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 503 });

  const hasil = antrean.catatHasil(r.id, { sukses: true, kodeBalasan: 200, latensiMs: 88 });
  assert.equal(hasil.status, 'dikirim');
  assert.equal(hasil.percobaan, 4, 'jumlah percobaan tetap dihitung');
});

test('pesan yang gagal tidak lagi diambil setelah berhasil', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500 });
  antrean.catatHasil(r.id, { sukses: true, kodeBalasan: 200 });

  assert.equal(antrean.ambilSiapKirim(10).length, 0);
});

test('catatHasil untuk id yang tidak ada → ditolak, tidak crash', () => {
  const r = antrean.catatHasil('id-yang-tidak-ada', { sukses: true, kodeBalasan: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'tidak_ditemukan');
});

test('pesan galat yang sangat panjang dipotong', () => {
  // Tanpa batas, satu pesan galat raksasa bisa memenuhi kolom dan membuat
  // halaman inspector tidak bisa dibuka.
  const r = tambah({ idPeristiwa: 'evt_1' });
  antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500, pesanGalat: 'x'.repeat(10_000) });

  const baris = getDb().prepare('SELECT pesan_galat FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.ok(baris.pesan_galat.length <= 500, `pesan galat harus dipotong, panjangnya ${baris.pesan_galat.length}`);
});

/* ══════════════════════════════════════════════════════════════════════════════
   7. STATISTIK
   ══════════════════════════════════════════════════════════════════════════════ */

test('statistik menghitung per status', () => {
  const a = tambah({ idPeristiwa: 'a' });
  const b = tambah({ idPeristiwa: 'b' });
  const c = tambah({ idPeristiwa: 'c' });

  antrean.catatHasil(a.id, { sukses: true, kodeBalasan: 200, latensiMs: 100 });
  antrean.catatHasil(b.id, { sukses: false, kodeBalasan: 500 });
  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    antrean.catatHasil(c.id, { sukses: false, kodeBalasan: 500 });
  }

  const s = antrean.statistikAntrean();
  assert.equal(s.dikirim, 1);
  assert.equal(s.menunggu, 1);
  assert.equal(s.dlq, 1);
  assert.equal(s.total, 3);
});

test('statistik latensi hanya dari yang BERHASIL', () => {
  // ── KENAPA BUKAN SEMUA PERCOBAAN ──────────────────────────────────────────
  // Kegagalan sering berakhir dengan timeout (misalnya 30 detik) — dan itu
  // bukan gambaran performa layanan tujuan, itu gambaran kegagalannya.
  // Mencampurnya membuat angka latensi menyesatkan.
  const a = tambah({ idPeristiwa: 'a' });
  const b = tambah({ idPeristiwa: 'b' });

  antrean.catatHasil(a.id, { sukses: true, kodeBalasan: 200, latensiMs: 100 });
  antrean.catatHasil(b.id, { sukses: false, kodeBalasan: 500, latensiMs: 30_000 });

  const s = antrean.statistikAntrean();
  assert.equal(s.latensi.rataMs, 100, 'hanya yang berhasil dihitung');
  assert.equal(s.latensi.sampel, 1);
});

test('statistik pada antrean kosong tidak error', () => {
  const s = antrean.statistikAntrean();
  assert.equal(s.total, 0);
  assert.equal(s.latensi.rataMs, null);
});

/* ══════════════════════════════════════════════════════════════════════════════
   8. PEMBERSIHAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('bersihkanSelesai menghapus yang sudah lama berhasil', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  const lama = Date.now() - 30 * 24 * 60 * 60 * 1000;

  getDb().prepare("UPDATE sentinel_antrean SET status = 'dikirim', selesai_at = ? WHERE id = ?").run(lama, r.id);

  const hasil = antrean.bersihkanSelesai();
  assert.equal(hasil.dihapus, 1);
});

test('bersihkanSelesai TIDAK menghapus DLQ', () => {
  // ── INI YANG PALING PENTING DARI FUNGSI INI ───────────────────────────────
  // Pesan DLQ justru yang paling perlu disimpan: itu bukti ada yang salah.
  const r = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    antrean.catatHasil(r.id, { sukses: false, kodeBalasan: 500 });
  }

  const lama = Date.now() - 365 * 24 * 60 * 60 * 1000;
  getDb().prepare('UPDATE sentinel_antrean SET selesai_at = ? WHERE id = ?').run(lama, r.id);

  antrean.bersihkanSelesai();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 1,
    'DLQ tidak boleh dihapus otomatis, sesuaikan berapa pun umurnya');
});

test('bersihkanSelesai tidak menghapus yang masih menunggu', () => {
  tambah({ idPeristiwa: 'evt_1' });
  antrean.bersihkanSelesai();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 1);
});

test('bersihkanSelesai tidak menghapus yang baru saja berhasil', () => {
  const r = tambah({ idPeristiwa: 'evt_1' });
  antrean.catatHasil(r.id, { sukses: true, kodeBalasan: 200 });

  antrean.bersihkanSelesai();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sentinel_antrean').get().n, 1,
    'yang baru berhasil harus tetap ada untuk diperiksa');
});

/* ══════════════════════════════════════════════════════════════════════════════
   9. KETAHANAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('siapkanTabelAntrean aman dijalankan berkali-kali', () => {
  // Dipanggil setiap startup. Kalau tidak idempoten, layanan gagal start.
  assert.doesNotThrow(() => {
    antrean.siapkanTabelAntrean();
    antrean.siapkanTabelAntrean();
    antrean.siapkanTabelAntrean();
  });
});

test('header disimpan sebagai JSON dan bisa dibaca kembali', () => {
  const r = tambah({ headers: { 'content-type': 'application/json', 'x-kustom': 'nilai' } });
  const baris = getDb().prepare('SELECT headers FROM sentinel_antrean WHERE id = ?').get(r.id);

  const dibaca = JSON.parse(baris.headers);
  assert.equal(dibaca['x-kustom'], 'nilai');
});

test('sidikJari stabil untuk isi yang sama', () => {
  assert.equal(antrean.sidikJari('abc', 'url'), antrean.sidikJari('abc', 'url'));
});

test('sidikJari berbeda untuk isi berbeda', () => {
  assert.notEqual(antrean.sidikJari('abc', 'url'), antrean.sidikJari('abd', 'url'));
  assert.notEqual(antrean.sidikJari('abc', 'url'), antrean.sidikJari('abc', 'url2'));
});

test('semua fungsi tahan terhadap input kosong', () => {
  assert.doesNotThrow(() => antrean.masukAntrean({}));
  assert.doesNotThrow(() => antrean.ambilSiapKirim());
  assert.doesNotThrow(() => antrean.catatHasil('', {}));
  assert.doesNotThrow(() => antrean.hitungJedaBerikut());
  assert.doesNotThrow(() => antrean.statistikAntrean());
  assert.doesNotThrow(() => antrean.bersihkanSelesai({}));
});
