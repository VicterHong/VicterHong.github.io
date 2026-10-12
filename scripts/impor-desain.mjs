/**
 * Impor desain email dari platform visual (Stripo, Beefree, Mailchimp, dll).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA IMPORTER INI ADA ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Platform visual seperti Stripo.email dan Beefree.io memudahkan desain email
 * tanpa menulis kode. Tapi HTML yang mereka hasilkan:
 *
 *   • Memakai sintaks merge tag mereka sendiri ([[${nama}]], {{nama}}, dst)
 *   • Bisa memuat CSS berlebih yang tidak konsisten dengan brand kita
 *   • Tidak punya versi teks polos
 *   • Tidak terhubung ke sistem pengiriman kita
 *
 * Importer ini menjembatani: ambil HTML mereka, normalisasi variabelnya,
 * verifikasi keamanan emailnya, lalu daftarkan sebagai template yang bisa
 * dipakai sistem yang sama.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── SINTAKS VARIABEL YANG DINORMALISASI ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Setiap platform punya sintaks sendiri untuk "isian yang diganti saat kirim":
 *
 *   Stripo       [[${nama}]]  atau  [[nama]]  atau  ${nama}
 *   Beefree      [nama]       (bisa dikonfigurasi; Liquid: {{ nama }})
 *   Mailchimp    *|FNAME|*
 *   SendGrid     [%nama%]
 *   Liquid       {{ nama }}   {{nama}}
 *   Kita         {{nama}}
 *
 * Semuanya dinormalisasi ke `{{nama}}` — sintaks yang sudah dipakai sistem
 * kita (lihat backend/src/email/variabel.mjs).
 *
 * ── KENAPA NORMALISASI, BUKAN PAKAI SINTAKS MENTAH ─────────────────────────
 * Kalau tiap platform dibiarkan memakai sintaksnya sendiri, mesin pengiriman
 * harus tahu template mana berasal dari platform mana. Itu menambah satu
 * lapisan keadaan yang bisa salah. Normalisasi sekali di sini membuat
 * SEMUA template seragam di mata sistem pengiriman.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── CARA PAKAI ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Desain di Stripo/Beefree, ekspor HTML-nya
 *   2. Simpan ke email-src/impor/<nama>.html
 *   3. Buat email-src/impor/<nama>.meta.json (subjek + daftar variabel)
 *   4. Jalankan: node scripts/impor-desain.mjs
 *   5. Verifikasi + build: node scripts/build-email.mjs
 *
 * ── STRUKTUR BERKAS ─────────────────────────────────────────────────────────
 *
 *   email-src/impor/promo.html        ← HTML dari platform visual
 *   email-src/impor/promo.meta.json   ← { subjek, variabel, judul, ... }
 *
 * Importer memverifikasi keduanya, lalu menulis berkas MJML pembungkus yang
 * bisa dibaca build-email.mjs.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIR_IMPOR = join(ROOT, 'email-src', 'impor');

// ══════════════════════════════════════════════════════════════════════════════
// ── NORMALISASI SINTAKS VARIABEL ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Ubah sintaks merge tag dari berbagai platform ke `{{nama}}`.
 *
 * ── URUTAN PENTING ──────────────────────────────────────────────────────────
 * Pola yang lebih spesifik HARUS diperiksa lebih dulu. `[[${nama}]]` dan
 * `[[nama]]` sama-sama dimulai `[[`, jadi yang lebih panjang diperiksa dulu —
 * kalau tidak, `[[${nama}]]` akan tercocok sebagian dan menyisakan `${` di
 * hasilnya.
 */
