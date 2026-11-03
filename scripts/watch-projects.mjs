#!/usr/bin/env node
/**
 * Pengawas folder projects/ di server. Taruh atau ubah projects/<slug>/,
 * situs terbit sendiri.
 *
 * Urutan satu rilis (perubahan beruntun digabung dalam jeda):
 *   1. publishProjects  -> validasi semua folder; satu folder rusak = BATAL
 *   2. deploy-aman      -> build, preflight, verifikasi dist, deploy
 *   3. commit + push    -> hanya katalog publik + aset terpilih, setelah live
 *
 * Gagal di langkah mana pun = berhenti; produksi dan repo tidak diubah oleh
 * langkah sesudahnya. Hanya satu rilis berjalan; yang datang saat sibuk
 * diantre sebagai satu rilis lanjutan.
 */
import { watch, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishProjects } from './publish-projects.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createReleaser({ publish, deploy, commit, log = console.log, gate = null }) {
  let running = false;
  let again = false;

  async function once() {
    let result;
    try {
      result = publish();
    } catch (error) {
      log(`rilis DIBATALKAN (folder tidak sah): ${error.message}`);
      return { ok: false, error: error.message };
    }
    if (!result.changed) {
      log('tidak ada perubahan katalog, rilis dilewati');
      return { ok: true, changed: false };
    }
    try {
      deploy();
      commit(result);
    } catch (error) {
      log(`rilis GAGAL: ${error.message}`);
      return { ok: false, error: error.message };
    }
    log(`rilis selesai: ${result.published.length} proyek dari folder`);
    return { ok: true, changed: true };
  }

  async function release() {
    if (running) { again = true; return { ok: true, queued: true }; }
    running = true;
    try {
      if (gate) await gate();
      return await once();
    } finally {
      running = false;
      if (again) { again = false; setTimeout(release, 0); }
    }
  }

  return { release };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
}

function commitCatalog(result) {
  // Hanya jalur publik yang sudah disaring. projects/ di-ignore, jadi
  // project.md mentah tidak pernah ikut.
  git(['add', '--', 'assets/js/data/projects.generated.js', 'assets/projects']);
  if (!git(['diff', '--cached', '--name-only']).trim()) return;
  git(['-c', 'user.name=portfolio-bot', '-c', 'user.email=portfolio-bot@localhost',
    'commit', '-q', '-m', `content(projects): terbitkan ${result.published.join(', ') || 'perubahan'} dari folder server`]);
  git(['push', '-q', 'origin', 'HEAD:main']);
}

function main() {
  const source = join(ROOT, 'projects');
  if (!existsSync(source)) mkdirSync(source, { recursive: true, mode: 0o750 });
  const delay = Number(process.env.JEDA_MS ?? 20_000);
  const doDeploy = process.env.PROJECTS_DEPLOY !== 'false';
  const doPush = process.env.PROJECTS_PUSH !== 'false';
  const log = (...a) => console.log(new Date().toISOString(), ...a);

  const releaser = createReleaser({
    publish: () => publishProjects({ root: ROOT }),
    deploy: () => { if (doDeploy) execFileSync(process.execPath, ['scripts/deploy-aman.mjs'], { cwd: ROOT, stdio: 'inherit' }); },
    commit: (r) => { if (doPush) commitCatalog(r); },
    log,
  });

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => releaser.release(), delay); };
  watch(source, { recursive: true }, (_, name) => {
    // Abaikan berkas sementara unggahan/editor supaya rilis tidak terpicu setengah jalan.
    if (name && /(^|\/)\.|~$|\.(swp|part|tmp|crdownload)$/i.test(name)) return;
    schedule();
  });
  log(`mengawasi ${source} (jeda ${delay / 1000}s, deploy=${doDeploy}, push=${doPush})`);
  schedule();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
