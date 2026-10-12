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
    tautan: 'https://victer.is-a.dev/reset-sandi?token=contoh-token-panjang',
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
    tautanVerifikasi: 'https://victer.is-a.dev/verifikasi?t=contoh',
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
    tautanPulihkan: 'https://victer.is-a.dev/pemulihan',
  })],
  ['08-kode-masuk', T.templateKodeMasuk({
    nama: 'Victer', kode: '998877', berlakuMenit: 10,
    lokasi: 'Bandung, Indonesia', ip: '10.0.0.1',
  })],

  // ── SIKLUS LANGGANAN ──────────────────────────────────────────────────────
  ['09-langganan-akan-berakhir', T.templateLanggananAkanBerakhir({
    nama: 'Victer', paket: 'Profesional', sisaHari: 7,
    tanggalBerakhir: Date.now() + 7 * 86400000, jumlah: 'Rp1.500.000',
  })],
  ['10-langganan-berakhir', T.templateLanggananBerakhir({
    nama: 'Victer', paket: 'Profesional', tanggalBerakhir: Date.now(),
  })],
  ['11-langganan-diperpanjang', T.templateLanggananDiperpanjang({
    nama: 'Victer', paket: 'Profesional',
    tanggalBerakhir: Date.now() + 365 * 86400000, nomorPesanan: 'VIV-2026-0001',
  })],
  ['12-pembayaran-gagal', T.templatePembayaranGagal({
    nama: 'Victer', paket: 'Standar', jumlah: 'Rp79.000',
    alasan: 'Kartu ditolak oleh bank', sisaHari: 7,
  })],
  ['13-token-akan-kedaluwarsa', T.templateTokenAkanKedaluwarsa({
    nama: 'Victer', labelToken: 'Production API', sisaHari: 14,
    tanggalKedaluwarsa: Date.now() + 14 * 86400000,
  })],
];

rmSync(KELUAR, { recursive: true, force: true });
mkdirSync(KELUAR, { recursive: true });

let berhasil = 0;

for (const [nama, hasil] of TEMPLATE) {
  const berkasHtml = `${KELUAR}/${nama}.html`;
  const berkasPng = `${KELUAR}/${nama}.png`;

  // ── SEMATKAN GAMBAR SEBAGAI DATA-URI UNTUK SCREENSHOT ────────────────────
  //
  // Halaman uji dimuat lewat `file://`, dan dari sana peramban TIDAK bisa
  // mengambil gambar `https://` (aturan keamanan lintas-origin). Akibatnya
  // logo tampil sebagai ikon gambar rusak — padahal di email asli gambarnya
  // ada dan bisa diakses.
  //
  // Menyematkan gambar sebagai data-URI membuat screenshot menampilkan apa
  // yang BENAR-BENAR dilihat penerima. Tanpa ini, setiap pemeriksaan visual
  // akan selalu melaporkan "logo rusak" dan menutupi masalah yang sebenarnya.
  let htmlUji = hasil.html;

  const gambarEmail = [...hasil.html.matchAll(/src="(https:\/\/[^"]+\.png)"/g)];
  for (const [, url] of gambarEmail) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
      htmlUji = htmlUji.split(url).join(dataUri);
    } catch { /* biarkan URL asli kalau gagal */ }
  }

  writeFileSync(berkasHtml, htmlUji, 'utf8');

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
