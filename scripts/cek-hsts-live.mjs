/**
 * Cek HSTS di produksi — dan dokumentasikan penyimpangan yang diketahui.
 *
 * ── KENAPA SKRIP INI ADA ────────────────────────────────────────────────────
 *
 * `_headers` di repo mengirim `max-age=31536000`. Di `*.pages.dev` nilainya
 * benar. Tapi di `victer.is-a.dev` edge mengirim `max-age=0`.
 *
 * Penyebabnya bukan kode kita: `victer.is-a.dev` adalah CNAME proxied di zona
 * Cloudflare milik layanan is-a.dev (33.000+ subdomain berbagi satu zona).
 * Setting HSTS zona itu ada di posisi "wind down" (max-age 0), dan nilai zona
 * menimpa nilai origin. Bukti: subdomain acak yang TIDAK ada pun mengembalikan
 * header yang sama — respons itu dibuat Cloudflare, bukan origin.
 *
 * Skrip ini TIDAK bisa memperbaiki nilai itu (butuh akses zona is-a.dev).
 * Tugasnya menjaga agar penyimpangan ini tidak berubah diam-diam:
 *
 *   1. pages.dev wajib tetap >= 31536000 (kalau turun, `_headers` rusak).
 *   2. Hanya boleh ada SATU header HSTS (dua header = zona ikut menambah).
 *   3. Domain kustom boleh max-age=0, tapi hanya selama itu status yang
 *      diketahui. Kalau hilang sama sekali atau berubah jadi nilai lain,
 *      skrip gagal supaya kita tahu.
 *
 * Jalankan: node scripts/cek-hsts-live.mjs
 */

const DOMAIN_KUSTOM = 'https://victer.is-a.dev/';
const DOMAIN_PLATFORM = 'https://portfolio-victer.pages.dev/';

// Nilai yang diketahui untuk domain kustom. Bukan nilai yang kita inginkan —
// ini catatan kondisi nyata di zona is-a.dev.
const DIKETAHUI_KUSTOM = 'max-age=0';
const MIN_PLATFORM = 31536000;

/** Ambil semua nilai header HSTS (bisa lebih dari satu). */
async function ambilHsts(url) {
  const res = await fetch(url, { redirect: 'follow' });
  // getSetCookie tidak berlaku untuk header tunggal; pakai entries() mentah.
  const nilai = [];
  for (const [nama, isi] of res.headers) {
    if (nama.toLowerCase() === 'strict-transport-security') nilai.push(isi);
  }
  return { status: res.status, nilai };
}

/** Ambil angka max-age dari satu nilai header. */
function maxAge(nilai) {
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(nilai);
  return m ? Number(m[1]) : null;
}

const gagal = [];
const catatan = [];

for (const [label, url] of [
  ['platform', DOMAIN_PLATFORM],
  ['kustom', DOMAIN_KUSTOM],
]) {
  let hasil;
  try {
    hasil = await ambilHsts(url);
  } catch (e) {
    gagal.push(`${label}: gagal fetch ${url} — ${e.message}`);
    continue;
  }

  if (hasil.nilai.length === 0) {
    gagal.push(`${label}: tidak ada header HSTS sama sekali (${url})`);
    continue;
  }

  if (hasil.nilai.length > 1) {
    gagal.push(
      `${label}: ada ${hasil.nilai.length} header HSTS — zona dan origin ` +
        `sama-sama menambah. Nilai: ${hasil.nilai.join(' | ')}`,
    );
  }

  const umur = maxAge(hasil.nilai[0]);
  if (umur === null) {
    gagal.push(`${label}: max-age tidak terbaca dari "${hasil.nilai[0]}"`);
    continue;
  }

  if (label === 'platform') {
    if (umur < MIN_PLATFORM) {
      gagal.push(
        `platform: max-age ${umur} < ${MIN_PLATFORM} — _headers di repo ` +
          `kemungkinan tidak ikut ter-deploy`,
      );
    } else {
      catatan.push(`platform: max-age ${umur} (benar, dari _headers)`);
    }
  } else {
    if (hasil.nilai[0].startsWith(DIKETAHUI_KUSTOM)) {
      catatan.push(
        `kustom: max-age ${umur} (diketahui — ditimpa setting zona is-a.dev, ` +
          `bukan bug repo)`,
      );
    } else {
      gagal.push(
        `kustom: nilai berubah dari kondisi yang diketahui. ` +
          `Sekarang "${hasil.nilai[0]}", sebelumnya "${DIKETAHUI_KUSTOM}". ` +
          `Periksa apakah setting zona is-a.dev berubah.`,
      );
    }
  }
}

for (const c of catatan) console.log(`  ok   ${c}`);
for (const g of gagal) console.error(`  FAIL ${g}`);

if (gagal.length) {
  console.error(`\n${gagal.length} masalah HSTS.`);
  process.exit(1);
}
console.log('\nHSTS sesuai kondisi yang diketahui.');
