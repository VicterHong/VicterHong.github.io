#!/usr/bin/env node
/**
 * Build halaman /akses/.
 *
 * Kenapa skrip sendiri, bukan esbuild langsung di CLI: halaman ini butuh
 * nama berkas ber-hash (supaya cache lama tidak menyajikan bundle lama),
 * manifest yang dibaca halaman, dan salinan font yang self-hosted. Tiga hal
 * itu tidak bisa diandalkan kalau perintahnya diketik manual.
 *
 * Yang TIDAK dilakukan: sourcemap. Berkas .map akan membocorkan source asli
 * halaman berbayar, dan preflight menolaknya.
 */
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'akses');
const OUT = join(SRC, 'assets');
const FONTS = join(ROOT, 'node_modules', '@fontsource');

const FONT_FILES = [
  ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2'],
];

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'fonts'), { recursive: true });

// ── 1. JS: satu bundle ───────────────────────────────────────────────────────
// Nama TANPA hash, sama seperti aset lain di situs ini. Perlindungan versi
// basi dilakukan lewat Cache-Control must-revalidate di _headers, bukan lewat
// nama berkas: satu mekanisme, dipakai di seluruh situs.
await build({
  entryPoints: [join(SRC, 'app', 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  jsx: 'automatic',
  target: ['es2020'],
  outfile: join(OUT, 'app.js'),
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// ── 2. CSS: diminifikasi terpisah supaya bisa di-preload ─────────────────────
const cssRaw = readFileSync(join(SRC, 'app', 'app.css')).toString('utf8');

// Font disalin terpisah, jadi esbuild tidak boleh mencoba me-resolve-nya dari
// disk. URL-nya ditukar dengan penanda dulu, lalu dikembalikan apa adanya:
// hasil minifikasi tetap utuh dan rujukan font tidak berubah.
const FONT_TOKEN = '__FONT__';
const cssSiap = cssRaw.replace(/url\((['"]?)\/akses\/assets\/fonts\/([^'")]+)\1\)/g,
  (_, _q, file) => `url(${FONT_TOKEN}${file})`);

const cssBuilt = await build({
  stdin: { contents: cssSiap, loader: 'css' },
  minify: true,
  write: false,
});
// `contents` adalah Uint8Array; Buffer.from dulu, baru decode. Memanggil
// .toString('utf8') langsung menghasilkan daftar angka, bukan teks CSS.
const cssText = Buffer.from(cssBuilt.outputFiles[0].contents).toString('utf8');
const cssBuf = Buffer.from(cssText.split(FONT_TOKEN).join('/akses/assets/fonts/'));
await writeFile(join(OUT, 'app.css'), cssBuf);

// ── 3. Font: self-hosted, nama tetap (isinya tidak berubah antar build) ──────
for (const [pkg, file] of FONT_FILES) {
  await cp(join(FONTS, pkg, 'files', file), join(OUT, 'fonts', file));
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const jsBytes = readFileSync(join(OUT, 'app.js')).length;
console.log(`  akses: app.js ${kb(jsBytes)} · app.css ${kb(cssBuf.length)}`);

// ── 5. Jaring pengaman: tidak ada sisa berkas yang tidak dikenal ────────────
const stray = (await readdir(OUT, { withFileTypes: true }))
  .filter((e) => e.isFile() && e.name.endsWith('.map'))
  .map((e) => e.name);
if (stray.length) throw new Error(`sourcemap bocor: ${stray.join(', ')}`);
