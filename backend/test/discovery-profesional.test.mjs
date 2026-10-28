import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const baca = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('sitemap hanya mengiklankan halaman canonical yang indexable', () => {
  const urls = [...baca('sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  assert.ok(!urls.includes('/'), 'gate noindex bukan halaman sitemap');
  for (const path of ['/home', '/docs', '/changelog']) assert.ok(urls.includes(path), `${path} masuk sitemap`);
  assert.ok(!urls.includes('/pricing'), 'harga tetap noindex selama belum diluncurkan');
});
test('halaman yang dibagikan punya preview merek dan alt yang eksplisit', () => {
  for (const file of ['docs.html', 'changelog.html', 'pricing.html', 'privasi.html', 'syarat.html']) {
    assert.match(baca(file), /property="og:image"/);
    assert.match(baca(file), /property="og:image:alt"/);
  }
});
