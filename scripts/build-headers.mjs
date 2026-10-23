/**
 * Bangun `_headers` dengan CSP yang mengikuti `backend-url.json`.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * `connect-src` di `_headers` memuat daftar tujuan yang ditulis tangan:
 * `api.github.com`, `challenges.cloudflare.com`, `api.iconify.design`, dan
 * `portfolio-victer.victerphanjaya.workers.dev`.
 *
 * Backend token TIDAK berjalan di `workers.dev` — ia berjalan di alamat tunnel
 * yang ditulis ke `backend-url.json` dan diperbarui otomatis setiap kali URL
 * tunnel berubah. Karena alamat itu tidak ada di `connect-src`, browser
 * MEMBLOKIR setiap panggilan API sebelum request keluar:
 *
 *     Refused to connect because it violates the document's Content Security Policy.
 *
 * Akibatnya `GET /api/config` gagal → `turnstile.enabled` dianggap `false` →
 * widget Turnstile TIDAK PERNAH dirender di halaman proyek, dan konten terkunci
 * tidak pernah bisa dibuka. Tidak ada error yang terlihat pengguna; widgetnya
 * hanya tidak muncul.
 *
 * ── KENAPA DI-GENERATE, BUKAN DITULIS TANGAN ────────────────────────────────
 * Alamat tunnel berubah. Daftar yang ditulis tangan akan basi lagi, dan
 * gejalanya sama-sama senyap. Dengan membaca `backend-url.json` saat build,
 * `connect-src` selalu memuat alamat yang benar-benar dipakai halaman.
 *
 * Origin diambil dari `api_base` (skema + host), bukan URL lengkap — CSP
 * mencocokkan origin, bukan path.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');

const SUMBER_TETAP = [
  "'self'",
  'https://api.github.com',
  'https://challenges.cloudflare.com',
  'https://api.iconify.design',
  // Tunnel quick Cloudflare berputar (URL baru tiap restart). Origin aktif
  // ditambahkan di bawah dari backend-url.json, tapi wildcard ini mencegah
  // API mati total saat tunnel berganti sebelum build berikutnya.
  'https://*.trycloudflare.com',
];

/**
 * Hash SHA-256 semua <script> inline di dist/, untuk CSP tanpa 'unsafe-inline'.
 *
 * ── KENAPA HASH, BUKAN 'unsafe-inline' ──────────────────────────────────────
 * 'unsafe-inline' mematikan proteksi XSS terpenting di CSP: skrip apa pun yang
 * berhasil disuntikkan ke HTML ikut dieksekusi. Hash membuat browser hanya
 * menjalankan blok yang isinya persis sama dengan saat build.
 *
 * ── KENAPA DIHITUNG DARI dist/, BUKAN DARI SUMBER ───────────────────────────
 * Minifier mengubah isi blok (spasi, tanda kutip). Hash dari sumber akan
 * selalu salah. Yang di-hash harus byte yang benar-benar dikirim ke browser.
 *
 * ── KENAPA SETELAH MINIFIKASI ───────────────────────────────────────────────
 * build-headers.mjs dipanggil di AKHIR build-css.mjs, setelah dist/ final.
 * Kalau dipanggil lebih awal, hash-nya basi dan SEMUA skrip inline diblokir —
 * halaman akan tampak rusak total tanpa error yang jelas.
 */
function hashSkripInline() {
  const hash = new Set();
  const berkas = [];
  const pola = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;

  const walk = (dir) => {
    for (const nama of readdirSync(dir)) {
      const jalur = join(dir, nama);
      if (statSync(jalur).isDirectory()) walk(jalur);
      else if (nama.endsWith('.html')) berkas.push(jalur);
    }
  };
  walk(DIST);

  for (const jalur of berkas) {
    const isi = readFileSync(jalur, 'utf8');
    for (const m of isi.matchAll(pola)) {
      const attrs = m[1] || '';
      // Blok data (JSON-LD, importmap) tidak dieksekusi; CSP tidak menjaganya.
      if (/type\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(attrs)) continue;
      const badan = m[2];
      if (!badan.trim()) continue;
      const digest = createHash('sha256').update(badan, 'utf8').digest('base64');
      hash.add(`'sha256-${digest}'`);
    }
  }
  return [...hash].sort();
}

