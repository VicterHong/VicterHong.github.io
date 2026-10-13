#!/usr/bin/env node
/**
 * rapikan-token.mjs — tokenisasi nilai mentah (warna & radius) di LUAR :root.
 *
 * Latar: BACKLOG F1 — nilai mentah di luar :root menyimpang dari sistem token.
 * Ganti bertahap; skrip ini yang melakukan penggantian secara idempoten.
 *
 * Nilai diganti HANYA bila "telanjang":
 *   ✗ di dalam komentar
 *   ✗ di dalam blok :root (itu definisi token)
 *   ✗ di posisi fallback var() — var(--x, #nilai) adalah pola defensif yang
 *     sengaja dipertahankan (lihat catatan di BACKLOG), bukan kelalaian.
 *
 * Pakai:
 *   node scripts/rapikan-token.mjs                      laporan saja (default)
 *   node scripts/rapikan-token.mjs --tulis              terapkan semua bagian
 *   node scripts/rapikan-token.mjs --bagian=radius --tulis
 *
 * Setelah diterapkan, jalankan ulang tanpa --tulis: harus 0 (idempoten).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('assets/css');
const TULIS = process.argv.includes('--tulis');
const BAGIAN = (process.argv.find((a) => a.startsWith('--bagian=')) || '--bagian=semua').split('=')[1];

/* Aturan per bagian → berkas → nilai mentah → token pengganti.
 * Syarat token: TERSEDIA di semua halaman yang memuat berkas itu —
 *   - berkas yang dimuat bersama main.css → token main.css;
 *   - keamanan.css (halaman tanpa main.css) → gaya fallback
 *     var(--token, #nilai) seperti konvensi berkas itu;
 *   - auth.css → token milik auth.css sendiri (--latar). */
const ATURAN = {
  radius: {
    'docs.css':          { 'border-radius: 9px': 'border-radius: var(--radius-sm)' },
    'narrative.css':     { 'border-radius: 14px': 'border-radius: var(--radius)' },
    'spotlight.css':     { 'border-radius: 14px': 'border-radius: var(--radius)' },
    'keamanan.css':      { 'border-radius: 9px': 'border-radius: var(--radius-sm, 9px)' },
  },
  aksen: {
    'main.css':          { '#f7d77a': 'var(--accent-light)' },
    'interactions.css':  { '#f7d77a': 'var(--accent-light)' },
    'narrative.css':     { '#0a0a0b': 'var(--bg)', '#f7d77a': 'var(--accent-light)' },
    'pricing.css':       { '#0a0a0b': 'var(--pr-bg)' },
    'tabel-banding.css': { '#0a0a0b': 'var(--bg)' },
    'auth.css':          { '#0a0a0b': 'var(--latar)' },
  },
  status: {
    'main.css':          { '#4ade80': 'var(--sukses)' },
    'docs.css':          { '#4ade80': 'var(--sukses)' },
    'keamanan.css':      { '#4ade80': 'var(--sukses)', '#f87171': 'var(--galat)' },
  },
  /* Durasi gerak: hanya nilai yang PERSIS sama dengan token yang diganti.
     Token main.css: --motion-fast 120ms · --motion-ui 180ms · --motion-enter
     380ms · --motion-slow 620ms. Token auth.css: --durasi-kilat 140ms ·
     --durasi-cepat 220ms · --durasi-sedang 380ms · --durasi-lambat 620ms.
     Nilai tanpa padanan persis (0.22s, 0.35s, 0.4s, 520ms, delay) DIBIARKAN —
     mengganti ke token terdekat = mengubah desain, bukan tokenisasi. */
  durasi: {
    'cookies.css':       { '0.18s': 'var(--motion-ui)' },
    'interactions.css':  { '0.18s': 'var(--motion-ui)' },
    'legal.css':         { '0.18s': 'var(--motion-ui)' },
    'main.css':          { '380ms': 'var(--motion-enter)', '0.18s': 'var(--motion-ui)' },
    'pricing.css':       { '0.18s': 'var(--motion-ui)' },
    'tilt-panel.css':    { '0.12s': 'var(--motion-fast)' },
    'auth.css':          { '220ms': 'var(--durasi-cepat)', '380ms': 'var(--durasi-sedang)' },
    /* keamanan.html TIDAK memuat main.css → --motion-ui tidak tersedia;
       pola fallback var(--x, nilai) = konvensi defensif berkas ini
       (sama seperti var(--ease, …) di sekitarnya). */
    'keamanan.css':      { '0.18s': 'var(--motion-ui, 0.18s)' },
  },
};

