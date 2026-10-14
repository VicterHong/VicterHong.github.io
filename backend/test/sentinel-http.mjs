/**
 * UJI HTTP: rute Sentinel — TERUTAMA pengunciannya.
 *
 * ── KENAPA PENGUNCIAN YANG DIUJI PALING DULU ─────────────────────────────────
 * Isi inspector memuat body webhook (data pembayaran, email pelanggan) dan
 * tombol yang bisa memicu pengiriman ke layanan luar. Satu rute yang lupa
 * dikunci berarti semua itu terbuka.
 *
 * Jadi yang diperiksa: SETIAP rute MENOLAK tanpa kunci, dan MENERIMA dengan
 * kunci yang benar.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = mkdtempSync(join(tmpdir(), 'uji-sentinel-'));
const PORT = 49000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const KUNCI = 'kunci-admin-uji-yang-panjang-minimal-24-karakter';

writeFileSync(join(DIR, 'kosong.env'), '# uji\n');

const env = {
  ...process.env,
  DB_PATH: join(DIR, 'uji.db'),
  PORT: String(PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'kosong.env'),
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: KUNCI,
  SALES_EMAIL: 'uji@example.com',
  SITE_URL: BASE,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const server = spawn('node', ['src/server.mjs'], {
  cwd: join(AKAR, 'backend'), env, stdio: ['ignore', 'pipe', 'pipe'],
});

let keluaran = '';
server.stdout.on('data', (d) => { keluaran += d.toString(); });
server.stderr.on('data', (d) => { keluaran += d.toString(); });

async function tungguSiap(ms = 25000) {
  const sampai = Date.now() + ms;
  while (Date.now() < sampai) {
    try {
      const r = await fetch(`${BASE}/api/pricing`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server tidak siap dalam ${ms}ms.\n${keluaran.slice(-1500)}`);
}

async function minta(jalur, { metode = 'GET', kunci = null, body = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (kunci) headers['x-admin-key'] = kunci;
  if (body) headers['content-type'] = 'application/json';

  const r = await fetch(`${BASE}${jalur}`, {
    method: metode, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  let data = null;
  try { data = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, data };
}

let lulus = 0, gagal = 0;
function periksa(nama, benar, detail = '') {
  if (benar) { lulus++; console.log(`  ok  ${nama}`); }
  else { gagal++; console.log(`  X   ${nama}${detail ? ' -- ' + detail : ''}`); }
}

// ── ID PESAN HARUS UUID ─────────────────────────────────────────────────────
// Route ini memakai parameter `pesanId` dengan pola UUID, dan `validParam`
// bekerja default-deny: parameter yang tidak cocok polanya membuat rutenya
// TIDAK DIKENALI — dan jawabannya 404, bukan 401.
//
// Itu berarti penguncian tidak pernah jalan untuk permintaan ber-ID salah.
// Bukan masalah keamanan (rutenya tidak ada), tapi tes yang memakai ID
// sembarangan akan salah membaca hasilnya sebagai "kunci tidak bekerja".
const UUID_UJI = '550e8400-e29b-41d4-a716-446655440000';

// Semua rute yang HARUS terkunci
const RUTE = [
  ['GET', '/api/sentinel/ringkasan'],
  ['GET', '/api/sentinel/pesan'],
  ['GET', `/api/sentinel/pesan/${UUID_UJI}`],
  ['POST', `/api/sentinel/pesan/${UUID_UJI}/kirim-ulang`],
  ['POST', '/api/sentinel/sirkuit/tutup'],
  ['POST', '/api/sentinel/bersihkan'],
  ['POST', '/api/sentinel/kirim-sekarang'],
];

try {
  await tungguSiap();
  console.log('\n── 1. TANPA KUNCI: SEMUA RUTE HARUS MENOLAK ──');

  for (const [metode, jalur] of RUTE) {
    const r = await minta(jalur, { metode, body: metode === 'POST' ? {} : null });
    periksa(`${metode} ${jalur} → 401`, r.status === 401, `dapat ${r.status}`);
  }

  console.log('\n── 2. KUNCI SALAH: SEMUA RUTE HARUS MENOLAK ──');
  for (const [metode, jalur] of RUTE) {
    const r = await minta(jalur, { metode, kunci: 'kunci-palsu', body: metode === 'POST' ? {} : null });
    periksa(`${metode} ${jalur} → 401`, r.status === 401, `dapat ${r.status}`);
  }

  console.log('\n── 3. KUNCI BENAR: RUTE HARUS BEKERJA ──');
  {
    const r = await minta('/api/sentinel/ringkasan', { kunci: KUNCI });
    periksa('ringkasan → 200', r.status === 200, `dapat ${r.status}`);
    periksa('ringkasan punya angka antrean', r.data?.antrean?.total !== undefined);
    periksa('ringkasan punya keadaan sirkuit', r.data?.sirkuit !== undefined);
    periksa('ringkasan punya konfigurasi', r.data?.konfigurasi?.ambangGagal > 0);
  }
  {
    const r = await minta('/api/sentinel/pesan', { kunci: KUNCI });
    periksa('daftar pesan → 200', r.status === 200);
    periksa('daftar pesan berupa array', Array.isArray(r.data?.pesan));
    periksa('daftar pesan menyertakan provider', Array.isArray(r.data?.provider));
  }
  {
    // UUID yang sah tapi tidak ada di database → 404 dari handler
    const r = await minta(`/api/sentinel/pesan/${UUID_UJI}`, { kunci: KUNCI });
    periksa('pesan tidak ada → 404', r.status === 404, `dapat ${r.status}`);
  }
  {
    // ── ID YANG BUKAN UUID DITOLAK SEBELUM HANDLER ────────────────────────────
    // `validParam` bekerja default-deny. Ini memastikan rutenya tidak menerima
    // bentuk ID yang tidak pernah dihasilkan sistem.
    const r = await minta('/api/sentinel/pesan/id-apa-saja', { kunci: KUNCI });
    periksa('ID bukan UUID → 404 (rute tidak dikenali)', r.status === 404, `dapat ${r.status}`);
  }
  {
    const r = await minta('/api/sentinel/kirim-sekarang', { metode: 'POST', kunci: KUNCI, body: { batas: 5 } });
    periksa('kirim-sekarang → 200', r.status === 200);
    periksa('kirim-sekarang mengembalikan ringkasan', r.data?.diambil !== undefined);
  }
  {
    const r = await minta('/api/sentinel/bersihkan', { metode: 'POST', kunci: KUNCI, body: { hari: 7 } });
    periksa('bersihkan → 200', r.status === 200);
    periksa('bersihkan menyebut DLQ tidak dihapus', /DLQ/i.test(r.data?.catatan ?? ''));
  }
  {
    const r = await minta('/api/sentinel/sirkuit/tutup', { metode: 'POST', kunci: KUNCI, body: { host: 'contoh.id' } });
    periksa('tutup sirkuit → 200', r.status === 200, `dapat ${r.status}`);
  }

  console.log('\n── 4. VALIDASI MASUKAN ──');
  {
    const r = await minta('/api/sentinel/sirkuit/tutup', { metode: 'POST', kunci: KUNCI, body: {} });
    periksa('tutup sirkuit tanpa host → 400', r.status === 400, `dapat ${r.status}`);
  }
  {
    const r = await minta('/api/sentinel/kirim-sekarang', { metode: 'POST', kunci: KUNCI, body: { batas: 99999 } });
    periksa('batas besar dibatasi, bukan ditolak', r.status === 200, `dapat ${r.status}`);
  }

  console.log('\n── 5. RUTE LAIN TIDAK TERGANGGU ──');
  {
    const r = await minta('/api/pricing');
    periksa('/api/pricing tetap publik → 200', r.status === 200, `dapat ${r.status}`);
  }
  {
    const r = await minta('/api/klien/ringkasan');
    periksa('/api/klien tetap butuh sesi → 401', r.status === 401, `dapat ${r.status}`);
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(gagal === 0
    ? `SEMUA LULUS -- ${lulus} pemeriksaan`
    : `${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
  process.exitCode = gagal === 0 ? 0 : 1;

} catch (err) {
  console.error('\nERROR:', err.message);
  console.error(keluaran.slice(-1200));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* abaikan */ }
}
