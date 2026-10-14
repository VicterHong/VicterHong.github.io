/**
 * Tes gerbang masuk webhook.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * APA YANG PALING PENTING DIUJI DI SINI
 * ══════════════════════════════════════════════════════════════════════════════
 * Bukan "webhook yang sah diterima" — itu bagian yang mudah. Yang menentukan
 * apakah gerbang ini layak dipercaya:
 *
 *   1. Payload PALSU ditolak SEBELUM tersimpan
 *   2. Sumber tidak dikenal TIDAK membocorkan bahwa dirinya tidak ada
 *   3. Sumber belum dikonfigurasi TIDAK menerima apa pun
 *   4. Verifikasi yang melempar ditolak (fail-closed), bukan diloloskan
 *
 * Kalau nomor 1 gagal, seluruh modul ini tidak ada gunanya — database kita
 * terisi payload siapa saja yang tahu URL-nya.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { openDb, getDb } from '../src/db.mjs';
import { siapkanTabelAntrean, statistikAntrean } from '../src/sentinel/antrean.mjs';
import { siapkanTabelSirkuit } from '../src/sentinel/sirkuit.mjs';

/* ══ PERSIAPAN ═════════════════════════════════════════════════════════════ */

const SECRET_STRIPE = 'whsec_uji_stripe_panjang_1234567890';
const SECRET_GITHUB = 'ghs_uji_github_panjang_1234567890';
const SECRET_TELEGRAM = 'telegram_uji_panjang_1234567890';

// ── TES TIDAK BOLEH MEMBACA service.env PRODUKSI ────────────────────────────
// Tanpa ini, `MIDTRANS_SERVER_KEY` dari service.env produksi terbaca dan
// membuat Midtrans terlihat AKTIF di lingkungan tes. Akibatnya tes "sumber
// nonaktif ditolak" gagal — bukan karena kodenya salah, tapi karena hasilnya
// bergantung pada keadaan server produksi.
//
// Tes yang hasilnya berubah tergantung konfigurasi produksi tidak bisa
// dipercaya: ia bisa hijau di laptop dan merah di server, atau sebaliknya.
process.env.TOKEN_SERVICE_ENV = '/tmp/sentinel-gerbang-kosong.env';

process.env.SENTINEL_STRIPE_SECRET = SECRET_STRIPE;
process.env.SENTINEL_GITHUB_SECRET = SECRET_GITHUB;
process.env.SENTINEL_TELEGRAM_SECRET = SECRET_TELEGRAM;
process.env.SENTINEL_TUJUAN_URL = 'https://tujuan-uji.example.com/hook';

let terimaWebhook;
let daftarSumber;

before(async () => {
  openDb(':memory:');
  siapkanTabelAntrean();
  siapkanTabelSirkuit();

  // Diimpor SETELAH environment disetel — modul membaca config saat import.
  const modul = await import('../src/sentinel/gerbang.mjs');
  terimaWebhook = modul.terimaWebhook;
  daftarSumber = modul.daftarSumber;
});

/** Bersihkan antrean antar tes supaya hitungannya tidak tercampur. */
function bersihkan() {
  getDb().exec('DELETE FROM sentinel_antrean');
}

/* ══ PEMBUAT TANDA TANGAN ══════════════════════════════════════════════════ */

function ttdStripe(body, secret = SECRET_STRIPE, waktu = Math.floor(Date.now() / 1000)) {
  const tanda = createHmac('sha256', secret).update(`${waktu}.${body}`).digest('hex');
  return `t=${waktu},v1=${tanda}`;
}

function ttdGitHub(body, secret = SECRET_GITHUB) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/* ══ 1. SUMBER TIDAK DIKENAL ═══════════════════════════════════════════════ */

test('sumber tidak dikenal → 404', () => {
  const r = terimaWebhook({
    sumber: 'penyusup',
    bodyMentah: '{}',
    headers: {},
  });

  assert.equal(r.ok, false);
  assert.equal(r.kode, 404);
});

test('sumber tidak dikenal TIDAK membocorkan bahwa dirinya tidak ada', () => {
  const r = terimaWebhook({ sumber: 'penyusup', bodyMentah: '{}', headers: {} });

  // ── KENAPA PESANNYA HARUS SAMA DENGAN URL YANG TIDAK ADA ──────────────────
  // Kalau pesannya "sumber tidak dikenal", penyerang tahu ia menemukan
  // sesuatu yang berbeda dari URL acak. Ia lalu menyisir nama sumber.
  assert.equal(r.pesan, 'Tidak ditemukan');
  assert.ok(!/tidak dikenal|unknown|invalid/i.test(r.pesan), `pesan membocorkan: ${r.pesan}`);
});