export function normalisasiVariabel(html) {
  let hasil = html;

  // ── Stripo: [[${nama}]] ─────────────────────────────────────────────────────
  // Bentuk paling umum dari ekspor Stripo. `\s*` menoleransi spasi.
  hasil = hasil.replace(/\[\[\s*\$\{\s*([a-zA-Z0-9_]+)\s*\}\s*\]\]/g, '{{$1}}');

  // ── Stripo alternatif: [[nama]] ────────────────────────────────────────────
  hasil = hasil.replace(/\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g, '{{$1}}');

  // ── Stripo bentuk pendek: ${nama} ──────────────────────────────────────────
  // HANYA kalau berada di luar atribut gaya. `${...}` juga dipakai di CSS
  // (template literal JS tidak, tapi sebagian platform menulisnya).
  hasil = hasil.replace(/\$\{\s*([a-zA-Z0-9_]+)\s*\}/g, '{{$1}}');

  // ── Mailchimp: *|FNAME|* ───────────────────────────────────────────────────
  // Huruf besar dan garis bawah — dinormalkan ke huruf kecil.
  hasil = hasil.replace(/\*\|([A-Z0-9_]+)\|\*/g, (_, nama) => `{{${nama.toLowerCase()}}}`);

  // ── SendGrid: [%nama%] ─────────────────────────────────────────────────────
  hasil = hasil.replace(/\[%([a-zA-Z0-9_]+)%\]/g, '{{$1}}');

  // ── Beefree/Liquid: {{ nama }} → {{nama}} ──────────────────────────────────
  // Spasi di dalam kurung dihapus supaya cocok dengan regex pengganti kita.
  hasil = hasil.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, nama) => {
    // Nama bertitik (customer.name) jadi garis bawah — sintaks kita hanya
    // mengenal huruf, angka, dan garis bawah.
    return `{{${nama.replace(/\./g, '_')}}}`;
  });

  // ── Beefree kurung siku: [nama] ────────────────────────────────────────────
  //
  // ── KENAPA INI DIPERIKSA TERAKHIR DAN HATI-HATI ───────────────────────────
  // Kurung siku juga dipakai di HTML (atribut, komentar, CDATA). Mengganti
  // sembarang `[teks]` akan merusak HTML-nya.
  //
  // Yang aman: hanya ganti kalau isinya huruf/angka/garis bawah SAJA, dan
  // tidak mengandung spasi, tanda kutip, atau tanda sama dengan. Itu
  // mengecualikan `[if mso]`, `[endif]`, dan `[style="..."]`.
  hasil = hasil.replace(/\[([a-z][a-z0-9_]{1,30})\]/gi, (cocok, nama) => {
    // Daftar kata yang JELAS bukan variabel — bagian dari sintaks HTML/email.
    const bukanVariabel = new Set([
      'if', 'endif', 'mso', 'CDATA', 'data', 'else', 'end',
      'text', 'html', 'body', 'head', 'title', 'meta', 'link', 'img',
    ]);
    if (bukanVariabel.has(nama.toLowerCase())) return cocok;
    return `{{${nama.toLowerCase()}}}`;
  });

  return hasil;
}

/**
 * Cari semua nama variabel yang dipakai di HTML (setelah normalisasi).
 */
export function daftarVariabel(html) {
  return [...new Set([...html.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]))].sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VERIFIKASI KEAMANAN EMAIL ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Periksa HTML dari platform visual sebelum dipakai.
 *
 * ── KENAPA DIPERIKSA, BUKAN DIPERCAYA ───────────────────────────────────────
 * Platform visual menghasilkan HTML yang bekerja di PREVIEW mereka, belum
 * tentu di klien email sungguhan. Yang paling sering: tata letak berbasis
 * flexbox/grid — terlihat sempurna di browser, tapi HANCUR di Outlook yang
 * memakai mesin render Microsoft Word.
 *
 * Pemeriksaan ini menangkap masalah itu SEBELUM email dikirim, bukan setelah
 * pengguna mengeluh.
 */
