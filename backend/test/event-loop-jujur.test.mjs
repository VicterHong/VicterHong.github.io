/**
 * Tes: apakah angka event loop delay JUJUR?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MASALAH YANG DIUJI ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Health check melaporkan `event_loop_ms: { p50_ms: 20.1, ... }` — tapi server
 * SEDANG IDLE SEMPURNA. Angka 20.1 itu bukan delay; itu `resolution` monitor.
 *
 * `monitorEventLoopDelay({ resolution })` mencatat waktu ANTARA timer
 * dijadwalkan dan timer berjalan. Timer dijadwalkan untuk `resolution` ms
 * ke depan, jadi nilai minimum yang bisa tercatat = resolution — bahkan
 * kalau event loop sama sekali tidak diblokir.
 *
 * Akibatnya:
 *   1. Dashboard menampilkan "p50 = 20ms" untuk server yang sehat sempurna.
 *      Operator mengira ada masalah, padahal tidak.
 *
 *   2. Ambang `p99 > 50ms` efektifnya jadi "p99 > 30ms" — warning muncul
 *      untuk blokir 30ms yang sebenarnya masih aman.
 *
 *   3. Nilai tidak bisa dibandingkan dengan angka dari alat lain
 *      (`perf_hooks.performance`, APM) yang melaporkan delay murni.
 *
 * ── YANG DIHARAPKAN ─────────────────────────────────────────────────────────
 *
 * `eventLoopStats()` harus melaporkan DELAY MURNI (sudah dikurangi resolution),
 * sehingga server yang idle melaporkan ~0ms, bukan ~20ms.
 *
 * Jalankan: node --test backend/test/event-loop-jujur.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// ── Bantu: jalankan monitor dengan resolution tertentu, kembali statistik ────

const toMs = (ns) => Number(ns) / 1e6;

async function ukurIdle(resolution, lamaMs = 1200) {
  const h = monitorEventLoopDelay({ resolution });
  h.enable();
  await new Promise((r) => setTimeout(r, lamaMs));
  const hasil = {
    p50: toMs(h.percentile(50)),
    p99: toMs(h.percentile(99)),
    max: toMs(h.max),
  };
  h.disable();
  return hasil;
}

async function ukurDenganBlokir(resolution, blokirMs, jumlah = 3) {
  const h = monitorEventLoopDelay({ resolution });
  h.enable();

  for (let i = 0; i < jumlah; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const t0 = Date.now();
    while (Date.now() - t0 < blokirMs) { /* busy wait — benar-benar blokir */ }
  }
  await new Promise((r) => setTimeout(r, 150));

  const hasil = { p99: toMs(h.percentile(99)), max: toMs(h.max) };
  h.disable();
  return hasil;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── BAGIAN 1: BUKTI MASALAH (dokumentasi perilaku Node) ─────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Tes ini TIDAK menguji kode kita — ia mengunci pemahaman tentang perilaku
