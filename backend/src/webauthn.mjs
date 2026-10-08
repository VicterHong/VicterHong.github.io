/**
 * WebAuthn (passkey) — verifikasi registrasi dan autentikasi.
 *
 * ── MODEL ANCAMAN ────────────────────────────────────────────────────────────
 * Verifikasi WebAuthn bukan formalitas. Kalau server hanya mempercayai apa
 * yang dikirim klien, siapa pun bisa mengirim JSON berisi "credentialId
 * milik korban" dan masuk sebagai korban. Yang membuat passkey aman adalah
 * server MEMERIKSA ULANG:
 *
 *   1. `challenge` yang kita terbitkan — sekali pakai, tidak bisa ditebak.
 *      Tanpa ini, penyerang bisa memutar ulang respons lama (replay).
 *   2. `origin` — hanya origin kita yang boleh. Tanpa ini, situs penyerang
 *      bisa memicu autentikasi ke domain kita.
 *   3. `rpIdHash` — SHA256 dari rpId kita, ada DI DALAM data yang
 *      ditandatangani authenticator. Ini yang mengikat kredensial ke domain.
 *   4. Tanda tangan atas (authenticatorData || SHA256(clientDataJSON))
 *      memakai kunci publik yang tersimpan saat registrasi.
 *
 * Pemeriksaan 1-3 dilakukan di sini; nomor 4 memakai kunci publik dari
 * database, jadi fungsi verifikasi menerimanya sebagai argumen.
 *
 * ── YANG TIDAK DIPERIKSA: ATTESTATION ────────────────────────────────────────
 * Kami tidak memverifikasi attestation statement (bukti merek authenticator).
 * Itu sesuai anjuran FIDO Alliance untuk layanan konsumen: attestation
 * berguna kalau Anda membatasi authenticator tertentu (misalnya hanya kunci
 * hardware bersertifikat FIPS), dan memeriksanya untuk semua pengguna
 * menambah kompleksitas serta mematahkan passkey lintas perangkat.
 *
 * ── YANG DIPERIKSA DARI ATTESTATION OBJECT ───────────────────────────────────
 * Kita tetap HARUS membaca attestationObject, karena di dalamnya ada
 * authData yang memuat kunci publik dan credential ID. Yang tidak dilakukan
 * hanyalah memeriksa `attStmt` (tanda tangan attestation).
 */

import { createHash, createPublicKey, verify as verifKripto, randomBytes } from 'node:crypto';
import { decode as decodeCbor } from './cbor.mjs';

// ── Konstanta protokol ────────────────────────────────────────────────────────

/** Flag byte di authData (WebAuthn §6.1). */
const FLAG_UP = 0x01; // User Present
const FLAG_UV = 0x04; // User Verified
const FLAG_AT = 0x40; // Attested credential data included
const FLAG_ED = 0x80; // Extension data included

const AAGUID_LEN = 16;
const SHA256_LEN = 32;

// ── Challenge ─────────────────────────────────────────────────────────────────

/**
 * Terbitkan challenge baru.
 *
 * 32 byte acak — jauh di atas minimum 16 byte di spesifikasi. Challenge
 * disimpan server dengan masa berlaku pendek dan dihapus setelah dipakai,
 * jadi tidak bisa diputar ulang.
 */
export function challengeBaru() {
  return randomBytes(32).toString('base64url');
}

export function hashChallenge(challenge) {
  return createHash('sha256').update(challenge).digest('hex');
}

// ── Parsing struktur ──────────────────────────────────────────────────────────

/**
 * Baca authenticatorData.
 *
 * Layout (WebAuthn §6.1):
 *   rpIdHash      32 byte
 *   flags          1 byte
 *   signCount      4 byte (big endian)
 *   [attestedCredentialData]  — hanya kalau flag AT
 *   [extensionData]           — hanya kalau flag ED (tidak kami baca)
 */
export function bacaAuthData(buf) {
  if (buf.length < SHA256_LEN + 1 + 4) {
    throw new Error('authData terlalu pendek');
  }

  const rpIdHash = buf.subarray(0, SHA256_LEN);
  const flags = buf[SHA256_LEN];
  const signCount = buf.readUInt32BE(SHA256_LEN + 1);

  let pos = SHA256_LEN + 1 + 4;
  let credentialId = null;
  let coseKey = null;

  if (flags & FLAG_AT) {
    if (pos + AAGUID_LEN + 2 > buf.length) {
      throw new Error('authData: attested credential data terpotong');
    }
    pos += AAGUID_LEN; // aaguid dilewati — tidak dipakai

    const idLen = buf.readUInt16BE(pos);
    pos += 2;

    if (pos + idLen > buf.length) throw new Error('authData: credential id terpotong');
    credentialId = buf.subarray(pos, pos + idLen);
    pos += idLen;

    // Sisa buffer adalah COSE public key (CBOR). Decoder mengembalikan
    // offset akhir; kita tidak butuh sisanya (extension data diabaikan).
    const hasil = decodeCbor(buf.subarray(pos));
    coseKey = hasil;
  }

  return { rpIdHash, flags, signCount, credentialId, coseKey };
}

