/**
 * Uji alur 2FA LENGKAP lewat HTTP — dengan server backend sungguhan.
 *
 * Ini uji integrasi: memanggil endpoint HTTP seperti klien sungguhan,
 * bukan memanggil fungsi langsung. Membuktikan routing, parsing body,
 * cookie, dan status HTTP semuanya bekerja.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DIR = mkdtempSync(join(tmpdir(), 'uji-http-'));
const DB = join(DIR, 'uji.db');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let lulus = 0, gagal = 0;
const cek = (nama, hasil, harapan) => {
  const ok = hasil === harapan;
  if (ok) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}\n     dapat: ${JSON.stringify(hasil)}\n     harus: ${JSON.stringify(harapan)}`); }
};

// ── Pastikan port bebas SEBELUM start ──────────────────────────────────────
//
// Kalau port sudah dipakai proses lain, server gagal bind TAPI uji tetap
// berjalan — dan bicara dengan server LAIN di port itu. Gejalanya
// membingungkan: respons 503 dari konfigurasi yang sama sekali berbeda.
// (Ini benar-benar terjadi saat menulis uji ini.)
{
  const { createServer } = await import('node:net');
  const bebas = await new Promise((resolve) => {
    const t = createServer();
    t.once('error', () => resolve(false));
    t.once('listening', () => t.close(() => resolve(true)));
    t.listen(PORT, '127.0.0.1');
  });
  if (!bebas) {
    console.log(`  ❌ port ${PORT} sudah dipakai proses lain.`);
    console.log('     Matikan proses itu dulu, atau ubah PORT di uji ini.');
    console.log(`     Cari: sudo ss -tlnp | grep ${PORT}`);
    process.exit(1);
  }
}

console.log('══ MENYIAPKAN SERVER UJI ══');
// File env KOSONG untuk uji. WAJIB: tanpa ini, server membaca
// /home/ubuntu/.portfolio-token/service.env (konfigurasi PRODUKSI).
// Kalau file produksi punya TURNSTILE_SITE_KEY tapi SECRET_KEY tidak
// dioper, konfigurasinya tidak konsisten dan gerbang gagal-closed (503).
const ENV_KOSONG = join(DIR, 'kosong.env');
writeFileSync(ENV_KOSONG, '# env uji — sengaja kosong\n');

const env = {
  ...process.env,
  DB_PATH: DB,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: ENV_KOSONG,   // ← jangan baca env produksi
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'uji@example.com',
  // ── Kunci TESTING resmi Cloudflare ────────────────────────────────────────
  //
  // Dokumentasi: developers.cloudflare.com/turnstile/troubleshooting/testing
  //
  // Kunci ini SELALU lolos validasi dan hanya menerima token dummy
  // (XXXX.DUMMY.TOKEN.XXXX). Produksi tetap memakai kunci sungguhan —
  // kunci uji ditolak oleh secret produksi, dan sebaliknya.
  //
  // KENAPA BUKAN mengosongkan TURNSTILE_SECRET_KEY:
  //   Gerbang token bersifat FAIL-CLOSED. Secret kosong = tolak semua (503).
  //   Itu perilaku yang BENAR untuk produksi (lebih baik menolak daripada
  //   membuka gerbang saat Cloudflare bermasalah). Untuk uji, kita pakai
  //   kunci testing resmi — bukan melonggarkan gerbangnya.
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const srv = spawn('node', ['src/server.mjs'], {
  cwd: '/home/ubuntu/portfolio-victer/backend',
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d.toString(); });
srv.stderr.on('data', (d) => { srvLog += d.toString(); });

// Tunggu server siap
let siap = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) { siap = true; break; }
  } catch { /* belum siap */ }
}

if (!siap) {
  console.log('  ❌ server tidak siap dalam 10 detik');
  console.log('  log:', srvLog.slice(-800));
  srv.kill();
  rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}
console.log(`  ✅ server siap di ${BASE}`);
console.log();

// ── Helper HTTP ────────────────────────────────────────────────────────────
// Token dummy dari sitekey testing. Cloudflare menerimanya hanya kalau
// secret yang dipakai juga kunci testing — jadi ini tidak bisa dipakai
// untuk menembus produksi.
const TOKEN_DUMMY = 'XXXX.DUMMY.TOKEN.XXXX';

