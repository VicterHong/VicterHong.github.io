import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('checkout bersih menyertakan seluruh dependency lokal entrypoint server', () => {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n'));
  const pending = [resolve(ROOT, 'backend/src/server.mjs')];
  const seen = new Set();
  const missing = [];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!tracked.has(relative(ROOT, file))) missing.push(relative(ROOT, file));
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      if (/\.(?:mjs|js)$/.test(specifier)) pending.push(resolve(dirname(file), specifier));
    }
  }
  assert.deepEqual(missing, [], 'modul yang ada di laptop tetapi tidak di git membuat server CI gagal boot');
});
