#!/usr/bin/env node
/**
 * Generate changelog dari riwayat git.
 *
 * ── KENAPA GENERATOR, BUKAN TULIS MANUAL ────────────────────────────────────
 * Riwayat proyek ini 340 commit. Menulis changelog manual berarti setiap
 * commit baru harus diingat dan dicatat — dan yang terlupa tidak akan pernah
 * kembali. Generator membaca git langsung, jadi changelog selalu sinkron.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 *   1. Baca semua commit (hash, tanggal, pesan)
 *   2. Kelompokkan per TANGGAL (pola Claude Code Docs — per rilis/tanggal)
 *   3. Klasifikasikan tiap commit ke kategori dari prefix Conventional Commits:
 *        feat  → Fitur baru
 *        fix   → Perbaikan
 *        perf  → Performa
 *        docs  → Dokumentasi
 *        data  → Data
 *        chore/ci/polish/refactor → Pemeliharaan
 *   4. Tulis changelog.json (data mentah untuk JS) + CHANGELOG.md (baca manusia)
 *
 * ── KENAPA JSON, BUKAN LANGSUNG HTML ────────────────────────────────────────
 * Halaman changelog memuat data lewat fetch() supaya HTML-nya tetap kecil dan
 * daftar bisa dirender bertahap. Sama seperti docs.html — konten panduan juga
 * ada di HTML, tapi changelog ini bisa ratusan baris.
 *
 * Jalankan: node scripts/generate-changelog.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1. Baca riwayat git ───────────────────────────────────────────────────────
// Format: hash|tanggal|pesan — pemisah `|` karena pesan commit tidak memuatnya.
// `%ad` dengan --date=short → YYYY-MM-DD.
let log;
try {
  log = execFileSync('git', ['log', '--format=%H|%ad|%s', '--date=short'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
} catch (err) {
  console.error('Gagal membaca git log:', err.message);
  process.exit(1);
}

const baris = log.trim().split('\n').filter(Boolean);

// ── 2. Klasifikasi ────────────────────────────────────────────────────────────
// Prefix Conventional Commits → kategori yang bisa dibaca pengguna.
// Urutan penting: diperiksa dari atas, yang cocok pertama menang.
const KATEGORI = [
  { kunci: 'fitur',    label: 'Fitur baru',  cocok: /^feat(\(|:)/ },
  { kunci: 'perbaikan', label: 'Perbaikan',  cocok: /^fix(\(|:)/ },
  { kunci: 'performa', label: 'Performa',    cocok: /^perf(\(|:)/ },
  { kunci: 'dokumentasi', label: 'Dokumentasi', cocok: /^docs?(\(|:)/ },
  { kunci: 'data',     label: 'Data',        cocok: /^data(\(|:)/ },
  { kunci: 'pemeliharaan', label: 'Pemeliharaan', cocok: /^(chore|ci|polish|refactor|debug|test)(\(|:)/ },
];

/** Ubah pesan commit jadi kalimat yang enak dibaca. */
function rapikanPesan(pesan) {
  // Buang prefix "feat(scope): " / "fix: " — kategorinya sudah jadi judul.
  let teks = pesan.replace(/^[a-z]+(\([^)]*\))?:\s*/i, '');

  // Buang detail teknis yang tidak berguna bagi pengguna.
  teks = teks.replace(/\s*\(\d+\)\s*$/, '');

  // Kapitalkan huruf pertama.
  if (teks) teks = teks.charAt(0).toUpperCase() + teks.slice(1);

  return teks;
}

/** Ambil scope dari pesan, misal "feat(docs): ..." → "docs". */
function ambilScope(pesan) {
  const m = pesan.match(/^[a-z]+\(([^)]+)\)/);
  return m ? m[1] : '';
}

const perTanggal = new Map();

