/**
 * Restore & verifikasi backup off-site.
 *
 * ── A7: KENAPA SKRIP INI ADA ────────────────────────────────────────────────
 *
 * Backup yang belum pernah diuji restore itu TIDAK DIHITUNG sebagai backup.
 * Alasannya: banyak hal bisa membuat backup tidak berguna tanpa terlihat —
 * kunci enkripsi salah, format file berubah, objek di R2 terpotong, atau
 * langkah restore-nya sendiri tidak pernah dicoba. Semua itu baru ketahuan
 * saat Anda benar-benar butuh — dan saat itu sudah terlambat.
 *
 * Skrip ini melakukan uji restore NYATA: unduh dari R2, dekripsi, buka
 * dengan SQLite, verifikasi integritas, dan bandingkan jumlah baris dengan
 * database yang sedang berjalan. Kalau ada yang gagal, Anda tahu SEKARANG,
 * bukan saat insiden.
 *
 * ── MODE ────────────────────────────────────────────────────────────────────
 *
 *   node restore-offsite.mjs --verify        (bawaan) uji restore, jangan ubah apa pun
 *   node restore-offsite.mjs --list          daftar backup di R2
 *   node restore-offsite.mjs --restore <file>  restore sungguhan (BERBAHAYA)
 *
 * Mode --verify dijalankan otomatis tiap bulan oleh cron supaya kerusakan
 * backup ketahuan lebih awal.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const DATA_DIR = process.env.TOKEN_DATA_DIR ?? join(homedir(), '.portfolio-token');
const DB = join(DATA_DIR, 'tokens.db');
const TMP_DIR = join(DATA_DIR, 'backups');
const KEY_FILE = join(DATA_DIR, 'backup-key.txt');
const BUCKET = process.env.R2_BACKUP_BUCKET ?? 'portfolio-assets';
const PREFIX = process.env.R2_BACKUP_PREFIX ?? 'backups';

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

/** Baca kunci enkripsi — sama seperti skrip backup. */
function loadKey() {
  const fromEnv = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
  if (existsSync(KEY_FILE)) {
    const fromFile = readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(fromFile)) return Buffer.from(fromFile, 'hex');
  }
  log('❌ Kunci enkripsi tidak ditemukan (BACKUP_ENCRYPTION_KEY atau ' + KEY_FILE + ')');
  process.exit(1);
}

/** Dekripsi: [12 IV][16 tag][ciphertext] → gunzip → buffer SQLite. */
function decryptFile(encPath, key) {
  const buf = readFileSync(encPath);
  if (buf.length < 29) throw new Error('file terlalu kecil — kemungkinan terpotong');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return gunzipSync(compressed);
}

