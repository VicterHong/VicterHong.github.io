// Build-only adapters: replace evidence payloads with authenticated requests.
import * as sandbox from '../assets/js/data/sandbox.js';
const load = `let evidence = {}; try { const r = await fetch('/api/klien/evidence', {credentials:'include', cache:'no-store'}); if(r.ok) evidence = await r.json(); } catch {}\n`;
export function privateModule(relativePath) {
  if (relativePath === 'data/metrik.js') return load + `export const metrikProyek = evidence.metrikProyek || {}; export const catatanMetrik = evidence.catatanMetrik || {judul:'',poin:[]};`;
  if (relativePath === 'data/alur.js') return load + `export const alurProyek = evidence.alurProyek || {}; export const JENIS_LANGKAH = evidence.jenisLangkah || {};`;
  if (relativePath === 'data/sandbox.js') return load
    + `export const contohParts = evidence.sandbox?.parts || []; export const contohMovements = evidence.sandbox?.movements || [];\n`
    + ['partsMenipis', 'nilaiStok', 'ringkasDemo', 'aksiBekerja'].map(name => `export ${sandbox[name].toString()}\n`).join('')
    + `export const PEMBERITAHUAN_SANDBOX = ${JSON.stringify(sandbox.PEMBERITAHUAN_SANDBOX)};\n`
    + `export const AKSI_BEKERJA = new Set(${JSON.stringify([...sandbox.AKSI_BEKERJA])});\n`;
  return null;
}
