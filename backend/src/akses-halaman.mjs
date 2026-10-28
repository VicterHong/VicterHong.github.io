/**
 * Halaman /s/<kode>/ — gerbang masuk aplikasi React penuh.
 *
 * ── ALUR ─────────────────────────────────────────────────────────────────────
 * 1. Kode di URL diperiksa (hash → baris di access_keys)
 * 2. Kalau sah dan belum ada sesi: set cookie sesi, lalu tampilkan transisi
 * 3. Kalau sudah ada sesi: langsung tampilkan aplikasi
 * 4. Kalau tidak sah: 404 tanpa membocorkan apakah kodenya pernah ada
 *
 * ── KENAPA TRANSISI, BUKAN REDIRECT ──────────────────────────────────────────
 * Redirect ke URL lain akan meninggalkan kode asli di riwayat browser, dan
 * kode itu adalah kredensial. Dengan menyajikan halaman di URL yang sama,
 * tidak ada kode yang tertinggal di tempat lain. Transisinya juga memberi
 * waktu untuk memuat bundle tanpa layar kosong.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AKAR_ASET, HEADER_ASET, sajikanAset, sesiAset, buatCookieAkses, NAMA_COOKIE_AKSES } from './akses-aset.mjs';
import { cariKunci, masalahKunci, catatPemakaian, hashKode } from './akses-kunci.mjs';
import { setCookie } from './http-util.mjs';

/** Manifest build: nama berkas ber-hash. Dibaca ulang tiap permintaan supaya
 *  deploy baru langsung terpakai tanpa restart. */
