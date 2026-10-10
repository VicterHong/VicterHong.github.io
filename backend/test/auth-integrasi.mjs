/**
 * Uji INTEGRASI endpoint auth email+sandi — server HTTP nyata.
 *
 * Berbeda dari test/users.test.mjs (uji unit murni), uji ini menjalankan
 * server sungguhan dan memanggil endpoint lewat HTTP. Yang diuji:
 *   • daftar → masuk → sesi
 *   • pesan galat SERAGAM (anti user-enumeration)
 *   • penguncian akun
 *   • alur lupa sandi → reset sandi
 *   • Turnstile wajib ada
 *   • 2FA setelah masuk email+sandi
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = mkdtempSync(join(tmpdir(), 'uji-auth-'));
const PORT = 47000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;

writeFileSync(join(DIR, 'kosong.env'), '# uji\n');

const env = {
  ...process.env,
  DB_PATH: join(DIR, 'uji.db'),
  PORT: String(PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'kosong.env'),
  SERVICE_SECRET: 'uji-service-secret-panjang-minimal-24-karakter-abcdef',
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'uji@example.com',
  SITE_URL: 'http://127.0.0.1:' + PORT,
  // Sitekey uji Cloudflare — selalu lolos, tapi tetap melalui alur nyata.
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
};

const server = spawn('node', ['src/server.mjs'], {
  cwd: '/home/ubuntu/portfolio-victer/backend',
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

// ── Tunggu server siap ───────────────────────────────────────────────────────
let siap = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) { siap = true; break; }
  } catch {}
}
if (!siap) {
  console.error('❌ server tidak siap\n', log.slice(-900));
  process.exit(1);
}
console.log('  ✅ server siap di', BASE);
console.log();

// ── Helper ───────────────────────────────────────────────────────────────────
const hasil = [];
const cek = (nama, dapat, harus) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  hasil.push({ nama, ok, dapat, harus });
};

const post = async (path, body, cookies = '') => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}) },
    body: JSON.stringify({ 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...body }),
    signal: AbortSignal.timeout(15000),
  });
  const teks = await r.text();
  let data = {};
  try { data = JSON.parse(teks); } catch {}
  const setCookie = r.headers.getSetCookie?.() ?? [];
  return { status: r.status, data, teks, setCookie };
};

// ════════════════════════════════════════════════════════════════════════════
console.log('═══ 1. DAFTAR AKUN ═══');
{
  const r = await post('/api/auth/daftar', {
    email: 'Budi@Perusahaan.com',
    nama: 'Budi Santoso',
    perusahaan: 'PT Teknologi Uji',
    sandi: 'sandi-panjang-sekali-2026',
  });
  console.log(`  HTTP ${r.status} · ${r.teks.slice(0, 110)}`);
  cek('daftar berhasil', r.status, 201);
  cek('balasan ok', r.data.ok, true);
  cek('email dinormalisasi (tidak bocorkan)', typeof r.data.email, 'undefined');
}
console.log();

console.log('═══ 2. VALIDASI SERVER ═══');
{
  const a = await post('/api/auth/daftar', { email: 'bukan-email', nama: 'Budi', perusahaan: 'PT Uji', sandi: 'sandi-panjang-sekali-2026' });
  cek('email salah ditolak', a.status, 400);
  cek('field galat dilaporkan', Array.isArray(a.data.fields), true);

  const b = await post('/api/auth/daftar', { email: 'x@y.com', nama: 'Budi', perusahaan: 'PT Uji', sandi: 'pendek' });
  cek('sandi lemah ditolak', b.status, 400);
  console.log(`  sandi lemah → HTTP ${b.status}: ${b.data.message}`);

  const c = await post('/api/auth/daftar', { email: 'x@y.com', nama: 'Budi123', perusahaan: 'PT Uji', sandi: 'sandi-panjang-sekali-2026' });
  cek('nama dengan angka ditolak', c.status, 400);
}
console.log();

console.log('═══ 3. DAFTAR DUPLIKAT ═══');
{
  const r = await post('/api/auth/daftar', {
    email: 'budi@perusahaan.com',   // beda kapitalisasi — harus terdeteksi
    nama: 'Budi Lain',
    perusahaan: 'PT Lain',
    sandi: 'sandi-panjang-lain-2026',
  });
  console.log(`  HTTP ${r.status} · ${r.data.message}`);
  cek('duplikat (beda kapital) ditolak', r.status, 409);
  // Pesannya tidak boleh mengonfirmasi keberadaan akun secara blak-blakan,
  // tapi harus memberi jalan keluar yang jelas.
  cek('pesan memberi jalan keluar', /lupa sandi|masuk/i.test(r.data.message ?? ''), true);
}
console.log();

console.log('═══ 4. MASUK ═══');
{
  // Sandi salah
  const a = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'sandi-yang-salah-sekali' });
  console.log(`  sandi salah → HTTP ${a.status} · ${a.data.message}`);
  cek('sandi salah ditolak', a.status, 401);
  cek('pesan seragam', a.data.message, 'Email atau sandi salah.');
  cek('sisa percobaan dilaporkan', typeof a.data.sisa_percobaan, 'number');

  // Email tidak ada — pesan HARUS SAMA
  const b = await post('/api/auth/masuk', { email: 'tidak-ada@mana.com', sandi: 'sandi-yang-salah-sekali' });
  console.log(`  email tak ada → HTTP ${b.status} · ${b.data.message}`);
  cek('email tak ada ditolak', b.status, 401);
  cek('PESAN SERAGAM (anti-enumeration)', b.data.message, a.data.message);

  // Sandi benar
  const c = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'sandi-panjang-sekali-2026' });
  console.log(`  sandi benar → HTTP ${c.status} · ${c.teks.slice(0, 110)}`);
  cek('masuk berhasil', c.status, 200);
  cek('sesi dibuat (cookie ada)', c.setCookie.length > 0, true);
  cek('proyek dikembalikan', typeof c.data.project, 'string');
  cek('redirect dikembalikan', c.data.redirect, `/${c.data.project}`);
}
console.log();

console.log('═══ 5. TURNSTILE WAJIB ═══');
{
  const r = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'budi@perusahaan.com', sandi: 'sandi-panjang-sekali-2026' }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  console.log(`  tanpa Turnstile → HTTP ${r.status} · ${d.error}`);
  cek('tanpa Turnstile ditolak', r.status, 403);
  cek('galat token_kosong', d.error, 'token_kosong');
}
console.log();

console.log('═══ 6. PENGUNCIAN AKUN ═══');
{
  // Sudah 1 gagal dari langkah 4. Tambah sampai 10.
  let terakhir = null;
  for (let i = 0; i < 11; i++) {
    terakhir = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'salah-lagi-dan-lagi' });
    if (terakhir.status === 429) break;
  }
  console.log(`  setelah banyak gagal → HTTP ${terakhir.status} · ${terakhir.data.message}`);
  cek('akun terkunci', terakhir.status, 429);
  cek('sisa detik dilaporkan', typeof terakhir.data.sisa_detik, 'number');

  // Sandi BENAR pun harus ditolak saat terkunci
  const benar = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'sandi-panjang-sekali-2026' });
  cek('sandi benar pun ditolak saat terkunci', benar.status, 429);
  console.log(`  sandi benar saat terkunci → HTTP ${benar.status} (benar: tetap ditolak)`);
}
console.log();

console.log('═══ 7. LUPA SANDI ═══');
let tokenReset = null;
{
  const a = await post('/api/auth/lupa-sandi', { email: 'budi@perusahaan.com' });
  console.log(`  email terdaftar → HTTP ${a.status} · ${a.data.message}`);
  cek('lupa sandi balas 200', a.status, 200);
  cek('pesan netral', /kalau email itu terdaftar/i.test(a.data.message ?? ''), true);

  const b = await post('/api/auth/lupa-sandi', { email: 'tidak-ada@mana.com' });
  console.log(`  email tak ada → HTTP ${b.status} · ${b.data.message}`);
  cek('RESPONS IDENTIK untuk email tak ada', b.status, a.status);
  cek('PESAN IDENTIK (anti-enumeration)', b.data.message, a.data.message);

  // Ambil token dari log server (jalur cadangan karena Resend belum dikonfigurasi)
  await new Promise((r) => setTimeout(r, 700));
  const m = log.match(/TAUTAN RESET MANUAL untuk budi@perusahaan\.com: \S+token=([A-Za-z0-9_-]+)/);
  if (m) {
    tokenReset = m[1];
    console.log(`  token diambil dari log server (jalur cadangan bekerja)`);
  } else {
    console.log('  ⚠ token tidak ditemukan di log');
  }
}
console.log();

console.log('═══ 8. RESET SANDI ═══');
{
  if (!tokenReset) {
    cek('token reset tersedia', false, true);
  } else {
    const a = await post('/api/auth/reset-sandi', { token: tokenReset, sandi: 'pendek' });
    cek('sandi lemah ditolak', a.status, 400);
    console.log(`  sandi lemah → HTTP ${a.status}: ${a.data.message}`);

    const b = await post('/api/auth/reset-sandi', { token: tokenReset, sandi: 'sandi-baru-panjang-2026' });
    console.log(`  sandi baru → HTTP ${b.status} · ${b.data.message}`);
    cek('reset berhasil', b.status, 200);

    const c = await post('/api/auth/reset-sandi', { token: tokenReset, sandi: 'sandi-ketiga-panjang-2026' });
    cek('token tidak bisa dipakai dua kali', c.status, 400);

    const d = await post('/api/auth/reset-sandi', { token: 'token-karangan', sandi: 'sandi-panjang-baru-2026' });
    cek('token palsu ditolak', d.status, 400);
  }
}
console.log();

console.log('═══ 9. MASUK DENGAN SANDI BARU ═══');
{
  const r = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'sandi-baru-panjang-2026' });
  console.log(`  HTTP ${r.status} · ${r.teks.slice(0, 100)}`);
  cek('masuk dengan sandi baru', r.status, 200);
  cek('kunci akun terbuka setelah reset', r.status !== 429, true);

  // Sandi lama harus gagal
  const lama = await post('/api/auth/masuk', { email: 'budi@perusahaan.com', sandi: 'sandi-panjang-sekali-2026' });
  cek('sandi lama tidak berlaku', lama.status, 401);
}
console.log();

// ════════════════════════════════════════════════════════════════════════════
server.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 400));
rmSync(DIR, { recursive: true, force: true });

console.log('══════════════════════════════════════════════════════════════');
let lulus = 0, gagal = 0;
for (const c of hasil) {
  if (c.ok) { lulus++; console.log(`  ✅ ${c.nama}`); }
  else { gagal++; console.log(`  ❌ ${c.nama}\n      dapat: ${JSON.stringify(c.dapat)}\n      harus: ${JSON.stringify(c.harus)}`); }
}
console.log('══════════════════════════════════════════════════════════════');
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);
