/**
 * UJI HTTP: pintu masuk webhook — dari luar sampai ke antrean.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * APA YANG DIUJI DI SINI YANG TIDAK DIUJI TES UNIT
 * ══════════════════════════════════════════════════════════════════════════════
 * Tes unit memanggil `terimaWebhook()` langsung. Yang belum terbukti:
 *
 *   - Apakah rutenya BENAR-BENAR terdaftar dan bisa dijangkau lewat HTTP?
 *   - Apakah `readBody` mengirim byte PERSIS seperti yang ditandatangani?
 *     (Kalau ada yang menambah spasi atau mengubah encoding, HMAC gagal.)
 *   - Apakah rute ini benar-benar PUBLIK — tidak ikut terkunci admin?
 *   - Apakah rute lain tidak terganggu?
 *
 * Ketiganya hanya terbukti lewat HTTP sungguhan.
 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { setTimeout as tunggu } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const PORT = 8799;
const DB = '/tmp/uji-gerbang.db';
const SECRET = 'whsec_uji_http_panjang_1234567890';

let lulus = 0;
let gagal = 0;

function periksa(nama, syarat, keterangan = '') {
  if (syarat) {
    lulus += 1;
    console.log(`  ✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ❌ ${nama}${keterangan ? ` — ${keterangan}` : ''}`);
  }
}

function bagian(judul) {
  console.log(`\n── ${judul} ──`);
}

/* ══ JALANKAN SERVER ═══════════════════════════════════════════════════════ */

for (const akhiran of ['', '-wal', '-shm']) {
  try { rmSync(DB + akhiran); } catch { /* belum ada */ }
}

const server = spawn('node', ['src/server.mjs'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: DB,
    TOKEN_SERVICE_ENV: '/tmp/uji-gerbang-kosong.env',
    SERVICE_SECRET: 'secret-uji-panjang-1234567890',
    ADMIN_KEY: 'admin-uji-panjang-1234567890',
    SENTINEL_STRIPE_SECRET: SECRET,
    SENTINEL_TUJUAN_URL: 'https://tujuan-uji.example.com/hook',
    SENTINEL_INTERVAL_MS: '600000', // jangan ganggu tes dengan putaran otomatis
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let keluaran = '';
server.stdout.on('data', (d) => { keluaran += d.toString(); });
server.stderr.on('data', (d) => { keluaran += d.toString(); });

const AKHIR = `http://127.0.0.1:${PORT}`;

async function minta(jalur, { metode = 'GET', body, headers = {} } = {}) {
  const res = await fetch(AKHIR + jalur, {
    method: metode,
    headers,
    body,
  });
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, data };
}

/* ══ TUNGGU SERVER SIAP ════════════════════════════════════════════════════ */

let siap = false;
for (let i = 0; i < 40; i += 1) {
  await tunggu(250);
  try {
    const r = await fetch(`${AKHIR}/api/pricing`);
    if (r.ok) { siap = true; break; }
  } catch { /* belum siap */ }
}

if (!siap) {
  console.error('Server tidak siap. Keluaran:');
  console.error(keluaran.slice(0, 3000));
  server.kill();
  process.exit(1);
}

console.log('Server uji siap.\n');

/* ══ 1. RUTE PUBLIK — TIDAK BUTUH ADMIN_KEY ═══════════════════════════════ */

bagian('1. PINTU MASUK PUBLIK (bukan rute admin)');

{
  const body = JSON.stringify({ id: 'evt_http_1', type: 'charge.succeeded' });
  const t = Math.floor(Date.now() / 1000);
  const tanda = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

  const r = await minta('/api/sentinel/masuk/stripe', {
    metode: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'stripe-signature': tanda },
  });

  periksa('webhook sah diterima TANPA admin key', r.status === 200, `dapat ${r.status}`);
  periksa('mengembalikan id pesan', typeof r.data?.id === 'string', JSON.stringify(r.data));
}

/* ══ 2. TANDA TANGAN PALSU DITOLAK ════════════════════════════════════════ */

bagian('2. TANDA TANGAN PALSU DITOLAK');

{
  const body = JSON.stringify({ id: 'evt_palsu', jumlah: 1 });
  const r = await minta('/api/sentinel/masuk/stripe', {
    metode: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 't=1,v1=tandatangan-palsu',
    },
  });

  periksa('tanda tangan palsu → 401', r.status === 401, `dapat ${r.status}`);
}

{
  const r = await minta('/api/sentinel/masuk/stripe', {
    metode: 'POST',
    body: '{"id":"x"}',
    headers: { 'content-type': 'application/json' },
  });

  periksa('tanpa header tanda tangan → 401', r.status === 401, `dapat ${r.status}`);
}

/* ══ 3. SUMBER TIDAK DIKENAL → 404 ════════════════════════════════════════ */

bagian('3. SUMBER TIDAK DIKENAL TIDAK MEMBOCORKAN APA PUN');

