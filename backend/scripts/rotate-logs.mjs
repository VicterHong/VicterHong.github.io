/**
 * Rotasi log — mencegah log tumbuh tanpa batas.
 *
 * Masalah: uptime.log dan sejenisnya ditulis append terus-menerus. Dalam
 * hitungan bulan file bisa mencapai ratusan MB, memenuhi disk VPS kecil
 * (yang juga dipakai database & backup).
 *
 * Kebijakan:
 *   - File > 5 MB diputar (rename dengan cap waktu)
 *   - Simpan maksimal 5 arsip per file (yang tertua dihapus)
 *   - Arsip lebih tua dari 90 hari dihapus (batas kedua, jaga-jaga)
 *
 * Dijalankan dari cron harian — ringan, tidak menyentuh file yang kecil.
 *
 * Jalankan manual: node backend/scripts/rotate-logs.mjs
 */

import { statSync, renameSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.portfolio-token');
const ARCHIVE_DIR = join(LOG_DIR, 'archive');

const MAX_BYTES = 5 * 1024 * 1024;   // 5 MB per file
const MAX_ARCHIVES = 5;               // per file
const MAX_AGE_DAYS = 90;

// File log yang dikelola (sengaja eksplisit — tidak menyapu semua file).
const LOGS = [
  'uptime.log',
  'uptime-cron.log',
  'backup.log',
  'deploy.log',
];

function log(msg) {
  console.log(`[rotate] ${msg}`);
}

mkdirSync(ARCHIVE_DIR, { recursive: true });

let rotated = 0, deleted = 0;

// ── 1. Putar file yang melebihi batas ───────────────────────────────────────
for (const name of LOGS) {
  const file = join(LOG_DIR, name);
  if (!existsSync(file)) continue;

  let size = 0;
  try { size = statSync(file).size; } catch { continue; }
  if (size <= MAX_BYTES) continue;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archived = join(ARCHIVE_DIR, `${name}.${stamp}`);

  try {
    renameSync(file, archived);
    log(`${name} (${Math.round(size / 1024)} KB) → ${basename(archived)}`);
    rotated++;
  } catch (err) {
    log(`GAGAL memutar ${name}: ${err.message}`);
  }
}

// ── 2. Batasi jumlah arsip per file ─────────────────────────────────────────
const archives = readdirSync(ARCHIVE_DIR).filter(f => !f.startsWith('.'));

for (const name of LOGS) {
  const mine = archives
    .filter(f => f.startsWith(`${name}.`))
    .sort();  // cap waktu ISO → urutan leksikografis = urutan waktu

  // Hapus yang berlebih (terlama dulu).
  const excess = mine.slice(0, Math.max(0, mine.length - MAX_ARCHIVES));
  for (const f of excess) {
    try {
      unlinkSync(join(ARCHIVE_DIR, f));
      log(`hapus arsip lama: ${f}`);
      deleted++;
    } catch { /* sudah hilang */ }
  }
}

// ── 3. Hapus arsip lebih tua dari MAX_AGE_DAYS ──────────────────────────────
const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
for (const f of readdirSync(ARCHIVE_DIR)) {
  const full = join(ARCHIVE_DIR, f);
  try {
    if (statSync(full).mtimeMs < cutoff) {
      unlinkSync(full);
      log(`hapus arsip kedaluwarsa: ${f}`);
      deleted++;
    }
  } catch { /* abaikan */ }
}

log(`selesai — ${rotated} diputar, ${deleted} dihapus`);
