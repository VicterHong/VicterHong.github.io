/**
 * IdP Apple TIRUAN — untuk menguji alur Sign in with Apple tanpa bayar $99.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️  INI TIRUAN. BUKAN APPLE SUNGGUHAN.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── KENAPA INI ADA ──
 * Apple TIDAK punya sandbox atau mode testing untuk Sign in with Apple.
 * Diverifikasi: dokumen discovery mereka (appleid.apple.com/.well-known/
 * openid-configuration) tidak memuat endpoint sandbox apa pun. Untuk
 * menguji dengan Apple ID sungguhan, Anda WAJIB punya Apple Developer
 * Program membership ($99/tahun) — tidak ada jalan pintas.
 *
 * Jadi ini bukan pengganti Apple. Ini pengganti untuk PENGUJIAN: ia meniru
 * perilaku Apple dengan cukup akurat sehingga alur kode kita terbukti
 * bekerja SEBELUM uang dikeluarkan.
 *
 * ── YANG DITIRUKAN DENGAN AKURAT ──
 * Perilaku khas Apple yang membedakannya dari provider lain — semuanya
 * diuji di sini:
 *
 *   1. response_mode=form_post
 *      Apple mengirim hasil otorisasi lewat POST ke callback, BUKAN query
 *      string. Callback yang hanya menangani GET akan gagal total.
 *
 *   2. TIDAK ADA userinfo endpoint
 *      Apple tidak menyediakan /userinfo. Email dan nama HANYA ada di
 *      id_token. Kode yang mencoba fetch userinfo akan gagal.
 *
 *   3. NAMA HANYA PADA OTORISASI PERTAMA
 *      Apple mengirim `name` hanya saat pengguna pertama kali menyetujui.
 *      Login berikutnya tidak mengirimnya. Ini perilaku Apple, bukan bug.
 *
 *   4. client_secret BERUPA JWT ES256
 *      Apple tidak memberi secret statis. Yang dipakai adalah JWT yang
 *      ditandatangani kunci .p8. IdP tiruan ini MEMVERIFIKASI JWT itu —
 *      termasuk tanda tangan ES256 dan klaimnya. Jadi kalau kode kita
 *      menghasilkan JWT yang salah bentuk, pengujian ini akan menangkapnya.
 *
 *   5. id_token ditandatangani RS256 dengan klaim `sub` pairwise
 *
 * ── YANG TIDAK DITIRUKAN ──
 *   • Tampilan halaman izin Apple yang sesungguhnya
 *   • Rate limit dan perlindungan anti-abuse Apple
 *   • Perilaku Apple ID sungguhan (2FA, perangkat tepercaya, dll)
 *   • Apple "Hide My Email" (relay email)
 *
 * ── CARA PAKAI ──
 *   node idp-apple-tiruan.mjs 9912
 *
 * Lalu jalankan server dengan:
 *   APPLE_CLIENT_ID=id.vivastic.signin \
 *   APPLE_TEAM_ID=ABCDE12345 \
 *   APPLE_KEY_ID=XYZ9876543 \
 *   APPLE_PRIVATE_KEY="$(cat kunci-uji.p8)" \
 *   ... node src/server.mjs
 *
 * Lihat uji-apple.mjs untuk pengujian otomatisnya.
 */

import { createServer } from 'node:http';
import {
  generateKeyPairSync, createSign, createVerify, createPublicKey,
  createHash, randomUUID,
} from 'node:crypto';

const PORT = Number(process.argv[2] || 9912);
const ISSUER = `http://127.0.0.1:${PORT}`;

// ── Kunci untuk menandatangani id_token (RS256) ───────────────────────────────
const { privateKey: kunciIdToken, publicKey: pubIdToken } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const JWK = { ...pubIdToken.export({ format: 'jwk' }), kid: 'apple-uji-1', use: 'sig', alg: 'RS256' };

/**
 * Kunci yang HARUS dipakai server untuk menandatangani client_secret.
 *
 * IdP tiruan ini memverifikasi client_secret terhadap kunci publik ini.
 * Kalau server memakai kunci lain, verifikasi gagal — persis seperti Apple.
 *
 * Kunci ditulis ke berkas supaya server bisa memakainya. Dalam pengujian
 * nyata, kunci ini yang menggantikan berkas .p8 dari Apple.
 */
const { privateKey: kunciClientSecret, publicKey: pubClientSecret } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});

// ── Penyimpanan sementara ─────────────────────────────────────────────────────
const kodeTersimpan = new Map();

/** Email yang dikembalikan. Bisa diubah lewat /kendali/email. */
let emailBerikutnya = 'budi@icloud.com';