if (BAGIAN !== 'semua' && !ATURAN[BAGIAN]) {
  console.error(`Bagian tidak dikenal: ${BAGIAN} (pilih: semua | ${Object.keys(ATURAN).join(' | ')})`);
  process.exit(1);
}
const grup = BAGIAN === 'semua' ? Object.keys(ATURAN) : [BAGIAN];

/** Tandai posisi karakter yang boleh disentuh: komentar & blok :root → nonaktif. */
function topeng(src) {
  const aktif = new Array(src.length).fill(true);
  const matikan = (a, b) => { for (let i = Math.max(0, a); i < Math.min(src.length, b); i++) aktif[i] = false; };
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) matikan(m.index, m.index + m[0].length);
  for (const m of src.matchAll(/:root\s*\{/g)) {
    let j = m.index + m[0].length;
    let depth = 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    matikan(m.index, j);
  }
  return aktif;
}

/** True bila posisi i berada di posisi fallback var(...) — var(--x, #nilai). */
function diFallbackVar(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0 || src[j] !== ',') return false;
  j--;
  let depth = 0;
  while (j >= 0) {
    const c = src[j];
    if (c === ')') depth++;
    else if (c === '(') { if (depth === 0) break; depth--; }
    j--;
  }
  if (j < 0) return false;
  let k = j - 1;
  while (k >= 0 && /[a-zA-Z-]/.test(src[k])) k--;
  return src.slice(k + 1, j) === 'var';
}

let total = 0;
for (const g of grup) {
  for (const [berkas, aturan] of Object.entries(ATURAN[g])) {
    const path = resolve(DIR, berkas);
    const asli = readFileSync(path, 'utf8');
    const aktif = topeng(asli);
    const ganti = [];
    for (const [nilai, token] of Object.entries(aturan)) {
      let idx = asli.indexOf(nilai);
      while (idx !== -1) {
        const akhir = idx + nilai.length;
        let boleh = true;
        for (let i = idx; i < akhir; i++) if (!aktif[i]) { boleh = false; break; }
        if (boleh && nilai.startsWith('#')) {
          const sisa = asli[akhir];
          if (sisa && /[0-9a-fA-F]/.test(sisa)) boleh = false; // hex 8 digit, bukan target
        }
        if (boleh && diFallbackVar(asli, idx)) boleh = false;
        if (boleh) {
          const baris = asli.slice(0, idx).split('\n').length;
          ganti.push({ awal: idx, akhir, baru: token, baris, nilai });
        }
        idx = asli.indexOf(nilai, idx + 1);
      }
    }
    if (!ganti.length) continue;
    ganti.sort((a, b) => b.awal - a.awal);
    let hasil = asli;
    for (const x of ganti) hasil = hasil.slice(0, x.awal) + x.baru + hasil.slice(x.akhir);
    console.log(`\n[${g}] ${berkas}`);
    for (const x of ganti.slice().reverse()) console.log(`  baris ${String(x.baris).padStart(4)}  ${x.nilai} → ${x.baru}`);
    total += ganti.length;
    if (TULIS) writeFileSync(path, hasil);
  }
}
console.log(`\n${TULIS ? 'DITERAPKAN' : 'KANDIDAT'}: ${total} penggantian (bagian: ${BAGIAN})`);
if (!TULIS && total) console.log('Jalankan ulang dengan --tulis untuk menerapkan.');
