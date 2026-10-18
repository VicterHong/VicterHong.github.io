/**
 * Bukti presentasi (metrik, alur, sandbox) dibaca dari direktori konten privat,
 * BUKAN dari `assets/js/data/*.js`.
 *
 * ── KENAPA DIPINDAHKAN ───────────────────────────────────────────────────────
 * Sebelumnya modul backend mengimpor `assets/js/data/metrik.js` langsung.
 * Berkas itu berada di repo PUBLIK (GitHub Pages), jadi seluruh payload —
 * angka, catatan teknis, diagram alur, dan data sandbox — bisa dibaca siapa
 * pun lewat raw.githubusercontent.com tanpa login. Gerbang akses di UI menjadi
 * satu-satunya penghalang, dan itu bukan penghalang.
 *
 * Build memang sudah mengganti modul itu dengan adapter di `dist/`, tetapi
 * sumbernya tetap publik. Sekarang satu-satunya salinan ada di
 * `~/.portfolio-token/content/evidence.json` (mode 600).
 *
 * ── KALAU BERKAS BELUM ADA ───────────────────────────────────────────────────
 * Fungsi mengembalikan nilai kosong, dan pemanggil memperlakukannya sebagai
 * "konten belum tersedia" (503) — bukan diam-diam menampilkan halaman kosong.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

let cache = null;
let cacheMtime = 0;

/** Muat sekali; muat ulang kalau berkas berubah (tanpa restart layanan). */
function evidence() {
  const path = join(config.contentDir, 'evidence.json');
  try {
    const { mtimeMs } = statSync(path);
    if (cache !== null && mtimeMs === cacheMtime) return cache;
    cache = JSON.parse(readFileSync(path, 'utf8'));
    cacheMtime = mtimeMs;
    return cache;
  } catch {
    return null;
  }
}

export function metrikProyek() {
  return evidence()?.metrikProyek ?? {};
}

export function catatanMetrik() {
  return evidence()?.catatanMetrik ?? { judul: '', poin: [] };
}

export function alurProyek() {
  return evidence()?.alurProyek ?? {};
}

export function jenisLangkah() {
  return evidence()?.jenisLangkah ?? {};
}

export function sandboxData() {
  return evidence()?.sandbox ?? { parts: [], movements: [] };
}

export function pemberitahuanSandbox() {
  return evidence()?.pemberitahuan ?? '';
}

export function aksiBekerja() {
  return new Set(evidence()?.aksiBekerja ?? []);
}

/** Buang cache — dipakai tes dan setelah konten diperbarui. */
export function lupakanCacheBukti() {
  cache = null;
  cacheMtime = 0;
}
