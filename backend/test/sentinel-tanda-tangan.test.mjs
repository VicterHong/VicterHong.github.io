/**
 * Tes verifikasi tanda tangan webhook.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI BUKAN SEKADAR "HARUS BENAR"
 * ══════════════════════════════════════════════════════════════════════════════
 * Modul verifikasi tanda tangan punya dua cara gagal, dan keduanya berbahaya:
 *
 *   1. MENOLAK YANG SAH → webhook asli tidak diproses, pembayaran tidak masuk.
 *      Ini yang paling sering terjadi, dan penyebabnya biasanya konfigurasi
 *      (secret salah, proxy tidak meneruskan header).
 *
 *   2. MENERIMA YANG PALSU → penyerang bisa mengaktifkan langganan tanpa bayar.
 *      Ini yang paling berbahaya, dan tidak ada gejalanya sampai terlambat.
 *
 * Jadi setiap tes di sini memeriksa DUA arah: yang sah diterima, yang palsu
 * ditolak.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * SERANGAN YANG DIUJI, BUKAN HANYA KESALAHAN KETIK
 * ══════════════════════════════════════════════════════════════════════════════
 * Tes yang hanya memeriksa "tanda tangan benar diterima" tidak membuktikan apa
 * pun tentang keamanannya. Yang membuktikan: percobaan SERANGAN yang harus gagal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  bandingAman,
  hitungHmac,
  verifikasiStripe,
  verifikasiGitHub,
  verifikasiTelegram,
  verifikasiHmacSederhana,
  verifikasiTandaTangan,
  pesanAlasan,
  PROVIDER,
  TOLERANSI_DETIK,
} from '../src/sentinel/tanda-tangan.mjs';

const SECRET = 'rahasia-uji-yang-panjang-dan-acak-abcdef123456';
const BODY = JSON.stringify({ id: 'evt_123', jumlah: 50000, status: 'sukses' });

/* ── Pembantu: membuat tanda tangan yang SAH ────────────────────────────── */

const hmac = (isi, secret = SECRET, enc = 'hex') =>
  createHmac('sha256', secret).update(isi).digest(enc);

/* ══════════════════════════════════════════════════════════════════════════════
   1. BANDING AMAN — pondasi semua verifikasi
   ══════════════════════════════════════════════════════════════════════════════ */

test('bandingAman: string sama → true', () => {
  assert.equal(bandingAman('abc123', 'abc123'), true);
});

test('bandingAman: string beda → false', () => {
  assert.equal(bandingAman('abc123', 'abc124'), false);
});

test('bandingAman: panjang beda → false, TIDAK melempar', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // `timingSafeEqual` bawaan Node MELEMPAR kalau panjang buffer berbeda.
  // Kalau itu tidak ditangkap, penyerang bisa memicu error 500 hanya dengan
  // mengirim tanda tangan berpanjang salah — dan error 500 membocorkan bahwa
  // endpoint-nya ada dan sedang membandingkan.
  assert.equal(bandingAman('abc', 'abcdef'), false);
  assert.equal(bandingAman('abcdef', 'abc'), false);
});

test('bandingAman: string kosong → false, walaupun keduanya kosong', () => {
  // ── KENAPA KOSONG HARUS FALSE ─────────────────────────────────────────────
  // Dua string kosong secara teknis "sama". Tapi tanda tangan kosong tidak
  // pernah sah — dan mengembalikan true di sini berarti webhook tanpa tanda
  // tangan sama sekali akan DITERIMA.
  assert.equal(bandingAman('', ''), false);
  assert.equal(bandingAman(null, ''), false);
  assert.equal(bandingAman(undefined, undefined), false);
});

