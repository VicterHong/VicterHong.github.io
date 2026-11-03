import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaser } from '../../scripts/watch-projects.mjs';

function harness({ publish, failAt } = {}) {
  const calls = [];
  const run = (step) => { calls.push(step); if (step === failAt) throw new Error(`${step} gagal`); };
  const releaser = createReleaser({
    publish: publish ?? (() => ({ changed: true, published: ['kasir-toko'] })),
    deploy: () => run('deploy'),
    commit: (r) => run(`commit:${r.published.join(',')}`),
    log: () => {},
  });
  return { releaser, calls };
}

test('perubahan katalog -> deploy dulu, baru commit', async () => {
  const { releaser, calls } = harness();
  const r = await releaser.release();
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['deploy', 'commit:kasir-toko']);
});

test('tanpa perubahan tidak deploy dan tidak commit', async () => {
  const { releaser, calls } = harness({ publish: () => ({ changed: false, published: [] }) });
  const r = await releaser.release();
  assert.equal(r.ok, true);
  assert.deepEqual(calls, []);
});

test('folder tidak sah: berhenti sebelum deploy, produksi tidak tersentuh', async () => {
  const { releaser, calls } = harness({ publish: () => { throw new Error('slug Salah tidak sah'); } });
  const r = await releaser.release();
  assert.equal(r.ok, false);
  assert.match(r.error, /tidak sah/);
  assert.deepEqual(calls, []);
});

test('deploy gagal: tidak commit (repo tidak mengklaim yang belum live)', async () => {
  const { releaser, calls } = harness({ failAt: 'deploy' });
  const r = await releaser.release();
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ['deploy']);
});

test('rilis bersamaan digabung: satu berjalan, satu antre ulang', async () => {
  let resolve;
  let n = 0;
  const releaser = createReleaser({
    publish: () => { n += 1; return { changed: false, published: [] }; },
    deploy: () => {}, commit: () => {}, log: () => {},
    gate: () => (resolve ? Promise.resolve() : new Promise((r) => { resolve = r; })),
  });
  const a = releaser.release();
  const b = releaser.release();
  resolve();
  await a; await b;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(n, 2, 'satu rilis lanjutan, bukan dua paralel');
});
