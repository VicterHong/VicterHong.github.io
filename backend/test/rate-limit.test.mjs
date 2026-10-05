/**
 * Test A6 — rate limiter: batas memori, eviksi, dan sweep.
 *
 * Yang dicegah: rate limiter yang berubah menjadi alat serangan.
 * Implementasi lama menyimpan Map tanpa batas — penyerang dengan banyak IP
 * bisa menumbuhkan memori sampai proses mati. Diukur: 1 juta key = 226 MB.
 *
 * Juga mencegah regresi pada perilaku dasar: batas per jendela, isolasi
 * antar-IP, dan reset jendela.
 *
 * Jalankan: node --test test/rate-limit.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  checkRateLimit, resetRateLimit, rateLimitSize, rateLimitStats, sweepRateLimit,
} = await import('../src/rate-limit.mjs');

const RULE = { limit: 5, windowMs: 60_000 };

/** Jalankan fn dengan Date.now() yang bisa dikendalikan. */
function withFakeTime(startMs, fn) {
  const real = Date.now;
  let t = startMs;
  Date.now = () => t;
  try {
    return fn({ advance: (ms) => { t += ms; }, at: () => t });
  } finally {
    Date.now = real;
  }
}

test('rate-limit: batas per jendela ditegakkan', () => {
  resetRateLimit();
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit('a', RULE).allowed, true, `request ${i + 1} harus lolos`);
  }
  const blocked = checkRateLimit('a', RULE);
  assert.equal(blocked.allowed, false, 'request ke-6 harus ditolak');
  assert.ok(blocked.retryAfterSeconds >= 1, 'harus memberi retry-after');
  assert.equal(blocked.remaining, 0);
});

test('rate-limit: IP berbeda tidak saling mempengaruhi', () => {
  resetRateLimit();
  for (let i = 0; i < 5; i++) checkRateLimit('ip-a', RULE);
  assert.equal(checkRateLimit('ip-a', RULE).allowed, false, 'ip-a sudah penuh');
  assert.equal(checkRateLimit('ip-b', RULE).allowed, true, 'ip-b tidak boleh terpengaruh');
});

test('rate-limit: jendela reset setelah windowMs', () => {
  resetRateLimit();
  withFakeTime(1_000_000, ({ advance }) => {
    for (let i = 0; i < 5; i++) checkRateLimit('w', RULE);
    assert.equal(checkRateLimit('w', RULE).allowed, false, 'penuh di jendela pertama');
    advance(60_001);
    assert.equal(checkRateLimit('w', RULE).allowed, true, 'jendela baru → boleh lagi');
  });
});

test('rate-limit: tepat di batas jendela dihitung jendela baru', () => {
  resetRateLimit();
  withFakeTime(5_000_000, ({ advance }) => {
    checkRateLimit('edge', RULE);
    advance(60_000); // tepat windowMs
    const v = checkRateLimit('edge', RULE);
    assert.equal(v.remaining, RULE.limit - 1, 'jendela tepat windowMs, bukan windowMs+1');
  });
});

test('rate-limit: jumlah key DIBATASI (inti A6)', () => {
  resetRateLimit();
  const LIMIT = 50_000;

  // Kirim jauh lebih banyak key daripada batas — simulasi serangan botnet.
  for (let i = 0; i < LIMIT + 30_000; i++) {
    checkRateLimit(`attacker:10.0.${Math.floor(i / 65536)}.${i % 65536}`, RULE);
  }

  const size = rateLimitSize();
  assert.ok(size <= LIMIT, `key harus <= ${LIMIT}, dapat ${size}`);
  assert.ok(size > LIMIT * 0.5, `eviksi tidak boleh membuang berlebihan, sisa ${size}`);
});

