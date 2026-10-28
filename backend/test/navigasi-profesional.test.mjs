import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baca = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
test('tautan kembali lintas halaman menuju anchor beranda, bukan gate', () => {
  const home = baca('home.html');
  const ids = new Set([...home.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const files = ['changelog.html', 's/e7kz4swubfvg/index.html', 's/zsvjp554dkt4/index.html'];
  const broken = [];
  for (const file of files) {
    for (const [, href] of baca(file).matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith('../../#') || href.startsWith('/#')) broken.push(`${file}: ${href}`);
      if (href.startsWith('/home#') && !ids.has(href.split('#')[1])) broken.push(`${file}: ${href}`);
    }
  }
  assert.deepEqual(broken, []);
});
