import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('panduan membedakan token mandiri dari diskusi akses manual', () => {
  const html = readFileSync(new URL('../../docs.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/klien"/);
  assert.match(html, /mailto:vivastic\.id@gmail\.com/);
  assert.doesNotMatch(html, /isi form permintaan akses|Gunakan form permintaan akses|1–2 hari kerja/);
  assert.match(html, /sesuai hak paket/i);
  assert.doesNotMatch(html, /Semuanya masih dalam pengembangan/);
});
