import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/backup-restore-drill.mjs', import.meta.url));

test('backup/restore dry-run uses isolated synthetic data and leaves source unchanged', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 45_000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /DRILL_OK synthetic backup\+restore verified; source unchanged; no production\/R2 access/);
});