// `monitorEventLoopDelay` yang menjadi dasar perbaikan. Kalau Node mengubah
// perilakunya di versi mendatang, tes ini gagal dan memberi tahu kita bahwa
// asumsi perbaikan sudah tidak berlaku.
describe('perilaku monitorEventLoopDelay (dasar perbaikan)', () => {
  test('saat idle, nilai mentah ≈ resolution — bukan 0', async () => {
    const hasil = await ukurIdle(20);

    // Inilah bug-nya: server idle, tapi tercatat 20ms.
    assert.ok(
      hasil.p50 >= 19 && hasil.p50 <= 22,
      `p50 idle harus ≈ 20 (resolution), dapat ${hasil.p50.toFixed(1)}ms. ` +
      'Kalau ini gagal, perilaku Node berubah — perbaikan mungkin tidak perlu lagi.',
    );
  });

  test('floor mengikuti resolution — membuktikan nilai = delay + resolution', async () => {
    const r10 = await ukurIdle(10);
    const r50 = await ukurIdle(50);

    // Kalau nilai = delay murni, keduanya akan ≈ 0 dan sama.
    // Kalau nilai = delay + resolution, keduanya mengikuti resolution-nya.
    assert.ok(
      Math.abs(r10.p50 - 10) < 2,
      `resolution=10 → p50 harus ≈ 10, dapat ${r10.p50.toFixed(1)}ms`,
    );
    assert.ok(
      Math.abs(r50.p50 - 50) < 3,
      `resolution=50 → p50 harus ≈ 50, dapat ${r50.p50.toFixed(1)}ms`,
    );

    // Beda p50 harus ≈ beda resolution (40ms)
    const beda = r50.p50 - r10.p50;
    assert.ok(
      beda > 30,
      `beda p50 (${beda.toFixed(1)}ms) harus ≈ beda resolution (40ms)`,
    );
  });

  test('blokir nyata terdeteksi, tapi nilainya = blokir + resolution', async () => {
    const BLOKIR = 80;
    const RES = 20;
    const hasil = await ukurDenganBlokir(RES, BLOKIR);

    // Klaim intinya: nilai mentah SELALU lebih besar dari blokir sebenarnya,
    // karena ada resolution yang ikut tercatat.
    //
    // Toleransi longgar di sini: titik di mana timer menyala tidak persis
    // sejajar dengan awal blokir, jadi nilai tercatat bisa sedikit di bawah
    // (blokir + resolution). Yang penting arahnya: nilainya melebihi blokir.
    assert.ok(
      hasil.max > BLOKIR,
      `nilai mentah (${hasil.max.toFixed(1)}ms) harus LEBIH BESAR dari blokir nyata (${BLOKIR}ms)`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── BAGIAN 2: KOREKSI YANG DIHARAPKAN ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Fungsi koreksi yang dipakai health.mjs: kurangi resolution supaya yang
// dilaporkan adalah delay murni.
describe('koreksi delay: nilai - resolution', () => {
  /** Fungsi koreksi yang sama dengan yang dipakai health.mjs. */
  const koreksi = (nilaiMs, resolutionMs) => Math.max(0, nilaiMs - resolutionMs);

  test('idle → terkoreksi jadi ~0', () => {
    // Toleransi 0.001 untuk floating point: 20.1 - 20 = 0.10000000000000142
    const dekat = (a, b) => Math.abs(a - b) < 0.001;
    assert.ok(dekat(koreksi(20.1, 20), 0.1), `dapat ${koreksi(20.1, 20)}`);
    assert.ok(dekat(koreksi(10.1, 10), 0.1), `dapat ${koreksi(10.1, 10)}`);
  });

  test('tidak pernah negatif', () => {
    // Bisa terjadi kalau timer menyala lebih cepat dari jadwal (jarang).
    assert.equal(koreksi(15, 20), 0);
    assert.equal(koreksi(0, 20), 0);
  });

  test('blokir nyata tetap terlihat setelah koreksi', () => {
    // Nilai mentah 100ms dengan resolution 20 → delay nyata 80ms
    assert.equal(koreksi(100, 20), 80);
    // Masih di atas ambang 50ms → warning tetap muncul
    assert.ok(koreksi(100, 20) > 50);
  });

  test('blokir kecil tidak lagi memicu warning palsu', () => {
    // Nilai mentah 52ms (resolution 20) → delay nyata 32ms
    // Dengan ambang 50ms, ini TIDAK boleh warning.
    const delayNyata = koreksi(52, 20);
    assert.ok(delayNyata < 50, `delay nyata ${delayNyata}ms harus di bawah ambang 50ms`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── BAGIAN 3: INTEGRASI — health.mjs memakai koreksi ────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('health.mjs melaporkan delay murni', () => {
  test('eventLoopStats() melaporkan ~0 saat idle, bukan ~resolution', async () => {
    // Impor modul asli — ia membuat monitor sendiri saat dimuat.
    const { eventLoopStats } = await import('../src/health.mjs');

    // Biarkan monitor mengumpulkan sampel idle.
    await new Promise((r) => setTimeout(r, 1500));

    const s = eventLoopStats();

    // Inilah perbaikannya: server idle harus melaporkan delay ≈ 0.
    assert.ok(
      s.p50_ms < 5,
      `p50 idle harus < 5ms (delay murni), dapat ${s.p50_ms}ms. ` +
      'Kalau ≈ 20ms, resolution belum dikurangi.',
    );

    // Field resolution harus ada supaya jelas angkanya sudah dikoreksi.
    assert.ok(
      typeof s.resolution_ms === 'number' && s.resolution_ms > 0,
      'eventLoopStats() harus menyertakan resolution_ms',
    );
  });

  test('blokir nyata tetap terdeteksi setelah koreksi', async () => {
    const { eventLoopStats } = await import('../src/health.mjs');

    // Blokir 120ms — harus muncul sebagai delay besar.
    const t0 = Date.now();
    while (Date.now() - t0 < 120) { /* busy wait */ }
    await new Promise((r) => setTimeout(r, 100));

    const s = eventLoopStats();

    assert.ok(
      s.max_ms >= 100,
      `blokir 120ms harus terlihat di max (≥100ms), dapat ${s.max_ms}ms`,
    );
  });
});
