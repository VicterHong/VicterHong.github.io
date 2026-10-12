/**
 * Kompilasi MJML → HTML email + versi teks.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA BUILD-TIME, BUKAN RUNTIME ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Server email berjalan TANPA `node_modules` (lihat ExecStart di
 * portfolio-token.service — ia menjalankan `node src/server.mjs` langsung).
 * Itu keputusan yang disengaja: layanan tetap hidup walau direktori
 * dependensi rusak atau terhapus, dan tidak ada rantai pasok pihak ketiga
 * yang bisa menghentikannya.
 *
 * Kalau `email.mjs` mengimpor `mjml` saat berjalan, server butuh node_modules
 * — dan keunggulan itu hilang. Karena itu:
 *
 *   BUILD  : MJML dikompilasi di sini → HTML ditulis ke src/email/html.mjs
 *   RUNTIME: email.mjs hanya membaca string HTML yang sudah jadi
 *
 * Hasil kompilasi DI-COMMIT, jadi server yang baru di-deploy langsung punya
 * HTML tanpa perlu menjalankan build.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── VARIABEL {{...}} ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Placeholder seperti `{{nama}}` DIBIARKAN APA ADANYA di HTML hasil kompilasi.
 * Penggantian nilai terjadi saat email dikirim (lihat isiVariabel() di
 * src/email/variabel.mjs).
 *
 * Kenapa tidak diganti di sini: satu template dipakai untuk semua penerima,
 * dengan nilai berbeda-beda (nama, kode, tautan). Mengganti di build berarti
 * butuh file terkompilasi per kombinasi nilai — mustahil.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── VERSI TEKS IKUT DIBANGUN ────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * MJML tidak menghasilkan versi teks polos. Padahal versi teks wajib:
 *   1. Sebagian klien hanya menampilkan teks — email tanpa versi teks rusak
 *   2. Filter spam memberi nilai lebih untuk email yang punya kedua versi
 *   3. Pengguna pembaca layar lebih memilih versi teks
 *
 * Versi teks dibangun dari SUMBER MJML, bukan dari HTML hasil kompilasi —
 * supaya isinya kalimat asli, bukan sisa tag dan atribut gaya.
 *
 * Jalankan: node scripts/build-email.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SUMBER = join(ROOT, 'email-src', 'templates.mjml.mjs');
const KELUARAN = join(ROOT, 'backend', 'src', 'email', 'html.mjs');

// ── 1. Muat sumber MJML ───────────────────────────────────────────────────────

if (!existsSync(SUMBER)) {
  console.error(`❌ Sumber MJML tidak ditemukan: ${SUMBER}`);
  process.exit(1);
}

const { TEMPLATE } = await import(SUMBER);

// ── 2. Siapkan compiler MJML ──────────────────────────────────────────────────
//
// `mjml` diimpor dari node_modules root (devDependency). Kalau tidak ada,
// pesannya harus jelas — bukan stack trace "Cannot find module".

let mjml2html;
try {
  ({ default: mjml2html } = await import('mjml'));
} catch {
  console.error('');
  console.error('  ❌ Paket `mjml` tidak terpasang.');
  console.error('');
  console.error('  Pasang dengan:');
  console.error('    cd ' + ROOT);
  console.error('    npm install --save-dev mjml');
  console.error('');
  console.error('  MJML hanya dibutuhkan untuk BUILD. Server tidak memakainya.');
  console.error('');
  process.exit(1);
}

// ── 3. Bangun versi teks dari sumber MJML ─────────────────────────────────────
//
// ── KENAPA DARI SUMBER, BUKAN DARI HTML ─────────────────────────────────────
// HTML hasil kompilasi penuh tabel dan atribut gaya. Kalau teksnya diekstrak
// dari sana, hasilnya berisi potongan CSS dan angka — bukan kalimat.
//
// Sumber MJML justru berisi teks aslinya (di dalam <mj-text>), jadi
// membersihkan tag dari sumber memberi kalimat yang benar.

function keTeks(mjml) {
  let t = mjml;

  // Ambil hanya isi <mj-body> — kepala berisi meta dan gaya, bukan konten.
  const body = t.match(/<mj-body[\s\S]*<\/mj-body>/);
  if (body) t = body[0];

  // Buang seluruh <mj-head> kalau masih ada di dalam body.
  t = t.replace(/<mj-head[\s\S]*?<\/mj-head>/g, '');

  // <mj-button> → tulis label + URL-nya di baris terpisah.
  // Tombol tanpa URL di versi teks tidak ada gunanya: penerima tidak bisa
  // mengeklik apa pun.
  t = t.replace(/<mj-button([^>]*)>([\s\S]*?)<\/mj-button>/g, (_, atr, isi) => {
    const href = (atr.match(/href="([^"]+)"/) ?? [])[1] ?? '';
    const label = isi.replace(/<[^>]+>/g, '').trim();
    return `\n${label}${href ? `\n${href}` : ''}\n`;
  });

  // <mj-divider> → garis pemisah visual.
  t = t.replace(/<mj-divider[^>]*\/?>/g, '\n' + '─'.repeat(46) + '\n');

  // <mj-table> → buang tabelnya, sisakan teks di dalam sel.
  // Isi sel struk sudah berisi label dan nilai berpasangan; membuang tag
  // tabel menyisakan teks yang tetap terbaca.
  t = t.replace(/<\/?(mj-table|table|tr|td|thead|tbody)[^>]*>/g, '\n');

  // <mj-text> dan elemen lain → buang tag, sisakan isi.
  t = t.replace(/<mj-text[^>]*>/g, '').replace(/<\/mj-text>/g, '\n');
  t = t.replace(/<[^>]+>/g, '');

  // Entitas HTML → karakter aslinya, supaya versi teks tidak menampilkan
  // "&amp;" atau "&nbsp;" mentah.
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&#847;|&zwnj;/g, '');

  // Rapikan spasi: baris kosong beruntun jadi satu, spasi ganda jadi satu,
  // dan baris dengan spasi saja jadi kosong.
  t = t
    .split('\n')
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t;
}

// ── 4. Kompilasi setiap template ──────────────────────────────────────────────

const hasil = {};
let gagal = 0;

console.log('');
console.log('  ══ KOMPILASI MJML → HTML ══');
console.log('');

for (const [nama, def] of Object.entries(TEMPLATE)) {
  const mjml = def.mjml();

  let html;
  try {
    // ── KENAPA `await` WAJIB DI SINI ────────────────────────────────────────
    // MJML 5.4.1 mendefinisikan `mjml2html` sebagai fungsi ASYNC:
    //
    //     async function mjml2html(input, options = {}) { ... }
    //     module.exports = exports.default;   // ← CommonJS, tanpa .default
    //
    // Tanpa `await`, yang diterima adalah Promise — dan `promise.html`
    // bernilai `undefined`. Pemeriksaan panjang di bawah lalu melempar
    // "HTML terlalu pendek", sehingga pesan errornya menyesatkan: seolah
    // template-nya salah, padahal cuma lupa menunggu hasilnya.
    //
    // Versi MJML lama mengembalikan objek langsung; versi 5.x mengembalikan
    // Promise. Perbedaan ini tidak terlihat dari dokumentasi.
    const keluaran = await mjml2html(mjml, {
      // ── KENAPA validationLevel 'strict' ────────────────────────────────────
      // Tingkat longgar membiarkan tag yang salah dan menghasilkan HTML yang
      // rusak secara diam-diam. Lebih baik build gagal di sini — saat
      // pengembang melihatnya — daripada email rusak sampai ke pengguna.
      validationLevel: 'strict',
      minify: false,   // HTML terbaca lebih berguna daripada hemat beberapa byte
    });

    html = keluaran.html;

    if (!html || html.length < 500) {
      throw new Error(
        `HTML hasil kompilasi terlalu pendek (${html?.length ?? 0} char). ` +
        `Error MJML: ${JSON.stringify(keluaran.errors ?? [])}`
      );
    }
  } catch (e) {
    console.error(`  ❌ ${nama}: ${String(e.message).split('\n')[0].slice(0, 160)}`);
    gagal += 1;
    continue;
  }

  const teks = keTeks(mjml);

  // ── Verifikasi: semua placeholder {{...}} yang dipakai template HARUS
  //    terdaftar di variabelWajib ─────────────────────────────────────────────
  //
  // Kalau tidak, email sampai ke pengguna dengan "{{nama}}" mentah — dan
  // kesalahan itu baru ketahuan dari keluhan, setelah email terkirim.
  const dipakai = [...new Set([...html.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]))];
  const terdaftar = new Set([
    ...def.variabelWajib,
    // ── VARIABEL INTERNAL — diisi kerangka, bukan pemanggil template ──────────
    // Kerangka (kepala, kaki, judul kartu) memakai variabel yang sama untuk
    // SEMUA template. Memasukkannya ke `variabelWajib` tiap template akan
    // mengulang daftar yang sama 8 kali.
    'judul', 'judul_email', 'tahun',
    // Blok HTML opsional — diisi templates.mjs saat kondisinya terpenuhi
    'blok_sisa_hari', 'blok_verifikasi', 'blok_lokasi',
    // Kalimat sapaan lengkap ("Halo Nama," / "Halo,")
    'sapaan',
    // Nilai yang selalu dikirim templates.mjs
    'ip', 'tanggal', 'status',
  ]);

  const takTerdaftar = dipakai.filter((v) => !terdaftar.has(v));
  if (takTerdaftar.length) {
    console.error(`  ⚠️  ${nama}: variabel tidak terdaftar: ${takTerdaftar.join(', ')}`);
  }

  hasil[nama] = { subjek: def.subjek, html, teks, variabel: def.variabelWajib };

  const kb = Math.round(html.length / 1024);
  console.log(`  ✅ ${nama.padEnd(22)} ${String(kb).padStart(4)} KB html · ${String(teks.length).padStart(4)} char teks`);
}

console.log('');

if (gagal > 0) {
  console.error(`  ❌ ${gagal} template gagal dikompilasi — berkas TIDAK ditulis.`);
  console.error('');
  process.exit(1);
}

// ── 5. Tulis hasil ────────────────────────────────────────────────────────────

mkdirSync(dirname(KELUARAN), { recursive: true });

const isiBerkas = `/**
 * HTML email hasil kompilasi MJML — JANGAN EDIT BERKAS INI.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BERKAS HASIL BUILD ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Isi berkas ini dihasilkan oleh:
 *
 *     node scripts/build-email.mjs
 *
 * dari sumber: email-src/templates.mjml.mjs
 *
 * Perubahan di sini akan HILANG saat build berikutnya. Edit sumbernya, lalu
 * jalankan build ulang.
 *
 * ── KENAPA HASILNYA DI-COMMIT ───────────────────────────────────────────────
 * Server email berjalan tanpa node_modules (lihat ExecStart di
 * portfolio-token.service). Dengan hasil kompilasi di-commit, deploy baru
 * langsung punya HTML tanpa perlu menjalankan build — dan server tetap tidak
 * butuh MJML saat berjalan.
 *
 * ── PLACEHOLDER {{...}} SENGAJA DIBIARKAN ───────────────────────────────────
 * Penggantian nilai terjadi saat email dikirim (src/email/variabel.mjs).
 * Satu template melayani semua penerima; mengganti di build berarti butuh
 * file terkompilasi per kombinasi nilai.
 *
 * Dibangun: ${new Date().toISOString()}
 */

export const HTML_EMAIL = ${JSON.stringify(hasil, null, 2)};
`;

writeFileSync(KELUARAN, isiBerkas, 'utf8');

const totalKb = Math.round(isiBerkas.length / 1024);
console.log(`  ✅ Ditulis: backend/src/email/html.mjs (${totalKb} KB, ${Object.keys(hasil).length} template)`);
console.log('');
console.log('  Langkah berikutnya:');
console.log('    node --test backend/test/          # pastikan tidak ada yang rusak');
console.log('    git add backend/src/email/html.mjs && git commit');
console.log('');
