/**
 * Rute autentikasi: OAuth (Google/Microsoft/Apple/GitHub), SSO, dan passkey.
 *
 * ── MENGAPA DIPISAH DARI routes.mjs ──────────────────────────────────────────
 * routes.mjs sudah 3.100 baris. Menambah ~700 baris alur OAuth di dalamnya
 * membuat berkas itu tidak lagi bisa dibaca sekaligus. Berkas ini
 * mengumpulkan semua yang berkaitan dengan cara masuk alternatif, dengan
 * satu pola yang sama untuk setiap provider.
 *
 * ── POLA ALUR (sama untuk semua provider) ────────────────────────────────────
 *
 *   GET /api/auth/:provider          → terbitkan state+PKCE, simpan, alihkan
 *   GET /api/auth/:provider/callback → verifikasi state, tukar code, cari
 *                                       identitas, buat/temukan pengguna,
 *                                       buat sesi, alihkan ke tujuan
 *
 * Perbedaan antar provider diserap oauth.mjs. Di sini alurnya satu.
 *
 * ── KEAMANAN YANG DIPERIKSA DI SETIAP CALLBACK ───────────────────────────────
 *   1. `state` ada di database, belum kedaluwarsa, dan dihapus saat dipakai
 *      → mencegah CSRF dan pemutaran ulang
 *   2. `code_verifier` cocok dengan `code_challenge` yang dikirim tadi
 *      → mencegah penukaran code yang dicuri
 *   3. id_token diverifikasi tanda tangannya terhadap JWKS provider
 *      → mencegah identitas palsu
 *   4. email harus terverifikasi provider sebelum dipakai menyambungkan
 *      ke akun yang sudah ada → mencegah pengambilalihan akun
 */

import { createHash } from 'node:crypto';
import { config } from './config.mjs';
import { getDb } from './db.mjs';
import { sendJson, setCookie, clientIp, clientCountry, readJson, bacaBodyBiner } from './http-util.mjs';
import { createSession, validateSession, destroySession, hashSession } from './sessions.mjs';
// statusTotp: HANYA untuk membaca status 2FA di halaman akun. Alur
// mengaktifkan 2FA tetap di halaman masuk — tidak diduplikasi di sini.
import { statusTotp } from './totp-service.mjs';
import { recordEvent } from './audit.mjs';
import {
  normalEmail, emailValid, cariPengguna, penggunaById, buatPengguna, perbaruiProfil,
  simpanKunciAvatar, kunciAvatarPengguna,
} from './users.mjs';
// Foto profil: validasi → proses → simpan ke R2. Dipisah dari media galeri
// karena aturannya berbeda (potong persegi, batas 4 MB, satu berkas per
// pengguna) — tapi keduanya berbagi klien R2 yang sama dari media.mjs.
import {
  avatarAktif, MAX_AVATAR_BYTES, simpanAvatar, hapusAvatar, ambilAvatar,
} from './avatar.mjs';
import { issueToken, tokenProblem } from './tokens.mjs';
import { checkRateLimit } from './rate-limit.mjs';
import {
  urlOtorisasi, tukarCode, ambilIdentitas, providerSiap, providerDikenal, acak,
} from './oauth.mjs';
import {
  simpanStateOauth, pakaiStateOauth, bersihkanStateOauth,
  cariIdentitas, sambungkanIdentitas, identitasPengguna, hapusIdentitas,
  jumlahIdentitas, tandaiDipakai,
  simpanChallenge, pakaiChallenge, bersihkanChallenge,
} from './auth-identities.mjs';
import {
  challengeBaru, hashChallenge, verifikasiRegistrasi, verifikasiAutentikasi,
} from './webauthn.mjs';
import {
  urlOtorisasiSso, tukarCodeSso, verifikasiIdTokenSso, identitasDariKlaimSso,
} from './sso.mjs';

// ── Konstanta ─────────────────────────────────────────────────────────────────

const COOKIE_SESI = 'portfolio_session';

/**
 * Origin yang diizinkan untuk WebAuthn.
 *
 * WebAuthn mengikat kredensial ke domain. Daftar ini harus memuat SEMUA
 * host yang melayani halaman masuk — kalau tidak, pendaftaran passkey
 * gagal dengan pesan yang membingungkan. Daftar berasal dari config
 * (SITE_URL + WEBAUTHN_ORIGINS), bukan ditulis di kode, supaya menambah
 * domain preview tidak perlu mengubah berkas ini.
 */
function originDiizinkan() {
  const daftar = [config.siteUrl];
  if (config.webauthnOrigins) {
    for (const o of String(config.webauthnOrigins).split(',')) {
      const bersih = o.trim();
      if (bersih) daftar.push(bersih);
    }
  }
  // Pengembangan lokal: origin selalu diizinkan di non-produksi.
  if (process.env.NODE_ENV !== 'production') {
    daftar.push('http://127.0.0.1:8899', 'http://localhost:8899');
    daftar.push('http://127.0.0.1:8788', 'http://localhost:8788');
  }
  return [...new Set(daftar.map((o) => o.replace(/\/$/, '')))];
}

/** rpId = hostname tanpa skema. WebAuthn memakai ini, bukan URL penuh. */
function rpId() {
  try {
    return new URL(config.siteUrl).hostname;
  } catch {
    return 'localhost';
  }
}

/** URL callback yang harus terdaftar PERSIS di konsol provider. */
function redirectUri(provider) {
  return `${config.siteUrl.replace(/\/$/, '')}/api/auth/${provider}/callback`;
}

// ── Helper respons ────────────────────────────────────────────────────────────

/**
 * Alihkan pengguna ke halaman masuk dengan pesan galat.
 *
 * Galat OAuth selalu berakhir sebagai pengalihan, bukan JSON: pengguna
 * sedang berada di browser dan baru kembali dari situs provider. Halaman
 * JSON mentah di situ terasa seperti situs rusak.
 *
 * Kode galat diterjemahkan di halaman masuk menjadi kalimat yang bisa
 * ditindaklanjuti. Pesan asli TIDAK diteruskan ke URL — URL terlihat,
 * tersimpan di riwayat, dan bisa dibagikan; membocorkan detail internal
 * lewat sana tidak ada gunanya bagi pengguna.
 */
function gagalKe(res, tujuan, kode) {
  const base = String(tujuan || '/sign-in').startsWith('/') ? tujuan : '/sign-in';
  const pemisah = base.includes('?') ? '&' : '?';
  res.writeHead(302, { Location: `${base}${pemisah}galat=${encodeURIComponent(kode)}` });
  res.end();
}

/** Alihkan ke tujuan setelah berhasil. */
function alihkanKe(res, tujuan) {
  const aman = tujuanAman(tujuan);
  res.writeHead(302, { Location: aman });
  res.end();
}

/**
 * Hanya izinkan path internal.
 *
 * Menerima `?lanjut=https://situs-penyerang.com` berarti kita menjadi
 * open redirector: tautan kita sendiri yang membawa pengguna ke situs
 * penyerang, dengan nama domain kita sebagai jaminan. Karena itu hanya
 * path yang diawali '/' tunggal yang diterima — '//host' ditolak karena
 * browser memperlakukannya sebagai URL absolut.
 */
function tujuanAman(nilai) {
  const s = String(nilai || '/');
  if (!s.startsWith('/')) return '/';
  if (s.startsWith('//')) return '/';
  if (s.includes('\\')) return '/';
  return s.slice(0, 200);
}

// ── Sesi ──────────────────────────────────────────────────────────────────────

/**
 * Buat sesi untuk pengguna, set cookie, dan kembalikan data untuk respons.
 *
 * ── KENAPA TOKEN AKSES IKUT DIBUAT DI SINI ───────────────────────────────────
 * Arsitektur situs ini memisahkan IDENTITAS (tabel `users`) dari AKSES
 * (tabel `tokens` — token proyek berformat 'VP-XXXX-...'). Sesi menempel
 * pada token, bukan pada pengguna. Jadi pengguna yang masuk lewat OAuth
 * tetap perlu token; kalau belum punya, dibuatkan otomatis.
 *
 * Token yang dibuat di sini memakai tier 'standard' dan proyek default,
 * sama seperti pendaftaran mandiri — bukan jalur istimewa.
 */
