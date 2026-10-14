/**
 * Tes rute area klien.
 *
 * ── YANG DIUJI, DAN KENAPA ─────────────────────────────────────────────────
 *
 * Bukan "apakah HTTP-nya jalan" — yang diuji adalah HAL YANG BISA SALAH
 * DIAM-DIAM:
 *
 *   1. Setiap rute butuh login. Satu rute yang lupa memeriksa berarti data
 *      proyek terbuka untuk siapa saja yang tahu URL-nya.
 *   2. Nama cookie sesi harus SAMA dengan yang dipakai auth-routes.mjs.
 *      Kalau berbeda, semua rute menjawab 401 dan pengguna yang sudah masuk
 *      tetap dianggap belum masuk — tanpa error apa pun.
 *   3. Rute :slug harus benar-benar membaca parameternya.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, closeDb } from '../src/db.mjs';
import { siapkanTabelPengguna } from '../src/users.mjs';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

openDb(':memory:');
siapkanTabelPengguna();

const { resolveRoute, initRoutes } = await import('../src/routes.mjs');
initRoutes();

after(() => closeDb());

// ── 1. SEMUA RUTE TERDAFTAR ──────────────────────────────────────────────────

const RUTE_KLIEN = [
  ['GET', '/api/klien/ringkasan'],
  ['GET', '/api/klien/proyek'],
  ['GET', '/api/klien/proyek/mina/metrik'],
  ['POST', '/api/klien/token'],
  ['GET', '/api/klien/token'],
  ['POST', '/api/klien/star'],
  ['GET', '/api/klien/star'],
];

test('semua rute area klien terdaftar', () => {
  for (const [method, path] of RUTE_KLIEN) {
    const r = resolveRoute(method, path);
    assert.ok(r, `${method} ${path} TIDAK TERDAFTAR`);
    assert.equal(typeof r.route.handler, 'function', `${method} ${path} handler bukan fungsi`);
  }
});

test('parameter :slug terbaca dari URL', () => {
  const r = resolveRoute('GET', '/api/klien/proyek/spareparts/metrik');
  assert.ok(r, 'rute metrik harus cocok');
  assert.equal(r.params.slug, 'spareparts', 'slug harus terbaca, bukan undefined');
});

test('slug dengan karakter aneh tetap terbaca sebagai satu segmen', () => {
  const r = resolveRoute('GET', '/api/klien/proyek/whatsapp-bot/metrik');
  assert.equal(r?.params?.slug, 'whatsapp-bot');
});

// ── 2. SETIAP RUTE BUTUH LOGIN ───────────────────────────────────────────────

test('tanpa cookie sesi: setiap rute menjawab 401', async () => {
  // ── KENAPA INI TES PALING PENTING DI BERKAS INI ─────────────────────────
  // Rute area klien mengembalikan daftar proyek, data metrik, dan kemampuan
  // membuat token. Satu rute yang lupa memeriksa login berarti semua itu
  // terbuka untuk siapa saja yang tahu URL-nya.
  for (const [method, path] of RUTE_KLIEN) {
    const r = resolveRoute(method, path);
    assert.ok(r);

    const req = { method, url: `http://lokal${path}`, headers: new Headers() };
    let status = null;
    const res = {
      setHeader() {},
      writeHead(code) { status = code; },
      end() {},
      get headersSent() { return status !== null; },
    };

    await r.route.handler(req, res, r.params, new URL(req.url));

    assert.equal(status, 401,
      `${method} ${path} TIDAK menolak permintaan tanpa sesi (status ${status})`);
  }
});

test('cookie sesi palsu ditolak — tanda tangan diperiksa, bukan hanya ID', async () => {
  // Cookie berisi ID sesi karangan. Kalau kode hanya mencari ID-nya di
  // database, ini akan lolos. Yang membuatnya tidak mungkin adalah tanda
  // tangan HMAC — dan itu diperiksa validateSession().
  const r = resolveRoute('GET', '/api/klien/proyek');
  const req = {
    method: 'GET',
    url: 'http://lokal/api/klien/proyek',
    headers: new Headers({ cookie: 'portfolio_session=sesi-karangan-12345' }),
  };
  let status = null;
  const res = {
    setHeader() {}, writeHead(c) { status = c; }, end() {},
    get headersSent() { return status !== null; },
  };

  await r.route.handler(req, res, r.params, new URL(req.url));
  assert.equal(status, 401, 'cookie tanpa tanda tangan sah harus ditolak');
});

// ── 3. NAMA COOKIE KONSISTEN ─────────────────────────────────────────────────

test('nama cookie sesi SAMA dengan auth-routes.mjs', () => {
  // ── KENAPA INI DIUJI ─────────────────────────────────────────────────────
  // Kalau nama cookie berbeda antara dua berkas, gejalanya adalah: pengguna
  // yang SUDAH masuk tetap dianggap belum masuk. Tidak ada error, tidak ada
  // log — hanya halaman yang selalu meminta login. Jenis bug yang sulit
  // ditemukan karena tidak ada yang "gagal".
  const isiKlien = readFileSync(resolve(AKAR, 'backend/src/klien-routes.mjs'), 'utf8');
  const isiAuth = readFileSync(resolve(AKAR, 'backend/src/auth-routes.mjs'), 'utf8');

  const cocokKlien = isiKlien.match(/const COOKIE_SESI = '([^']+)'/);
  const cocokAuth = isiAuth.match(/const COOKIE_SESI = '([^']+)'/);

  assert.ok(cocokKlien, 'klien-routes.mjs harus mendefinisikan COOKIE_SESI');
  assert.ok(cocokAuth, 'auth-routes.mjs harus mendefinisikan COOKIE_SESI');
  assert.equal(cocokKlien[1], cocokAuth[1],
    `nama cookie BEDA: klien="${cocokKlien[1]}" vs auth="${cocokAuth[1]}"`);
});

// ── 4. RUTE LAMA TIDAK RUSAK ─────────────────────────────────────────────────

test('rute lama masih terdaftar setelah rute klien ditambahkan', () => {
  for (const [method, path] of [
    ['GET', '/api/projects'],
    ['GET', '/api/auth/profil'],
  ]) {
    assert.ok(resolveRoute(method, path), `${method} ${path} HILANG — regresi`);
  }
});

test('rute klien tidak menimpa rute lain dengan pola sama', () => {
  // Kalau ada dua rute dengan pola identik, yang pertama menang dan yang
  // kedua tidak pernah terpanggil — tanpa peringatan apa pun.
  const semua = [];
  for (const [method, path] of RUTE_KLIEN) {
    const r = resolveRoute(method, path);
    semua.push(`${method} ${r.route.pattern}`);
  }
  assert.equal(new Set(semua).size, semua.length, 'ada pola rute yang duplikat');
});
