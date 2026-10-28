import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const baca = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('aplikasi akses memakai satu root dan tidak meminta media yang belum tersedia', () => {
  assert.equal([...baca('akses/index.html').matchAll(/id="root"/g)].length, 1);
  const app = baca('akses/app/App.tsx');
  assert.doesNotMatch(app, /ASET.*hero-main|const ASET/);
  assert.match(app, /poster="\/assets\/hero-poster.jpg"/);
  assert.doesNotMatch(app, /disabled>\s*Memuat\s*</);
  assert.match(app, /Belum dibuka/);
  assert.match(app, /RELEASE.closedCta/);
});
test('profil hanya memiliki satu zona tindakan akun', () => {
  const html = baca('keamanan.html').replace(/<!--[\s\S]*?-->/g, '');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  assert.equal(ids.filter(id => id === 'kamHapusAkun').length, 1);
  assert.match(html, /kodeHapus|hapusDialog|kamHapusDialog|dialog/i);
});
