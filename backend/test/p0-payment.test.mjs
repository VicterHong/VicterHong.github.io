import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDb, closeDb, getDb } from '../src/db.mjs';
import { siapkanTabelPengguna } from '../src/users.mjs';
import { config } from '../src/config.mjs';
import { prosesWebhook, mulaiPembayaran } from '../src/checkout.mjs';
openDb(':memory:');
siapkanTabelPengguna();
const realFetch = globalThis.fetch;
config.midtransServerKey = 'synthetic-midtrans-key-never-live';
config.midtransClientKey = 'synthetic-client';
config.brevoApiKey = config.resendApiKey = config.cfApiToken = '';
after(() => { globalThis.fetch = realFetch; closeDb(); });
let n = 0;
function fixture() {
  const id = `pay_p0_${++n}`;
  const email = `${id}@example.invalid`;
  getDb().prepare('INSERT INTO users (id,email,password_hash,token_id,dibuat_at) VALUES (?,?,?,?,?)').run(id, email, '', 'fixture', Date.now());
  getDb().prepare("INSERT INTO payments (id,idempotency_key,tier,periode,jumlah,email,status,dibuat_pada) VALUES (?,?,'standar','bulanan',200000,?,'pending',?)").run(id, `idempotency-${id}`, email, Date.now());
  return { id, email };
}
function payload(id, extra = {}) {
  const p = { order_id: id, status_code: '200', gross_amount: '200000.00', transaction_status: 'settlement', transaction_id: `trx-${id}`, ...extra };
  p.signature_key = createHash('sha512').update(`${p.order_id}${p.status_code}${p.gross_amount}${config.midtransServerKey}`).digest('hex');
  return p;
}
function provider(p) {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/api(?:\.sandbox)?\.midtrans\.com\/v2\//);
    return new Response(JSON.stringify(p), { status: 200 });
  };
}
const count = (id) => getDb().prepare('SELECT COUNT(*) n FROM tokens WHERE issued_to=?').get(id).n;

test('valid signature alone cannot activate without server status confirmation', async () => {
  const a = fixture();
  const p = payload(a.id);
  provider({ ...p, transaction_status: 'pending' });
  await prosesWebhook(JSON.stringify(p));
  assert.equal(count(a.email), 0);
});

test('parallel signed webhooks activate exactly one token and subscription', async () => {
  const a = fixture(); const p = payload(a.id); provider(p);
  const r = await Promise.all(Array.from({ length: 6 }, () => prosesWebhook(JSON.stringify(p))));
  assert.ok(r.every(x => x.statusCode === 200));
  assert.equal(count(a.email), 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM langganan WHERE payment_id=?').get(a.id).n, 1);
});

test('activation failure rolls token and payment back, then retry recovers', async () => {
  const a = fixture(); const p = payload(a.id); provider(p);
  getDb().exec("CREATE TEMP TRIGGER crash_activation BEFORE INSERT ON langganan BEGIN SELECT RAISE(ABORT,'synthetic-crash'); END");
  let failed;
  try { failed = await prosesWebhook(JSON.stringify(p)); }
  finally { getDb().exec('DROP TRIGGER crash_activation'); }
  assert.equal(failed.statusCode, 503);
  assert.equal(count(a.email), 0);
  assert.equal(getDb().prepare('SELECT status FROM payments WHERE id=?').get(a.id).status, 'pending');
  assert.equal((await prosesWebhook(JSON.stringify(p))).statusCode, 200);
  assert.equal(count(a.email), 1);
});

test('status API outage is retryable and event storage excludes signatures', async () => {
  const a = fixture(); const p = payload(a.id);
  globalThis.fetch = async () => { throw new Error('synthetic provider outage'); };
  const result = await prosesWebhook(JSON.stringify(p));
  assert.equal(result.statusCode, 503);
  assert.equal(count(a.email), 0);
  const stored = getDb().prepare('SELECT body_mentah FROM payment_events WHERE event_id LIKE ?').all(`${a.id}:%`);
  assert.ok(stored.every(x => !x.body_mentah.includes(p.signature_key)));
});

test('refund followed by settlement cannot resurrect or issue a second token', async () => {
  const a = fixture(); const paid = payload(a.id); provider(paid);
  await prosesWebhook(JSON.stringify(paid));
  const refund = payload(a.id, { transaction_status: 'refund' }); provider(refund);
  await prosesWebhook(JSON.stringify(refund));
  const late = payload(a.id, { transaction_id: 'late-settlement' }); provider(late);
  await prosesWebhook(JSON.stringify(late));
  assert.equal(count(a.email), 1);
  assert.equal(getDb().prepare('SELECT status FROM payments WHERE id=?').get(a.id).status, 'dikembalikan');
});

test('checkout idempotency cannot read another account payment URL', async () => {
  const a = fixture();
  getDb().prepare('UPDATE payments SET payment_url=?,kedaluwarsa_pada=? WHERE id=?').run('https://example.invalid/private-payment', Date.now() + 60000, a.id);
  await assert.rejects(() => mulaiPembayaran({ tier: 'standar', periode: 'bulanan', email: 'other@example.invalid', idempotencyKey: `idempotency-${a.id}` }), e => e.statusCode === 409);
});

test('a previously confirmed pending event cannot swallow later settlement', async () => {
  const a = fixture(); const p = payload(a.id);
  provider({ ...p, transaction_status: 'pending' });
  await prosesWebhook(JSON.stringify(p));
  provider(p);
  await prosesWebhook(JSON.stringify(p));
  assert.equal(count(a.email), 1);
});

test('invalid signature is rejected before network or entitlement writes', async () => {
  const a = fixture(); const p = payload(a.id); p.signature_key = 'invalid';
  globalThis.fetch = async () => { throw new Error('must not call provider'); };
  assert.equal((await prosesWebhook(JSON.stringify(p))).statusCode, 401);
  assert.equal(count(a.email), 0);
});

test('wrong signed amount including fractional rounding never activates', async () => {
  for (const gross_amount of ['199999.60', '199999.00', 'NaN']) {
    const a = fixture(); const p = payload(a.id, { gross_amount }); provider(p);
    assert.equal((await prosesWebhook(JSON.stringify(p))).statusCode, 503);
    assert.equal(count(a.email), 0);
  }
});

test('ambiguous Snap timeout reserves request and never makes a second transaction', async () => {
  let posts = 0;
  globalThis.fetch = async () => { posts++; throw new Error('synthetic timeout'); };
  const params = { tier: 'standar', periode: 'bulanan', email: 'timeout@example.invalid', idempotencyKey: 'snap-timeout-idempotency-key' };
  await assert.rejects(() => mulaiPembayaran(params));
  await assert.rejects(() => mulaiPembayaran(params), e => e.statusCode === 409);
  assert.equal(posts, 1);
});
