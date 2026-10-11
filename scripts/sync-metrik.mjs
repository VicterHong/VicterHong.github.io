#!/usr/bin/env node
/**
 * Sinkronkan metrik proyek portofolio dari repo yang NYATA.
 *
 * ── KENAPA INI ADA ──────────────────────────────────────────────────────────
 *
 * Portofolio ini menyatakan aturannya sendiri: "portofolio yang menyebut
 * '231 tests' harus bisa dibuktikan dengan membuka reponya." Angka yang diketik
 * manual akan basi — dan angka basi adalah klaim yang tidak bisa dibuktikan.
 *
 * Skrip ini membaca repo proyek, menghitung ulang metriknya, lalu menulis
 * hasilnya ke `assets/js/data/projects.js`.
 *
 * ── KENAPA HANYA METRIK, BUKAN SELURUH DATA ─────────────────────────────────
 *
 * Deskripsi, highlight, dan narasi adalah tulisan manusia — tidak bisa
 * dihitung. Yang bisa dihitung hanya angka: jumlah tes, jumlah berkas uji,
 * pemakaian RAM. Jadi hanya itu yang disentuh.
 *
 * ── SUMBER SETIAP ANGKA ─────────────────────────────────────────────────────
 *
 *   tes otomatis  → dihitung dari `test(*.test.mjs)` di repo proyek
 *   berkas uji    → jumlah berkas `test/*.test.mjs`
 *   RAM saat jalan→ systemd `MemoryCurrent` layanan yang berjalan
 *   lisensi       → dibaca dari package.json / LICENSE
 *
 * Kalau repo tidak ada di mesin ini, metriknya DILEWATI — bukan dikarang.
 *
 * Pemakaian:
 *   node scripts/sync-metrik.mjs           # tulis perubahan
 *   node scripts/sync-metrik.mjs --check   # hanya laporkan, exit 1 kalau basi
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_FILE = join(ROOT, 'assets', 'js', 'data', 'projects.js');

const CHECK_ONLY = process.argv.includes('--check');

/**
 * Repo proyek dan layanan systemd-nya.
 *
 * `service` dipakai untuk membaca RAM nyata. Layanan yang tidak berjalan
 * dilewati — lebih baik tanpa angka daripada angka yang salah.
 */