export function periksaHtml(html) {
  const masalah = [];
  const saran = [];

  // ── FATAL: tata letak yang tidak didukung Outlook ─────────────────────────
  if (/display\s*:\s*flex/i.test(html)) {
    masalah.push(
      'Memakai flexbox (display:flex). Outlook memakai mesin render Microsoft ' +
      'Word yang TIDAK mengenal flexbox — tata letaknya akan hancur.'
    );
  }

  if (/display\s*:\s*grid/i.test(html)) {
    masalah.push(
      'Memakai CSS grid (display:grid). Sama seperti flexbox, tidak didukung ' +
      'Outlook sama sekali.'
    );
  }

  if (/position\s*:\s*(absolute|fixed)/i.test(html)) {
    masalah.push(
      'Memakai position:absolute/fixed. Outlook mengabaikannya, dan elemen ' +
      'yang ditata begitu akan menumpuk di kiri atas.'
    );
  }

  // ── FATAL: tidak ada tabel sama sekali ────────────────────────────────────
  const jumlahTabel = (html.match(/<table/gi) ?? []).length;
  if (jumlahTabel === 0) {
    masalah.push(
      'Tidak ada elemen <table>. Email yang hanya memakai <div> akan berantakan ' +
      'di Outlook dan sebagian klien lain. Semua email transaksional profesional ' +
      'memakai tabel untuk tata letak.'
    );
  }

  // ── FATAL: skrip ──────────────────────────────────────────────────────────
  if (/<script/i.test(html)) {
    masalah.push(
      'Mengandung <script>. Klien email MEMBLOKIR skrip, dan beberapa filter ' +
      'spam menandai email berisi skrip sebagai berbahaya.'
    );
  }

  // ── FATAL: event handler inline ───────────────────────────────────────────
  if (/\son(click|load|error|mouseover)\s*=/i.test(html)) {
    masalah.push(
      'Mengandung event handler inline (onclick, onload, dst). Klien email ' +
      'memblokirnya, dan keberadaannya menurunkan skor spam.'
    );
  }

  // ── SARAN: kualitas, bukan keamanan ───────────────────────────────────────
  if (!/color-scheme/i.test(html)) {
    saran.push(
      'Tidak ada meta color-scheme. Klien email tertentu bisa membalik warna ' +
      'secara otomatis — tambahkan <meta name="color-scheme" content="dark"> ' +
      'kalau desainnya gelap.'
    );
  }

  if (jumlahTabel > 0 && !/role=["']presentation["']/i.test(html)) {
    saran.push(
      'Tabel tidak memakai role="presentation". Pembaca layar akan membacakan ' +
      '"tabel dengan N kolom" sebelum setiap paragraf. Menambah atribut itu ' +
      'membuat email lebih ramah aksesibilitas.'
    );
  }

  if (!/max-width\s*:\s*600px/i.test(html)) {
    saran.push(
      'Tidak ada max-width 600px. Lebar itu standar email transaksional — ' +
      'tanpa itu, konten bisa terlalu lebar di desktop atau terpotong di Gmail.'
    );
  }

  return { aman: masalah.length === 0, masalah, saran, jumlahTabel };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PEMBUNGKUS MJML ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bungkus HTML impor supaya bisa diproses MJML.
 *
 * ── KENAPA <mj-raw>, BUKAN DIKONVERSI KE TAG MJML ──────────────────────────
 * Mengonversi HTML sembarang menjadi struktur MJML (mj-section > mj-column >
 * mj-text) berarti menebak maksud desainnya — dan tebakan itu sering salah:
 * dua kolom bisa jadi satu, warna bisa hilang, jarak bisa berubah.
 *
 * `<mj-raw>` meneruskan HTML apa adanya ke hasil kompilasi. Desainnya tetap
 * persis seperti yang diekspor platform visual, tapi tetap bisa diproses
 * (variabel diisi, versi teks dibuat, dikirim lewat sistem yang sama).
 *
 * ── KONSEKUENSINYA HARUS DIKATAKAN JUJUR ───────────────────────────────────
 * Karena HTML-nya diteruskan apa adanya, kompatibilitasnya bergantung pada
 * platform yang membuatnya — bukan pada MJML. Karena itu periksaHtml() di
 * atas memeriksa hal-hal yang tidak bisa diperbaiki MJML (flexbox, grid,
 * skrip).
 */
export function bungkusMjml(html, { judul, preheader }) {
  return `<mjml>
  <mj-head>
    <mj-title>${judul}</mj-title>
    <mj-preview>${preheader}</mj-preview>
    <mj-raw>
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <meta name="x-apple-disable-message-reformatting">
    </mj-raw>
  </mj-head>
  <mj-body background-color="#0a0a0b" width="600px">
    <mj-raw>
${html}
    </mj-raw>
  </mj-body>
</mjml>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PROSES IMPOR ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function imporSatu(namaBerkas) {
  const nama = basename(namaBerkas, '.html');
  const jalurHtml = join(DIR_IMPOR, `${nama}.html`);
  const jalurMeta = join(DIR_IMPOR, `${nama}.meta.json`);

  console.log('');
  console.log(`  ── ${nama} ──`);

  // ── 1. Baca HTML ──────────────────────────────────────────────────────────
  if (!existsSync(jalurHtml)) {
    console.error(`     ❌ HTML tidak ditemukan: ${jalurHtml}`);
    return false;
  }

  const htmlAsli = readFileSync(jalurHtml, 'utf8');

  if (htmlAsli.length < 500) {
    console.error(`     ❌ HTML terlalu pendek (${htmlAsli.length} byte) — sepertinya salah simpan`);
    return false;
  }

  // ── 2. Baca meta ──────────────────────────────────────────────────────────
  let meta;
  if (existsSync(jalurMeta)) {
    try {
      meta = JSON.parse(readFileSync(jalurMeta, 'utf8'));
    } catch (e) {
      console.error(`     ❌ meta.json tidak valid: ${e.message}`);
      return false;
    }
  } else {
    console.log('     ⚠️  meta.json tidak ada — memakai nilai default');
    meta = { subjek: `Email ${nama}`, judul: nama, preheader: '' };
  }

  // ── 3. Normalisasi variabel ───────────────────────────────────────────────
  const htmlNormal = normalisasiVariabel(htmlAsli);
  const variabel = daftarVariabel(htmlNormal);

  const jumlahDiganti = (htmlAsli.match(/\[\[|\*\|\[?%|\$\{/g) ?? []).length;
  console.log(`     Variabel: ${variabel.length ? variabel.join(', ') : '(tidak ada)'}`);

  // ── 4. Verifikasi keamanan email ──────────────────────────────────────────
  const periksa = periksaHtml(htmlNormal);

  for (const s of periksa.saran) {
    console.log(`     ⚠️  ${s.slice(0, 110)}…`);
  }

  if (!periksa.aman) {
    console.error('');
    console.error(`     ❌ TIDAK AMAN — ${periksa.masalah.length} masalah:`);
    for (const m of periksa.masalah) {
      console.error(`        • ${m}`);
    }
    console.error('');
    console.error('     Perbaiki desainnya di platform visual, ekspor ulang, lalu jalankan lagi.');
    console.error('     (Atau paksa dengan --paksa kalau Anda sudah memeriksa sendiri.)');
    return false;
  }

  console.log(`     ✅ Aman — ${periksa.jumlahTabel} tabel, tanpa flexbox/grid/skrip`);

  // ── 5. Tulis berkas MJML pembungkus ───────────────────────────────────────
  const mjml = bungkusMjml(htmlNormal, {
    judul: meta.judul ?? nama,
    preheader: meta.preheader ?? '',
  });

  const jalurMjml = join(DIR_IMPOR, `${nama}.mjml.mjs`);

  // Berkas MJML ditulis sebagai .mjs supaya bisa di-import build-email.mjs
  // dengan cara yang sama seperti template bawaan.
  const isiBerkas = `/**
 * Template impor: ${nama}
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BERKAS HASIL IMPOR — JANGAN EDIT MANUAL ─────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Dihasilkan oleh: node scripts/impor-desain.mjs
 * Sumber         : email-src/impor/${nama}.html
 *                  email-src/impor/${nama}.meta.json
 *
 * Perubahan di sini akan HILANG saat impor berikutnya. Untuk memperbarui:
 *   1. Ekspor ulang dari platform visual (Stripo/Beefree/dll)
 *   2. Timpa email-src/impor/${nama}.html
 *   3. Jalankan: node scripts/impor-desain.mjs
 *
 * ── CATATAN KOMPATIBILITAS ──────────────────────────────────────────────────
 * HTML diteruskan APA ADANYA lewat <mj-raw>. Kompatibilitas di klien email
 * bergantung pada platform yang membuatnya — bukan pada MJML. Importer sudah
 * memeriksa hal yang tidak bisa diperbaiki: flexbox, grid, skrip.
 *
 * Diimpor: ${new Date().toISOString()}
 */

export const meta = ${JSON.stringify({
    subjek: meta.subjek ?? `Email ${nama}`,
    judul: meta.judul ?? nama,
    variabelWajib: meta.variabelWajib ?? variabel,
    deskripsi: meta.deskripsi ?? `Desain impor: ${nama}`,
  }, null, 2)};

export function mjml() {
  return ${JSON.stringify(mjml)};
}
`;

  writeFileSync(jalurMjml, isiBerkas, 'utf8');
  console.log(`     ✅ Ditulis: email-src/impor/${nama}.mjml.mjs`);

  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── TITIK MASUK ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const paksa = process.argv.includes('--paksa');

console.log('');
console.log('  ══ IMPOR DESAIN EMAIL ══');

if (!existsSync(DIR_IMPOR)) {
  mkdirSync(DIR_IMPOR, { recursive: true });
  console.log('');
  console.log('  📁 Folder dibuat: email-src/impor/');
  console.log('');
  console.log('  Cara pakai:');
  console.log('    1. Desain di Stripo.email atau Beefree.io');
  console.log('    2. Ekspor HTML');
  console.log('    3. Simpan ke: email-src/impor/<nama>.html');
  console.log('    4. Buat: email-src/impor/<nama>.meta.json');
  console.log('       { "subjek": "...", "judul": "...", "preheader": "..." }');
  console.log('    5. Jalankan lagi: node scripts/impor-desain.mjs');
  console.log('');
  process.exit(0);
}

const berkasHtml = readdirSync(DIR_IMPOR).filter((f) => f.endsWith('.html'));

if (berkasHtml.length === 0) {
  console.log('');
  console.log('  Belum ada berkas .html di email-src/impor/');
  console.log('');
  console.log('  Cara pakai:');
  console.log('    1. Desain di Stripo.email atau Beefree.io');
  console.log('    2. Ekspor HTML');
  console.log('    3. Simpan ke: email-src/impor/<nama>.html');
  console.log('    4. Buat: email-src/impor/<nama>.meta.json');
  console.log('       { "subjek": "...", "judul": "...", "preheader": "..." }');
  console.log('    5. Jalankan lagi: node scripts/impor-desain.mjs');
  console.log('');
  process.exit(0);
}

let berhasil = 0;
let gagal = 0;

for (const f of berkasHtml) {
  if (imporSatu(f)) berhasil += 1;
  else gagal += 1;
}

console.log('');
console.log(`  ══ HASIL: ${berhasil} berhasil, ${gagal} gagal ══`);
console.log('');

if (berhasil > 0) {
  console.log('  Langkah berikutnya:');
  console.log('    node scripts/build-email.mjs     # kompilasi MJML → HTML');
  console.log('    node --test backend/test/         # pastikan tidak ada yang rusak');
  console.log('');
}

process.exit(gagal > 0 ? 1 : 0);
