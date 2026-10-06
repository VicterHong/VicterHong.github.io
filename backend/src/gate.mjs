/**
 * Gate clearance — cookie HttpOnly bertanda tangan server.
 *
 * ── MASALAH YANG DIPECAHKAN ─────────────────────────────────────────────────
 * Sebelumnya clearance gate disimpan di sessionStorage sebagai timestamp:
 *
 *     cf_clearance_<host> = 1759761234567
 *
 * Nilai itu bisa dibaca DAN DITULIS JavaScript mana pun. Pengunjung cukup
 * membuka DevTools dan menulis:
 *
 *     sessionStorage.setItem('cf_clearance_...', Date.now())
 *
 * → gate lewat seketika, tanpa verifikasi Turnstile sama sekali.
 *
 * Jadi gate lama adalah lapisan UX, bukan batas keamanan. Itu tidak cukup
 * untuk standar korporat.
 *
 * ── CARA KERJA SEKARANG ─────────────────────────────────────────────────────
 * Setelah verifikasi Turnstile sukses, SERVER membuat clearance token:
 *
 *     payload   = { ip, exp }        ← IP + waktu kedaluwarsa
 *     signature = HMAC-SHA256(payload, SERVICE_SECRET)
 *     token     = base64(payload) + '.' + signature
 *
 * Token dikirim sebagai cookie HttpOnly + Secure + SameSite. JavaScript
 * TIDAK BISA membacanya, apalagi memalsukannya — tanpa SERVICE_SECRET,
 * signature tidak bisa dihitung.
 *
 * ── KENAPA IP IKUT DITANDATANGAN ────────────────────────────────────────────
 * Tanpa IP, cookie yang dicuri dari satu pengunjung bisa dipakai di mesin
 * lain. Dengan IP di dalam payload, cookie hanya berlaku dari alamat yang
 * sama — pencurian cookie jadi tidak berguna.
 *
 * Trade-off: pengunjung yang berpindah jaringan (WiFi → seluler) akan
 * diminta verifikasi ulang. Itu dapat diterima: verifikasi hanya butuh ~1
 * detik, dan keamanan yang lebih tinggi sepadan.
 *
 * ── KENAPA TIDAK SIMPAN DI DATABASE ────────────────────────────────────────
 * Clearance hanya berisi dua hal: siapa (IP) dan sampai kapan (exp). Tidak
 * ada yang perlu dicabut per-token, tidak ada yang perlu diquery.
 *
 * HMAC memberi sifat yang sama dengan penyimpanan di database — server bisa
 * memverifikasi tanpa menyimpan apa pun — TAPI tanpa satu baris pun di disk
 * dan tanpa query per permintaan. Untuk gate yang dibuka setiap kunjungan
 * halaman, itu perbedaan yang terasa.
 *
 * Sesi token akses (portfolio_session) TETAP di database karena ia perlu
 * bisa dicabut per-token. Clearance gate tidak.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';

/** Nama cookie clearance. Awalan `__Host-` adalah prefix keamanan browser. */
export const COOKIE_GATE = '__Host-portfolio_gate';

/**
 * Masa berlaku clearance (detik).
 *
 * 30 menit mengikuti pola Cloudflare. Cukup lama untuk menjelajah dengan
 * tenang, cukup pendek supaya verifikasi tetap berjalan berkala.
 */
export const GATE_TTL_SECONDS = 30 * 60;

/**
 * Bangun payload yang ditandatangani.
 *
 * Format dipisah '|' supaya tidak ambigu — IP tidak mungkin mengandung '|'
 * (IPv4 angka dan titik, IPv6 heksadesimal dan titik dua), dan waktu selalu
 * angka. Jadi tidak ada cara menyusun payload berbeda yang menghasilkan
 * string sama.
 */
function payload(ip, exp) {
  return `${ip}|${exp}`;
}

/** Hitung signature HMAC untuk payload. */
function tandaTangan(isi) {
  return createHmac('sha256', config.secret).update(isi).digest('base64url');
}

/**
 * Buat clearance token baru.
 *
 * @param {string} ip Alamat pengunjung (dari CF-Connecting-IP).
 * @param {number} [ttlSeconds] Masa berlaku; default 30 menit.
 * @returns {{token: string, expiresAt: number}}
 */
export function buatClearance(ip, ttlSeconds = GATE_TTL_SECONDS) {
  const exp = Date.now() + ttlSeconds * 1000;
  const isi = payload(ip, exp);
  const token = `${Buffer.from(isi, 'utf8').toString('base64url')}.${tandaTangan(isi)}`;
  return { token, expiresAt: exp };
}