const SUMBER = {
  'mina': {
    repo: '/home/ubuntu/mina-remote-control',
    // MINA dihitung dari berkas tes Python, bukan .mjs
    polaTes: /^\s*def test_/gm,
    polaBerkasTes: /^test_.*\.py$/,
    dirTes: 'tests',
  },
  'spareparts': {
    repo: '/home/ubuntu/spareparts-inventory-system',
    polaTes: /^\s*def test_/gm,
    polaBerkasTes: /^test_.*\.py$/,
    dirTes: 'tests',
  },
  'whatsapp-bot': {
    repo: '/home/ubuntu/whatsapp-family-bot',
    polaTes: /^\s*test\(/gm,
    polaBerkasTes: /\.test\.mjs$/,
    dirTes: 'test',
    service: 'whatsapp-family-bot',
  },
};

/** Hitung jumlah tes di sebuah repo. Mengembalikan null kalau tidak bisa. */
function hitungTes( sumber) {
  const dir = join(sumber.repo, sumber.dirTes);
  if (!existsSync(dir)) return null;
  try {
    let total = 0;
    let berkas = 0;
    for (const nama of readdirSync(dir)) {
      if (!sumber.polaBerkasTes.test(nama)) continue;
      const isi = readFileSync(join(dir, nama), 'utf8');
      const cocok = isi.match(sumber.polaTes);
      total += cocok ? cocok.length : 0;
      berkas += 1;
    }
    return { total, berkas };
  } catch {
    return null;
  }
}

/** RAM nyata dari systemd. null kalau layanan tidak berjalan. */
function bacaRam(service) {
  if (!service) return null;
  try {
    const keluaran = execFileSync(
      'systemctl',
      ['--user', 'show', service, '-p', 'MemoryCurrent', '--value'],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    const byte = Number(keluaran);
    if (!Number.isFinite(byte) || byte <= 0) return null;
    return Math.round(byte / 1024 / 1024);
  } catch {
    return null;
  }
}

/**
 * Bulatkan RAM ke langkah 8 MB.
 *
 * ── KENAPA DIBULATKAN ───────────────────────────────────────────────────────
 *
 * RAM layanan berfluktuasi beberapa MB dari detik ke detik (diukur: 60, 72, 73
 * MB dalam satu menit). Tanpa pembulatan, setiap pemeriksaan melihat "perubahan"
 * dan memicu deploy — padahal tidak ada yang benar-benar berubah.
 *
 * Dengan langkah 8 MB, angkanya hanya bergerak saat ada perubahan NYATA
 * (fitur baru, cache tumbuh). Ini juga lebih jujur untuk portofolio: "~72 MB"
 * lebih tepat daripada "73 MB" yang basi dalam semenit.
 *
 * Portofolio MINA sudah memakai gaya ini: "~25 MB".
 */
function bulatkanRam(mb) {
  if (mb === null) return null;
  const LANGKAH = 8;
  return Math.max(LANGKAH, Math.round(mb / LANGKAH) * LANGKAH);
}

// ── BACA DATA SEKARANG ────────────────────────────────────────────────────────

let isi = readFileSync(DATA_FILE, 'utf8');
const perubahan = [];

for (const [slug, sumber] of Object.entries(SUMBER)) {
  const tes = hitungTes(sumber);
  const ram = bulatkanRam(bacaRam(sumber.service));

  // Cari blok proyek dengan slug ini, lalu blok metrics di dalamnya.
  const awalSlug = isi.indexOf(`slug: '${slug}'`);
  if (awalSlug === -1) {
    console.log(`  ⏭️  ${slug}: tidak ada di data portofolio`);
    continue;
  }
  // Batas blok = proyek berikutnya (atau akhir array)
  const berikutnya = isi.indexOf("\n  {\n", awalSlug);
  const batas = berikutnya === -1 ? isi.length : berikutnya;
  let blok = isi.slice(awalSlug, batas);

  const metricsAwal = blok.indexOf('metrics: [');
  if (metricsAwal === -1) {
    console.log(`  ⏭️  ${slug}: tidak punya metrics[] (sengaja — tidak ada angka rekaan)`);
    continue;
  }
  const metricsAkhir = blok.indexOf(']', blok.indexOf('[', metricsAwal));
  const metricsLama = blok.slice(metricsAwal, metricsAkhir + 1);

  // Bangun metrik baru — hanya yang benar-benar terukur.
  const baris = [];
  if (tes) {
    baris.push(`      { label: 'tes otomatis', value: '${tes.total}' },`);
    baris.push(`      { label: 'berkas uji', value: '${tes.berkas}' },`);
  }
  if (ram !== null) {
    baris.push(`      { label: 'RAM saat jalan', value: '${ram} MB' },`);
  }
  if (!baris.length) {
    console.log(`  ⏭️  ${slug}: tidak ada yang bisa diukur (repo/layanan tidak ada)`);
    continue;
  }
  const metricsBaru = `metrics: [\n${baris.join('\n')}\n    ]`;

  if (metricsLama !== metricsBaru) {
    blok = blok.replace(metricsLama, metricsBaru);
    isi = isi.slice(0, awalSlug) + blok + isi.slice(batas);
    const ringkas = [];
    if (tes) ringkas.push(`tes ${tes.total} (${tes.berkas} berkas)`);
    if (ram !== null) ringkas.push(`RAM ${ram} MB`);
    perubahan.push(`  🔄 ${slug}: ${ringkas.join(', ')}`);
  } else {
    const ringkas = [];
    if (tes) ringkas.push(`tes ${tes.total}`);
    if (ram !== null) ringkas.push(`RAM ${ram} MB`);
    console.log(`  ✅ ${slug}: sudah sinkron (${ringkas.join(', ')})`);
  }
}

// ── TULIS / LAPORKAN ──────────────────────────────────────────────────────────

if (!perubahan.length) {
  console.log('\nSemua metrik sudah sinkron.');
  process.exit(0);
}

console.log('\nPerubahan:');
for (const p of perubahan) console.log(p);

if (CHECK_ONLY) {
  console.log('\n❌ METRIK BASI — jalankan `node scripts/sync-metrik.mjs` untuk memperbarui.');
  process.exit(1);
}

writeFileSync(DATA_FILE, isi);
console.log('\n✅ Data portofolio diperbarui. Jalankan deploy untuk menyiarkan.');
