/**
 * Bangun aset logo untuk email — PNG @2x dari SVG.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA PNG, BUKAN SVG ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Email tidak bisa memakai SVG. Alasannya:
 *
 *   • Gmail MEMBUANG tag <svg> sepenuhnya — logo hilang tanpa jejak
 *   • Outlook (mesin render Word) tidak mengenal SVG sama sekali
 *   • Sebagian klien memblokir SVG karena bisa memuat skrip
 *
 * PNG bekerja di SEMUA klien email. Itu satu-satunya format yang aman.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA UKURAN 2× (RETINA) ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Logo ditampilkan pada 36×36 px di email. Kalau file-nya juga 36px, layar
 * ber-DPI tinggi (semua ponsel modern, MacBook) akan memperbesarnya dan
 * hasilnya buram — tepi melengkung jadi bergerigi.
 *
 * File dibuat 72×72 (2×) lalu ditampilkan dengan atribut width/height 36.
 * Klien memakai versi tajam di layar retina, dan ukuran tampilannya tetap
 * 36px di mana pun.
 *
 * Ukuran file: 72×72 PNG ≈ 2-3 KB. Jauh di bawah batas yang membuat email
 * dianggap berat.
 *
 * Jalankan: node scripts/buat-aset-email.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
const SUMBER_SVG = join(ROOT, 'assets', 'img', 'vivastic-mark.svg');
const KELUAR = join(ROOT, 'assets', 'img');

// ── Ukuran yang dibutuhkan ────────────────────────────────────────────────────
//
// 36px tampil (72 file)  → logo di kepala email
// 180px tampil (360 file) → ikon Apple Touch / pratinjau tautan besar
//
// Keduanya dibuat dari SVG yang SAMA, jadi tidak ada risiko bentuknya
// berbeda antar ukuran.
const UKURAN = [
  { nama: 'vivastic-mark-72.png', px: 72, tampil: 36 },
  { nama: 'vivastic-mark-360.png', px: 360, tampil: 180 },
];

if (!existsSync(SUMBER_SVG)) {
  console.error(`❌ SVG sumber tidak ditemukan: ${SUMBER_SVG}`);
  process.exit(1);
}

const svg = readFileSync(SUMBER_SVG, 'utf8');
mkdirSync(KELUAR, { recursive: true });

console.log('');
console.log('  ══ MEMBUAT ASET LOGO EMAIL ══');
console.log('');

for (const { nama, px, tampil } of UKURAN) {
  const berkasHtml = join(KELUAR, `.tmp-${nama}.html`);
  const berkasPng = join(KELUAR, nama);

  // Latar transparan: logo hanya pelat emas + chevron. Di email, latar gelap
  // datang dari kartu email — bukan dari gambar. Kalau gambarnya punya latar
  // sendiri, akan terlihat sebagai kotak kalau warnanya tidak persis sama.
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  html,body { margin:0; padding:0; background:transparent; }
  svg { display:block; width:${px}px; height:${px}px; }
</style></head><body>${svg.replace('<svg ', `<svg width="${px}" height="${px}" `)}</body></html>`;

  writeFileSync(berkasHtml, html, 'utf8');

  try {
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--default-background-color=00000000',   // transparan
      `--window-size=${px},${px}`,
      `--screenshot=${berkasPng}`,
      `file://${berkasHtml}`,
    ], { stdio: 'pipe', timeout: 60_000 });

    const ukuran = readFileSync(berkasPng).length;
    console.log(`  ✅ ${nama}  (${px}×${px}, tampil ${tampil}px, ${Math.round(ukuran / 1024)} KB)`);
  } catch (e) {
    console.error(`  ❌ ${nama}: ${String(e.message).slice(0, 120)}`);
  } finally {
    try { execFileSync('rm', ['-f', berkasHtml]); } catch { /* abaikan */ }
  }
}

console.log('');
console.log(`  Hasil di: ${KELUAR}/`);
console.log('');
