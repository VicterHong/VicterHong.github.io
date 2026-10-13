#!/usr/bin/env node
/**
 * rapikan-tipografi.mjs — codemod skala tipografi 5 tingkat (item F1a).
 *
 * ── MASALAH ──────────────────────────────────────────────────────────────────
 * Terukur di produksi: 74 nilai font-size berbeda di assets/css/*.css (355
 * deklarasi). Cluster terburuk 11,5–14,5px berisi 40+ nilai yang nyaris sama
 * (11,52 · 11,84 · 12,16 · 12,48 · 13,12 · 13,44 · 13,92…) — cukup mirip untuk
 * terlihat seperti kesalahan, cukup beda untuk tidak bisa diprediksi. Hasil
 * ukur per halaman: docs 24 ukuran unik, home 21, legal 13. Target GOAL: maks 5.
 *
 * ── KEPUTUSAN: LIMA TINGKAT ──────────────────────────────────────────────────
 *   --fs-1  12px        mikro   — lencana, label, meta, hash commit
 *   --fs-2  14px        kecil   — navigasi, keterangan, teks sekunder
 *   --fs-3  16px        dasar   — badan teks & input (16px = tanpa zoom iOS)
 *   --fs-4  24px        judul   — judul bagian, angka besar
 *   --fs-5  28–44px     display — judul halaman (fluid clamp)
 *
 * Pemetaan nilai lama → token memakai ambang numerik (bukan daftar satu-satu):
 *   px  : ≤12,5 → 1 · ≤14 → 2 · ≤16 → 3 · ≤27 → 4 · ≥28 → 5
 *   rem : ≤0,8 → 1 · ≤0,94 → 2 · ≤1,1 → 3 · <2 → 4 · ≥2 → 5
 *   em  : ≤0,9 → 2 · lainnya → 3
 * clamp() dipetakan eksplisit (12 deklarasi). Dua pengecualian selektor:
 *   docs.css 1.75rem (h1 versi mobile) → fs-5, bukan fs-4
 *   logo.css 17px (huruf fallback logo) → fs-3, bukan fs-4
 *
 * Token diinjeksi ke :root main.css dan auth.css (halaman auth tidak memuat
 * main.css). cf-gate.css DIKECUALIKAN — replika 1:1 Cloudflare.
 *
 * Idempoten: nilai yang sudah `var(--fs-*)` atau `inherit` dilewati.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_BLOCK = `  /* ── SKALA TIPOGRAFI — LIMA TINGKAT ─────────────────────────────────────────
     Satu skala untuk seluruh situs. Sebelumnya ada 74 nilai berbeda (11,5 ·
     12,48 · 13,12 · 13,92 px) — cukup mirip untuk terlihat seperti salah,
     cukup beda untuk tidak bisa diprediksi. Sekarang lima, tidak lebih:
       --fs-1  12px        mikro   — lencana, label, meta, hash commit
       --fs-2  14px        kecil   — navigasi, keterangan, teks sekunder
       --fs-3  16px        dasar   — badan teks & input (16px = tanpa zoom iOS)
       --fs-4  24px        judul   — judul bagian, angka besar
       --fs-5  28–44px     display — judul halaman (fluid, clamp)
     Halaman auth memuat auth.css (bukan main.css) — token di bawah HARUS
     sama persis dengan main.css; kalau diubah, ubah di kedua tempat. */
  --fs-1: 0.75rem;
  --fs-2: 0.875rem;
  --fs-3: 1rem;
  --fs-4: 1.5rem;
  --fs-5: clamp(1.75rem, 6vw, 2.75rem);`;

/* Sisipkan token setelah anchor ini (indexOf, kemunculan pertama). */
const ANCHOR = {
  'assets/css/main.css': '--ease: cubic-bezier(0.22, 1, 0.36, 1);',
  'assets/css/auth.css': '--sukses: #4ade80;',
};

const FILES = [
  'assets/css/main.css',
  'assets/css/auth.css',
  'assets/css/docs.css',
  'assets/css/legal.css',
  'assets/css/changelog.css',
  'assets/css/cookies.css',
  'assets/css/pricing.css',
  'assets/css/keamanan.css',
  'assets/css/spotlight.css',
  'assets/css/editorial.css',
  'assets/css/tilt-panel.css',
  'assets/css/video-player.css',
  'assets/css/orb-menu.css',
  'assets/css/narrative.css',
  'assets/css/project.css',
  'assets/css/tabel-banding.css',
  'assets/css/logo.css',
  '404.html',
];

/* clamp() dipetakan eksplisit — kunci dinormalisasi (tanpa spasi). */
const CLAMP = {
  'clamp(1.9rem,4.5vw,2.75rem)': '5',   // docs h1
  'clamp(1.6rem,4.5vw,2.4rem)': '5',    // legal title
  'clamp(2.1rem,4.6vw,3.6rem)': '5',    // hero title
  'clamp(1rem,2vw,1.16rem)': '3',       // hero lede
  'clamp(1.5rem,3vw,2.1rem)': '4',      // section title
  'clamp(1.75rem,5vw,2.75rem)': '5',    // pricing title
  'clamp(0.9rem,2.2vw,1.05rem)': '3',   // pricing sub
  'clamp(1.375rem,4vw,1.75rem)': '4',   // harga angka (+teks)
  'clamp(1.15rem,3vw,1.5rem)': '4',     // bagian/cta judul
  'clamp(1.75rem,4vw,2.75rem)': '5',    // spotlight title
  'clamp(2.4rem,6vw,3.6rem)': '5',      // project title
  'clamp(3.5rem,12vw,6rem)': '5',       // 404 err-code
  'clamp(1.3rem,4vw,1.9rem)': '4',      // 404 h1
};

/* Pengecualian per (nama berkas, nilai) → token. */
const EXC = {
  'docs.css': { '1.75rem': '5' },  // h1 versi mobile — judul halaman, bukan angka
  'logo.css': { '17px': '3' },     // huruf fallback logo — setara teks brand
};

const norm = (v) => v.toLowerCase().replace(/\s+/g, '');

function lookup(file, raw) {
  const v = norm(raw);
  if (EXC[file] && EXC[file][v]) return EXC[file][v];
  if (CLAMP[v]) return CLAMP[v];
  /* `\d*\.?\d+` juga menerima bentuk tanpa nol depan (.68rem) — dulu lolos. */
  let m = v.match(/^(\d*\.?\d+)px$/);
  if (m) {
    const p = parseFloat(m[1]);
    return p <= 12.5 ? '1' : p <= 14 ? '2' : p <= 16 ? '3' : p <= 27 ? '4' : '5';
  }
  m = v.match(/^(\d*\.?\d+)rem$/);
  if (m) {
    const n = parseFloat(m[1]);
    return n <= 0.8 ? '1' : n <= 0.94 ? '2' : n <= 1.1 ? '3' : n < 2 ? '4' : '5';
  }
  m = v.match(/^(\d*\.?\d+)em$/);
  if (m) return parseFloat(m[1]) <= 0.9 ? '2' : '3';
  return null;
}

/* Ganti karakter di dalam komentar jadi spasi — regex hanya boleh menembak
   kode nyata, bukan teks komentar yang menyebut "font-size : 16px". */
function maskComments(src) {
  const out = src.split('');
  let i = 0;
  for (;;) {
    const s = src.indexOf('/*', i);
    if (s < 0) break;
    const e = src.indexOf('*/', s + 2);
    const end = e < 0 ? src.length : e + 2;
    for (let j = s; j < end; j++) out[j] = ' ';
    i = end;
  }
  return out.join('');
}

let total = 0;
for (const rel of FILES) {
  const path = resolve(ROOT, rel);
  let src = readFileSync(path, 'utf8');
  const base = rel.split('/').pop();

  // 1 — injeksi token (sekali; idempoten lewat penanda --fs-1)
  const anchor = ANCHOR[rel];
  if (anchor && !src.includes('--fs-1')) {
    const at = src.indexOf(anchor);
    if (at >= 0) {
      const end = at + anchor.length;
      src = src.slice(0, end) + '\n\n' + TOKEN_BLOCK + src.slice(end);
    } else {
      console.warn(`⚠ ${rel}: anchor token tidak ditemukan — token TIDAK disisipkan`);
    }
  }

  // 2 — ganti font-size → var(--fs-N)
  const masked = maskComments(src);
  const re = /font-size\s*:\s*([^;{}]+?)\s*([;}])/g;
  let out = '';
  let last = 0;
  let n = 0;
  const skipped = new Set();
  let m;
  while ((m = re.exec(masked))) {
    let val = m[1].trim();
    let imp = '';
    const im = val.match(/^(.*?)\s*!important$/i);
    if (im) {
      val = im[1].trim();
      imp = ' !important';
    }
    const tok = lookup(base, val);
    if (!tok) {
      if (val !== 'inherit' && !val.startsWith('var(')) skipped.add(val);
      continue;
    }
    out += src.slice(last, m.index) + `font-size: var(--fs-${tok})${imp}${m[2]}`;
    last = m.index + m[0].length;
    n++;
  }
  out += src.slice(last);
  writeFileSync(path, out);
  total += n;
  console.log(
    `${rel.padEnd(30)} ${String(n).padStart(3)} diganti` +
      (skipped.size ? `  ⚠ tak dikenal: ${[...skipped].join(' | ')}` : '')
  );
}
console.log(`\nTotal: ${total} deklarasi font-size → token lima tingkat.`);
