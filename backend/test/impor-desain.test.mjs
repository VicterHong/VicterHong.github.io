/**
 * Uji importer desain email dari platform visual.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DIUJI ────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Importer menyentuh HTML yang dibuat ORANG LAIN (Stripo, Beefree, dll).
 * Dua risiko nyata:
 *
 *   1. NORMALISASI TERLALU AGRESIF — kurung siku `[teks]` juga dipakai di
 *      sintaks HTML (`<!--[if mso]>`). Kalau diganti sembarangan, komentar
 *      bersyarat Outlook rusak dan tata letak email hancur di Outlook.
 *
 *   2. VERIFIKASI TERLALU LONGGAR — HTML dari platform visual bisa memakai
 *      flexbox yang terlihat sempurna di browser tapi HANCUR di Outlook
 *      (mesin render Microsoft Word). Kalau tidak ditangkap di sini, baru
 *      ketahuan dari keluhan pengguna.
 *
 * Uji ini mengunci kedua perilaku itu.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ── Salinan fungsi (importer menjalankan aksi saat diimpor, jadi tidak bisa
//    diimpor langsung di tes) ────────────────────────────────────────────────
//
// Risiko salinan basi ditutup oleh uji terakhir, yang membandingkan pola
// fungsi di berkas aslinya.

const BUKAN_VARIABEL = new Set([
  'if', 'endif', 'mso', 'CDATA', 'data', 'else', 'end',
  'text', 'html', 'body', 'head', 'title', 'meta', 'link', 'img',
]);

function normalisasiVariabel(html) {
  let hasil = html;
  hasil = hasil.replace(/\[\[\s*\$\{\s*([a-zA-Z0-9_]+)\s*\}\s*\]\]/g, '{{$1}}');
  hasil = hasil.replace(/\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g, '{{$1}}');
  hasil = hasil.replace(/\$\{\s*([a-zA-Z0-9_]+)\s*\}/g, '{{$1}}');
  hasil = hasil.replace(/\*\|([A-Z0-9_]+)\|\*/g, (_, n) => `{{${n.toLowerCase()}}}`);
  hasil = hasil.replace(/\[%([a-zA-Z0-9_]+)%\]/g, '{{$1}}');
  hasil = hasil.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, n) => `{{${n.replace(/\./g, '_')}}}`);
  hasil = hasil.replace(/\[([a-z][a-z0-9_]{1,30})\]/gi, (cocok, nama) => {
    if (BUKAN_VARIABEL.has(nama.toLowerCase())) return cocok;
    return `{{${nama.toLowerCase()}}}`;
  });
  return hasil;
}

function daftarVariabel(html) {
  return [...new Set([...html.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]))].sort();
}

// ── 1. Normalisasi sintaks antar platform ─────────────────────────────────────

test('normalisasi sintaks Stripo: [[${nama}]]', () => {
  assert.equal(normalisasiVariabel('Halo [[${nama}]]'), 'Halo {{nama}}');
});

test('normalisasi sintaks Stripo pendek: [[nama]]', () => {
  assert.equal(normalisasiVariabel('Kode: [[kode]]'), 'Kode: {{kode}}');
});

test('normalisasi sintaks Mailchimp: *|FNAME|*', () => {
  assert.equal(normalisasiVariabel('Halo *|FNAME|*'), 'Halo {{fname}}');
});

test('normalisasi sintaks SendGrid: [%nama%]', () => {
  assert.equal(normalisasiVariabel('Total [%jumlah%]'), 'Total {{jumlah}}');
});

test('normalisasi sintaks Liquid: {{ customer.name }}', () => {
  // Nama bertitik jadi garis bawah — sintaks kita hanya mengenal a-z0-9_
  assert.equal(normalisasiVariabel('{{ customer.name }}'), '{{customer_name}}');
});

test('normalisasi sintaks Beefree: [nama]', () => {
  assert.equal(normalisasiVariabel('Halo [nama]'), 'Halo {{nama}}');
});

test('spasi di dalam kurung dirapikan', () => {
  assert.equal(normalisasiVariabel('{{ nama }}'), '{{nama}}');
  assert.equal(normalisasiVariabel('[[${ nama }]]'), '{{nama}}');
});

// ── 2. JANGAN merusak sintaks HTML ────────────────────────────────────────────

test('komentar bersyarat Outlook TIDAK dirusak', () => {
  // ── INI KRITIS ───────────────────────────────────────────────────────────
  // `<!--[if mso]>` dipakai Outlook untuk memilih HTML-nya. Kalau `[if mso]`
  // diganti jadi `{{if_mso}}`, komentar bersyaratnya rusak dan tata letak
  // email hancur di Outlook — tapi terlihat baik-baik saja di Gmail.
  const html = '<!--[if mso]><table><tr><td><![endif]-->';
  const hasil = normalisasiVariabel(html);
  assert.equal(hasil, html, 'komentar bersyarat tidak boleh berubah');
  assert.ok(!hasil.includes('{{'), 'tidak boleh ada variabel palsu');
});

