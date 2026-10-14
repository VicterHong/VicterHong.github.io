/**
 * Tes pengirim webhook — dengan fetch tiruan yang bisa disetel hasilnya.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA FETCH DITIRUKAN, BUKAN SERVER SUNGGUHAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Yang perlu diuji di sini adalah PERILAKU SAAT GAGAL: timeout, server 500,
 * koneksi ditolak, dan sirkuit yang terbuka.
 *
 * Server sungguhan tidak bisa diminta "balas dengan timeout 10 detik" atau
 * "tutup koneksinya di tengah" secara andal — dan tes yang bergantung pada
 * kegagalan jaringan sungguhan akan rapuh: kadang lulus, kadang tidak,
 * tergantung cuaca.
 *
 * Fetch tiruan membuat setiap skenario itu DETERMINISTIK.
 *
 * ── YANG TETAP SUNGGUHAN ─────────────────────────────────────────────────────
 * Database dan antreannya sungguhan, karena di situlah batasan yang tidak bisa
 * ditiru mock: UNIQUE untuk kiriman ulang, dan transisi keadaan sirkuit.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, getDb } from '../src/db.mjs';

openDb(':memory:');
const antrean = await import('../src/sentinel/antrean.mjs');
const sirkuit = await import('../src/sentinel/sirkuit.mjs');
const pengirim = await import('../src/sentinel/pengirim.mjs');

const URL_A = 'https://tujuan.contoh.id/webhook';

/* ── Fetch tiruan ───────────────────────────────────────────────────────── */

/**
 * Buat fetch tiruan dengan jawaban yang bisa diatur.
 *
 * `jawaban` bisa berupa:
 *   · angka          → kode balasan HTTP
 *   · 'timeout'      → tidak pernah membalas sampai di-abort
 *   · Error          → melempar galat jaringan
 */
function fetchTiruan(jawaban = 200, catatan = []) {
  return async (url, opsi) => {
    catatan.push({ url, body: opsi.body, headers: opsi.headers });

    if (jawaban === 'timeout') {
      // Menunggu sampai sinyalnya di-abort, lalu melempar seperti fetch asli.
      return new Promise((_, tolak) => {
        opsi.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          tolak(err);
        });
      });
    }

    if (jawaban instanceof Error) throw jawaban;

    return {
      status: jawaban,
      text: async () => 'balasan dari server tujuan',
    };
  };
}

function tambah(opsi = {}) {
  return antrean.masukAntrean({
    sumber: 'stripe',
    url: URL_A,
    body: JSON.stringify({ id: 'evt_1' }),
    ...opsi,
  });
}

function bersihkan() {
  antrean.siapkanTabelAntrean();
  sirkuit.siapkanTabelSirkuit();
  getDb().exec('DELETE FROM sentinel_antrean');
  getDb().exec('DELETE FROM sentinel_sirkuit');
}

antrean.siapkanTabelAntrean();
sirkuit.siapkanTabelSirkuit();
beforeEach(bersihkan);
after(() => closeDb());

/* ══════════════════════════════════════════════════════════════════════════════
   1. PENGIRIMAN BERHASIL
   ══════════════════════════════════════════════════════════════════════════════ */

test('kirimSatu: balasan 200 → sukses', async () => {
  const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchTiruan(200) });
  assert.equal(h.sukses, true);
  assert.equal(h.kodeBalasan, 200);
  assert.ok(h.latensiMs >= 0, 'latensi harus tercatat');
});

test('kirimSatu: SEMUA kode 2xx dianggap sukses', async () => {
  for (const kode of [200, 201, 202, 204]) {
    const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchTiruan(kode) });
    assert.equal(h.sukses, true, `kode ${kode} harus dianggap sukses`);
  }
});

