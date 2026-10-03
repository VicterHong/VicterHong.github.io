/**
 * Backup harian database token — PRD §8 "Backup: Token database
 * di-backup otomatis harian".
 *
 * Pakai `node:sqlite` bawaan Node (bukan CLI sqlite3 yang belum tentu
 * terpasang) — konsisten dengan filosofi nol-dependency proyek ini.
 *
 * Aman untuk layanan yang berjalan: VACUUM INTO membaca snapshot
 * konsisten tanpa menghentikan server (SQLite WAL mendukung pembaca
 * bersamaan dengan penulis).
 *
 * Salinan DIVERIFIKASI dengan PRAGMA integrity_check + hitungan baris
 * sebelum dianggap sah. Backup rusak lebih berbahaya daripada tidak ada
 * backup — membuat orang merasa aman padahal tidak.
 *
 * Dijalankan cron harian 03:45. Retensi 30 hari.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.TOKEN_DATA_DIR ?? join(homedir(), '.portfolio-token');
const DB = join(DATA_DIR, 'tokens.db');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // 20261003-171342 → 20261003171342
let dest = join(BACKUP_DIR, `tokens-${stamp}.db`);

// Kalau nama sudah ada (dua backup dalam detik yang sama — mis. cron +
// manual), tambahkan sufiks supaya VACUUM INTO tidak gagal. Backup tidak
// boleh hilang hanya karena tabrakan nama.
if (existsSync(dest)) {
  let n = 2;
  while (existsSync(join(BACKUP_DIR, `tokens-${stamp}-${n}.db`))) n += 1;
  dest = join(BACKUP_DIR, `tokens-${stamp}-${n}.db`);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

if (!existsSync(DB)) {
  log(`⚠️  database tidak ditemukan: ${DB}`);
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });

// ── Salinan konsisten (aman untuk layanan yang berjalan) ────────────────────
try {
  const src = new DatabaseSync(DB, { readOnly: true });
  src.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  src.close();
} catch (err) {
  log(`❌ backup gagal: ${err.message}`);
  process.exit(1);
}

chmodSync(dest, 0o600);

// ── Verifikasi salinan ──────────────────────────────────────────────────────
let tokens = '?', events = '?', leads = '?';
try {
  const copy = new DatabaseSync(dest, { readOnly: true });
  const integrity = copy.prepare('PRAGMA integrity_check').get();
  const result = integrity?.integrity_check ?? Object.values(integrity ?? {})[0];

  if (result !== 'ok') {
    copy.close();
    unlinkSync(dest);
    log(`❌ salinan rusak (integrity_check: ${result}) — dihapus`);
    process.exit(1);
  }

  tokens = copy.prepare('SELECT COUNT(*) AS n FROM tokens').get()?.n ?? 0;
  events = copy.prepare('SELECT COUNT(*) AS n FROM access_events').get()?.n ?? 0;
  leads = copy.prepare('SELECT COUNT(*) AS n FROM sales_leads').get()?.n ?? 0;
  copy.close();
} catch (err) {
  try { unlinkSync(dest); } catch { /* sudah hilang */ }
  log(`❌ salinan tidak bisa dibaca (${err.message}) — dihapus`);
  process.exit(1);
}

// ── Retensi ─────────────────────────────────────────────────────────────────
let deleted = 0;
const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
try {
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!/^tokens-\d+(-\d+)?\.db$/.test(name)) continue;
    const path = join(BACKUP_DIR, name);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      deleted += 1;
    }
  }
} catch { /* retensi gagal bukan alasan membatalkan backup */ }

const sizeKb = Math.round(statSync(dest).size / 1024);
log(`✅ backup ${dest} (${sizeKb} KB) — ${tokens} token, ${events} event, ${leads} lead, ${deleted} arsip lama dihapus`);