/* ══ 2. SUMBER BELUM DIKONFIGURASI ═════════════════════════════════════════ */

test('sumber dikenal tapi secret kosong → 404 (nonaktif)', () => {
  // 'hmac' tidak disetel di environment tes ini.
  const r = terimaWebhook({ sumber: 'hmac', bodyMentah: '{}', headers: {} });

  assert.equal(r.ok, false);
  assert.equal(r.kode, 404);
  assert.equal(r.alasan, 'sumber_nonaktif');
});

test('sumber nonaktif TIDAK menerima apa pun ke antrean', () => {
  bersihkan();

  terimaWebhook({ sumber: 'hmac', bodyMentah: '{"a":1}', headers: {} });

  assert.equal(statistikAntrean().total, 0, 'sumber nonaktif menulis ke antrean');
});

/* ══ 3. TANDA TANGAN ═══════════════════════════════════════════════════════ */

test('Stripe: tanda tangan sah → diterima', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_uji_1', type: 'payment_intent.succeeded' });
  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: { 'stripe-signature': ttdStripe(body) },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.kode, 200);
  assert.equal(statistikAntrean().total, 1);
});

test('Stripe: tanda tangan salah → 401, TIDAK tersimpan', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_palsu' });
  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: { 'stripe-signature': ttdStripe(body, 'secret-yang-salah') },
  });

  assert.equal(r.ok, false);
  assert.equal(r.kode, 401);
  assert.equal(statistikAntrean().total, 0, 'payload palsu tersimpan ke antrean');
});

test('Stripe: body diubah setelah ditandatangani → 401', () => {
  bersihkan();

  const bodyAsli = JSON.stringify({ id: 'evt_1', jumlah: 100 });
  const tanda = ttdStripe(bodyAsli);

  // Isi diubah — tanda tangannya tetap yang lama.
  const bodyDiubah = JSON.stringify({ id: 'evt_1', jumlah: 999999 });

  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: bodyDiubah,
    headers: { 'stripe-signature': tanda },
  });

  assert.equal(r.kode, 401);
  assert.equal(statistikAntrean().total, 0);
});

test('Stripe: header tanda tangan tidak ada → 401', () => {
  bersihkan();

  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: '{"id":"x"}',
    headers: {},
  });

  assert.equal(r.kode, 401);
  assert.equal(statistikAntrean().total, 0);
});

test('GitHub: tanda tangan sah → diterima', () => {
  bersihkan();

  const body = JSON.stringify({ ref: 'refs/heads/main' });
  const r = terimaWebhook({
    sumber: 'github',
    bodyMentah: body,
    headers: {
      'x-hub-signature-256': ttdGitHub(body),
      'x-github-delivery': 'delivery-uji-1',
    },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(statistikAntrean().total, 1);
});

test('GitHub: tanda tangan salah → 401', () => {
  bersihkan();

  const body = JSON.stringify({ ref: 'refs/heads/main' });
  const r = terimaWebhook({
    sumber: 'github',
    bodyMentah: body,
    headers: { 'x-hub-signature-256': ttdGitHub(body, 'secret-salah') },
  });

  assert.equal(r.kode, 401);
  assert.equal(statistikAntrean().total, 0);
});

test('Telegram: secret salah → 401', () => {
  bersihkan();

  const r = terimaWebhook({
    sumber: 'telegram',
    bodyMentah: '{"update_id":1}',
    headers: { 'x-telegram-bot-api-secret-token': 'bukan-secret-yang-benar' },
  });

  assert.equal(r.kode, 401);
  assert.equal(statistikAntrean().total, 0);
});

test('Telegram: secret benar → diterima', () => {
  bersihkan();

  const r = terimaWebhook({
    sumber: 'telegram',
    bodyMentah: '{"update_id":1}',
    headers: { 'x-telegram-bot-api-secret-token': SECRET_TELEGRAM },
  });

  assert.equal(r.ok, true, JSON.stringify(r));
});

/* ══ 4. BATAS UKURAN ═══════════════════════════════════════════════════════ */

test('body melebihi batas → 413', () => {
  bersihkan();

  // 300 KB — di atas batas 256 KB.
  const besar = 'x'.repeat(300 * 1024);
  const body = JSON.stringify({ id: 'evt_besar', isi: besar });

  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: { 'stripe-signature': ttdStripe(body) },
  });

  assert.equal(r.kode, 413);
  assert.equal(statistikAntrean().total, 0);
});

