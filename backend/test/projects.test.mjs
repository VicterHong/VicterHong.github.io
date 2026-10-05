/**
 * Test daftar proyek — sumber kebenaran tunggal untuk panel admin.
 * Jalankan: node --test test/projects.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { listProjects, isKnownProject, clearProjectsCache } = await import('../src/projects.mjs');

test('daftar proyek dibaca dari berkas data frontend', () => {
  clearProjectsCache();
  const projects = listProjects();

  // Minimal ada proyek nyata (bukan daftar kosong).
  assert.ok(projects.length >= 2, `harus menemukan ≥2 proyek, dapat ${projects.length}`);

  // Setiap entri punya slug dan name yang terisi.
  for (const p of projects) {
    assert.ok(p.slug && /^[a-z0-9-]+$/.test(p.slug), `slug valid: ${p.slug}`);
    assert.ok(p.name && p.name.length > 0, `name terisi untuk ${p.slug}`);
  }
});

test('proyek yang dikenal terdeteksi benar', () => {
  clearProjectsCache();
  assert.equal(isKnownProject('mina'), true, 'mina harus dikenal');
});

test('proyek yang tidak ada ditolak', () => {
  clearProjectsCache();
  assert.equal(isKnownProject('proyek-karangan'), false);
  assert.equal(isKnownProject(''), false);
});

test('slug duplikat tidak muncul dua kali', () => {
  clearProjectsCache();
  const projects = listProjects();
  const slugs = projects.map(p => p.slug);
  const unique = new Set(slugs);
  assert.equal(slugs.length, unique.size, 'tidak boleh ada slug duplikat');
});

test('daftar di-cache (tidak membaca berkas berulang)', () => {
  clearProjectsCache();
  const first = listProjects();
  const second = listProjects();
  // Objek yang sama = cache bekerja (bukan baca ulang).
  assert.equal(first, second, 'panggilan kedua harus mengembalikan objek cache yang sama');
});

test('clearProjectsCache memaksa baca ulang', () => {
  const before = listProjects();
  clearProjectsCache();
  const after = listProjects();
  assert.notEqual(before, after, 'setelah clear, objek baru dibuat');
  assert.deepEqual(before, after, 'isinya tetap sama');
});
