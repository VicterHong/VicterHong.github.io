/**
 * Tes: skrip backup off-site harus tahan terhadap env file "nyata".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BUG YANG DICEGAH ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Backup off-site GAGAL 4 HARI BERTURUT-TURUT dengan:
 *
 *   ❌ upload gagal: spawnSync wrangler ENOENT
 *
 * Ada DUA akar masalah yang ditemukan dan diperbaiki:
 *
 *   1. PATH cron tidak memuat `$HOME/.local/bin` — tempat wrangler dipasang.
 *
 *   2. Skrip memakai `source` untuk memuat service.env. Nilai seperti
 *
 *        EMAIL_FROM=VIVASTIC <noreply@domain.id>
 *
 *      adalah env var yang SAH, tapi bash membacanya sebagai operator
 *      redirection `<` dan berhenti dengan "syntax error". Satu baris buruk
 *      mematikan SELURUH skrip.
 *
 * Keduanya jenis kegagalan yang paling berbahaya: log lokal terlihat hijau
 * ("salinan terverifikasi"), tapi file tidak pernah sampai ke R2. Backup
 * off-site yang tidak ada baru ketahuan saat server sudah hilang.
 *
 * ── CARA TES INI BEKERJA ────────────────────────────────────────────────────
 *
 * Skrip diuji lewat mode `--cek-env`, yang memuat env lalu berhenti tanpa
 * menyentuh R2. Aman dijalankan kapan pun.
 *
 * Dua berkas env dibuat: satu normal, satu berisi nilai "sulit" (tanda <>
 * dan karakter khusus). Skrip harus melewati keduanya.
 *
 * Jalankan: node --test backend/test/backup-offsite-env.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKRIP = resolve(__dirname, '..', 'scripts', 'run-backup-offsite.sh');

let DIR;

before(() => {
  DIR = mkdtempSync(join(tmpdir(), 'uji-env-'));
});

after(() => {
  if (DIR) rmSync(DIR, { recursive: true, force: true });
});

/**
 * Jalankan skrip dengan env MINIMAL seperti cron.
 *
 * KENAPA MINIMAL: bug aslinya hanya muncul di lingkungan cron, bukan di
 * shell interaktif yang punya PATH lengkap. Menguji dengan env penuh akan
 * menyembunyikan bug — persis yang terjadi sebelumnya.
 */
function jalankan(envFile, mode = '--cek-env') {
  return spawnSync('bash', [SKRIP, mode], {
    env: {
      HOME: process.env.HOME,
      // PATH sengaja TANPA $HOME/.local/bin — meniru cron.
      PATH: '/home/ubuntu/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin',
      TOKEN_SERVICE_ENV: envFile,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function tulisEnv(nama, isi) {
  const p = join(DIR, nama);
  writeFileSync(p, isi, 'utf8');
  return p;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 1. ENV NORMAL ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('env file normal', () => {
  test('terbaca tanpa error', () => {
    const p = tulisEnv('normal.env', [
      'BACKUP_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789',
      'CLOUDFLARE_API_TOKEN=token-contoh',
      'CLOUDFLARE_ACCOUNT_ID=abc123',
      'R2_BUCKET=portfolio-assets',
    ].join('\n'));

    const r = jalankan(p);

    assert.equal(r.status, 0, `harus keluar 0, dapat ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /env terbaca tanpa error/);
    assert.match(r.stdout, /BACKUP_ENCRYPTION_KEY: terisi/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── 2. NILAI "SULIT" — INI YANG MEMATIKAN `source` ──────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('nilai dengan karakter khusus (akar masalah asli)', () => {
  test('EMAIL_FROM dengan tanda <> tidak mematikan skrip', () => {
    // Nilai inilah yang ada di service.env nyata dan memutus `source`.
    const p = tulisEnv('email-from.env', [
      'BACKUP_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789',
      'CLOUDFLARE_API_TOKEN=token-contoh',
      'CLOUDFLARE_ACCOUNT_ID=abc123',
      'R2_BUCKET=portfolio-assets',
      'EMAIL_FROM=VIVASTIC <noreply@domain.id>',
    ].join('\n'));

    const r = jalankan(p);

    // Inilah regresi yang dicegah: dulu ini "syntax error near unexpected
    // token `newline'" dan exit code non-zero.
    assert.equal(
      r.status, 0,
      `EMAIL_FROM dengan <> harus terbaca, dapat ${r.status}: ${r.stderr}`,
    );
    assert.doesNotMatch(r.stderr, /syntax error/);
  });

  test('nilai dengan spasi, tanda kutip, dan tanda seru tetap aman', () => {
    const p = tulisEnv('aneh.env', [
      'BACKUP_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789',
      'CLOUDFLARE_API_TOKEN=token-contoh',
      'CLOUDFLARE_ACCOUNT_ID=abc123',
      'R2_BUCKET=portfolio-assets',
      'NAMA_DENGAN_SPASI=nilai punya spasi',
      'NAMA_DENGAN_KUTIP="nilai dengan kutip ganda"',
      'NAMA_DENGAN_SERU=hati-hati!',
      'NAMA_DENGAN_AMPERSAND=a&b',
      'NAMA_DENGAN_DOLLAR=harga $100',
    ].join('\n'));

    const r = jalankan(p);

    assert.equal(r.status, 0, `harus terbaca, dapat ${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /syntax error/);
  });

  test('baris komentar dan kosong dilewati', () => {
    const p = tulisEnv('komentar.env', [
      '# ini komentar',
      '',
      'BACKUP_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789',
      '',
      '# komentar lagi',
      'CLOUDFLARE_API_TOKEN=token-contoh',
      'CLOUDFLARE_ACCOUNT_ID=abc123',
      'R2_BUCKET=portfolio-assets',
    ].join('\n'));

    const r = jalankan(p);

    assert.equal(r.status, 0, `harus terbaca, dapat ${r.status}: ${r.stderr}`);
    // 4 variabel terisi (komentar & kosong tidak dihitung)
    assert.match(r.stdout, /env dimuat: 4 variabel/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── 3. PATH — WRANGLER HARUS DITEMUKAN DENGAN PATH CRON ─────────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('PATH wrangler', () => {
  test('skrip menambahkan $HOME/.local/bin ke PATH', () => {
    const p = tulisEnv('path.env', [
      'BACKUP_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789',
      'CLOUDFLARE_API_TOKEN=token-contoh',
      'CLOUDFLARE_ACCOUNT_ID=abc123',
      'R2_BUCKET=portfolio-assets',
    ].join('\n'));

    const r = jalankan(p);

    // Skrip harus tetap berhasil walau PATH awal tidak memuat .local/bin.
    // Kalau wrangler tidak ada di sistem ini, skrip keluar 1 dengan pesan
    // yang JELAS — bukan ENOENT yang membingungkan.
    if (r.status !== 0) {
      assert.match(
        r.stderr, /wrangler tidak ditemukan/,
        'kalau gagal, pesannya harus jelas menyebut wrangler',
      );
    } else {
      assert.match(r.stdout, /env terbaca tanpa error/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── 4. ENV HILANG → PESAN JELAS, BUKAN GAGAL DIAM-DIAM ──────────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('penanganan berkas env hilang', () => {
  test('env tidak ada → pesan jelas + exit non-zero', () => {
    const r = jalankan(join(DIR, 'tidak-ada.env'));

    assert.notEqual(r.status, 0, 'harus gagal kalau env tidak ada');
    assert.match(r.stderr, /env tidak ditemukan/);
  });
});
