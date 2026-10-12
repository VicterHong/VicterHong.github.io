/**
 * Bangun varian email dengan tema GitHub — untuk perbandingan visual.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA SKRIP TERPISAH, BUKAN MENGUBAH TEMPLATE UTAMA ────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tema adalah PILIHAN DESAIN, bukan fakta. Mengubah template utama berarti
 * kehilangan brand VIVASTIC — dan itu keputusan yang harus diambil pemilik
 * brand, bukan pengembang.
 *
 * Skrip ini membangun varian GitHub di samping yang asli, sehingga keduanya
 * bisa dibandingkan berdampingan sebelum ada yang diputuskan.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 * 1. Impor TEMPLATE dari sumber MJML
 * 2. Impor kedua tema
 * 3. Untuk setiap template, hasilkan DUA versi: vivastic + github
 * 4. Tulis ke /tmp/email-tema/ untuk screenshot berdampingan
 *
 * Jalankan: node scripts/banding-tema.mjs
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const KELUAR = '/tmp/email-tema';

const CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

let mjml2html;
try {
  ({ default: mjml2html } = await import('mjml'));
} catch {
  console.error('❌ Paket mjml tidak terpasang. Jalankan: npm install --save-dev mjml');
  process.exit(1);
}

const { TEMPLATE } = await import(join(ROOT, 'email-src', 'templates.mjml.mjs'));
const { TEMA_VIVASTIC, TEMA_GITHUB } = await import(join(ROOT, 'email-src', 'tema.mjs'));

// ── Template yang dibandingkan ────────────────────────────────────────────────
//
// Dipilih yang paling mewakili: satu email kode (struktur paling ketat),
// satu struk (tabel data), satu notifikasi (nada informatif).
const BANDING = [
  'kode_hapus_akun',
  'struk_pembayaran',
  'langganan_akan_berakhir',
];

// ── Ganti warna tema di MJML ──────────────────────────────────────────────────
//
// ── KENAPA CARI-GANTI, BUKAN PARAMETER ──────────────────────────────────────
// Sumber MJML menuliskan warna langsung sebagai literal (`#f5c542`, dst).
// Menjadikannya parameter berarti mengubah 600+ baris sumber — dan itu
// perubahan besar yang tidak perlu hanya untuk membandingkan tema.
//
// Cari-ganti pada HASIL MJML (bukan pada sumber) lebih aman: ia hanya
// menyentuh string warna, tidak menyentuh struktur.
//
// Pemetaan dari warna VIVASTIC → warna GitHub. Hanya warna yang BERBEDA
// secara peran yang dipetakan; warna semantik (hijau/merah) dibiarkan
// karena GitHub memakai nilai serupa.
const PETA_WARNA = {
  [TEMA_VIVASTIC.kanvas]: TEMA_GITHUB.kanvas,
  [TEMA_VIVASTIC.latar]: TEMA_GITHUB.latar,
  [TEMA_VIVASTIC.permukaan1]: TEMA_GITHUB.permukaan1,
  [TEMA_VIVASTIC.permukaan2]: TEMA_GITHUB.permukaan2,
  [TEMA_VIVASTIC.permukaan3]: TEMA_GITHUB.permukaan3,
  [TEMA_VIVASTIC.garisHalus]: TEMA_GITHUB.garisHalus,
  [TEMA_VIVASTIC.garisLembut]: TEMA_GITHUB.garisLembut,
  [TEMA_VIVASTIC.garis]: TEMA_GITHUB.garis,
  [TEMA_VIVASTIC.teks]: TEMA_GITHUB.teks,
  [TEMA_VIVASTIC.teksRedup]: TEMA_GITHUB.teksRedup,
  [TEMA_VIVASTIC.teksSamar]: TEMA_GITHUB.teksSamar,
  [TEMA_VIVASTIC.teksBisu]: TEMA_GITHUB.teksBisu,
  [TEMA_VIVASTIC.aksen]: TEMA_GITHUB.aksen,
  [TEMA_VIVASTIC.aksenTerang]: TEMA_GITHUB.aksenTerang,
  [TEMA_VIVASTIC.aksenGelap]: TEMA_GITHUB.aksenGelap,
  [TEMA_VIVASTIC.emas]: TEMA_GITHUB.emas,
  [TEMA_VIVASTIC.emasTerang]: TEMA_GITHUB.emasTerang,
  [TEMA_VIVASTIC.emasGelap]: TEMA_GITHUB.emasGelap,
  [TEMA_VIVASTIC.teksDiAtasAksen]: TEMA_GITHUB.teksDiAtasAksen,
};

// Gradient atmosferik: GitHub tidak memakainya — hapus.
const POLA_ATMO = /radial-gradient\([^)]*245,197,66[^)]*\)/g;

function keGithub(html) {
  let hasil = html;

  // Hapus gradient atmosferik (GitHub memakai latar rata).
  hasil = hasil.replace(POLA_ATMO, 'none');

  // Ganti setiap warna sesuai peta. Urutan tidak penting karena nilainya unik.
  for (const [dari, ke] of Object.entries(PETA_WARNA)) {
    if (dari === ke) continue;
    hasil = hasil.split(dari).join(ke);
    // Bentuk huruf besar juga (sebagian HTML menulis #F5C542)
    hasil = hasil.split(dari.toUpperCase()).join(ke);
  }

  return hasil;
}

// ── Bangun ────────────────────────────────────────────────────────────────────

rmSync(KELUAR, { recursive: true, force: true });
mkdirSync(KELUAR, { recursive: true });

console.log('');
console.log('  ══ BANDING TEMA: VIVASTIC vs GITHUB ══');
console.log('');

let berhasil = 0;

for (const nama of BANDING) {
  const def = TEMPLATE[nama];
  if (!def) {
    console.error(`  ❌ Template "${nama}" tidak ada`);
    continue;
  }

  const mjmlSumber = def.mjml();

  // Nilai contoh — supaya tampilan terisi
  const nilai = {
    sapaan: 'Halo Victer,',
    nama: 'Victer',
    kode: '483920',
    berlaku_menit: '15',
    sisa_hari: '7',
    tanggal_berakhir: '19 Oktober 2026',
    jumlah: 'Rp1.500.000',
    paket: 'Profesional',
    nomor_pesanan: 'VIV-2026-0001',
    email: 'victer@contoh.id',
    tanggal: '12 Oktober 2026',
    status: 'Lunas',
    waktu: '12 Oktober 2026 pukul 07.40 WIB',
    alamat: 'Jakarta',
    perangkat: 'Chrome di Android',
    lokasi: 'Jakarta, Indonesia',
    ip: '103.10.20.30',
    judul: 'Judul',
    judul_email: 'Email',
    tahun: '2026',
    blok_sisa_hari: '',
    blok_verifikasi: '',
    blok_lokasi: '',
    tautan: 'https://victer.is-a.dev/reset?token=contoh',
    tautan_perpanjang: 'https://victer.is-a.dev/pricing',
    tautan_bayar: 'https://victer.is-a.dev/pricing',
    label_token: 'Production API',
    tanggal_kedaluwarsa: '26 Oktober 2026',
    alasan: 'Kartu ditolak',
    periode: 'Tahunan (12 bulan)',
    perpanjangan: 'Rp1.500.000',
  };

  for (const [label, transformasi] of [['vivastic', (s) => s], ['github', keGithub]]) {
    try {
      const keluaran = await mjml2html(mjmlSumber, {
        validationLevel: 'strict',
        minify: false,
      });

      let html = keluaran.html;

      // Isi variabel (nilai contoh) — supaya tampilan tidak penuh {{...}}
      for (const [k, v] of Object.entries(nilai)) {
        html = html.split(`{{${k}}}`).join(v);
      }
      // Placeholder yang tidak ada di daftar → kosongkan
      html = html.replace(/\{\{[a-z_]+\}\}/g, '');

      // Terapkan transformasi tema
      html = transformasi(html);

      const berkasHtml = join(KELUAR, `${nama}-${label}.html`);
      const berkasPng = join(KELUAR, `${nama}-${label}.png`);

      writeFileSync(berkasHtml, html, 'utf8');

      execFileSync(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=2',
        '--window-size=430,1500',
        `--screenshot=${berkasPng}`,
        `file://${berkasHtml}`,
      ], { stdio: 'pipe', timeout: 60_000 });

      console.log(`  ✅ ${nama}-${label}.png`);
      berhasil += 1;
    } catch (e) {
      console.error(`  ❌ ${nama}-${label}: ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
}

console.log('');
console.log(`  ${berhasil}/${BANDING.length * 2} screenshot → ${KELUAR}/`);
console.log('');