function buatSesiUntuk(res, req, pengguna, { tujuan = '/' } = {}) {
  let tokenRow = getDb()
    .prepare('SELECT * FROM tokens WHERE id = ?')
    .get(pengguna.token_id);

  if (!tokenRow) {
    // Pengguna ada tapi tokennya hilang (misalnya token dicabut admin).
    // Buat token baru supaya akunnya tetap bisa dipakai — mencabut token
    // akses proyek bukan berarti mencabut akun.
    const diterbitkan = issueToken({
      secret: config.secret,
      projectSlug: String(config.defaultProject || 'mina'),
      label: pengguna.nama || pengguna.email,
      issuedTo: pengguna.email,
      company: pengguna.perusahaan || '',
      issuedBy: 'oauth',
      tier: 'standard',
      notes: 'Dibuat otomatis saat masuk lewat penyedia identitas.',
    });

    getDb()
      .prepare('UPDATE users SET token_id = ? WHERE id = ?')
      .run(diterbitkan.id, pengguna.id);

    tokenRow = getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(diterbitkan.id);
  }

  const sesi = createSession({
    tokenId: tokenRow.id,
    secret: config.secret,
    deviceFp: '',
    ip: clientIp(req),
    country: clientCountry(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    durationHours: config.sessionDurationHours,
    maxDevices: tokenRow.max_devices ?? config.maxDevices,
  });

  setCookie(res, COOKIE_SESI, sesi.id, {
    maxAgeSeconds: config.sessionDurationHours * 3600,
    httpOnly: true, secure: true, sameSite: 'Lax',
  });

  return { tokenRow, sesi, tujuan: tujuanAman(tujuan) };
}

// ── Mencari atau membuat pengguna ─────────────────────────────────────────────

/**
 * Temukan pengguna dari identitas OAuth, atau buat baru.
 *
 * ── ATURAN PENYAMBUNGAN KE AKUN YANG SUDAH ADA ───────────────────────────────
 * Kalau email sudah terdaftar sebagai pengguna lokal, identitas OAuth
 * DISAMBUNGKAN ke akun itu — TAPI hanya kalau provider menyatakan email
 * terverifikasi.
 *
 * Alasannya: kalau email tidak terverifikasi, penyerang bisa mendaftar di
 * provider dengan mengetik email korban (banyak provider mengizinkan ini
 * sebelum verifikasi), lalu masuk ke akun korban. Mempercayai email yang
 * belum diverifikasi berarti memberi kunci rumah ke siapa pun yang bisa
 * menulis alamat rumah di amplop.
 *
 * GitHub selalu memberi email terverifikasi lewat /user/emails. Google dan
 * Microsoft menandai email_verified. Apple selalu terverifikasi.
 *
 * Mengembalikan { pengguna, dibuat: bool, disambungkan: bool }.
 */
async function temukanAtauBuatPengguna({ identitas, provider, req }) {
  // ── 1. Identitas ini sudah pernah dipakai masuk? ───────────────────────────
  const sudahAda = cariIdentitas(provider, identitas.providerUserId);
  if (sudahAda) {
    const pengguna = penggunaById(sudahAda.user_id);
    if (pengguna) {
      tandaiDipakai(sudahAda.id);
      // Perbarui nama/avatar kalau berubah di provider.
      getDb().prepare(`
        UPDATE auth_identities SET email = ?, nama = ?, avatar = ? WHERE id = ?
      `).run(
        String(identitas.email || '').slice(0, 320),
        String(identitas.nama || '').slice(0, 200),
        String(identitas.avatar || '').slice(0, 500),
        sudahAda.id,
      );
      return { pengguna, dibuat: false, disambungkan: false };
    }
    // Baris identitas menunjuk pengguna yang sudah tidak ada — bersihkan
    // supaya tidak menghalangi pembuatan akun baru dengan identitas sama.
    getDb().prepare('DELETE FROM auth_identities WHERE id = ?').run(sudahAda.id);
  }

  const email = normalEmail(identitas.email || '');

  // ── 2. Email terverifikasi dan sudah terdaftar? Sambungkan. ────────────────
  if (email && identitas.emailTerverifikasi) {
    const pengguna = cariPengguna(email);
    if (pengguna) {
      sambungkanIdentitas({
        userId: pengguna.id,
        jenis: 'oauth', provider,
        providerUserId: identitas.providerUserId,
        email, nama: identitas.nama, avatar: identitas.avatar,
      });
      recordEvent({
        projectSlug: '', action: 'auth_oauth_sambung', outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        detail: `${provider} → akun ${pengguna.id}`,
      });
      return { pengguna, dibuat: false, disambungkan: true };
    }
  }

  // ── 3. Email terverifikasi tapi BELUM terdaftar? Buat akun. ────────────────
  //
  // Kalau email TIDAK terverifikasi, kita tidak boleh memakai email itu
  // sebagai kunci akun: pengguna lain bisa mendaftar di provider dengan
  // email yang sama dan masuk ke akun ini. Dalam hal itu, akun dibuat
  // dengan email kosong (akun "tanpa email") dan hanya bisa dimasuki lewat
  // provider yang sama.
  const emailUntukAkun = email && identitas.emailTerverifikasi ? email : '';

  if (!emailUntukAkun) {
    // Tanpa email, kita tidak bisa memakai jalur pendaftaran biasa (yang
    // mewajibkan email unik). Buat pengguna dengan email sintetis yang
    // tidak bisa ditebak dan ditandai supaya jelas asalnya.
    const sintetis = `${provider}+${identitas.providerUserId}@oauth.invalid`;
    const diterbitkan = issueToken({
      secret: config.secret,
      projectSlug: String(config.defaultProject || 'mina'),
      label: identitas.nama || provider,
      issuedTo: sintetis,
      issuedBy: 'oauth',
      tier: 'standard',
      notes: `Dibuat otomatis dari ${provider} (email provider tidak terverifikasi).`,
    });

    const dibuat = await buatPengguna({
      email: sintetis,
      nama: identitas.nama || provider,
      perusahaan: '',
      sandi: acak(32), // sandi acak: tidak ada yang tahu, jadi tidak bisa dipakai masuk
      tokenId: diterbitkan.id,
    });

    sambungkanIdentitas({
      userId: dibuat.id,
      jenis: 'oauth', provider,
      providerUserId: identitas.providerUserId,
      email: '', nama: identitas.nama, avatar: identitas.avatar,
    });

    return { pengguna: penggunaById(dibuat.id), dibuat: true, disambungkan: false };
  }

  const diterbitkan = issueToken({
    secret: config.secret,
    projectSlug: String(config.defaultProject || 'mina'),
    label: identitas.nama || email,
    issuedTo: email,
    issuedBy: 'oauth',
    tier: 'standard',
    notes: `Dibuat otomatis dari ${provider}.`,
  });

  const dibuat = await buatPengguna({
    email: emailUntukAkun,
    nama: identitas.nama || email.split('@')[0],
    perusahaan: '',
    sandi: acak(32),
    tokenId: diterbitkan.id,
  });

  sambungkanIdentitas({
    userId: dibuat.id,
    jenis: 'oauth', provider,
    providerUserId: identitas.providerUserId,
    email: emailUntukAkun, nama: identitas.nama, avatar: identitas.avatar,
  });

  recordEvent({
    projectSlug: diterbitkan.project_slug, action: 'auth_oauth_daftar', outcome: 'ok',
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    detail: provider,
  });

  return { pengguna: penggunaById(dibuat.id), dibuat: true, disambungkan: false };
}

// ── Rute ──────────────────────────────────────────────────────────────────────

/**
 * Rute publik (tanpa sesi) untuk memulai alur OAuth.
 *
 * `GET /api/auth/google`, `/api/auth/microsoft`, `/api/auth/apple`,
 * `/api/auth/github`, dan `/api/auth/sso`.
 */
function ruteMulai(provider) {
  return {
    method: 'GET',
    pattern: `/api/auth/${provider}`,
    handler: async (req, res, params, url) => {
      // Rate limit: alur ini memanggil API provider, jadi penyalahgunaan
      // membebani pihak ketiga dan bisa membuat aplikasi kita dibatasi.
      const batas = checkRateLimit(`oauth:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
      if (!batas.allowed) return gagalKe(res, '/sign-in', 'terlalu_banyak');

      if (!providerDikenal(provider)) {
        return gagalKe(res, '/sign-in', 'provider_tidak_dikenal');
      }
      if (!providerSiap(provider, config)) {
        // Tombol seharusnya tidak muncul kalau belum siap (lihat /api/config),
        // tapi permintaan langsung ke URL tetap mungkin. Balas dengan
        // pengalihan yang jelas, bukan 404.
        return gagalKe(res, '/sign-in', 'provider_belum_aktif');
      }

      bersihkanStateOauth();

      const state = acak(32);
      const kembaliKe = tujuanAman(url?.searchParams?.get('lanjut') ?? '/');

      const { url: urlAuth, codeVerifier } = urlOtorisasi({
        provider, config, redirectUri: redirectUri(provider), state,
      });

      simpanStateOauth({ state, provider, codeVerifier, kembaliKe });

      res.writeHead(302, { Location: urlAuth });
      res.end();
    },
  };
}

/**
 * Callback OAuth.
 *
 * Menerima GET (query string) DAN POST (form_post). Apple memakai
 * response_mode=form_post dan mengirim hasilnya sebagai POST — kalau
 * callback hanya menangani GET, login Apple selalu gagal.
 */
function ruteCallback(provider) {
  const tangani = async (req, res, params, url, dataForm) => {
    const ambil = (nama) => dataForm?.get(nama) ?? url?.searchParams?.get(nama) ?? null;

    // Pengguna menolak di halaman provider.
    const galatProvider = ambil('error');
    if (galatProvider) {
      return gagalKe(res, '/sign-in', 'ditolak_pengguna');
    }

    const state = ambil('state');
    const code = ambil('code');

    if (!state || !code) return gagalKe(res, '/sign-in', 'callback_tidak_lengkap');

    // ── State: ada, belum kedaluwarsa, dan dihapus sekarang ─────────────────
    const stateRow = pakaiStateOauth(state);
    if (!stateRow) return gagalKe(res, '/sign-in', 'state_tidak_sah');
    if (stateRow.provider !== provider) return gagalKe(res, '/sign-in', 'provider_tidak_cocok');

    const kembaliKe = tujuanAman(stateRow.kembali_ke);

    // ── Tukar code → token ──────────────────────────────────────────────────
    let token;
    try {
      token = await tukarCode({
        provider, config, code,
        codeVerifier: stateRow.code_verifier,
        redirectUri: redirectUri(provider),
      });
    } catch (err) {
      console.error(`[auth] tukar code ${provider} gagal:`, err.message);
      return gagalKe(res, '/sign-in', 'tukar_code_gagal');
    }

    // ── Ambil identitas (tanda tangan id_token diverifikasi di dalam) ───────
    let identitas;
    try {
      identitas = await ambilIdentitas({
        provider, config, token,
        idTokenDariForm: ambil('id_token') || '',
      });
    } catch (err) {
      console.error(`[auth] identitas ${provider} gagal:`, err.message);
      return gagalKe(res, '/sign-in', 'identitas_gagal');
    }

    if (!identitas.providerUserId) {
      return gagalKe(res, '/sign-in', 'identitas_kosong');
    }

    // ── Temukan / buat pengguna ─────────────────────────────────────────────
    let hasil;
    try {
      hasil = await temukanAtauBuatPengguna({ identitas, provider, req });
    } catch (err) {
      console.error(`[auth] pengguna ${provider} gagal:`, err.message);
      return gagalKe(res, '/sign-in', 'akun_gagal');
    }

    if (!hasil.pengguna) return gagalKe(res, '/sign-in', 'akun_tidak_ditemukan');

    // ── Sesi + cookie ───────────────────────────────────────────────────────
    const { tujuan } = buatSesiUntuk(res, req, hasil.pengguna, { tujuan: kembaliKe });

    recordEvent({
      projectSlug: '', action: 'auth_oauth_masuk',
      outcome: hasil.dibuat ? 'akun_baru' : 'ok',
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      detail: provider,
    });

    alihkanKe(res, tujuan);
  };

  return [
    {
      method: 'GET',
      pattern: `/api/auth/${provider}/callback`,
      handler: (req, res, params, url) => tangani(req, res, params, url, null),
    },
    {
      // Apple memakai form_post. Handler ini membaca body form dan
      // meneruskannya ke alur yang sama — supaya logikanya tidak digandakan.
      method: 'POST',
      pattern: `/api/auth/${provider}/callback`,
      handler: async (req, res, params, url) => {
        const form = await bacaFormUrlEncoded(req);
        return tangani(req, res, params, url, form);
      },
    },
  ];
}

/** Baca body application/x-www-form-urlencoded (untuk form_post Apple). */
async function bacaFormUrlEncoded(req) {
  const teks = await new Promise((resolve, reject) => {
    let data = '';
    let ukuran = 0;
    req.on('data', (potongan) => {
      ukuran += potongan.length;
      // Batas 64 KB: respons provider selalu kecil. Tanpa batas, body
      // raksasa bisa menghabiskan memori proses.
      if (ukuran > 65_536) {
        reject(new Error('body terlalu besar'));
        req.destroy();
        return;
      }
      data += potongan;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  return new URLSearchParams(teks);
}

// ── Passkey ───────────────────────────────────────────────────────────────────

/**
 * Mulai registrasi passkey.
 *
 * Pengguna HARUS sudah masuk (punya sesi) — passkey disambungkan ke akun
 * yang sudah ada, bukan membuat akun baru. Tanpa pemeriksaan ini, siapa pun
 * bisa mendaftarkan passkey ke akun mana pun.
 */
const rutePasskeyRegistrasiMulai = {
  method: 'POST',
  pattern: '/api/auth/passkey/registrasi/mulai',
  handler: async (req, res) => {
    const batas = checkRateLimit(`pk-reg:${clientIp(req)}`, { limit: 10, windowMs: 60_000 });
    if (!batas.allowed) {
      return sendJson(res, 429, { ok: false, error: 'terlalu_banyak', message: 'Terlalu banyak percobaan.' });
    }

    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) {
      return sendJson(res, 401, { ok: false, error: 'belum_masuk', message: 'Masuk dulu untuk menambah passkey.' });
    }

    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) {
      return sendJson(res, 401, { ok: false, error: 'belum_masuk', message: 'Sesi tidak sah.' });
    }

    bersihkanChallenge();

    const challenge = challengeBaru();
    simpanChallenge({ id: hashChallenge(challenge), userId: pengguna.id, jenis: 'registrasi' });

    const sudahPunya = identitasPengguna(pengguna.id)
      .filter((i) => i.jenis === 'passkey')
      .map((i) => i.provider_user_id);

    return sendJson(res, 200, {
      ok: true,
      challenge,
      rp: { id: rpId(), name: 'VIVASTIC' },
      user: {
        // id harus byte string; memakai id pengguna langsung berarti
        // pengenal internal bocor ke authenticator. Hash membuat nilainya
        // stabil untuk pengguna yang sama tanpa membocorkan id asli.
        id: Buffer.from(pengguna.id).toString('base64url'),
        name: pengguna.email,
        displayName: pengguna.nama || pengguna.email,
      },
      // excludeCredentials mencegah pengguna mendaftarkan authenticator
      // yang sama dua kali — kalau tidak, ia punya dua entri yang
      // membingungkan dan salah satunya tidak akan pernah dipakai.
      excludeCredentials: sudahPunya.map((id) => ({
        id, type: 'public-key',
      })),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },    // ES256 — semua passkey modern
        { type: 'public-key', alg: -257 },  // RS256 — kunci hardware lama
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 120_000,
      attestation: 'none',
    });
  },
};

/** Selesaikan registrasi: verifikasi attestation, simpan kunci publik. */
const rutePasskeyRegistrasiSelesai = {
  method: 'POST',
  pattern: '/api/auth/passkey/registrasi/selesai',
  handler: async (req, res) => {
    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) {
      return sendJson(res, 401, { ok: false, error: 'belum_masuk', message: 'Sesi tidak sah.' });
    }
    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) {
      return sendJson(res, 401, { ok: false, error: 'belum_masuk', message: 'Sesi tidak sah.' });
    }

    const body = await readJson(req);
    const idKredensial = String(body.id ?? '');
    if (!idKredensial) {
      return sendJson(res, 400, { ok: false, error: 'kredensial_kosong', message: 'Data passkey tidak lengkap.' });
    }

    // Challenge diambil dari body, di-hash, lalu dicari. Yang disimpan
    // adalah HASH-nya, jadi challenge mentah tidak pernah ada di database —
    // kalau database bocor, challenge lama tidak bisa dipakai.
    const challengeDikirim = String(body.challenge ?? '');
    if (!challengeDikirim) {
      return sendJson(res, 400, { ok: false, error: 'challenge_kosong', message: 'Challenge tidak ada.' });
    }

    const challengeRow = pakaiChallenge(hashChallenge(challengeDikirim));
    if (!challengeRow || challengeRow.jenis !== 'registrasi') {
      return sendJson(res, 400, { ok: false, error: 'challenge_tidak_sah', message: 'Sesi pendaftaran passkey kedaluwarsa. Coba lagi.' });
    }
    if (challengeRow.user_id !== pengguna.id) {
      return sendJson(res, 403, { ok: false, error: 'challenge_milik_orang_lain', message: 'Challenge tidak cocok dengan akun ini.' });
    }

    let hasil;
    try {
      hasil = verifikasiRegistrasi({
        attestationObject: String(body.response?.attestationObject ?? ''),
        clientDataJSON: String(body.response?.clientDataJSON ?? ''),
        challenge: challengeDikirim,
        originDiizinkan: originDiizinkan(),
        rpId: rpId(),
      });
    } catch (err) {
      console.error('[passkey] registrasi gagal:', err.message);
      return sendJson(res, 400, { ok: false, error: 'verifikasi_gagal', message: `Passkey tidak bisa diverifikasi: ${err.message}` });
    }

    // Kredensial yang sama tidak boleh terdaftar dua kali.
    const sudahAda = cariIdentitas('passkey', hasil.credentialId);
    if (sudahAda) {
      return sendJson(res, 409, { ok: false, error: 'sudah_terdaftar', message: 'Passkey ini sudah terdaftar.' });
    }

    sambungkanIdentitas({
      userId: pengguna.id,
      jenis: 'passkey',
      provider: 'passkey',
      providerUserId: hasil.credentialId,
      nama: pengguna.nama,
      kunciPublik: hasil.kunciPublik,
      alg: hasil.alg,
      signCount: hasil.signCount,
      namaPerangkat: String(body.nama_perangkat ?? '').slice(0, 100),
    });

    recordEvent({
      projectSlug: '', action: 'auth_passkey_daftar', outcome: 'ok',
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });

    return sendJson(res, 201, {
      ok: true,
      message: 'Passkey ditambahkan. Mulai sekarang Anda bisa masuk dengan sidik jari atau wajah.',
    });
  },
};

/**
 * Mulai masuk dengan passkey.
 *
 * ── DISCOVERABLE CREDENTIAL ─────────────────────────────────────────────────
 * Kalau `id` kredensial tidak dikirim, kita meminta authenticator memilih
 * sendiri kredensialnya (allowCredentials kosong). Ini yang membuat passkey
 * terasa mulus: pengguna tidak mengetik email, cukup sidik jari, dan browser
 * menawarkan akun yang cocok. Server tidak tahu siapa yang akan masuk sampai
 * respons datang — dan itu memang tujuannya.
 */
const rutePasskeyMasukMulai = {
  method: 'POST',
  pattern: '/api/auth/passkey/masuk/mulai',
  handler: async (req, res) => {
    const batas = checkRateLimit(`pk-masuk:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
    if (!batas.allowed) {
      return sendJson(res, 429, { ok: false, error: 'terlalu_banyak', message: 'Terlalu banyak percobaan.' });
    }

    bersihkanChallenge();

    const body = await readJson(req).catch(() => ({}));
    const idKredensial = String(body?.id ?? '');

    const challenge = challengeBaru();
    // userId dikosongkan: pada titik ini kita belum tahu siapa penggunanya.
    simpanChallenge({ id: hashChallenge(challenge), userId: '', jenis: 'masuk' });

    const opsi = {
      ok: true,
      challenge,
      rpId: rpId(),
      timeout: 120_000,
      userVerification: 'preferred',
      allowCredentials: [],
    };

    if (idKredensial) {
      // Pengguna memilih akun tertentu — batasi ke kredensial itu saja.
      const idn = cariIdentitas('passkey', idKredensial);
      if (idn) opsi.allowCredentials = [{ id: idn.provider_user_id, type: 'public-key' }];
    }

    return sendJson(res, 200, opsi);
  },
};

/**
 * Selesaikan masuk dengan passkey.
 *
 * ── KENAPA KREDENSIAL TIDAK DIPERCAYA DARI KLIEN ─────────────────────────────
 * `id` kredensial yang dikirim klien hanya dipakai untuk MENCARI baris.
 * Yang menentukan keberhasilan adalah tanda tangan yang diverifikasi
 * terhadap kunci publik yang tersimpan di database. Klien bisa mengirim
 * id apa pun; tanpa kunci privat yang cocok, tanda tangannya tidak sah.
 */
const rutePasskeyMasukSelesai = {
  method: 'POST',
  pattern: '/api/auth/passkey/masuk/selesai',
  handler: async (req, res) => {
    const body = await readJson(req);

    const idKredensial = String(body.id ?? '');
    const challengeDikirim = String(body.challenge ?? '');
    if (!idKredensial || !challengeDikirim) {
      return sendJson(res, 400, { ok: false, error: 'data_kurang', message: 'Data passkey tidak lengkap.' });
    }

    const challengeRow = pakaiChallenge(hashChallenge(challengeDikirim));
    if (!challengeRow || challengeRow.jenis !== 'masuk') {
      return sendJson(res, 400, { ok: false, error: 'challenge_tidak_sah', message: 'Sesi masuk kedaluwarsa. Coba lagi.' });
    }

    const idn = cariIdentitas('passkey', idKredensial);
    if (!idn) {
      // Pesan yang sama untuk kredensial tidak dikenal dan tanda tangan
      // salah — supaya tidak bisa dipakai memetakan kredensial mana yang
      // terdaftar.
      return sendJson(res, 401, { ok: false, error: 'passkey_tidak_dikenal', message: 'Passkey tidak dikenali. Masuk dengan cara lain.' });
    }

    let hasil;
    try {
      hasil = verifikasiAutentikasi({
        authenticatorData: String(body.response?.authenticatorData ?? ''),
        clientDataJSON: String(body.response?.clientDataJSON ?? ''),
        signature: String(body.response?.signature ?? ''),
        kunciPublik: idn.kunci_publik,
        alg: idn.alg,
        challenge: challengeDikirim,
        originDiizinkan: originDiizinkan(),
        rpId: rpId(),
        signCountTersimpan: idn.sign_count ?? 0,
      });
    } catch (err) {
      console.error('[passkey] masuk gagal:', err.message);
      recordEvent({
        projectSlug: '', action: 'auth_passkey_masuk', outcome: 'gagal',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        detail: err.message.slice(0, 120),
      });
      return sendJson(res, 401, { ok: false, error: 'verifikasi_gagal', message: 'Passkey tidak bisa diverifikasi.' });
    }

    const pengguna = penggunaById(idn.user_id);
    if (!pengguna) {
      return sendJson(res, 401, { ok: false, error: 'akun_tidak_ada', message: 'Akun tidak ditemukan.' });
    }
    if (pengguna.status !== 'aktif') {
      return sendJson(res, 403, { ok: false, error: 'akun_tidak_aktif', message: 'Akun tidak aktif. Hubungi dukungan.' });
    }

    tandaiDipakai(idn.id, hasil.signCountBaru);

    const { tujuan } = buatSesiUntuk(res, req, pengguna, { tujuan: '/' });

    recordEvent({
      projectSlug: '', action: 'auth_passkey_masuk', outcome: 'ok',
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      detail: hasil.clone ? 'penghitung_tidak_naik' : '',
    });

    return sendJson(res, 200, {
      ok: true,
      redirect: tujuan,
      // Sinyal ke pengguna kalau penghitung tanda tangan tidak naik.
      // Bukan bukti penyalinan, tapi pantas diberitahukan.
      peringatan: hasil.clone
        ? 'Penghitung keamanan passkey tidak bertambah seperti biasanya. Kalau Anda tidak baru saja masuk dari perangkat lain, pertimbangkan mengganti passkey.'
        : '',
    });
  },
};

// ── Daftar cara masuk & pencabutan ────────────────────────────────────────────

/**
 * Siapa yang sedang masuk.
 *
 * Halaman keamanan butuh ini untuk menampilkan email + nama pemilik akun.
 * Tanpa endpoint ini, halaman harus menebak dari data lain — dan menebak
 * identitas di halaman keamanan adalah hal yang buruk.
 *
 * Sengaja TIDAK mengembalikan: password_hash, token_id, atau id internal
 * selain yang perlu. Yang dikirim hanya yang ditampilkan di layar.
 */
const ruteProfil = {
  method: 'GET',
  pattern: '/api/auth/profil',
  handler: async (req, res) => {
    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    return sendJson(res, 200, {
      ok: true,
      email: pengguna.email,
      nama: pengguna.nama || '',
      perusahaan: pengguna.perusahaan || '',
      status: pengguna.status,
      dibuat_at: pengguna.dibuat_at,
      masuk_terakhir: pengguna.masuk_terakhir,
      // Apakah akun ini punya sandi? Dipakai halaman keamanan untuk
      // memutuskan apakah cara masuk terakhir boleh dihapus.
      punya_sandi: Boolean(pengguna.password_hash),
      // ── FOTO PROFIL: URL SIAP PAKAI, ATAU KOSONG ──────────────────────────
      // Yang dikirim URL-nya, bukan kuncinya. Alasannya: frontend tidak perlu
      // tahu bentuk kunci di R2, dan kalau bentuk itu berubah (domain sendiri,
      // CDN di depan, ukuran tambahan) hanya sisi server yang ikut berubah.
      //
      // Kosong berarti belum ada foto unggahan — halaman lalu memakai avatar
      // OAuth atau inisial otomatis. Tiga sumber itu berurutan, bukan
      // saling menggantikan.
      avatar_url: pengguna.avatar_key
        ? `/api/auth/avatar/${encodeURIComponent(String(pengguna.avatar_key).split('/').pop())}`
        : '',
    });
  },
};

/**
 * Perbarui profil — nama dan organisasi.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA POST KE PATH YANG SAMA DENGAN GET /api/auth/profil
 * ══════════════════════════════════════════════════════════════════════════
 *
 * REST murni akan memakai PUT atau PATCH. Tapi router di proyek ini
 * mencocokkan berdasarkan METHOD + PATH — jadi POST ke path yang sama tidak
 * bentrok dengan GET-nya. Path yang sama membuat hubungannya jelas: sumber
 * daya yang sama, hanya berbeda tindakan (baca vs ubah).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA IDENTITAS DIAMBIL DARI SESI, BUKAN DARI BODY
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pengguna hanya boleh mengubah profil MILIKNYA SENDIRI. Tidak ada parameter
 * userId di body — kalau ada, siapa pun bisa mengubah profil orang lain
 * hanya dengan menebak id-nya.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA EMAIL TIDAK BISA DIUBAH DI SINI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Email adalah identitas login dan kunci identitas OAuth. Mengubahnya butuh
 * alur terpisah dengan verifikasi ke alamat BARU — kalau tidak, seseorang
 * yang sempat menguasai sesi bisa memindahkan akun ke alamatnya sendiri, dan
 * pemilik asli kehilangan akses tanpa tahu.
 *
 * Stripe melakukan hal yang sama: email ditampilkan di halaman profil, tapi
 * alur mengubahnya terpisah.
 */
const rutePerbaruiProfil = {
  method: 'POST',
  pattern: '/api/auth/profil',
  handler: async (req, res) => {
    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    const body = await readJson(req).catch(() => ({}));
    const hasil = perbaruiProfil(pengguna.id, {
      nama: body.nama,
      perusahaan: body.perusahaan,
    });

    if (!hasil.ok) {
      return sendJson(res, 400, { ok: false, error: 'validasi_gagal', message: hasil.pesan });
    }

    recordEvent({
      projectSlug: '',
      action: 'profil_diperbarui',
      outcome: 'ok',
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });

    return sendJson(res, 200, {
      ok: true,
      message: 'Profil diperbarui.',
      nama: hasil.nama,
      perusahaan: hasil.perusahaan,
    });
  },
};

const ruteDaftarIdentitas = {
  method: 'GET',
  pattern: '/api/auth/identitas',
  handler: async (req, res) => {
    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });
    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    return sendJson(res, 200, {
      ok: true,
      identitas: identitasPengguna(pengguna.id),
      punya_sandi: Boolean(pengguna.password_hash),
    });
  },
};

/**
 * Cabut satu cara masuk.
 *
 * Menolak kalau itu cara masuk TERAKHIR dan pengguna tidak punya sandi.
 * Tanpa penjagaan ini, pengguna bisa mengunci dirinya sendiri di luar akun
 * — dan pemulihannya harus lewat admin.
 */
const ruteHapusIdentitas = {
  method: 'POST',
  pattern: '/api/auth/identitas/hapus',
  handler: async (req, res) => {
    const tokenRow = sesiDariRequest(req);
    if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });
    const pengguna = penggunaDariToken(tokenRow);
    if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

    const body = await readJson(req);
    const identityId = String(body.id ?? '');
    if (!identityId) return sendJson(res, 400, { ok: false, error: 'id_kosong' });

    const milik = identitasPengguna(pengguna.id);
    const target = milik.find((i) => i.id === identityId);
    if (!target) {
      return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan', message: 'Cara masuk itu tidak ada di akun Anda.' });
    }

    const punyaSandi = Boolean(pengguna.password_hash);
    if (milik.length <= 1 && !punyaSandi) {
      return sendJson(res, 400, {
        ok: false, error: 'cara_masuk_terakhir',
        message: 'Ini satu-satunya cara masuk Anda. Buat sandi dulu sebelum menghapusnya, supaya akun tidak terkunci.',
      });
    }

    hapusIdentitas(pengguna.id, identityId);

    recordEvent({
      projectSlug: '', action: 'auth_identitas_hapus', outcome: 'ok',
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      detail: `${target.jenis}:${target.provider}`,
    });

    return sendJson(res, 200, { ok: true, message: 'Cara masuk dihapus.' });
  },
};

