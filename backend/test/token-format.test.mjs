/**
 * Tes validasi format token di klien (logika yang sama dengan project.js).
 *
 * Token format: VP-XXXX-XXXX-XXXX-XXXX
 *   - Prefix VP-
 *   - 4 segmen × 4 karakter base32 (A–Z tanpa I/O/L, angka 2–9)
 *   - Input dinormalkan ke huruf besar dulu
 *
 * Tes ini memastikan regex klien konsisten dengan format issueToken()
 * di backend/src/tokens.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { issueToken } from '../src/tokens.mjs';
import { openDb, closeDb } from '../src/db.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Salinan regex klien (dari assets/js/project.js). */
const TOKEN_RE = /^VP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tokenfmt-test-'));
  openDb(join(dir, 'test.db'));
  try {
    return fn();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Token yang diterbitkan backend lolos regex klien ─────────────────────────

test('token yang diterbitkan issueToken lolos validasi format klien', () => {
  withDb(() => {
    for (let i = 0; i < 20; i += 1) {
      const { token } = issueToken({ secret: 'test-secret-panjang-untuk-tes', projectSlug: 'mina' });
      assert.match(token, TOKEN_RE, `token terbitan harus lolos regex klien: ${token}`);
    }
  });
});

test('token terbitan dinormalkan huruf besar tetap lolos', () => {
  withDb(() => {
    const { token } = issueToken({ secret: 'test-secret-panjang-untuk-tes', projectSlug: 'mina' });
    assert.match(token.toUpperCase(), TOKEN_RE);
    assert.match(token.toLowerCase().toUpperCase(), TOKEN_RE,
      'pengunjung yang mengetik huruf kecil harus tetap bisa setelah normalisasi');
  });
});

// ── Format yang ditolak ──────────────────────────────────────────────────────

test('token kosong ditolak', () => {
  assert.doesNotMatch('', TOKEN_RE);
});

test('token tanpa prefix VP ditolak', () => {
  assert.doesNotMatch('Y2DS-2DWM-CN92-GGBZ', TOKEN_RE);
});

test('token dengan segmen kurang ditolak', () => {
  assert.doesNotMatch('VP-Y2DS-2DWM-CN92', TOKEN_RE);
});

test('token dengan segmen lebih ditolak', () => {
  assert.doesNotMatch('VP-Y2DS-2DWM-CN92-GGBZ-EXTRA', TOKEN_RE);
});

test('token dengan spasi di dalam ditolak', () => {
  assert.doesNotMatch('VP-Y2DS 2DWM-CN92-GGBZ', TOKEN_RE);
});

test('token dengan karakter di luar base32 ditolak', () => {
  assert.doesNotMatch('VP-Y2D$-2DWM-CN92-GGBZ', TOKEN_RE);
});

test('token huruf kecil ditolak SEBELUM normalisasi (klien normalisasi dulu)', () => {
  assert.doesNotMatch('vp-y2ds-2dwm-cn92-ggbz', TOKEN_RE,
    'regex tanpa /i — normalisasi toUpperCase() dilakukan sebelum tes');
});
