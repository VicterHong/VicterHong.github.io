import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { totalTestCount } from '../src/project-details.mjs';

test('total tes hero menjumlahkan SEMUA proyek, bukan hanya yang sudah dibuka', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hero-tes-'));
  try {
    writeFileSync(join(dir, 'presentation.json'), JSON.stringify({
      mina: { metrics: [{ label: 'tes otomatis', value: '231' }, { label: 'berkas uji', value: '4' }], highlights: [] },
      spareparts: { metrics: [], highlights: [] },
      'whatsapp-bot': { metrics: [{ label: 'tes otomatis', value: '1.854' }], highlights: [] },
    }));
    assert.equal(totalTestCount(dir), 2085);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('katalog hilang atau rusak = null, bukan 0 palsu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hero-tes-'));
  try {
    assert.equal(totalTestCount(dir), null);
    writeFileSync(join(dir, 'presentation.json'), '{rusak');
    assert.equal(totalTestCount(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('/api/akses mengirim total tes ke pengguna yang sudah masuk', () => {
  const src = readFileSync(new URL('../src/routes.mjs', import.meta.url), 'utf8');
  assert.match(src, /totalTes:\s*totalTestCount\(\)/);
});

test('hero memakai total server, tidak menampilkan 0 saat data belum ada', () => {
  const app = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /akses\.totalTes/);
  assert.match(app, /tes otomatis/);
});