/** Apakah ini otorisasi PERTAMA? Apple hanya kirim nama saat pertama. */
let otorisasiPertama = true;

// ── Helper ────────────────────────────────────────────────────────────────────

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Buat id_token RS256 — meniru bentuk id_token Apple. */
function buatIdToken({ nonce, email, audience, sub = 'apple-sub-001' }) {
  const sekarang = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: JWK.kid, typ: 'JWT' };

  // Klaim khas Apple. Perhatikan: TIDAK ADA `name` — Apple menaruh nama di
  // respons POST terpisah, bukan di id_token.
  const payload = {
    iss: ISSUER,
    aud: audience,
    exp: sekarang + 3600,
    iat: sekarang,
    sub,
    nonce,
    email,
    email_verified: 'true',   // Apple mengirim STRING, bukan boolean
    is_private_email: 'false',
    auth_time: sekarang,
    nonce_supported: true,
  };

  const inti = `${b64url(header)}.${b64url(payload)}`;
  const signer = createSign('SHA256');
  signer.update(inti);
  signer.end();
  const sig = signer.sign(kunciIdToken);

  return `${inti}.${sig.toString('base64url')}`;
}

/**
 * Verifikasi client_secret JWT yang dibuat server.
 *
 * Ini bagian paling berharga dari IdP tiruan: kode kita punya fungsi
 * rahasiaApple() yang membuat JWT ES256 dari kunci .p8. Fungsi itu mudah
 * salah (format tanda tangan, klaim, encoding) dan kesalahannya baru
 * ketahuan setelah $99 dibayar.
 *
 * Di sini kita verifikasi persis seperti Apple:
 *   - tanda tangan ES256 sah terhadap kunci publik
 *   - iss = Team ID
 *   - sub = Services ID (client_id)
 *   - aud = https://appleid.apple.com
 *   - exp belum lewat
 */