/* ══ 5. IDEMPOTENSI ════════════════════════════════════════════════════════ */

test('webhook dikirim ulang → duplikat, tetap 200', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_sama' });
  const header = { 'stripe-signature': ttdStripe(body) };

  const satu = terimaWebhook({ sumber: 'stripe', bodyMentah: body, headers: header });
  const dua = terimaWebhook({ sumber: 'stripe', bodyMentah: body, headers: header });

  assert.equal(satu.ok, true);
  assert.equal(dua.ok, true, 'kiriman ulang harus tetap dijawab 200');
  assert.equal(dua.duplikat, true);
  assert.equal(statistikAntrean().total, 1, 'kiriman ulang menambah baris');
});

test('Stripe memakai ID peristiwa dari body', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_dengan_id' });
  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: { 'stripe-signature': ttdStripe(body) },
  });

  const baris = getDb().prepare('SELECT id_peristiwa FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.id_peristiwa, 'evt_dengan_id');
});

test('GitHub memakai header x-github-delivery sebagai ID peristiwa', () => {
  bersihkan();

  const body = JSON.stringify({ ref: 'main' });
  const r = terimaWebhook({
    sumber: 'github',
    bodyMentah: body,
    headers: {
      'x-hub-signature-256': ttdGitHub(body),
      'x-github-delivery': 'delivery-abc-123',
    },
  });

  const baris = getDb().prepare('SELECT id_peristiwa FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.id_peristiwa, 'delivery-abc-123');
});

test('Telegram tanpa ID peristiwa → tetap masuk, andalkan sidik jari', () => {
  bersihkan();

  const r = terimaWebhook({
    sumber: 'telegram',
    bodyMentah: '{"update_id":99}',
    headers: { 'x-telegram-bot-api-secret-token': SECRET_TELEGRAM },
  });

  assert.equal(r.ok, true);
  const baris = getDb().prepare('SELECT id_peristiwa FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.id_peristiwa, null);
});

/* ══ 6. HEADER DITERUSKAN ══════════════════════════════════════════════════ */

test('header rahasia TIDAK diteruskan ke tujuan', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_header' });
  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: {
      'stripe-signature': ttdStripe(body),
      authorization: 'Bearer rahasia-jangan-sampai-bocor',
      cookie: 'session=rahasia',
      'cf-connecting-ip': '1.2.3.4',
    },
  });

  const baris = getDb().prepare('SELECT headers FROM sentinel_antrean WHERE id = ?').get(r.id);
  const diteruskan = JSON.parse(baris.headers);

  assert.ok(
    !('authorization' in diteruskan),
    'authorization ikut diteruskan — kredensial bocor ke pihak ketiga',
  );
  assert.ok(!('cookie' in diteruskan), 'cookie ikut diteruskan');
  assert.ok(!('cf-connecting-ip' in diteruskan), 'header internal ikut diteruskan');

  // Yang berguna tetap diteruskan.
  assert.ok('stripe-signature' in diteruskan, 'tanda tangan tidak diteruskan');
});

test('header x-github-event diteruskan (penerima butuh tahu jenis event)', () => {
  bersihkan();

  const body = JSON.stringify({ ref: 'main' });
  const r = terimaWebhook({
    sumber: 'github',
    bodyMentah: body,
    headers: {
      'x-hub-signature-256': ttdGitHub(body),
      'x-github-event': 'push',
    },
  });

  const baris = getDb().prepare('SELECT headers FROM sentinel_antrean WHERE id = ?').get(r.id);
  const diteruskan = JSON.parse(baris.headers);

  assert.equal(diteruskan['x-github-event'], 'push');
});

/* ══ 7. TUJUAN ═════════════════════════════════════════════════════════════ */

test('URL tujuan dari konfigurasi dipakai', () => {
  bersihkan();

  const body = JSON.stringify({ id: 'evt_tujuan' });
  const r = terimaWebhook({
    sumber: 'stripe',
    bodyMentah: body,
    headers: { 'stripe-signature': ttdStripe(body) },
  });

  const baris = getDb().prepare('SELECT url FROM sentinel_antrean WHERE id = ?').get(r.id);
  assert.equal(baris.url, 'https://tujuan-uji.example.com/hook');
});