/**
 * Ubah COSE public key menjadi KeyObject Node.
 *
 * COSE (RFC 8152) memakai label integer, bukan nama seperti JWK. Pemetaan
 * yang didukung sengaja hanya dua algoritma yang benar-benar dikirim
 * authenticator modern:
 *
 *   ES256 (-7)  : ECDSA P-256 — semua passkey platform (Touch ID, Windows
 *                 Hello, Google Password Manager) memakai ini
 *   RS256 (-257): RSA — authenticator lama dan beberapa kunci hardware
 *
 * Algoritma lain ditolak, bukan ditebak. Menerima algoritma yang tidak
 * dipahami berarti menerima tanda tangan yang tidak bisa kita periksa.
 */
export function coseKeKunci(coseKey) {
  if (!(coseKey instanceof Map)) throw new Error('COSE: bukan map');

  const kty = coseKey.get(1);
  const alg = coseKey.get(3);

  if (kty === 2 && alg === -7) {
    // EC2: -1 crv, -2 x, -3 y
    const crv = coseKey.get(-1);
    if (crv !== 1) throw new Error(`COSE: kurva ${crv} tidak didukung (hanya P-256)`);

    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error('COSE: koordinat tidak ada');

    return {
      alg: 'ES256',
      kunci: createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') },
        format: 'jwk',
      }),
    };
  }

  if (kty === 3 && alg === -257) {
    // RSA: -1 n, -2 e
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error('COSE: modulus/eksponen tidak ada');

    return {
      alg: 'RS256',
      kunci: createPublicKey({
        key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') },
        format: 'jwk',
      }),
    };
  }

  throw new Error(`COSE: kty ${kty} / alg ${alg} tidak didukung`);
}

// ── Pemeriksaan bersama ───────────────────────────────────────────────────────

/**
 * Periksa clientDataJSON.
 *
 * clientDataJSON dibuat BROWSER, bukan situs. Isinya:
 *   type      — 'webauthn.create' (registrasi) atau 'webauthn.get' (masuk)
 *   challenge — harus sama dengan yang kita terbitkan
 *   origin    — harus origin kita
 *
 * `origin` diperiksa terhadap daftar yang diizinkan, bukan hanya satu nilai,
 * karena situs ini dilayani dari beberapa host (domain utama, domain
 * preview Cloudflare Pages, dan localhost saat pengembangan). Daftar itu
 * berasal dari config, jadi menambah host berarti mengubah env — bukan
 * melonggarkan pemeriksaan.
 */
export function periksaClientData({
  clientDataJSON, tipeDiharapkan, challengeDiharapkan, originDiizinkan,
}) {
  let data;
  try {
    data = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  } catch {
    throw new Error('clientDataJSON tidak bisa dibaca');
  }

  if (data.type !== tipeDiharapkan) {
    throw new Error(`clientData.type tidak cocok: ${data.type}`);
  }

  if (!data.challenge) throw new Error('clientData.challenge kosong');
  if (data.challenge !== challengeDiharapkan) {
    throw new Error('clientData.challenge tidak cocok');
  }

  const origin = String(data.origin || '').replace(/\/$/, '');
  const daftar = originDiizinkan.map((o) => String(o).replace(/\/$/, ''));
  if (!daftar.includes(origin)) {
    throw new Error(`clientData.origin tidak diizinkan: ${origin}`);
  }

  // crossOrigin hanya boleh true untuk iframe lintas origin. Kita tidak
  // memakai iframe, jadi nilai true berarti ada yang tidak beres.
  if (data.crossOrigin === true) {
    throw new Error('clientData.crossOrigin tidak boleh true');
  }

  return data;
}

/** Periksa rpIdHash terhadap SHA256 dari rpId kita. */
export function periksaRpId(rpIdHash, rpId) {
  const diharapkan = createHash('sha256').update(rpId).digest();
  if (!Buffer.from(rpIdHash).equals(diharapkan)) {
    throw new Error('rpIdHash tidak cocok — kredensial milik domain lain');
  }
}

/** User Present wajib ada di semua alur. */
export function periksaUserPresent(flags) {
  if (!(flags & FLAG_UP)) throw new Error('flag User Present tidak diset');
}

// ── Registrasi ────────────────────────────────────────────────────────────────

