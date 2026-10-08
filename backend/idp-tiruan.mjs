/**
 * IdP OIDC tiruan untuk menguji alur SSO tanpa akun Okta/Azure/Cloudflare.
 *
 * ── KENAPA PERLU ─────────────────────────────────────────────────────────────
 * Menguji alur SSO butuh IdP yang: menyediakan discovery, menerbitkan code,
 * menukarnya jadi id_token, dan menandatangani JWT dengan kunci RSA.
 *
 * Menunggu akses ke Okta/Azure sungguhan berarti alur ini tidak bisa diuji
 * sama sekali sampai klien pertama datang. Dengan tiruan ini, semua bagian
 * diuji SEKARANG — dan kalau IdP sungguhan punya perilaku berbeda, yang perlu
 * diperbaiki hanya detail kecil, bukan seluruh alur.
 *
 * ── YANG DITIRUKAN ───────────────────────────────────────────────────────────
 *   GET  /.well-known/openid-configuration   dokumen discovery
 *   GET  /authorize                          halaman izin (langsung setuju)
 *   POST /token                              tukar code → id_token
 *   GET  /jwks                               kunci publik untuk verifikasi
 *
 * ── YANG DIUJI DENGAN INI ───────────────────────────────────────────────────
 *   ✅ Discovery dibaca dan divalidasi
 *   ✅ PKCE dipakai kalau didukung
 *   ✅ state diverifikasi dan sekali pakai
 *   ✅ nonce di id_token cocok
 *   ✅ Tanda tangan JWT diverifikasi terhadap JWKS
 *   ✅ issuer + audience diverifikasi
 *   ✅ Domain email dibatasi dengan benar
 *   ✅ Akun dibuat/disambungkan seperti provider publik
 */

import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2] || 9911);
const ISSUER = `http://127.0.0.1:${PORT}`;

// ── Kunci RSA untuk menandatangani id_token ───────────────────────────────────
// IdP sungguhan memakai RS256 dengan kunci yang dirotasi. Tiruan ini memakai
// satu kunci — cukup untuk menguji jalur verifikasinya.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'kunci-uji-1', use: 'sig', alg: 'RS256' };

// ── Penyimpanan sementara ─────────────────────────────────────────────────────
const kodeTersimpan = new Map(); // code → { nonce, email, nama, sub, codeChallenge }

/** Email yang akan "dikembalikan" IdP — bisa diubah lewat query. */
let emailBerikutnya = 'budi@perusahaan.com';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Buat id_token yang ditandatangani RS256. */
function buatIdToken({ nonce, email, nama, sub, audience }) {
  const sekarang = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: JWK.kid, typ: 'JWT' };
  const payload = {
    iss: ISSUER,
    sub,
    aud: audience,
    exp: sekarang + 3600,
    iat: sekarang,
    nonce,
    email,
    email_verified: true,
    name: nama,
  };

  const inti = `${b64url(header)}.${b64url(payload)}`;
  const signer = createSign('SHA256');
  signer.update(inti);
  signer.end();
  const sig = signer.sign(privateKey);

  return `${inti}.${sig.toString('base64url')}`;
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const path = url.pathname;

  // ── Discovery ──────────────────────────────────────────────────────────────
  if (path === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      // PKCE didukung — supaya jalur PKCE ikut teruji.
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'email', 'profile'],
    }));
    return;
  }

  // ── JWKS ───────────────────────────────────────────────────────────────────
  if (path === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [JWK] }));
    return;
  }

  // ── Halaman izin: langsung "setuju" dan kembalikan code ────────────────────
  if (path === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const state = url.searchParams.get('state') || '';
    const nonce = url.searchParams.get('nonce') || '';
    const clientId = url.searchParams.get('client_id') || '';
    const codeChallenge = url.searchParams.get('code_challenge') || '';

    if (!redirectUri || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('redirect_uri dan state wajib');
      return;
    }

    const code = 'kode-' + randomUUID();
    kodeTersimpan.set(code, {
      nonce, email: emailBerikutnya, nama: 'Budi Santoso',
      sub: 'user-oidc-001', codeChallenge, clientId,
    });

    // Bersihkan code lama supaya tidak menumpuk selama pengujian panjang.
    if (kodeTersimpan.size > 50) {
      const pertama = kodeTersimpan.keys().next().value;
      kodeTersimpan.delete(pertama);
    }

    const tujuan = new URL(redirectUri);
    tujuan.searchParams.set('code', code);
    tujuan.searchParams.set('state', state);

    res.writeHead(302, { Location: tujuan.toString() });
    res.end();
    return;
  }

  // ── Tukar code → token ─────────────────────────────────────────────────────
  if (path === '/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);

    const code = params.get('code') || '';
    const verifier = params.get('code_verifier') || '';
    const data = kodeTersimpan.get(code);

    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'code tidak dikenal' }));
      return;
    }

    // Code sekali pakai — hapus SEKARANG, sebelum verifikasi apa pun.
    // Ini meniru IdP sungguhan, dan menguji bahwa kita tidak mencoba
    // memakai ulang code yang sama.
    kodeTersimpan.delete(code);

    // ── Verifikasi PKCE ──────────────────────────────────────────────────────
    // Kalau klien mengirim code_challenge, ia WAJIB mengirim verifier yang
    // hash-nya cocok. IdP sungguhan menolak kalau tidak cocok.
    if (data.codeChallenge) {
      const { createHash } = await import('node:crypto');
      const diharapkan = createHash('sha256').update(verifier).digest('base64url');
      if (diharapkan !== data.codeChallenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE tidak cocok' }));
        return;
      }
    }

    const idToken = buatIdToken({
      nonce: data.nonce, email: data.email, nama: data.nama,
      sub: data.sub, audience: data.clientId,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: 'akses-' + randomUUID(),
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
    }));
    return;
  }

  // ── Kendali pengujian: ubah email yang akan dikembalikan ───────────────────
  if (path === '/kendali/email') {
    emailBerikutnya = url.searchParams.get('nilai') || emailBerikutnya;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, emailBerikutnya }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('tidak ada');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  IdP tiruan: ${ISSUER}`);
  console.log(`  discovery : ${ISSUER}/.well-known/openid-configuration`);
});
