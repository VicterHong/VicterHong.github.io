/**
 * Tes gerbang Turnstile untuk aksi sensitif.
 *
 * Gerbang ini dipasang di /api/token/session SEBELUM token akses diperiksa.
 * Artinya: skrip bot yang mencoba menebak token akan ditolak lebih dulu
 * kalau belum lolos verifikasi manusia — percobaannya tidak pernah sampai
 * ke database token.
 *
 * Memakai key uji resmi Cloudflare supaya bisa diuji tanpa akun:
 *   - 1x0000000000000000000000000000000AA → selalu lolos
 *   - 2x0000000000000000000000000000000AA → selalu gagal
 *
 * Tes yang memanggil jaringan melewati diri sendiri kalau jaringan mati.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, closeDb } from '../src/db.mjs';
import { turnstileGate } from '../src/routes.mjs';
import { TEST_SECRET_ALWAYS_PASS, TEST_SECRET_ALWAYS_FAIL } from '../src/turnstile.mjs';

/** Database sementara untuk satu tes (gerbang menulis audit event). */
async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-test-'));
  openDb(join(dir, 'test.db'));
  try {
    return await fn();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Permintaan tiruan — hanya bagian yang dipakai gerbang. */
function fakeReq() {
  return {
    headers: { 'user-agent': 'test-agent/1.0' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

// ── Mode gagal-tertutup: tanpa secret ───────────────────────────────────────
//
// PERUBAHAN FIX-08: sebelumnya gerbang gagal-TERBUKA — secret kosong berarti
// verifikasi dilewati dan gerbang token terbuka tanpa proteksi. Sekarang
// gagal-TERTUTUP: secret kosong berarti TOLAK, karena membuka gerbang tanpa
// penjaga lebih buruk daripada pengunjung muat ulang.
//
// Mode fail-open tetap tersedia lewat opsi eksplisit (dipakai form sales,
// di mana kehilangan lead karena gangguan Cloudflare adalah pertukaran buruk).

test('tanpa secret → DITOLAK (fail-closed): gerbang tidak boleh terbuka tanpa proteksi', async () => {
  await withDb(async () => {
    const r = await turnstileGate(fakeReq(), {}, { secret: '' });
    assert.equal(r.ok, false, 'tanpa secret gerbang harus menolak');
    assert.equal(r.body.error, 'secret_kosong');
    // 503, bukan 403: ini masalah infrastruktur, bukan salah pengunjung.
    assert.equal(r.status, 503, 'status 503 menandakan masalah konfigurasi');
  });
});

test('tanpa secret + failOpen eksplisit → dilewati (untuk form sales)', async () => {
  await withDb(async () => {
    const r = await turnstileGate(fakeReq(), {}, { secret: '', failOpen: true });
    assert.equal(r.ok, true, 'fail-open eksplisit harus melewati');
    assert.equal(r.skipped, true);
  });
});

// ── Penolakan sebelum token diperiksa ────────────────────────────────────────

test('token Turnstile kosong + secret terpasang → ditolak 403 sebelum token diperiksa', async () => {
  await withDb(async () => {
    const r = await turnstileGate(fakeReq(), {}, { secret: TEST_SECRET_ALWAYS_PASS });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'token_kosong');
    assert.ok(r.body.message.length > 10, 'pesan harus memandu pengunjung');
    assert.match(r.body.message, /verifikasi/i, 'pesan menyebut verifikasi keamanan');
  });
});

test('field turnstile_token (alias) juga dibaca', async () => {
  await withDb(async () => {
    const r = await turnstileGate(fakeReq(), { turnstile_token: '' }, { secret: TEST_SECRET_ALWAYS_PASS });
    assert.equal(r.ok, false);
    assert.equal(r.body.error, 'token_kosong');
  });
});

test('token Turnstile terlalu panjang → ditolak tanpa memanggil Cloudflare', async () => {
  await withDb(async () => {
    const r = await turnstileGate(
      fakeReq(),
      { 'cf-turnstile-response': 'x'.repeat(3000) },
      { secret: TEST_SECRET_ALWAYS_PASS },
    );
    assert.equal(r.ok, false);
    assert.equal(r.body.error, 'token_terlalu_panjang');
  });
});

// ── Verifikasi nyata dengan key uji resmi ────────────────────────────────────

test('key uji "selalu gagal" → ditolak 403', async () => {
  await withDb(async () => {
    const r = await turnstileGate(
      fakeReq(),
      { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' },
      { secret: TEST_SECRET_ALWAYS_FAIL },
    );
    if (r.skipped) return; // jaringan tidak tersedia — lewati
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

test('key uji "selalu lolos" → diterima', async () => {
  await withDb(async () => {
    const r = await turnstileGate(
      fakeReq(),
      { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' },
      // Key uji Cloudflare mengembalikan hostname 'example.com', jadi
      // hostname itu yang diharapkan di sini. Di produksi, nilainya dari
      // config.turnstileHostnames (TURNSTILE_HOSTNAMES di service.env).
      { secret: TEST_SECRET_ALWAYS_PASS, expectedHostnames: ['example.com'] },
    );
    if (r.skipped) return; // jaringan tidak tersedia — lewati
    assert.equal(r.ok, true);
  });
});

// ── Validasi hostname (FIX-08) ──────────────────────────────────────────────
//
// Tanpa pemeriksaan ini, token yang diselesaikan di domain lain (preview
// deployment, staging, atau domain penyerang) tetap diterima. Key uji
// Cloudflare mengembalikan 'example.com' — berguna untuk membuktikan
// pemeriksaan ini benar-benar bekerja.

test('hostname tidak cocok → ditolak', async () => {
  await withDb(async () => {
    const r = await turnstileGate(
      fakeReq(),
      { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' },
      { secret: TEST_SECRET_ALWAYS_PASS, expectedHostnames: ['situs-saya.pages.dev'] },
    );
    if (r.skipped) return; // jaringan tidak tersedia
    assert.equal(r.ok, false, 'token dari domain lain harus ditolak');
    assert.equal(r.body.error, 'hostname_tidak_cocok');
    assert.equal(r.status, 403);
  });
});

test('daftar hostname kosong → pemeriksaan dilewati (pengembangan)', async () => {
  await withDb(async () => {
    const r = await turnstileGate(
      fakeReq(),
      { 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' },
      { secret: TEST_SECRET_ALWAYS_PASS, expectedHostnames: [] },
    );
    if (r.skipped) return;
    assert.equal(r.ok, true, 'daftar kosong = tidak memeriksa hostname');
  });
});