// ── Helper sesi (salinan lokal) ───────────────────────────────────────────────

/**
 * Ambil token dari sesi cookie.
 *
 * Disalin dari routes.mjs karena fungsi di sana tidak diekspor. Duplikasi
 * ini disengaja dan terbatas: hanya membaca cookie + memvalidasi sesi.
 * Alternatifnya mengekspor fungsi internal routes.mjs — itu memperluas
 * permukaan modul yang sudah sangat besar.
 */
/**
 * Pengenal sesi turunan untuk ditampilkan ke pengguna.
 *
 * ── KENAPA BUKAN `sessions.id` ──────────────────────────────────────────────
 * `sessions.id` adalah sha256(secret + session_id) — hash dari nilai yang ada
 * di cookie. Hash tidak bisa dibalik, jadi menampilkannya TIDAK langsung
 * membahayakan. Tapi itu tetap kunci yang dicocokkan langsung oleh
 * `validateSession()` saat login: siapa pun yang punya nilai itu bisa
 * mencoba mengirimnya sebagai cookie. Tidak ada alasan menampilkan kunci
 * yang dipakai untuk masuk.
 *
 * ── KENAPA 8 KARAKTER CUKUP ─────────────────────────────────────────────────
 * Pengenal ini hanya untuk MEMBEDAKAN sesi di daftar, bukan untuk otentikasi.
 * Dua sesi berbeda hampir pasti berbeda 8 karakter pertama — dan kalau
 * kebetulan sama, yang terjadi hanya pengguna mencabut sesi yang salah, lalu
 * sadar dan mencabut yang benar. Risikonya kecil dan bisa dipulihkan.
 */
