/**
 * Tes perilaku: /api/auth/2fa menolak akun nonaktif.
 *
 * ── KENAPA TES INI ADA, PADAHAL SUDAH ADA TES SUMBER ────────────────────────
 * `akun-nonaktif-blokir.test.mjs` memeriksa URUTAN baris di sumber. Itu
 * menangkap jalur yang lupa memeriksa status, tapi tidak membuktikan
 * handler-nya benar-benar menolak. Tes ini memanggil handler langsung dengan
 * database di memori dan memastikan:
 *
 *   • akun 'menunggu_hapus'  → 403 menunggu_hapus, TANPA cookie sesi
 *   • akun 'nonaktif'        → 403 akun_nonaktif, TANPA cookie sesi
 *   • akun 'aktif'           → tetap bisa lanjut (kontrol negatif)
 *
 * Tanpa kontrol negatif, tes bisa lulus hanya karena handler selalu menolak.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import { siapkanTabelPengguna, buatPengguna } from '../src/users.mjs';
import { issueToken } from '../src/tokens.mjs';
import { initRoutes, resolveRoute } from '../src/routes.mjs';
import { TEST_SECRET_ALWAYS_PASS } from '../src/turnstile.mjs';
import { mulaiEnrollment, selesaikanEnrollment } from '../src/totp-service.mjs';
import { buatTotp } from '../src/totp.mjs';

const secretSemula = config.secret;
const turnstileSemula = config.turnstileSecretKey;
const fetchSemula = globalThis.fetch;

openDb(':memory:');
config.secret = 'synthetic-status-gate-test-secret';
// Turnstile memakai SECRET UJI resmi Cloudflare ("selalu lolos"), dan panggilan
// jaringannya di-stub. Tanpa ini, gerbang Turnstile menolak lebih dulu
// (503 secret_kosong) dan tes tidak pernah mencapai gerbang status akun —
// tes akan hijau karena alasan yang salah.
config.turnstileSecretKey = TEST_SECRET_ALWAYS_PASS;
config.turnstileHostnames = [];
globalThis.fetch = async () => new Response(
  JSON.stringify({ success: true, hostname: 'example.com', action: '' }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);
initRoutes();

after(() => {
  closeDb();
  config.secret = secretSemula;
  config.turnstileSecretKey = turnstileSemula;
  globalThis.fetch = fetchSemula;
});

/** Panggil handler rute dengan body JSON dan tangkap status + header. */
async function panggil(pattern, method, body) {
  const cocok = resolveRoute(method, pattern);
  assert.ok(cocok?.route, `rute ${method} ${pattern} harus terdaftar`);

  const hasil = { status: 0, body: null, headers: {} };
  const req = {
    method,
    url: pattern,
    headers: { 'content-type': 'application/json', 'user-agent': 'node-test' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
      if (event === 'end') cb();
      return this;
    },
  };
  const res = {
    setHeader(nama, nilai) { hasil.headers[nama.toLowerCase()] = nilai; },
    writeHead(kode, headers) {
      hasil.status = kode;
      for (const [k, v] of Object.entries(headers || {})) hasil.headers[k.toLowerCase()] = v;
    },
    end(isi = '') {
      if (!hasil.body) {
        try { hasil.body = JSON.parse(String(isi)); } catch { hasil.body = String(isi); }
      }
    },
  };

  await cocok.route.handler(req, res, cocok.params, new URL(pattern, 'https://example.invalid'));
  return hasil;
}

async function siapkanAkun(email, status) {
  const token = issueToken({
    secret: config.secret,
    projectSlug: 'mina',
    label: email,
    issuedTo: email,
    issuedBy: 'test',
    tier: 'standard',
  });
  const user = await buatPengguna({
    email, nama: 'Akun Uji', perusahaan: '', sandi: 'Sandi-uji-yang-kuat-987!', tokenId: token.id,
  });
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
  return user;
}

/**
 * Aktifkan TOTP untuk satu email.
 *
 * Tanpa ini, `/api/auth/2fa` menolak dengan `totp_tidak_aktif` sebelum
 * mencapai gerbang status akun — dan tes akan lulus karena alasan yang salah.
 */
function aktifkanTotp(email) {
  // mulaiEnrollment MELEMPAR galat kalau gagal (bukan mengembalikan {ok}).
  const mulai = mulaiEnrollment(email, config);
  const kode = buatTotp(mulai.secret);
  const selesai = selesaikanEnrollment(email, kode, config);
  assert.ok(selesai.ok, `enrollment harus selesai: ${selesai.pesan ?? ''}`);
  return mulai.secret;
}

for (const status of ['menunggu_hapus', 'nonaktif']) {
  test(`/api/auth/2fa menolak akun berstatus ${status} tanpa membuat sesi`, async () => {
    const email = `status-${status}@contoh.invalid`;
    const user = await siapkanAkun(email, status);
    if (status === 'menunggu_hapus') {
      getDb().prepare('UPDATE users SET dihapus_pada = ? WHERE id = ?').run(Date.now(), user.id);
    }
    // 2FA harus AKTIF: tanpa itu handler berhenti di `totp_tidak_aktif`
    // sebelum mencapai gerbang status yang sedang diuji.
    const secret = aktifkanTotp(email);

    const sesiSebelum = getDb().prepare('SELECT count(*) AS n FROM sessions').get().n;

    const hasil = await panggil('/api/auth/2fa', 'POST', {
      email,
      sandi: 'Sandi-uji-yang-kuat-987!',
      code: buatTotp(secret),
      'cf-turnstile-response': 'token-uji',
    });
    assert.ok(
      hasil.body?.error === 'akun_nonaktif' || hasil.body?.error === 'menunggu_hapus',
      `kode galat harus menyebut status akun, dapat: ${hasil.body?.error}`,
    );
    assert.equal(hasil.status, 403, `status harus 403, dapat ${hasil.status}`);

    // Yang paling penting: TIDAK ada cookie sesi yang dipasang.
    const setCookie = String(hasil.headers['set-cookie'] ?? '');
    assert.equal(
      setCookie.includes('portfolio_session=') && !setCookie.includes('portfolio_session=;'),
      false,
      'akun nonaktif tidak boleh menerima cookie sesi',
    );

    const sesiSesudah = getDb().prepare('SELECT count(*) AS n FROM sessions').get().n;
    assert.equal(sesiSesudah, sesiSebelum, 'tidak boleh ada baris sesi baru');
  });
}

test('kontrol negatif: akun AKTIF tidak ditolak oleh gerbang status', async () => {
  const email = 'status-aktif@contoh.invalid';
  await siapkanAkun(email, 'aktif');

  const hasil = await panggil('/api/auth/2fa', 'POST', {
    email,
    sandi: 'Sandi-uji-yang-kuat-987!',
    code: '123456',
    'cf-turnstile-response': 'token-uji',
  });

  // Akun aktif TIDAK boleh ditolak dengan kode status akun. Ia akan gagal di
  // verifikasi 2FA (akun ini tidak punya TOTP aktif), dan itu hasil yang benar.
  assert.notEqual(hasil.body?.error, 'akun_nonaktif');
  assert.notEqual(hasil.body?.error, 'menunggu_hapus');
});
