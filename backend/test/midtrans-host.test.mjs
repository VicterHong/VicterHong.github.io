/**
 * Tes: host API v2 Midtrans BERBEDA dari host Snap.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Snap memakai `app.midtrans.com`, tapi endpoint v2 (`/v2/:order/status`,
 * `/v2/:order/cancel`) ada di `api.midtrans.com`. Memakai host Snap untuk
 * endpoint v2 menghasilkan HTTP 404 dengan body HTML — bukan JSON.
 *
 * Akibat nyata yang pernah terjadi: `ambilStatusTransaksi()` selalu gagal,
 * sehingga percobaan checkout kedua jatuh ke jalur "buat transaksi baru" dan
 * menabrak UNIQUE constraint idempotency_key — pembeli melihat
 * "UNIQUE constraint failed" alih-alih URL pembayaran yang sama.
 *
 * Tes ini memverifikasi PEMISAHAN host, bukan memanggil Midtrans.
 *
 * Jalankan: node --test backend/test/midtrans-host.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUMBER = readFileSync(resolve(__dirname, '..', 'src', 'midtrans.mjs'), 'utf8');

describe('host API Midtrans', () => {
  test('host Snap memakai app.midtrans.com', () => {
    assert.match(SUMBER, /'https:\/\/app\.midtrans\.com'/,
      'host Snap harus app.midtrans.com');
  });

  test('host API v2 memakai api.midtrans.com', () => {
    assert.match(SUMBER, /'https:\/\/api\.midtrans\.com'/,
      'endpoint v2 harus memakai api.midtrans.com — app.midtrans.com menjawab 404');
  });

  test('host sandbox v2 memakai api.sandbox.midtrans.com', () => {
    assert.match(SUMBER, /'https:\/\/api\.sandbox\.midtrans\.com'/,
      'endpoint v2 sandbox harus memakai api.sandbox.midtrans.com');
  });

  // Ambil dua baris setelah tanda tangan fungsi — cukup untuk melihat
  // argumen yang dikirim, tanpa terpotong oleh '}' di dalam template literal.
  function barisFungsi(nama) {
    const i = SUMBER.indexOf(`export async function ${nama}(`);
    assert.notEqual(i, -1, `fungsi ${nama} harus ada`);
    return SUMBER.slice(i, i + 400);
  }

  test('ambilStatusTransaksi memakai urlApiV2', () => {
    assert.match(barisFungsi('ambilStatusTransaksi'), /urlApiV2\(\)/,
      'ambilStatusTransaksi harus memakai host v2, bukan host Snap');
  });

  test('batalkanTransaksi memakai urlApiV2 dan jalur /v2/', () => {
    const badan = barisFungsi('batalkanTransaksi');
    assert.match(badan, /urlApiV2\(\)/, 'batalkanTransaksi harus memakai host v2');
    assert.match(badan, /\/v2\//, 'batalkanTransaksi harus memakai jalur /v2/');
  });
});
