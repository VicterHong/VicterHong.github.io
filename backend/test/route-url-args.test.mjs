/**
 * Test regresi: wrapper `safe()` HARUS meneruskan argumen `url`.
 *
 * Bug yang dicegah: wrapper hanya memanggil handler(req, res, params) tanpa
 * argumen ke-4 (url). Akibatnya semua handler yang membaca url.searchParams
 * (filter status/tier, limit, days, dll) menerima undefined dan diam-diam
 * mengabaikan filternya — filter di panel admin tampak tidak berfungsi.
 *
 * Jalankan: node --test test/route-url-args.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES = resolve(__dirname, '..', 'src', 'routes.mjs');
const source = readFileSync(ROUTES, 'utf8');

test('wrapper safe() menerima argumen url', () => {
  // Cari definisi wrapper.
  const match = source.match(/function safe\(handler\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'wrapper safe() harus ada');

  const body = match[0];
  assert.ok(
    /return async \(req, res, params, url\)/.test(body),
    'wrapper harus menerima parameter `url` (argumen ke-4)',
  );
  assert.ok(
    /handler\(req, res, params, url\)/.test(body),
    'wrapper harus MENERUSKAN `url` ke handler',
  );
});

test('server.mjs mengirim 4 argumen ke handler', () => {
  const serverSrc = readFileSync(resolve(__dirname, '..', 'src', 'server.mjs'), 'utf8');
  assert.ok(
    /handler\(req, res, match\.params, url\)/.test(serverSrc),
    'server harus memanggil handler dengan (req, res, params, url)',
  );
});

test('handler yang memakai url.searchParams jumlahnya banyak (sanity)', () => {
  const count = (source.match(/url\?\.searchParams|url\.searchParams/g) ?? []).length;
  assert.ok(count >= 10, `harus ada ≥10 penggunaan url.searchParams, ditemukan ${count}`);
});

test('semua handler dibungkus safe() — tidak ada yang telanjang', () => {
  // Setiap `handler:` harus diikuti `safe(`.
  const handlerDefs = [...source.matchAll(/handler:\s*([a-zA-Z_$][\w$]*)?\s*\(/g)];
  const unsafe = handlerDefs.filter(m => m[1] !== 'safe');
  assert.equal(unsafe.length, 0, `ada ${unsafe.length} handler tanpa safe()`);
});
