/**
 * Alur OAuth 2.0 / OpenID Connect — Google, Microsoft, Apple, GitHub, SSO.
 *
 * ── ALUR YANG DIPAKAI: AUTHORIZATION CODE + PKCE ─────────────────────────────
 * RFC 9700 (OAuth 2.0 Security Best Current Practice, Januari 2025) menetapkan
 * dua hal yang membentuk modul ini:
 *
 *   1. Implicit flow DILARANG. Token tidak boleh pernah muncul di URL —
 *      URL tersimpan di riwayat browser, header Referer, dan log server.
 *      Yang boleh lewat front channel hanya `code`: sekali pakai, berumur
 *      pendek, dan tidak berguna tanpa `code_verifier` yang tidak pernah
 *      meninggalkan server.
 *
 *   2. `state` WAJIB. Tanpa itu, penyerang bisa menyodorkan code miliknya
 *      ke callback kita (CSRF) dan membuat korban masuk ke akun penyerang.
 *
 * PKCE (RFC 7636) ditambahkan untuk semua provider, termasuk yang punya
 * client_secret. Alasannya: kalau `code` bocor (log, Referer, ekstensi
 * browser), code itu tetap tidak bisa ditukar tanpa verifier.
 *
 * ── YANG TIDAK DILAKUKAN MODUL INI ───────────────────────────────────────────
 * Modul ini tidak menyimpan sesi dan tidak menyentuh database. Ia hanya
 * berbicara dengan provider dan mengembalikan identitas yang sudah
 * diverifikasi. Penyimpanan ada di auth-identities.mjs — pemisahan ini
 * membuat alur OAuth bisa diuji tanpa database.
 */

import { createHash, randomBytes, createSign } from 'node:crypto';

// ── Helper dasar ──────────────────────────────────────────────────────────────

/** base64url tanpa padding — format yang dipakai PKCE dan JWT. */
export function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Random string aman untuk state / code_verifier. */
export function acak(bytes = 32) {
  return b64url(randomBytes(bytes));
}

/**
 * PKCE: challenge = BASE64URL(SHA256(verifier)).
 *
 * `code_challenge_method` SELALU 'S256'. Metode 'plain' sengaja tidak
 * didukung: penyerang yang bisa mengubah permintaan front channel bisa
 * menurunkan S256 menjadi plain dan mematikan seluruh perlindungan PKCE.
 */
export function pkceChallenge(verifier) {
  return b64url(createHash('sha256').update(verifier).digest());
}

/** Bandingkan dua string dengan waktu konstan (anti timing attack). */
export function samaAman(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  let beda = 0;
  for (let i = 0; i < A.length; i += 1) beda |= A[i] ^ B[i];
  return beda === 0;
}

// ── Definisi provider ─────────────────────────────────────────────────────────
//
// Setiap provider punya bentuk yang sedikit berbeda. Perbedaan itu dinyatakan
// di sini sebagai data, bukan sebagai cabang if di tengah alur — supaya alur
// utamanya tetap satu dan mudah dibaca.

