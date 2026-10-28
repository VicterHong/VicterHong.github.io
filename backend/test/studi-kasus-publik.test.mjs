import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const home = () => readFileSync(new URL('../../home.html', import.meta.url), 'utf8');

test('tiga studi kasus tersanitasi tersedia tanpa login atau JavaScript', () => {
  for (const slug of ['mina', 'spareparts', 'whatsapp-bot']) {
    const article = home().match(new RegExp(`<article[^>]+id="case-${slug}"[\\s\\S]*?<\\/article>`))?.[0] ?? '';
    assert.match(article, /Peran/);
    assert.match(article, /Batas/);
    assert.match(article, /Keluaran/);
    assert.doesNotMatch(article, /tes otomatis|secret|api_key|token_id|\b\d+\s*MB/);
  }
});
