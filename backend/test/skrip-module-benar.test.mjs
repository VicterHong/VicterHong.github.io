/**
 * Penjaga: skrip yang memakai `import` wajib dimuat dengan type="module".
 *
 * ── KENAPA TES INI ADA ──────────────────────────────────────────────────────
 * Halaman changelog dimuat tanpa `type="module"` pada logo-mount.js — padahal
 * berkas itu memakai `import`. Akibatnya browser menolak seluruh berkas dengan
 * "Cannot use import statement outside a module", dan monogram VIVASTIC tidak
 * pernah muncul di halaman itu.
 *
 * Yang berbahaya: halaman TETAP 200 dan tampak normal. Tidak ada tes, tidak ada
 * monitor, tidak ada preflight yang menangkapnya — hanya pengunjung yang
 * memperhatikan logonya hilang.
 *
 * ── KENAPA DIPERIKSA DARI SUMBER, BUKAN dist/ ───────────────────────────────
 * Bug-nya ada di HTML sumber. Memeriksa dist/ hanya akan menemukan gejalanya
 * setelah build, dan build tidak memperbaiki atribut script. Sumber adalah
 * tempat di mana perbaikannya harus dilakukan.
 *
 * ── KENAPA SETIAP HALAMAN, BUKAN SATU ───────────────────────────────────────
 * Pola bug-nya adalah "satu halaman tertinggal saat halaman lain diperbaiki".
 * Memeriksa satu halaman tidak akan menangkapnya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Semua berkas .html di akar proyek (bukan di dist/ atau node_modules). */
function daftarHalaman() {
  return readdirSync(AKAR)
    .filter((f) => f.endsWith('.html'))
    .sort();
}

/** Semua tag <script src="..."> di sebuah HTML, beserta atributnya. */
function skripEksternal(html) {
  const hasil = [];
  const pola = /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi;
  let m;
  while ((m = pola.exec(html)) !== null) {
    const atribut = (m[1] + ' ' + m[3]).trim();
    hasil.push({
      src: m[2],
      module: /\btype\s*=\s*["']module["']/i.test(atribut),
      tag: m[0].slice(0, 120),
    });
  }
  return hasil;
}

/** Apakah berkas JS memakai `import`/`export` tingkat atas? */
function pakaiSintaksModul(isi) {
  // Buang komentar dulu — komentar sering menyebut kata "import" dan itu
  // bukan sintaks. (Berkas logo-mount.js justru menjelaskan `import` di
  // komentarnya.)
  const tanpaKomentar = isi
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  return /(^|\n)\s*import\s+[\s{('"*]/.test(tanpaKomentar)
    || /(^|\n)\s*import\s*\{/.test(tanpaKomentar)
    || /(^|\n)\s*export\s+(default|const|let|var|function|class|\{)/.test(tanpaKomentar);
}

/** Ubah src relatif menjadi path berkas di disk. */
function kePath(src) {
  let s = src.replace(/^\//, '');       // /assets/... → assets/...
  s = s.split('?')[0];                   // buang query string
  return join(AKAR, s);
}

test('setiap skrip yang memakai import dimuat sebagai module', () => {
  const halaman = daftarHalaman();
  assert.ok(halaman.length > 5, `halaman ditemukan: ${halaman.length}`);

  const pelanggaran = [];
  let diperiksa = 0;

  for (const nama of halaman) {
    const html = readFileSync(join(AKAR, nama), 'utf8');

    for (const s of skripEksternal(html)) {
      // Hanya berkas lokal — CDN pihak ketiga bukan urusan kita.
      if (/^https?:/i.test(s.src)) continue;

      const path = kePath(s.src);
      if (!existsSync(path)) continue;   // berkas hilang diurus tes lain

      const isi = readFileSync(path, 'utf8');
      diperiksa++;

      if (pakaiSintaksModul(isi) && !s.module) {
        pelanggaran.push(`${nama}: ${s.src} memakai import tapi tanpa type="module"`);
      }
    }
  }

  assert.ok(diperiksa > 20, `skrip lokal diperiksa: ${diperiksa}`);
  assert.deepEqual(pelanggaran, [],
    'skrip berikut akan GAGAL TOTAL di browser:\n  ' + pelanggaran.join('\n  '));
});

test('changelog.html memuat logo-mount.js sebagai module (regresi spesifik)', () => {
  const html = readFileSync(join(AKAR, 'changelog.html'), 'utf8');
  const skrip = skripEksternal(html).filter((s) => s.src.includes('logo-mount'));

  assert.equal(skrip.length, 1, 'logo-mount.js harus dimuat tepat sekali');
  assert.ok(skrip[0].module,
    'logo-mount.js memakai `import` — tanpa type="module" monogram tidak muncul');
});