/**
 * Verifikasi respons registrasi (navigator.credentials.create).
 *
 * Mengembalikan data yang HARUS disimpan:
 *   { credentialId, kunciPublik (base64url DER), alg, signCount }
 *
 * `credentialId` dan `kunciPublik` diambil dari authData yang berada DI
 * DALAM attestationObject — bukan dari field terpisah yang dikirim klien.
 * Ini penting: nilai yang ditandatangani authenticator adalah yang
 * dipercaya, bukan yang diketik ulang klien.
 */
export function verifikasiRegistrasi({
  attestationObject, clientDataJSON, challenge, originDiizinkan, rpId,
}) {
  let att;
  try {
    att = decodeCbor(Buffer.from(attestationObject, 'base64url'));
  } catch (err) {
    throw new Error(`attestationObject tidak bisa dibaca: ${err.message}`);
  }

  if (!(att instanceof Map) || !att.has('authData')) {
    throw new Error('attestationObject: authData tidak ada');
  }

  const authData = att.get('authData');
  if (!Buffer.isBuffer(authData)) throw new Error('attestationObject: authData bukan byte string');

  const { rpIdHash, flags, signCount, credentialId, coseKey } = bacaAuthData(authData);

  periksaRpId(rpIdHash, rpId);
  periksaUserPresent(flags);

  if (!(flags & FLAG_AT)) {
    throw new Error('authData: tidak memuat kredensial (flag AT tidak diset)');
  }
  if (!credentialId || credentialId.length === 0) {
    throw new Error('credential id kosong');
  }
  if (!coseKey) throw new Error('kunci publik tidak ada di authData');

  periksaClientData({
    clientDataJSON,
    tipeDiharapkan: 'webauthn.create',
    challengeDiharapkan: challenge,
    originDiizinkan,
  });

  const { alg, kunci } = coseKeKunci(coseKey);

  return {
    credentialId: Buffer.from(credentialId).toString('base64url'),
    kunciPublik: kunci.export({ type: 'spki', format: 'der' }).toString('base64url'),
    alg,
    signCount,
  };
}

// ── Autentikasi ───────────────────────────────────────────────────────────────

/**
 * Verifikasi respons autentikasi (navigator.credentials.get).
 *
 * `kunciPublik` berasal dari database — kredensial yang disimpan saat
 * registrasi. Kalau kredensial tidak ditemukan, pemanggil yang memutuskan
 * responsnya; fungsi ini tidak pernah membuat kredensial baru.
 *
 * Mengembalikan { signCountBaru, clone } — `clone` true kalau penghitung
 * tanda tangan tidak naik, yang berarti kemungkinan kredensial disalin.
 */
export function verifikasiAutentikasi({
  authenticatorData, clientDataJSON, signature, kunciPublik, alg,
  challenge, originDiizinkan, rpId, signCountTersimpan = 0,
}) {
  const authData = Buffer.from(authenticatorData, 'base64url');
  const { rpIdHash, flags, signCount } = bacaAuthData(authData);

  periksaRpId(rpIdHash, rpId);
  periksaUserPresent(flags);

  periksaClientData({
    clientDataJSON,
    tipeDiharapkan: 'webauthn.get',
    challengeDiharapkan: challenge,
    originDiizinkan,
  });

  // ── Tanda tangan ───────────────────────────────────────────────────────────
  // Yang ditandatangani: authenticatorData || SHA256(clientDataJSON).
  // clientDataJSON di-hash karena ia dikirim terpisah dari authData; hash
  // mengikat keduanya sehingga tidak bisa ditukar satu sama lain.
  const clientHash = createHash('sha256')
    .update(Buffer.from(clientDataJSON, 'base64url'))
    .digest();

  const pesan = Buffer.concat([authData, clientHash]);
  const sig = Buffer.from(signature, 'base64url');

  const kunci = createPublicKey({
    key: Buffer.from(kunciPublik, 'base64url'),
    format: 'der',
    type: 'spki',
  });

  const opsi = alg === 'ES256'
    ? { key: kunci, dsaEncoding: 'ieee-p1363' } // WebAuthn memakai r||s, bukan DER
    : { key: kunci };

  const hash = alg === 'ES256' ? 'sha256' : 'sha256';
  const sah = verifKripto(hash, pesan, opsi, sig);
  if (!sah) throw new Error('tanda tangan tidak sah');

  // ── Deteksi kredensial tersalin ────────────────────────────────────────────
  // Penghitung harus NAIK setiap autentikasi. Kalau tidak naik, salinan
  // authenticator mungkin dipakai di dua tempat. Ini hanya sinyal, bukan
  // bukti — beberapa authenticator (terutama passkey yang disinkronkan
  // antar perangkat) selalu mengirim 0. Jadi 0 TIDAK dianggap anomali;
  // hanya penurunan dari nilai bukan-nol yang dicurigai.
  const clone = signCountTersimpan > 0 && signCount > 0 && signCount <= signCountTersimpan;

  return { signCountBaru: signCount, clone };
}
