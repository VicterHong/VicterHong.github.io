/**
 * Hasilkan PNG setiap template email — untuk diperiksa mata (dan dikirim ke chat).
 *
 * ── KENAPA PER TEMPLATE, BUKAN SATU GAMBAR PANJANG ─────────────────────────
 * Satu gambar berisi 8 template jadi terlalu kecil untuk dinilai: ukuran huruf,
 * jarak, dan proporsi tombol tidak terlihat. Satu gambar per template bisa
 * dibuka besar dan diperiksa seperti email sungguhan di layar ponsel.
 *
 * Jalankan: node scripts/shot-email.mjs
 * Hasil:    /tmp/email-shot/*.png  (8 berkas, lebar 430px = ukuran ponsel)
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const KELUAR = '/tmp/email-shot';

const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

const T = await import(resolve(ROOT, 'backend/src/email/templates.mjs'));

// Data contoh — sama dengan preview-email.mjs supaya hasilnya bisa dibandingkan.
const TEMPLATE = [
  ['01-reset-sandi', T.templateResetSandi({
    nama: 'Victer',
    tautan: 'https://portfolio-victer.pages.dev/reset-sandi?token=contoh-token-panjang',
    berlakuMenit: 60,
  })],
  ['02-kode-hapus-akun', T.templateKodeHapusAkun({
    nama: 'Victer', kode: '483920', berlakuMenit: 15, sisaHari: 30,
  })],
  ['03-kode-batal-hapus', T.templateKodeBatalHapus({
    nama: 'Victer', kode: '112233', berlakuMenit: 15, sisaHari: 22,
  })],
  ['04-selamat-datang', T.templateSelamatDatang({
    nama: 'Victer', email: 'victer@contoh.id',
    tautanVerifikasi: 'https://portfolio-victer.pages.dev/verifikasi?t=contoh',
  })],
  ['05-masuk-perangkat-baru', T.templateMasukPerangkatBaru({
    nama: 'Victer', perangkat: 'Chrome di Android 15', lokasi: 'Jakarta, Indonesia',
    ip: '103.10.20.30', waktu: Date.now(),
  })],
  ['06-struk-pembayaran', T.templateStrukPembayaran({
    nama: 'Victer', email: 'victer@contoh.id', nomorPesanan: 'VIV-2026-0001',
    paket: 'Profesional', periode: 'Tahunan (12 bulan)', jumlah: 'Rp1.500.000',
    status: 'Lunas', waktu: Date.now(),
  })],
  ['07-akun-dinonaktifkan', T.templateAkunDinonaktifkan({
    nama: 'Victer', sisaHari: 30,
    tautanPulihkan: 'https://portfolio-victer.pages.dev/pemulihan',
  })],
  ['08-kode-masuk', T.templateKodeMasuk({
    nama: 'Victer', kode: '998877', berlakuMenit: 10,
    lokasi: 'Bandung, Indonesia', ip: '10.0.0.1',
  })],
];

rmSync(KELUAR, { recursive: true, force: true });
mkdirSync(KELUAR, { recursive: true });

let berhasil = 0;

for (const [nama, hasil] of TEMPLATE) {
  const berkasHtml = `${KELUAR}/${nama}.html`;
  const berkasPng = `${KELUAR}/${nama}.png`;

  writeFileSync(berkasHtml, hasil.html, 'utf8');

  try {
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',   // 2x — teks tetap tajam saat diperbesar
      '--window-size=430,1400',
      `--screenshot=${berkasPng}`,
      `file://${berkasHtml}`,
    ], { stdio: 'pipe', timeout: 60_000 });

    berhasil += 1;
    console.log(`  ✅ ${nama}.png`);
  } catch (e) {
    console.error(`  ❌ ${nama}: ${e?.message?.slice(0, 100) ?? e}`);
  }
}

console.log('');
console.log(`  ${berhasil}/${TEMPLATE.length} screenshot → ${KELUAR}/`);
