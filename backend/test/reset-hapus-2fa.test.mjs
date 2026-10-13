/**
 * Uji: reset sandi & hapus akun WAJIB lewat 2FA kalau akun memakainya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dua lubang yang ditutup:
 *
 *   1. LUPA SANDI — tautan dari email sudah cukup untuk mengganti sandi,
 *      bahkan pada akun ber-2FA. Artinya 2FA bisa dilewati sepenuhnya:
 *      siapa pun yang menguasai kotak masuk (email diteruskan, perangkat
 *      dipinjam, kotak masuk diretas) memakai "lupa sandi" untuk mengambil
 *      alih akun. Faktor kedua tidak pernah diminta di jalur yang paling
 *      sering dipakai penyerang.
 *
 *   2. HAPUS AKUN — kode email saja cukup untuk menonaktifkan akun. Sama
 *      seperti di atas, kotak masuk yang dikuasai = akun bisa dihabisi.
 *
 * Pola korporat yang dipakai (Microsoft SSPR): kalau two-step verification
 * aktif, tindakan sensitif butuh DUA bukti — tautan/kode email DAN kode
 * authenticator.
 *
 * ── URUTAN YANG DIUJI ──────────────────────────────────────────────────────
 * Untuk reset sandi: token → kode 2FA → BARU ganti sandi. Kalau kode
 * diperiksa setelah sandi berubah, penyerang bisa mengganti sandi lalu
 * meninggalkan halaman — akun tetap terkunci bagi pemiliknya.
 *
 * Jalankan: node --test backend/test/reset-hapus-2fa.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = mkdtempSync(join(tmpdir(), 'uji-2fa-reset-'));
const PORT = 48900 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(DIR, 'uji.db');

writeFileSync(join(DIR, 'kosong.env'), '# uji\n');

const SERVICE_SECRET = 'uji-service-secret-panjang-minimal-24-karakter-abcdef';

// ── KENAPA KREDENSIAL EMAIL DIMATIKAN EKSPLISIT ─────────────────────────────
//
// `...process.env` mewarisi kredensial PRODUKSI dari shell. Akibatnya tes ini
// benar-benar MENGIRIM EMAIL ke alamat @perusahaan.co.id — dan kode verifikasi
// tidak pernah jatuh ke log (karena pengirimannya "berhasil"), sehingga tes
// yang membaca log gagal.
//
// Lebih buruk lagi: tes yang mengirim email sungguhan membakar kuota penyedia,
// dan alamatnya bisa saja milik orang lain. Dengan kredensial dikosongkan,
// email.mjs memakai jalur cadangan — kode ditulis ke log, persis yang
// dibutuhkan tes. Jalur itu SUDAH ADA di produksi untuk kasus SMTP mati.
const env = {
  ...process.env,
  // Penyedia email dikosongkan → jalur cadangan log aktif.
  BREVO_API_KEY: '',
  RESEND_API_KEY: '',
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  CF_API_TOKEN: '',
  CF_ACCOUNT_ID: '',
  EMAIL_FROM: '',
  DB_PATH: DB,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  TOKEN_SERVICE_ENV: join(DIR, 'kosong.env'),
  SERVICE_SECRET,
  ADMIN_KEY: 'uji-admin-key-panjang-minimal-24-karakter-xyz',
  SALES_EMAIL: 'uji@example.com',
  SITE_URL: `http://127.0.0.1:${PORT}`,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_HOSTNAMES: 'example.com',
  NODE_ENV: 'test',
  BATAS_AUTH_MASUK: '300',
  BATAS_AUTH_JENDELA_MS: '60000',
  MIDTRANS_SERVER_KEY: '',
};

let server = null;
let log = '';

async function panggil(path, { method = 'GET', body = null, cookie = '', turnstile = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body
      ? JSON.stringify(turnstile ? { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', ...body } : body)
      : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const teks = await r.text();
  let data = {};
  try { data = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: r.status, data, teks, setCookie: r.headers.getSetCookie?.() ?? [] };
}

function cookieSesi(setCookie) {
  const c = setCookie.find((s) => s.startsWith('portfolio_session='));
  return c ? c.split(';')[0] : '';
}

/** Buka DB uji untuk membaca/menyiapkan data. */
async function db() {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(DB);
}

