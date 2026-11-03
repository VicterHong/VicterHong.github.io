import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectCover } from '../../assets/js/uploaded-cover.js';

const doc = { createElement(tag) { return { tagName: tag.toUpperCase() }; } };

test('sampul hasil upload memakai URL lokal dan alt yang jelas', () => {
  const img = createProjectCover({ cover: 'assets/projects/kasir-toko/cover.jpg', coverAlt: 'Kasir Toko saat digunakan', name: 'Kasir Toko' }, doc);
  assert.equal(img.src, 'assets/projects/kasir-toko/cover.jpg');
  assert.equal(img.alt, 'Kasir Toko saat digunakan');
  assert.equal(img.loading, 'lazy');
  assert.equal(img.decoding, 'async');
});

test('tanpa sampul atau URL eksternal tidak menambah media rekaan', () => {
  assert.equal(createProjectCover({ name: 'Kosong' }, doc), null);
  assert.equal(createProjectCover({ cover: 'https://evil.example/1.jpg' }, doc), null);
  assert.equal(createProjectCover({ cover: 'assets/projects/../secret/cover.jpg' }, doc), null);
});