const PROVIDER = {
  google: {
    nama: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    // Google butuh ini supaya refresh token diberikan. Kita tidak memakai
    // refresh token (sesi kita sendiri yang panjang), tapi tanpa ini Google
    // hanya memberi access_token berumur 1 jam — cukup untuk ambil profil.
    extraAuth: { access_type: 'online', prompt: 'select_account' },
    ambilEmailDariIdToken: false,
  },

  microsoft: {
    nama: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    // Issuer Microsoft memuat {tenantid} — verifikasi issuer dilakukan
    // dengan pencocokan pola, lihat verifikasiIdToken().
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    scope: 'openid email profile',
    extraAuth: {},
    ambilEmailDariIdToken: false,
  },

  apple: (() => {
    // ── OVERRIDE PENGUJIAN ─────────────────────────────────────────────────
    //
    // Apple TIDAK punya sandbox atau mode testing. Satu-satunya cara menguji
    // alur Sign in with Apple tanpa membayar $99 adalah mengarahkan endpoint
    // ke IdP tiruan.
    //
    // AKTIF HANYA KALAU APPLE_TEST_ENDPOINTS DIISI. Di produksi variabel itu
    // tidak ada, jadi endpoint tetap appleid.apple.com.
    //
    // Cara pakai:
    //   APPLE_TEST_ENDPOINTS=http://127.0.0.1:9912
    //
    // Lihat idp-apple-tiruan.mjs untuk IdP tiruannya.
    const dasarUji = process.env.APPLE_TEST_ENDPOINTS || '';

    if (dasarUji) {
      const dasar = dasarUji.replace(/\/$/, '');
      return {
        nama: 'Apple (TIRUAN — pengujian)',
        authorizeUrl: `${dasar}/auth/authorize`,
        tokenUrl: `${dasar}/auth/token`,
        userinfoUrl: '',
        jwksUrl: `${dasar}/auth/keys`,
        issuer: dasar,
        scope: 'name email',
        extraAuth: { response_mode: 'form_post' },
        formPost: true,
        ambilEmailDariIdToken: true,
        // Penanda supaya log jelas ini bukan Apple sungguhan.
        tiruan: true,
      };
    }

    return {
      nama: 'Apple',
      authorizeUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      // Apple TIDAK punya userinfo endpoint. Email dan nama hanya ada di
      // id_token — dan nama HANYA pada otorisasi pertama (scope 'name').
      userinfoUrl: '',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
      scope: 'name email',
      extraAuth: { response_mode: 'form_post' },
      // Apple mewajibkan response_mode=form_post: hasilnya POST ke callback,
      // bukan query string. Callback harus menangani kedua bentuk.
      formPost: true,
      ambilEmailDariIdToken: true,
    };
  })(),

  github: {
    nama: 'GitHub',
    // GitHub BUKAN OpenID Connect — tidak ada id_token, tidak ada JWKS.
    // Identitas diambil dengan memanggil API-nya memakai access_token.
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails',
    jwksUrl: '',
    issuer: '',
    scope: 'read:user user:email',
    extraAuth: {},
    bukanOidc: true,
    ambilEmailDariIdToken: false,
  },
};

export function providerDikenal(nama) {
  return Object.hasOwn(PROVIDER, nama);
}

export function daftarProvider() {
  return Object.keys(PROVIDER);
}

/**
 * Apakah provider ini punya kredensial lengkap di config?
 *
 * Dipakai /api/config untuk menyalakan tombol. Tombol yang mengarah ke
 * endpoint yang belum siap = 404 = pengguna mengira situsnya rusak.
 */
export function providerSiap(nama, config) {
  switch (nama) {
    case 'google':
      return Boolean(config.googleClientId && config.googleClientSecret);
    case 'microsoft':
      return Boolean(config.microsoftClientId && config.microsoftClientSecret);
    case 'apple':
      return Boolean(
        config.appleClientId && config.appleTeamId &&
        config.appleKeyId && config.applePrivateKey,
      );
    case 'github':
      return Boolean(config.githubClientId && config.githubClientSecret);
    default:
      return false;
  }
}

// ── Langkah 1: menyusun URL otorisasi ─────────────────────────────────────────

/**
 * Susun URL otorisasi + nilai yang harus disimpan server.
 *
 * Mengembalikan { url, state, codeVerifier }.
 * Pemanggil WAJIB menyimpan state + codeVerifier SEBELUM mengalihkan
 * pengguna. Kalau tidak, callback tidak bisa memverifikasi apa pun.
 */