test('rate-limit: eviksi mempertahankan entri berhitungan tinggi', () => {
  resetRateLimit();

  // Klien sah memakai jatahnya — hitungan tinggi.
  for (let i = 0; i < 4; i++) checkRateLimit('klien-aktif', RULE);

  // Penyerang membanjiri dengan key palsu berhitungan 1.
  for (let i = 0; i < 55_000; i++) checkRateLimit(`spam:${i}`, RULE);

  // Entri klien sah harus SELAMAT: hitungannya lebih tinggi daripada
  // key palsu, jadi eviksi memilih membuang key palsu lebih dulu.
  const v = checkRateLimit('klien-aktif', RULE);
  assert.equal(v.allowed, true, 'klien aktif masih boleh');
  assert.equal(v.remaining, RULE.limit - 5, 'hitungan klien aktif TIDAK direset oleh eviksi');
});

test('rate-limit: penyerang tidak bisa me-reset hitungannya sendiri', () => {
  resetRateLimit();

  // Penyerang memakai jatahnya sampai habis.
  for (let i = 0; i < RULE.limit; i++) checkRateLimit('penyerang', RULE);
  assert.equal(checkRateLimit('penyerang', RULE).allowed, false, 'harus terblokir');

  // Sekarang ia mencoba membanjiri Map supaya entrinya terbuang (reset).
  for (let i = 0; i < 55_000; i++) checkRateLimit(`umpan:${i}`, RULE);

  // Serangan balik: kalau eviksi memakai LRU, entri penyerang akan terbuang
  // dan hitungannya kembali nol. Dengan eviksi hitungan-terkecil, entri
  // penyerang (hitungan penuh) dipertahankan.
  const v = checkRateLimit('penyerang', RULE);
  assert.equal(v.allowed, false, 'penyerang HARUS tetap terblokir setelah membanjiri Map');
});

test('rate-limit: eviksi melaporkan jumlahnya di statistik', () => {
  resetRateLimit();
  for (let i = 0; i < 55_000; i++) checkRateLimit(`s:${i}`, RULE);
  const stats = rateLimitStats();
  assert.ok(stats.evicted > 0, 'eviksi harus tercatat');
  assert.equal(stats.max_keys, 50_000, 'batas dilaporkan');
  assert.ok(stats.keys <= stats.max_keys, 'keys tidak melebihi batas');
});

test('rate-limit: sweep membuang entri kedaluwarsa', () => {
  resetRateLimit();
  for (let i = 0; i < 500; i++) checkRateLimit(`sweep:${i}`, RULE);
  assert.equal(rateLimitSize(), 500);

  // Sweep dengan waktu jauh di depan → semua kedaluwarsa.
  const removed = sweepRateLimit(Date.now() + 7_200_000, 3_600_000);
  assert.equal(removed, 500, 'semua entri dibuang');
  assert.equal(rateLimitSize(), 0);
});

test('rate-limit: sweep TIDAK membuang entri yang masih berlaku', () => {
  resetRateLimit();
  for (let i = 0; i < 100; i++) checkRateLimit(`fresh:${i}`, RULE);

  // Sweep dengan waktu sekarang, jendela 1 jam → entri baru masih berlaku.
  const removed = sweepRateLimit(Date.now(), 3_600_000);
  assert.equal(removed, 0, 'entri yang masih berlaku tidak boleh dibuang');
  assert.equal(rateLimitSize(), 100, 'semua masih ada');
});

test('rate-limit: sweep pada Map penuh tidak memblokir lama', () => {
  resetRateLimit();
  for (let i = 0; i < 50_000; i++) checkRateLimit(`full:${i}`, RULE);
  assert.equal(rateLimitSize(), 50_000);

  const t0 = process.hrtime.bigint();
  sweepRateLimit(Date.now(), 3_600_000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  // Implementasi lama butuh ~50 ms untuk 100.000 key (mengalokasi array
  // per key). Versi ini hanya membaca satu angka per key.
  assert.ok(ms < 50, `sweep 50.000 key harus <50 ms, dapat ${ms.toFixed(1)} ms`);
});

test('rate-limit: resetRateLimit membersihkan semuanya', () => {
  for (let i = 0; i < 100; i++) checkRateLimit(`r:${i}`, RULE);
  assert.ok(rateLimitSize() > 0);
  resetRateLimit();
  assert.equal(rateLimitSize(), 0, 'tanpa argumen = bersihkan semua');
});
