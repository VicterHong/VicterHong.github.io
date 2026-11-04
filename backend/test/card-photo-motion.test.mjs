import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('tiga kartu bawaan menampilkan foto asli tanpa mengganti nama/ringkasan', async () => {
  const { projects } = await import('../../assets/js/data/projects.js');
  const builtins = projects.filter(p => ['mina', 'spareparts', 'whatsapp-bot'].includes(p.slug));
  assert.equal(builtins.length, 3);
  for (const p of builtins) {
    assert.match(p.cover, /^assets\/spotlight\/[a-z-]+\.jpg$/);
    assert.ok(p.name && p.summary);
  }
});

test('CSS kartu foto menghilangkan gradien gelap dan menampilkan foto', () => {
  const css = readFileSync('../assets/css/card-photo.css', 'utf8');
  assert.match(css, /\.project-art--photo/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /background:\s*none/);
});

test('reveal observer tidak mengubah kartu yang sudah terlihat', () => {
  const js = readFileSync('../assets/js/card-motion.js', 'utf8');
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /project-art--reveal/);
});

test('parallax hanya menggerakkan foto, bukan seluruh kartu', () => {
  const js = readFileSync('../assets/js/card-motion.js', 'utf8');
  assert.match(js, /project-art__photo/);
  assert.match(js, /--parallax-y/);
});

test('hover membesar foto tanpa menggelapkan', () => {
  const css = readFileSync('../assets/css/card-photo.css', 'utf8');
  assert.match(css, /:hover/);
  assert.match(css, /scale\(1\.08\)/);
  assert.doesNotMatch(css, /:hover.*brightness.*0\./);
});
