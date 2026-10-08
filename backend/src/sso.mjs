/**
 * OIDC generik untuk SSO perusahaan.
 *
 * ── KENAPA GENERIK, BUKAN KHUSUS SATU VENDOR ────────────────────────────────
 * Klien korporat memakai IdP yang berbeda-beda: Okta, Azure AD (Entra),
 * Google Workspace, Keycloak, Auth0, OneLogin, JumpCloud, dan Cloudflare
 * Access. Menulis kode khusus per vendor berarti setiap klien baru butuh
 * perubahan kode dan deploy.
 *
 * OIDC sudah menstandarkan cara menemukan endpoint: setiap IdP yang patuh
 * menyediakan dokumen discovery di `/.well-known/openid-configuration`.
 * Dengan membaca dokumen itu, SATU implementasi bekerja untuk semuanya.
 *
 * ── YANG DIAMBIL DARI DISCOVERY, BUKAN DITULIS DI KODE ──────────────────────
 *   authorization_endpoint  — ke mana pengguna dialihkan
 *   token_endpoint          — tempat menukar code
 *   jwks_uri                — kunci publik untuk verifikasi tanda tangan
 *   issuer                  — pengenal IdP, diverifikasi di id_token
 *
 * Menuliskan URL ini di kode berarti kode kita basi setiap kali IdP pindah
 * endpoint. Membacanya dari discovery berarti selalu benar.
 *
 * ── KEAMANAN YANG WAJIB (sama seperti provider publik) ──────────────────────
 *   1. `state` — mencegah CSRF, sekali pakai
 *   2. PKCE    — kalau IdP mendukung (discovery menyebutkan metodenya)
 *   3. Verifikasi tanda tangan id_token terhadap JWKS IdP
 *   4. Verifikasi issuer + audience + exp
 *   5. `nonce` — mengikat id_token ke permintaan otorisasi ini
 *
 * Nomor 5 khusus penting di sini: SSO korporat sering memakai `code` yang
 * dikirim ulang lewat jaringan internal perusahaan. Tanpa nonce, id_token
 * lama bisa diputar ulang.
 */

import { createHash } from 'node:crypto';
import { acak, pkceChallenge } from './oauth.mjs';

// ── Cache discovery ───────────────────────────────────────────────────────────
//
// Dokumen discovery jarang berubah tapi sering diminta (setiap login).
// Cache 1 jam: cukup lama untuk menghilangkan permintaan berulang, cukup
// pendek untuk menangkap perubahan endpoint dalam waktu wajar.

const cacheDiscovery = new Map(); // issuerUrl → { dok, diambil }
const TTL_DISCOVERY = 3_600_000;

/**
 * Ambil dokumen discovery OIDC.
 *
 * `issuerUrl` adalah URL dasar IdP, mis. https://vivastic.okta.com
 * atau https://vivastic.cloudflareaccess.com
 *
 * Melempar dengan pesan yang bisa ditindaklanjuti kalau gagal — pesan itu
 * muncul di log server, dan admin perlu tahu IdP mana yang bermasalah.
 */
