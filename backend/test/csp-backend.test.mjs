/**
 * Tes: CSP `connect-src` harus memuat alamat backend yang benar-benar dipakai.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * `_headers` memuat `connect-src` yang ditulis tangan. Daftarnya berisi
 * `workers.dev` (backend lama) tapi TIDAK memuat alamat tunnel yang ditulis
 * di `backend-url.json`.
 *
 * Akibatnya browser memblokir setiap panggilan API sebelum request keluar:
 *
 *     Refused to connect because it violates the document's Content Security Policy.
 *
 * Rantai kegagalannya:
 *     /api/config diblokir → turnstile.enabled dianggap false
 *     → widget Turnstile tidak pernah dirender
 *     → tombol "Buka" tetap terkunci selamanya
 *
 * Tidak ada error yang terlihat pengguna. Widgetnya hanya tidak muncul, dan
 * mudah disalahartikan sebagai "memang tidak ada widget di halaman ini".
 *
 * ── ATURAN YANG DIJAGA ──────────────────────────────────────────────────────
 *   1. connect-src memuat origin dari backend-url.json
 *   2. connect-src tetap memuat challenges.cloudflare.com (Turnstile butuh)
 *   3. _headers dihasilkan oleh skrip, bukan disunting tangan
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function csp() {
  const h = readFileSync(`${ROOT}_headers`, 'utf8');
  const m = h.match(/Content-Security-Policy:([^\n]+)/);
  assert.ok(m, '_headers harus memuat Content-Security-Policy');
  return m[1];
}

function connectSrc() {
  const m = csp().match(/connect-src ([^;]+)/);
  assert.ok(m, 'CSP harus memuat connect-src');
  return m[1].trim().split(/\s+/);
}

test('backend-url.json ada dan berisi api_base yang valid', () => {
  const f = `${ROOT}backend-url.json`;
  assert.ok(existsSync(f), 'backend-url.json harus ada — situs membacanya untuk menemukan API');
  const data = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(typeof data.api_base, 'string');
  assert.doesNotThrow(() => new URL(data.api_base), 'api_base harus URL valid');
});

test('connect-src memuat origin backend dari backend-url.json', () => {
  const data = JSON.parse(readFileSync(`${ROOT}backend-url.json`, 'utf8'));
  const origin = new URL(data.api_base).origin;
  const daftar = connectSrc();
  assert.ok(
    daftar.includes(origin),
    `connect-src harus memuat "${origin}" (dari backend-url.json). `
    + `Tanpa itu browser memblokir /api/config → Turnstile tidak pernah dirender. `
    + `Ditemukan: ${daftar.join(' ')}`,
  );
});

test('connect-src tetap mengizinkan Turnstile dan origin sendiri', () => {
  const daftar = connectSrc();
  assert.ok(daftar.includes("'self'"), "connect-src harus memuat 'self'");
  assert.ok(
    daftar.includes('https://challenges.cloudflare.com'),
    'connect-src harus memuat challenges.cloudflare.com — widget Turnstile memanggil ke sana',
  );
});

test('_headers dihasilkan oleh skrip, bukan disunting tangan', () => {
  const h = readFileSync(`${ROOT}_headers`, 'utf8');
  assert.match(h, /DIHASILKAN OTOMATIS/, '_headers harus menyatakan dirinya dihasilkan otomatis');
  assert.match(h, /scripts\/build-headers\.mjs/, '_headers harus menyebut skrip penghasilnya');
  assert.ok(existsSync(`${ROOT}scripts/build-headers.mjs`), 'skrip build-headers.mjs harus ada');
});

test('build-css memanggil build-headers setiap build', () => {
  const b = readFileSync(`${ROOT}scripts/build-css.mjs`, 'utf8');
  assert.match(
    b, /build-headers\.mjs/,
    'build-css.mjs harus memanggil build-headers.mjs — kalau tidak, CSP akan basi lagi '
    + 'setiap kali URL tunnel berubah',
  );
});