function pengenalSesi(idHash) {
  return createHash('sha256').update('tampil:' + String(idHash)).digest('hex').slice(0, 8);
}

function sesiDariRequest(req) {
  const cookies = parseCookiesLokal(req);
  const sessionId = cookies[COOKIE_SESI] ?? '';
  if (!sessionId) return null;

  const hasil = validateSession(sessionId, config.secret);
  if (!hasil) return null;

  const problem = tokenProblem(hasil.tokenRow);
  if (problem) return null;

  return hasil.tokenRow;
}

function parseCookiesLokal(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const hasil = {};
  for (const bagian of String(header).split(';')) {
    const idx = bagian.indexOf('=');
    if (idx < 0) continue;
    const nama = bagian.slice(0, idx).trim();
    const nilai = bagian.slice(idx + 1).trim();
    if (!nama) continue;
    try {
      hasil[nama] = decodeURIComponent(nilai);
    } catch {
      hasil[nama] = nilai;
    }
  }
  return hasil;
}

/** Pengguna dari baris token. */
/**
 * Ubah User-Agent jadi nama perangkat yang bisa dibaca manusia.
 *
 * ── KENAPA TIDAK MENAMPILKAN USER-AGENT MENTAH ─────────────────────────────
 * User-Agent mentah panjangnya 100+ karakter dan isinya teknis:
 * "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
 * Pengguna yang ingin tahu "perangkat mana ini?" tidak bisa menjawabnya
 * dari string itu.
 *
 * Yang dicari: "Chrome di Windows", "Safari di iOS". Dua kata yang menjawab
 * pertanyaan sebenarnya.
 *
 * Kalau tidak dikenali, kembalikan string kosong — lebih baik tidak
 * menampilkan apa pun daripada "Perangkat tidak dikenal" yang tidak membantu.
 */
