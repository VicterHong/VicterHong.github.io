import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb } from '../src/db.mjs';
import { config } from '../src/config.mjs';
import * as http from '../src/http-util.mjs';
import { initRoutes, resolveRoute } from '../src/routes.mjs';
openDb(':memory:');
initRoutes();
after(closeDb);

test('untrusted browser origins cannot mutate even when CORS would hide response', () => {
  assert.equal(typeof http.mutationAllowed, 'function');
  const good = config.allowedOrigins[0] || 'https://trusted.example.invalid';
  const previous = config.allowedOrigins;
  config.allowedOrigins = [good];
  try {
    for (const origin of ['https://evil.example', 'null', good + '.evil.example']) {
      assert.equal(http.mutationAllowed({ method: 'POST', headers: { origin, 'content-type': 'application/json' } }), false);
    }
    assert.equal(http.mutationAllowed({ method: 'POST', headers: { origin: good } }), true);
    assert.equal(http.mutationAllowed({ method: 'POST', headers: { cookie: 'portfolio_session=fixture', 'content-type': 'application/x-www-form-urlencoded' } }), false);
    assert.equal(http.mutationAllowed({ method: 'GET', headers: { origin: 'https://evil.example' } }), true);
    assert.equal(http.mutationAllowed({ method: 'POST', socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:8788', origin: 'http://localhost:8788', 'x-admin-key': 'fixture' } }), true);
  } finally { config.allowedOrigins = previous; }
});

test('internal experiment exposure and conversion deny anonymous requests', async () => {
  for (const [method, path] of [['GET', '/api/experiment/fixture'], ['POST', '/api/experiment/convert']]) {
    const resolved = resolveRoute(method, path);
    let status;
    const res = { setHeader() {}, writeHead(s) { status = s; }, end() {} };
    await resolved.route.handler({ method, url: path, headers: {}, socket: {} }, res, resolved.params, new URL(path, 'https://example.invalid'));
    assert.equal(status, 401, path);
  }
});
