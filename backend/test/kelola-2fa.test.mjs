/**
 * Kelola 2FA dari halaman Keamanan: status, kode pemulihan baru, nonaktifkan.
 *
 * Pola korporat (GitHub, Google, Microsoft): pengguna yang SUDAH login tetap
 * harus membuktikan faktor kedua sebelum mematikan 2FA atau membuat kode
 * pemulihan baru, dan kedua aksi itu tercatat di riwayat aktivitas.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import { siapkanTabelPengguna, buatPengguna } from '../src/users.mjs';
import { issueToken } from '../src/tokens.mjs';
import { createSession } from '../src/sessions.mjs';
import { initRoutes, resolveRoute } from '../src/routes.mjs';
import { mulaiEnrollment, selesaikanEnrollment, statusTotp } from '../src/totp-service.mjs';
import { buatTotp } from '../src/totp.mjs';

const secretSemula = config.secret;
openDb(':memory:');
config.secret = 'kelola-2fa-test-secret-panjang';
try { siapkanTabelPengguna(); } catch { /* sudah dibuat openDb */ }
initRoutes();
after(() => { closeDb(); config.secret = secretSemula; });

async function panggil(pattern, method, { body = {}, cookie = '' } = {}) {
  const cocok = resolveRoute(method, pattern);
  assert.ok(cocok?.route, `rute ${method} ${pattern} harus terdaftar`);
  const hasil = { status: 0, body: null };
  const req = {
    method, url: pattern,
    headers: { 'content-type': 'application/json', 'user-agent': 'node-test', cookie },
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, cb) { if (ev === 'data') cb(Buffer.from(JSON.stringify(body))); if (ev === 'end') cb(); return this; },
  };
  const res = {
    setHeader() {}, writeHead(k) { hasil.status = k; },
    end(isi = '') { if (!hasil.body) { try { hasil.body = JSON.parse(String(isi)); } catch { hasil.body = String(isi); } } },
  };
  await cocok.route.handler(req, res, cocok.params, new URL(pattern, 'https://example.invalid'));
  return hasil;
}

let n = 0;
async function akunDengan2fa() {
  const email = `kelola${++n}@contoh.invalid`;
  const token = issueToken({ secret: config.secret, projectSlug: 'mina', label: email, issuedTo: email, issuedBy: 'test', tier: 'standard' });
  await buatPengguna({ email, nama: 'Akun Uji', perusahaan: '', sandi: 'Sandi-uji-yang-kuat-987!', tokenId: token.id });
  const sesi = createSession({ tokenId: token.id, secret: config.secret });
  const mulai = mulaiEnrollment(email, config);
  const selesai = selesaikanEnrollment(email, buatTotp(mulai.secret), config);
  assert.ok(selesai.ok);
  return { email, tokenId: token.id, secret: mulai.secret, pemulihan: selesai.kode_pemulihan, cookie: `portfolio_session=${sesi.id}` };
}

const aksiTercatat = (tokenId) => getDb().prepare('SELECT action FROM access_events WHERE token_id = ?').all(tokenId).map((r) => r.action);

test('status 2FA mengirim tanggal aktif dan sisa kode pemulihan', async () => {
  const a = await akunDengan2fa();
  const r = await panggil('/api/auth/2fa/status', 'GET', { cookie: a.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.aktif, true);
  assert.equal(typeof r.body.dibuat_pada, 'number', 'tanggal aktif tidak boleh null');
  assert.equal(r.body.kode_pemulihan_tersisa, 8);
});

test('nonaktifkan 2FA: kode salah ditolak, 2FA tetap aktif', async () => {
  const a = await akunDengan2fa();
  const r = await panggil('/api/token/2fa/cabut', 'POST', { cookie: a.cookie, body: { code: '000000' } });
  assert.equal(r.status, 401);
  assert.equal(statusTotp(a.email).aktif, true);
});

test('nonaktifkan 2FA dengan kode authenticator: mati dan tercatat', async () => {
  const a = await akunDengan2fa();
  const r = await panggil('/api/token/2fa/cabut', 'POST', { cookie: a.cookie, body: { code: buatTotp(a.secret) } });
  assert.equal(r.status, 200);
  assert.equal(statusTotp(a.email).aktif, false);
  assert.ok(aksiTercatat(a.tokenId).includes('totp_nonaktif'));
});

test('nonaktifkan 2FA dengan kode pemulihan (ponsel hilang) juga bisa', async () => {
  const a = await akunDengan2fa();
  const r = await panggil('/api/token/2fa/cabut', 'POST', { cookie: a.cookie, body: { code: a.pemulihan[0] } });
  assert.equal(r.status, 200);
  assert.equal(statusTotp(a.email).aktif, false);
});

test('kode pemulihan baru: kode lama mati, aksi tercatat', async () => {
  const a = await akunDengan2fa();
  const r = await panggil('/api/token/2fa/pulihkan', 'POST', { cookie: a.cookie, body: { code: buatTotp(a.secret) } });
  assert.equal(r.status, 200);
  assert.equal(r.body.kode_pemulihan.length, 8);
  assert.ok(!r.body.kode_pemulihan.includes(a.pemulihan[0]));
  assert.ok(aksiTercatat(a.tokenId).includes('totp_kode_pemulihan_baru'));
});

test('aksi 2FA baru tampil di riwayat aktivitas dengan label manusiawi', () => {
  const be = readFileSync(new URL('../src/auth-routes.mjs', import.meta.url), 'utf8');
  const fe = readFileSync(new URL('../../assets/js/keamanan.js', import.meta.url), 'utf8');
  for (const aksi of ['totp_nonaktif', 'totp_kode_pemulihan_baru']) {
    assert.match(be, new RegExp(`'${aksi}'`), `${aksi} harus masuk daftar putih aktivitas`);
    assert.match(fe, new RegExp(`${aksi}:\\s*'`), `${aksi} harus punya label`);
  }
});

test('halaman Keamanan punya dialog kelola, bukan membuka ulang aktivasi', () => {
  const html = readFileSync(new URL('../../keamanan.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../assets/js/keamanan.js', import.meta.url), 'utf8');
  assert.match(html, /id="kamDialogKelola2fa"/);
  assert.match(html, /id="kamNonaktif2fa"/);
  assert.match(html, /id="kamKodeBaru2fa"/);
  assert.match(js, /\/api\/token\/2fa\/cabut/);
  assert.match(js, /\/api\/token\/2fa\/pulihkan/);
});