test('kirimSatu: 3xx TIDAK dianggap sukses', async () => {
  // ── KENAPA BUKAN ──────────────────────────────────────────────────────────
  // Kita tidak mengikuti pengalihan. Menganggapnya sukses berarti kita tidak
  // pernah tahu apakah pesannya benar-benar sampai ke tujuan.
  for (const kode of [301, 302, 307]) {
    const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchTiruan(kode) });
    assert.equal(h.sukses, false, `kode ${kode} tidak boleh dianggap sukses`);
  }
});

test('kirimSatu: 4xx dan 5xx → gagal', async () => {
  for (const kode of [400, 401, 403, 404, 429, 500, 502, 503]) {
    const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchTiruan(kode) });
    assert.equal(h.sukses, false, `kode ${kode} harus gagal`);
    assert.ok(h.pesanGalat.includes(String(kode)), 'pesan galat harus menyebut kodenya');
  }
});

test('kirimSatu: mengirim POST dengan body dan header yang benar', async () => {
  const catatan = [];
  await pengirim.kirimSatu({
    url: URL_A,
    body: '{"uji":1}',
    headers: { 'x-kustom': 'nilai' },
    fetchImpl: fetchTiruan(200, catatan),
  });

  assert.equal(catatan[0].url, URL_A);
  assert.equal(catatan[0].body, '{"uji":1}');
  assert.equal(catatan[0].headers['content-type'], 'application/json');
  assert.equal(catatan[0].headers['x-kustom'], 'nilai');
  assert.ok(catatan[0].headers['user-agent'].includes('SentinelLite'));
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. KEGAGALAN JARINGAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('kirimSatu: timeout → gagal dengan pesan yang menyebut timeout', async () => {
  const h = await pengirim.kirimSatu({
    url: URL_A, body: '{}', timeoutMs: 50, fetchImpl: fetchTiruan('timeout'),
  });

  assert.equal(h.sukses, false);
  assert.ok(/timeout/i.test(h.pesanGalat), `pesan harus menyebut timeout: "${h.pesanGalat}"`);
});

test('kirimSatu: koneksi ditolak → gagal, tidak melempar', async () => {
  // ── KENAPA TIDAK MELEMPAR ─────────────────────────────────────────────────
  // Kegagalan jaringan adalah hal NORMAL di sini. Fungsi yang melempar membuat
  // setiap pemanggil harus menangkap — dan satu yang lupa akan menghentikan
  // seluruh batch.
  const err = new Error('connect ECONNREFUSED');
  const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchTiruan(err) });

  assert.equal(h.sukses, false);
  assert.ok(h.pesanGalat.includes('ECONNREFUSED'));
});

test('kirimSatu: balasan yang tidak bisa dibaca bukan kegagalan', async () => {
  // Statusnya sudah cukup untuk memutuskan — body yang rusak tidak mengubahnya.
  const fetchRusak = async () => ({
    status: 200,
    text: async () => { throw new Error('body rusak'); },
  });

  const h = await pengirim.kirimSatu({ url: URL_A, body: '{}', fetchImpl: fetchRusak });
  assert.equal(h.sukses, true);
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. SATU PUTARAN — jalur normal
   ══════════════════════════════════════════════════════════════════════════════ */

test('jalankanPutaran: mengirim pesan yang siap', async () => {
  tambah({ idPeristiwa: 'evt_1' });
  tambah({ idPeristiwa: 'evt_2' });

  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  assert.equal(r.diambil, 2);
  assert.equal(r.terkirim, 2);
  assert.equal(r.gagal, 0);
});

test('jalankanPutaran: status pesan jadi dikirim setelah berhasil', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(a.id);
  assert.equal(baris.status, 'dikirim');
});

test('jalankanPutaran: antrean kosong → tidak error', async () => {
  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });
  assert.equal(r.diambil, 0);
  assert.equal(r.terkirim, 0);
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. KEGAGALAN → BACKOFF
   ══════════════════════════════════════════════════════════════════════════════ */

test('jalankanPutaran: gagal → pesan dijadwalkan ulang, bukan dihapus', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(500) });

  assert.equal(r.gagal, 1);

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(a.id);
  assert.ok(baris, 'pesan tidak boleh dihapus');
  assert.equal(baris.status, 'menunggu');
  assert.ok(baris.jadwal_berikut > Date.now(), 'harus dijadwalkan ulang ke masa depan');
});