test('bandingAman: null/undefined tidak melempar', () => {
  assert.equal(bandingAman(null, 'abc'), false);
  assert.equal(bandingAman('abc', undefined), false);
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. STRIPE — HMAC dari "<timestamp>.<body>"
   ══════════════════════════════════════════════════════════════════════════════ */

function headerStripe(body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const t = hmac(`${timestamp}.${body}`, secret);
  return `t=${timestamp},v1=${t}`;
}

test('Stripe: tanda tangan sah → diterima', () => {
  const r = verifikasiStripe({ bodyMentah: BODY, header: headerStripe(BODY), secret: SECRET });
  assert.equal(r.ok, true);
});

test('Stripe: SERANGAN — tanda tangan dari body berbeda → ditolak', () => {
  // Penyerang menukar isi body tapi memakai tanda tangan lama.
  const header = headerStripe(BODY);
  const bodyPalsu = JSON.stringify({ id: 'evt_123', jumlah: 99999999, status: 'sukses' });

  const r = verifikasiStripe({ bodyMentah: bodyPalsu, header, secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'tanda_tangan_tidak_cocok');
});

test('Stripe: SERANGAN — secret berbeda → ditolak', () => {
  const header = headerStripe(BODY, { secret: 'secret-penyerang' });
  const r = verifikasiStripe({ bodyMentah: BODY, header, secret: SECRET });
  assert.equal(r.ok, false);
});

test('Stripe: SERANGAN — timestamp diganti, tanda tangan lama dipakai → ditolak', () => {
  // ── INI INTI DARI REPLAY PROTECTION ───────────────────────────────────────
  // Penyerang menangkap payload sah, lalu mengubah timestamp-nya supaya
  // terlihat baru. Karena timestamp IKUT ditandatangani, mengubahnya membuat
  // tanda tangannya tidak cocok.
  //
  // Kalau timestamp tidak ikut ditandatangani, serangan ini akan berhasil.
  const tsLama = Math.floor(Date.now() / 1000) - 60;
  const header = headerStripe(BODY, { timestamp: tsLama });

  // Tukar timestamp jadi sekarang, tanda tangan dibiarkan
  const tandaTangan = header.split('v1=')[1];
  const headerDiubah = `t=${Math.floor(Date.now() / 1000)},v1=${tandaTangan}`;

  const r = verifikasiStripe({ bodyMentah: BODY, header: headerDiubah, secret: SECRET });
  assert.equal(r.ok, false, 'timestamp yang diubah harus membuat tanda tangannya tidak cocok');
});

test('Stripe: SERANGAN — payload lama dikirim ulang → ditolak karena timestamp', () => {
  // Replay murni: semuanya persis sama, hanya waktunya yang sudah lewat.
  const tsLama = Math.floor(Date.now() / 1000) - (TOLERANSI_DETIK + 60);
  const header = headerStripe(BODY, { timestamp: tsLama });

  const r = verifikasiStripe({ bodyMentah: BODY, header, secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'timestamp_kedaluwarsa');
  assert.ok(r.selisihDetik > TOLERANSI_DETIK, 'harus melaporkan berapa lama selisihnya');
});

test('Stripe: timestamp di masa depan yang wajar → diterima', () => {
  // Jam server bisa sedikit lebih lambat dari jam Stripe. Selisih beberapa
  // detik ke depan itu normal dan tidak boleh ditolak.
  const tsDepan = Math.floor(Date.now() / 1000) + 30;
  const header = headerStripe(BODY, { timestamp: tsDepan });

  const r = verifikasiStripe({ bodyMentah: BODY, header, secret: SECRET });
  assert.equal(r.ok, true, 'selisih 30 detik ke depan harus diterima');
});

test('Stripe: timestamp jauh di masa depan → ditolak', () => {
  const tsDepan = Math.floor(Date.now() / 1000) + 3600;
  const header = headerStripe(BODY, { timestamp: tsDepan });

  const r = verifikasiStripe({ bodyMentah: BODY, header, secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'timestamp_kedaluwarsa');
});

test('Stripe: rotasi secret — dua v1 dikirim, cocok salah satu → diterima', () => {
  // Saat rotasi secret, Stripe mengirim tanda tangan dari secret LAMA dan BARU
  // sekaligus. Menerima salah satunya membuat rotasi tidak memutus webhook.
  const ts = Math.floor(Date.now() / 1000);
  const lama = hmac(`${ts}.${BODY}`, 'secret-lama');
  const baru = hmac(`${ts}.${BODY}`, SECRET);

  const r = verifikasiStripe({
    bodyMentah: BODY, header: `t=${ts},v1=${lama},v1=${baru}`, secret: SECRET,
  });
  assert.equal(r.ok, true);
});

test('Stripe: header rusak → ditolak dengan alasan yang jelas', () => {
  const kasus = [
    ['', 'header_kosong'],
    ['t=123', 'tanda_tangan_hilang'],
    ['v1=abc', 'timestamp_hilang'],
    ['t=bukanangka,v1=abc', 'timestamp_tidak_valid'],
    ['t=123,v1=', 'tanda_tangan_hilang'],
  ];

  for (const [header, alasan] of kasus) {
    const r = verifikasiStripe({ bodyMentah: BODY, header, secret: SECRET });
    assert.equal(r.ok, false, `header "${header}" harus ditolak`);
    assert.equal(r.alasan, alasan, `header "${header}" → ${r.alasan}, seharusnya ${alasan}`);
  }
});

test('Stripe: secret kosong → ditolak, bukan crash', () => {
  const r = verifikasiStripe({ bodyMentah: BODY, header: headerStripe(BODY), secret: '' });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'secret_kosong');
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. GITHUB — "sha256=<hex>"
   ══════════════════════════════════════════════════════════════════════════════ */

const headerGitHub = (body, secret = SECRET) => `sha256=${hmac(body, secret)}`;

test('GitHub: tanda tangan sah → diterima', () => {
  const r = verifikasiGitHub({ bodyMentah: BODY, header: headerGitHub(BODY), secret: SECRET });
  assert.equal(r.ok, true);
});

test('GitHub: SERANGAN — SHA-1 DITOLAK, walau tanda tangannya benar', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // GitHub mengirim DUA header: `x-hub-signature` (SHA-1) dan
  // `x-hub-signature-256` (SHA-256). Menerima SHA-1 "untuk kompatibilitas"
  // berarti penyerang bisa memakai skema TERLEMAH dari dua.
  //
  // Tes ini mengirim SHA-1 yang BENAR secara kriptografi — dan harus ditolak,
  // karena skemanya tidak didukung.
  const sha1 = createHmac('sha1', SECRET).update(BODY).digest('hex');
  const r = verifikasiGitHub({ bodyMentah: BODY, header: `sha1=${sha1}`, secret: SECRET });

  assert.equal(r.ok, false, 'SHA-1 harus ditolak walau tanda tangannya sah');
  assert.equal(r.alasan, 'skema_tidak_didukung');
});

test('GitHub: SERANGAN — header tanpa prefiks skema → ditolak', () => {
  // Kalau prefiksnya tidak diperiksa, `sha256=` dianggap bagian dari nilai dan
  // perbandingannya selalu gagal — tapi lebih buruk: implementasi yang ceroboh
  // bisa membandingkan hex-nya saja dan menerima skema apa pun.
  const r = verifikasiGitHub({ bodyMentah: BODY, header: hmac(BODY), secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'skema_tidak_didukung');
});

test('GitHub: SERANGAN — body diubah → ditolak', () => {
  const header = headerGitHub(BODY);
  const r = verifikasiGitHub({ bodyMentah: BODY + ' ', header, secret: SECRET });
  assert.equal(r.ok, false, 'satu spasi tambahan harus membuat tanda tangannya tidak cocok');
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. TELEGRAM — secret langsung, bukan HMAC
   ══════════════════════════════════════════════════════════════════════════════ */

test('Telegram: secret cocok → diterima', () => {
  const r = verifikasiTelegram({ header: SECRET, secret: SECRET });
  assert.equal(r.ok, true);
});

test('Telegram: secret beda → ditolak', () => {
  const r = verifikasiTelegram({ header: 'secret-penyerang', secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'secret_tidak_cocok');
});

test('Telegram: secret kosong → ditolak, tidak menerima header kosong', () => {
  // Kalau secret belum dikonfigurasi dan header-nya juga kosong, keduanya
  // "sama" — dan itu akan membuka endpoint ke siapa pun.
  assert.equal(verifikasiTelegram({ header: '', secret: '' }).ok, false);
  assert.equal(verifikasiTelegram({ header: SECRET, secret: '' }).ok, false);
  assert.equal(verifikasiTelegram({ header: '', secret: SECRET }).ok, false);
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. HMAC SEDERHANA — dengan prefiks opsional
   ══════════════════════════════════════════════════════════════════════════════ */

test('HMAC sederhana: hex tanpa prefiks → diterima', () => {
  const r = verifikasiHmacSederhana({ bodyMentah: BODY, header: hmac(BODY), secret: SECRET });
  assert.equal(r.ok, true);
});

test('HMAC sederhana: dengan prefiks → diterima', () => {
  const r = verifikasiHmacSederhana({
    bodyMentah: BODY, header: `sha256=${hmac(BODY)}`, secret: SECRET, prefiks: 'sha256=',
  });
  assert.equal(r.ok, true);
});

test('HMAC sederhana: base64 → diterima', () => {
  const r = verifikasiHmacSederhana({
    bodyMentah: BODY, header: hmac(BODY, SECRET, 'base64'), secret: SECRET, encoding: 'base64',
  });
  assert.equal(r.ok, true);
});

test('HMAC sederhana: SERANGAN — encoding salah tidak diterima', () => {
  // Tanda tangan hex dibandingkan sebagai base64 → tidak boleh cocok.
  const r = verifikasiHmacSederhana({
    bodyMentah: BODY, header: hmac(BODY, SECRET, 'hex'), secret: SECRET, encoding: 'base64',
  });
  assert.equal(r.ok, false);
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. PEMILIH VERIFIKATOR
   ══════════════════════════════════════════════════════════════════════════════ */

test('verifikasiTandaTangan: memilih verifikator yang tepat per provider', () => {
  const ts = Math.floor(Date.now() / 1000);

  const kasus = [
    ['stripe', { 'stripe-signature': `t=${ts},v1=${hmac(`${ts}.${BODY}`)}` }],
    ['github', { 'x-hub-signature-256': headerGitHub(BODY) }],
    ['telegram', { 'x-telegram-bot-api-secret-token': SECRET }],
    ['hmac', { 'x-signature': hmac(BODY) }],
  ];

  for (const [provider, headers] of kasus) {
    const r = verifikasiTandaTangan({ provider, bodyMentah: BODY, headers, secret: SECRET });
    assert.equal(r.ok, true, `${provider} harus diterima`);
  }
});

test('verifikasiTandaTangan: nama header TIDAK memandang huruf besar-kecil', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Node menurunkan nama header jadi huruf kecil, tapi pemanggil bisa mengirim
  // objek buatan — dari tes, atau dari riwayat tersimpan. Pencarian yang persis
  // akan gagal untuk kasus itu, dan webhook yang SAH akan ditolak.
  const headers = { 'X-Hub-Signature-256': headerGitHub(BODY) };
  const r = verifikasiTandaTangan({ provider: 'github', bodyMentah: BODY, headers, secret: SECRET });
  assert.equal(r.ok, true, 'header dengan huruf besar harus tetap ditemukan');
});

test('verifikasiTandaTangan: header tidak ada → alasan yang jelas', () => {
  const r = verifikasiTandaTangan({ provider: 'github', bodyMentah: BODY, headers: {}, secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'header_kosong');
});

test('verifikasiTandaTangan: provider tidak dikenal → ditolak', () => {
  const r = verifikasiTandaTangan({ provider: 'entah-apa', bodyMentah: BODY, headers: {}, secret: SECRET });
  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'provider_tidak_dikenal');
});

test('PROVIDER: setiap entri punya label dan header', () => {
  // Daftar ini ditampilkan di UI, jadi entri yang tidak lengkap akan membuat
  // pilihannya kosong tanpa penjelasan.
  for (const [id, p] of Object.entries(PROVIDER)) {
    assert.ok(p.label, `${id} harus punya label`);
    assert.ok(p.header, `${id} harus punya nama header`);
    assert.equal(typeof p.punyaTimestamp, 'boolean', `${id} harus menyatakan punyaTimestamp`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   7. BODY MENTAH vs JSON YANG DI-PARSE ULANG
   ══════════════════════════════════════════════════════════════════════════════ */

test('SERANGAN: body yang di-parse lalu di-stringify ulang TIDAK selalu cocok', () => {
  // ── KENAPA TES INI ADA ────────────────────────────────────────────────────
  // Ini kesalahan yang paling sering terjadi pada implementasi webhook: HMAC
  // dihitung dari `JSON.stringify(JSON.parse(body))` alih-alih dari body mentah.
  //
  // Kalau provider mengirim spasi atau urutan kunci yang berbeda, hasil
  // stringify-nya berbeda — dan webhook yang SAH ditolak.
  //
  // Tes ini membuktikan perbedaannya NYATA, bukan teoretis: dengan body yang
  // punya spasi tambahan, versi yang di-parse ulang menghasilkan tanda tangan
  // yang berbeda.
  const bodyDenganSpasi = '{"id": "evt_123",  "jumlah": 50000}';

  const tandaTanganBenar = hmac(bodyDenganSpasi);
  const tandaTanganParseUlang = hmac(JSON.stringify(JSON.parse(bodyDenganSpasi)));

  assert.notEqual(tandaTanganBenar, tandaTanganParseUlang,
    'body mentah dan hasil parse-ulang HARUS menghasilkan tanda tangan berbeda — ' +
    'inilah alasan HMAC dihitung dari body mentah');

  // Dan yang benar-benar diterima hanya yang dihitung dari body mentah
  const r = verifikasiHmacSederhana({ bodyMentah: bodyDenganSpasi, header: tandaTanganBenar, secret: SECRET });
  assert.equal(r.ok, true);

  const rSalah = verifikasiHmacSederhana({
    bodyMentah: JSON.stringify(JSON.parse(bodyDenganSpasi)),
    header: tandaTanganBenar,
    secret: SECRET,
  });
  assert.equal(rSalah.ok, false, 'parse ulang harus gagal');
});

test('hitungHmac: menerima Buffer DAN string, hasilnya sama', () => {
  // Body dari HTTP datang sebagai Buffer. Body dari riwayat tersimpan mungkin
  // string. Keduanya harus menghasilkan tanda tangan yang sama.
  const dariString = hitungHmac(BODY, SECRET);
  const dariBuffer = hitungHmac(Buffer.from(BODY, 'utf8'), SECRET);
  assert.equal(dariString, dariBuffer);
});

test('hitungHmac: isi berbeda → hasil berbeda', () => {
  assert.notEqual(hitungHmac('a', SECRET), hitungHmac('b', SECRET));
});

/* ══════════════════════════════════════════════════════════════════════════════
   8. PESAN ALASAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('setiap alasan penolakan punya pesan yang menjelaskan', () => {
  const alasan = [
    'secret_kosong', 'header_kosong', 'timestamp_hilang', 'timestamp_tidak_valid',
    'timestamp_kedaluwarsa', 'tanda_tangan_hilang', 'tanda_tangan_tidak_cocok',
    'skema_tidak_didukung', 'secret_tidak_cocok', 'provider_tidak_dikenal',
  ];

  for (const a of alasan) {
    const p = pesanAlasan(a);
    assert.ok(p && p.length > 15, `pesan untuk "${a}" terlalu pendek: "${p}"`);
    assert.notEqual(p, 'Verifikasi tanda tangan gagal.',
      `alasan "${a}" harus punya pesan khusus, bukan pesan umum`);
  }
});

test('pesan tidak membocorkan detail perbandingan tanda tangan', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Pesan seperti "tanda tangan diharapkan abc123, diterima def456" akan
  // membocorkan tanda tangan yang BENAR ke penyerang — dan itu membuat
  // percobaan berikutnya jauh lebih mudah.
  const semuaPesan = [
    'secret_kosong', 'header_kosong', 'timestamp_hilang', 'timestamp_tidak_valid',
    'timestamp_kedaluwarsa', 'tanda_tangan_hilang', 'tanda_tangan_tidak_cocok',
    'skema_tidak_didukung', 'secret_tidak_cocok', 'provider_tidak_dikenal',
  ].map(pesanAlasan).join(' ');

  assert.doesNotMatch(semuaPesan, /[0-9a-f]{32,}/i,
    'pesan tidak boleh memuat nilai hash');
  assert.doesNotMatch(semuaPesan, /diharapkan|expected|seharusnya/i,
    'pesan tidak boleh menyebut nilai yang diharapkan');
});

test('alasan yang tidak dikenal → pesan umum, bukan kosong', () => {
  const p = pesanAlasan('alasan-yang-tidak-ada');
  assert.ok(p && p.length > 10);
});

/* ══════════════════════════════════════════════════════════════════════════════
   9. KETAHANAN — input yang tidak terduga
   ══════════════════════════════════════════════════════════════════════════════ */

test('semua verifikator tahan terhadap input kosong', () => {
  // Fungsi yang melempar pada input kosong akan membuat endpoint webhook
  // mengembalikan 500 — dan penyerang bisa memicunya berkali-kali tanpa biaya.
  const kosong = [
    () => verifikasiStripe({ bodyMentah: '', header: '', secret: '' }),
    () => verifikasiGitHub({ bodyMentah: '', header: '', secret: '' }),
    () => verifikasiTelegram({ header: '', secret: '' }),
    () => verifikasiHmacSederhana({ bodyMentah: '', header: '', secret: '' }),
    () => verifikasiTandaTangan({ provider: 'stripe', bodyMentah: '', headers: {}, secret: '' }),
    () => verifikasiTandaTangan({}),
  ];

  for (const [i, fn] of kosong.entries()) {
    let hasil;
    assert.doesNotThrow(() => { hasil = fn(); }, `kasus ${i} melempar`);
    assert.equal(hasil.ok, false, `kasus ${i} harus mengembalikan ok:false`);
  }
});

test('semua verifikator tahan terhadap tipe yang salah', () => {
  const aneh = [
    () => verifikasiStripe({ bodyMentah: null, header: null, secret: null }),
    () => verifikasiGitHub({ bodyMentah: 123, header: 456, secret: 789 }),
    () => verifikasiTelegram({ header: {}, secret: [] }),
    () => verifikasiHmacSederhana({ bodyMentah: undefined, header: undefined, secret: undefined }),
  ];

  for (const [i, fn] of aneh.entries()) {
    let hasil;
    assert.doesNotThrow(() => { hasil = fn(); }, `kasus ${i} melempar`);
    assert.equal(hasil.ok, false, `kasus ${i} harus menolak`);
  }
});

test('tanda tangan yang sangat panjang tidak memperlambat atau melempar', () => {
  // Penyerang bisa mengirim tanda tangan sepanjang beberapa MB untuk membebani
  // perbandingan. Harus ditolak dengan cepat, bukan diproses.
  const panjang = 'a'.repeat(500_000);
  const mulai = Date.now();

  const r = verifikasiHmacSederhana({ bodyMentah: BODY, header: panjang, secret: SECRET });

  assert.equal(r.ok, false);
  assert.ok(Date.now() - mulai < 1000, 'harus ditolak dalam waktu wajar');
});