function namaPerangkat(ua) {
  const s = String(ua || '');
  if (!s) return '';

  // Browser: urutan penting — Edge dan Opera menyamar sebagai Chrome,
  // jadi keduanya harus dicek lebih dulu.
  let browser = '';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  let os = '';
  if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  if (browser && os) return `${browser} di ${os}`;
  return browser || os || '';
}

function penggunaDariToken(tokenRow) {
  if (!tokenRow?.issued_to) return null;
  return cariPengguna(tokenRow.issued_to);
}

// ── Ekspor ────────────────────────────────────────────────────────────────────

export function ruteAuth() {
  return [
    ...['google', 'microsoft', 'apple', 'github', 'linkedin'].flatMap((p) => [
      ruteMulai(p),
      ...ruteCallback(p),
    ]),
    ...ruteSso(),
    rutePasskeyRegistrasiMulai,
    rutePasskeyRegistrasiSelesai,
    rutePasskeyMasukMulai,
    rutePasskeyMasukSelesai,
    ruteProfil,
    rutePerbaruiProfil,
    ruteDaftarIdentitas,
    ruteHapusIdentitas,
  ];
}

/**
 * SSO perusahaan lewat OIDC.
 *
 * ── KENAPA OIDC, BUKAN SAML ─────────────────────────────────────────────────
 * OIDC memakai JWT dan dokumen discovery, sehingga SATU implementasi bekerja
 * untuk Okta, Azure AD (Entra), Google Workspace, Keycloak, Auth0, OneLogin,
 * dan Cloudflare Access. SAML butuh parsing XML dan penanganan per vendor.
 *
 * Untuk klien korporat yang HANYA mendukung SAML, broker (Cloudflare Access,
 * Okta) bisa menjembatani: mereka bicara SAML ke IdP klien, lalu OIDC ke kita.
 * Jadi kode ini tetap bekerja tanpa perubahan.
 *
 * ── ALUR ────────────────────────────────────────────────────────────────────
 *   GET /api/auth/sso          → baca discovery, susun URL, simpan state+nonce
 *   GET /api/auth/sso/callback → verifikasi state, tukar code, verifikasi
 *                                id_token, temukan/buat pengguna, buat sesi
 *
 * Sama seperti provider publik — karena alurnya memang standar. Yang berbeda
 * hanya sumber konfigurasinya (discovery, bukan konstanta di kode).
 */
