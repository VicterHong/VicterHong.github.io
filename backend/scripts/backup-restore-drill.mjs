/**
 * Isolated backup/restore dry-run using synthetic SQLite data only.
 * Does not read production paths, call Cloudflare, or touch service state.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'vivastic-backup-drill-'));
const dataDir = join(root, 'source');
const restoreDir = join(root, 'restore');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(restoreDir, { recursive: true, mode: 0o700 });
const sourceDb = join(dataDir, 'tokens.db');
const restoredDb = join(restoreDir, 'tokens.db');
const backupScript = fileURLToPath(new URL('./backup.mjs', import.meta.url));

function rows(db) {
  return Object.fromEntries(['tokens', 'access_events', 'sales_leads'].map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
  ]));
}

try {
  const source = new DatabaseSync(sourceDb);
  source.exec(`
    CREATE TABLE tokens (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
    CREATE TABLE access_events (id INTEGER PRIMARY KEY, event TEXT NOT NULL);
    CREATE TABLE sales_leads (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    INSERT INTO tokens (token) VALUES ('synthetic-token-1'), ('synthetic-token-2');
    INSERT INTO access_events (event) VALUES ('synthetic-event');
    INSERT INTO sales_leads (email) VALUES ('fixture@example.invalid');
  `);
  const expected = rows(source);
  source.close();

  const run = spawnSync(process.execPath, [backupScript], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: process.env.PATH ?? '', TOKEN_DATA_DIR: dataDir, BACKUP_RETENTION_DAYS: '30' },
  });
  if (run.status !== 0) throw new Error(`backup fixture failed: ${(run.stderr || run.stdout).trim()}`);
  const backupName = readdirSync(join(dataDir, 'backups')).find((name) => /^tokens-\d+(-\d+)?\.db$/.test(name));
  if (!backupName) throw new Error('verified backup fixture was not created');
  const backupPath = join(dataDir, 'backups', backupName);
  if ((statSync(backupPath).mode & 0o777) !== 0o600) throw new Error('backup permissions are not 0600');

  // Simulate restore into an isolated destination, then validate before any swap.
  const fixtureCopy = new DatabaseSync(backupPath, { readOnly: true });
  const integrity = fixtureCopy.prepare('PRAGMA integrity_check').get();
  const result = integrity?.integrity_check ?? Object.values(integrity ?? {})[0];
  if (result !== 'ok') throw new Error(`restore fixture integrity failed: ${result}`);
  const copiedRows = rows(fixtureCopy);
  fixtureCopy.close();
  // A database-level copy into the disposable restore target exercises read/write usability.
  const sourceCopy = new DatabaseSync(backupPath, { readOnly: true });
  sourceCopy.exec(`VACUUM INTO '${restoredDb.replace(/'/g, "''")}'`);
  sourceCopy.close();
  const restoredCheck = new DatabaseSync(restoredDb, { readOnly: true });
  const restoredIntegrity = restoredCheck.prepare('PRAGMA integrity_check').get();
  const restoredResult = restoredIntegrity?.integrity_check ?? Object.values(restoredIntegrity ?? {})[0];
  const finalRows = rows(restoredCheck);
  restoredCheck.close();
  rmSync(restoredDb); // do not retain a second copy in the fixture
  if (restoredResult !== 'ok' || JSON.stringify(copiedRows) !== JSON.stringify(expected)
      || JSON.stringify(finalRows) !== JSON.stringify(expected)) {
    throw new Error('restored fixture integrity or row counts differ from synthetic source');
  }

  const sourceAfter = new DatabaseSync(sourceDb, { readOnly: true });
  const unchanged = JSON.stringify(rows(sourceAfter)) === JSON.stringify(expected);
  sourceAfter.close();
  if (!unchanged) throw new Error('source fixture changed during dry-run');
  console.log('DRILL_OK synthetic backup+restore verified; source unchanged; no production/R2 access');
} finally {
  rmSync(root, { recursive: true, force: true });
}
