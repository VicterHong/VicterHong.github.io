import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { siapkanTabelPengguna } from '../src/users.mjs';
import { config } from '../src/config.mjs';
import { issueToken, findTokenByPlaintext } from '../src/tokens.mjs';
import { createSession } from '../src/sessions.mjs';
import { ruteKlien } from '../src/klien-routes.mjs';
import { periksaAksesMetrik } from '../src/akses-proyek.mjs';
import { initRoutes, resolveRoute } from '../src/routes.mjs';

openDb(':memory:');
siapkanTabelPengguna();
initRoutes();
// CI deliberately has no production service.env; tests must use an explicit fixture secret.
config.secret = 'synthetic-p0-test-secret-never-use-in-production';
const contentDir = mkdtempSync(join(tmpdir(), 'p0-content-'));
config.contentDir = contentDir;
after(() => { closeDb(); rmSync(contentDir, { recursive: true, force: true }); });
let sequence = 0;
function account() {
  const id = `p0-${++sequence}`;
  const email = `${id}@example.invalid`;
  const token = issueToken({ secret: config.secret, projectSlug: 'mina', issuedTo: email });
  getDb().prepare('INSERT INTO users (id,email,password_hash,token_id,dibuat_at) VALUES (?,?,?,?,?)')
    .run(id, email, 'not-a-password', token.id, Date.now());
  getDb().prepare("INSERT INTO langganan (id,user_id,paket,periode,mulai_at,status,dibuat_at) VALUES (?,?,'standar','bulanan',?,'aktif',?)")
    .run(id, id, Date.now(), Date.now());
  const session = createSession({ tokenId: token.id, secret: config.secret });
  return { id, email, cookie: `portfolio_session=${session.id}` };
}
async function call(a, path, body) {
  const method = body === undefined ? 'GET' : 'POST';
  const params = {};
  const route = ruteKlien().find(r => {
    if (r.method !== method) return false;
    const match = path.match(new RegExp('^' + r.pattern.replace(':slug', '([^/]+)') + '$'));
    if (match?.[1]) params.slug = match[1];
    return Boolean(match);
  });
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url: path, headers: { cookie: a.cookie }, socket: { remoteAddress: '127.0.0.1' } });
  let status, data;
  const res = { setHeader() {}, writeHead(s) { status = s; }, end(b) { data = JSON.parse(b); } };
  await route.handler(req, res, params, new URL(path, 'https://example.invalid'));
  return { status, data };
}

test('issued client token is usable by the canonical verifier, scoped and expiring', async () => {
  const a = account();
  const r = await call(a, '/api/klien/token', { idempotencyKey: 'p0-token-verification-1' });
  assert.equal(r.status, 201);
  const token = findTokenByPlaintext(r.data.token, config.secret);
  assert.ok(token, 'route must store the canonical salted hash');
  assert.ok(token.expires_at > Date.now());
  assert.ok(token.scopes.includes('mina'), 'all-project token needs actual project scopes');
});

test('parallel issuance cannot exceed the single-token quota', async () => {
  const a = account();
  const result = await Promise.all(Array.from({ length: 8 }, (_, i) => call(a, '/api/klien/token', { idempotencyKey: `parallel-token-${i}-unique` })));
  assert.equal(result.filter(r => r.status === 201).length, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM tokens WHERE issued_to=? AND issued_by='klien'").get(a.email).n, 1);
});

test('retry of the same token request never consumes another quota', async () => {
  const a = account();
  getDb().prepare("UPDATE langganan SET paket='profesional' WHERE user_id=?").run(a.id);
  const body = { idempotencyKey: 'retry-token-request-key-1' };
  assert.equal((await call(a, '/api/klien/token', body)).status, 201);
  const retry = await call(a, '/api/klien/token', body);
  assert.equal(retry.status, 409);
  assert.equal(retry.data.error, 'token_sudah_dibuat');
  assert.equal(getDb().prepare('SELECT terpakai FROM kuota_token WHERE user_id=?').get(a.id).terpakai, 1);
});

test('failure recording metric consumption does not grant unrecorded access', () => {
  const a = account();
  getDb().prepare('DELETE FROM langganan WHERE user_id=?').run(a.id);
  getDb().exec("CREATE TEMP TRIGGER reject_metric BEFORE INSERT ON metrik_terbuka BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  try { assert.throws(() => periksaAksesMetrik(a.id, 'mina'), /synthetic failure/); }
  finally { getDb().exec('DROP TRIGGER reject_metric'); }
});

test('new username-only star claim fails closed before contacting GitHub', async () => {
  const a = account();
  const previous = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw new Error('network must not be reached'); };
  try {
    const result = await call(a, '/api/klien/star', { username: 'somebody-else' });
    assert.equal(result.status, 403);
    assert.equal(result.data.error, 'identitas_github_belum_terverifikasi');
    assert.equal(network, 0);
  } finally { globalThis.fetch = previous; }
});

test('a shareable project token does not impersonate the issuing account', async () => {
  const a = account();
  const shared = issueToken({ secret: config.secret, projectSlug: 'mina', issuedTo: a.email, issuedBy: 'klien' });
  const s = createSession({ tokenId: shared.id, secret: config.secret });
  const result = await call({ cookie: `portfolio_session=${s.id}` }, '/api/klien/ringkasan');
  assert.equal(result.status, 401);
});

test('a free canonical login token is not a paid internal-content entitlement', async () => {
  const a = account();
  getDb().prepare('DELETE FROM langganan WHERE user_id=?').run(a.id);
  const resolved = resolveRoute('GET', '/api/project/mina/locked');
  let status;
  const previous = config.contentDir;
  config.contentDir = '/nonexistent/p0-isolated-content';
  try {
    await resolved.route.handler({ method: 'GET', headers: { cookie: a.cookie }, socket: {} },
      { setHeader() {}, writeHead(s) { status = s; }, end() {} }, resolved.params);
    assert.equal(status, 403);
  } finally { config.contentDir = previous; }
});

test('GET cannot spend quota; explicit POST opens the entitled presentation subset', async () => {
  const a = account();
  getDb().prepare('DELETE FROM langganan WHERE user_id=?').run(a.id);
  writeFileSync(join(contentDir, 'presentation.json'), JSON.stringify({ mina: { metrics: [{ label: 'synthetic', value: '7' }], highlights: [] } }));
  const denied = await call(a, '/api/klien/proyek/mina/metrik');
  assert.equal(denied.status, 403);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM metrik_terbuka WHERE user_id=?').get(a.id).n, 0);
  const opened = await call(a, '/api/klien/proyek/mina/metrik', {});
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.data.metrik, [{ label: 'synthetic', value: '7' }]);
  assert.equal((await call(a, '/api/klien/proyek/mina/metrik')).status, 200);
});