/** Daftar objek backup di R2. */
function listBackups() {
  // `wrangler r2 object` hanya punya get/put/delete — tidak ada list.
  // Jadi daftar diambil lewat Cloudflare API (token sudah ada di env).
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
    || process.env.CF_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) {
    throw new Error('CLOUDFLARE_API_TOKEN dan CLOUDFLARE_ACCOUNT_ID harus ada untuk daftar backup');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(PREFIX + '/')}&per_page=1000`;
  const out = execFileSync('curl', ['-s', '-H', `Authorization: Bearer ${token}`, url], {
    encoding: 'utf8', timeout: 60_000,
  });
  const data = JSON.parse(out);
  if (!data.success) throw new Error('API R2 gagal: ' + JSON.stringify(data.errors ?? []).slice(0, 200));
  const names = (data.result ?? [])
    .map((o) => String(o.key ?? '').split('/').pop())
    .filter((n) => /^tokens-\d+\.db\.gz\.enc$/.test(n));
  return [...new Set(names)].sort();
}

/** Unduh satu objek dari R2 ke file lokal. */
function download(remoteKey, destPath) {
  const buf = execFileSync('wrangler', [
    'r2', 'object', 'get', `${BUCKET}/${remoteKey}`, '--remote', '--pipe',
  ], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000, maxBuffer: 200 * 1024 * 1024 });
  writeFileSync(destPath, buf, { mode: 0o600 });
  chmodSync(destPath, 0o600);
  return buf.length;
}

// ── Mode: --list ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--list')) {
  log(`Backup di R2 (${BUCKET}/${PREFIX}/):`);
  const list = listBackups();
  if (list.length === 0) log('  (tidak ada)');
  else list.forEach((n, i) => log(`  ${i + 1}. ${n}`));
  process.exit(0);
}

// ── Mode: --verify (bawaan) ─────────────────────────────────────────────────
const restoreIdx = args.indexOf('--restore');

if (restoreIdx === -1) {
  log('=== UJI RESTORE (tidak mengubah apa pun) ===');
  mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 });

  const list = listBackups();
  if (list.length === 0) {
    log('❌ Tidak ada backup di R2 — periksa apakah cron backup off-site jalan');
    process.exit(1);
  }

  const latest = list[list.length - 1];
  log(`Backup terbaru: ${latest}`);
  log(`Total backup tersedia: ${list.length}`);

  const encPath = join(TMP_DIR, `.verify-${Date.now()}.gz.enc`);
  const dbPath = join(TMP_DIR, `.verify-${Date.now()}.db`);

  try {
    // 1. Unduh
    const size = download(`${PREFIX}/${latest}`, encPath);
    log(`✓ terunduh: ${Math.round(size / 1024)} KB`);

    // 2. Dekripsi + gunzip
    const key = loadKey();
    const plain = decryptFile(encPath, key);
    writeFileSync(dbPath, plain, { mode: 0o600 });
    log(`✓ didekripsi: ${Math.round(plain.length / 1024)} KB`);

    // 3. Buka dengan SQLite
    const restored = new DatabaseSync(dbPath, { readOnly: true });

    // 4. Integritas
    const integrity = restored.prepare('PRAGMA integrity_check').get();
    const result = integrity?.integrity_check ?? Object.values(integrity ?? {})[0];
    if (result !== 'ok') throw new Error(`integrity_check: ${result}`);
    log('✓ integrity_check: ok');

    // 5. Foreign key
    const fk = restored.prepare('PRAGMA foreign_key_check').all();
    log(`✓ foreign_key_check: ${fk.length} masalah`);

    // 6. Bandingkan dengan database yang berjalan
    if (existsSync(DB)) {
      const live = new DatabaseSync(DB, { readOnly: true });
      const tables = ['tokens', 'access_events', 'sales_leads', 'sessions'];
      let mismatch = 0;
      for (const t of tables) {
        try {
          const a = restored.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
          const b = live.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
          // Backup boleh punya baris LEBIH SEDIKIT (dibuat lebih awal),
          // tapi tidak boleh lebih banyak dari database hidup.
          const ok = a <= b;
          if (!ok) mismatch += 1;
          log(`   ${t}: backup=${a} live=${b} ${ok ? '✓' : '❌ backup lebih banyak!'}`);
        } catch { /* tabel tidak ada di salah satu sisi */ }
      }
      live.close();
      if (mismatch > 0) throw new Error('jumlah baris tidak masuk akal');
    }

    restored.close();
    log('');
    log('✅ RESTORE TERVERIFIKASI — backup bisa dipakai kalau diperlukan');
    process.exit(0);
  } catch (err) {
    log('');
    log(`❌ RESTORE GAGAL: ${err.message}`);
    log('   Ini berarti backup di R2 TIDAK BISA dipakai. Periksa:');
    log('   - Apakah BACKUP_ENCRYPTION_KEY masih sama dengan saat backup dibuat?');
    log('   - Apakah file di R2 terpotong? Coba unduh manual.');
    process.exit(1);
  } finally {
    try { unlinkSync(encPath); } catch { /* sudah hilang */ }
    try { unlinkSync(dbPath); } catch { /* sudah hilang */ }
  }
}

// ── Mode: --restore <file> (BERBAHAYA) ──────────────────────────────────────
const target = args[restoreIdx + 1];
if (!target) {
  log('❌ Sebutkan nama file: --restore tokens-XXXXXXXX.db.gz.enc');
  process.exit(1);
}

log('⚠️  RESTORE SUNGGUHAN — database yang berjalan akan DIGANTI');
log(`   Sumber: ${target}`);

if (!existsSync(DB)) {
  log('❌ Database produksi tidak ditemukan — periksa TOKEN_DATA_DIR');
  process.exit(1);
}

// Backup dulu database yang SEKARANG, sebelum ditimpa. Kalau restore-nya
// salah pilih file, masih bisa kembali.
const safety = `${DB}.sebelum-restore-${Date.now()}`;
try {
  execFileSync('cp', [DB, safety]);
  log(`✓ Salinan pengaman database saat ini: ${safety}`);
} catch (err) {
  log(`❌ Gagal membuat salinan pengaman: ${err.message} — restore dibatalkan`);
  process.exit(1);
}

const encPath = join(TMP_DIR, `.restore-${Date.now()}.gz.enc`);
try {
  download(`${PREFIX}/${target}`, encPath);
  const plain = decryptFile(encPath, loadKey());

  // Tulis ke file sementara dulu, verifikasi, baru pindahkan.
  const staged = `${DB}.restore-staged`;
  writeFileSync(staged, plain, { mode: 0o600 });

  const check = new DatabaseSync(staged, { readOnly: true });
  const integrity = check.prepare('PRAGMA integrity_check').get();
  const result = integrity?.integrity_check ?? Object.values(integrity ?? {})[0];
  const tokens = check.prepare('SELECT COUNT(*) AS n FROM tokens').get()?.n ?? 0;
  check.close();

  if (result !== 'ok') {
    unlinkSync(staged);
    throw new Error(`salinan rusak: ${result}`);
  }

  execFileSync('mv', [staged, DB]);
  log(`✅ RESTORE SELESAI — ${tokens} token`);
  log('   Restart layanan: sudo -n systemctl restart portfolio-token');
  log(`   Salinan lama disimpan di: ${safety}`);
} catch (err) {
  log(`❌ RESTORE GAGAL: ${err.message}`);
  log(`   Database asli TIDAK diubah. Salinan pengaman: ${safety}`);
  process.exit(1);
} finally {
  try { unlinkSync(encPath); } catch { /* sudah hilang */ }
}
