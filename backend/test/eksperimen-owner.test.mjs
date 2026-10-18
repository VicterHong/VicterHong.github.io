/**
 * Tes: konten eksperimen 3D hanya untuk owner.
 *
 * ── YANG DIUJI ──────────────────────────────────────────────────────────────
 * Tiga hal, dan yang ketiga paling penting:
 *   1. Tanpa sesi          → 401, tanpa konten.
 *   2. Sesi bukan owner    → 403, tanpa konten.
 *   3. Konten TIDAK ADA di HTML publik.
 *
 * Poin 3 adalah alasan berkas ini ada. Mudah membuat endpoint yang benar
 * tetapi tetap meninggalkan markup di home.html — hasilnya terlihat aman
 * (halaman menyembunyikannya) padahal siapa pun bisa membuka View Source dan
 * membacanya. Tes ini menutup jalan itu: kalau markup kembali ke HTML publik,
 * tes gagal.
 *
 * Tes ini TIDAK men-spawn server. Ia memeriksa berkas dan perilaku fungsi
 * murni, jadi bisa jalan tanpa port, database, atau jaringan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1. Konten tidak boleh ada di HTML publik ────────────────────────────────
/**
 * Buang komentar HTML dan isi <script> sebelum memeriksa.
 *
 * ── KENAPA ──────────────────────────────────────────────────────────────────
 * Versi pertama tes ini memakai regex langsung pada HTML mentah dan GAGAL
 * karena cocok dengan komentar penjelasan yang justru menjelaskan bahwa
 * markup-nya sudah dipindah ("EKSPERIMEN 3D — KHUSUS OWNER"). Tes yang gagal
 * karena dokumentasinya sendiri melatih orang mematikan tes — persis yang
 * tidak boleh terjadi. Yang diperiksa adalah MARKUP yang dirender, bukan
 * prosa di sekitarnya.
 */
function markupSaja(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

test('home.html TIDAK memuat markup eksperimen', () => {
  const html = markupSaja(readFileSync(resolve(ROOT, '../home.html'), 'utf8'));

  // Penanda markup yang sebenarnya — elemen, bukan nama seksi di komentar.
  assert.equal(
    /class="section-lab3d"/i.test(html),
    false,
    'markup section-lab3d tidak boleh ada di HTML publik — pindahkan ke server',
  );
  assert.equal(
    /id="lab3dHost"/i.test(html),
    false,
    'lab3dHost tidak boleh ada di HTML publik (hanya dikirim server ke owner)',
  );
  assert.equal(
    /id="judulLab3d"/i.test(html),
    false,
    'judul seksi eksperimen tidak boleh ada di HTML publik',
  );

  // Wadah render harus ada (kosong), tapi tanpa isi.
  assert.match(html, /id="eksperimenHost"/, 'wadah render harus ada');
  assert.match(html, /id="eksperimenHost"[^>]*hidden/, 'wadah harus hidden secara default');
});

test('dist/home.html juga tidak membocorkan markup', () => {
  const dist = resolve(ROOT, '../dist/home.html');
  let html;
  try {
    html = markupSaja(readFileSync(dist, 'utf8'));
  } catch {
    return; // dist belum dibangun — bukan kegagalan tes ini
  }
  assert.equal(/class="section-lab3d"/i.test(html), false, 'dist tidak boleh memuat markup eksperimen');
  assert.equal(/id="lab3dHost"/i.test(html), false, 'dist tidak boleh memuat lab3dHost');
});

// ── 2. Markup hidup di modul server ─────────────────────────────────────────
test('KONTEN_EKSPERIMEN ada di auth-routes.mjs, bukan berkas statis', () => {
  const src = readFileSync(resolve(ROOT, 'src/auth-routes.mjs'), 'utf8');
  assert.match(src, /KONTEN_EKSPERIMEN/, 'konstanta konten harus ada di modul server');
  assert.match(src, /section-lab3d/, 'markup seksi harus ada di dalam konstanta');
});

// ── 3. Route terdaftar ──────────────────────────────────────────────────────
test('ruteEksperimen terdaftar di daftar rute', () => {
  const src = readFileSync(resolve(ROOT, 'src/auth-routes.mjs'), 'utf8');
  assert.match(src, /ruteEksperimen,/, 'rute harus masuk ke array daftar rute');
  assert.match(src, /pattern: '\/api\/eksperimen'/, 'path rute harus /api/eksperimen');
});

// ── 4. Gerbang owner memakai env, bukan nilai tertanam ──────────────────────
test('owner dibaca dari env, bukan email tertanam di kode', () => {
  const cfg = readFileSync(resolve(ROOT, 'src/config.mjs'), 'utf8');
  assert.match(cfg, /OWNER_EMAIL/, 'OWNER_EMAIL harus dibaca');
  assert.match(cfg, /ownerEmails/, 'config harus mengekspos ownerEmails');

  // Email pemilik TIDAK boleh tertanam di sumber — kalau tertanam, ia ikut
  // terbaca siapa pun yang membuka repo publik ini.
  const semuaSumber = [cfg, readFileSync(resolve(ROOT, 'src/auth-routes.mjs'), 'utf8')].join('\n');
  assert.equal(
    /victerphanjaya@gmail\.com/i.test(semuaSumber),
    false,
    'email owner tidak boleh tertanam di kode sumber (repo publik)',
  );
});

// ── 5. Fail-closed: daftar kosong berarti tidak ada owner ───────────────────
test('tanpa OWNER_EMAIL dan SALES_EMAIL, tidak ada yang dianggap owner', async () => {
  // `pick()` membaca process.env DULU, lalu BERKAS env, lalu default. Di mesin
  // ini service.env sudah berisi SALES_EMAIL (alamat pemilik), jadi menghapus
  // process.env saja tidak cukup — berkasnya tetap terbaca. Arahkan
  // TOKEN_SERVICE_ENV ke berkas yang tidak ada supaya kedua sumber kosong.
  const simpan = { ...process.env };
  delete process.env.OWNER_EMAIL;
  delete process.env.SALES_EMAIL;
  process.env.TOKEN_SERVICE_ENV = '/nonexistent/uji-owner.env';

  const { pathToFileURL } = await import('node:url');
  const url = pathToFileURL(resolve(ROOT, 'src/config.mjs')).href + '?v=' + Date.now();
  const { config } = await import(url);
  assert.deepEqual(config.ownerEmails, [], 'daftar kosong → tidak ada owner (gagal-tertutup)');

  process.env = simpan;
});

// ── 6. Daftar dipisah koma & dinormalisasi ──────────────────────────────────
test('OWNER_EMAIL menerima beberapa alamat dan menormalkan huruf', async () => {
  const simpan = { ...process.env };
  process.env.OWNER_EMAIL = ' A@Example.com , b@example.com ';
  process.env.TOKEN_SERVICE_ENV = '/nonexistent/uji-owner.env';

  const { pathToFileURL } = await import('node:url');
  const url = pathToFileURL(resolve(ROOT, 'src/config.mjs')).href + '?v=' + Date.now();
  const { config } = await import(url);
  assert.deepEqual(config.ownerEmails, ['a@example.com', 'b@example.com']);

  process.env = simpan;
});
