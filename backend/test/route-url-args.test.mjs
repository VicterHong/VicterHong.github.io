/**
 * Test regresi: wrapper `safe()` HARUS meneruskan argumen `url`.
 *
 * Bug yang dicegah: wrapper hanya memanggil handler(req, res, params) tanpa
 * argumen ke-4 (url). Akibatnya semua handler yang membaca url.searchParams
 * (filter status/tier, limit, days, dll) menerima undefined dan diam-diam
 * mengabaikan filternya — filter di panel admin tampak tidak berfungsi.
 *
 * ── PERPINDAHAN KE http-util.mjs ────────────────────────────────────────────
 * safe() dulu didefinisikan di routes.mjs. Sekarang tinggal di http-util.mjs
 * supaya auth-routes.mjs memakai implementasi yang SAMA (sebelumnya 30
 * handler auth tanpa pelindung; error server di sana dilaporkan sebagai
 * HTTP 400 "permintaan_tidak_valid").
 *
 * Tes ini menguji SUMBER di lokasi baru, dan menambahkan verifikasi bahwa
 * routes.mjs TIDAK lagi punya salinan lokal (dua definisi bisa menyimpang).
 *
 * Jalankan: node --test test/route-url-args.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTTP_UTIL = resolve(__dirname, '..', 'src', 'http-util.mjs');
const ROUTES = resolve(__dirname, '..', 'src', 'routes.mjs');
const AUTH = resolve(__dirname, '..', 'src', 'auth-routes.mjs');

const sumberHttpUtil = readFileSync(HTTP_UTIL, 'utf8');
const sumberRoutes = readFileSync(ROUTES, 'utf8');
const sumberAuth = readFileSync(AUTH, 'utf8');

test('wrapper safe() menerima argumen url', () => {
  // Cari definisi wrapper di lokasi BARU (http-util.mjs).
  const match = sumberHttpUtil.match(/export function safe\(handler\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'wrapper safe() harus ada di http-util.mjs');

  const body = match[0];
  assert.ok(
    /async \(req, res, params, url\)/.test(body),
    'wrapper harus menerima parameter `url` (argumen ke-4)',
  );
  assert.ok(
    /handler\(req, res, params, url\)/.test(body),
    'wrapper harus MENERUSKAN `url` ke handler',
  );
});

test('routes.mjs TIDAK mendefinisikan safe() sendiri (satu sumber)', () => {
  // Kalau ada salinan lokal, perbaikan di http-util.mjs tidak akan terpakai
  // oleh routes.mjs — dan dua definisi bisa menyimpang seiring waktu.
  const lokal = /function safe\(handler\)/.test(sumberRoutes);
  assert.equal(
    lokal,
    false,
    'routes.mjs TIDAK boleh punya salinan lokal safe() — impor dari http-util.mjs',
  );

  // Tapi harus MENGIMPOR-nya.
  assert.ok(
    /import\s*\{[^}]*\bsafe\b[^}]*\}\s*from\s*'\.\/http-util\.mjs'/.test(sumberRoutes),
    'routes.mjs harus mengimpor safe() dari http-util.mjs',
  );
});

test('auth-routes.mjs memakai safe() dari http-util.mjs', () => {
  assert.ok(
    /import\s*\{[^}]*\bsafe\b[^}]*\}\s*from\s*'\.\/http-util\.mjs'/.test(sumberAuth),
    'auth-routes.mjs harus mengimpor safe() dari http-util.mjs',
  );
});

test('ruteAuth() membungkus SEMUA rute dengan safe()', () => {
  // Bukti struktural: ruteAuth harus memetakan daftar rutenya lewat safe().
  assert.ok(
    /return daftar\.map\(\(r\)\s*=>\s*\(\{\s*\.\.\.r,\s*handler:\s*safe\(r\.handler\)\s*\}\)\)/.test(sumberAuth),
    'ruteAuth() harus membungkus setiap rute: daftar.map((r) => ({ ...r, handler: safe(r.handler) }))',
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
  const count = (sumberRoutes.match(/url\?\.searchParams|url\.searchParams/g) ?? []).length;
  assert.ok(count >= 10, `harus ada ≥10 penggunaan url.searchParams, ditemukan ${count}`);
});

test('semua handler di routes.mjs dibungkus safe() — tidak ada yang telanjang', () => {
  // Setiap `handler:` harus diikuti `safe(`.
  const handlerDefs = [...sumberRoutes.matchAll(/handler:\s*([a-zA-Z_$][\w$]*)?\s*\(/g)];
  const unsafe = handlerDefs.filter(m => m[1] !== 'safe');
  assert.equal(unsafe.length, 0, `ada ${unsafe.length} handler tanpa safe()`);
});
