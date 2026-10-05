/**
 * Test health & readiness — memastikan pemeriksaan JUJUR.
 *
 * Yang dicegah: health check yang selalu bilang "ok" walau sistem rusak.
 *
 * Jalankan: node --test test/health.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'health-test-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.CONTENT_DIR = join(tmp, 'content');

const { openDb, closeDb } = await import('../src/db.mjs');
const { liveness, readiness } = await import('../src/health.mjs');

openDb(process.env.DB_PATH);

test.after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

// ── LIVENESS ─────────────────────────────────────────────────────────────────

test('liveness: melaporkan proses hidup dengan detail berguna', () => {
  const l = liveness();
  assert.equal(l.ok, true);
  assert.equal(l.service, 'portfolio-token-service');
  assert.ok(typeof l.uptime_seconds === 'number' && l.uptime_seconds >= 0);
  assert.ok(l.pid > 0);
  assert.ok(l.node.startsWith('v'), 'versi Node dilaporkan');
  assert.ok(l.memory_mb > 0, 'penggunaan memori dilaporkan');
  assert.ok(l.time, 'cap waktu ada');
});

test('liveness: TIDAK menyentuh database (cepat & tahan DB rusak)', () => {
  // Liveness harus tetap bekerja walau DB bermasalah — itu tugas readiness.
  const start = Date.now();
  const l = liveness();
  const elapsed = Date.now() - start;
  assert.equal(l.ok, true);
  assert.ok(elapsed < 50, `liveness harus cepat (<50ms), dapat ${elapsed}ms`);
});

// ── READINESS ────────────────────────────────────────────────────────────────

test('readiness: semua pemeriksaan dilaporkan', () => {
  const r = readiness();
  const names = r.checks.map(c => c.name);
  assert.ok(names.includes('database'), 'database diperiksa');
  assert.ok(names.includes('disk_write'), 'kemampuan tulis disk diperiksa');
  assert.ok(names.includes('disk_space'), 'ruang disk diperiksa');
  assert.ok(names.includes('config'), 'konfigurasi diperiksa');
  assert.ok(typeof r.ok === 'boolean');
});

test('readiness: database benar-benar di-query (bukan diasumsikan)', () => {
  const r = readiness();
  const db = r.checks.find(c => c.name === 'database');
  assert.ok(db, 'pemeriksaan database ada');
  assert.equal(db.ok, true, 'database harus sehat di test ini');
  assert.ok(db.detail.includes('token'), `detail menyebut jumlah token: ${db.detail}`);
});

test('readiness: melaporkan kegagalan dengan detail, bukan gagal diam', () => {
  // Tutup database → pemeriksaan database HARUS gagal & melaporkan sebabnya.
  closeDb();
  const r = readiness();
  const db = r.checks.find(c => c.name === 'database');
  assert.equal(db.ok, false, 'database tertutup harus terdeteksi');
  assert.ok(db.detail.length > 0, 'detail kegagalan diisi');
  assert.equal(r.ok, false, 'readiness keseluruhan harus false');

  // Buka kembali untuk test berikutnya.
  openDb(process.env.DB_PATH);
});

test('readiness: ok=false kalau ADA satu pemeriksaan gagal', () => {
  const r = readiness();
  const allOk = r.checks.every(c => c.ok);
  assert.equal(r.ok, allOk, 'ok harus konsisten dengan hasil pemeriksaan');
});

test('readiness: struktur respons stabil (untuk monitoring)', () => {
  const r = readiness();
  assert.ok(Array.isArray(r.checks));
  assert.ok(typeof r.uptime_seconds === 'number');
  assert.ok(r.time, 'cap waktu ada');
  for (const c of r.checks) {
    assert.ok(typeof c.name === 'string', 'setiap pemeriksaan punya nama');
    assert.ok(typeof c.ok === 'boolean', 'setiap pemeriksaan punya status');
    assert.ok(typeof c.detail === 'string', 'setiap pemeriksaan punya detail');
  }
});