test('jalankanPutaran: kegagalan TIDAK memblokir pesan lain', async () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Satu endpoint yang mati tidak boleh menghentikan pengiriman ke endpoint
  // lain. Kalau putarannya berhenti di kegagalan pertama, endpoint yang sehat
  // ikut tertahan.
  tambah({ idPeristiwa: 'evt_1', url: 'https://mati.contoh.id/x' });
  tambah({ idPeristiwa: 'evt_2', url: 'https://hidup.contoh.id/x' });

  // Yang pertama gagal, yang kedua berhasil
  let panggilan = 0;
  const fetchCampur = async (url, opsi) => {
    panggilan++;
    if (url.includes('mati')) return { status: 500, text: async () => '' };
    return { status: 200, text: async () => 'ok' };
  };

  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchCampur });

  assert.equal(r.diambil, 2);
  assert.equal(r.terkirim, 1, 'yang sehat harus tetap terkirim');
  assert.equal(r.gagal, 1);
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. SIRKUIT TERBUKA → DILEWATI
   ══════════════════════════════════════════════════════════════════════════════ */

test('sirkuit terbuka → pengiriman DILEWATI, tidak dicoba', async () => {
  // ── KENAPA DILEWATI, BUKAN DICOBA ─────────────────────────────────────────
  // Kalau endpointnya sudah jelas mati, mengirim percobaan hanya membuang waktu
  // tunggu timeout — dan untuk 50 pesan, itu 50 kali timeout berturut-turut.
  const a = tambah({ idPeristiwa: 'evt_1' });

  // Buka sirkuitnya
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) sirkuit.catatGagal(URL_A, { sekarang: Date.now() });

  const catatan = [];
  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200, catatan) });

  assert.equal(r.dilewati, 1, 'harus dilewati');
  assert.equal(catatan.length, 0, 'TIDAK boleh ada permintaan jaringan');
});

test('pesan yang dilewati TETAP di antrean, tidak dihapus', async () => {
  // ── INI YANG PALING PENTING ───────────────────────────────────────────────
  // "Dilewati" berarti "dicoba lagi nanti", bukan "dibuang". Pesan yang hilang
  // saat endpointnya mati adalah persis masalah yang ingin diselesaikan.
  const a = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) sirkuit.catatGagal(URL_A, { sekarang: Date.now() });

  await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(a.id);
  assert.ok(baris, 'pesan harus tetap ada');
  assert.equal(baris.status, 'menunggu');
});

test('pesan yang dilewati TIDAK menambah penghitung kegagalan sirkuit', async () => {
  // ── KENAPA TIDAK BOLEH ────────────────────────────────────────────────────
  // Kalau dihitung, sirkuit yang terbuka akan menambah penghitung kegagalannya
  // sendiri — dan jendela tunggunya naik tanpa ada percobaan sungguhan yang
  // gagal. Endpoint yang sudah pulih akan menunggu 30 menit hanya karena
  // pesan-pesan yang dilewati.
  tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) sirkuit.catatGagal(URL_A, { sekarang: Date.now() });

  const sebelum = getDb().prepare('SELECT * FROM sentinel_sirkuit WHERE host = ?').get(sirkuit.hostDari(URL_A));

  await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  const sesudah = getDb().prepare('SELECT * FROM sentinel_sirkuit WHERE host = ?').get(sirkuit.hostDari(URL_A));
  assert.equal(sesudah.gagal_beruntun, sebelum.gagal_beruntun, 'penghitung tidak boleh bertambah');
  assert.equal(sesudah.sudah_dibuka, sebelum.sudah_dibuka, 'riwayat pembukaan tidak boleh bertambah');
});