const hashInline = hashSkripInline();
if (hashInline.length === 0) {
  console.error('✖ Tidak ada skrip inline ditemukan di dist/ — build belum jalan?');
  process.exit(1);
}


/** Origin dari backend-url.json, atau null kalau berkas tidak ada/rusak. */
function originBackend() {
  try {
    const data = JSON.parse(readFileSync(`${ROOT}backend-url.json`, 'utf8'));
    const base = typeof data?.api_base === 'string' ? data.api_base.trim() : '';
    if (!base) return null;
    return new URL(base).origin;
  } catch {
    return null;
  }
}

const origin = originBackend();
if (!origin) {
  console.error('✖ backend-url.json tidak ada atau api_base kosong — CSP tidak bisa dibangun.');
  process.exit(1);
}

const connectSrc = [...SUMBER_TETAP, origin].join(' ');

const headers = `# ── Header keamanan & cache — DIHASILKAN OTOMATIS ───────────────────────────
#
# JANGAN sunting berkas ini langsung. Sumbernya:
#   scripts/build-headers.mjs
# Dijalankan oleh scripts/build-css.mjs setiap build.
#
# ── KENAPA connect-src MEMUAT ALAMAT TUNNEL ─────────────────────────────────
# Backend token berjalan di alamat tunnel yang ditulis ke backend-url.json dan
# berubah setiap kali tunnel di-restart. Kalau alamat itu tidak ada di
# connect-src, browser memblokir SEMUA panggilan API sebelum request keluar:
#
#     Refused to connect because it violates the document's Content Security Policy.
#
# Gejalanya senyap: /api/config gagal → Turnstile dianggap nonaktif → widget
# verifikasi tidak pernah dirender, dan konten terkunci tidak bisa dibuka.
# Karena itu daftar ini dibangun dari backend-url.json saat build, bukan
# ditulis tangan.
#
# Origin aktif saat build ini: ${origin}

# ── CATATAN: CLOUDFLARE MENYUNTIK SKRIP DI HOST PROXIED ─────────────────────
# victer.is-a.dev adalah CNAME proxied di zona is-a.dev. Zona itu menyuntikkan
# <script> inline (beacon Web Analytics + challenge-platform) SETELAH HTML
# meninggalkan Pages, jadi hash-nya tidak bisa dihitung saat build dan skrip
# itu diblokir oleh CSP di bawah.
#
# Itu disengaja: 'unsafe-inline' TIDAK ditambahkan. Di CSP3, 'unsafe-inline'
# diabaikan selama ada hash — jadi menambahkannya tidak akan menolong, hanya
# melemahkan halaman lain. Yang diblokir hanya milik Cloudflare, bukan skrip
# situs; halaman tetap berjalan (diuji: CF_GATE_CONFIG terdefinisi).
#
# Kalau nanti beacon Cloudflare ingin dihidupkan: lepas proxy (proxied:false)
# atau minta maintainer is-a.dev mematikan Web Analytics zona.

/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
  Cross-Origin-Opener-Policy: same-origin
  X-DNS-Prefetch-Control: on
  Content-Security-Policy: default-src 'self'; script-src 'self' ${hashInline.join(' ')} https://challenges.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com; font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com https://fonts.gstatic.com; img-src 'self' data: https:; connect-src ${connectSrc}; frame-src https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests

# ── Aset statis: selalu divalidasi ulang, JANGAN di-cache lama ───────────────
# Nama berkas TIDAK berisi hash isi (app.min.js, main.min.css) — nama yang sama
# dipakai ulang setiap deploy. Kalau di-cache setahun, pengunjung akan memakai
# JS/CSS lama sampai setahun sementara HTML-nya sudah baru: halaman rusak
# dengan cara yang sangat sulit didiagnosis.
#
# max-age=0 + must-revalidate berarti browser selalu bertanya "masih sama?".
# Dengan ETag, jawabannya sering "ya, pakai yang kamu punya" — hanya beberapa
# ratus byte per berkas, bukan unduhan ulang.
/assets/*
  Cache-Control: public, max-age=0, must-revalidate
`;

writeFileSync(`${ROOT}_headers`, headers);
console.log(`  CSP connect-src → ${origin}`);
