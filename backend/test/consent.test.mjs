/**
 * Tes persetujuan syarat akses (PRD v2.5, menutup pertanyaan Q5).
 *
 * Menguji bahwa persetujuan tercatat, versi teks dilacak, dan token dengan
 * persetujuan versi lama diminta menyetujui ulang.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, closeDb } from '../src/db.mjs';
import {
  TERMS_VERSION, TERMS_TEXT, recordConsent, latestConsent, consentStatus,
} from '../src/consent.mjs';

/** Database sementara untuk satu tes. */
function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'consent-test-'));
  const db = openDb(join(dir, 'test.db'));
  try {
    return fn(db);
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Teks syarat ──────────────────────────────────────────────────────────────

test('teks syarat punya versi dan memuat butir penting', () => {
  assert.ok(TERMS_VERSION, 'versi harus ada');
  assert.match(TERMS_TEXT, /KERAHASIAAN/, 'harus menyebut kerahasiaan');
  assert.match(TERMS_TEXT, /PENGGUNAAN TERBATAS/, 'harus menyebut batas penggunaan');
  assert.match(TERMS_TEXT, /JEJAK AKSES/, 'harus menyebut pencatatan akses');
  assert.match(TERMS_TEXT, /PENCABUTAN/, 'harus menyebut hak pencabutan');
  assert.ok(TERMS_TEXT.includes(TERMS_VERSION), 'teks harus memuat nomor versinya');
});

// ── Pencatatan persetujuan ───────────────────────────────────────────────────

test('recordConsent menyimpan persetujuan dan mengembalikan id', () => {
  withDb((db) => {
    const r = recordConsent(db, {
      tokenId: 1, ip: '203.0.113.20', userAgent: 'Mozilla/5.0',
    });
    assert.equal(r.ok, true);
    assert.ok(r.id > 0, 'harus mengembalikan id baris');
  });
});

test('recordConsent menolak tanpa tokenId', () => {
  withDb((db) => {
    const r = recordConsent(db, { ip: '203.0.113.21' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'token_id_wajib');
  });
});

test('recordConsent mencatat versi teks yang disetujui', () => {
  withDb((db) => {
    recordConsent(db, { tokenId: 2, version: '0.9', ip: '203.0.113.22' });
    const row = latestConsent(db, 2);
    assert.equal(row.terms_version, '0.9', 'versi lama harus tersimpan apa adanya untuk audit');
  });
});

test('recordConsent memotong user-agent panjang (batas 300 karakter)', () => {
  withDb((db) => {
    const longUa = 'M'.repeat(500);
    recordConsent(db, { tokenId: 3, ip: '203.0.113.23', userAgent: longUa });
    const row = latestConsent(db, 3);
    assert.equal(row.user_agent.length, 300, 'user-agent harus dipotong di 300 karakter');
  });
});

// ── Pembacaan persetujuan ────────────────────────────────────────────────────

test('latestConsent mengembalikan null untuk token yang belum menyetujui', () => {
  withDb((db) => {
    assert.equal(latestConsent(db, 999), null);
  });
});

test('latestConsent mengembalikan persetujuan terbaru kalau ada beberapa', () => {
  withDb((db) => {
    recordConsent(db, { tokenId: 4, version: '0.9', ip: '1.1.1.1' });
    recordConsent(db, { tokenId: 4, version: '1.0', ip: '2.2.2.2' });
    const row = latestConsent(db, 4);
    assert.equal(row.terms_version, '1.0', 'harus mengambil yang terbaru');
    assert.equal(row.ip, '2.2.2.2');
  });
});

// ── Status persetujuan ───────────────────────────────────────────────────────

test('consentStatus: belum menyetujui → needsConsent true', () => {
  withDb((db) => {
    const s = consentStatus(db, 500);
    assert.equal(s.ok, false);
    assert.equal(s.needsConsent, true);
  });
});

test('consentStatus: sudah menyetujui versi berlaku → ok', () => {
  withDb((db) => {
    recordConsent(db, { tokenId: 6, version: TERMS_VERSION, ip: '203.0.113.24' });
    const s = consentStatus(db, 6);
    assert.equal(s.ok, true);
    assert.equal(s.needsConsent, false);
    assert.equal(s.version, TERMS_VERSION);
  });
});

test('consentStatus: menyetujui versi lama → diminta menyetujui ulang', () => {
  withDb((db) => {
    recordConsent(db, { tokenId: 7, version: '0.1', ip: '203.0.113.25' });
    const s = consentStatus(db, 7);
    assert.equal(s.ok, false);
    assert.equal(s.needsConsent, true, 'teks berubah → pemegang token harus menyetujui ulang');
    assert.equal(s.version, '0.1', 'versi lama tetap dilaporkan untuk konteks');
  });
});
