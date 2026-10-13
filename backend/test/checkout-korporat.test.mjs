/**
 * Uji: checkout korporat — wajib masuk, email harus akun sendiri, step-up 2FA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Sebelum ini, /api/checkout bisa dipanggil siapa saja dengan email apa saja.
 * Dua akibat nyata:
 *
 *   1. Pembelian anonim — tidak ada akun, tidak ada pemilik, token terbit
 *      ke email yang mungkin bukan milik pemesan.
 *   2. Email ORANG LAIN yang sudah terdaftar bisa dipakai memulai pembayaran
 *      atas namanya — tokennya terbit untuk akun itu tanpa ia tahu.
 *
 * Aturan korporat yang diuji di sini (pola GitHub sudo mode + Stripe):
 *
 *   • tanpa sesi                → 401 belum_masuk
 *   • email ≠ email sesi        → 403 email_tidak_cocok
 *   • akun ber-2FA tanpa sudo   → 403 perlu_2fa
 *   • setelah step-up kode sah  → jendela sudo terbuka, checkout boleh jalan
 *   • kode salah                → 401, sudo TIDAK terbuka
 *
 * ── KENAPA MEMANGGIL SERVER SUNGGUHAN ──────────────────────────────────────
 * Aturan ini hidup di jalur HTTP (cookie sesi, header, urutan gerbang).
 * Menguji fungsi internal saja akan melewatkan justru bagian yang paling
 * mudah salah: apakah cookie-nya terbaca, apakah gerbangnya benar-benar
 * dijalankan sebelum handler.
 *
 * Jalankan: node --test backend/test/checkout-korporat.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = mkdtempSync(join(tmpdir(), 'uji-korporat-'));
const PORT = 48500 + Math.floor(Math.random() * 400);
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
  SITE_URL: `http://127.0.0.1:${PORT}`,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
  // Batas auth dilonggarkan: tes ini banyak memanggil endpoint auth.
  BATAS_AUTH_MASUK: '200',
  BATAS_AUTH_JENDELA_MS: '60000',
  // Midtrans TIDAK dikonfigurasi — gerbang diuji SEBELUM panggilan ke Midtrans,
  // jadi tidak ada permintaan jaringan sungguhan yang terjadi.
  MIDTRANS_SERVER_KEY: '',
};

let server = null;
let log = '';

/** Panggilan HTTP dengan cookie opsional. */
async function panggil(path, { method = 'GET', body = null, cookie = '', turnstile = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + path, {
    method,
    headers,
    // Endpoint step-up pembayaran tidak memakai Turnstile (lihat komentar di
    // routes.mjs) — tes harus memanggilnya TANPA token, persis seperti
    // dialog pembayaran memanggilnya.
    body: body
      ? JSON.stringify(turnstile ? { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...body } : body)
      : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const teks = await r.text();
  let data = {};
  try { data = JSON.parse(teks); } catch { /* bukan JSON */ }
  const setCookie = r.headers.getSetCookie?.() ?? [];
  return { status: r.status, data, teks, setCookie };
}

/** Ambil cookie sesi dari header Set-Cookie. */
function cookieSesi(setCookie) {
  const c = setCookie.find((s) => s.startsWith('portfolio_session='));
  return c ? c.split(';')[0] : '';
}

before(async () => {
  server = spawn('node', ['src/server.mjs'], {
    cwd: join(AKAR, 'backend'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch { /* belum siap */ }
  }
  throw new Error(`server tidak siap:\n${log.slice(-800)}`);
});

after(() => {
  try { server?.kill('SIGKILL'); } catch { /* sudah mati */ }
  rmSync(DIR, { recursive: true, force: true });
});

const EMAIL = 'klien@perusahaan.co.id';
const SANDI = 'sandi-panjang-sekali-2026';
let cookie = '';

describe('checkout korporat', () => {
  test('siapkan akun uji', async () => {
    const r = await panggil('/api/auth/daftar', {
      method: 'POST',
      body: { email: EMAIL, nama: 'Klien Uji', perusahaan: 'PT Uji', sandi: SANDI },
    });
    assert.equal(r.status, 201, `daftar harus 201, dapat ${r.status}: ${r.teks.slice(0, 200)}`);
  });

  test('TANPA SESI: checkout ditolak 401 belum_masuk', async () => {
    const r = await panggil('/api/checkout', {
      method: 'POST',
      body: { tier: 'standar', periode: 'bulanan', idempotency_key: 'kunci-tanpa-sesi-123456' },
    });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'belum_masuk');
  });

  test('konteks tanpa sesi: masuk=false + ada tautan masuk', async () => {
    const r = await panggil('/api/checkout/konteks');
    assert.equal(r.status, 200);
    assert.equal(r.data.masuk, false);
    assert.match(String(r.data.masuk_url ?? ''), /^\/sign-in/);
  });

  test('masuk sebagai akun uji', async () => {
    const r = await panggil('/api/auth/masuk', {
      method: 'POST',
      body: { email: EMAIL, sandi: SANDI },
    });
    assert.equal(r.status, 200, `masuk harus 200: ${r.teks.slice(0, 200)}`);
    cookie = cookieSesi(r.setCookie);
    assert.ok(cookie, 'cookie sesi harus ada');
  });

  test('DENGAN SESI: konteks menunjukkan masuk & tidak perlu 2FA', async () => {
    const r = await panggil('/api/checkout/konteks', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.masuk, true);
    assert.equal(r.data.email, EMAIL);
    assert.equal(r.data.punya_2fa, false);
    assert.equal(r.data.perlu_verifikasi, false);
  });

  test('EMAIL ORANG LAIN: ditolak 403 email_tidak_cocok', async () => {
    const r = await panggil('/api/checkout', {
      method: 'POST',
      cookie,
      body: {
        tier: 'standar', periode: 'bulanan',
        email: 'oranglain@perusahaan.co.id',
        idempotency_key: 'kunci-email-lain-12345678',
      },
    });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'email_tidak_cocok');
  });

  test('email akun sendiri + tanpa 2FA: lolos gerbang (gagal di Midtrans, bukan di gerbang)', async () => {
    const r = await panggil('/api/checkout', {
      method: 'POST',
      cookie,
      body: {
        tier: 'standar', periode: 'bulanan',
        email: EMAIL,
        idempotency_key: 'kunci-lolos-gerbang-12345678',
      },
    });
    // Midtrans tidak dikonfigurasi di tes ini, jadi 503 pembayaran_nonaktif
    // adalah hasil yang BENAR — artinya gerbang identitas sudah dilewati.
    assert.notEqual(r.data.error, 'belum_masuk', 'tidak boleh ditolak karena sesi');
    assert.notEqual(r.data.error, 'email_tidak_cocok', 'email akun sendiri harus diterima');
    assert.notEqual(r.data.error, 'perlu_2fa', 'akun tanpa 2FA tidak boleh diminta kode');
  });
});

describe('step-up 2FA', () => {
  test('aktifkan 2FA untuk akun uji', async () => {
    const mulai = await panggil('/api/token/2fa/mulai', { method: 'POST', cookie, body: {} });
    assert.equal(mulai.status, 200, `mulai 2FA: ${mulai.teks.slice(0, 200)}`);
    assert.ok(mulai.data.secret, 'secret harus dikembalikan sekali');

    // Kode dihitung dari secret yang baru dibuat — persis seperti
    // authenticator milik pengguna.
    const { buatTotp } = await import('../src/totp.mjs');
    const kode = buatTotp(mulai.data.secret);

    const selesai = await panggil('/api/token/2fa/selesai', {
      method: 'POST', cookie, body: { code: kode },
    });
    assert.equal(selesai.status, 200, `selesai 2FA: ${selesai.teks.slice(0, 200)}`);
    assert.equal(selesai.data.ok, true);
  });

  test('konteks: perlu_verifikasi jadi true', async () => {
    // Sesi lama belum lewat step-up (2FA baru diaktifkan setelah sesi dibuat).
    const r = await panggil('/api/checkout/konteks', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.punya_2fa, true);
    assert.equal(r.data.perlu_verifikasi, true);
  });

  test('checkout TANPA step-up: ditolak 403 perlu_2fa', async () => {
    const r = await panggil('/api/checkout', {
      method: 'POST',
      cookie,
      body: {
        tier: 'standar', periode: 'bulanan',
        email: EMAIL,
        idempotency_key: 'kunci-tanpa-stepup-12345678',
      },
    });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'perlu_2fa');
  });

  test('kode SALAH: 401 dan sudo TIDAK terbuka', async () => {
    const r = await panggil('/api/checkout/2fa', {
      method: 'POST', cookie, turnstile: false, body: { code: '000000' },
    });
    assert.equal(r.status, 401);
    assert.notEqual(r.data.ok, true);

    const konteks = await panggil('/api/checkout/konteks', { cookie });
    assert.equal(konteks.data.perlu_verifikasi, true, 'sudo tidak boleh terbuka setelah kode salah');
  });

  test('kode BENAR: sudo terbuka & checkout boleh jalan', async () => {
    // Ambil secret dari DB uji supaya bisa menghitung kode yang sah.
    const { DatabaseSync } = await import('node:sqlite');
    const { dekripsiSecret, buatTotp } = await import('../src/totp.mjs');
    const db = new DatabaseSync(join(DIR, 'uji.db'), { readOnly: true });
    const row = db.prepare('SELECT secret_enc FROM totp_secrets WHERE identity = ?').get(EMAIL);
    db.close();
    assert.ok(row?.secret_enc, 'secret 2FA harus tersimpan');

    const secret = dekripsiSecret(row.secret_enc, env.SERVICE_SECRET);
    const kode = buatTotp(secret);

    const verif = await panggil('/api/checkout/2fa', {
      method: 'POST', cookie, turnstile: false, body: { code: kode },
    });
    assert.equal(verif.status, 200, `step-up harus 200: ${verif.teks.slice(0, 200)}`);
    assert.equal(verif.data.sudo, true);

    const konteks = await panggil('/api/checkout/konteks', { cookie });
    assert.equal(konteks.data.perlu_verifikasi, false, 'sudo harus aktif setelah verifikasi');

    // Checkout sekarang melewati gerbang identitas + 2FA.
    const r = await panggil('/api/checkout', {
      method: 'POST',
      cookie,
      body: {
        tier: 'standar', periode: 'bulanan',
        email: EMAIL,
        idempotency_key: 'kunci-setelah-stepup-12345678',
      },
    });
    assert.notEqual(r.data.error, 'perlu_2fa', 'setelah step-up tidak boleh minta kode lagi');
    assert.notEqual(r.data.error, 'belum_masuk');
    assert.notEqual(r.data.error, 'email_tidak_cocok');
  });

  test('sudo melekat pada SESI: login baru lewat 2FA langsung sudo', async () => {
    // Masuk kedua kali = sesi kedua (perangkat lain). Login ini melewati 2FA,
    // jadi sesi BARU langsung sudo — dan sesi pertama tetap punya statusnya
    // sendiri. Yang diuji: sudo tidak disimpan di token (kalau disimpan di
    // sana, membuka sudo di satu perangkat akan membuka semua perangkat).
    const r2 = await panggil('/api/auth/masuk', {
      method: 'POST', body: { email: EMAIL, sandi: SANDI },
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.data.perlu_2fa, true, 'akun ber-2FA harus diminta kode saat login baru');

    // Selesaikan login kedua.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(DIR, 'uji.db'), { readOnly: true });
    const row = db.prepare('SELECT secret_enc, langkah_terakhir FROM totp_secrets WHERE identity = ?').get(EMAIL);
    db.close();
    const { dekripsiSecret, buatTotp } = await import('../src/totp.mjs');
    const secret = dekripsiSecret(row.secret_enc, env.SERVICE_SECRET);

    // Kode untuk langkah waktu BERIKUTNYA (kode sebelumnya sudah terpakai —
    // deteksi replay menolaknya, dan itu memang benar).
    const kode2 = buatTotp(secret, Date.now() + 30_000);
    const selesai = await panggil('/api/auth/2fa', {
      method: 'POST',
      body: { email: EMAIL, sandi: SANDI, code: kode2 },
    });
    assert.equal(selesai.status, 200, `login 2FA kedua: ${selesai.teks.slice(0, 200)}`);
    const cookie2 = cookieSesi(selesai.setCookie);
    assert.ok(cookie2, 'cookie sesi kedua harus ada');

    // Sesi kedua baru lewat 2FA → sudo aktif.
    const k2 = await panggil('/api/checkout/konteks', { cookie: cookie2 });
    assert.equal(k2.data.perlu_verifikasi, false, 'login yang baru lewat 2FA harus sudo');
  });
});
