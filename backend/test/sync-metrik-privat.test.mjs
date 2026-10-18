import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// An automatic refresh must never put entitled evidence back in the public JS.
test('metric sync updates private presentation only, preserves highlights, and is idempotent', async () => {
  const { syncMetrics } = await import('../../scripts/sync-metrik.mjs');
  const root = mkdtempSync(join(tmpdir(), 'private-metrics-'));
  try {
    const repo = join(root, 'source');
    mkdirSync(join(repo, 'tests'), { recursive: true });
    writeFileSync(join(repo, 'tests', 'test_example.py'), 'def test_a(): pass\ndef test_b(): pass\n');
    const cataloguePath = join(root, 'presentation.json');
    writeFileSync(cataloguePath, JSON.stringify({ example: { metrics: [], highlights: [{ title: 'Preserve me' }] } }));
    const sources = { example: { repo, dirTes: 'tests', polaBerkasTes: /^test_.*\.py$/, polaTes: /^def test_/gm } };
    const before = readFileSync(cataloguePath, 'utf8');
    const check = syncMetrics({ cataloguePath, sources, checkOnly: true });
    assert.equal(check.changed, true);
    assert.equal(readFileSync(cataloguePath, 'utf8'), before);
    assert.equal(syncMetrics({ cataloguePath, sources }).changed, true);
    const after = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    assert.equal(after.example.metrics.find((m) => m.label === 'tes otomatis').value, '2');
    assert.deepEqual(after.example.highlights, [{ title: 'Preserve me' }]);
    assert.equal(statSync(cataloguePath).mode & 0o777, 0o600);
    assert.equal(syncMetrics({ cataloguePath, sources }).changed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
