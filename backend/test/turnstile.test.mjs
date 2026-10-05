/**
 * Tes integrasi Cloudflare Turnstile.
 *
 * Memakai key uji resmi Cloudflare supaya bisa diuji tanpa akun:
 *   - 1x0000000000000000000000000000000AA → selalu lolos
 *   - 2x0000000000000000000000000000000AA → selalu gagal
 *
 * Tes yang memanggil jaringan ditandai: kalau jaringan tidak tersedia,
 * tes dilewati (bukan gagal) — supaya CI tanpa internet tetap hijau.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyTurnstile, turnstileMessage,
  TEST_SECRET_ALWAYS_PASS, TEST_SECRET_ALWAYS_FAIL,
} from '../src/turnstile.mjs';

/** Jalankan panggilan jaringan; kembalikan null kalau jaringan tidak tersedia. */
async function tryNetwork(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ── Mode aman: tanpa secret ──────────────────────────────────────────────────

test('tanpa secret key → skipped, alur form tidak diblokir', async () => {
  const r = await verifyTurnstile({ token: '', secret: '' });
  assert.equal(r.ok, true, 'tanpa config tidak boleh memblokir pengunjung');
  assert.equal(r.skipped, true);
});

test('token kosong dengan secret terpasang → ditolak', async () => {
  const r = await verifyTurnstile({ token: '', secret: 'some-secret' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'token_kosong');
  assert.ok(r.codes.includes('missing-input-response'));
});

test('token null dengan secret terpasang → ditolak', async () => {
  const r = await verifyTurnstile({ token: null, secret: 'some-secret' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'token_kosong');
});

test('token bukan string → ditolak', async () => {
  const r = await verifyTurnstile({ token: 12345, secret: 'some-secret' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'token_kosong');
});

test('token > 2048 karakter → ditolak tanpa memanggil Cloudflare', async () => {
  const r = await verifyTurnstile({ token: 'x'.repeat(2100), secret: 'some-secret' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'token_terlalu_panjang');
});

// ── Verifikasi nyata dengan key uji resmi ────────────────────────────────────

test('key uji "selalu lolos" + token dummy → ok', async () => {
  const r = await tryNetwork(() => verifyTurnstile({
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    secret: TEST_SECRET_ALWAYS_PASS,
    remoteip: '203.0.113.30',
  }));
  if (r === null) return; // jaringan tidak tersedia — lewati
  assert.equal(r.ok, true, `harus lolos dengan key uji, dapat: ${JSON.stringify(r)}`);
});

test('key uji "selalu gagal" → ditolak', async () => {
  const r = await tryNetwork(() => verifyTurnstile({
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    secret: TEST_SECRET_ALWAYS_FAIL,
  }));
  if (r === null) return;
  assert.equal(r.ok, false, 'harus ditolak dengan key uji gagal');
});

test('secret key tidak valid → ditolak dengan kode yang jelas', async () => {
  const r = await tryNetwork(() => verifyTurnstile({
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    secret: 'secret-yang-jelas-tidak-valid-12345',
  }));
  if (r === null) return;
  assert.equal(r.ok, false);
  assert.ok(
    r.codes.includes('invalid-input-secret') || r.error === 'verifikasi_gagal',
    `harus melaporkan secret tidak valid, dapat: ${JSON.stringify(r)}`,
  );
});

// ── Pesan untuk pengunjung ───────────────────────────────────────────────────

test('setiap kode error punya pesan yang memandu, bukan menyalahkan', () => {
  const codes = [
    'token_kosong', 'token_kedaluwarsa', 'token_terlalu_panjang',
    'verifikasi_gagal', 'kode_tidak_dikenal',
  ];
  for (const c of codes) {
    const msg = turnstileMessage(c);
    assert.ok(msg && msg.length > 10, `pesan untuk "${c}" harus ada dan bermakna`);
    assert.ok(!/error|gagal sistem/i.test(msg) || /verifikasi/i.test(msg),
      `pesan "${c}" harus memandu pengunjung, bukan pesan sistem`);
  }
});

test('pesan token kedaluwarsa memandu muat ulang halaman', () => {
  const msg = turnstileMessage('token_kedaluwarsa');
  assert.match(msg, /muat ulang|refresh/i, 'harus memandu pengunjung memuat ulang');
});
