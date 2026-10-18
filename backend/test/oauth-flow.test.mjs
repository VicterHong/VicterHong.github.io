import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import { siapkanTabelPengguna, buatPengguna } from '../src/users.mjs';
import { siapkanTabelIdentitas } from '../src/auth-identities.mjs';
import { issueToken } from '../src/tokens.mjs';
import { alurOauthDariState, temukanAtauBuatPengguna, galatStatusOauth } from '../src/auth-routes.mjs';

const secretSebelumnya = config.secret;
const authRouteSource = readFileSync(fileURLToPath(new URL('../src/auth-routes.mjs', import.meta.url)), 'utf8');
const authUiSource = readFileSync(fileURLToPath(new URL('../../assets/js/auth.js', import.meta.url)), 'utf8');
openDb(':memory:');
siapkanTabelPengguna();
siapkanTabelIdentitas();
config.secret = 'synthetic-oauth-flow-test-secret-never-use-in-production';
after(() => {
  closeDb();
  config.secret = secretSebelumnya;
});

test('status akun nonaktif tidak pernah diberi sesi OAuth', () => {
  assert.equal(galatStatusOauth({ status: 'aktif' }), '');
  assert.equal(galatStatusOauth({ status: 'nonaktif' }), 'akun_nonaktif');
  assert.equal(galatStatusOauth({ status: 'menunggu_hapus' }), 'akun_menunggu_hapus');
  assert.equal(galatStatusOauth(null), 'akun_nonaktif');
  assert.match(authUiSource, /akun_nonaktif:\s*['"]/);
  assert.match(authUiSource, /akun_menunggu_hapus:\s*['"]/);
});

test('OAuth dan SSO menolak status nonaktif sebelum membuat sesi', () => {
  const providerStart = authRouteSource.indexOf('const tangani = async');
  const providerEnd = authRouteSource.indexOf('function bacaFormUrlEncoded', providerStart);
  const providerCallback = authRouteSource.slice(providerStart, providerEnd);
  const providerGuard = providerCallback.indexOf('galatStatusOauth(hasil.pengguna)');
  const providerSession = providerCallback.indexOf('buatSesiUntuk(');
  assert.ok(providerGuard >= 0 && providerGuard < providerSession, 'provider OAuth harus memeriksa status sebelum sesi');

  const ssoStart = authRouteSource.indexOf("pattern: '/api/auth/sso/callback'");
  const ssoEnd = authRouteSource.indexOf('// ══ RIWAYAT PEMBELIAN', ssoStart);
  const ssoCallback = authRouteSource.slice(ssoStart, ssoEnd);
  const ssoGuard = ssoCallback.indexOf('galatStatusOauth(hasil.pengguna)');
  const ssoSession = ssoCallback.indexOf('buatSesiUntuk(');
  assert.ok(ssoGuard >= 0 && ssoGuard < ssoSession, 'SSO harus memeriksa status sebelum sesi');
});

test('state OAuth membedakan sign-in dari sign-up dan menolak provider mismatch', () => {
  assert.equal(alurOauthDariState('google', 'google'), 'signin');
  assert.equal(alurOauthDariState('google', 'google:signup'), 'signup');
  assert.equal(alurOauthDariState('google', 'github:signup'), '');
});

test('OAuth tidak menyambungkan provider baru ke akun nonaktif', async () => {
  const email = 'disabled-oauth-fixture@example.invalid';
  const token = issueToken({
    secret: config.secret,
    projectSlug: 'mina',
    label: 'Disabled OAuth fixture',
    issuedTo: email,
    issuedBy: 'test',
    tier: 'standard',
  });
  const user = await buatPengguna({
    email, nama: 'Disabled Fixture', perusahaan: '', sandi: 'Synthetic-test-password-987!', tokenId: token.id,
  });
  getDb().prepare("UPDATE users SET status = 'nonaktif' WHERE id = ?").run(user.id);

  const hasil = await temukanAtauBuatPengguna({
    identitas: {
      providerUserId: 'new-provider-id-disabled-fixture',
      email,
      emailTerverifikasi: true,
      nama: 'Disabled Fixture',
      avatar: '',
    },
    provider: 'github',
    req: { headers: { 'user-agent': 'node-test' }, socket: { remoteAddress: '127.0.0.1' } },
    allowCreate: true,
  });

  assert.equal(hasil.pengguna.id, user.id);
  assert.equal(hasil.pengguna.status, 'nonaktif');
  assert.equal(hasil.disambungkan, false);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM auth_identities WHERE user_id = ?').get(user.id).n, 0);
});

test('identitas OAuth baru tidak membuat akun dari sign-in, tetapi boleh dari sign-up', async () => {
  const identitas = {
    providerUserId: 'oauth-user-fixture-001',
    email: 'oauth-fixture@example.invalid',
    emailTerverifikasi: true,
    nama: 'OAuth Fixture',
    avatar: '',
  };
  const req = { headers: { 'user-agent': 'node-test' }, socket: { remoteAddress: '127.0.0.1' } };
  const usersBefore = getDb().prepare('SELECT count(*) AS n FROM users').get().n;
  const tokensBefore = getDb().prepare('SELECT count(*) AS n FROM tokens').get().n;

  const login = await temukanAtauBuatPengguna({
    identitas, provider: 'google', req, allowCreate: false,
  });
  assert.equal(login.pengguna, null);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM users').get().n, usersBefore);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM tokens').get().n, tokensBefore);

  const daftar = await temukanAtauBuatPengguna({
    identitas, provider: 'google', req, allowCreate: true,
  });
  assert.ok(daftar.pengguna);
  assert.equal(daftar.dibuat, true);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM users').get().n, usersBefore + 1);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM auth_identities').get().n, 1);
});
