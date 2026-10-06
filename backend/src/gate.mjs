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

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
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
 * Format: `nonce|exp` — dipisah '|' supaya tidak ambigu. Nonce base64url
 * tidak mengandung '|', dan waktu selalu angka.
 *
 * ── KENAPA NONCE, BUKAN IP (KEPUTUSAN YANG DIUBAH) ────────────────────────
 * Versi pertama mengikat clearance ke IP pengunjung. Niatnya: cookie yang
 * dicuri tidak berguna di mesin lain.
 *
 * TAPI ITU TIDAK BEKERJA di arsitektur ini, dan sudah dibuktikan tiga kali:
 *
 *   1. Worker baca `cf.clientIp`      → dapat IP Cloudflare
 *   2. Worker baca `CF-Connecting-IP` → dapat IP Cloudflare
 *   3. Pages Function teruskan        → masih IP Cloudflare
 *
 * Sebabnya: Cloudflare MENIMPA header IP di SETIAP hop fetch() antar domain.
 * Rantainya empat hop:
 *
 *   browser → pages.dev → workers.dev → tunnel → backend
 *
 * Terukur: backend selalu menerima `2a06:98c0:3600::103` (IP Cloudflare),
 * tidak peduli dari mana pengunjungnya. Dokumentasi Cloudflare pun
 * menyarankan Service Bindings untuk Worker-to-Worker, bukan fetch() global
 * — mengonfirmasi rantai ini memang tidak andal untuk data hop-pertama.
 *
 * ── APAKAH IP BINDING MENAMBAH KEAMANAN? TIDAK BANYAK ────────────────────
 * Untuk mencuri cookie ini, penyerang butuh:
 *   1. HttpOnly    → tidak bisa dibaca XSS
 *   2. Secure      → hanya lewat HTTPS
 *   3. SameSite    → tidak dikirim lintas situs
 *
 * Jadi pencurian hanya mungkin kalau penyerang sudah punya akses ke browser
 * korban — dan dalam kasus itu, penyerang biasanya berada di jaringan yang
 * SAMA (WiFi publik, malware di perangkat yang sama). IP binding tidak
 * menolong. Cloudflare sendiri TIDAK mengikat cf_clearance ke IP.
 *
 * ── YANG LEBIH PENTING: JANGAN RAPUH ─────────────────────────────────────
 * Kalau clearance bergantung pada IP yang harus bertahan empat hop, satu
 * perubahan perilaku Cloudflare = SEMUA pengunjung terkunci di layar
 * verifikasi. Itu risiko operasional nyata, ditukar dengan manfaat keamanan
 * yang tipis.
 *
 * Ditambah lagi: pengunjung yang berpindah WiFi → seluler akan diminta
 * verifikasi ulang. Di Indonesia itu kejadian sehari-hari.
 *
 * ── NONCE MEMBERI YANG SAMA TANPA KERAPUHAN ──────────────────────────────
 * Nonce acak 128-bit membuat setiap clearance UNIK — tidak ada dua
 * pengunjung dengan token sama, dan token tidak bisa ditebak. Yang membuat
 * token tidak bisa dipalsukan adalah HMAC (butuh SERVICE_SECRET), bukan
 * isi payload-nya.
 */
function payload(nonce, exp) {
  return `${nonce}|${exp}`;
}

/** Hitung signature HMAC untuk payload. */
function tandaTangan(isi) {
  return createHmac('sha256', config.secret).update(isi).digest('base64url');
}

/**
 * Buat clearance token baru.
 *
 * Tidak butuh IP — lihat catatan panjang di payload() tentang kenapa
 * IP binding dilepas.
 *
 * @param {number} [ttlSeconds] Masa berlaku; default 30 menit.
 * @returns {{token: string, expiresAt: number}}
 */
export function buatClearance(ttlSeconds = GATE_TTL_SECONDS) {
  const exp = Date.now() + ttlSeconds * 1000;
  // 16 byte = 128 bit keacakan. Cukup untuk membuat token tidak bisa ditebak,
  // dan base64url-nya tidak mengandung '|' sehingga format payload aman.
  const nonce = randomBytes(16).toString('base64url');
  const isi = payload(nonce, exp);
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
export function verifikasiClearance(token) {
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

  const exp = Number(isi.slice(pisahIsi + 1));

  if (!Number.isFinite(exp)) return { ok: false, alasan: 'payload_tidak_valid' };
  if (Date.now() > exp) return { ok: false, alasan: 'kedaluwarsa' };

  // Signature sudah sah dan belum kedaluwarsa → clearance berlaku.
  //
  // Tidak ada pemeriksaan IP di sini — lihat catatan panjang di payload().
  // Yang membuat token tidak bisa dipalsukan adalah HMAC, bukan pengikatan
  // ke mesin. Dan pengikatan itu tidak bisa diandalkan di rantai empat hop
  // Cloudflare (terbukti tiga kali gagal).
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
