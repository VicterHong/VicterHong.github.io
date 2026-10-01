/**
 * Konten terkunci per proyek.
 *
 * Konten sensitif TIDAK PERNAH ada di HTML statis. Ia hidup di direktori ini
 * (di luar repo publik) dan hanya dikirim setelah token lolos verifikasi.
 *
 * Format berkas: `<slug>.json` di dalam CONTENT_DIR. Kalau berkasnya belum ada,
 * endpoint mengembalikan konten contoh supaya alur bisa diuji sebelum diisi.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.mjs';

/** Slug yang diizinkan — mencegah path traversal. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

/** Baca konten terkunci untuk satu proyek. */
export function loadLockedContent(slug) {
  if (!isValidSlug(slug)) return null;

  const file = resolve(join(config.contentDir, `${slug}.json`));
  // Pastikan hasil resolve masih di dalam contentDir — sabuk pengaman kedua.
  if (!file.startsWith(resolve(config.contentDir))) return null;

  if (!existsSync(file)) return null;

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Konten contoh — dipakai kalau berkas proyek belum diisi. */
export function sampleLockedContent(slug) {
  return {
    slug,
    title: 'Detail arsitektur (contoh)',
    note: 'Berkas konten untuk proyek ini belum diisi di server. Isi dengan mengunggah JSON ke CONTENT_DIR.',
    sections: [
      {
        heading: 'Ringkasan teknis',
        body: 'Bagian ini akan memuat arsitektur, keputusan desain, dan metrik internal proyek.',
      },
    ],
  };
}