function bacaManifest() {
  try {
    return JSON.parse(readFileSync(join(AKAR_ASET, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function kirimHtml(res, html, status = 200, nonce = '') {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // `Vary: Cookie` BUKAN batas otorisasi (OWASP) — otorisasi ada di kode,
    // bukan di cache key. Header ini hanya lapis tambahan supaya cache bersama
    // tidak pernah menyamakan dua pengguna berbeda.
    Vary: 'Cookie',
    'Cache-Control': 'no-store, private, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      // Nonce, bukan 'unsafe-inline': skrip transisi boleh jalan, skrip
      // sisipan pihak lain tidak. Nonce dibuat baru untuk setiap respons.
      nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  res.end(html);
}

/** Halaman 404 yang tidak membocorkan apa pun. */
function halamanTidakDitemukan() {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Tidak ditemukan</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100svh;display:grid;place-items:center;
    background:#07080a;color:#f4f2ec;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:32rem;padding:2rem;text-align:center}
  h1{font-size:1.125rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .5rem}
  p{margin:0;color:#8b8b86;font-size:.9375rem;line-height:1.6}
</style></head>
<body><main>
  <h1>Tautan tidak berlaku</h1>
  <p>Tautan ini tidak dikenali atau sudah tidak aktif. Kalau kamu merasa ini keliru,
     hubungi penjual dengan menyertakan kode pesananmu.</p>
</main></body></html>`;
}

/**
 * Halaman transisi. Sengaja tanpa JavaScript: yang dibutuhkan hanya CSS untuk
 * animasi, lalu <meta refresh> ke tahap berikutnya. Dengan begitu halaman ini
 * tetap bekerja walau CSP ketat atau JS gagal dimuat.
 */
function halamanTransisi({ kode, js, css, nonce }) {
  // URL aset memakai kode di path supaya setiap pembeli punya URL sendiri.
  const dasar = `/s/${kode}/aset/`;
  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07080a">
<title>Menyiapkan akses — VIVASTIC</title>
<link rel="preload" href="${dasar}${css}" as="style">
<link rel="stylesheet" href="${dasar}${css}">
<style>
  :root{color-scheme:dark;--emas:#c9a961;--krem:#f4f2ec;--redup:#8b8b86}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:#07080a;color:var(--krem);overflow:hidden;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    -webkit-font-smoothing:antialiased}
  .layar{position:fixed;inset:0;display:grid;place-items:center;padding:1.5rem}
  /* Cincin tipis yang berdenyut: penanda proses, bukan hiasan. */
  .cincin{width:52px;height:52px;border-radius:50%;
    border:1.5px solid rgba(244,242,236,.12);
    border-top-color:var(--emas);
    animation:putar 900ms linear infinite}
  @keyframes putar{to{transform:rotate(360deg)}}
  .isi{display:grid;gap:1.25rem;justify-items:center;text-align:center}
  .merek{font-size:.6875rem;letter-spacing:.22em;text-transform:uppercase;
    color:var(--redup)}
  .judul{font-size:1.0625rem;font-weight:600;letter-spacing:-.01em;margin:0}
  .ket{margin:0;font-size:.875rem;color:var(--redup);max-width:24rem;line-height:1.6}
  /* Bilah progres tipis: memberi tahu bahwa ada yang sedang berjalan. */
  .bilah{width:12rem;height:2px;background:rgba(244,242,236,.08);
    border-radius:999px;overflow:hidden}
  .bilah i{display:block;height:100%;width:40%;border-radius:999px;
    background:linear-gradient(90deg,transparent,var(--emas),transparent);
    animation:jalan 1.4s ease-in-out infinite}
  @keyframes jalan{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
  @media (prefers-reduced-motion:reduce){
    .cincin{animation:none;border-top-color:var(--emas);opacity:.8}
    .bilah i{animation:none;width:100%;opacity:.5}
  }
</style>
</head>
<body>
<div id="root"></div>

<!-- Overlay transisi. Menutupi aplikasi sampai ia benar-benar siap, jadi
     pengguna tidak melihat halaman kosong atau kedipan konten setengah jadi. -->
<div class="layar" id="transisi">
  <div class="isi">
    <div class="cincin" role="progressbar" aria-label="Menyiapkan akses"></div>
    <p class="merek">VIVASTIC</p>
    <h1 class="judul">Menyiapkan akses</h1>
    <p class="ket">Memuat aplikasi dan aset 3D. Jangan tutup halaman ini.</p>
    <div class="bilah"><i></i></div>
  </div>
</div>
<script type="module" nonce="${nonce}">
  // Muat bundle React. Bundle memasang dirinya ke #root saat diimpor, jadi
  // tidak ada fungsi ekspor yang perlu dipanggil.
  const dasar = ${JSON.stringify(dasar)};
  const layar = document.getElementById('transisi');

  // Kalau permintaan aset pertama ditolak karena cookie baru diterbitkan,
  // browser perlu satu putaran lagi. Muat ulang sekali — jangan berulang,
  // supaya tidak berputar tanpa henti kalau ada masalah lain.
  const kunciUlang = 'vx_akses_ulang_' + location.pathname;

  try {
    await import(dasar + ${JSON.stringify(js)});

    // Beri React satu bingkai untuk mengecat isinya, lalu buka overlay.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (layar) {
        layar.style.transition = 'opacity 420ms ease';
        layar.style.opacity = '0';
        setTimeout(() => layar.remove(), 460);
      }
      sessionStorage.removeItem(kunciUlang);
    }));
  } catch (err) {
    if (!sessionStorage.getItem(kunciUlang)) {
      sessionStorage.setItem(kunciUlang, '1');
      location.reload();
      throw err;
    }
    document.querySelector('.judul').textContent = 'Gagal memuat aplikasi';
    document.querySelector('.ket').textContent =
      'Koneksi terputus atau sesi berakhir. Muat ulang halaman untuk mencoba lagi.';
    document.querySelector('.cincin').style.animationPlayState = 'paused';
    document.querySelector('.bilah').style.display = 'none';
    console.error(err);
  }
</script>
</body></html>`;
}

/**
 * Tangani GET /s/<kode>/ dan asetnya.
 *
 * @returns {boolean} true kalau request sudah ditangani
 */
export function tanganiAksesAplikasi(req, res, pathname, { ip = '', userAgent = '' } = {}) {
  // Cocokkan /s/<64 hex>/ atau /s/<64 hex>/aset/<path>
  const m = pathname.match(/^\/s\/([a-f0-9]{64})(\/.*)?$/);
  if (!m) return false;

  const kode = m[1];
  const sisa = m[2] ?? '/';

  // ── ASET ───────────────────────────────────────────────────────────────────
  if (sisa.startsWith('/aset/')) {
    const rel = sisa.slice('/aset/'.length);

    // Otorisasi. Cookie harus sah DAN harus milik kunci yang disebut di URL.
    //
    // Mengapa diikat, bukan hanya "cookie sah": cookie di-set dengan Path=/
    // sehingga browser mengirimnya ke semua path. Tanpa pengikatan ini, satu
    // pembeli yang membagikan URL-nya sendiri bisa membuat orang lain memakai
    // URL itu dengan cookie miliknya — dan sebaliknya, cookie satu kunci
    // berlaku untuk semua URL kunci lain. Pengikatan membuat URL dan cookie
    // harus berasal dari kunci yang sama.
    const sesi = sesiAset(req);
    if (!sesi.ok) {
      const row = cariKunci(kode);
      if (!row || masalahKunci(row)) return tolakAset(res);
      // Kode sah tapi belum ada cookie: terbitkan, lalu lanjut. Cookie ikut
      // pada respons aset pertama supaya permintaan berikutnya membawanya.
      const hasil = terbitkanSesi(req, res, row, { ip, userAgent });
      if (!hasil) return tolakAset(res);
      // 401 pada permintaan pertama adalah perilaku yang benar: cookie baru
      // terbit di respons ini, jadi permintaan ini memang belum membawanya.
      // Browser akan mengulang otomatis untuk aset yang dimuat lewat <link>
      // dan <script> setelah cookie tersimpan.
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        ...HEADER_ASET,
        Vary: 'Cookie',
      });
      res.end(JSON.stringify({ ok: false, error: 'cookie_diterbitkan', ulangi: true }));
      return true;
    }

    // Cookie sah: pastikan kunci di URL adalah kunci yang sama.
    if (!kodeMilikKunci(kode, sesi.kunciRow)) {
      return tolakAset(res);
    }

    return sajikanAset(req, res, rel, { projectSlug: 'akses-3d' });
  }

  if (sisa !== '/' && sisa !== '') {
    // Path lain di bawah /s/<kode>/ tidak dilayani.
    return false;
  }

  // ── HALAMAN ────────────────────────────────────────────────────────────────
  const row = cariKunci(kode);
  if (!row || masalahKunci(row)) {
    kirimHtml(res, halamanTidakDitemukan(), 404);
    return true;
  }

  const manifest = bacaManifest();
  if (!manifest?.js || !manifest?.css) {
    kirimHtml(res, halamanTidakDitemukan(), 503);
    return true;
  }

  // Pastikan sesi ada sebelum halaman disajikan. Tanpa ini, permintaan aset
  // pertama akan men-set cookie di tengah jalan dan beberapa permintaan
  // paralel bisa saling mendahului.
  if (!sesiAset(req).ok) {
    terbitkanSesi(req, res, row, { ip, userAgent });
  }

  catatPemakaian(row, { ip });

  const nonce = randomBytes(18).toString('base64');
  kirimHtml(res, halamanTransisi({ kode, js: manifest.js, css: manifest.css, nonce }), 200, nonce);
  return true;
}

/** Apakah kode di URL memang milik kunci pada cookie ini? */
function kodeMilikKunci(kode, kunciRow) {
  if (!kunciRow) return false;
  return hashKode(kode) === kunciRow.code_hash;
}

/** Terbitkan cookie akses dari kunci yang sudah tervalidasi. */
function terbitkanSesi(req, res, row, { ip = '', userAgent = '' } = {}) {
  try {
    const { nilai, detik } = buatCookieAkses(row.id);
    setCookie(res, NAMA_COOKIE_AKSES, nilai, {
      maxAgeSeconds: detik,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
    return { id: row.id };
  } catch {
    return null;
  }
}

function tolakAset(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    ...HEADER_ASET,
  });
  res.end(JSON.stringify({ ok: false, error: 'sesi_diperlukan' }));
  return true;
}
