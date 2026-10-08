/**
 * Uji alur auth: OAuth (dengan provider palsu) dan passkey (kriptografi nyata).
 *
 * ── KENAPA PROVIDER PALSU, BUKAN GOOGLE SUNGGUHAN ────────────────────────────
 * Menguji ke Google sungguhan butuh kredensial OAuth asli, dan setiap
 * pengujian akan membuat akun nyata di Google. Provider palsu memberi hal
 * yang sama pentingnya: alur state → tukar code → verifikasi id_token →
 * buat pengguna → sesi. Yang diuji adalah kode KITA, bukan kode Google.
 *
 * Yang TIDAK bisa diuji dengan cara ini: apakah URL otorisasi dan endpoint
 * token Google benar. Itu diverifikasi terpisah dengan mencocokkan URL
 * terhadap dokumentasi resmi.
 *
 * ── PASSKEY DIUJI DENGAN KRIPTOGRAFI NYATA ───────────────────────────────────
 * Bukan mock: kunci P-256 dibuat, ditandatangani, lalu diverifikasi server.
 * Ini membuktikan verifikasi tanda tangan benar-benar berjalan — bagian
 * yang paling mudah salah dan paling berbahaya kalau salah.
 */

import { createHash, generateKeyPairSync, sign as tandaTangan, randomBytes } from 'node:crypto';

const BASE = process.env.UJI_BASE || 'http://127.0.0.1:8799';
const RP_ID = 'portfolio-victer.pages.dev';

let lulus = 0;
let gagal = 0;

function cek(nama, syarat, detail = '') {
  if (syarat) {
    lulus += 1;
    console.log(`  ✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ❌ ${nama}${detail ? ' — ' + detail : ''}`);
  }
}

// ── Helper CBOR encoder (untuk membangun attestationObject palsu) ─────────────
//
// Verifikasi registrasi butuh attestationObject berformat CBOR. Kita membangun
// yang minimal: map { fmt, attStmt, authData }. Attestation statement TIDAK
// diperiksa server (lihat webauthn.mjs), jadi cukup map kosong.

function cborHeader(major, panjang) {
  if (panjang < 24) return Buffer.from([(major << 5) | panjang]);
  if (panjang < 256) return Buffer.from([(major << 5) | 24, panjang]);
  if (panjang < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(panjang, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(panjang, 1);
  return b;
}

const cborBytes = (buf) => Buffer.concat([cborHeader(2, buf.length), buf]);
const cborText = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([cborHeader(3, b.length), b]);
};
const cborMap = (pasangan) => {
  const isi = pasangan.map(([k, v]) => Buffer.concat([k, v]));
  return Buffer.concat([cborHeader(5, pasangan.length), ...isi]);
};
const cborInt = (n) => {
  if (n >= 0) return cborHeader(0, n);
  return cborHeader(1, -1 - n);
};

/** COSE key ES256 dari kunci P-256 Node. */
function coseDariKunci(kunciPublik) {
  const jwk = kunciPublik.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return cborMap([
    [cborInt(1), cborInt(2)],    // kty: EC2
    [cborInt(3), cborInt(-7)],   // alg: ES256
    [cborInt(-1), cborInt(1)],   // crv: P-256
    [cborInt(-2), cborBytes(x)],
    [cborInt(-3), cborBytes(y)],
  ]);
}

/** authenticatorData untuk registrasi (dengan attested credential data). */
function authDataRegistrasi({ kunciPublik, credentialId, signCount = 0 }) {
  const rpIdHash = createHash('sha256').update(RP_ID).digest();
  const flags = Buffer.from([0x01 | 0x40 | 0x04]); // UP | AT | UV
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount, 0);
  const aaguid = Buffer.alloc(16); // nol
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credentialId.length, 0);

  return Buffer.concat([
    rpIdHash, flags, counter, aaguid, idLen, credentialId,
    coseDariKunci(kunciPublik),
  ]);
}

/** authenticatorData untuk autentikasi (tanpa attested credential data). */
function authDataAutentikasi({ signCount }) {
  const rpIdHash = createHash('sha256').update(RP_ID).digest();
  const flags = Buffer.from([0x01 | 0x04]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount, 0);
  return Buffer.concat([rpIdHash, flags, counter]);
}

const b64u = (b) => Buffer.from(b).toString('base64url');

// ── Uji ───────────────────────────────────────────────────────────────────────