/**
 * Verifikasi clearance token.
 *
 * Mengembalikan objek hasil dengan `ok: true/false` dan alasan kegagalan.
 * Sengaja TIDAK melempar — pemanggil memutuskan apa yang dilakukan saat
 * clearance tidak valid (biasanya: tampilkan gate).
 *
 * ── URUTAN PEMERIKSAAN PENTING ──────────────────────────────────────────────
 * Signature diperiksa SEBELUM membaca payload. Kalau urutannya terbalik,
 * penyerang bisa mengirim payload sembarang dan server akan memprosesnya
 * sebelum tahu bahwa signature-nya palsu.
 *
 * ── TIMING-SAFE COMPARISON ─────────────────────────────────────────────────
 * Perbandingan signature memakai timingSafeEqual, bukan `===`. Perbandingan
 * string biasa berhenti di karakter pertama yang berbeda — selisih waktu itu
 * bisa dipakai untuk menebak signature karakter demi karakter.
 */
export function verifikasiClearance(token, ip) {
  if (typeof token !== 'string' || !token) {
    return { ok: false, alasan: 'token_kosong' };
  }

  const pisah = token.indexOf('.');
  if (pisah < 1) return { ok: false, alasan: 'format_salah' };

  const bagianPayload = token.slice(0, pisah);
  const signature = token.slice(pisah + 1);

  // Signature diperiksa dulu — payload belum dipercaya sampai ini lolos.
  let isi;
  try {
    isi = Buffer.from(bagianPayload, 'base64url').toString('utf8');
  } catch {
    return { ok: false, alasan: 'payload_tidak_valid' };
  }

  const diharapkan = tandaTangan(isi);

  // Panjang harus sama sebelum timingSafeEqual — fungsi itu melempar kalau
  // panjang buffer berbeda, dan lemparan itu sendiri membocorkan informasi.
  const bufA = Buffer.from(signature, 'utf8');
  const bufB = Buffer.from(diharapkan, 'utf8');
  if (bufA.length !== bufB.length) return { ok: false, alasan: 'signature_salah' };
  if (!timingSafeEqual(bufA, bufB)) return { ok: false, alasan: 'signature_salah' };

  // Signature sah — payload baru boleh dibaca.
  const pisahIsi = isi.lastIndexOf('|');
  if (pisahIsi < 1) return { ok: false, alasan: 'payload_tidak_valid' };

  const ipDiToken = isi.slice(0, pisahIsi);
  const exp = Number(isi.slice(pisahIsi + 1));

  if (!Number.isFinite(exp)) return { ok: false, alasan: 'payload_tidak_valid' };
  if (Date.now() > exp) return { ok: false, alasan: 'kedaluwarsa' };

  // IP harus cocok. Ini yang membuat cookie curian tidak berguna di mesin lain.
  if (ipDiToken !== ip) return { ok: false, alasan: 'ip_berbeda' };

  return { ok: true, expiresAt: exp };
}

/**
 * Set cookie clearance pada respons.
 *
 * ── KENAPA SameSite='Lax', BUKAN 'None' ─────────────────────────────────────
 * `None` dibutuhkan kalau situs dan API berada di origin BERBEDA (perlu
 * cookie lintas situs). Tapi dengan Pages Function yang mem-proxy /api ke
 * Worker, semuanya SAMA ORIGIN dari sudut browser — jadi `Lax` cukup.
 *
 * `Lax` lebih aman: cookie tidak dikirim pada permintaan lintas situs, jadi
 * serangan CSRF tidak bisa memanfaatkannya.
 *
 * ── KENAPA TANPA Domain ─────────────────────────────────────────────────────
 * Cookie tanpa atribut `Domain` hanya berlaku untuk host yang menetapkannya
 * (host-only). Ini lebih ketat daripada `.pages.dev` yang akan berlaku untuk
 * SEMUA subdomain — termasuk subdomain milik orang lain.
 *
 * Awalan `__Host-` di nama cookie menegakkan aturan ini di level browser:
 * browser MENOLAK cookie `__Host-` yang punya atribut Domain, atau yang
 * tidak Secure, atau yang Path-nya bukan '/'.
 */
export function setCookieClearance(res, token, maxAgeSeconds = GATE_TTL_SECONDS) {
  const cookie = [
    `${COOKIE_GATE}=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');

  const existing = res.getHeader('set-cookie');
  if (Array.isArray(existing)) res.setHeader('set-cookie', [...existing, cookie]);
  else if (existing) res.setHeader('set-cookie', [existing, cookie]);
  else res.setHeader('set-cookie', cookie);
}

/** Hapus cookie clearance (set kedaluwarsa). */
export function hapusCookieClearance(res) {
  setCookieClearance(res, '', 0);
}

/**
 * Baca cookie clearance dari header permintaan.
 *
 * Parser sederhana tapi aman: nilai cookie bisa mengandung '=' (base64url
 * memakai '-' dan '_', tapi padding '=' mungkin ada), jadi pemisahan
 * dilakukan pada '=' PERTAMA saja.
 */
export function bacaCookieClearance(req) {
  const raw = req.headers.cookie ?? '';
  if (!raw) return '';

  for (const bagian of raw.split(';')) {
    const bersih = bagian.trim();
    const eq = bersih.indexOf('=');
    if (eq < 1) continue;
    if (bersih.slice(0, eq) === COOKIE_GATE) {
      return bersih.slice(eq + 1);
    }
  }
  return '';
}