export async function ambilDiscovery(issuerUrl) {
  const dasar = String(issuerUrl).replace(/\/$/, '');
  if (!dasar) throw new Error('issuer SSO kosong');

  // ── Tolak URL yang tidak HTTPS ─────────────────────────────────────────────
  // OIDC di atas HTTP berarti id_token dan code bisa disadap di jaringan.
  // Pengecualian: localhost untuk pengembangan.
  const u = new URL(dasar);
  const lokal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !lokal) {
    throw new Error(`issuer SSO harus HTTPS (dapat: ${u.protocol})`);
  }

  const entry = cacheDiscovery.get(dasar);
  if (entry && Date.now() - entry.diambil < TTL_DISCOVERY) return entry.dok;

  // Dua bentuk path yang dipakai IdP di lapangan:
  //   https://idp.example.com/.well-known/openid-configuration
  //   https://idp.example.com/tenant/.well-known/openid-configuration
  // Keduanya ditangani dengan menempelkan path standar ke URL dasar.
  const urlDiscovery = `${dasar}/.well-known/openid-configuration`;

  let res;
  try {
    res = await fetch(urlDiscovery, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(`tidak bisa menghubungi IdP (${urlDiscovery}): ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`discovery IdP gagal: HTTP ${res.status} (${urlDiscovery})`);
  }

  let dok;
  try {
    dok = await res.json();
  } catch {
    throw new Error(`discovery IdP bukan JSON (${urlDiscovery})`);
  }

  // ── Periksa field wajib ────────────────────────────────────────────────────
  // Kalau IdP tidak memberi ini, alur tidak bisa jalan — lebih baik gagal
  // sekarang dengan pesan jelas daripada gagal di tengah login pengguna.
  const wajib = ['authorization_endpoint', 'token_endpoint', 'issuer'];
  const kurang = wajib.filter((k) => !dok[k]);
  if (kurang.length > 0) {
    throw new Error(`discovery IdP tidak lengkap — kurang: ${kurang.join(', ')}`);
  }

  // ── Issuer di discovery HARUS cocok dengan URL yang kita minta ─────────────
  // Kalau tidak cocok, ada yang salah: mungkin salah URL, mungkin ada proxy
  // yang mengubah respons. Melanjutkan berarti memverifikasi id_token
  // terhadap issuer yang berbeda dari yang kita kira.
  if (dok.issuer.replace(/\/$/, '') !== dasar) {
    throw new Error(`issuer discovery tidak cocok: minta ${dasar}, dapat ${dok.issuer}`);
  }

  cacheDiscovery.set(dasar, { dok, diambil: Date.now() });
  return dok;
}

/** Bersihkan cache — dipakai pengujian. */
export function bersihkanCacheDiscovery() {
  cacheDiscovery.clear();
}

// ── URL otorisasi ─────────────────────────────────────────────────────────────

/**
 * Susun URL otorisasi SSO.
 *
 * Mengembalikan { url, state, codeVerifier, nonce }.
 * Pemanggil WAJIB menyimpan state + codeVerifier + nonce SEBELUM mengalihkan
 * pengguna — tanpa itu callback tidak bisa memverifikasi apa pun.
 *
 * ── PKCE: DIPAKAI KALAU IDP MENDUKUNG ───────────────────────────────────────
 * Tidak semua IdP korporat mendukung PKCE (terutama yang lama). Discovery
 * menyebutkan dukungannya di `code_challenge_methods_supported`. Kalau
 * didukung, kita pakai S256. Kalau tidak, kita lewati — dengan catatan
 * bahwa `state` + `nonce` masih melindungi.
 *
 * Memaksa PKCE ke IdP yang tidak mendukung = login gagal dengan pesan
 * yang membingungkan.
 */
export async function urlOtorisasiSso({
  issuerUrl, clientId, redirectUri, state = acak(32), nonce = acak(32),
  loginHint = '',
}) {
  const dok = await ambilDiscovery(issuerUrl);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Scope OIDC standar. `openid` WAJIB — tanpa itu tidak ada id_token.
    scope: 'openid email profile',
    state,
    nonce,
  });

  // PKCE hanya kalau didukung.
  let codeVerifier = '';
  const metode = Array.isArray(dok.code_challenge_methods_supported)
    ? dok.code_challenge_methods_supported
    : [];

  if (metode.includes('S256')) {
    codeVerifier = acak(32);
    params.set('code_challenge', pkceChallenge(codeVerifier));
    params.set('code_challenge_method', 'S256');
  }

  // login_hint membantu IdP memilih akun yang benar kalau pengguna sudah
  // punya beberapa. Ini hanya petunjuk, bukan otorisasi.
  if (loginHint) params.set('login_hint', String(loginHint).slice(0, 200));

  return {
    url: `${dok.authorization_endpoint}?${params.toString()}`,
    state,
    codeVerifier,
    nonce,
  };
}

// ── Tukar code → token ────────────────────────────────────────────────────────

/**
 * Tukar authorization code menjadi token (back channel).
 *
 * `clientSecret` boleh kosong untuk klien publik — beberapa IdP korporat
 * memakai PKCE saja tanpa secret. Kalau kosong DAN PKCE tidak dipakai,
 * permintaan akan ditolak IdP (dan itu memang benar: tidak ada bukti apa pun).
 */
export async function tukarCodeSso({
  issuerUrl, clientId, clientSecret, code, codeVerifier, redirectUri,
}) {
  const dok = await ambilDiscovery(issuerUrl);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });

  if (clientSecret) body.set('client_secret', clientSecret);
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const res = await fetch(dok.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  const teks = await res.text();
  let data;
  try {
    data = JSON.parse(teks);
  } catch {
    // Beberapa IdP membalas form-encoded meski Accept: application/json.
    data = Object.fromEntries(new URLSearchParams(teks));
  }

  if (!res.ok || data.error) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`token SSO: ${detail}`);
  }

  return data;
}

// ── Verifikasi id_token ───────────────────────────────────────────────────────

/**
 * Verifikasi id_token dari IdP.
 *
 * Sama seperti provider publik, TAPI ada satu perbedaan penting:
 * `jwks_uri` diambil dari discovery, bukan ditulis di kode.
 *
 * `verifikasiIdToken` dari oauth.mjs dipakai ulang — verifikasi JWT tidak
 * berbeda antar IdP. Yang berbeda hanya dari mana kuncinya diambil.
 */
export async function verifikasiIdTokenSso({ idToken, issuerUrl, clientId, nonceDiharapkan = '' }) {
  const dok = await ambilDiscovery(issuerUrl);

  // Impor dinamis untuk menghindari siklus modul: oauth.mjs tidak mengimpor
  // modul ini, jadi impor statis sebenarnya aman — tapi verifikasiIdToken
  // adalah fungsi besar dengan cache sendiri, dan impor dinamis membuat
  // ketergantungan ini eksplisit.
  const { verifikasiIdToken } = await import('./oauth.mjs');

  const klaim = await verifikasiIdToken({
    idToken,
    jwksUrl: dok.jwks_uri || '',
    issuer: dok.issuer,
    audience: clientId,
    nonceDiharapkan,
  });

  return klaim;
}

// ── Identitas dari klaim ──────────────────────────────────────────────────────

/**
 * Ubah klaim OIDC menjadi identitas seragam.
 *
 * ── KENAPA TIDAK MEMAKAI emailDariKlaim() DARI oauth.mjs ────────────────────
 * Fungsi itu khusus provider publik (menangani preferred_username Microsoft).
 * IdP korporat punya variasi sendiri:
 *
 *   Okta       → email ada, sub = user id
 *   Azure AD   → email bisa tidak ada, upn/preferred_username berisi UPN
 *   Keycloak   → email ada, preferred_username = username
 *   Google WS  → email ada
 *   Cloudflare → email ada
 *
 * Jadi di sini: email dulu, lalu upn, lalu preferred_username — dengan
 * pemeriksaan bentuk yang sama (harus terlihat seperti email).
 */
export function identitasDariKlaimSso(klaim) {
  const sub = String(klaim?.sub || '');
  if (!sub) throw new Error('id_token SSO tidak memuat sub');

  const kandidat = [
    klaim?.email,
    klaim?.upn,
    klaim?.preferred_username,
  ];

  let email = '';
  for (const k of kandidat) {
    const s = String(k || '').trim();
    if (!s) continue;
    const posisiAt = s.indexOf('@');
    // Bentuk email: ada '@', ada '.' setelah '@', tidak ada spasi.
    if (posisiAt > 0 && s.indexOf('.', posisiAt) > posisiAt + 1 && !s.includes(' ')) {
      email = s;
      break;
    }
  }

  // Nama: coba beberapa klaim standar, urut dari yang paling spesifik.
  const nama = String(
    klaim?.name || klaim?.given_name || klaim?.preferred_username || '',
  ).trim();

  return {
    providerUserId: sub,
    email,
    // ── KENAPA email_verified DIPERLAKUKAN KHUSUS DI SSO ────────────────────
    // Di SSO korporat, email berasal dari direktori organisasi yang
    // dikelola admin — bukan diketik sendiri oleh pengguna seperti di
    // provider publik. Jadi tingkat kepercayaannya berbeda.
    //
    // TAPI kita tetap tidak menganggapnya otomatis terverifikasi kalau
    // IdP secara eksplisit bilang belum. Kalau klaim tidak ada sama sekali,
    // kita percayai — karena sumbernya direktori organisasi.
    emailTerverifikasi: klaim?.email_verified === false ? false : Boolean(email),
    nama,
    avatar: String(klaim?.picture || ''),
  };
}

// ── Bantuan untuk pengujian ───────────────────────────────────────────────────

/**
 * Hash dari nilai apa pun — dipakai pengujian untuk membandingkan tanpa
 * mencetak rahasia ke layar.
 */
export function hashPendek(nilai) {
  return createHash('sha256').update(String(nilai)).digest('hex').slice(0, 16);
}