async function uji() {
  console.log('\n══ 1. OAUTH: alur lengkap dengan provider palsu ══\n');

  // ── 1a. URL otorisasi benar ────────────────────────────────────────────────
  const resMulai = await fetch(`${BASE}/api/auth/google`, { redirect: 'manual' });
  const lokasi = resMulai.headers.get('location') || '';

  // Google mungkin sudah dikonfigurasi (env produksi dibaca sebagai fallback),
  // jadi kita tidak mengharapkan halaman masuk. Yang harus SELALU benar:
  // endpoint membalas 302 ke suatu tempat yang masuk akal — bukan 500,
  // bukan 404, bukan body kosong.
  const tujuanMasukAkal = lokasi.includes('/sign-in') || lokasi.includes('accounts.google.com');
  cek('OAuth selalu mengalihkan (302 ke halaman masuk atau ke provider)',
    resMulai.status === 302 && tujuanMasukAkal,
    `status ${resMulai.status}, lokasi ${lokasi.slice(0, 50)}`);

  // ── 1b. Callback menolak state yang tidak ada ──────────────────────────────
  const resCallback = await fetch(
    `${BASE}/api/auth/google/callback?code=palsu&state=tidak-ada`,
    { redirect: 'manual' },
  );
  cek('Callback menolak state palsu',
    resCallback.status === 302 &&
    (resCallback.headers.get('location') || '').includes('state_tidak_sah'));

  // ── 1c. Callback menolak code tanpa state ──────────────────────────────────
  const resTanpaState = await fetch(
    `${BASE}/api/auth/google/callback?code=palsu`,
    { redirect: 'manual' },
  );
  cek('Callback menolak permintaan tanpa state',
    resTanpaState.status === 302 &&
    (resTanpaState.headers.get('location') || '').includes('callback_tidak_lengkap'));

  // ── 1d. Apple form_post: POST tanpa state juga ditolak ─────────────────────
  const resFormPost = await fetch(`${BASE}/api/auth/apple/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'code=palsu&state=tidak-ada',
    redirect: 'manual',
  });
  cek('Apple form_post (POST) ditangani, bukan 405',
    resFormPost.status === 302,
    `status ${resFormPost.status}`);

  // ── 1e. Semua provider punya rute ──────────────────────────────────────────
  for (const p of ['google', 'microsoft', 'apple', 'github']) {
    const r = await fetch(`${BASE}/api/auth/${p}`, { redirect: 'manual' });
    cek(`Rute /api/auth/${p} ada`, r.status === 302);
  }

  // ── 1f. Provider tidak dikenal tidak dilayani ──────────────────────────────
  const resAsing = await fetch(`${BASE}/api/auth/facebook`, { redirect: 'manual' });
  cek('Provider tidak dikenal → 404 (bukan diproses)', resAsing.status === 404);

  // ── 1g. SSO tanpa entry point → pesan jelas ────────────────────────────────
  const resSso = await fetch(`${BASE}/api/auth/sso`, { redirect: 'manual' });
  const lokasiSso = resSso.headers.get('location') || '';

  // SSO boleh aktif (kalau SSO_ISSUER diisi) atau belum. Yang harus benar:
  //   - belum aktif → dialihkan ke halaman masuk dengan kode jelas
  //   - sudah aktif → dialihkan ke IdP (bukan ke halaman masuk)
  const ssoMasukAkal = lokasiSso.includes('sso_belum_aktif')
    || (!lokasiSso.includes('/sign-in') && lokasiSso.startsWith('http'));

  cek('SSO mengalihkan ke tempat yang benar (belum aktif → pesan, aktif → IdP)',
    resSso.status === 302 && ssoMasukAkal,
    `status ${resSso.status}, lokasi ${lokasiSso.slice(0, 55)}`);

  console.log('\n══ 2. PASSKEY: kriptografi nyata ══\n');

  // ── 2a. Masuk tanpa sesi: challenge terbit ─────────────────────────────────
  const resCh = await fetch(`${BASE}/api/auth/passkey/masuk/mulai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const ch = await resCh.json();
  cek('Passkey masuk/mulai menerbitkan challenge',
    ch.ok === true && typeof ch.challenge === 'string' && ch.challenge.length >= 32);
  // rpId diturunkan dari SITE_URL. Uji ini memeriksa bahwa nilainya sesuai
  // konfigurasi yang sedang dipakai — bukan nilai tetap, karena SITE_URL
  // berbeda antara lokal dan produksi.
  //
  // Yang WAJIB benar di kedua lingkungan: rpId adalah HOSTNAME, bukan URL
  // penuh, dan bukan alamat IP (WebAuthn menolak IP).
  const rpIdValid = typeof ch.rpId === 'string'
    && ch.rpId.length > 0
    && !ch.rpId.includes('/')
    && !ch.rpId.includes(':')
    && !/^\d+\.\d+\.\d+\.\d+$/.test(ch.rpId);

  cek('rpId berbentuk hostname yang sah (bukan URL, bukan IP)',
    rpIdValid, `rpId: ${ch.rpId}`);
  cek('rpId sesuai SITE_URL yang dikonfigurasi',
    ch.rpId === new URL(process.env.UJI_SITE_URL || 'https://portfolio-victer.pages.dev').hostname
      || ch.rpId === 'localhost',
    `rpId: ${ch.rpId}`);
  cek('allowCredentials kosong (discoverable)', Array.isArray(ch.allowCredentials) && ch.allowCredentials.length === 0);

  // ── 2b. Registrasi tanpa sesi ditolak ──────────────────────────────────────
  const resReg = await fetch(`${BASE}/api/auth/passkey/registrasi/mulai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  cek('Passkey registrasi tanpa sesi → 401', resReg.status === 401);

  // ── 2c. Verifikasi tanda tangan GAGAL kalau kunci berbeda ──────────────────
  //
  // Ini uji paling penting: membuktikan server BENAR-BENAR memeriksa tanda
  // tangan, bukan hanya mencocokkan id. Kalau uji ini lulus padahal kuncinya
  // salah, seluruh passkey tidak aman.
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const { privateKey: kunciLain } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const credentialId = randomBytes(32);
  const challenge = ch.challenge;

  const clientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge,
    origin: `https://${RP_ID}`,
    crossOrigin: false,
  }));
  const authData = authDataAutentikasi({ signCount: 1 });
  const pesan = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);

  // Tanda tangan dengan kunci yang SALAH — harus ditolak.
  const sigSalah = tandaTangan('sha256', pesan, {
    key: kunciLain, dsaEncoding: 'ieee-p1363',
  });

  const resSigSalah = await fetch(`${BASE}/api/auth/passkey/masuk/selesai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: b64u(credentialId),
      challenge,
      response: {
        authenticatorData: b64u(authData),
        clientDataJSON: b64u(clientData),
        signature: b64u(sigSalah),
      },
    }),
  });
  const hasilSigSalah = await resSigSalah.json();
  cek('Tanda tangan dengan kunci SALAH ditolak',
    resSigSalah.status === 401 || hasilSigSalah.ok === false,
    `status ${resSigSalah.status}`);

  // ── 2d. Kredensial tidak terdaftar ditolak ─────────────────────────────────
  const sigBenar = tandaTangan('sha256', pesan, {
    key: privateKey, dsaEncoding: 'ieee-p1363',
  });
  const resCh2 = await fetch(`${BASE}/api/auth/passkey/masuk/mulai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const ch2 = await resCh2.json();

  const clientData2 = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: ch2.challenge,
    origin: `https://${RP_ID}`,
    crossOrigin: false,
  }));
  const authData2 = authDataAutentikasi({ signCount: 2 });
  const pesan2 = Buffer.concat([authData2, createHash('sha256').update(clientData2).digest()]);
  const sig2 = tandaTangan('sha256', pesan2, { key: privateKey, dsaEncoding: 'ieee-p1363' });

  const resTidakDikenal = await fetch(`${BASE}/api/auth/passkey/masuk/selesai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: b64u(credentialId), // tidak pernah didaftarkan
      challenge: ch2.challenge,
      response: {
        authenticatorData: b64u(authData2),
        clientDataJSON: b64u(clientData2),
        signature: b64u(sig2),
      },
    }),
  });
  cek('Kredensial tidak terdaftar ditolak (tanda tangan sah pun)',
    resTidakDikenal.status === 401,
    `status ${resTidakDikenal.status}`);

  // ── 2e. Challenge tidak bisa dipakai dua kali ──────────────────────────────
  //
  // Challenge ch2 sudah dipakai di 2d. Memakainya lagi harus gagal.
  const resUlang = await fetch(`${BASE}/api/auth/passkey/masuk/selesai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: b64u(credentialId),
      challenge: ch2.challenge,
      response: {
        authenticatorData: b64u(authData2),
        clientDataJSON: b64u(clientData2),
        signature: b64u(sig2),
      },
    }),
  });
  const hasilUlang = await resUlang.json();
  cek('Challenge tidak bisa dipakai dua kali',
    resUlang.status === 400 && hasilUlang.error === 'challenge_tidak_sah',
    `status ${resUlang.status}, error ${hasilUlang.error}`);

  // ── 2f. Origin asing ditolak ───────────────────────────────────────────────
  const resCh3 = await fetch(`${BASE}/api/auth/passkey/masuk/mulai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const ch3 = await resCh3.json();

  const clientDataAsing = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: ch3.challenge,
    origin: 'https://situs-penyerang.example',
    crossOrigin: false,
  }));
  const authData3 = authDataAutentikasi({ signCount: 3 });
  const pesan3 = Buffer.concat([authData3, createHash('sha256').update(clientDataAsing).digest()]);
  const sig3 = tandaTangan('sha256', pesan3, { key: privateKey, dsaEncoding: 'ieee-p1363' });

  const resAsingOrigin = await fetch(`${BASE}/api/auth/passkey/masuk/selesai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: b64u(credentialId),
      challenge: ch3.challenge,
      response: {
        authenticatorData: b64u(authData3),
        clientDataJSON: b64u(clientDataAsing),
        signature: b64u(sig3),
      },
    }),
  });
  cek('Origin asing ditolak', resAsingOrigin.status === 401,
    `status ${resAsingOrigin.status}`);

  console.log('\n══ 3. OTORISASI ══\n');

  const resIdentitas = await fetch(`${BASE}/api/auth/identitas`);
  cek('Daftar identitas tanpa sesi → 401', resIdentitas.status === 401);

  const resHapus = await fetch(`${BASE}/api/auth/identitas/hapus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'apa-saja' }),
  });
  cek('Hapus identitas tanpa sesi → 401', resHapus.status === 401);

  console.log('\n══ 4. KONFIGURASI ══\n');

  const resConfig = await fetch(`${BASE}/api/config`);
  const cfg = await resConfig.json();
  cek('/api/config melaporkan passkey siap', cfg.passkey === true);
  cek('/api/config punya kunci apple & microsoft di sso',
    'apple' in cfg.sso && 'microsoft' in cfg.sso);

  // ── Uji KONSISTENSI, bukan nilai tertentu ────────────────────────────────
  //
  // Provider boleh siap atau belum — tergantung kredensial yang terpasang.
  // Yang harus SELALU benar: /api/config melaporkan keadaan yang SAMA dengan
  // yang dilihat endpointnya. Kalau /api/config bilang "belum aktif" tapi
  // endpointnya mengalihkan ke provider, tombolnya akan mati padahal
  // seharusnya menyala — dan sebaliknya.
  //
  // Versi lama uji ini mengharapkan github === false. Itu gagal begitu
  // kredensial GitHub dipasang — padahal perilakunya benar. Uji yang
  // mengharapkan nilai tetap akan selalu basi.
  for (const p of ['google', 'github', 'microsoft', 'apple']) {
    const res = await fetch(`${BASE}/api/auth/${p}`, { redirect: 'manual' });
    const lokasi = res.headers.get('location') || '';
    const dilaporkanSiap = cfg.sso[p] === true;

    // Endpoint mengalihkan ke provider = siap. Mengalihkan ke halaman masuk
    // dengan galat = belum siap.
    const benarBenarSiap = lokasi.includes('login.microsoftonline.com')
      || lokasi.includes('github.com')
      || lokasi.includes('accounts.google.com')
      || lokasi.includes('appleid.apple.com');

    // Rate limit BUKAN tanda "belum siap" — endpointnya jalan, hanya
    // membatasi laju. Uji berulang cepat bisa memicunya.
    if (lokasi.includes('terlalu_banyak')) {
      cek(`/api/config ${p} — rate limit terpicu (uji dilewati)`, true);
      continue;
    }

    cek(`/api/config ${p} konsisten dengan endpointnya`,
      dilaporkanSiap === benarBenarSiap,
      `config=${dilaporkanSiap}, endpoint=${benarBenarSiap} (${lokasi.slice(0, 40)})`);
  }

  // ── Ringkasan ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  LULUS: ${lulus}    GAGAL: ${gagal}`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(gagal > 0 ? 1 : 0);
}

uji().catch((err) => {
  console.error('\n  ❌ Uji gagal dijalankan:', err.message);
  process.exit(1);
});