{
  const r = await minta('/api/sentinel/masuk/penyusup', {
    metode: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });

  periksa('sumber tidak dikenal → 404', r.status === 404, `dapat ${r.status}`);
  periksa(
    'pesannya sama dengan URL yang tidak ada',
    r.data?.pesan === 'Tidak ditemukan',
    `dapat: ${JSON.stringify(r.data)}`,
  );
}

{
  // Sumber yang tidak terdaftar di SUMBER_PARAMS (huruf besar) tidak cocok
  // polanya — rutenya tidak dikenali.
  const r = await minta('/api/sentinel/masuk/Stripe', {
    metode: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });

  periksa('nama sumber huruf besar → 404 (pola ketat)', r.status === 404, `dapat ${r.status}`);
}

/* ══ 4. DUPLIKAT ══════════════════════════════════════════════════════════ */

bagian('4. WEBHOOK DIKIRIM ULANG');

{
  const body = JSON.stringify({ id: 'evt_ulang', type: 'charge' });
  const t = Math.floor(Date.now() / 1000);
  const tanda = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
  const headers = { 'content-type': 'application/json', 'stripe-signature': tanda };

  const satu = await minta('/api/sentinel/masuk/stripe', { metode: 'POST', body, headers });
  const dua = await minta('/api/sentinel/masuk/stripe', { metode: 'POST', body, headers });

  periksa('kiriman pertama diterima', satu.status === 200);
  periksa('kiriman ulang tetap 200', dua.status === 200, `dapat ${dua.status}`);
  periksa('kiriman ulang ditandai duplikat', dua.data?.duplikat === true, JSON.stringify(dua.data));
}

/* ══ 5. RUTE ADMIN TETAP TERKUNCI ═════════════════════════════════════════ */

bagian('5. RUTE INSPECTOR TETAP BUTUH KUNCI');

{
  const r = await minta('/api/sentinel/ringkasan');
  periksa('ringkasan tanpa kunci → 401', r.status === 401, `dapat ${r.status}`);
}

{
  const r = await minta('/api/sentinel/ringkasan', {
    headers: { 'x-admin-key': 'admin-uji-panjang-1234567890' },
  });
  periksa('ringkasan dengan kunci → 200', r.status === 200, `dapat ${r.status}`);
  periksa(
    'antrean berisi pesan yang baru masuk',
    (r.data?.antrean?.total ?? 0) >= 2,
    `dapat ${r.data?.antrean?.total}`,
  );
}

/* ══ 6. DAFTAR SUMBER ═════════════════════════════════════════════════════ */

bagian('6. DAFTAR SUMBER UNTUK INSPECTOR');

{
  const r = await minta('/api/sentinel/sumber', {
    headers: { 'x-admin-key': 'admin-uji-panjang-1234567890' },
  });

  periksa('daftar sumber → 200', r.status === 200, `dapat ${r.status}`);
  periksa('stripe ditandai aktif', r.data?.sumber?.find((s) => s.id === 'stripe')?.aktif === true);
  periksa('github ditandai nonaktif', r.data?.sumber?.find((s) => s.id === 'github')?.aktif === false);

  // ── SECRET TIDAK BOLEH MUNCUL DI JAWABAN ────────────────────────────────
  const teks = JSON.stringify(r.data);
  periksa('secret TIDAK bocor di jawaban', !teks.includes(SECRET), 'secret muncul di respons');
}

/* ══ 7. RUTE LAIN TIDAK TERGANGGU ═════════════════════════════════════════ */

bagian('7. RUTE LAIN TIDAK TERGANGGU');

{
  const r = await minta('/api/pricing');
  periksa('/api/pricing tetap publik → 200', r.status === 200, `dapat ${r.status}`);
}

{
  const r = await minta('/api/klien/proyek');
  periksa('/api/klien tetap butuh sesi → 401', r.status === 401, `dapat ${r.status}`);
}

/* ══ 8. MIDTRANS MASIH JALAN DI JALUR LAMANYA ═════════════════════════════ */

bagian('8. JALUR MIDTRANS LAMA TIDAK TERGANGGU');

{
  const r = await minta('/api/midtrans/webhook', {
    metode: 'POST',
    body: JSON.stringify({ order_id: 'x', status_code: '200', gross_amount: '1.00' }),
    headers: { 'content-type': 'application/json' },
  });

  // 401 karena tanda tangan tidak valid — endpoint hidup dan memverifikasi.
  periksa('/api/midtrans/webhook masih memverifikasi → 401', r.status === 401, `dapat ${r.status}`);
}

/* ══ RINGKASAN ════════════════════════════════════════════════════════════ */

server.kill('SIGTERM');
await tunggu(500);

console.log('\n' + '─'.repeat(56));
if (gagal === 0) {
  console.log(`✅ SEMUA LULUS — ${lulus} pemeriksaan`);
} else {
  console.log(`❌ ${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
  console.log('\nKeluaran server (2000 karakter terakhir):');
  console.log(keluaran.slice(-2000));
}

for (const akhiran of ['', '-wal', '-shm']) {
  try { rmSync(DB + akhiran); } catch { /* sudah bersih */ }
}

process.exit(gagal === 0 ? 0 : 1);
