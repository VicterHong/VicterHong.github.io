/**
 * Backup off-site terenkripsi ke Cloudflare R2.
 *
 * ── A7: KENAPA INI PERLU ────────────────────────────────────────────────────
 *
 * Backup harian yang ada menyimpan salinan di `~/.portfolio-token/backups/`
 * — disk yang SAMA dengan database aslinya. Itu bukan backup sejati:
 * satu kegagalan disk, satu `rm -rf` yang salah, atau satu ransomware
 * menghapus database DAN semua backup sekaligus.
 *
 * ── KENAPA DIENKRIPSI ───────────────────────────────────────────────────────
 *
 * Database berisi: token akses (hash), data lead (nama, email, perusahaan),
 * audit log (IP pengunjung), device fingerprint. Itu data sensitif.
 * Cloudflare R2 memang punya enkripsi at-rest, tapi itu melindungi dari
 * pencurian disk fisik — bukan dari akun yang disusupi. Dengan enkripsi
 * di sisi kita, file di R2 tidak berguna tanpa kunci.
 *
 * ── KENAPA AES-256-GCM ──────────────────────────────────────────────────────
 *
 * GCM memberi authenticated encryption: selain menyembunyikan isi, ia
 * mendeteksi kalau file diubah orang lain. Tanpa itu, penyerang yang bisa
 * menulis ke R2 bisa merusak backup dan kita baru tahu saat mencoba restore.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 *
 * 1. VACUUM INTO salinan lokal (konsisten, aman untuk layanan berjalan)
 * 2. Verifikasi integrity_check — backup rusak lebih buruk dari tidak ada
 * 3. Enkripsi dengan AES-256-GCM → .db.enc
 * 4. Upload ke R2 via wrangler
 * 5. Verifikasi objek ada di R2 (bukan hanya "upload tidak error")
 * 6. Hapus file .enc lokal (R2 sudah punya; simpan hanya kalau gagal)
 *
 * ── KUNCI ENKRIPSI ──────────────────────────────────────────────────────────
 *
 * Dibaca dari BACKUP_ENCRYPTION_KEY di service.env (64 hex = 32 byte).
 * Kalau belum ada, skrip MEMBUATNYA dan menulis ke file terpisah dengan
 * izin 0600, lalu memberitahu Anda untuk memindahkannya ke service.env.
 *
 * PENTING: kunci ini HARUS disimpan di tempat lain juga (password manager).
 * Tanpa kunci, backup di R2 tidak bisa dibuka. Backup terenkripsi yang
 * kuncinya hilang = tidak punya backup.
 *
 * Dijalankan setelah backup lokal (03:45), jadi cron: 04:00.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync, existsSync, statSync, readFileSync, writeFileSync,
  unlinkSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const DATA_DIR = process.env.TOKEN_DATA_DIR ?? join(homedir(), '.portfolio-token');
const DB = join(DATA_DIR, 'tokens.db');
const TMP_DIR = join(DATA_DIR, 'backups');
const KEY_FILE = join(DATA_DIR, 'backup-key.txt');
const BUCKET = process.env.R2_BACKUP_BUCKET ?? 'portfolio-assets';
const PREFIX = process.env.R2_BACKUP_PREFIX ?? 'backups';
const ENV_FILE = process.env.TOKEN_SERVICE_ENV ?? join(DATA_DIR, 'service.env');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Kunci enkripsi ──────────────────────────────────────────────────────────
function loadKey() {
  // 1. Dari environment (cara produksi)
  const fromEnv = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');

  // 2. Dari file terpisah (cara pengembangan / sebelum dipindah ke env)
  if (existsSync(KEY_FILE)) {
    const fromFile = readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(fromFile)) return Buffer.from(fromFile, 'hex');
  }

  // 3. Belum ada — buat baru
  const key = randomBytes(32);
  const hex = key.toString('hex');
  writeFileSync(KEY_FILE, hex + '\n', { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  log('🔑 Kunci enkripsi BARU dibuat: ' + KEY_FILE);
  log('   PENTING: pindahkan ke service.env sebagai BACKUP_ENCRYPTION_KEY,');
  log('   dan simpan salinannya di password manager. Tanpa kunci ini,');
  log('   backup di R2 TIDAK BISA DIBUKA.');
  return key;
}

// ── Enkripsi ────────────────────────────────────────────────────────────────
/**
 * Format file: [12 byte IV][16 byte auth tag][ciphertext]
 *
 * IV acak per file — memakai IV tetap dengan kunci sama akan membocorkan
 * pola dan melemahkan GCM sepenuhnya.
 *
 * URUTAN: gzip DULU, baru enkripsi.
 *   Enkripsi tidak mengompres — file 648 KB tetap 648 KB setelah GCM.
 *   Database SQLite berisi banyak teks (JSON, audit detail, user agent)
 *   yang mengompres dengan baik: 648 KB → ~100 KB. Mengompres dulu berarti
 *   yang dienkripsi (dan diupload) jauh lebih kecil.
 *
 *   Urutan sebaliknya (enkripsi lalu gzip) TIDAK berguna: ciphertext sudah
 *   acak, jadi tidak bisa dikompres sama sekali.
 */