test('pesan yang dilewati dijadwalkan lagi saat sirkuitnya menutup', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) sirkuit.catatGagal(URL_A, { sekarang: Date.now() });

  await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  const baris = getDb().prepare('SELECT jadwal_berikut FROM sentinel_antrean WHERE id = ?').get(a.id);
  const s = getDb().prepare('SELECT buka_sampai FROM sentinel_sirkuit WHERE host = ?').get(sirkuit.hostDari(URL_A));

  assert.equal(baris.jadwal_berikut, s.buka_sampai,
    'jadwalnya harus mengikuti kapan sirkuitnya menutup');
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. SIRKUIT SETENGAH TERBUKA → hanya SATU percobaan
   ══════════════════════════════════════════════════════════════════════════════ */

test('setengah terbuka + uji GAGAL → hanya SATU pesan yang dicoba', async () => {
  // ── INI PERLINDUNGAN TERHADAP BANJIR ──────────────────────────────────────
  // Tanpa ini, 5 pesan yang menunggu akan semuanya terkirim saat jendela
  // tunggunya lewat — dan endpoint yang masih mati langsung dibanjiri.
  //
  // ── KENAPA UJINYA HARUS GAGAL ─────────────────────────────────────────────
  // Kalau ujinya BERHASIL, sirkuitnya menutup dan pesan berikutnya memang
  // boleh terkirim — endpointnya sudah terbukti hidup. Yang perlu diuji adalah
  // saat endpointnya MASIH MATI.
  for (let i = 0; i < 5; i++) tambah({ idPeristiwa: `evt_${i}` });

  const h = (() => {
    let hasil;
    for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) {
      hasil = sirkuit.catatGagal(URL_A, { sekarang: 1000 });
    }
    return hasil;
  })();

  const catatan = [];
  const r = await pengirim.jalankanPutaran({
    batas: 10,
    sekarang: 1000 + h.tungguMs + 1,
    fetchImpl: fetchTiruan(500, catatan),   // endpoint MASIH mati
  });

  assert.equal(catatan.length, 1, `hanya SATU percobaan uji, tapi ada ${catatan.length}`);
  assert.equal(r.dilewati, 4, 'sisanya harus dilewati');
});

test('setengah terbuka + uji BERHASIL → sisanya boleh terkirim', async () => {
  // ── KENAPA INI JUSTRU BENAR ───────────────────────────────────────────────
  // Setelah uji berhasil, endpointnya TERBUKTI hidup. Menahan pesan berikutnya
  // berarti menunda pengiriman yang sudah pasti berhasil — dan itu merugikan
  // tanpa alasan.
  for (let i = 0; i < 5; i++) tambah({ idPeristiwa: `evt_${i}` });

  const h = (() => {
    let hasil;
    for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) {
      hasil = sirkuit.catatGagal(URL_A, { sekarang: 1000 });
    }
    return hasil;
  })();

  const catatan = [];
  const r = await pengirim.jalankanPutaran({
    batas: 10,
    sekarang: 1000 + h.tungguMs + 1,
    fetchImpl: fetchTiruan(200, catatan),   // endpoint sudah hidup lagi
  });

  assert.equal(catatan.length, 5, 'setelah uji berhasil, semua pesan boleh terkirim');
  assert.equal(r.terkirim, 5);
  assert.equal(r.dilewati, 0);
});

test('uji BERHASIL → sirkuit menutup, pengiriman berikutnya normal', async () => {
  for (let i = 0; i < 3; i++) tambah({ idPeristiwa: `evt_${i}` });

  const h = (() => {
    let hasil;
    for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) hasil = sirkuit.catatGagal(URL_A, { sekarang: 1000 });
    return hasil;
  })();

  // Putaran pertama: satu percobaan uji, berhasil
  await pengirim.jalankanPutaran({
    sekarang: 1000 + h.tungguMs + 1,
    fetchImpl: fetchTiruan(200),
  });

  const k = sirkuit.keadaanSirkuit(URL_A, 1000 + h.tungguMs + 2);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERTUTUP, 'sirkuit harus menutup setelah uji berhasil');
});

