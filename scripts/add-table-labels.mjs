/**
 * Tambahkan data-label ke setiap <td> di tabel admin.html.
 *
 * Kenapa: di HP (≤640px) tabel berubah jadi mode kartu. CSS memakai
 * `td::before { content: attr(data-label) }` untuk menampilkan nama kolom
 * di kiri setiap nilai. Tanpa data-label, kartu hanya menampilkan nilai
 * tanpa keterangan — tidak jelas itu kolom apa.
 *
 * Cara kerja: untuk setiap blok <table>...</table>, baca nama kolom dari
 * <thead><th>, lalu isi data-label ke setiap <td> sesuai urutannya.
 *
 * Jalankan: node scripts/add-table-labels.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '..', 'backend', 'public', 'admin.html');

let html = readFileSync(FILE, 'utf8');

// Temukan setiap tabel di dalam template literal JS (dan HTML statis).
let totalLabeled = 0;
let tablesTouched = 0;

/**
 * Proses satu blok tabel: ambil header, lalu beri data-label ke setiap td.
 * Mengembalikan { block, labeled, touched }.
 */
function processTable(block) {
  // Ambil nama kolom dari <thead>.
  const theadMatch = block.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!theadMatch) return { block, labeled: 0, touched: false };

  const headers = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(m => m[1]
      // Bersihkan tag & ekspresi template di dalam header.
      .replace(/\$\{[^}]*\}/g, '')
      .replace(/<[^>]*>/g, '')
      .trim());

  if (!headers.length) return { block, labeled: 0, touched: false };

  // Ganti setiap <td> berurutan sesuai kolom.
  let col = 0;
  const newBlock = block.replace(/<td(\s[^>]*)?>/g, (match, attrs = '') => {
    // Kalau sudah punya data-label, biarkan (idempoten).
    if (attrs && attrs.includes('data-label')) {
      col = (col + 1) % headers.length;
      return match;
    }
    const label = headers[col] ?? '';
    col = (col + 1) % headers.length;
    // Pertahankan atribut lain kalau ada.
    const cleanAttrs = (attrs || '').trim();
    return cleanAttrs
      ? `<td ${cleanAttrs} data-label="${label}">`
      : `<td data-label="${label}">`;
  });

  const labeled = (newBlock.match(/data-label=/g) || []).length;
  return { block: newBlock, labeled, touched: labeled > 0 };
}

// Proses semua blok <table>...</table> (termasuk di dalam template literal).
html = html.replace(/<table[\s\S]*?<\/table>/g, (block) => {
  const result = processTable(block);
  if (result.touched) {
    tablesTouched++;
    totalLabeled += result.labeled;
  }
  return result.block;
});

writeFileSync(FILE, html, 'utf8');

console.log(`✓ ${tablesTouched} tabel diproses`);
console.log(`✓ ${totalLabeled} sel diberi data-label`);
console.log('');
console.log('Mode kartu di HP sekarang menampilkan nama kolom di kiri setiap nilai.');
