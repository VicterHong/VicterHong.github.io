import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ruteAuth } from '../src/auth-routes.mjs';

const navSource = readFileSync(
  fileURLToPath(new URL('../../assets/js/nav-akun.js', import.meta.url)),
  'utf8',
);

test('menu akun tidak menampilkan metadata tier atau masa berlaku token', () => {
  assert.doesNotMatch(navSource, /api\/auth\/token-saya/);
  assert.doesNotMatch(navSource, /navAkunBadge|nav-akun-badge/);
  assert.doesNotMatch(navSource, /kedaluwarsa|\.tier\b/);
});

test('endpoint metadata token menolak permintaan tanpa sesi', async () => {
  const route = ruteAuth().find((item) => item.pattern === '/api/auth/token-saya');
  assert.ok(route, 'rute token-saya harus terdaftar');

  let status = 0;
  let body = '';
  const res = {
    setHeader() {},
    writeHead(code) { status = code; },
    end(value = '') { body = String(value); },
  };
  await route.handler({ method: 'GET', headers: {}, socket: {} }, res, {}, new URL('https://example.invalid/api/auth/token-saya'));

  assert.equal(status, 401);
  assert.match(body, /belum_masuk/);
});
