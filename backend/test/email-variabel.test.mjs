/**
 * Uji sistem variabel email — penggantian {{...}} + keamanan escape.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DIUJI TERPISAH ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Template email adalah bagian sistem yang TIDAK BISA dilihat setelah dikirim.
 * Kalau ada yang salah — placeholder tidak terisi, URL rusak karena escape,
 * nama pengguna merusak struktur HTML — kita baru tahu dari keluhan, dan saat
 * itu emailnya sudah tidak bisa ditarik kembali.
 *
 * Uji ini memeriksa tiga hal yang paling mudah salah:
 *
 *   1. PENGGANTIAN — semua kemunculan diganti, bukan hanya yang pertama
 *   2. ESCAPE      — karakter HTML di data pengguna tidak merusak struktur
 *   3. URL         — tautan TIDAK di-escape (kalau `&` jadi `&amp;`, tautan rusak)
 *
 * ── BUG NYATA YANG DICEGAH ──────────────────────────────────────────────────
 *
 * Versi awal memakai `String.replace('{{nama}}', nilai)` — yang hanya
 * mengganti kemunculan PERTAMA. Template reset sandi memakai {{tautan}} DUA
 * kali (tombol + kotak cadangan), sehingga tautan kedua tertinggal sebagai
 * "{{tautan}}" mentah di email pengguna.
 *
 * Escape berlebihan juga berbahaya: URL dengan query string mengandung `&`,
 * dan kalau di-escape jadi `&amp;`, tautannya menunjuk ke halaman yang salah.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Akar repo dihitung dari lokasi berkas ini ────────────────────────────
//
// ── KENAPA TIDAK PATH ABSOLUT ────────────────────────────────────────────
// Path seperti '/home/ubuntu/portfolio-victer/...' hanya benar di SATU
// mesin. Di GitHub Actions, checkout berada di
// /home/runner/work/<repo>/<repo>/ — dan semua tes yang memakai path
// absolut GAGAL di sana meski lulus di lokal.
//
// Menghitung dari lokasi berkas membuat tes bekerja di mana pun.
const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');


const V = await import(join(AKAR, 'backend', 'src', 'email', 'variabel.mjs'));

// ── 1. Penggantian: SEMUA kemunculan ──────────────────────────────────────────

test('mengganti SEMUA kemunculan placeholder, bukan hanya yang pertama', () => {
  // Ini bug nyata: `String.replace` dengan string pola hanya mengganti yang
  // pertama. Template yang memakai variabel sama dua kali akan menyisakan
  // placeholder mentah di email pengguna.
  const html = '<a href="{{tautan}}">Klik</a> atau salin: {{tautan}}';
  const hasil = V.isiVariabel(html, { tautan: 'https://x.id/r' });

  assert.ok(!hasil.includes('{{tautan}}'), 'tidak boleh ada placeholder tersisa');
  assert.equal(
    (hasil.match(/https:\/\/x\.id\/r/g) ?? []).length, 2,
    'kedua kemunculan harus diganti'
  );
});

test('placeholder yang tidak dikenal dibiarkan (tidak error)', () => {
  // Kalau template memakai variabel yang tidak dikirim, kita ingin tahu
  // lewat placeholderTersisa() — bukan lewat error yang menghentikan alur.
  const hasil = V.isiVariabel('Halo {{nama}}, kode {{kode}}', { nama: 'Victer' });
  assert.ok(hasil.includes('Victer'), 'nama harus terisi');
  assert.ok(hasil.includes('{{kode}}'), 'placeholder yang tidak dikirim dibiarkan');
});

test('nilai undefined/null tidak mengganti apa pun', () => {
  // undefined yang tersubstitusi akan menghasilkan "undefined" di email —
  // lebih baik placeholder-nya dibiarkan supaya placeholderTersisa() menangkapnya.
  const hasil = V.isiVariabel('Halo {{nama}}', { nama: undefined });
  assert.ok(hasil.includes('{{nama}}'), 'placeholder harus tetap ada');
  assert.ok(!hasil.includes('undefined'), 'tidak boleh jadi teks "undefined"');
});

// ── 2. Escape HTML ────────────────────────────────────────────────────────────

test('karakter HTML di nama pengguna tidak merusak struktur', () => {
  // Nama pengguna bisa berisi apa pun. Tanpa escape, tag di dalamnya bisa
  // merusak tata letak email — atau menyisipkan elemen yang tidak dimaksud.
  const nama = '<script>alert(1)</script>';
  const hasil = V.isiVariabel('<p>Halo {{nama}}</p>', { nama });

  assert.ok(!hasil.includes('<script>'), 'tag tidak boleh tersisip mentah');
  assert.ok(hasil.includes('&lt;script&gt;'), 'harus ter-escape');
});

test('escape menangani kelima karakter berbahaya', () => {
  assert.equal(V.escapeHtml('&'), '&amp;');
  assert.equal(V.escapeHtml('<'), '&lt;');
  assert.equal(V.escapeHtml('>'), '&gt;');
  assert.equal(V.escapeHtml('"'), '&quot;');
  assert.equal(V.escapeHtml("'"), '&#39;');
});

test('escape mengubah & TERLEBIH DAHULU (bukan dua kali)', () => {
  // Kalau `<` diganti lebih dulu lalu `&` diganti setelahnya, hasilnya
  // `&amp;lt;` — teksnya berubah dari yang dimaksud.
  assert.equal(V.escapeHtml('<'), '&lt;');
  assert.notEqual(V.escapeHtml('<'), '&amp;lt;', 'tidak boleh ter-escape dua kali');
});

// ── 3. URL TIDAK boleh di-escape ──────────────────────────────────────────────

test('URL di daftar "mentah" tidak di-escape (query string tetap utuh)', () => {
  // ── KENAPA INI KRITIS ────────────────────────────────────────────────────
  // URL dengan query string mengandung `&`. Kalau di-escape jadi `&amp;`,
  // tautannya menunjuk ke halaman yang SALAH — dan pengguna tidak bisa
  // mereset sandinya.
  const url = 'https://x.id/reset?token=abc&user=1';
  const hasil = V.isiVariabel('<a href="{{u}}">{{u}}</a>', { u: url }, { mentah: ['u'] });

  assert.ok(hasil.includes('token=abc&user=1'), 'query string harus utuh');
  assert.ok(!hasil.includes('&amp;'), 'tidak boleh ter-escape');
});

test('URL di teks BIASA tetap di-escape (untuk tampilan)', () => {
  // Kalau URL ditampilkan sebagai teks (kotak "salin tautan ini"), `&`
  // harus di-escape supaya HTML-nya valid.
  const url = 'https://x.id/reset?token=abc&user=1';
  const hasil = V.isiVariabel('<p>{{u}}</p>', { u: url });

  assert.ok(hasil.includes('&amp;'), 'teks biasa harus ter-escape');
});

// ── 4. Deteksi placeholder tersisa ────────────────────────────────────────────

test('placeholderTersisa menemukan semua placeholder yang belum diisi', () => {
  const sisa = V.placeholderTersisa('Halo {{nama}}, kode {{kode}} dan {{nama}} lagi');
  assert.deepEqual(sisa.sort(), ['kode', 'nama'], 'harus unik dan lengkap');
});

test('placeholderTersisa mengembalikan array kosong kalau semua terisi', () => {
  assert.deepEqual(V.placeholderTersisa('Halo Victer, kode 123456'), []);
});

// ── 5. Nilai standar ──────────────────────────────────────────────────────────

test('nilaiStandar mengisi judul, judul_email, dan tahun', () => {
  const n = V.nilaiStandar({ judul: 'Ganti sandi' });
  assert.equal(n.judul, 'Ganti sandi');
  assert.equal(n.judul_email, 'Ganti sandi', 'judul_email memakai judul kalau tidak diisi');
  assert.equal(n.tahun, new Date().getFullYear(), 'tahun harus tahun sekarang');
});

// ── 6. Integrasi: template nyata tidak menyisakan placeholder ─────────────────

test('SEMUA template nyata tidak menyisakan placeholder setelah diisi', async () => {
  const T = await import(join(AKAR, 'backend', 'src', 'email', 'templates.mjs'));

  const kasus = [
    ['reset sandi', T.templateResetSandi({ nama: 'Victer', tautan: 'https://x.id/r?t=1' })],
    ['kode hapus', T.templateKodeHapusAkun({ nama: 'Victer', kode: '123456' })],
    ['batal hapus', T.templateKodeBatalHapus({ nama: 'Victer', kode: '112233', sisaHari: 20 })],
    ['selamat datang', T.templateSelamatDatang({ nama: 'Victer', email: 'v@x.id', tautanVerifikasi: 'https://x.id/v' })],
    ['masuk baru', T.templateMasukPerangkatBaru({ nama: 'Victer', perangkat: 'Chrome', lokasi: 'Jakarta', ip: '1.2.3.4' })],
    ['struk', T.templateStrukPembayaran({ nama: 'Victer', email: 'v@x.id', nomorPesanan: 'V1', paket: 'Pro', periode: 'Bulanan', jumlah: 'Rp1' })],
    ['nonaktif', T.templateAkunDinonaktifkan({ nama: 'Victer', sisaHari: 30 })],
    ['kode masuk', T.templateKodeMasuk({ nama: 'Victer', kode: '998877', lokasi: 'Bandung', ip: '10.0.0.1' })],
  ];

  for (const [nama, hasil] of kasus) {
    for (const bagian of ['html', 'teks', 'subjek']) {
      const sisa = V.placeholderTersisa(hasil[bagian]);
      assert.equal(
        sisa.length, 0,
        `${nama}: ${bagian} masih punya placeholder kosong: ${sisa.join(', ')} — ` +
        `email akan sampai dengan teks "{{...}}" mentah`
      );
    }
  }
});

test('template tanpa nama tetap tidak menyisakan spasi menggantung', async () => {
  const T = await import(join(AKAR, 'backend', 'src', 'email', 'templates.mjs'));
  const hasil = T.templateResetSandi({ tautan: 'https://x.id/r' });

  assert.ok(!hasil.html.includes('Halo ,'), 'tidak boleh "Halo ," (spasi menggantung)');
  assert.ok(hasil.html.includes('Halo,'), 'harus "Halo," tanpa spasi');
});

// ── 7. Meta color-scheme (khusus MJML) ────────────────────────────────────────

test('semua template memuat meta color-scheme', async () => {
  const T = await import(join(AKAR, 'backend', 'src', 'email', 'templates.mjs'));

  // ── KENAPA META INI PENTING ──────────────────────────────────────────────
  // MJML TIDAK menghasilkan <meta name="color-scheme"> sendiri. Ia disisipkan
  // lewat <mj-raw> di <mj-head>. Tanpa meta ini, klien email tertentu
  // (Outlook mobile, Gmail Android) membalik warna email secara otomatis —
  // hasilnya teks gelap di latar gelap dan isinya tidak terbaca.
  const hasil = T.templateResetSandi({ tautan: 'https://x.id/r' });
  assert.ok(
    hasil.html.includes('color-scheme'),
    'meta color-scheme hilang — periksa blok <mj-raw> di email-src/templates.mjml.mjs'
  );
});