function encryptFile(srcPath, destPath, key) {
  const plain = readFileSync(srcPath);
  const compressed = gzipSync(plain, { level: 9 });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(destPath, Buffer.concat([iv, tag, enc]), { mode: 0o600 });
  chmodSync(destPath, 0o600);
  return {
    plainBytes: plain.length,
    compressedBytes: compressed.length,
    encBytes: iv.length + tag.length + enc.length,
  };
}

// ── Upload ke R2 ────────────────────────────────────────────────────────────
function uploadToR2(localPath, remoteKey) {
  // wrangler r2 object put <bucket>/<key> --file <path> --remote
  // --remote penting: tanpa itu wrangler menulis ke emulasi lokal, bukan R2.
  const out = execFileSync('wrangler', [
    'r2', 'object', 'put', `${BUCKET}/${remoteKey}`,
    '--file', localPath,
    '--remote',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  return out;
}

/** Verifikasi objek benar-benar ada di R2 (bukan hanya "upload tidak error"). */
function verifyRemote(remoteKey) {
  try {
    const out = execFileSync('wrangler', [
      'r2', 'object', 'get', `${BUCKET}/${remoteKey}`,
      '--remote', '--pipe',
    ], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 });
    return out.length;
  } catch {
    return 0;
  }
}

// ── Jalankan ────────────────────────────────────────────────────────────────
if (!existsSync(DB)) {
  log(`⚠️  database tidak ditemukan: ${DB}`);
  process.exit(1);
}

mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const plainPath = join(TMP_DIR, `.offsite-${stamp}.db`);
const encPath = join(TMP_DIR, `.offsite-${stamp}.db.gz.enc`);
const remoteKey = `${PREFIX}/tokens-${stamp}.db.gz.enc`;

const key = loadKey();

// 1. Salinan konsisten
try {
  const src = new DatabaseSync(DB, { readOnly: true });
  src.exec(`VACUUM INTO '${plainPath.replace(/'/g, "''")}'`);
  src.close();
} catch (err) {
  log(`❌ salinan gagal: ${err.message}`);
  process.exit(1);
}

// 2. Verifikasi — backup rusak lebih buruk daripada tidak ada backup
try {
  const copy = new DatabaseSync(plainPath, { readOnly: true });
  const integrity = copy.prepare('PRAGMA integrity_check').get();
  const result = integrity?.integrity_check ?? Object.values(integrity ?? {})[0];
  if (result !== 'ok') {
    copy.close();
    unlinkSync(plainPath);
    log(`❌ salinan rusak (${result}) — dibatalkan`);
    process.exit(1);
  }
  const tokens = copy.prepare('SELECT COUNT(*) AS n FROM tokens').get()?.n ?? 0;
  copy.close();
  log(`✓ salinan terverifikasi: ${tokens} token`);
} catch (err) {
  try { unlinkSync(plainPath); } catch { /* sudah hilang */ }
  log(`❌ salinan tidak bisa dibaca: ${err.message}`);
  process.exit(1);
}

// 3. Enkripsi
let sizes;
try {
  sizes = encryptFile(plainPath, encPath, key);
  unlinkSync(plainPath); // plaintext tidak boleh tertinggal di disk
} catch (err) {
  try { unlinkSync(plainPath); } catch { /* sudah hilang */ }
  log(`❌ enkripsi gagal: ${err.message}`);
  process.exit(1);
}

// 4. Upload
try {
  uploadToR2(encPath, remoteKey);
} catch (err) {
  // File .enc SENGAJA tidak dihapus — supaya bisa di-upload manual
  // tanpa harus mengenkripsi ulang.
  log(`❌ upload gagal: ${err.message.slice(0, 200)}`);
  log(`   File terenkripsi disimpan untuk upload manual: ${encPath}`);
  process.exit(1);
}

// 5. Verifikasi objek ada di R2
const remoteSize = verifyRemote(remoteKey);
if (remoteSize === 0) {
  log('❌ objek tidak ditemukan di R2 setelah upload — dianggap gagal');
  log(`   File lokal disimpan: ${encPath}`);
  process.exit(1);
}

// 6. Bersihkan file lokal (R2 sudah punya)
try { unlinkSync(encPath); } catch { /* tidak fatal */ }

const kb = (n) => Math.round(n / 1024);
const ratio = (sizes.plainBytes / sizes.encBytes).toFixed(1);
log(`✅ backup off-site: ${remoteKey}`);
log(`   ${kb(sizes.plainBytes)} KB → ${kb(sizes.compressedBytes)} KB (gzip) → ${kb(sizes.encBytes)} KB (AES-256-GCM)`);
log(`   Kompresi total ${ratio}:1 · Terverifikasi di R2: ${kb(remoteSize)} KB`);
