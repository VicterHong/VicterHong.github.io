/**
 * Audit: apakah SETIAP endpoint /api/admin/* benar-benar dijaga isAdmin()?
 *
 * ── KENAPA PERLU DIPERIKSA, BUKAN DIPERCAYA ─────────────────────────────────
 * Menghitung total "46 endpoint, 49 pemanggilan isAdmin" tidak membuktikan
 * apa pun. Bisa saja:
 *
 *   • Satu endpoint punya DUA pemanggilan (satu di jalur sukses, satu di
 *     jalur error) → total lebih besar padahal ada endpoint tanpa penjaga
 *
 *   • Satu endpoint tidak punya penjaga sama sekali, tapi endpoint lain
 *     punya dua → totalnya tetap terlihat "cukup"
 *
 * Cara yang benar: untuk SETIAP endpoint, periksa apakah ada `isAdmin(req)`
 * di dalam blok handler-nya. Yang tidak punya → dilaporkan.
 *
 * Jalankan: node scripts/audit-admin-guard.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BERKAS = ['src/routes.mjs', 'src/purge-akun.mjs'];

/**
 * Temukan setiap blok rute dan periksa penjaganya.
 *
 * Pendekatan: cari `pattern: '/api/admin...'` lalu ambil teks dari situ
 * sampai penutup blok berikutnya (baris dengan indentasi kembali ke level
 * pattern). Lalu cari `isAdmin(req)` di dalamnya.
 */
function periksaBerkas(berkas) {
  const isi = readFileSync(berkas, 'utf8');
  const baris = isi.split('\n');

  const temuan = [];

  for (let i = 0; i < baris.length; i++) {
    const m = baris[i].match(/pattern:\s*'(\/api\/admin[^']*)'/);
    if (!m) continue;

    const pola = m[1];
    const indentasiAwal = baris[i].search(/\S/);

    // Ambil blok: dari baris ini sampai indentasi kembali ke <= indentasiAwal
    // (tapi minimal 40 baris ke depan, karena handler bisa panjang).
    let akhir = Math.min(i + 80, baris.length);
    for (let j = i + 1; j < baris.length; j++) {
      const b = baris[j];
      if (b.trim() === '') continue;
      const indentasi = b.search(/\S/);
      // Blok berakhir kalau ada `},` atau `{` di indentasi yang sama/kurang
      if (indentasi <= indentasiAwal && /^[}\]],?\s*$/.test(b.trim())) {
        akhir = j;
        break;
      }
    }

    const blok = baris.slice(i, akhir + 1).join('\n');
    const punyaPenjaga = /isAdmin\s*\(\s*req\s*\)/.test(blok);

    // Cari juga pola penjaga alternatif yang sah
    const penjagaAlternatif = [
      /isAdmin\s*\(/,              // bentuk lain dari isAdmin
      /butuhAdmin|wajibAdmin/,     // nama lain kalau ada
    ].some((p) => p.test(blok));

    temuan.push({
      pola,
      baris: i + 1,
      punyaPenjaga: punyaPenjaga || penjagaAlternatif,
      kuat: punyaPenjaga,
    });
  }

  return temuan;
}

console.log('');
console.log('  ══ AUDIT: PENJAGA ENDPOINT ADMIN ══');
console.log('');

let semua = [];
for (const b of BERKAS) {
  try {
    semua = semua.concat(periksaBerkas(join(ROOT, b)));
  } catch (e) {
    console.log(`  ⚠️  ${b}: ${e.message}`);
  }
}

const tanpaPenjaga = semua.filter((t) => !t.punyaPenjaga);
const penjagaLemah = semua.filter((t) => t.punyaPenjaga && !t.kuat);

console.log(`  Total endpoint admin: ${semua.length}`);
console.log(`  Dengan isAdmin(req) langsung: ${semua.filter((t) => t.kuat).length}`);
console.log(`  Dengan penjaga alternatif: ${penjagaLemah.length}`);
console.log(`  TANPA penjaga: ${tanpaPenjaga.length}`);
console.log('');

if (tanpaPenjaga.length > 0) {
  console.log('  ❌ ENDPOINT TANPA PENJAGA:');
  for (const t of tanpaPenjaga) {
    console.log(`     ${t.pola}  (baris ${t.baris})`);
  }
  console.log('');
} else {
  console.log('  ✅ Semua endpoint admin punya penjaga isAdmin()');
  console.log('');
}

// Keluar dengan kode error kalau ada yang tanpa penjaga — supaya bisa
// dipakai di CI.
process.exit(tanpaPenjaga.length > 0 ? 1 : 0);
