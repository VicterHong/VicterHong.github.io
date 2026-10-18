import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projects } from '../../assets/js/data/projects.js';
import { readFileSync } from 'node:fs';

test('public project catalogue carries no protected metrics or technical highlights', () => {
  for (const p of projects) {
    assert.equal(p.metrics.length, 0, p.slug);
    assert.equal(p.highlights.length, 0, p.slug);
  }
});

test('home HTML does not ship the protected total test count', () => {
  const html = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-target="1505"|1\.505 tes otomatis/);
});
