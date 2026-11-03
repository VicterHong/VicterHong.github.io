#!/usr/bin/env node
/**
 * Pengawas folder projects/: taruh atau ubah projects/<nama>/ di server, situs
 * terbit sendiri.
 *
 * Alur setiap ada perubahan (digabung dalam jeda 20 detik, supaya menyalin
 * beberapa berkas = satu rilis):
 *   1. publish-projects  → tolak folder yang tidak sah, tulis berkas hasil
 *   2. (kalau ada yang berubah) deploy-aman  → build, preflight, verifikasi, deploy
 *   3. commit + push berkas hasil, supaya repo dan produksi sama
 *
 * Kalau satu langkah gagal, rilis dibatalkan dan produksi tidak tersentuh
 * (deploy-aman sudah begitu). Kegagalan dicatat ke log journal systemd.
 *
 * Jalankan sebagai layanan: scripts/portfolio-projects-watch.service
 */
import { watch, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terbitkan } from './publish-projects.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUMBER = join(ROOT, 'projects');
const JEDA_MS = Number(process.env.JEDA_MS ?? 20_000);
const DEPLOY = process.env.PROJECTS_DEPLOY !== 'false';
const PUSH = process.env.PROJECTS_PUSH !== 'false';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const jalankan = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

let timer = null;
let sibuk = false;
let lagi = false;

function rilis() {
  if (sibuk) { lagi = true; return; }
  sibuk = true;
  try {
    const r = terbitkan({ root: ROOT, log });
    if (!r.berubah) { log('tidak ada perubahan pada daftar proyek, rilis dilewati'); return; }
    if (DEPLOY) jalankan(process.execPath, ['scripts/deploy-aman.mjs']);
    if (PUSH) {
      jalankan('git', ['add', 'assets/js/data/projects.generated.js', 'projects']);
      const ada = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT }).toString().trim();
      if (ada) {
        jalankan('git', ['-c', 'user.name=portfolio-bot', '-c', 'user.email=portfolio-bot@localhost',
          'commit', '-q', '-m', `content(projects): terbitkan ${r.diterbitkan.join(', ') || 'perubahan'} dari folder`]);
        jalankan('git', ['push', '-q', 'origin', 'HEAD']);
      }
    }
    log(`rilis selesai: ${r.diterbitkan.length} proyek dari folder`);
  } catch (error) {
    log('rilis GAGAL, produksi tidak diubah:', error.message);
  } finally {
    sibuk = false;
    if (lagi) { lagi = false; jadwalkan(); }
  }
}

function jadwalkan() {
  clearTimeout(timer);
  timer = setTimeout(rilis, JEDA_MS);
}

if (!existsSync(SUMBER)) mkdirSync(SUMBER, { recursive: true });
watch(SUMBER, { recursive: true }, (_, nama) => {
  if (nama && /(^|\/)\.|~$|\.swp$|\.part$/.test(nama)) return; // berkas sementara editor/unggahan
  jadwalkan();
});
log(`mengawasi ${SUMBER} (jeda ${JEDA_MS / 1000} detik, deploy=${DEPLOY}, push=${PUSH})`);
jadwalkan();