/** Buat token reset untuk sebuah email — persis seperti tautan di email. */
async function buatTautanReset(email) {
  const d = await db();
  const u = d.prepare('SELECT id FROM users WHERE email = ?').get(email);
  d.close();
  assert.ok(u?.id, `pengguna ${email} harus ada`);

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');

  const d2 = await db();
  d2.prepare('DELETE FROM password_resets WHERE user_id = ?').run(u.id);
  d2.prepare(`
    INSERT INTO password_resets (id, user_id, token_hash, dibuat_at, kedaluwarsa)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomBytes(16).toString('hex'), u.id, hash, Date.now(), Date.now() + 3600_000);
  d2.close();

  return token;
}

/** Kode TOTP yang sah untuk sebuah email (secret dibaca dari DB uji). */
async function kodeTotp(email, geserDetik = 0) {
  const d = await db();
  const row = d.prepare('SELECT secret_enc FROM totp_secrets WHERE identity = ?').get(email);
  d.close();
  assert.ok(row?.secret_enc, `secret 2FA untuk ${email} harus ada`);

  const { dekripsiSecret, buatTotp } = await import('../src/totp.mjs');
  const secret = dekripsiSecret(row.secret_enc, SERVICE_SECRET);
  return buatTotp(secret, Date.now() + geserDetik * 1000);
}

// ── KENAPA LOG DITULIS KE BERKAS, BUKAN DIREKAM DARI PIPE ───────────────────
// `node --test` menyerap output stderr anak proses untuk laporannya sendiri,
// dan rekaman dari pipe datang TERLAMBAT — tes yang membaca log tepat setelah
// permintaan selesai menemukannya kosong. Berkas tidak punya masalah itu:
// apa yang sudah ditulis, sudah bisa dibaca.
const BERKAS_LOG = join(DIR, 'server.log');

before(async () => {
  const fd = openSync(BERKAS_LOG, 'a');
  server = spawn('node', ['src/server.mjs'], {
    cwd: join(AKAR, 'backend'),
    env,
    stdio: ['ignore', fd, fd],
  });

  /** Baca log server dari berkas. */
  globalThis.bacaLog = () => {
    try { return readFileSync(BERKAS_LOG, 'utf8'); } catch { return ''; }
  };

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

const SANDI_LAMA = 'sandi-lama-sekali-2026';
const SANDI_BARU = 'sandi-baru-sekali-2026';

describe('LUPA SANDI dengan 2FA aktif', () => {
  const EMAIL = 'reset-tfa@perusahaan.co.id';
  let cookie = '';

  test('siapkan akun + aktifkan 2FA', async () => {
    const d = await panggil('/api/auth/daftar', {
      method: 'POST',
      body: { email: EMAIL, nama: 'Reset Dua Faktor', perusahaan: 'PT Uji', sandi: SANDI_LAMA },
    });
    assert.equal(d.status, 201, d.teks.slice(0, 200));

    const m = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_LAMA } });
    cookie = cookieSesi(m.setCookie);
    assert.ok(cookie, 'cookie sesi harus ada');

    const mulai = await panggil('/api/token/2fa/mulai', { method: 'POST', cookie, body: {} });
    assert.equal(mulai.status, 200, mulai.teks.slice(0, 200));

    const { buatTotp } = await import('../src/totp.mjs');
    const selesai = await panggil('/api/token/2fa/selesai', {
      method: 'POST', cookie, body: { code: buatTotp(mulai.data.secret) },
    });
    assert.equal(selesai.status, 200, selesai.teks.slice(0, 200));
  });

  test('konteks: token sah + perlu_2fa + email DISAMARKAN', async () => {
    const token = await buatTautanReset(EMAIL);
    const r = await panggil(`/api/auth/reset-sandi/konteks?token=${encodeURIComponent(token)}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.token_sah, true);
    assert.equal(r.data.perlu_2fa, true);

    // Alamat lengkap TIDAK boleh bocor — halaman ini dibuka sebelum identitas
    // terbukti. Yang tampil hanya bentuk samaran.
    assert.ok(r.data.email_samar, 'email_samar harus ada');
    assert.ok(!String(r.data.email_samar).includes(EMAIL), 'email lengkap tidak boleh dikirim');
    // `reset-tfa` → huruf pertama + *** + huruf terakhir + domain utuh.
    assert.match(String(r.data.email_samar), /^r\*\*\*a@perusahaan\.co\.id$/);
  });

  test('konteks: token salah → token_sah false', async () => {
    const r = await panggil('/api/auth/reset-sandi/konteks?token=token-palsu-sekali');
    assert.equal(r.status, 200);
    assert.equal(r.data.token_sah, false);
  });

  test('reset TANPA kode 2FA → 403 perlu_2fa, sandi TIDAK berubah', async () => {
    const token = await buatTautanReset(EMAIL);
    const r = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: SANDI_BARU },
    });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'perlu_2fa');

    // Bukti sandi BELUM berubah: sandi lama masih bisa dipakai masuk.
    const m = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_LAMA } });
    assert.equal(m.status, 200, 'sandi lama harus masih berlaku');
  });

  test('reset dengan kode 2FA SALAH → 401, sandi TETAP tidak berubah', async () => {
    const token = await buatTautanReset(EMAIL);
    const r = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: SANDI_BARU, kode: '000000' },
    });
    assert.equal(r.status, 401);
    assert.equal(r.data.ok, false);

    const m = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_LAMA } });
    assert.equal(m.status, 200, 'sandi lama harus masih berlaku setelah kode salah');
  });

  test('reset dengan kode 2FA BENAR → 200, sandi berubah', async () => {
    const token = await buatTautanReset(EMAIL);
    const kode = await kodeTotp(EMAIL);

    const r = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: SANDI_BARU, kode },
    });
    assert.equal(r.status, 200, r.teks.slice(0, 200));
    assert.equal(r.data.ok, true);

    // Sandi BARU berlaku, sandi lama tidak.
    const baru = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_BARU } });
    assert.equal(baru.status, 200, 'sandi baru harus berlaku');

    const lama = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_LAMA } });
    assert.notEqual(lama.status, 200, 'sandi lama tidak boleh berlaku lagi');
  });

  test('token tidak bisa dipakai DUA kali', async () => {
    const token = await buatTautanReset(EMAIL);
    const kode1 = await kodeTotp(EMAIL);

    const a = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: SANDI_LAMA, kode: kode1 },
    });
    assert.equal(a.status, 200, a.teks.slice(0, 200));

    // Kode untuk langkah waktu berikutnya — kalau memakai yang sama, yang
    // diuji justru deteksi replay, bukan token sekali-pakai.
    const kode2 = await kodeTotp(EMAIL, 30);
    const b = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: 'sandi-ketiga-sekali-2026', kode: kode2 },
    });
    assert.equal(b.status, 400, 'token yang sudah dipakai harus ditolak');
  });
});

