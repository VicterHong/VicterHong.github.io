/**
 * Bangun halaman pratinjau semua template email.
 *
 * ── KENAPA PRATINJAU INI PERLU ──────────────────────────────────────────────
 *
 * Email adalah bagian sistem yang paling sulit diperiksa: ia baru terlihat
 * SETELAH dikirim, dan saat itu tidak bisa ditarik kembali. Menunggu sampai
 * ada pengguna sungguhan yang menerimanya adalah cara termahal untuk menemukan
 * salah ketik atau tata letak yang rusak.
 *
 * Skrip ini menghasilkan satu berkas HTML berisi SEMUA template dalam bentuk
 * iframe — bisa dibuka di peramban, dilihat di ukuran ponsel, dan diperiksa
 * sebelum satu email pun dikirim.
 *
 * Jalankan: node scripts/preview-email.mjs
 * Hasil:   preview-email.html (di root repo)
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const T = await import(resolve(ROOT, 'backend/src/email/templates.mjs'));

// ── Data contoh — sengaja realistis, bukan "test test" ───────────────────────
const CONTOH = [
  {
    nama: '1. Reset sandi',
    keterangan: 'Dikirim saat pengguna lupa sandi. Ada tombol + tautan cadangan.',
    hasil: T.templateResetSandi({
      nama: 'Victer',
      tautan: 'https://portfolio-victer.pages.dev/reset-sandi?token=contoh-token-panjang-abc123',
      berlakuMenit: 60,
    }),
  },
  {
    nama: '2. Kode hapus akun',
    keterangan: 'Alur berbahaya — nada tegas, kode besar, peringatan masa tenggang.',
    hasil: T.templateKodeHapusAkun({
      nama: 'Victer', kode: '483920', berlakuMenit: 15, sisaHari: 30,
    }),
  },
  {
    nama: '3. Kode batal hapus',
    keterangan: 'Pemulihan akun — menyebut sisa hari masa tenggang.',
    hasil: T.templateKodeBatalHapus({
      nama: 'Victer', kode: '112233', berlakuMenit: 15, sisaHari: 22,
    }),
  },
  {
    nama: '4. Selamat datang',
    keterangan: 'Setelah pendaftaran — sambutan + langkah berikutnya.',
    hasil: T.templateSelamatDatang({
      nama: 'Victer',
      email: 'victer@contoh.id',
      tautanVerifikasi: 'https://portfolio-victer.pages.dev/verifikasi?t=contoh',
    }),
  },
  {
    nama: '5. Masuk perangkat baru',
    keterangan: 'Peringatan keamanan — waktu, perangkat, lokasi, IP.',
    hasil: T.templateMasukPerangkatBaru({
      nama: 'Victer',
      perangkat: 'Chrome di Android 15',
      lokasi: 'Jakarta, Indonesia',
      ip: '103.10.20.30',
      waktu: Date.now(),
    }),
  },
  {
    nama: '6. Struk pembayaran',
    keterangan: 'Bukti transaksi — nomor pesanan, paket, jumlah.',
    hasil: T.templateStrukPembayaran({
      nama: 'Victer',
      email: 'victer@contoh.id',
      nomorPesanan: 'VIV-2026-0001',
      paket: 'Profesional',
      periode: 'Tahunan (12 bulan)',
      jumlah: 'Rp1.500.000',
      status: 'Lunas',
      waktu: Date.now(),
    }),
  },
  {
    nama: '7. Akun dinonaktifkan',
    keterangan: 'Masa tenggang dimulai — cara memulihkan.',
    hasil: T.templateAkunDinonaktifkan({
      nama: 'Victer', sisaHari: 30,
      tautanPulihkan: 'https://portfolio-victer.pages.dev/pemulihan',
    }),
  },
  {
    nama: '8. Kode masuk',
    keterangan: 'Verifikasi 2FA / kode masuk — memuat info lokasi.',
    hasil: T.templateKodeMasuk({
      nama: 'Victer', kode: '998877', berlakuMenit: 10,
      lokasi: 'Bandung, Indonesia', ip: '10.0.0.1',
    }),
  },
];

// ── Susun halaman ────────────────────────────────────────────────────────────
const kartu = CONTOH.map((c, i) => `
  <section class="contoh">
    <div class="kepala">
      <div>
        <h2>${c.nama}</h2>
        <p class="ket">${c.keterangan}</p>
        <p class="subjek"><span>Subjek:</span> ${c.hasil.subjek}</p>
      </div>
      <div class="aksi">
        <button onclick="document.getElementById('teks${i}').classList.toggle('tampil')">Versi teks</button>
      </div>
    </div>
    <div class="bingkai ponsel">
      <iframe srcdoc="${c.hasil.html.replace(/"/g, '&quot;')}" title="${c.nama}"></iframe>
    </div>
    <pre id="teks${i}" class="versi-teks">${c.hasil.teks.replace(/</g, '&lt;')}</pre>
  </section>`).join('');

const halaman = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pratinjau Email VIVASTIC</title>
<style>
  :root { --bg:#0a0a0b; --kartu:#16161a; --garis:#26262c; --teks:#f4f4f6; --redup:#a1a1aa; --samar:#8a8a94; --emas:#f5c542; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--teks);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  header { padding:40px 24px 24px; max-width:1200px; margin:0 auto; }
  h1 { margin:0 0 8px; font-size:26px; letter-spacing:-0.02em; }
  header p { margin:0; color:var(--redup); font-size:15px; line-height:1.6; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr));
          gap:28px; padding:0 24px 60px; max-width:1200px; margin:0 auto; }
  .contoh { background:var(--kartu); border:1px solid var(--garis); border-radius:14px; padding:20px; }
  .kepala { display:flex; justify-content:space-between; align-items:start; gap:12px; margin-bottom:14px; }
  h2 { margin:0 0 6px; font-size:17px; }
  .ket { margin:0 0 6px; color:var(--redup); font-size:13px; line-height:1.5; }
  .subjek { margin:0; font-size:12px; color:var(--samar); }
  .subjek span { color:var(--emas); }
  button { background:transparent; border:1px solid var(--garis); color:var(--redup);
           padding:6px 12px; border-radius:7px; font-size:12px; cursor:pointer; white-space:nowrap; }
  button:hover { border-color:var(--emas); color:var(--emas); }
  .bingkai { border:1px solid var(--garis); border-radius:10px; overflow:hidden; background:#000; }
  .ponsel iframe { width:100%; height:620px; border:0; display:block; background:#0a0a0b; }
  .versi-teks { display:none; margin:14px 0 0; padding:14px; background:#0a0a0b;
                border:1px solid var(--garis); border-radius:8px; font-size:12px;
                line-height:1.6; color:var(--redup); white-space:pre-wrap;
                font-family:'SF Mono',Consolas,monospace; max-height:340px; overflow:auto; }
  .versi-teks.tampil { display:block; }
  footer { text-align:center; padding:0 24px 60px; color:var(--samar); font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>Pratinjau Email VIVASTIC</h1>
  <p>${CONTOH.length} template transaksional. Semua memakai tabel (kompatibel Outlook), lebar 600px, preheader, dan versi teks. Periksa juga di layar ponsel — tata letaknya menyesuaikan.</p>
</header>
<div class="grid">${kartu}</div>
<footer>Dibangun oleh <code>scripts/preview-email.mjs</code> · setiap perubahan template perlu membangun ulang berkas ini</footer>
</body>
</html>`;

const keluar = resolve(ROOT, 'preview-email.html');
writeFileSync(keluar, halaman, 'utf8');

console.log(`✅ Pratinjau dibuat: ${keluar}`);
console.log(`   ${CONTOH.length} template · ${Math.round(halaman.length / 1024)} KB`);
console.log('');
console.log('   Buka di peramban:');
console.log(`   file://${keluar}`);
