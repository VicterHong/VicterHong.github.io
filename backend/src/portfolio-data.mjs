/**
 * Pemuat data portofolio untuk kebutuhan server (SEO/AEO).
 *
 * Data aslinya ada di frontend: `assets/js/data/projects.js` — modul ESM.
 * Kami mengimpornya secara dinamis (dengan cache 5 menit) supaya server dan
 * frontend selalu memakai SATU sumber data yang sama.
 *
 * Kalau berkas tidak ada (mis. server tanpa repo), kembalikan struktur
 * minimal supaya endpoint SEO tetap menjawab — bukan error 500.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let cache = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

/** Cari berkas data dari beberapa lokasi yang mungkin. */
function findDataFile() {
  const candidates = [
    resolve(process.cwd(), 'assets/js/data/projects.js'),
    resolve(process.cwd(), '../assets/js/data/projects.js'),
    resolve(import.meta.dirname, '../../assets/js/data/projects.js'),
    resolve(import.meta.dirname, '../../../assets/js/data/projects.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Muat data portofolio (profile + projects). Async karena impor ESM.
 * Di-cache supaya tidak membaca & mengeksekusi modul di setiap request.
 */
export async function loadPortfolioData() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache;

  const file = findDataFile();
  if (!file) {
    cache = { profile: null, projects: [], sideProjects: [] };
    cachedAt = now;
    return cache;
  }

  try {
    const mod = await import(pathToFileURL(file).href);
    cache = {
      profile: mod.profile ?? null,
      projects: Array.isArray(mod.projects) ? mod.projects : [],
      sideProjects: Array.isArray(mod.sideProjects) ? mod.sideProjects : [],
    };
  } catch {
    cache = { profile: null, projects: [], sideProjects: [] };
  }

  cachedAt = now;
  return cache;
}

/** Buang cache — dipakai pengujian. */
export function clearPortfolioCache() {
  cache = null;
  cachedAt = 0;
}
