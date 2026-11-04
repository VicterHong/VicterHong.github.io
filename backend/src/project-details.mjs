/** Presentation evidence lives beside locked content, never in public assets. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

export function projectDetails(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  try {
    const catalogue = JSON.parse(readFileSync(join(config.contentDir, 'presentation.json'), 'utf8'));
    const data = Object.hasOwn(catalogue, slug) ? catalogue[slug] : null;
    if (!data || !Array.isArray(data.metrics) || !Array.isArray(data.highlights)) return null;
    return { metrics: data.metrics, highlights: data.highlights };
  } catch { return null; }
}

/**
 * Total tes otomatis semua proyek untuk angka di hero. Dihitung di server
 * dari katalog privat, karena pengguna Free hanya menerima detail proyek yang
 * sudah ia buka; menjumlahkan di browser membuat angkanya 0.
 * Mengembalikan null kalau katalog tidak terbaca, supaya UI tidak memamerkan 0.
 */
export function totalTestCount(dir = config.contentDir) {
  try {
    const catalogue = JSON.parse(readFileSync(join(dir, 'presentation.json'), 'utf8'));
    let total = 0;
    for (const data of Object.values(catalogue)) {
      for (const m of Array.isArray(data?.metrics) ? data.metrics : []) {
        if (typeof m?.label === 'string' && m.label.includes('tes otomatis')) {
          const n = Number(String(m.value).replace(/\./g, ''));
          if (Number.isFinite(n)) total += n;
        }
      }
    }
    return total;
  } catch { return null; }
}
