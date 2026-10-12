#!/usr/bin/env node
/**
 * Ganti path absolut /home/ubuntu/portfolio-victer dengan path relatif.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MASALAH YANG DIPERBAIKI ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tes memakai path absolut ke direktori kerja mesin pengembang:
 *
 *   const sumber = readFileSync('/home/ubuntu/portfolio-victer/backend/src/routes.mjs');
 *
 * Di lokal itu bekerja. Di GitHub Actions, checkout berada di:
 *
 *   /home/runner/work/VicterHong.github.io/VicterHong.github.io/
 *
 * Akibatnya 11 tes GAGAL di CI padahal lulus di lokal — dan kegagalan itu
 * terlihat seperti "kode rusak", padahal cuma path yang salah.
 *
 * ── SOLUSI ──────────────────────────────────────────────────────────────────
 * Setiap berkas tes menghitung path-nya SENDIRI dari lokasi berkas itu:
 *
 *   const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
 *   const sumber = readFileSync(join(AKAR, 'backend', 'src', 'routes.mjs'));
 *
 * Dengan begitu tes bekerja di mana pun repo di-checkout — lokal, CI, atau
 * mesin orang lain.
 *
 * Jalankan: node scripts/perbaiki-path-tes.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = resolve(__dirname, '..');
const DIR_TES = join(AKAR, 'backend', 'test');

const POLA_ABS = /\/home\/ubuntu\/portfolio-victer/g;

let diperbaiki = 0;
let dilewati = 0;

console.log('');
console.log('  ══ PERBAIKI PATH ABSOLUT DI TES ══');
console.log('');

for (const berkas of readdirSync(DIR_TES)) {
  if (!berkas.endsWith('.mjs')) continue;

  const jalur = join(DIR_TES, berkas);
  const asli = readFileSync(jalur, 'utf8');

  if (!POLA_ABS.test(asli)) {
    dilewati += 1;
    continue;
  }

  let isi = asli;

  // ── 1. Ganti string path absolut dengan join(AKAR, ...) ────────────────────
  //
  // Bentuk: '/home/ubuntu/portfolio-victer/backend/src/x.mjs'
  // Jadi:   join(AKAR, 'backend', 'src', 'x.mjs')
  isi = isi.replace(/'\/home\/ubuntu\/portfolio-victer\/([^']+)'/g, (_, sisa) => {
    const bagian = sisa.split('/').filter(Boolean).map((b) => `'${b}'`).join(', ');
    return `join(AKAR, ${bagian})`;
  });

  // Bentuk tanpa kutip di dalam template literal
  isi = isi.replace(/`\/home\/ubuntu\/portfolio-victer\/([^`]+)`/g, (_, sisa) => {
    const bagian = sisa.split('/').filter(Boolean).map((b) => `'${b}'`).join(', ');
    return `join(AKAR, ${bagian})`;
  });

  // ── 2. Sisa kemunculan (mis. di komentar) → ganti jadi teks generik ────────
  isi = isi.replace(POLA_ABS, '<akar-repo>');

  // ── 3. Pastikan impor yang dibutuhkan ada ──────────────────────────────────
  //
  // Kalau berkas belum mengimpor resolve/dirname/fileURLToPath/join, tambahkan.
  const butuhImpor = /join\(AKAR/.test(isi);

  if (butuhImpor) {
    const punyaResolve = /import\s*\{[^}]*\bresolve\b[^}]*\}\s*from\s*'node:path'/.test(isi);
    const punyaDirname = /import\s*\{[^}]*\bdirname\b[^}]*\}\s*from\s*'node:path'/.test(isi);
    const punyaFileUrl = /import\s*\{[^}]*\bfileURLToPath\b[^}]*\}\s*from\s*'node:url'/.test(isi);
    const punyaJoin = /import\s*\{[^}]*\bjoin\b[^}]*\}\s*from\s*'node:path'/.test(isi);

    const imporBaru = [];

    if (!punyaResolve || !punyaDirname || !punyaJoin) {
      const bagian = [];
      if (!punyaResolve) bagian.push('resolve');
      if (!punyaDirname) bagian.push('dirname');
      if (!punyaJoin) bagian.push('join');
      imporBaru.push(`import { ${bagian.join(', ')} } from 'node:path';`);
    }

    if (!punyaFileUrl) {
      imporBaru.push("import { fileURLToPath } from 'node:url';");
    }

    if (imporBaru.length) {
      // Sisipkan setelah blok impor terakhir.
      const barisImpor = [...isi.matchAll(/^import .+;$/gm)];
      if (barisImpor.length) {
        const terakhir = barisImpor[barisImpor.length - 1];
        const posisi = terakhir.index + terakhir[0].length;
        isi = isi.slice(0, posisi) + '\n' + imporBaru.join('\n') + isi.slice(posisi);
      } else {
        isi = imporBaru.join('\n') + '\n\n' + isi;
      }
    }

    // ── 4. Sisipkan definisi AKAR setelah impor ──────────────────────────────
    if (!/const AKAR\s*=/.test(isi)) {
      const penanda = /^(import .+;)$/gm;
      const cocok = [...isi.matchAll(penanda)];
      const posisi = cocok.length
        ? cocok[cocok.length - 1].index + cocok[cocok.length - 1][0].length
        : 0;

      const definisi = `\n\n// ── Akar repo dihitung dari lokasi berkas ini ────────────────────────────\n`
        + `//\n`
        + `// ── KENAPA TIDAK PATH ABSOLUT ────────────────────────────────────────────\n`
        + `// Path seperti '/home/ubuntu/portfolio-victer/...' hanya benar di SATU\n`
        + `// mesin. Di GitHub Actions, checkout berada di\n`
        + `// /home/runner/work/<repo>/<repo>/ — dan semua tes yang memakai path\n`
        + `// absolut GAGAL di sana meski lulus di lokal.\n`
        + `//\n`
        + `// Menghitung dari lokasi berkas membuat tes bekerja di mana pun.\n`
        + `const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');\n`;

      isi = isi.slice(0, posisi) + definisi + isi.slice(posisi);
    }
  }

  if (isi !== asli) {
    writeFileSync(jalur, isi, 'utf8');
    console.log(`  ✅ ${berkas}`);
    diperbaiki += 1;
  } else {
    dilewati += 1;
  }
}

console.log('');
console.log(`  ${diperbaiki} berkas diperbaiki, ${dilewati} dilewati`);
console.log('');
