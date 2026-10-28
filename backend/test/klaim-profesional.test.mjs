import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const baca = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('hero menjelaskan biaya dan integrasi, bukan menjanjikan semua data selalu lokal', () => {
  const hero = baca('home.html').match(/<p class="hero-lede">([\s\S]*?)<\/p>/)?.[1] ?? '';
  assert.doesNotMatch(hero, /tanpa data yang keluar|tanpa tagihan bulanan/i);
  assert.match(hero, /API/);
  assert.match(hero, /integrasi/i);
});
test('judul dan FAQ paket mengikuti hak akses yang sebenarnya', async () => {
  const { buildPricing } = await import('../src/pricing.mjs');
  const data = buildPricing();
  assert.doesNotMatch(JSON.stringify(data.judul), /Tiga paket/);
  const token = data.faq.find(f => /Apa itu token/i.test(f.tanya));
  assert.match(token.jawab, /sesuai hak paket/);
  const star = data.faq.find(f => /bonus.*star/i.test(f.tanya));
  assert.doesNotMatch(star.jawab, /mengetik nama pengguna/);
});

test('harga akses kode dibedakan dari biaya jasa pembangunan', () => {
  assert.match(baca('pricing.html'), /bukan biaya pembuatan sistem/);
  assert.match(baca('home.html'), /akses kode.*berbeda dari biaya jasa/i);
});