describe('LUPA SANDI tanpa 2FA — tidak ada langkah tambahan', () => {
  const EMAIL = 'reset-biasa@perusahaan.co.id';

  test('siapkan akun (tanpa 2FA)', async () => {
    const d = await panggil('/api/auth/daftar', {
      method: 'POST',
      body: { email: EMAIL, nama: 'Reset Biasa', perusahaan: 'PT Uji', sandi: SANDI_LAMA },
    });
    assert.equal(d.status, 201, d.teks.slice(0, 200));
  });

  test('konteks: perlu_2fa false', async () => {
    const token = await buatTautanReset(EMAIL);
    const r = await panggil(`/api/auth/reset-sandi/konteks?token=${encodeURIComponent(token)}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.token_sah, true);
    assert.equal(r.data.perlu_2fa, false);
  });

  test('reset berjalan TANPA kode 2FA', async () => {
    const token = await buatTautanReset(EMAIL);
    const r = await panggil('/api/auth/reset-sandi', {
      method: 'POST', turnstile: false,
      body: { token, sandi: SANDI_BARU },
    });
    assert.equal(r.status, 200, r.teks.slice(0, 200));

    const m = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_BARU } });
    assert.equal(m.status, 200, 'sandi baru harus berlaku tanpa langkah 2FA');
  });
});

describe('HAPUS AKUN dengan 2FA aktif', () => {
  const EMAIL = 'hapus-tfa@perusahaan.co.id';
  let cookie = '';

  // Kode 2FA yang dipakai di langkah 1 — dipakai ULANG di langkah 2, persis
  // seperti UI (pengguna mengetik sekali, nilainya tetap di kotak).
  let kodeTerakhir = '';

  test('siapkan akun + aktifkan 2FA', async () => {
    const d = await panggil('/api/auth/daftar', {
      method: 'POST',
      body: { email: EMAIL, nama: 'Hapus Dua Faktor', perusahaan: 'PT Uji', sandi: SANDI_LAMA },
    });
    assert.equal(d.status, 201, d.teks.slice(0, 200));

    const m = await panggil('/api/auth/masuk', { method: 'POST', body: { email: EMAIL, sandi: SANDI_LAMA } });
    cookie = cookieSesi(m.setCookie);
    assert.ok(cookie, 'cookie sesi harus ada');

    const mulai = await panggil('/api/token/2fa/mulai', { method: 'POST', cookie, body: {} });
    assert.equal(mulai.status, 200, mulai.teks.slice(0, 200));

    const { buatTotp } = await import('../src/totp.mjs');
    const selesai = await panggil('/api/token/2fa/selesai', {
      method: 'POST', cookie, body: { code: buatTotp(mulai.data.secret) },
    });
    assert.equal(selesai.status, 200, selesai.teks.slice(0, 200));
  });

  test('hapus-mulai TANPA kode 2FA → 403 perlu_2fa', async () => {
    const r = await panggil('/api/auth/akun/hapus-mulai', { method: 'POST', cookie, turnstile: false, body: {} });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'perlu_2fa');
    assert.ok(r.data.email_samar, 'email disamarkan ikut dikirim');
  });

  test('hapus-mulai dengan kode 2FA SALAH → 401', async () => {
    const r = await panggil('/api/auth/akun/hapus-mulai', {
      method: 'POST', cookie, turnstile: false, body: { kode_2fa: '000000' },
    });
    assert.equal(r.status, 401);
    assert.equal(r.data.ok, false);
  });

  test('hapus-mulai dengan kode 2FA BENAR → 200 (kode email dikirim)', async () => {
    kodeTerakhir = await kodeTotp(EMAIL);
    const r = await panggil('/api/auth/akun/hapus-mulai', {
      method: 'POST', cookie, turnstile: false, body: { kode_2fa: kodeTerakhir },
    });
    assert.equal(r.status, 200, r.teks.slice(0, 250));
    assert.equal(r.data.ok, true);
  });

  test('hapus TANPA kode 2FA → 403 perlu_2fa (gerbang diperiksa di endpoint ini juga)', async () => {
    // Kode email diambil dari log server. Formatnya dari email.mjs —
    // jalur cadangan yang aktif saat SMTP tidak dikonfigurasi (seperti di tes):
    //   [email] CADANGAN kode-hapus-akun untuk <email>: KODE HAPUS AKUN → 123456
    const teksLog = bacaLog();
    const m = teksLog.match(/CADANGAN kode-hapus-akun untuk hapus-tfa@perusahaan\.co\.id: KODE HAPUS AKUN → (\d{6})/);
    assert.ok(m, `kode email harus tercatat di log. Log:\n${teksLog.slice(-600)}`);
    const kodeEmail = m[1];

    const r = await panggil('/api/auth/akun/hapus', {
      method: 'POST', cookie, turnstile: false,
      body: { kode: kodeEmail },
    });
    assert.equal(r.status, 403, 'tanpa kode 2FA harus ditolak walau kode email benar');
    assert.equal(r.data.error, 'perlu_2fa');
  });

  test('hapus dengan kode email + kode 2FA BENAR → akun dinonaktifkan', async () => {
    const m = bacaLog().match(/CADANGAN kode-hapus-akun untuk hapus-tfa@perusahaan\.co\.id: KODE HAPUS AKUN → (\d{6})/);
    assert.ok(m, 'kode email harus ada di log');
    const kodeEmail = m[1];

    // ── KODE 2FA YANG SAMA, BUKAN YANG BARU ─────────────────────────────────
    // Di UI, pengguna mengetik kode 2FA SEKALI di langkah pertama dan nilainya
    // masih ada di kotak saat menekan "Hapus permanen" — jadi endpoint kedua
    // menerima kode yang PERSIS sama.
    //
    // Menghitung kode baru untuk langkah waktu berikutnya justru gagal, dan
    // itu benar: `verifikasiTotp` hanya menerima jendela ±1 langkah, sementara
    // langkah_terakhir sudah maju. Yang salah bukan backend-nya — kode yang
    // belum waktunya memang tidak boleh diterima.
    //
    // Kode disimpan di variabel saat pertama dipakai supaya tes ini mengikuti
    // perilaku UI yang sebenarnya.
    const kode2fa = kodeTerakhir;

    const r = await panggil('/api/auth/akun/hapus', {
      method: 'POST', cookie, turnstile: false,
      body: { kode: kodeEmail, kode_2fa: kode2fa },
    });
    assert.equal(r.status, 200, r.teks.slice(0, 250));
    assert.equal(r.data.ok, true);

    // Bukti akun sudah tidak aktif: login ditolak.
    const d = await db();
    const u = d.prepare('SELECT status FROM users WHERE email = ?').get(EMAIL);
    d.close();
    assert.notEqual(u?.status, 'aktif', 'status akun harus berubah dari aktif');
  });
});