export function urlOtorisasi({
  provider, config, redirectUri, state = acak(32),
}) {
  const p = PROVIDER[provider];
  if (!p) throw new Error(`provider tidak dikenal: ${provider}`);

  const codeVerifier = acak(32); // 43 karakter — sesuai minimum RFC 7636
  const codeChallenge = pkceChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: clientIdUntuk(provider, config),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...p.extraAuth,
  });

  return {
    url: `${p.authorizeUrl}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

/** Client ID per provider — Apple memakai Services ID, bukan App ID. */
function clientIdUntuk(provider, config) {
  switch (provider) {
    case 'google': return config.googleClientId;
    case 'microsoft': return config.microsoftClientId;
    case 'apple': return config.appleClientId;
    case 'github': return config.githubClientId;
    default: throw new Error(`client id tidak dikenal: ${provider}`);
  }
}

// ── Langkah 2: menukar code menjadi token ─────────────────────────────────────

/**
 * Tukar authorization code menjadi token (back channel, server ke server).
 *
 * Melempar Error dengan pesan yang aman ditampilkan kalau gagal. Pesan dari
 * provider diteruskan apa adanya karena berguna untuk diagnosis (misalnya
 * 'redirect_uri_mismatch') — tapi tidak pernah berisi token.
 */
export async function tukarCode({
  provider, config, code, codeVerifier, redirectUri,
}) {
  const p = PROVIDER[provider];
  if (!p) throw new Error(`provider tidak dikenal: ${provider}`);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientIdUntuk(provider, config),
    code_verifier: codeVerifier,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (provider === 'apple') {
    // Apple memakai client_secret berupa JWT yang ditandatangani dengan
    // private key — bukan string statis. Lihat rahasiaApple().
    body.set('client_secret', rahasiaApple(config));
  } else if (provider === 'github') {
    // GitHub tidak menerima client_secret di body untuk semua endpoint;
    // ia memakai Basic auth. Keduanya didukung, tapi Basic lebih eksplisit.
    headers.Authorization = 'Basic ' + Buffer
      .from(`${config.githubClientId}:${config.githubClientSecret}`)
      .toString('base64');
    body.set('client_secret', config.githubClientSecret);
  } else {
    body.set('client_secret', clientSecretUntuk(provider, config));
  }

  const res = await fetch(p.tokenUrl, { method: 'POST', headers, body });
  const teks = await res.text();

  let data;
  try {
    data = JSON.parse(teks);
  } catch {
    // GitHub mengembalikan form-encoded kalau Accept tidak dihormati.
    data = Object.fromEntries(new URLSearchParams(teks));
  }

  if (!res.ok || data.error) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`token ${provider}: ${detail}`);
  }

  return data; // { access_token, id_token?, token_type, ... }
}

function clientSecretUntuk(provider, config) {
  switch (provider) {
    case 'google': return config.googleClientSecret;
    case 'microsoft': return config.microsoftClientSecret;
    case 'github': return config.githubClientSecret;
    default: throw new Error(`client secret tidak dikenal: ${provider}`);
  }
}

/**
 * client_secret Apple: JWT ES256 yang berlaku maksimum 6 bulan.
 *
 * Apple tidak memberi secret statis. Yang dipakai adalah JWT dengan klaim
 * iss (Team ID), sub (Services ID), aud (appleid.apple.com), ditandatangani
 * private key .p8 milik developer. Umur 5 menit cukup — token ini hanya
 * dipakai sekali saat menukar code, dan umur pendek membatasi kerugian
 * kalau bocor.
 */
function rahasiaApple(config) {
  const sekarang = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: config.appleKeyId, typ: 'JWT' };
  const payload = {
    iss: config.appleTeamId,
    iat: sekarang,
    exp: sekarang + 300, // 5 menit
    aud: 'https://appleid.apple.com',
    sub: config.appleClientId,
  };

  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const inti = `${enc(header)}.${enc(payload)}`;

  // ES256 menandatangani, bukan mengenkripsi. Node butuh kunci dalam bentuk
  // objek — private key .p8 dari Apple berformat PKCS#8 PEM.
  const signer = createSign('SHA256');
  signer.update(inti);
  signer.end();
  const sig = signer.sign({
    key: config.applePrivateKey.replace(/\\n/g, '\n'),
    dsaEncoding: 'ieee-p1363', // JWT memakai r||s, bukan DER
  });

  return `${inti}.${b64url(sig)}`;
}

// ── Langkah 3: mengambil identitas ────────────────────────────────────────────

/**
 * Tentukan email pengguna dari klaim provider.
 *
 * ── KENAPA FUNGSI TERPISAH ──
 * Ini fungsi MURNI: masukannya klaim, keluarannya email. Tidak ada jaringan,
 * tidak ada database. Karena itu bisa diuji langsung — dan uji pertama
 * menemukan dua kasus yang tidak teruji waktu logikanya masih terkubur di
 * dalam ambilIdentitas() yang memanggil fetch.
 *
 * ── URUTAN PRIORITAS (penting, diuji) ──
 *   1. klaim.email          — akun pribadi Microsoft, Google, Apple
 *   2. info.email           — dari endpoint userinfo
 *   3. preferred_username   — KHUSUS Microsoft, hanya kalau bentuknya email
 *
 * ── KENAPA preferred_username PERLU DIPERIKSA BENTUKNYA ──
 * Dokumen Microsoft: klaim ini "could be an email address, phone number, or
 * a generic username without a specified format". Kalau isinya nomor telepon
 * lalu kita pakai sebagai email, akunnya jadi aneh dan tidak bisa dipakai
 * masuk lewat provider lain dengan email yang sama.
 *
 * Jadi dipakai hanya kalau: ada '@', ada '.' SETELAH '@', dan tidak ada spasi.
 *
 * ── KENAPA KHUSUS MICROSOFT ──
 * Provider lain tidak memakai klaim ini. Google dan Apple selalu mengirim
 * `email` langsung. Membacanya untuk semua provider berarti menerima nilai
 * yang tidak dimaksudkan sebagai email.
 */
export function emailDariKlaim({ provider, klaim = {}, info = {} }) {
  const langsung = klaim?.email || info.email;
  if (langsung) return String(langsung);

  if (provider !== 'microsoft') return '';

  const kandidat = String(klaim?.preferred_username || info.preferred_username || '');
  const posisiAt = kandidat.indexOf('@');
  if (posisiAt <= 0) return '';
  if (kandidat.indexOf('.', posisiAt) <= posisiAt + 1) return '';
  if (kandidat.includes(' ')) return '';

  return kandidat;
}

/**
 * Ambil identitas pengguna dari provider.
 *
 * Mengembalikan bentuk SERAGAM untuk semua provider:
 *   { providerUserId, email, emailTerverifikasi, nama, avatar }
 *
 * Perbedaan antar provider diserap di sini. Pemanggil tidak perlu tahu
 * bahwa GitHub tidak punya id_token, atau bahwa Apple mengirim email di
 * dalam id_token dan bukan di endpoint terpisah.
 */
export async function ambilIdentitas({
  provider, config, token, nonceDiharapkan = '', idTokenDariForm = '',
}) {
  const p = PROVIDER[provider];
  if (!p) throw new Error(`provider tidak dikenal: ${provider}`);

  // ── Apple: email HANYA ada di id_token ────────────────────────────────────
  if (p.ambilEmailDariIdToken) {
    const idToken = token.id_token || idTokenDariForm;
    if (!idToken) throw new Error('apple: id_token tidak ada');

    const klaim = await verifikasiIdToken({
      idToken, jwksUrl: p.jwksUrl, issuer: p.issuer,
      audience: config.appleClientId, nonceDiharapkan,
    });

    return {
      providerUserId: klaim.sub,
      email: klaim.email || '',
      // Apple: email hanya dikirim sekali, saat otorisasi pertama. Kalau
      // kosong, pemanggil harus menangani (akun sudah ada, tidak ada
      // perubahan). Nilai 'email_verified' Apple berupa string 'true'.
      emailTerverifikasi: klaim.email_verified === true || klaim.email_verified === 'true',
      nama: '',
      avatar: '',
    };
  }

  // ── GitHub: bukan OIDC — pakai API dengan access_token ────────────────────
  if (p.bukanOidc) {
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'portfolio-victer',
    };

    const res = await fetch(p.userinfoUrl, { headers });
    if (!res.ok) throw new Error(`github user: HTTP ${res.status}`);
    const profil = await res.json();

    // Email bisa disembunyikan pengguna. Kalau kosong, minta daftar email
    // dan pilih yang primary + verified. Ini satu-satunya sumber tepercaya:
    // email publik di profil bisa diubah siapa saja.
    let email = profil.email || '';
    let terverifikasi = Boolean(profil.email);

    if (!email && p.emailUrl) {
      const resEmail = await fetch(p.emailUrl, { headers });
      if (resEmail.ok) {
        const daftar = await resEmail.json();
        const utama = Array.isArray(daftar)
          ? (daftar.find((e) => e.primary && e.verified)
             || daftar.find((e) => e.verified))
          : null;
        if (utama) {
          email = utama.email;
          terverifikasi = true;
        }
      }
    }

    return {
      providerUserId: String(profil.id),
      email,
      emailTerverifikasi: terverifikasi,
      nama: profil.name || profil.login || '',
      avatar: profil.avatar_url || '',
    };
  }

  // ── Google / Microsoft: verifikasi id_token, lalu userinfo ────────────────
  let klaim = null;
  if (token.id_token) {
    klaim = await verifikasiIdToken({
      idToken: token.id_token, jwksUrl: p.jwksUrl, issuer: p.issuer,
      audience: clientIdUntuk(provider, config), nonceDiharapkan,
    });
  }

  // userinfo dipakai untuk melengkapi (nama, avatar). Kalau id_token sudah
  // lengkap, panggilan ini tidak wajib — tapi nama tampilan biasanya lebih
  // baik di userinfo.
  let info = {};
  if (p.userinfoUrl && token.access_token) {
    try {
      const res = await fetch(p.userinfoUrl, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (res.ok) info = await res.json();
    } catch {
      // Gagal ambil userinfo bukan alasan menolak login: id_token sudah
      // memberi identitas yang terverifikasi. Nama bisa kosong.
    }
  }

  const sub = klaim?.sub || info.sub || '';
  if (!sub) throw new Error(`${provider}: subjek tidak ada di respons`);

  return {
    providerUserId: sub,
    email: emailDariKlaim({ provider, klaim, info }),
    emailTerverifikasi:
      klaim?.email_verified === true || info.email_verified === true ||
      // Microsoft mengirim email di klaim 'preferred_username' atau 'email'
      // tanpa flag email_verified. Untuk akun Microsoft, email di id_token
      // berasal dari direktori tepercaya.
      (provider === 'microsoft' && Boolean(klaim?.email || info.email)),
    nama: info.name || klaim?.name || '',
    avatar: info.picture || '',
  };
}

// ── Verifikasi id_token (JWT) ─────────────────────────────────────────────────

const cacheJwks = new Map(); // url → { keys, diambil }

/**
 * Verifikasi id_token: tanda tangan, issuer, audience, umur.
 *
 * ── KENAPA TANDA TANGAN WAJIB DIPERIKSA ──────────────────────────────────────
 * id_token datang lewat jaringan yang kita tidak kendalikan. Tanpa
 * verifikasi tanda tangan, siapa pun yang bisa menyisipkan respons dari
 * provider bisa mengaku sebagai pengguna mana pun. Mempercayai isi JWT
 * tanpa memeriksa tanda tangannya sama dengan mempercayai input pengguna.
 *
 * Kunci publik diambil dari JWKS provider dan di-cache 1 jam. Kunci
 * provider berotasi, jadi cache harus kedaluwarsa — dan kalau `kid` tidak
 * ditemukan di cache, cache diambil ulang sekali sebelum menyerah.
 */
export async function verifikasiIdToken({
  idToken, jwksUrl, issuer, audience, nonceDiharapkan = '',
}) {
  const bagian = String(idToken).split('.');
  if (bagian.length !== 3) throw new Error('id_token bukan JWT yang sah');

  const [encHeader, encPayload, encSig] = bagian;

  let header, klaim;
  try {
    header = JSON.parse(Buffer.from(encHeader, 'base64url').toString('utf8'));
    klaim = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('id_token tidak bisa dibaca');
  }

  // ── Umur token ─────────────────────────────────────────────────────────────
  const sekarang = Math.floor(Date.now() / 1000);
  if (typeof klaim.exp === 'number' && klaim.exp < sekarang) {
    throw new Error('id_token kedaluwarsa');
  }
  // Toleransi 5 menit untuk 'iat' di masa depan: jam server dan provider
  // tidak selalu sinkron sempurna.
  if (typeof klaim.iat === 'number' && klaim.iat > sekarang + 300) {
    throw new Error('id_token dari masa depan');
  }

  // ── Audience ───────────────────────────────────────────────────────────────
  const aud = Array.isArray(klaim.aud) ? klaim.aud : [klaim.aud];
  if (!aud.includes(audience)) throw new Error('id_token: audience tidak cocok');

  // ── Issuer ─────────────────────────────────────────────────────────────────
  if (issuer && !issuerCocok(klaim.iss, issuer)) {
    throw new Error(`id_token: issuer tidak cocok (${klaim.iss})`);
  }

  // ── Nonce (kalau alur memakainya) ──────────────────────────────────────────
  if (nonceDiharapkan && klaim.nonce !== nonceDiharapkan) {
    throw new Error('id_token: nonce tidak cocok');
  }

  // ── Tanda tangan ───────────────────────────────────────────────────────────
  if (jwksUrl) {
    let kunci = await cariKunci(jwksUrl, header.kid);

    // Kunci tidak ada di cache → kemungkinan provider baru merotasi.
    // Ambil ulang sekali; kalau tetap tidak ada, tolak.
    if (!kunci) {
      cacheJwks.delete(jwksUrl);
      kunci = await cariKunci(jwksUrl, header.kid);
    }
    if (!kunci) throw new Error('id_token: kunci publik tidak ditemukan');

    await verifikasiTandaTangan({
      inti: `${encHeader}.${encPayload}`,
      tandaTangan: Buffer.from(encSig, 'base64url'),
      jwk: kunci, alg: header.alg,
    });
  }

  return klaim;
}

/** Microsoft memakai issuer dengan {tenantid} — cocokkan sebagai pola. */
function issuerCocok(iss, diharapkan) {
  if (iss === diharapkan) return true;
  if (!diharapkan.includes('{tenantid}')) return false;

  const pola = diharapkan
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{tenantid\\}', '[0-9a-fA-F-]{36}');
  return new RegExp(`^${pola}$`).test(iss);
}

async function cariKunci(jwksUrl, kid) {
  let entry = cacheJwks.get(jwksUrl);
  const SEJAM = 3_600_000;

  if (!entry || Date.now() - entry.diambil > SEJAM) {
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`JWKS: HTTP ${res.status}`);
    const data = await res.json();
    entry = { keys: Array.isArray(data.keys) ? data.keys : [], diambil: Date.now() };
    cacheJwks.set(jwksUrl, entry);
  }

  // kid bisa tidak ada (provider dengan satu kunci). Dalam hal itu, kalau
  // hanya ada satu kunci, pakai itu — perilaku yang aman karena tetap
  // diverifikasi terhadap kunci publik provider.
  if (kid) return entry.keys.find((k) => k.kid === kid) || null;
  return entry.keys.length === 1 ? entry.keys[0] : null;
}

async function verifikasiTandaTangan({ inti, tandaTangan, jwk, alg }) {
  const { createPublicKey, verify } = await import('node:crypto');

  let kunci;
  try {
    kunci = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new Error('id_token: kunci publik tidak bisa dibaca');
  }

  const peta = {
    RS256: { hash: 'sha256', opsi: {} },
    RS384: { hash: 'sha384', opsi: {} },
    RS512: { hash: 'sha512', opsi: {} },
    ES256: { hash: 'sha256', opsi: { dsaEncoding: 'ieee-p1363' } },
    ES384: { hash: 'sha384', opsi: { dsaEncoding: 'ieee-p1363' } },
  };

  const cara = peta[alg];
  if (!cara) throw new Error(`id_token: algoritma ${alg} tidak didukung`);

  const sah = verify(cara.hash, Buffer.from(inti), {
    key: kunci, ...cara.opsi,
  }, tandaTangan);

  if (!sah) throw new Error('id_token: tanda tangan tidak sah');
}
