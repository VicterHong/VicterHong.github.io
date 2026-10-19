/**
 * Tes: halaman proyek (/s/<kode>/) punya identitas yang SAMA dengan beranda.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * Halaman proyek memakai brand "Victer", nav tiga tautan, dan footer satu
 * baris — sementara beranda memakai "VIVASTIC", nav sembilan tautan, dan
 * footer 4 kolom. Pengunjung yang datang dari beranda melihat halaman yang
 * terasa milik situs lain, tepat di halaman yang tugasnya meyakinkan klien.
 *
 * ── BUG KEDUA YANG DITEMUKAN ────────────────────────────────────────────────
 * `monogram.js` memakai path RELATIF `assets/brand-vics.png`. Itu bekerja di
 * halaman root, tapi di `/s/<kode>/` browser meminta
 * `/s/<kode>/assets/brand-vics.png` → 404 → logo jatuh ke cadangan huruf "V".
 * Gejalanya halus: tidak ada error terlihat, hanya huruf V menggantikan logo.
 *
 * ── ATURAN YANG DIJAGA ──────────────────────────────────────────────────────
 *   1. brand-text harus "VIVASTIC", bukan "Victer"
 *   2. nav harus memuat tautan yang sama dengan beranda
 *   3. footer.js & logo-mount.js harus dimuat
 *   4. path aset logo di monogram.js harus ABSOLUT
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Halaman proyek = direktori di s/ yang punya index.html berisi <main>. */
function halamanProyek() {
  const dir = `${ROOT}s`;
  const hasil = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = `${dir}/${d.name}/index.html`;
    if (!existsSync(f)) continue;
    const isi = readFileSync(f, 'utf8');
    // Halaman pengalih (redirect) tidak punya <main> — lewati.
    if (!/<main[\s>]/.test(isi)) continue;
    hasil.push([d.name, isi]);
  }
  return hasil;
}

test('ada minimal dua halaman proyek untuk diperiksa', () => {
  const h = halamanProyek();
  assert.ok(h.length >= 2, `harus ada minimal 2 halaman proyek, ditemukan ${h.length}`);
});

test('brand di halaman proyek adalah VIVASTIC, bukan Victer', () => {
  for (const [nama, isi] of halamanProyek()) {
    assert.match(isi, /<span class="brand-text">VIVASTIC<\/span>/, `s/${nama}: brand harus VIVASTIC`);
    assert.doesNotMatch(isi, /<span class="brand-text">Victer<\/span>/, `s/${nama}: brand lama "Victer" masih ada`);
  }
});

test('nav halaman proyek memuat tautan yang sama dengan beranda', () => {
  const beranda = readFileSync(`${ROOT}home.html`, 'utf8');
  const navBeranda = [...beranda.matchAll(/<a href="[^"]*"[^>]*>([^<]+)<\/a>/g)]
    .map((m) => m[1].trim());

  // Tautan yang wajib ada di halaman proyek (path relatif dua tingkat).
  const wajib = ['Tentang', 'Proyek', 'Layanan', 'Harga', 'Proses', 'Dokumentasi', 'Changelog', 'Kontak'];
  for (const t of wajib) {
    assert.ok(navBeranda.includes(t), `beranda harus punya tautan "${t}" (sanity)`);
  }

  for (const [nama, isi] of halamanProyek()) {
    const nav = isi.slice(isi.indexOf('class="site-nav"'), isi.indexOf('</nav>'));
    for (const t of wajib) {
      assert.ok(nav.includes(`>${t}</a>`), `s/${nama}: nav tidak memuat "${t}"`);
    }
  }
});

test('halaman proyek memuat footer.js dan logo-mount.js', () => {
  for (const [nama, isi] of halamanProyek()) {
    assert.match(isi, /assets\/js\/footer\.js/, `s/${nama}: footer.js harus dimuat`);
    assert.match(isi, /assets\/js\/logo-mount\.js/, `s/${nama}: logo-mount.js harus dimuat`);
  }
});

test('path aset logo ABSOLUT — bekerja dari kedalaman mana pun', () => {
  const monogram = readFileSync(`${ROOT}assets/js/monogram.js`, 'utf8');
  const m = monogram.match(/const ASET_LOGO = '([^']+)'/);
  assert.ok(m, 'monogram.js harus mendefinisikan ASET_LOGO');
  assert.ok(
    m[1].startsWith('/'),
    `ASET_LOGO harus absolut (diawali /), ditemukan: ${m[1]} — `
    + 'path relatif gagal di halaman /s/<kode>/ dan logo jatuh ke cadangan huruf V',
  );
});

test('semua halaman proyek punya footer dengan kelas yang diisi footer.js', () => {
  for (const [nama, isi] of halamanProyek()) {
    assert.match(isi, /<footer class="site-footer">/, `s/${nama}: butuh <footer class="site-footer">`);
  }
});
