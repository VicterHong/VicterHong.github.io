import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb } from '../src/db.mjs';
import { prune, RETENTION } from '../src/retention.mjs';

const dirs = [];
afterEach(() => {
  closeDb();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vivastic-retention-'));
  dirs.push(dir);
  const db = openDb(join(dir, 'fixture.db'));
  return db;
}

test('retention prunes only eligible old telemetry rows in bounded batches', async () => {
  const db = fixtureDb();
  const now = Date.now();
  db.prepare('INSERT INTO access_events (action, outcome, at) VALUES (?, ?, ?)').run('old', 'ok', now - 3 * 86_400_000);
  db.prepare('INSERT INTO access_events (action, outcome, at) VALUES (?, ?, ?)').run('recent', 'ok', now);

  const result = await prune('access_events', { days: 1, batch: 1, maxBatches: 5 });
  assert.deepEqual(result, { deleted: 1, done: true });
  assert.deepEqual(db.prepare('SELECT action FROM access_events ORDER BY at').all().map((r) => r.action), ['recent']);
});

test('retention policy is an explicit allowlist and refuses business data tables', async () => {
  fixtureDb();
  assert.deepEqual(Object.keys(RETENTION), ['access_events', 'analytics_events', 'device_fingerprints', 'web_vitals', 'experiment_events']);
  await assert.rejects(prune('payments'), /tabel tidak boleh di-prune/);
});