async function post(jalur, data, cookie = '') {
  const res = await fetch(`${BASE}${jalur}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    // Sertakan token dummy di setiap POST — endpoint yang melewati gerbang
    // Turnstile memerlukannya.
    body: JSON.stringify({ 'cf-turnstile-response': TOKEN_DUMMY, ...data }),
    signal: AbortSignal.timeout(10000),
  });
  let isi = null;
  try { isi = await res.json(); } catch {}
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, isi, cookie: setCookie.split(';')[0] };
}

async function get(jalur, cookie = '') {
  const res = await fetch(`${BASE}${jalur}`, {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(10000),
  });
  let isi = null;
  try { isi = await res.json(); } catch {}
  return { status: res.status, isi };
}

// ── Setup: buat token lewat admin CLI dengan DB yang sama ──────────────────
console.log('══ 1. BUAT TOKEN UNTUK KLIEN ══');

// Server sudah membuka DB. Kita pakai CLI admin dengan DB_PATH yang sama
// untuk membuat token — itu cara yang sama dipakai admin sungguhan.
import { execFileSync } from 'node:child_process';

let tokenPlain = null;
try {
  const keluaran = execFileSync('node', [
    'src/admin-cli.mjs', 'issue',
    '--project', 'mina',
    '--tier', 'standard',
    '--to', 'klien-uji@perusahaan.co.id',
    '--label', 'Uji 2FA',
  ], {
    cwd: '/home/ubuntu/portfolio-victer/backend',
    env,
    encoding: 'utf8',
    timeout: 15000,
  });

  // CLI mencetak token di output. Ambil baris yang berisi token.
  const m = keluaran.match(/(VP-[A-Z0-9-]+)/);
  if (m) tokenPlain = m[1];
  console.log('  keluaran CLI:', keluaran.trim().split('\n').slice(0, 6).join('\n              '));
} catch (e) {
  console.log('  ⚠ CLI gagal:', e.message.slice(0, 200));
}

if (!tokenPlain) {
  console.log('  ❌ tidak bisa membuat token — uji tidak bisa lanjut');
  srv.kill();
  rmSync(DIR, { recursive: true, force: true });
  process.exit(1);
}
console.log();
cek('token tersedia', typeof tokenPlain === 'string' && tokenPlain.length > 0, true);
cek('format token benar', /^VP-/.test(tokenPlain), true);
console.log();

// ── Login pertama (2FA belum aktif) ────────────────────────────────────────
console.log('══ 2. LOGIN AWAL (2FA belum aktif) ══');
const login1 = await post('/api/token/session', {
  project: 'mina',
  token: tokenPlain,
  device_fp: 'fp-uji',
});
cek('login berhasil', login1.status, 200);
cek('TIDAK minta 2FA', login1.isi?.perlu_2fa, undefined);
cek('sesi diberikan', typeof login1.cookie === 'string' && login1.cookie.includes('portfolio_session'), true);

const sesi = login1.cookie;
console.log(`  cookie: ${sesi.slice(0, 40)}…`);
console.log();

// ── Enrollment ─────────────────────────────────────────────────────────────
console.log('══ 3. MULAI ENROLLMENT 2FA ══');
const mulai = await post('/api/token/2fa/mulai', {}, sesi);
cek('status 200', mulai.status, 200);
cek('secret dikembalikan', typeof mulai.isi?.secret === 'string' && mulai.isi.secret.length === 32, true);
cek('URI otpauth dibuat', String(mulai.isi?.uri ?? '').startsWith('otpauth://totp/'), true);
cek('akun = identitas klien', mulai.isi?.akun, 'klien-uji@perusahaan.co.id');
const secretKlien = mulai.isi?.secret;
console.log();

// ── Hitung kode TOTP dari secret ───────────────────────────────────────────
const { buatTotp } = await import('./src/totp.mjs');

console.log('══ 4. SELESAIKAN ENROLLMENT DENGAN KODE SALAH ══');
const gagalSelesai = await post('/api/token/2fa/selesai', { code: '000000' }, sesi);
cek('kode salah ditolak', gagalSelesai.status, 400);
cek('alasan kode_salah', gagalSelesai.isi?.error, 'kode_salah');
cek('sisa percobaan dilaporkan', typeof gagalSelesai.isi?.sisa_percobaan, 'number');
console.log();

console.log('══ 5. SELESAIKAN ENROLLMENT DENGAN KODE BENAR ══');
const kodeBenar = buatTotp(secretKlien);
const selesai = await post('/api/token/2fa/selesai', { code: kodeBenar }, sesi);
cek('enrollment berhasil', selesai.status, 200);
cek('8 kode pemulihan', selesai.isi?.kode_pemulihan?.length, 8);
const kodePemulihan = selesai.isi?.kode_pemulihan ?? [];
console.log();

// ── Status ─────────────────────────────────────────────────────────────────
console.log('══ 6. CEK STATUS 2FA ══');
const status = await get('/api/token/2fa/status', sesi);
cek('status 200', status.status, 200);
cek('2FA aktif', status.isi?.aktif, true);
cek('8 kode pemulihan tersisa', status.isi?.kode_pemulihan_tersisa, 8);
cek('identity benar', status.isi?.identity, 'klien-uji@perusahaan.co.id');
console.log();

// ── Login ULANG: sekarang harus minta 2FA ─────────────────────────────────
console.log('══ 7. LOGIN ULANG — HARUS MINTA 2FA ══');
const login2 = await post('/api/token/session', {
  project: 'mina',
  token: tokenPlain,
  device_fp: 'fp-uji',
});
cek('status 200', login2.status, 200);
cek('MINTA 2FA', login2.isi?.perlu_2fa, true);
cek('TIDAK memberi sesi', login2.cookie, '');
cek('pesan 2FA ada', typeof login2.isi?.pesan, 'string');
console.log();

console.log('══ 8. LOGIN DENGAN KODE 2FA SALAH ══');
const loginSalah = await post('/api/token/2fa', {
  project: 'mina',
  token: tokenPlain,
  code: '000000',
  device_fp: 'fp-uji',
});
cek('kode salah ditolak', loginSalah.status, 401);
cek('alasan kode_salah', loginSalah.isi?.error, 'kode_salah');
cek('TIDAK memberi sesi', loginSalah.cookie, '');
console.log();

console.log('══ 9. LOGIN DENGAN KODE 2FA BENAR ══');
// Tunggu langkah waktu berikutnya supaya kode baru (hindari replay)
await new Promise((r) => setTimeout(r, 1000));
const kodeLogin = buatTotp(secretKlien, Date.now() + 30000);
const loginBenar = await post('/api/token/2fa', {
  project: 'mina',
  token: tokenPlain,
  code: kodeLogin,
  device_fp: 'fp-uji',
});
cek('login 2FA berhasil', loginBenar.status, 200);
cek('sesi diberikan', loginBenar.cookie.includes('portfolio_session'), true);
cek('metode totp', loginBenar.isi?.metode_2fa, 'totp');
const sesi2 = loginBenar.cookie;
console.log();

console.log('══ 10. AKSES PROYEK DENGAN SESI 2FA ══');
const proyek = await get('/api/project/mina/locked', sesi2);
cek('akses proyek diberikan', proyek.status === 200 || proyek.status === 404, true);
console.log();

console.log('══ 11. LOGIN DENGAN KODE PEMULIHAN ══');
const pakaiPulih = await post('/api/token/2fa', {
  project: 'mina',
  token: tokenPlain,
  code: kodePemulihan[0],
  device_fp: 'fp-uji',
});
cek('kode pemulihan diterima', pakaiPulih.status, 200);
cek('metode kode_pemulihan', pakaiPulih.isi?.metode_2fa, 'kode_pemulihan');
cek('sisa 7 kode', pakaiPulih.isi?.kode_pemulihan_tersisa, 7);
console.log();

console.log('══ 12. KODE PEMULIHAN SEKALI PAKAI ══');
const pulihLagi = await post('/api/token/2fa', {
  project: 'mina',
  token: tokenPlain,
  code: kodePemulihan[0],
  device_fp: 'fp-uji',
});
cek('kode sama ditolak', pulihLagi.status, 401);
console.log();

console.log('══ 13. TANPA SESI → DITOLAK ══');
const tanpaSesi = await get('/api/token/2fa/status');
cek('status tanpa sesi', tanpaSesi.status, 401);
const mulaiTanpa = await post('/api/token/2fa/mulai', {});
cek('mulai tanpa sesi', mulaiTanpa.status, 401);
console.log();

console.log('══ 14. CABUT 2FA (butuh kode sah) ══');
const cabutSalah = await post('/api/token/2fa/cabut', { code: '000000' }, sesi2);
cek('kode salah → ditolak', cabutSalah.status, 401);

// Kode harus dari langkah waktu yang MASIH dalam jendela ±1.
// +30 detik = 1 langkah ke depan → valid.
// (+60 detik = 2 langkah → ditolak, dan itu memang benar.)
const kodeCabut = buatTotp(secretKlien, Date.now() + 30000);
const cabut = await post('/api/token/2fa/cabut', { code: kodeCabut }, sesi2);
if (cabut.status !== 200) {
  console.log('     detail respons:', JSON.stringify(cabut.isi));
}
cek('cabut berhasil', cabut.status, 200);

const statusAkhir = await get('/api/token/2fa/status', sesi2);
cek('2FA tidak aktif lagi', statusAkhir.isi?.aktif, false);
console.log();

console.log('══ 15. LOGIN SETELAH CABUT (tanpa 2FA) ══');
const login3 = await post('/api/token/session', {
  project: 'mina', token: tokenPlain, device_fp: 'fp-uji',
});
cek('tidak minta 2FA lagi', login3.isi?.perlu_2fa, undefined);
cek('sesi langsung diberikan', login3.cookie.includes('portfolio_session'), true);
console.log();

// ── Bersihkan ──────────────────────────────────────────────────────────────
// SIGKILL, bukan SIGTERM — server punya handler shutdown yang bisa
// menggantung kalau ada koneksi terbuka. Tanpa ini, proses menumpuk
// dan port tetap terpakai untuk uji berikutnya.
srv.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 800));
try { rmSync(DIR, { recursive: true, force: true }); } catch {}

console.log('═'.repeat(62));
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('═'.repeat(62));
if (gagal === 0) {
  console.log('\n  ✅ Alur 2FA lengkap bekerja lewat HTTP — siap dipakai.');
} else {
  console.log('\n  ⚠ Ada yang gagal.');
  if (srvLog) console.log('\n  log server (ekor):\n', srvLog.slice(-1500));
  process.exit(1);
}
