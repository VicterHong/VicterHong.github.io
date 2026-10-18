import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import { siapkanTabelPengguna } from '../src/users.mjs';
import { siapkanTabelIdentitas } from '../src/auth-identities.mjs';
import { alurOauthDariState, temukanAtauBuatPengguna } from '../src/auth-routes.mjs';

const secretSebelumnya = config.secret;
openDb(':memory:');
siapkanTabelPengguna();
siapkanTabelIdentitas();
config.secret = 'synthetic-oauth-flow-test-secret-never-use-in-production';
after(() => {
  closeDb();
  config.secret = secretSebelumnya;
});

test('state OAuth membedakan sign-in dari sign-up dan menolak provider mismatch', () => {
  assert.equal(alurOauthDariState('google', 'google'), 'signin');
  assert.equal(alurOauthDariState('google', 'google:signup'), 'signup');
  assert.equal(alurOauthDariState('google', 'github:signup'), '');
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

  const login = await temukanAtauBuatPengguna({
    identitas, provider: 'google', req, allowCreate: false,
  });
  assert.equal(login.pengguna, null);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM users').get().n, 0);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM tokens').get().n, 0);

  const daftar = await temukanAtauBuatPengguna({
    identitas, provider: 'google', req, allowCreate: true,
  });
  assert.ok(daftar.pengguna);
  assert.equal(daftar.dibuat, true);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM auth_identities').get().n, 1);
});