function verifikasiClientSecret(jwt, { teamId, clientId }) {
  const bagian = String(jwt || '').split('.');
  if (bagian.length !== 3) {
    return { ok: false, alasan: 'client_secret bukan JWT (3 bagian)' };
  }

  let header, klaim;
  try {
    header = JSON.parse(Buffer.from(bagian[0], 'base64url').toString('utf8'));
    klaim = JSON.parse(Buffer.from(bagian[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, alasan: 'client_secret tidak bisa dibaca' };
  }

  if (header.alg !== 'ES256') {
    return { ok: false, alasan: `alg harus ES256, dapat ${header.alg}` };
  }

  // ── Verifikasi tanda tangan ────────────────────────────────────────────────
  // Apple memakai ES256 dengan encoding r||s (ieee-p1363), BUKAN DER.
  // Salah encoding = tanda tangan tidak sah.
  let sah;
  try {
    sah = createVerify('SHA256').update(`${bagian[0]}.${bagian[1]}`).verify(
      { key: pubClientSecret, dsaEncoding: 'ieee-p1363' },
      Buffer.from(bagian[2], 'base64url'),
    );
  } catch (err) {
    return { ok: false, alasan: `verifikasi tanda tangan gagal: ${err.message}` };
  }

  if (!sah) return { ok: false, alasan: 'tanda tangan client_secret tidak sah' };

  // ── Verifikasi klaim ───────────────────────────────────────────────────────
  const sekarang = Math.floor(Date.now() / 1000);
  if (klaim.iss !== teamId) {
    return { ok: false, alasan: `iss harus Team ID (${teamId}), dapat ${klaim.iss}` };
  }
  if (klaim.sub !== clientId) {
    return { ok: false, alasan: `sub harus Services ID (${clientId}), dapat ${klaim.sub}` };
  }
  if (klaim.aud !== 'https://appleid.apple.com') {
    return { ok: false, alasan: `aud harus https://appleid.apple.com, dapat ${klaim.aud}` };
  }
  if (typeof klaim.exp !== 'number' || klaim.exp < sekarang) {
    return { ok: false, alasan: 'client_secret sudah kedaluwarsa' };
  }
  // Apple membatasi umur maksimum 6 bulan. Kita periksa itu juga.
  if (klaim.exp - klaim.iat > 15_778_476) {
    return { ok: false, alasan: 'umur client_secret melebihi 6 bulan (batas Apple)' };
  }

  return { ok: true, klaim };
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const path = url.pathname;

  // ── Discovery — meniru dokumen Apple ───────────────────────────────────────
  if (path === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/auth/authorize`,
      token_endpoint: `${ISSUER}/auth/token`,
      revocation_endpoint: `${ISSUER}/auth/revoke`,
      jwks_uri: `${ISSUER}/auth/keys`,
      // Apple TIDAK memuat userinfo_endpoint — itu perilaku aslinya.
      response_types_supported: ['code'],
      response_modes_supported: ['query', 'fragment', 'form_post'],
      subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['name', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      claims_supported: [
        'aud', 'email', 'email_verified', 'exp', 'iat', 'is_private_email',
        'iss', 'nonce', 'nonce_supported', 'sub',
      ],
    }));
    return;
  }

  // ── JWKS ───────────────────────────────────────────────────────────────────
  if (path === '/auth/keys') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [JWK] }));
    return;
  }

  // ── Halaman izin — langsung setuju, lalu POST ke callback ──────────────────
  if (path === '/auth/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const state = url.searchParams.get('state') || '';
    const nonce = url.searchParams.get('nonce') || '';
    const clientId = url.searchParams.get('client_id') || '';
    const responseMode = url.searchParams.get('response_mode') || 'query';

    if (!redirectUri || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('redirect_uri dan state wajib');
      return;
    }

    // ── Apple MEWAJIBKAN form_post ─────────────────────────────────────────
    // Kalau server tidak meminta form_post, IdP tiruan ini tetap memakai
    // form_post — supaya perilaku Apple yang sebenarnya ikut teruji.
    if (responseMode !== 'form_post') {
      console.log('  ⚠️  server tidak memakai response_mode=form_post — Apple mewajibkan itu');
    }

    const code = 'apple-code-' + randomUUID();
    kodeTersimpan.set(code, {
      nonce, email: emailBerikutnya, clientId,
      // Nama hanya dikirim kalau ini otorisasi pertama — perilaku Apple.
      kirimNama: otorisasiPertama,
    });
    otorisasiPertama = false;

    if (kodeTersimpan.size > 50) {
      kodeTersimpan.delete(kodeTersimpan.keys().next().value);
    }

    // ── Kirim lewat POST ke callback (form_post) ───────────────────────────
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Apple ID (tiruan)</title></head>
<body style="font-family:system-ui;background:#111;color:#eee;padding:40px;text-align:center">
  <h2>Apple ID — IdP TIRUAN</h2>
  <p style="color:#f88">⚠️ Ini bukan Apple sungguhan. Hanya untuk pengujian.</p>
  <p>Mengalihkan…</p>
  <form id="f" method="POST" action="${redirectUri}">
    <input type="hidden" name="code" value="${code}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="id_token" value="">
    ${kodeTersimpan.get(code).kirimNama ? `
    <input type="hidden" name="user" value='${JSON.stringify({
      name: { firstName: 'Budi', lastName: 'Santoso' },
      email: 'budi@icloud.com',
    })}'>` : ''}
  </form>
  <script>document.getElementById('f').submit();</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── Tukar code → token ─────────────────────────────────────────────────────
  if (path === '/auth/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);

    const code = params.get('code') || '';
    const clientId = params.get('client_id') || '';
    const clientSecret = params.get('client_secret') || '';
    const data = kodeTersimpan.get(code);

    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'code tidak dikenal' }));
      return;
    }

    // Code sekali pakai.
    kodeTersimpan.delete(code);

    // ── Verifikasi client_secret JWT (perilaku khas Apple) ─────────────────
    const cek = verifikasiClientSecret(clientSecret, {
      teamId: process.env.APPLE_TEAM_ID || 'ABCDE12345',
      clientId: clientId,
    });

    if (!cek.ok) {
      console.log(`  ❌ client_secret ditolak: ${cek.alasan}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'invalid_client',
        error_description: `client_secret tidak sah: ${cek.alasan}`,
      }));
      return;
    }

    const idToken = buatIdToken({
      nonce: data.nonce,
      email: data.email,
      audience: clientId,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: 'apple-akses-' + randomUUID(),
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      // Apple TIDAK mengirim refresh_token untuk alur web sederhana.
    }));
    return;
  }

  // ── Kendali pengujian ──────────────────────────────────────────────────────
  if (path === '/kendali/email') {
    emailBerikutnya = url.searchParams.get('nilai') || emailBerikutnya;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, emailBerikutnya }));
    return;
  }

  if (path === '/kendali/reset-pertama') {
    otorisasiPertama = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, otorisasiPertama }));
    return;
  }

  if (path === '/kendali/kunci-client-secret') {
    // Kunci privat PEM yang harus dipakai server untuk client_secret.
    // Ini menggantikan berkas .p8 dari Apple.
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(kunciClientSecret.export({ type: 'pkcs8', format: 'pem' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('tidak ada');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  IdP Apple TIRUAN: ${ISSUER}`);
  console.log(`  ⚠️  Bukan Apple sungguhan — hanya untuk pengujian.`);
  console.log(`  kunci client_secret: ${ISSUER}/kendali/kunci-client-secret`);
});
