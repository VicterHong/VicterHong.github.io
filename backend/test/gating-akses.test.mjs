/**
 * Tes: gating akses di halaman depan.
 *
 * ── YANG DIUJI ──────────────────────────────────────────────────────────────
 * Aturan yang diminta pemilik produk:
 *   • pengunjung anonim TIDAK melihat angka metrik, demo, atau highlight
 *   • "Detail teknis" mengarah ke sign-in, bukan ke halaman terkunci
 *   • angka & demo hanya untuk yang sudah masuk
 *
 * Semua diperiksa pada SUMBER (app.js, home.html) karena tes ini tidak
 * men-spawn browser. Yang bisa diperiksa dengan cara itu tetap kuat: apakah
 * kode MEMANG memeriksa status akses sebelum mencetak angka.
 *
 * ── KENAPA TIDAK MEMERIKSA HASIL RENDER ────────────────────────────────────
 * Render butuh DOM + jaringan. Itu tugas uji Playwright (dijalankan terpisah
 * saat deploy). Yang dijaga di sini adalah INVARIAN di kode: kalau seseorang
 * menghapus pemeriksaan `bolehLihatAngka`, tes ini gagal sebelum sampai ke
 * produksi.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const appJs = () => readFileSync(resolve(ROOT, 'assets/js/app.js'), 'utf8');
const homeHtml = () => readFileSync(resolve(ROOT, 'home.html'), 'utf8');
const aksesJs = () => readFileSync(resolve(ROOT, 'assets/js/akses.js'), 'utf8');

// ── 1. Modul akses ada dan gagal-tertutup ───────────────────────────────────
test('akses.js: kegagalan fetch menghasilkan status TERKUNCI', () => {
  const src = aksesJs();
  assert.match(src, /function statusTerkunci/, 'harus ada status default terkunci');
  // Dua jalur gagal: response tidak ok, dan exception jaringan.
  assert.match(src, /if \(!res\.ok\) return statusTerkunci/, 'HTTP gagal → terkunci');
  assert.match(src, /catch \{\s*return statusTerkunci/, 'exception → terkunci');
});

test('akses.js: status terkunci tidak membawa data proyek', () => {
  const src = aksesJs();
  const blok = src.slice(src.indexOf('function statusTerkunci'), src.indexOf('let _cache'));
  assert.match(blok, /masuk:\s*false/, 'harus masuk:false');
  assert.match(blok, /proyekTerbuka:\s*\[\]/, 'daftar proyek harus kosong');
  assert.equal(/metrik|angka|nilai/i.test(blok), false, 'tidak boleh membawa data metrik');
});

// ── 2. Angka hero bergantung pada status login ──────────────────────────────
test('renderStats menerima status akses dan menyamarkan angka untuk anonim', () => {
  const src = appJs();
  assert.match(src, /function renderStats\(akses\)/, 'harus menerima parameter akses');
  assert.match(src, /stat-tersamar/, 'harus memakai penanda angka tersamar');
  // Nilai sebenarnya hanya dicetak di jalur "sudah masuk".
  assert.match(src, /if \(!boleh\) \{[\s\S]{0,600}return;/, 'anonim harus berhenti sebelum mencetak angka');
});

// ── 3. Kartu proyek: highlight & metrik dijaga ──────────────────────────────
test('highlight proyek hanya dirender untuk yang sudah masuk', () => {
  const src = appJs();
  assert.match(src, /if \(sudahMasuk\) \{[\s\S]{0,400}project-highlights/, 'highlight di balik sudahMasuk');
  assert.match(src, /project-highlights-terkunci/, 'anonim melihat penanda terkunci');
});

test('metrik proyek memakai bolehLihatAngka, bukan sekadar login', () => {
  const src = appJs();
  assert.match(src, /if \(lihatAngka && p\.metrics\.length\)/, 'metrik butuh lihatAngka');
  assert.match(src, /const lihatAngka = bolehLihatAngka\(akses, p\.slug\)/, 'dihitung per slug');
});

// ── 4. Detail teknis mengarah ke sign-in untuk anonim ───────────────────────
test('anonim diarahkan ke sign-in, bukan langsung ke /s/', () => {
  const src = appJs();
  assert.match(src, /\/sign-in\?lanjut=\$\{balik\}/, 'harus menyertakan tujuan kembali');
  assert.match(src, /Masuk untuk detail teknis/, 'teks tombol harus menjelaskan');
  // Pastikan URL /s/ TIDAK dirender untuk anonim: harus di dalam cabang sudahMasuk.
  const i = src.indexOf('if (p.gated && p.access_codes?.length)');
  const blok = src.slice(i, i + 900);
  assert.match(blok, /if \(sudahMasuk\) \{/, 'cabang sudahMasuk harus ada');
});

// ── 5. Metrik/diagram/sandbox tidak dimuat untuk anonim ─────────────────────
test('home.html hanya memuat modul metrik setelah akses.masuk', () => {
  const html = homeHtml();
  assert.match(html, /import \{ ambilAkses \} from '\/assets\/js\/akses\.js'/, 'harus membaca status akses');
  assert.match(html, /if \(akses\?\.masuk\) \{[\s\S]{0,500}pasangMetrik/, 'pasangMetrik di dalam gerbang');
  assert.match(html, /if \(akses\?\.masuk\) \{[\s\S]{0,500}pasangDiagram/, 'pasangDiagram di dalam gerbang');
  assert.match(html, /if \(akses\?\.masuk\) \{[\s\S]{0,500}pasangSandbox/, 'pasangSandbox di dalam gerbang');
});

// ── 6. Panel ajakan terpasang ───────────────────────────────────────────────
test('pasangGerbangAkses menutup seksi & memasang panel ajakan', () => {
  const src = appJs();
  assert.match(src, /function pasangGerbangAkses\(akses\)/, 'fungsi harus ada');
  assert.match(src, /#metrikHost|#diagramHost|#sandboxHost/, 'ketiga host harus ditangani');
  assert.match(src, /gerbang-akses/, 'panel ajakan harus dipasang');
  assert.match(src, /elHost\.hidden = true/, 'isi harus disembunyikan untuk anonim');
});

// ── 7. app.js mengambil akses SEBELUM render ────────────────────────────────
test('akses diambil sebelum render, bukan sesudah', () => {
  const src = appJs();
  // Cari PEMANGGILAN, bukan definisi fungsi. `renderStats(akses)` juga muncul
  // di dalam deklarasi `function renderStats(akses)`, dan itu membuat tes
  // pertama gagal padahal urutannya benar. Yang diperiksa: bagian eksekusi,
  // setelah penanda "JALANKAN".
  const iJalan = src.indexOf('── JALANKAN');
  assert.ok(iJalan > 0, 'penanda bagian eksekusi harus ada');
  const eksekusi = src.slice(iJalan);

  const iAkses = eksekusi.indexOf('const akses = await ambilAkses()');
  const iStats = eksekusi.indexOf('renderStats(akses)');
  const iProjects = eksekusi.indexOf('renderProjects(akses)');

  assert.ok(iAkses > 0, 'ambilAkses harus dipanggil di bagian eksekusi');
  assert.ok(iStats > iAkses, 'akses harus diambil SEBELUM renderStats dipanggil');
  assert.ok(iProjects > iAkses, 'akses harus diambil SEBELUM renderProjects dipanggil');
});
