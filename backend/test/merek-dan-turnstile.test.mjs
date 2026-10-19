/**
 * Tes: identitas merek & integrasi widget Turnstile.
 *
 * ── TIGA HAL YANG DIJAGA ────────────────────────────────────────────────────
 *   1. Email transaksional punya kepala bermerek (logo + wordmark + tagline)
 *      dan kaki yang lengkap (logo, navigasi, bantuan, copyright).
 *   2. Footer situs menampilkan identitas VIVASTIC, bukan hanya deskripsi.
 *   3. Widget Turnstile di halaman auth memakai tema gelap + bahasa Indonesia
 *      dan slot-nya punya bingkai yang menyatu dengan kartu.
 *
 * ── KENAPA DIPERIKSA DI SUMBER, BUKAN DI BROWSER ────────────────────────────
 * Email tidak bisa dibuka di browser sungguhan di CI (tidak ada klien email).
 * Footer dibangun JavaScript saat runtime, dan widget Turnstile butuh
 * Cloudflare. Yang bisa dijamin secara deterministik adalah: sumbernya
 * MENGANDUNG elemen yang dimaksud, dan tidak ada yang menghapusnya diam-diam
 * di kemudian hari.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baca = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const mjml = baca('../../email-src/templates.mjml.mjs');
const footerJs = baca('../../assets/js/footer.js');
const authJs = baca('../../assets/js/auth.js');
const authCss = baca('../../assets/css/auth.css');
const mainCss = baca('../../assets/css/main.css');
const pricingCss = baca('../../assets/css/pricing.css');

// ══ 1. EMAIL ═════════════════════════════════════════════════════════════════

test('kepala email: logo, wordmark, dan tagline', () => {
  assert.match(mjml, /vivastic-mark-72\.png/, 'logo PNG harus dirujuk (SVG diblokir Gmail/Outlook)');
  assert.match(mjml, /width="44"[^>]*height="44"/, 'logo kepala harus 44px');
  assert.match(mjml, /VIVASTIC/, 'wordmark harus ada');
  assert.match(mjml, /Automation &amp; self-hosted tools/, 'tagline harus ada');
});

test('kaki email: logo, navigasi, bantuan, dan copyright', () => {
  // Logo footer lebih kecil dari kepala — ia tanda tangan, bukan pembuka.
  assert.match(mjml, /width="28"[^>]*height="28"/, 'logo footer harus 28px');

  for (const tautan of ['/docs', '/privasi', '/keamanan']) {
    assert.ok(mjml.includes(tautan), `tautan footer ${tautan} harus ada`);
  }
  assert.match(mjml, /Butuh bantuan\?/, 'baris bantuan harus ada');
  assert.match(mjml, /Seluruh hak cipta dilindungi/, 'copyright lengkap harus ada');
  assert.match(mjml, /garisHalus/, 'garis pemisah footer harus ada');
});

test('email tidak menjanjikan alamat yang tidak menerima balasan', () => {
  // noreply@ tidak bisa dibalas. Footer tidak boleh menyuruh "balas email ini"
  // sambil menunjuk ke alamat yang tidak pernah dibaca.
  assert.doesNotMatch(mjml, /mailto:noreply@/i, 'jangan arahkan balasan ke noreply');
  assert.doesNotMatch(mjml, /Balas email ini/i, 'jangan janjikan balasan pada alamat noreply');
});

// ══ 2. FOOTER SITUS ══════════════════════════════════════════════════════════

test('footer situs menampilkan identitas merek', () => {
  assert.match(footerJs, /footer-merek/, 'blok merek harus dibuat');
  assert.match(footerJs, /footer-merek-mark/, 'pelat logo harus ada');
  assert.match(footerJs, /footer-merek-teks/, 'wordmark harus ada');
  // ── LOGO FOOTER = LOGO HEADER ────────────────────────────────────────────
  // Sebelumnya footer memakai SVG inline (chevron) sementara header memakai
  // brand-vics.png. Dua bentuk berbeda = dua logo dalam satu halaman.
  // Sekarang keduanya menunjuk berkas yang sama, jadi tidak mungkin menyimpang.
  assert.match(
    footerJs, /brand-vics\.png/,
    'logo footer harus memakai berkas yang sama dengan header (brand-vics.png) — '
    + 'SVG inline membuat bentuknya berbeda dari header',
  );
  assert.doesNotMatch(
    footerJs, /<svg[^>]*viewBox="0 0 128 128"/,
    'jangan kembali ke SVG inline — itu yang membuat logo footer beda dari header',
  );
});

test('footer: tautan merek menuju beranda dan punya label aksesibel', () => {
  assert.match(footerJs, /merek\.href = '\/home'/, 'merek harus menuju /home, bukan /');
  assert.match(footerJs, /aria-label/, 'tautan merek butuh aria-label');
});

test('CSS footer: wordmark memakai font yang sama dengan header', () => {
  const blok = mainCss.slice(
    mainCss.indexOf('.footer-merek-teks {'),
    mainCss.indexOf('.footer-deskripsi {'),
  );
  assert.match(
    blok, /Playfair Display/,
    'wordmark footer harus memakai serif Playfair seperti header — '
    + 'sans-serif tebal di footer vs serif di header membuat merek terlihat seperti dua perusahaan',
  );
});

// ══ 2b. SETIAP HALAMAN PUNYA IDENTITAS ═══════════════════════════════════════

test('setiap halaman publik & privat menampilkan logo VIVASTIC', () => {
  // Halaman yang dibuka pengguna langsung — termasuk yang privat dan halaman
  // error. Halaman tanpa identitas membuat pengguna ragu apakah ia berada di
  // situs yang benar, dan keraguan itu paling merugikan di halaman yang
  // menampilkan data pribadi atau pesan error.
  const halaman = [
    'home.html', 'pricing.html', 'docs.html', 'keamanan.html', 'klien.html',
    'pesanan.html', 'privasi.html', 'syarat.html', 'arsip.html', 'changelog.html',
    'sign-in.html', 'sign-up.html', 'lupa-sandi.html', 'reset-sandi.html', '404.html',
  ];

  const tanpaLogo = [];
  for (const nama of halaman) {
    const isi = baca(`../../${nama}`);
    const punyaLogo = /brand-mark|auth-nav-mark|klien-merek-mark|err-merek-mark|vivastic-mark/.test(isi);
    if (!punyaLogo) tanpaLogo.push(nama);
  }

  assert.deepEqual(tanpaLogo, [], `halaman tanpa logo: ${tanpaLogo.join(', ')}`);
});

test('logo di halaman privat & error memakai SVG inline, bukan gambar eksternal', () => {
  for (const [nama, kelas] of [['klien.html', 'klien-merek-mark'], ['404.html', 'err-merek-mark']]) {
    const isi = baca(`../../${nama}`);

    // Cari kemunculan class di MARKUP (class="..."), bukan di blok <style>.
    // Versi pertama tes ini memakai indexOf biasa dan menemukan aturan CSS
    // lebih dulu — lalu gagal padahal markup-nya benar.
    const pola = new RegExp(`class="${kelas}"[\\s\\S]{0,400}?<svg[^>]*viewBox="0 0 128 128"`);
    assert.match(isi, pola, `${nama}: ${kelas} harus berisi SVG inline`);
  }
});

// ══ 3. TURNSTILE ═════════════════════════════════════════════════════════════

test('widget Turnstile: tema gelap dan bahasa Indonesia', () => {
  const render = authJs.slice(authJs.indexOf('window.turnstile.render'));
  const blok = render.slice(0, render.indexOf('slot.classList.add'));

  assert.match(blok, /theme:\s*'dark'/, 'widget harus bertema gelap');
  assert.match(blok, /language:\s*'id'/, 'widget harus berbahasa Indonesia');
  assert.match(blok, /appearance:\s*'always'/, 'widget harus terlihat (bukan interaction-only)');
});

test('slot Turnstile punya bingkai yang menyatu dengan kartu', () => {
  const blok = authCss.slice(
    authCss.indexOf('.auth-turnstile.is-ada {'),
    authCss.indexOf('.auth-turnstile:not(.is-ada)'),
  );
  assert.match(blok, /border:\s*1px solid/, 'slot butuh garis rambut');
  assert.match(blok, /border-radius/, 'slot butuh radius seperti input');
  assert.match(blok, /color-scheme:\s*dark/, 'iframe perlu tahu konteksnya gelap');
  assert.match(blok, /iframe\s*\{[\s\S]*?width:\s*100%/, 'iframe harus mengisi slot');
});

test('slot Turnstile tidak menyisakan ruang saat widget tidak dirender', () => {
  const blok = authCss.slice(authCss.indexOf('.auth-turnstile:not(.is-ada)'));
  const akhir = blok.slice(0, blok.indexOf('}') + 1);
  assert.match(akhir, /min-height:\s*0/, 'slot kosong tidak boleh menyisakan 65px');
  assert.match(akhir, /border:\s*0/, 'bingkai harus hilang saat kosong');
});

// ══ 4. KESEHATAN BUILD ═══════════════════════════════════════════════════════

test('tidak ada sisa @keyframes yatim di CSS', () => {
  // Potongan `50% { ... }` tanpa pembuka membuat esbuild melaporkan
  // css-syntax-error pada SETIAP build — dan peringatan yang selalu muncul
  // membuat peringatan baru tidak terlihat.
  //
  // Deteksi: lacak kedalaman kurung. Blok persentase hanya sah kalau ia
  // berada di dalam blok `@keyframes` (kedalaman > 0 tepat setelah baris
  // pembuka @keyframes).
  for (const [nama, isi] of [['pricing.css', pricingCss], ['auth.css', authCss], ['main.css', mainCss]]) {
    const tanpaKomentar = isi.replace(/\/\*[\s\S]*?\*\//g, '');
    let kedalaman = 0;
    let kedalamanKeyframes = -1; // -1 = tidak sedang di dalam @keyframes

    for (const baris of tanpaKomentar.split('\n')) {
      const buka = (baris.match(/\{/g) || []).length;
      const tutup = (baris.match(/\}/g) || []).length;

      // Baris pembuka @keyframes: catat kedalaman SETELAH kurung dibuka.
      if (/@keyframes/.test(baris)) {
        kedalaman += buka - tutup;
        kedalamanKeyframes = kedalaman;
        continue;
      }

      const dalamKeyframes = kedalamanKeyframes >= 0 && kedalaman >= kedalamanKeyframes;

      if (/^\s*\d+%\s*[,{]/.test(baris) && !dalamKeyframes) {
        assert.fail(`${nama}: blok persentase di luar @keyframes → ${baris.trim()}`);
      }

      kedalaman += buka - tutup;

      // Blok @keyframes ditutup ketika kedalaman turun di bawah levelnya.
      if (kedalamanKeyframes >= 0 && kedalaman < kedalamanKeyframes) {
        kedalamanKeyframes = -1;
      }
    }
  }
});
