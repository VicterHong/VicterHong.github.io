#!/usr/bin/env node
/** Refresh evidence in PRIVATE presentation.json. Never write public catalogue JS. */
import { readFileSync, writeFileSync, existsSync, readdirSync, chmodSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SOURCES = {
  mina: { repo: join(homedir(), 'mina-remote-control'), polaTes: /^\s*def test_/gm, polaBerkasTes: /^test_.*\.py$/, dirTes: 'tests' },
  spareparts: { repo: join(homedir(), 'spareparts-inventory-system'), polaTes: /^\s*def test_/gm, polaBerkasTes: /^test_.*\.py$/, dirTes: 'tests' },
  'whatsapp-bot': { repo: join(homedir(), 'whatsapp-family-bot'), polaTes: /^\s*test\(/gm, polaBerkasTes: /\.test\.mjs$/, dirTes: 'test', service: 'whatsapp-family-bot' },
};

function readCounts(source) {
  const dir = join(source.repo, source.dirTes);
  if (!existsSync(dir)) return null;
  let total = 0, files = 0;
  for (const name of readdirSync(dir)) {
    source.polaBerkasTes.lastIndex = 0;
    if (!source.polaBerkasTes.test(name)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    total += [...text.matchAll(new RegExp(source.polaTes.source, source.polaTes.flags.includes('g') ? source.polaTes.flags : source.polaTes.flags + 'g'))].length;
    files++;
  }
  return { total, files };
}

/** Atomic private-file update; explicit path and sources permit isolated tests. */
export function syncMetrics({ cataloguePath = join(homedir(), '.portfolio-token/content/presentation.json'), sources = SOURCES, checkOnly = false } = {}) {
  const data = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  let changed = false;
  for (const [slug, source] of Object.entries(sources)) {
    if (!Object.hasOwn(data, slug)) continue;
    const counts = readCounts(source);
    if (!counts) continue;
    const metrics = (data[slug].metrics || []).filter((m) => !['tes otomatis', 'berkas uji', 'RAM saat jalan'].includes(m.label));
    metrics.unshift({ label: 'tes otomatis', value: String(counts.total) }, { label: 'berkas uji', value: String(counts.files) });
    if (source.service) {
      try {
        const bytes = Number(execFileSync('systemctl', ['--user', 'show', source.service, '-p', 'MemoryCurrent', '--value'], { encoding: 'utf8', timeout: 10000 }).trim());
        if (Number.isFinite(bytes) && bytes > 0) metrics.push({ label: 'RAM saat jalan', value: `${Math.max(8, Math.round(bytes / 1024 / 1024 / 8) * 8)} MB` });
      } catch { /* absence is not evidence of a zero memory footprint */ }
    }
    if (JSON.stringify(metrics) !== JSON.stringify(data[slug].metrics)) { changed = true; data[slug].metrics = metrics; }
  }
  if (changed && !checkOnly) {
    const temporary = `${cataloguePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, cataloguePath);
  }
  return { changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes('--check');
  try {
    const { changed } = syncMetrics({ checkOnly });
    console.log(changed ? (checkOnly ? 'Private metrics require refresh.' : 'Private metrics refreshed; public assets unchanged.') : 'Private metrics unchanged.');
    if (changed && checkOnly) process.exitCode = 1;
  } catch (error) {
    console.error('Private metrics refresh failed:', error.code || error.name);
    process.exitCode = 2;
  }
}