for (const b of baris) {
  const [hash, tanggal, pesan] = b.split('|');
  if (!hash || !tanggal || !pesan) continue;

  // Lewati commit sinkronisasi otomatis — mereka bukan perubahan yang perlu
  // dicatat pengguna, dan jumlahnya banyak (cron 6 jam).
  if (/^data\(proyek\): sinkron/i.test(pesan)) continue;

  let kategori = KATEGORI.find((k) => k.cocok.test(pesan));
  if (!kategori) {
    // Pesan tanpa prefix yang dikenal (mis. commit lama) → Pemeliharaan.
    kategori = KATEGORI[KATEGORI.length - 1];
  }

  if (!perTanggal.has(tanggal)) {
    perTanggal.set(tanggal, {
      tanggal,
      ringkasan: { fitur: 0, perbaikan: 0, performa: 0, dokumentasi: 0, data: 0, pemeliharaan: 0 },
      kategori: new Map(),
      jumlah: 0,
    });
  }

  const hari = perTanggal.get(tanggal);
  hari.jumlah++;
  hari.ringkasan[kategori.kunci]++;

  if (!hari.kategori.has(kategori.kunci)) {
    hari.kategori.set(kategori.kunci, {
      kunci: kategori.kunci,
      label: kategori.label,
      item: [],
    });
  }

  hari.kategori.get(kategori.kunci).item.push({
    hash: hash.slice(0, 7),
    teks: rapikanPesan(pesan),
    scope: ambilScope(pesan),
  });
}

// ── 3. Susun keluaran ─────────────────────────────────────────────────────────
// Urut dari terbaru. Kategori dalam satu hari juga urut: fitur dulu, lalu
// perbaikan, baru sisanya — pembaca ingin tahu apa yang BARU, bukan apa yang
// dibersihkan.
const URUTAN = ['fitur', 'perbaikan', 'performa', 'dokumentasi', 'data', 'pemeliharaan'];

const rilis = [...perTanggal.values()]
  .sort((a, b) => b.tanggal.localeCompare(a.tanggal))
  .map((h) => ({
    tanggal: h.tanggal,
    jumlah: h.jumlah,
    ringkasan: h.ringkasan,
    kategori: URUTAN
      .filter((k) => h.kategori.has(k))
      .map((k) => h.kategori.get(k)),
  }));

const totalCommit = baris.length;
const totalDicatat = rilis.reduce((n, r) => n + r.jumlah, 0);

const keluaran = {
  dibuat: new Date().toISOString(),
  totalCommit,
  totalDicatat,
  hariPertama: rilis.length ? rilis[rilis.length - 1].tanggal : null,
  hariTerakhir: rilis.length ? rilis[0].tanggal : null,
  rilis,
};

mkdirSync(join(ROOT, 'dist'), { recursive: true });

// JSON untuk halaman web.
writeFileSync(
  join(ROOT, 'changelog.json'),
  JSON.stringify(keluaran, null, 1),
  'utf8'
);
writeFileSync(
  join(ROOT, 'dist', 'changelog.json'),
  JSON.stringify(keluaran, null, 1),
  'utf8'
);

// Markdown untuk dibaca di GitHub — pola yang sama dipakai Claude Code
// ("This page is generated from the CHANGELOG.md on GitHub").
const md = [
  '# Changelog',
  '',
  'Semua perubahan penting pada proyek ini, dikelompokkan per tanggal.',
  '',
  `Total ${totalDicatat} perubahan dari ${totalCommit} commit ` +
    `(${keluaran.hariPertama} → ${keluaran.hariTerakhir}).`,
  '',
  '> Berkas ini dibuat otomatis dari riwayat git: `node scripts/generate-changelog.mjs`',
  '',
];

for (const r of rilis) {
  md.push(`## ${r.tanggal}`, '');
  for (const k of r.kategori) {
    md.push(`### ${k.label}`, '');
    for (const it of k.item) {
      const scope = it.scope ? `**${it.scope}**: ` : '';
      md.push(`- ${scope}${it.teks} (\`${it.hash}\`)`);
    }
    md.push('');
  }
}

writeFileSync(join(ROOT, 'CHANGELOG.md'), md.join('\n'), 'utf8');

console.log(`changelog: ${totalDicatat} perubahan dari ${totalCommit} commit`);
console.log(`rentang  : ${keluaran.hariPertama} → ${keluaran.hariTerakhir}`);
console.log(`hari     : ${rilis.length} tanggal`);
console.log(`keluaran : changelog.json, dist/changelog.json, CHANGELOG.md`);