test('uji GAGAL → sirkuit terbuka lagi, pesan lain tetap menunggu', async () => {
  for (let i = 0; i < 3; i++) tambah({ idPeristiwa: `evt_${i}` });

  const h = (() => {
    let hasil;
    for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) hasil = sirkuit.catatGagal(URL_A, { sekarang: 1000 });
    return hasil;
  })();

  const waktu = 1000 + h.tungguMs + 1;
  await pengirim.jalankanPutaran({ sekarang: waktu, fetchImpl: fetchTiruan(500) });

  const k = sirkuit.keadaanSirkuit(URL_A, waktu + 1);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERBUKA, 'harus terbuka lagi');

  // Dan pesan yang tersisa tetap di antrean
  const menunggu = getDb().prepare("SELECT COUNT(*) AS n FROM sentinel_antrean WHERE status = 'menunggu'").get().n;
  assert.equal(menunggu, 3, 'semua pesan tetap menunggu, tidak ada yang hilang');
});

/* ══════════════════════════════════════════════════════════════════════════════
   7. KIRIM ULANG MANUAL
   ══════════════════════════════════════════════════════════════════════════════ */

test('kirimUlang: mengembalikan pesan DLQ ke antrean', async () => {
  // ── KENAPA PERLU ──────────────────────────────────────────────────────────
  // Pesan DLQ menunggu diperiksa manusia. Setelah penyebabnya diperbaiki,
  // menunggu jadwal backoff berikutnya berarti menunggu sampai 6 jam.
  const a = tambah({ idPeristiwa: 'evt_1' });

  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    antrean.catatHasil(a.id, { sukses: false, kodeBalasan: 500 });
  }

  assert.equal(
    getDb().prepare('SELECT status FROM sentinel_antrean WHERE id = ?').get(a.id).status,
    'dlq', 'prasyarat: harus di DLQ',
  );

  const r = pengirim.kirimUlang(a.id);
  assert.equal(r.ok, true);

  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(a.id);
  assert.equal(baris.status, 'menunggu');
  assert.equal(baris.percobaan, 0, 'penghitung direset supaya percobaannya penuh');
  assert.equal(baris.selesai_at, null);
});

test('kirimUlang: MENUTUP PAKSA sirkuitnya', async () => {
  // ── KENAPA ────────────────────────────────────────────────────────────────
  // Kalau sirkuitnya masih terbuka, pengiriman ulang ini akan langsung
  // dilewati dan pesannya kembali menunggu. Orang yang menekan "kirim ulang"
  // sudah memperbaiki sesuatu — biarkan percobaannya benar-benar terjadi.
  const a = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) sirkuit.catatGagal(URL_A, { sekarang: Date.now() });

  assert.equal(sirkuit.bolehKirim(URL_A), false, 'prasyarat: sirkuit terbuka');

  pengirim.kirimUlang(a.id);

  assert.equal(sirkuit.bolehKirim(URL_A), true, 'sirkuit harus ditutup paksa');
});

test('kirimUlang: pesan yang sudah terkirim → ditolak', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  const r = pengirim.kirimUlang(a.id);
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'sudah_terkirim');
});

test('kirimUlang: id tidak ada → ditolak, tidak error', async () => {
  const r = pengirim.kirimUlang('id-tidak-ada');
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'tidak_ditemukan');
});

test('kirimUlang: pesan benar-benar terkirim di putaran berikutnya', async () => {
  // Uji sampai akhir: kirim ulang harus benar-benar menghasilkan pengiriman.
  const a = tambah({ idPeristiwa: 'evt_1' });
  for (let i = 0; i < antrean.MAKS_PERCOBAAN; i++) {
    antrean.catatHasil(a.id, { sukses: false, kodeBalasan: 500 });
  }

  pengirim.kirimUlang(a.id);
  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });

  assert.equal(r.terkirim, 1);
  assert.equal(
    getDb().prepare('SELECT status FROM sentinel_antrean WHERE id = ?').get(a.id).status,
    'dikirim',
  );
});