function ruteSso() {
  /** Apakah SSO dikonfigurasi lengkap? */
  const siap = () => Boolean(config.ssoIssuer && config.ssoClientId);

  /** Domain yang diizinkan, dari config. Kosong = semua boleh. */
  const domainDiizinkan = () => String(config.ssoDomains || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return [
    {
      method: 'GET',
      pattern: '/api/auth/sso',
      handler: async (req, res, params, url) => {
        if (!siap()) return gagalKe(res, '/sign-in', 'sso_belum_aktif');

        const batas = checkRateLimit(`sso:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
        if (!batas.allowed) return gagalKe(res, '/sign-in', 'terlalu_banyak');

        const kembaliKe = tujuanAman(url?.searchParams?.get('lanjut') ?? '/');
        const loginHint = String(url?.searchParams?.get('email') ?? '').slice(0, 200);

        // ── Domain terbatas? Tolak lebih awal ────────────────────────────────
        // Kalau SSO hanya untuk organisasi tertentu dan pengguna memasukkan
        // email dari domain lain, arahkan ke cara masuk biasa — bukan ke IdP
        // yang pasti akan menolaknya.
        const daftarDomain = domainDiizinkan();
        if (daftarDomain.length > 0 && loginHint) {
          const posisiAt = loginHint.lastIndexOf('@');
          const domain = posisiAt > 0 ? loginHint.slice(posisiAt + 1).toLowerCase() : '';
          if (domain && !daftarDomain.includes(domain)) {
            return gagalKe(res, '/sign-in', 'sso_domain_tidak_cocok');
          }
        }

        // ── Susun URL otorisasi dari discovery IdP ───────────────────────────
        let hasil;
        try {
          hasil = await urlOtorisasiSso({
            issuerUrl: config.ssoIssuer,
            clientId: config.ssoClientId,
            redirectUri: redirectUri('sso'),
            loginHint,
          });
        } catch (err) {
          // Kegagalan discovery berarti konfigurasi IdP bermasalah. Pesan
          // lengkap masuk log server (admin perlu tahu IdP mana), pengguna
          // hanya melihat pesan umum.
          console.error('[sso] gagal menyusun URL otorisasi:', err.message);
          return gagalKe(res, '/sign-in', 'sso_idp_tidak_terjangkau');
        }

        // ── Simpan state + verifier + nonce ──────────────────────────────────
        //
        // codeVerifier dan nonce disimpan di kolom yang sudah ada:
        //   code_verifier → kolom code_verifier
        //   nonce         → kolom kembali_ke? TIDAK — itu untuk tujuan.
        //
        // Nonce perlu tempat sendiri. Kita pakai kolom provider dengan nilai
        // gabungan: 'sso:<nonce>'. Kolom provider sudah TEXT dan tidak
        // divalidasi ketat, jadi aman — dan cara ini tidak butuh migrasi
        // skema untuk menambah kolom.
        simpanStateOauth({
          state: hasil.state,
          provider: `sso:${hasil.nonce}`,
          codeVerifier: hasil.codeVerifier,
          kembaliKe,
        });

        res.writeHead(302, { Location: hasil.url });
        res.end();
      },
    },

    {
      method: 'GET',
      pattern: '/api/auth/sso/callback',
      handler: async (req, res, params, url) => {
        if (!siap()) return gagalKe(res, '/sign-in', 'sso_belum_aktif');

        // ── Pengguna menolak di halaman IdP ──────────────────────────────────
        if (url?.searchParams?.get('error')) {
          return gagalKe(res, '/sign-in', 'ditolak_pengguna');
        }

        const state = url?.searchParams?.get('state') ?? '';
        const code = url?.searchParams?.get('code') ?? '';

        if (!state || !code) return gagalKe(res, '/sign-in', 'callback_tidak_lengkap');

        // ── State: ada, belum kedaluwarsa, dihapus sekarang (sekali pakai) ───
        const stateRow = pakaiStateOauth(state);
        if (!stateRow || !String(stateRow.provider).startsWith('sso:')) {
          return gagalKe(res, '/sign-in', 'state_tidak_sah');
        }

        const nonce = String(stateRow.provider).slice(4); // buang 'sso:'
        const kembaliKe = tujuanAman(stateRow.kembali_ke);

        // ── Tukar code → token ───────────────────────────────────────────────
        let token;
        try {
          token = await tukarCodeSso({
            issuerUrl: config.ssoIssuer,
            clientId: config.ssoClientId,
            clientSecret: config.ssoClientSecret,
            code,
            codeVerifier: stateRow.code_verifier,
            redirectUri: redirectUri('sso'),
          });
        } catch (err) {
          console.error('[sso] tukar code gagal:', err.message);
          return gagalKe(res, '/sign-in', 'tukar_code_gagal');
        }

        if (!token.id_token) {
          console.error('[sso] IdP tidak mengirim id_token');
          return gagalKe(res, '/sign-in', 'identitas_gagal');
        }

        // ── Verifikasi id_token (tanda tangan, issuer, audience, nonce) ──────
        let klaim;
        try {
          klaim = await verifikasiIdTokenSso({
            idToken: token.id_token,
            issuerUrl: config.ssoIssuer,
            clientId: config.ssoClientId,
            nonceDiharapkan: nonce,
          });
        } catch (err) {
          console.error('[sso] verifikasi id_token gagal:', err.message);
          return gagalKe(res, '/sign-in', 'identitas_gagal');
        }

        // ── Identitas seragam ────────────────────────────────────────────────
        let identitas;
        try {
          identitas = identitasDariKlaimSso(klaim);
        } catch (err) {
          console.error('[sso] klaim tidak lengkap:', err.message);
          return gagalKe(res, '/sign-in', 'identitas_kosong');
        }

        // ── Domain masih harus cocok (diperiksa ULANG di callback) ───────────
        //
        // Pemeriksaan di /api/auth/sso hanya berlaku kalau pengguna memberi
        // email lewat login_hint. IdP bisa mengembalikan identitas dari domain
        // lain — jadi pemeriksaan yang menentukan ada DI SINI.
        const daftarDomain = domainDiizinkan();
        if (daftarDomain.length > 0) {
          const posisiAt = identitas.email.lastIndexOf('@');
          const domain = posisiAt > 0 ? identitas.email.slice(posisiAt + 1).toLowerCase() : '';
          if (!domain || !daftarDomain.includes(domain)) {
            recordEvent({
              projectSlug: '', action: 'auth_sso_domain_ditolak', outcome: 'ditolak',
              ip: clientIp(req),
              userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
              detail: domain || '(kosong)',
            });
            return gagalKe(res, '/sign-in', 'sso_domain_tidak_cocok');
          }
        }

        // ── Temukan atau buat pengguna ───────────────────────────────────────
        //
        // Memakai fungsi yang sama dengan provider publik: identitas SSO
        // disambungkan ke akun yang sudah ada kalau emailnya cocok dan
        // terverifikasi. Jadi pengguna yang sudah punya akun Google bisa
        // masuk lewat SSO perusahaan dengan akun yang SAMA.
        let hasil;
        try {
          hasil = await temukanAtauBuatPengguna({
            identitas, provider: 'sso', req,
          });
        } catch (err) {
          console.error('[sso] gagal membuat pengguna:', err.message);
          return gagalKe(res, '/sign-in', 'akun_gagal');
        }

        if (!hasil.pengguna) return gagalKe(res, '/sign-in', 'akun_tidak_ditemukan');

        // ── Sesi + cookie ────────────────────────────────────────────────────
        const { tujuan } = buatSesiUntuk(res, req, hasil.pengguna, { tujuan: kembaliKe });

        recordEvent({
          projectSlug: '', action: 'auth_sso_masuk',
          outcome: hasil.dibuat ? 'akun_baru' : 'ok',
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          detail: String(config.ssoLabel || 'oidc').slice(0, 60),
        });

        alihkanKe(res, tujuan);
      },
    },

    // ══ RIWAYAT PEMBELIAN ══════════════════════════════════════════════════════
    //
    // ── KENAPA ENDPOINT BARU, BUKAN PAKAI /api/pesanan/:id ────────────────────
    // /api/pesanan/:id ada, tapi TIDAK berautentikasi — siapa pun yang tahu
    // ID-nya bisa mengambil data pembayaran orang lain. Komentar di endpoint
    // itu sendiri memperingatkan hal ini.
    //
    // Endpoint ini WAJIB punya sesi, dan hanya mengembalikan pembelian yang
    // EMAIL-nya cocok dengan pengguna yang login. Pencocokan di server, bukan
    // di klien — tidak ada ID yang bisa ditebak.
    //
    // ── KENAPA COCOKKAN LEWAT EMAIL, BUKAN user_id ────────────────────────────
    // Tabel `payments` tidak punya kolom user_id: pembelian bisa terjadi
    // SEBELUM akun dibuat (checkout → email token → daftar). Menambah user_id
    // sekarang berarti migrasi, dan pembelian lama tetap kosong.
    //
    // Email adalah kunci yang sudah ada di kedua sisi. Trade-off-nya: kalau
    // pengguna mengganti email, riwayat lama tidak ikut terbawa. Itu lebih
    // baik daripada tidak ada riwayat sama sekali.
    {
      method: 'GET',
      pattern: '/api/auth/pembelian',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        // Email dinormalkan: pembelian bisa dibuat dari form checkout yang
        // tidak menormalkan input, jadi "Budi@Contoh.com" harus cocok dengan
        // "budi@contoh.com".
        const email = String(pengguna.email || '').trim().toLowerCase();
        if (!email) return sendJson(res, 200, { ok: true, pembelian: [] });

        const baris = getDb().prepare(`
          SELECT id, tier, periode, jumlah, status, dibuat_pada, dibayar_pada, kedaluwarsa_pada
          FROM payments
          WHERE LOWER(email) = ?
          ORDER BY dibuat_pada DESC
          LIMIT 50
        `).all(email);

        sendJson(res, 200, {
          ok: true,
          pembelian: baris.map((b) => ({
            id: b.id,
            tier: b.tier,
            periode: b.periode,
            jumlah: b.jumlah,
            status: b.status,
            dibuat_pada: b.dibuat_pada,
            dibayar_pada: b.dibayar_pada,
            kedaluwarsa_pada: b.kedaluwarsa_pada,
          })),
        });
      },
    },


    // ══ SESI AKTIF ═════════════════════════════════════════════════════════════
    // "Di mana saja saya masih masuk?" — pertanyaan keamanan yang jawabannya
    // hanya berguna kalau pengguna bisa MELIHAT dan MENCABUT.
    //
    // `sessions.id` TIDAK ditampilkan: itu kunci untuk masuk, dan menampilkannya
    // berarti bisa bocor lewat screenshot atau ekstensi. Yang ditampilkan hanya
    // data untuk MENGENALI sesi: perangkat, IP, lokasi, waktu.
    {
      method: 'GET',
      pattern: '/api/auth/sesi',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const rows = getDb().prepare(`
          SELECT id, device_fp, ip, country, user_agent, created_at, last_seen, expires_at
          FROM sessions
          WHERE token_id = ? AND expires_at > ?
          ORDER BY last_seen DESC
          LIMIT 20
        `).all(pengguna.token_id, Date.now());

        // ── SESI "SEKARANG" DICARI DENGAN MENCOCOKKAN HASH COOKIE ───────────────
        //
        // Sebelumnya sesi sekarang dikenali dari last_seen TERBARU. Cara itu
        // SALAH dalam dua hal:
        //
        //   1. `last_seen` hanya diperbarui kalau sudah lewat 60 detik (lihat
        //      sessions.mjs) — jadi kalau pengguna membuka dua perangkat dalam
        //      satu menit, keduanya bisa punya last_seen yang sama.
        //   2. last_seen terbaru belum tentu PERANGKAT INI. Membuka sesi di
        //      ponsel, lalu melihat daftar di laptop, akan menandai ponsel
        //      sebagai "perangkat ini".
        //
        // Cara yang benar: hitung hash dari session_id yang ADA DI COOKIE
        // request ini, lalu cari baris yang hash-nya cocok. Itu memang nilai
        // yang disimpan di kolom `id`, jadi pencocokannya langsung.
        const cookies = parseCookiesLokal(req);
        const idSesiIni = cookies[COOKIE_SESI] ?? '';
        const hashSesiIni = idSesiIni ? hashSession(idSesiIni, config.secret) : '';

        sendJson(res, 200, {
          ok: true,
          sesi: rows.map((r) => ({
            // Pengenal pendek untuk tombol cabut — BUKAN kunci masuk.
            pengenal: pengenalSesi(r.id),
            sekarang: Boolean(hashSesiIni) && r.id === hashSesiIni,
            perangkat: namaPerangkat(r.user_agent),
            user_agent: String(r.user_agent || '').slice(0, 160),
            ip: r.ip || '',
            negara: r.country || '',
            dibuat_pada: r.created_at,
            terakhir_aktif: r.last_seen,
            kedaluwarsa_pada: r.expires_at,
          })),
        });
      },
    },

    // ══ CABUT SESI ══════════════════════════════════════════════════════════════
    //
    // ── KENAPA INI HARUS ADA ───────────────────────────────────────────────────
    // Tab Sesi aktif menulis "Cabut yang tidak Anda kenali" — instruksi itu
    // tidak ada artinya tanpa tombolnya. Daftar tanpa kemampuan mencabut
    // membuat pengguna tahu ada penyusup tapi tidak bisa berbuat apa-apa.
    //
    // ── KENAPA PAKAI PENGENAL, BUKAN sessions.id LANGSUNG ─────────────────────
    // `sessions.id` adalah hash yang dipakai `validateSession()` untuk
    // mencocokkan cookie. Nilainya tidak bisa dibalik, tapi tetap kunci yang
    // dicocokkan saat masuk — tidak ada alasan mengirimkannya ke browser.
    //
    // `pengenalSesi()` menurunkan nilai BARU dari hash itu (sha256 dari
    // string berbeda), jadi pengenal tidak bisa dipakai untuk masuk walau
    // bocor. Pencocokan dilakukan di sisi server: pengenal dari klien
    // dihitung ulang dari setiap baris milik pengguna, lalu dibandingkan.
    {
      method: 'POST',
      pattern: '/api/auth/sesi/cabut',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const body = await readJson(req).catch(() => ({}));
        const minta = String(body?.pengenal ?? '').trim();
        if (!minta) {
          return sendJson(res, 400, { ok: false, error: 'pengenal_kosong',
            message: 'Pengenal sesi tidak dikirim.' });
        }

        // ── HANYA SESI MILIK PENGGUNA INI YANG DIPERIKSA ─────────────────────
        // Filter token_id ada di query, BUKAN di kode setelah pengambilan.
        // Jadi tidak ada jalur di mana sesi milik orang lain ikut terbaca —
        // sekalipun pengenalnya ditebak dengan benar.
        const rows = getDb().prepare(
          'SELECT id FROM sessions WHERE token_id = ? AND expires_at > ?'
        ).all(pengguna.token_id, Date.now());

        const cocok = rows.find((r) => pengenalSesi(r.id) === minta);
        if (!cocok) {
          return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan',
            message: 'Sesi itu tidak ada di akun Anda.' });
        }

        // ── JANGAN IZINKAN MENCABUT SESI YANG SEDANG DIPAKAI ─────────────────
        // Kalau diizinkan, pengguna menekan "cabut" pada perangkatnya sendiri
        // dan langsung terlempar keluar tanpa penjelasan. Untuk keluar dari
        // perangkat ini sudah ada tombol "Keluar" — jalurnya beda.
        const cookies = parseCookiesLokal(req);
        const idSesiIni = cookies[COOKIE_SESI] ?? '';
        const hashSesiIni = idSesiIni ? hashSession(idSesiIni, config.secret) : '';
        if (cocok.id === hashSesiIni) {
          return sendJson(res, 400, { ok: false, error: 'sesi_sekarang',
            message: 'Ini perangkat yang sedang Anda pakai. Gunakan tombol Keluar untuk keluar dari perangkat ini.' });
        }

        // ── URUTAN PENTING: CATAT DULU, LALU HAPUS ────────────────────────────
        //
        // Versi pertama menulis `recordEvent({ aksi: ..., hasil: ... })` —
        // nama field yang SALAH. recordEvent() mengharapkan `action` dan
        // `outcome`, jadi keduanya undefined dan SQLite melempar
        // ERR_INVALID_ARG_TYPE.
        //
        // Akibatnya bukan cuma catatan yang hilang: karena penghapusan
        // dilakukan SEBELUM pencatatan, sesi sudah terhapus saat error
        // terjadi — lalu handler melempar 500. Klien diberi tahu "gagal"
        // padahal operasinya berhasil.
        //
        // Dua pelajaran:
        //   1. Nama field harus cocok dengan tanda tangan fungsi.
        //   2. Operasi yang tidak bisa dibatalkan (DELETE) dikerjakan SETELAH
        //      hal-hal yang bisa gagal. Kalau pencatatan gagal, sesi masih
        //      utuh dan pengguna bisa mencoba lagi.
        //
        // Pencatatan tetap dibungkus try/catch: audit adalah efek samping,
        // bukan syarat keberhasilan. Kalau pencatatan gagal, sesi TETAP harus
        // dicabut — mencabut sesi lebih penting daripada mencatatnya.
        try {
          recordEvent({
            tokenId: pengguna.token_id,
            action: 'auth_sesi_cabut',
            outcome: 'ok',
            ip: clientIp(req),
            userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 200),
            country: clientCountry(req),
          });
        } catch { /* pencatatan gagal bukan alasan membatalkan pencabutan */ }

        getDb().prepare('DELETE FROM sessions WHERE id = ?').run(cocok.id);

        sendJson(res, 200, { ok: true, message: 'Sesi dicabut.' });
      },
    },

    // ══ CABUT SEMUA SESI LAIN ═══════════════════════════════════════════════════
    //
    // ── KENAPA INI PERLU ADA SENDIRI ───────────────────────────────────────────
    // Halaman "Sessions" GitHub, Google, dan Stripe semuanya punya satu aksi
    // untuk situasi panik: "saya melihat perangkat yang tidak saya kenali".
    // Mencabut satu per satu berarti pengguna harus menebak mana yang aman —
    // dan justru saat panik, menebak adalah hal terakhir yang ingin dilakukan.
    //
    // ── KENAPA SESI SEKARANG DIKECUALIKAN ──────────────────────────────────────
    // Ini BUKAN "sign out everywhere". Kalau sesi sekarang ikut dicabut,
    // pengguna langsung terlempar keluar dan tidak bisa melihat hasil
    // tindakannya — apakah daftarnya benar-benar bersih. Untuk keluar dari
    // perangkat ini sudah ada tombol Keluar, dan jalurnya berbeda.
    //
    // ── URUTAN: CATAT DULU, LALU HAPUS ─────────────────────────────────────────
    // Pelajaran yang sama dengan cabut-satu: pencatatan bisa gagal, dan kalau
    // DELETE dikerjakan lebih dulu, klien diberi tahu "gagal" padahal sesinya
    // sudah hilang. Pencatatan dibungkus try/catch — audit adalah efek
    // samping, bukan syarat keberhasilan.
    {
      method: 'POST',
      pattern: '/api/auth/sesi/cabut-semua',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        // Sesi sekarang: hash dari cookie request ini, dicocokkan ke kolom id.
        const cookies = parseCookiesLokal(req);
        const idSesiIni = cookies[COOKIE_SESI] ?? '';
        const hashSesiIni = idSesiIni ? hashSession(idSesiIni, config.secret) : '';

        // Filter token_id ada di query — sesi milik orang lain tidak pernah
        // ikut terbaca, sekalipun pengenalnya ditebak.
        const rows = getDb().prepare(
          'SELECT id FROM sessions WHERE token_id = ? AND expires_at > ?'
        ).all(pengguna.token_id, Date.now());

        const korban = rows.filter((r) => r.id !== hashSesiIni);
        if (!korban.length) {
          return sendJson(res, 200, { ok: true, jumlah: 0,
            message: 'Tidak ada perangkat lain yang perlu dicabut.' });
        }

        try {
          recordEvent({
            tokenId: pengguna.token_id,
            action: 'auth_sesi_cabut_semua',
            outcome: 'ok',
            ip: clientIp(req),
            userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 200),
            country: clientCountry(req),
            detail: String(korban.length),
          });
        } catch { /* pencatatan gagal bukan alasan membatalkan pencabutan */ }

        const hapus = getDb().prepare('DELETE FROM sessions WHERE id = ?');
        for (const r of korban) hapus.run(r.id);

        sendJson(res, 200, {
          ok: true,
          jumlah: korban.length,
          message: `${korban.length} perangkat lain dicabut.`,
        });
      },
    },

    // ══ FOTO PROFIL ════════════════════════════════════════════════════════════
    //
    // ── KENAPA UNGGAHAN LEWAT BACKEND, BUKAN LANGSUNG KE R2 DARI BROWSER ──────
    // Cara langsung (presigned URL) memang lebih hemat: berkasnya tidak
    // melewati server. Tapi ia menuntut tiga hal yang belum ada di sini:
    // kredensial R2 yang bisa menulis harus sampai ke browser, kebijakan
    // kedaluwarsa URL harus dikelola, dan tidak ada tempat untuk memvalidasi
    // isi berkas sebelum ia tersimpan.
    //
    // Lewat backend, berkas diperiksa DAN diproses dulu (dipotong persegi,
    // dikonversi WebP, EXIF dihapus). Yang tersimpan di R2 selalu gambar yang
    // sudah bersih — bukan apa pun yang dikirim klien.
    //
    // Batas 4 MB membuat jalur ini aman untuk server Node: satu unggahan
    // ditampung di memori sebentar, lalu dilepas. Rute lain di layanan ini
    // (galeri) memakai pola yang sama dengan batas 8 MB.
    //
    // ── URUTAN: SIMPAN KE R2 DULU, BARU CATAT KUNCI ───────────────────────────
    // Kalau urutannya dibalik dan unggahan gagal, baris pengguna menunjuk ke
    // berkas yang tidak ada — halamannya menampilkan gambar rusak, dan tidak
    // ada cara memperbaikinya selain mengunggah ulang.
    {
      method: 'POST',
      pattern: '/api/auth/avatar',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        if (!avatarAktif()) {
          return sendJson(res, 503, { ok: false, error: 'penyimpanan_belum_siap',
            message: 'Unggahan foto belum dikonfigurasi di server ini.' });
        }

        // ── BATAS LAJU ──────────────────────────────────────────────────────
        // Memproses gambar itu mahal (sharp membaca dan meng-encode ulang).
        // Tanpa batas, satu klien bisa menghabiskan CPU server dengan
        // mengunggah berulang kali. 10 per 5 menit cukup untuk pemakaian
        // wajar — termasuk beberapa kali percobaan karena fotonya terlalu
        // kecil atau formatnya salah.
        const batas = checkRateLimit(`avatar:${pengguna.id}`, { limit: 10, windowMs: 300_000 });
        if (!batas.allowed) {
          return sendJson(res, 429, { ok: false, error: 'terlalu_banyak',
            message: 'Terlalu banyak unggahan. Coba lagi beberapa menit lagi.' });
        }

        let buffer;
        try {
          buffer = await bacaBodyBiner(req, MAX_AVATAR_BYTES);
        } catch (err) {
          return sendJson(res, err.statusCode ?? 400, { ok: false, error: 'unggahan_gagal',
            message: err.message || 'Berkas tidak bisa dibaca.' });
        }

        try {
          const hasil = await simpanAvatar({
            userId: pengguna.id,
            kunciLama: kunciAvatarPengguna(pengguna.id),
            buffer,
            contentType: req.headers['content-type'],
          });

          // Baru SETELAH berkas aman di R2.
          const simpan = simpanKunciAvatar(pengguna.id, hasil.kunci);
          if (!simpan.ok) {
            return sendJson(res, 500, { ok: false, error: 'gagal_simpan',
              message: 'Foto tersimpan tapi profil tidak bisa diperbarui.' });
          }

          try {
            recordEvent({
              action: 'avatar_unggah', outcome: 'ok',
              detail: `${hasil.hasil.bytesWebp} byte (hemat ${hasil.hemat ?? 0}%)`,
              ip: clientIp(req),
            });
          } catch { /* audit tidak boleh menggagalkan unggahan */ }

          return sendJson(res, 200, {
            ok: true,
            message: 'Foto profil diperbarui.',
            kunci: hasil.kunci,
            // URL siap pakai dengan penanda versi — frontend memakainya
            // langsung, dan karena hash-nya ikut, cache lama tidak salah saji.
            url: `/api/auth/avatar/${encodeURIComponent(hasil.kunci.split('/').pop())}`,
            bytes: hasil.hasil.bytesWebp,
            hemat: hasil.hemat ?? 0,
          });
        } catch (err) {
          // Pesan dari validasi/proses sudah ditulis untuk pengguna
          // ("foto terlalu kecil...", "format tidak didukung...") — teruskan
          // apa adanya, jangan ganti dengan pesan generik yang tidak menolong.
          return sendJson(res, err.statusCode ?? 500, {
            ok: false,
            error: 'avatar_gagal',
            message: err.message || 'Foto tidak bisa diproses.',
          });
        }
      },
    },

    {
      method: 'DELETE',
      pattern: '/api/auth/avatar',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const kunci = kunciAvatarPengguna(pengguna.id);
        if (!kunci) {
          return sendJson(res, 200, { ok: true, message: 'Tidak ada foto untuk dihapus.' });
        }

        // ── URUTAN TERBALIK DARI UNGGAH: CATAT DULU, BARU HAPUS BERKAS ──────
        // Kalau berkas dihapus lebih dulu lalu pembaruan database gagal,
        // baris pengguna menunjuk ke berkas yang sudah tidak ada — dan
        // halamannya menampilkan gambar rusak permanen.
        //
        // Dengan urutan ini, kegagalan terburuk adalah berkas yatim di R2:
        // tidak terlihat siapa pun, dan bisa dibersihkan belakangan.
        const simpan = simpanKunciAvatar(pengguna.id, '');
        if (!simpan.ok) {
          return sendJson(res, 500, { ok: false, error: 'gagal_simpan',
            message: 'Profil tidak bisa diperbarui.' });
        }

        try {
          await hapusAvatar(kunci);
        } catch { /* berkas yatim — tidak menghalangi pengguna */ }

        try {
          recordEvent({ action: 'avatar_hapus', outcome: 'ok', ip: clientIp(req) });
        } catch { /* audit tidak boleh menggagalkan operasi */ }

        return sendJson(res, 200, {
          ok: true,
          message: 'Foto profil dihapus. Avatar inisial dipakai kembali.',
        });
      },
    },

    {
      method: 'GET',
      pattern: '/api/auth/avatar/:berkas',
      handler: async (req, res, params) => {
        // ── KENAPA ENDPOINT INI PUBLIK ──────────────────────────────────────
        // Foto profil muncul di halaman publik (daftar kontributor, testimoni)
        // dan di tag <img> — yang TIDAK mengirim cookie lintas origin dengan
        // andal. Menuntut sesi di sini berarti fotonya gagal dimuat di
        // separuh tempat ia dipakai.
        //
        // Yang melindunginya bukan sesi, tapi bentuk kuncinya:
        // `avatar/<id-acak>-<hash>.webp`. ID pengguna adalah 16 byte acak
        // (32 karakter hex) dan hash-nya berasal dari isi gambar. Tanpa
        // mengetahui keduanya, tidak ada cara menebak URL foto seseorang.
        //
        // Nama berkas di URL sengaja HANYA nama berkasnya — bukan path
        // lengkap — supaya tidak ada cara memakai endpoint ini untuk membaca
        // objek lain di bucket (mis. cadangan database).
        const nama = String(params?.berkas ?? '');
        if (!nama || nama.includes('..') || nama.includes('/')) {
          return sendJson(res, 400, { ok: false, error: 'nama_tidak_valid' });
        }

        const kunci = `avatar/${nama}`;
        const obj = await ambilAvatar(kunci).catch(() => null);
        if (!obj) return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });

        // ── CACHE PANJANG, DAN KENAPA AMAN ──────────────────────────────────
        // Nama berkas memuat hash ISI gambar. Mengganti foto menghasilkan
        // nama baru, jadi URL ini tidak akan pernah menyajikan gambar yang
        // salah — cache setahun pun aman. Ini pola content-addressed asset.
        res.writeHead(200, {
          'content-type': obj.contentType || 'image/webp',
          'content-length': obj.buffer.length,
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          // Boleh dipakai lintas origin: foto profil wajar tampil di
          // halaman lain, dan isinya bukan data rahasia.
          'access-control-allow-origin': '*',
        });
        res.end(obj.buffer);
      },
    },

    // ══ TOKEN AKSES ════════════════════════════════════════════════════════════
    // Metadata token milik pengguna (users.token_id): paket, cakupan, masa berlaku.
    //
    // Nilai tokennya TIDAK bisa ditampilkan — disimpan sebagai hash, server
    // sendiri tidak bisa membacanya lagi. Itu memang desainnya.
    {
      method: 'GET',
      pattern: '/api/auth/token-saya',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const t = getDb().prepare(`
          SELECT id, label, project_slug, tier, scopes, issued_to, company,
                 issued_at, expires_at, revoked_at
          FROM tokens WHERE id = ?
        `).get(pengguna.token_id);

        if (!t) return sendJson(res, 200, { ok: true, token: null });

        let scopes = [];
        try { const p = JSON.parse(t.scopes); scopes = Array.isArray(p) ? p : []; }
        catch { scopes = []; }

        const sekarang = Date.now();
        sendJson(res, 200, {
          ok: true,
          token: {
            label: t.label || '',
            proyek: t.project_slug || '',
            tier: t.tier || 'standard',
            scopes,
            perusahaan: t.company || '',
            terbit_pada: t.issued_at,
            kedaluwarsa_pada: t.expires_at,
            dicabut_pada: t.revoked_at,
            // Status dihitung server — klien tidak perlu tahu aturannya.
            status: t.revoked_at ? 'dicabut'
                  : (t.expires_at && t.expires_at < sekarang) ? 'kedaluwarsa'
                  : 'aktif',
          },
        });
      },
    },

    // ══ AKTIVITAS AKUN ═════════════════════════════════════════════════════════
    // Cara pengguna membuktikan kecurigaannya sendiri: "apakah benar ada yang
    // masuk dari negara lain?" GitHub menyebutnya "Security log".
    //
    // Difilter dengan token_id pengguna — tidak ada parameter yang bisa diubah
    // klien untuk melihat aktivitas orang lain.
    {
      method: 'GET',
      pattern: '/api/auth/aktivitas',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const rows = getDb().prepare(`
          SELECT action, outcome, ip, country, detail, at
          FROM access_events
          WHERE token_id = ?
          ORDER BY at DESC, id DESC
          LIMIT 40
        `).all(pengguna.token_id);

        sendJson(res, 200, {
          ok: true,
          aktivitas: rows.map((r) => ({
            aksi: r.action || '',
            hasil: r.outcome || '',
            ip: r.ip || '',
            negara: r.country || '',
            detail: String(r.detail || '').slice(0, 200),
            pada: r.at,
          })),
        });
      },
    },

    // ══ 2FA (TOTP) — HANYA BACA STATUS ═════════════════════════════════════════
    // Mengaktifkan 2FA butuh dua langkah (pindai QR, buktikan kode) dan alur
    // itu SUDAH ADA di halaman masuk. Endpoint ini hanya membaca status supaya
    // tab bisa menampilkan "aktif" — bukan menduplikasi alurnya.
    {
      method: 'GET',
      pattern: '/api/auth/2fa/status',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        // Identitas TOTP memakai email — lihat totp-service.mjs.
        const s = statusTotp(pengguna.email);
        sendJson(res, 200, {
          ok: true,
          aktif: Boolean(s?.aktif),
          terverifikasi: Boolean(s?.terverifikasi),
          dibuat_pada: s?.dibuat_pada ?? null,
          terakhir_dipakai: s?.terakhir_dipakai ?? null,
        });
      },
    },

  ];
}
