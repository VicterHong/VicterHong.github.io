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

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const SUMBER_TETAP = [
  "'self'",
  'https://api.github.com',
  'https://challenges.cloudflare.com',
  'https://api.iconify.design',
];

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

/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
  Cross-Origin-Opener-Policy: same-origin
  X-DNS-Prefetch-Control: on
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com; font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com https://fonts.gstatic.com; img-src 'self' data: https:; connect-src ${connectSrc}; frame-src https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests

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