/* ══════════════════════════════════════════════════════════════════════════════
   8. AMBIL PESAN & DAFTAR UNTUK UI
   ══════════════════════════════════════════════════════════════════════════════ */

test('ambilPesan: mengembalikan detail lengkap dengan header terurai', async () => {
  const a = tambah({ idPeristiwa: 'evt_1', headers: { 'x-kustom': 'nilai' } });

  const p = pengirim.ambilPesan(a.id);
  assert.equal(p.id, a.id);
  assert.equal(p.headers['x-kustom'], 'nilai');
  assert.ok(p.host, 'harus menyertakan host');
  assert.ok(p.maksPercobaan > 0);
});

test('ambilPesan: id tidak ada → null', () => {
  assert.equal(pengirim.ambilPesan('tidak-ada'), null);
});

test('daftarPesan: TIDAK menyertakan body', async () => {
  // ── KENAPA ────────────────────────────────────────────────────────────────
  // Body bisa sampai 256 KB. Daftar berisi 50 pesan berarti 12 MB untuk satu
  // permintaan — cukup untuk membuat browser tersendat.
  tambah({ idPeristiwa: 'evt_1' });

  const daftar = pengirim.daftarPesan();
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].body, undefined, 'body tidak boleh ikut di daftar');
  assert.ok(daftar[0].ukuran_body > 0, 'tapi ukurannya boleh, untuk ditampilkan');
});

test('daftarPesan: bisa disaring per status', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  tambah({ idPeristiwa: 'evt_2' });

  antrean.catatHasil(a.id, { sukses: true, kodeBalasan: 200 });

  assert.equal(pengirim.daftarPesan({ status: 'dikirim' }).length, 1);
  assert.equal(pengirim.daftarPesan({ status: 'menunggu' }).length, 1);
});

test('daftarPesan: bisa disaring per sumber', async () => {
  tambah({ idPeristiwa: 'evt_1', sumber: 'stripe' });
  tambah({ idPeristiwa: 'evt_2', sumber: 'github' });

  assert.equal(pengirim.daftarPesan({ sumber: 'github' }).length, 1);
});

test('daftarPesan: menyertakan umur pesan', () => {
  const lama = Date.now() - 60_000;
  tambah({ idPeristiwa: 'evt_1', diterimaAt: lama });

  const daftar = pengirim.daftarPesan();
  assert.ok(daftar[0].umurMs >= 60_000, `umur harus >= 60000ms, dapat ${daftar[0].umurMs}`);
});

/* ══════════════════════════════════════════════════════════════════════════════
   9. KETAHANAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('header yang rusak di database tidak menghentikan pengiriman', async () => {
  // ── KENAPA ────────────────────────────────────────────────────────────────
  // Isinya datang dari database, dan database bisa berisi apa saja — termasuk
  // baris yang disunting manual. JSON.parse yang melempar akan menghentikan
  // seluruh putaran hanya karena satu baris rusak.
  const a = tambah({ idPeristiwa: 'evt_1' });
  getDb().prepare('UPDATE sentinel_antrean SET headers = ? WHERE id = ?').run('{rusak', a.id);

  const r = await pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) });
  assert.equal(r.terkirim, 1, 'pesan harus tetap terkirim tanpa header tambahan');
});

test('jalankanPutaran tahan terhadap antrean yang isinya aneh', async () => {
  const a = tambah({ idPeristiwa: 'evt_1' });
  getDb().prepare('UPDATE sentinel_antrean SET url = ? WHERE id = ?').run('bukan-url', a.id);

  await assert.doesNotReject(() => pengirim.jalankanPutaran({ fetchImpl: fetchTiruan(200) }));
});

test('jalankanPutaran dengan batas 0 → tidak melakukan apa pun', async () => {
  tambah({ idPeristiwa: 'evt_1' });
  const r = await pengirim.jalankanPutaran({ batas: 0, fetchImpl: fetchTiruan(200) });
  assert.equal(r.diambil, 0);
});
