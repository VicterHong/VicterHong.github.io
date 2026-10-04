/**
 * Daftar proyek untuk panel admin — SATU sumber kebenaran.
 *
 * Sebelumnya panel admin meng-hardcode 2 proyek (mina, spareparts) di HTML,
 * padahal ada 3+ proyek. Akibatnya proyek baru tidak bisa diterbitkan tokennya.
 *
 * Sekarang: daftar dibaca dari berkas data yang sama dengan situs publik
 * (assets/js/data/projects.js), jadi menambah proyek di satu tempat otomatis
 * muncul di panel admin — tidak perlu menyentuh HTML.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cari berkas data proyek dari beberapa lokasi yang mungkin. */
function findDataFile() {
  const candidates = [
    resolve(import.meta.dirname, '../../assets/js/data/projects.js'),
    resolve(process.cwd(), '../assets/js/data/projects.js'),
    resolve(process.cwd(), 'assets/js/data/projects.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let cache = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

/**
 * Ekstrak daftar proyek dari berkas data frontend.
 *
 * Tidak memakai `import()` karena berkas itu memakai sintaks ESM dengan
 * data yang kompleks — cukup ambil slug + name + gated lewat regex yang
 * toleran terhadap format. Kalau gagal, kembalikan daftar kosong (panel
 * admin tetap bisa dibuka, hanya tanpa pilihan proyek).
 */
export function listProjects() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache;

  const file = findDataFile();
  if (!file) { cache = []; cachedAt = now; return cache; }

  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { cache = []; cachedAt = now; return cache; }

  const projects = [];

  // Ambil blok `export const projects = [ ... ]` lalu cari tiap objek proyek.
  const blockMatch = text.match(/export const projects\s*=\s*\[([\s\S]*?)\n\];/);
  const source = blockMatch ? blockMatch[1] : text;

  // Setiap proyek punya `slug: 'x'` dan `name: 'Y'`. Ambil berpasangan.
  const re = /slug:\s*['"]([a-z0-9][a-z0-9-]*)['"][\s\S]{0,600}?name:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const slug = m[1];
    const name = m[2];
    if (!projects.some(p => p.slug === slug)) {
      projects.push({ slug, name });
    }
  }

  // Cadangan: kalau regex di atas tidak menemukan apa pun, ambil semua slug
  // yang muncul (nama = slug dengan huruf kapital).
  if (!projects.length) {
    const slugRe = /slug:\s*['"]([a-z0-9][a-z0-9-]*)['"]/g;
    while ((m = slugRe.exec(text)) !== null) {
      const slug = m[1];
      if (!projects.some(p => p.slug === slug)) {
        projects.push({ slug, name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) });
      }
    }
  }

  cache = projects;
  cachedAt = now;
  return cache;
}

/** Buang cache — dipakai pengujian / setelah data berubah. */
export function clearProjectsCache() {
  cache = null;
  cachedAt = 0;
}

/**
 * Apakah slug proyek valid (ada di daftar).
 * Dipakai untuk memvalidasi penerbitan token — mencegah token untuk
 * proyek yang tidak ada (salah ketik, dsb).
 */
export function isKnownProject(slug) {
  return listProjects().some(p => p.slug === slug);
}
