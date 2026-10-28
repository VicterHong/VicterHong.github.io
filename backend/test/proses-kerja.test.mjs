import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('menu Proses mencapai tahapan kerja sama dan batas jasa yang jelas', () => {
  const html = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');
  const section = html.match(/<section[^>]+id="5nfyzw"[\s\S]*?<\/section>/)?.[0] ?? '';
  for (const text of ['Cara bekerja sama', 'Brief', 'Penawaran', 'Pengembangan', 'Serah terima', 'revisi', 'kepemilikan', 'API']) assert.ok(section.includes(text), `${text} harus terlihat di Proses`);
  assert.match(section, /<details/);
});
