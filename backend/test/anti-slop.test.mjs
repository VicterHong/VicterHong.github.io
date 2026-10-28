import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');
const DIST = join(AKAR, 'dist');

test('anti-slop: dist/ tidak membocorkan komentar developer atau banner ──', () => {
  if (!existsSync(DIST)) return;
  const bocor = [];
  function periksa(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { periksa(p); continue; }
      if (!/\.(html|js|css)$/.test(e.name)) continue;
      const isi = readFileSync(p, 'utf8');
      if (/\/\*[\s\S]*?──[\s\S]*?\*\/|\/\/[^\n]*──[^\n]*/.test(isi)) {
        bocor.push(e.name);
      }
    }
  }
  periksa(DIST);
  assert.deepEqual(bocor, [], `komentar banner developer bocor ke dist: ${bocor.join(', ')}`);
});

test('anti-slop: tidak ada em-dash di teks tampak changelog dan pricing', () => {
  for (const f of ['changelog.html', 'pricing.html']) {
    const raw = readFileSync(join(AKAR, f), 'utf8');
    const clean = raw.replace(/<!--[\s\S]*?-->/g, '');
    const lines = clean.split('\n');
    const pelanggar = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // abaikan tag komentar atau blok script internal jika ada
      if (line.includes('—') && !line.startsWith('//') && !line.includes('="—"') && !line.includes('>—<')) {
        pelanggar.push(`${f}:${i + 1} -> ${line.slice(0, 80)}`);
      }
    }
    assert.deepEqual(pelanggar, [], `em-dash ditemukan di ${f}: ${pelanggar.join(' | ')}`);
  }
});

test('anti-slop: tidak ada pola AI tell (bukan sekadar X tapi Y / bukan X melainkan Y) di teks publik', () => {
  const docs = readFileSync(join(AKAR, 'docs.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const privasi = readFileSync(join(AKAR, 'privasi.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(docs, /bukan sekadar\s+[^,.]+,?\s+(?:tapi|melainkan)/i);
  assert.doesNotMatch(privasi, /bukan token aslinya,\s*melainkan/i);
});