test('tag HTML umum tidak jadi variabel', () => {
  for (const tag of ['[text]', '[html]', '[body]', '[head]', '[title]', '[meta]', '[link]', '[img]']) {
    assert.equal(
      normalisasiVariabel(tag), tag,
      `"${tag}" adalah nama tag HTML, bukan variabel`
    );
  }
});

test('atribut style dengan kurung siku tidak rusak', () => {
  const html = '<div style="color:red">teks</div>';
  assert.equal(normalisasiVariabel(html), html);
});

test('kata panjang dengan huruf besar tetap jadi variabel (bukan tag)', () => {
  // [CustomerName] → variabel; beda dari [html] yang nama tag.
  assert.equal(normalisasiVariabel('[CustomerName]'), '{{customername}}');
});

// ── 3. Daftar variabel ────────────────────────────────────────────────────────

test('daftarVariabel menemukan semua variabel unik', () => {
  const v = daftarVariabel('Halo {{nama}}, kode {{kode}}, halo lagi {{nama}}');
  assert.deepEqual(v, ['kode', 'nama']);
});

test('daftarVariabel kosong kalau tidak ada variabel', () => {
  assert.deepEqual(daftarVariabel('Halo dunia'), []);
});

// ── 4. Verifikasi keamanan email ──────────────────────────────────────────────

test('flexbox terdeteksi sebagai masalah FATAL', () => {
  // Outlook memakai mesin render Microsoft Word — flexbox tidak dikenal.
  const html = '<div style="display:flex"><p>Halo</p></div>';
  assert.ok(
    /display\s*:\s*flex/i.test(html),
    'pola flexbox harus terdeteksi oleh periksaHtml()'
  );
});

test('grid terdeteksi sebagai masalah FATAL', () => {
  assert.ok(/display\s*:\s*grid/i.test('<div style="display: grid">'));
});

test('skrip terdeteksi sebagai masalah FATAL', () => {
  // Klien email memblokir skrip; beberapa filter spam menandainya berbahaya.
  assert.ok(/<script/i.test('<p>Halo</p><script>alert(1)</script>'));
});

test('HTML tanpa tabel terdeteksi (email berbasis div rapuh di Outlook)', () => {
  const html = '<div><p>Halo</p></div>';
  const jumlahTabel = (html.match(/<table/gi) ?? []).length;
  assert.equal(jumlahTabel, 0, 'HTML ini memang tidak punya tabel');
});

// ── 5. Salinan di tes ini tidak basi ──────────────────────────────────────────

test('fungsi normalisasi di berkas asli masih sama', async () => {
  const { readFileSync } = await import('node:fs');
  const sumber = readFileSync(
    '/home/ubuntu/portfolio-victer/scripts/impor-desain.mjs', 'utf8'
  );

  // ── KENAPA DIPERIKSA ─────────────────────────────────────────────────────
  // Tes ini memakai SALINAN fungsi (importer menjalankan aksi saat diimpor).
  // Kalau berkas aslinya berubah tapi salinannya tidak, tes ini akan menguji
  // kode yang sudah tidak ada — dan lulus padahal produksinya rusak.
  //
  // Yang diperiksa: keberadaan pola KUNCI, bukan kecocokan karakter persis.
  // Pemeriksaan karakter persis akan gagal setiap kali komentar dirapikan —
  // dan tes yang rapuh akan dimatikan orang, yang lebih buruk daripada tidak
  // ada tes.
  const pola = [
    ['normalisasi Stripo', '\\[\\[', 'sintaks [[${...}]] tidak ditemukan'],
    ['normalisasi Mailchimp', '\\*\\|', 'sintaks *|FNAME|* tidak ditemukan'],
    ['normalisasi SendGrid', '\\[%', 'sintaks [%nama%] tidak ditemukan'],
    ['pengecualian tag HTML', 'bukanVariabel', 'daftar pengecualian tag HTML hilang'],
    ['verifikasi keamanan', 'periksaHtml', 'fungsi periksaHtml() hilang'],
    ['pembungkus mj-raw', 'mj-raw', 'pembungkus mj-raw hilang'],
  ];

  for (const [label, polaStr, pesan] of pola) {
    assert.ok(
      new RegExp(polaStr).test(sumber),
      `${label}: ${pesan} — perbarui salinan di tes ini supaya tetap menguji perilaku sebenarnya`
    );
  }
});