/* ══ 8. DAFTAR SUMBER UNTUK INSPECTOR ══════════════════════════════════════ */

test('daftarSumber melaporkan status aktif tanpa membocorkan secret', () => {
  const daftar = daftarSumber();

  assert.ok(Array.isArray(daftar));
  assert.ok(daftar.length >= 5, `hanya ${daftar.length} sumber terdaftar`);

  for (const s of daftar) {
    assert.ok(typeof s.id === 'string');
    assert.ok(typeof s.label === 'string');
    assert.equal(typeof s.aktif, 'boolean');

    // ── SECRET TIDAK BOLEH MUNCUL ───────────────────────────────────────────
    // Nilai secret tidak berguna untuk ditampilkan, dan menampilkannya berarti
    // ia muncul di layar, screenshot, dan log akses.
    const teks = JSON.stringify(s);
    assert.ok(!teks.includes(SECRET_STRIPE), `secret Stripe bocor di daftar: ${teks}`);
    assert.ok(!teks.includes(SECRET_GITHUB), `secret GitHub bocor di daftar: ${teks}`);
  }
});

test('daftarSumber menandai sumber yang aktif dengan benar', () => {
  const daftar = daftarSumber();
  const peta = Object.fromEntries(daftar.map((s) => [s.id, s]));

  assert.equal(peta.stripe.aktif, true, 'Stripe sudah disetel di environment tes');
  assert.equal(peta.github.aktif, true);
  assert.equal(peta.hmac.aktif, false, 'hmac tidak disetel — harus nonaktif');
});

/* ══ 9. FAIL-CLOSED ════════════════════════════════════════════════════════ */

test('Midtrans tanpa server key → 404 (nonaktif)', () => {
  bersihkan();

  // MIDTRANS_SERVER_KEY tidak disetel di environment tes ini (service.env
  // produksi sengaja tidak dibaca).
  const r = terimaWebhook({
    sumber: 'midtrans',
    bodyMentah: JSON.stringify({ order_id: 'x', status_code: '200' }),
    headers: {},
  });

  assert.equal(r.kode, 404);
  assert.equal(r.alasan, 'sumber_nonaktif');
});

test('sumber nonaktif ditolak SEBELUM body diperiksa', () => {
  bersihkan();

  // ── KENAPA URUTANNYA PENTING ──────────────────────────────────────────────
  // Sumber yang nonaktif harus ditolak lebih dulu, apa pun isi body-nya —
  // termasuk body yang bukan JSON. Kalau pemeriksaan body jalan lebih dulu,
  // penyerang bisa membedakan "sumber tidak aktif" dari "body salah" lewat
  // kode balasan, dan itu membocorkan sumber mana yang terpasang.
  //
  // Jadi: body ngawur pada sumber nonaktif harus tetap 404, BUKAN 400.
  const r = terimaWebhook({
    sumber: 'midtrans',
    bodyMentah: 'ini bukan json sama sekali',
    headers: {},
  });

  assert.equal(r.kode, 404, 'sumber nonaktif harus 404, bukan membocorkan lewat 400');
  assert.equal(r.alasan, 'sumber_nonaktif');
});

test('body bukan JSON pada sumber AKTIF yang butuh urai → 400', async () => {
  bersihkan();

  // ── MIDTRANS DIUJI DENGAN SERVER KEY DISETEL SEMENTARA ────────────────────
  // Tes ini butuh sumber yang AKTIF supaya pemeriksaan body benar-benar
  // tercapai. Server key disetel di sini, lalu dikembalikan — kalau tidak,
  // tes lain yang mengharapkan Midtrans nonaktif akan ikut terpengaruh.
  const { config } = await import('../src/config.mjs');
  const asli = config.midtransServerKey;
  config.midtransServerKey = 'server-key-uji-panjang-1234567890';

  try {
    const r = terimaWebhook({
      sumber: 'midtrans',
      bodyMentah: 'ini bukan json',
      headers: {},
    });

    assert.equal(r.ok, false);
    assert.equal(r.kode, 400);
    assert.equal(r.alasan, 'body_bukan_json');
    assert.equal(statistikAntrean().total, 0);
  } finally {
    config.midtransServerKey = asli;
  }
});
