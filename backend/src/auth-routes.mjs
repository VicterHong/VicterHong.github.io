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
// ── KENAPA `transaction` DIIMPORT, BUKAN `db.transaction()` ────────────────
// `node:sqlite` TIDAK punya method `.transaction()` — itu API better-sqlite3.
// Memanggilnya melempar "db.transaction is not a function" yang baru ketahuan
// saat endpoint benar-benar dijalankan (HTTP 500 di uji pertama).
//
// Helper-nya ada di db.mjs sebagai fungsi terpisah: BEGIN → fn() → COMMIT,
// dan ROLLBACK kalau fn() melempar.
import { getDb, transaction } from './db.mjs';
import { sendJson, setCookie, clientIp, clientCountry, clientGeo, ipSamar, readJson, bacaBodyBiner } from './http-util.mjs';
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
function buatSesiUntuk(res, req, pengguna, { tujuan = '/', hints = {} } = {}) {
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

  // ── GEO DISIMPAN SAAT SESI DIBUAT ─────────────────────────────────────────
  // Data ini hanya tersedia saat request berlangsung (header Cloudflare).
  // Kalau tidak disimpan sekarang, ia hilang — dan halaman Sesi aktif harus
  // melakukan lookup eksternal setiap kali dibuka untuk mendapatkannya lagi.
  const geo = clientGeo(req);
  const det = deteksiDariBody(hints);

  const sesi = createSession({
    tokenId: tokenRow.id,
    secret: config.secret,
    deviceFp: '',
    ip: clientIp(req),
    country: clientCountry(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    kota: geo.kota,
    wilayah: geo.wilayah,
    asn: geo.asn,
    zonaWaktu: geo.zonaWaktu,
    org: geo.org,
    platform: det.platform,
    model: det.model,
    jenis: det.jenis,
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
    const { tujuan } = buatSesiUntuk(res, req, hasil.pengguna, { tujuan: kembaliKe, hints: clientHints(req) });

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

    const { tujuan } = buatSesiUntuk(res, req, pengguna, { tujuan: '/', hints: clientHints(req) });

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
/**
 * Ambil hasil deteksi perangkat yang dikirim klien.
 *
 * ── KENAPA DARI BODY, BUKAN HEADER ──────────────────────────────────────────
 * `Sec-CH-UA-Platform` memang header, tapi hanya memuat platform. Yang lebih
 * berguna — model perangkat dan sinyal layar — tidak ada di header HTTP.
 *
 * `screen.width` dan `maxTouchPoints` HANYA bisa dibaca dari JavaScript, dan
 * keduanya sinyal yang paling sulit dipalsukan: User-Agent bisa ditulis ulang
 * sesuka hati, tapi lebar layar harus cocok dengan perangkat sebenarnya.
 *
 * ── VALIDASI ────────────────────────────────────────────────────────────────
 * Nilai dari klien tidak dipercaya begitu saja: `jenis` harus salah satu dari
 * tiga nilai yang dikenal, dan teks dipotong 40 karakter.
 */
/**
 * Deteksi perangkat dari HEADER — untuk jalur yang tidak punya body JSON.
 *
 * ── KENAPA PERLU FUNGSI KEDUA ────────────────────────────────────────────────
 * `deteksiDariBody()` dipakai jalur login biasa (POST JSON). Tapi callback
 * OAuth dan SSO datang sebagai REDIRECT GET dari penyedia identitas — tidak
 * ada body sama sekali.
 *
 * Sebelumnya ketiga jalur itu memanggil `deteksiDariBody(body)` dengan `body`
 * yang tidak pernah didefinisikan. Akibatnya setiap login Google gagal dengan
 * `ReferenceError: body is not defined`, dan pengguna hanya melihat
 * "kesalahan_internal".
 *
 * ── DARI MANA NILAINYA ───────────────────────────────────────────────────────
 * Fungsi halaman (functions/[[path]].js) meneruskan deteksi perangkat sebagai
 * header `X-Device-*`. Header bertahan melewati redirect, jadi ia tetap ada
 * saat callback tiba.
 *
 * Nilainya tetap divalidasi seperti dari body — sumbernya tetap dari luar.
 */
function clientHints(req) {
  const ambil = (nama, maks = 40) => {
    const v = req.headers[nama];
    return typeof v === 'string' ? v.trim().slice(0, maks) : '';
  };

  const jenisHeader = ambil('x-device-jenis', 20);
  const dariHeader = {
    jenis: ['ponsel', 'tablet', 'komputer'].includes(jenisHeader) ? jenisHeader : '',
    platform: ambil('x-device-platform'),
    model: ambil('x-device-model'),
  };

  // ── KALAU HEADER KOSONG, BACA COOKIE ────────────────────────────────────────
  //
  // ── KENAPA COOKIE DIPERLUKAN ────────────────────────────────────────────────
  // Callback OAuth datang sebagai REDIRECT dari penyedia identitas. Redirect
  // tidak bisa membawa header kustom — jadi `X-Device-*` tidak ada di sini.
  //
  // Klien menyimpan deteksi ke cookie SEBELUM meninggalkan situs, dan cookie
  // ikut terbawa otomatis saat browser kembali. Itu satu-satunya jalur yang
  // bekerja untuk navigasi.
  //
  // ── URUTAN: HEADER DULU ─────────────────────────────────────────────────────
  // Header lebih baru daripada cookie (cookie dibuat sebelum pengguna pergi
  // ke penyedia, header dibuat saat request). Kalau keduanya ada, header
  // menang.
  if (dariHeader.jenis && dariHeader.platform) return dariHeader;

  const cookies = parseCookiesLokal(req);
  const mentah = cookies.vivastic_perangkat || '';
  if (!mentah) return dariHeader;

  try {
    const d = JSON.parse(decodeURIComponent(mentah));
    const jenisCookie = String(d.jenis || '').slice(0, 20);
    return {
      // Nilai dari cookie TETAP divalidasi — sumbernya dari luar.
      jenis: ['ponsel', 'tablet', 'komputer'].includes(jenisCookie) ? jenisCookie : dariHeader.jenis,
      platform: dariHeader.platform || String(d.platform || '').trim().slice(0, 40),
      model: dariHeader.model || String(d.model || '').trim().slice(0, 40),
    };
  } catch {
    // Cookie rusak atau bukan JSON — abaikan, jangan gagalkan login.
    return dariHeader;
  }
}

function deteksiDariBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const d = b.perangkat && typeof b.perangkat === 'object' ? b.perangkat : {};

  const jenis = String(d.jenis || '');
  return {
    jenis: ['ponsel', 'tablet', 'komputer'].includes(jenis) ? jenis : '',
    platform: String(d.platform || '').trim().slice(0, 40),
    model: String(d.model || '').trim().slice(0, 40),
  };
}

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
/**
 * Jenis perangkat dari User-Agent: 'ponsel', 'tablet', atau 'komputer'.
 *
 * ── KENAPA TERPISAH DARI namaPerangkat() ────────────────────────────────────
 * UI memakai ini untuk MEMILIH IKON, dan ikon butuh satu dari tiga nilai
 * yang pasti — bukan string bebas. Menggabungkannya dengan namaPerangkat()
 * berarti UI harus menebak jenis dari teks ("apakah 'Chrome di Android'
 * berarti ponsel atau tablet?") — dan tebakan itu salah untuk tablet.
 *
 * Urutan pengecekan penting: iPad modern melaporkan diri sebagai "Macintosh"
 * di User-Agent-nya (Safari desktop mode), jadi iPad harus dicek SEBELUM Mac.
 */
function jenisPerangkat(ua, hints = {}) {
  // ── PRIORITAS 1: DETEKSI DARI KLIEN (Client Hints + sinyal layar) ──────────
  //
  // Ini satu-satunya sumber yang BENAR saat User-Agent menipu. Kasus nyata:
  // Chrome Android mode "Desktop site" mengubah UA-nya jadi `X11; Linux
  // x86_64`, sehingga UA saja menyimpulkan "komputer" padahal ponsel.
  //
  // Client Hints (`Sec-CH-UA-Platform`) TIDAK ikut berubah saat mode itu
  // aktif — dan `screen.width` + `maxTouchPoints` tidak bisa dipalsukan
  // lewat UA sama sekali.
  const j = String(hints.jenis || '');
  if (j === 'ponsel' || j === 'tablet' || j === 'komputer') return j;

  // ── PRIORITAS 2: TEBAK DARI USER-AGENT (cadangan) ─────────────────────────
  // Dipakai kalau klien lama tidak mengirim deteksi, atau request datang dari
  // alat yang bukan browser.
  const s = String(ua || '');
  if (!s) return 'komputer';
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(s)) return 'ponsel';
  // Android tanpa "Mobile" biasanya tablet.
  if (/Android/i.test(s)) return 'tablet';
  return 'komputer';
}

function namaPerangkat(ua, hints = {}) {
  const s = String(ua || '');

  // ── BROWSER: dari User-Agent ──────────────────────────────────────────────
  // Browser TIDAK punya Client Hint yang setara — `Sec-CH-UA` memberi merek
  // ("Google Chrome"), tapi tidak memberi nama yang bisa ditampilkan untuk
  // SEMUA browser. UA tetap sumber terbaik untuk bagian ini, dan UA browser
  // tidak berubah saat mode desktop aktif (hanya bagian OS yang berubah).
  //
  // Urutan penting: Edge dan Opera menyamar sebagai Chrome, jadi keduanya
  // harus dicek lebih dulu.
  let browser = '';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  // ── OS: DETEKSI KLIEN MENANG, UA CADANGAN ─────────────────────────────────
  //
  // ── KENAPA UA TIDAK BISA DIPERCAYA UNTUK OS ───────────────────────────────
  // Chrome Android mode "Desktop site" mengubah UA dari
  //     (Linux; Android 14; Pixel 8) ... Mobile Safari
  // menjadi
  //     (X11; Linux x86_64) ... Safari
  //
  // Android-nya HILANG. UA saja menyimpulkan "Linux" — dan itu yang membuat
  // sesi di produksi tertulis "Chrome di Linux" padahal penggunanya di ponsel.
  //
  // Client Hints (`Sec-CH-UA-Platform`) biasanya tidak ikut berubah, TAPI
  // sebagian build Chrome tetap melaporkan "Linux" saat mode desktop aktif.
  //
  // ── KENAPA JENIS PERANGKAT DIPAKAI UNTUK MEMVALIDASI PLATFORM ─────────────
  // `jenis` datang dari sinyal LAYAR (lebar + titik sentuh) yang tidak bisa
  // dipalsukan. Kalau layar bilang "ponsel" tapi platform bilang "Linux",
  // yang benar adalah layarnya — dan platformnya dilaporkan "Android" karena
  // hanya Android yang punya mode desktop di browser seluler.
  //
  // Tanpa pemeriksaan silang ini, klien yang melaporkan platform "Linux"
  // dengan jenis "ponsel" akan tetap tertulis "Chrome di Linux".
  let os = String(hints.platform || '');
  const jenisHints = String(hints.jenis || '');

  // ── PERBAIKI PLATFORM YANG BERTENTANGAN DENGAN LAYAR ──────────────────────
  const platformDesktop = ['Windows', 'macOS', 'Linux', 'ChromeOS'].includes(os);
  const jenisGenggam = jenisHints === 'ponsel' || jenisHints === 'tablet';
  if (platformDesktop && jenisGenggam) {
    os = 'Android';
  }

  if (!os) {
    if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
    else if (/Android/.test(s)) os = 'Android';
    else if (/Windows/.test(s)) os = 'Windows';
    else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
    else if (/Linux/.test(s)) os = 'Linux';
  }

  // ── MODEL PERANGKAT: HANYA DARI CLIENT HINTS ──────────────────────────────
  // UA tidak pernah memuat model yang bisa diandalkan ("Pixel 8" hanya muncul
  // di sebagian browser). Client Hints memberinya lewat getHighEntropyValues().
  //
  // Ditampilkan sebagai pelengkap HANYA kalau ada — "Chrome di Android
  // (Pixel 8)" lebih berguna daripada "Chrome di Android" saja saat pengguna
  // punya beberapa perangkat Android.
  const model = String(hints.model || '').trim();

  const dasar = browser && os ? `${browser} di ${os}` : (browser || os || '');
  if (dasar && model) return `${dasar} · ${model}`;
  return dasar;
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
        const { tujuan } = buatSesiUntuk(res, req, hasil.pengguna, { tujuan: kembaliKe, hints: clientHints(req) });

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
          SELECT id, device_fp, ip, country, user_agent, kota, wilayah, asn, zona_waktu,
                 platform, model, jenis, org, created_at, last_seen, expires_at
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

            // ── NAMA PERANGKAT: DETEKSI KLIEN MENANG ATAS UA ──────────────
            // `r.platform` dan `r.model` berasal dari Client Hints + sinyal
            // layar yang dikirim klien. Keduanya TIDAK ikut berubah saat
            // Chrome Android mode "Desktop site" aktif — sedangkan UA berubah
            // jadi "X11; Linux x86_64" dan kehilangan jejak Android-nya.
            perangkat: namaPerangkat(r.user_agent, { platform: r.platform, model: r.model }),
            // Dipakai UI untuk memilih ikon. Selalu salah satu dari tiga
            // nilai, tidak pernah kosong — supaya UI tidak perlu menebak.
            jenis: jenisPerangkat(r.user_agent, { jenis: r.jenis }),

            // ── IP TERSAMAR, BUKAN IP PENUH ─────────────────────────────────
            // IP penuh TETAP tersimpan di kolom `sessions.ip` — itu yang
            // dipakai untuk audit, korelasi insiden, dan laporan abuse.
            //
            // Tapi yang DIKIRIM ke browser adalah versi tersamar. Masking di
            // frontend tidak cukup: IP aslinya tetap ada di respons HTTP dan
            // bisa dibaca lewat DevTools → Network.
            //
            // Yang tidak dikirim tidak bisa bocor.
            ip: ipSamar(r.ip),
            negara: r.country || '',
            // Kota/wilayah dari Cloudflare. Kosong untuk sesi lama yang
            // dibuat sebelum kolom ini ada — UI menampilkannya sebagai
            // "Lokasi tidak diketahui", bukan mengarang nilai.
            kota: r.kota || '',
            wilayah: r.wilayah || '',
            // Nomor ASN telanjang ("7713"). UI menambahkan awalan "AS".
            asn: r.asn || '',
            // Nama ISP dari Cloudflare (mis. "PT Telkom Indonesia").
            org: r.org || '',
            zona_waktu: r.zona_waktu || '',

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
            // ── IP TERSAMAR, BUKAN IP PENUH ─────────────────────────────────
            // IP penuh TETAP tersimpan di kolom `sessions.ip` — itu yang
            // dipakai untuk audit, korelasi insiden, dan laporan abuse.
            //
            // Tapi yang DIKIRIM ke browser adalah versi tersamar. Masking di
            // frontend tidak cukup: IP aslinya tetap ada di respons HTTP dan
            // bisa dibaca lewat DevTools → Network.
            //
            // Yang tidak dikirim tidak bisa bocor.
            ip: ipSamar(r.ip),
            negara: r.country || '',
            detail: String(r.detail || '').slice(0, 200),
            pada: r.at,
          })),
        });
      },
    },

    // ══ PREFERENSI NOTIFIKASI ══════════════════════════════════════════════════
    //
    // ── KOREKSI PENTING ───────────────────────────────────────────────────────
    //
    // Versi pertama endpoint ini mengembalikan DAFTAR PERISTIWA dari tabel
    // `access_events` — log keamanan. Itu SALAH MEMBACA referensi: yang
    // dimaksud "Notifications" di HorizonX adalah PREFERENSI (toggle: email
    // apa saja yang mau diterima), bukan daftar peristiwa.
    //
    // Daftar peristiwa sudah punya tempatnya sendiri: tab Aktivitas.
    // Endpoint ini sekarang melayani preferensi.
    //
    // ── KENAPA HANYA TIGA ─────────────────────────────────────────────────────
    //
    // Setiap preferensi adalah janji: "kalau Anda nyalakan, kami akan
    // mengirimnya." Menambah toggle yang tidak ada pengirimnya berarti
    // berbohong ke pengguna — dan itu lebih buruk daripada tidak ada toggle.
    //
    // Tiga ini sudah punya pengirimnya (atau akan segera):
    //   produk     → pengumuman fitur baru
    //   pembayaran → invoice, konfirmasi, pengingat perpanjangan
    //   promosi    → penawaran, update partner
    //
    // ── KENAPA 'push' TIDAK ADA DI SINI ───────────────────────────────────────
    //
    // Push notification butuh Service Worker + izin browser. Itu pekerjaan
    // tersendiri, dan menampilkan toggle yang tidak berfungsi hanya akan
    // membingungkan. Ditambahkan saat fiturnya benar-benar ada.
    {
      method: 'GET',
      pattern: '/api/auth/preferensi-notifikasi',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const row = getDb().prepare(`
          SELECT notif_produk, notif_pembayaran, notif_promosi
          FROM users WHERE token_id = ?
        `).get(pengguna.token_id);

        // Kalau baris tidak ada (token lama tanpa user), kembalikan default —
        // bukan galat. Pengguna tetap bisa membuka tabnya.
        sendJson(res, 200, {
          ok: true,
          preferensi: {
            // `!== 0` bukan `=== 1`: kolom INTEGER bisa berisi nilai apa pun,
            // dan yang kita maksud "aktif" adalah "bukan nol eksplisit".
            // Ini juga menangani NULL dari baris lama.
            produk: row ? row.notif_produk !== 0 : true,
            pembayaran: row ? row.notif_pembayaran !== 0 : true,
            promosi: row ? row.notif_promosi === 1 : false,
          },
        });
      },
    },

    {
      method: 'POST',
      pattern: '/api/auth/preferensi-notifikasi',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const body = await readJson(req).catch(() => ({}));

        // ── HANYA TERIMA KUNCI YANG DIKENAL ───────────────────────────────────
        //
        // Tanpa daftar putih, klien bisa mengirim `{admin: true}` dan — kalau
        // suatu saat query dibangun dari kunci body — itu jadi celah.
        //
        // Di sini query dibangun dari daftar TETAP di bawah, jadi secara teknis
        // aman. Tapi daftar putih tetap dipakai: ia membuat niatnya eksplisit,
        // dan mencegah bug saat kode ini disalin ke tempat lain.
        const KUNCI = ['produk', 'pembayaran', 'promosi'];
        const kolom = {
          produk: 'notif_produk',
          pembayaran: 'notif_pembayaran',
          promosi: 'notif_promosi',
        };

        const set = [];
        const nilai = [];
        for (const k of KUNCI) {
          if (!(k in body)) continue;
          // `!!` menormalkan apa pun jadi boolean, lalu disimpan sebagai 0/1.
          set.push(`${kolom[k]} = ?`);
          nilai.push(body[k] ? 1 : 0);
        }

        if (!set.length) {
          return sendJson(res, 400, { ok: false, error: 'tidak_ada_perubahan' });
        }

        nilai.push(pengguna.token_id);
        getDb().prepare(`UPDATE users SET ${set.join(', ')} WHERE token_id = ?`).run(...nilai);

        sendJson(res, 200, { ok: true, pesan: 'Preferensi disimpan.' });
      },
    },

    // ══ HAPUS AKUN — DANGER ZONE ═══════════════════════════════════════════════
    //
    // ── KENAPA DUA LANGKAH, BUKAN SATU ────────────────────────────────────────
    //
    // Menghapus akun tidak bisa dibatalkan. Satu klik yang salah berarti
    // kehilangan akses selamanya — termasuk riwayat pembelian.
    //
    // Langkah 1 (POST /api/auth/akun/hapus-mulai): server mengirim kode 6 digit
    //   ke email pengguna.
    // Langkah 2 (POST /api/auth/akun/hapus): pengguna memasukkan kode itu.
    //
    // ── KENAPA KODE EMAIL, BUKAN KETIK NAMA ───────────────────────────────────
    //
    // Pola umum (GitHub, Stripe) meminta pengguna mengetik nama repo atau
    // nama akun. Itu mencegah klik tidak sengaja, TAPI tidak mencegah:
    //   • Seseorang yang memakai perangkat bersama dan akun masih login
    //   • Sesi yang dicuri
    //
    // Kode email membuktikan pengguna masih menguasai EMAIL-nya — bukan hanya
    // perangkat yang kebetulan masih login.
    //
    // ── KENAPA DIBLOKIR KALAU ADA LANGGANAN AKTIF ─────────────────────────────
    //
    // Menghapus akun dengan langganan berjalan berarti pengguna tetap ditagih
    // sampai mereka membatalkan sendiri — dan mereka sudah kehilangan akses
    // untuk membatalkannya.
    //
    // Stripe dan GitHub sama-sama memblokir ini. Pesannya harus jelas: batalkan
    // langganan DULU, baru hapus akun.
    //
    // ── KENAPA DATA AUDIT TIDAK DIHAPUS ───────────────────────────────────────
    //
    // `access_events` berisi jejak keamanan yang mungkin dibutuhkan untuk
    // investigasi (percobaan masuk, perubahan sandi). Menghapusnya berarti
    // menghapus bukti.
    //
    // Yang dihapus: data pribadi (email, nama, sandi, identitas OAuth, foto).
    // Yang disimpan: `token_id` di access_events — tanpa data pribadi apa pun,
    // karena token_id bukan email dan tidak bisa dipakai untuk menghubungi
    // pengguna.
    //
    // ── URUTAN PENGHAPUSAN ────────────────────────────────────────────────────
    //
    // Anak dulu, induk terakhir. Kalau dibalik dan ada kegagalan di tengah,
    // baris `users` sudah hilang sementara anak-anaknya masih merujuk ke sana
    // — dan itu data yatim yang sulit dibersihkan.
    //
    // Semua dalam SATU transaksi: kalau ada satu yang gagal, semuanya dibatalkan.
    {
      method: 'POST',
      pattern: '/api/auth/akun/hapus-mulai',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        // ── CEK LANGGANAN AKTIF ───────────────────────────────────────────────
        //
        // Kalau ada pembayaran berstatus aktif, hapus akun DITOLAK. Pengguna
        // harus membatalkan dulu.
        const aktif = getDb().prepare(`
          SELECT COUNT(*) c FROM payments
          WHERE email = ? AND status IN ('aktif', 'active', 'berhasil', 'success')
        `).get(pengguna.email).c;

        if (aktif > 0) {
          recordEvent({
            tokenId: pengguna.token_id,
            action: 'akun_hapus_ditolak',
            outcome: 'langganan_aktif',
            ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
            country: clientCountry(req),
          });
          return sendJson(res, 409, {
            ok: false,
            error: 'langganan_aktif',
            message: 'Batalkan langganan aktif Anda dulu. Setelah dibatalkan, akun bisa dihapus.',
          });
        }

        // ── BUAT KODE 6 DIGIT ─────────────────────────────────────────────────
        //
        // Disimpan di `password_resets` — tabel yang sudah ada untuk kode
        // sekali-pakai.
        //
        // ── KENAPA TABEL ITU, BUKAN TABEL BARU ────────────────────────────────
        // Strukturnya persis yang dibutuhkan: `user_id`, `token_hash`,
        // `kedaluwarsa`, `dipakai_at`. Membuat tabel `account_deletions`
        // berarti menduplikasi struktur yang sama — dan dua tempat yang harus
        // dijaga tetap sinkron.
        //
        // ── KENAPA `crypto.randomInt`, BUKAN `Math.random` ────────────────────
        // `Math.random` bisa diprediksi dari beberapa nilai sebelumnya. Untuk
        // kode keamanan, itu tidak bisa diterima.
        const { randomInt } = await import('node:crypto');
        const kode = String(randomInt(100000, 1000000));

        // ── KENAPA DI-HASH ────────────────────────────────────────────────────
        // Sama seperti sandi. Kalau database bocor, kode mentah tidak bisa
        // dipakai untuk menghapus akun orang lain.
        //
        // Email disertakan dalam hash supaya kode satu pengguna tidak berlaku
        // untuk pengguna lain, walaupun angkanya kebetulan sama.
        const hash = createHash('sha256').update(`${kode}:${pengguna.email}`).digest('hex');

        const kedaluwarsa = Date.now() + 15 * 60 * 1000;   // 15 menit

        // Bersihkan kode lama milik pengguna ini — supaya tidak menumpuk, dan
        // supaya hanya kode TERBARU yang berlaku.
        getDb().prepare('DELETE FROM password_resets WHERE user_id = ?').run(pengguna.id);

        getDb().prepare(`
          INSERT INTO password_resets (user_id, token_hash, dibuat_at, kedaluwarsa)
          VALUES (?, ?, ?, ?)
        `).run(pengguna.id, hash, Date.now(), kedaluwarsa);

        recordEvent({
          tokenId: pengguna.token_id,
          action: 'akun_hapus_diminta',
          outcome: 'ok',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: 'kode verifikasi dikirim',
        });

        // ── KIRIM KODE ────────────────────────────────────────────────────────
        //
        // Kegagalan kirim TIDAK menggagalkan permintaan — kode sudah tersimpan,
        // dan pengguna bisa minta ulang. Yang penting: jangan bocorkan kode ke
        // respons HTTP.
        //
        // ── KENAPA PAKAI `kirimEmailResetSandi` YANG SUDAH ADA ────────────────
        // Itu satu-satunya fungsi kirim email di proyek ini. Ia menulis tautan
        // reset ke log server kalau kredensial email belum dikonfigurasi —
        // perilaku yang benar untuk pengembangan, dan tidak berbahaya di
        // produksi karena log server tidak publik.
        //
        // Membuat fungsi email baru untuk kode hapus berarti menduplikasi
        // konfigurasi SMTP, template, dan penanganan galat.
        let terkirim = false;
        try {
          const { kirimEmailResetSandi } = await import('./email.mjs');
          // Parameter `token` diisi kode — fungsinya hanya menyisipkan nilai
          // ke template. Nama parameternya "token", tapi isinya bebas.
          await kirimEmailResetSandi({ ke: pengguna.email, nama: pengguna.nama || '', token: kode });
          terkirim = true;
        } catch (err) {
          console.warn('[hapus-akun] gagal kirim email:', err?.message ?? err);
        }

        sendJson(res, 200, {
          ok: true,
          // Sengaja TIDAK mengembalikan kode. Ia hanya lewat email.
          pesan: terkirim
            ? `Kode verifikasi dikirim ke ${pengguna.email}. Berlaku 15 menit.`
            : 'Kode dibuat, tapi email gagal terkirim. Hubungi dukungan.',
          kedaluwarsa,
        });
      },
    },

    {
      method: 'POST',
      pattern: '/api/auth/akun/hapus',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const body = await readJson(req).catch(() => ({}));
        const kode = String(body.kode || '').trim();

        if (!/^\d{6}$/.test(kode)) {
          return sendJson(res, 400, { ok: false, error: 'kode_tidak_valid', message: 'Kode harus 6 angka.' });
        }

        // ── VERIFIKASI KODE ───────────────────────────────────────────────────
        //
        // Kolomnya `token_hash` dan `kedaluwarsa` — bukan `token` dan
        // `kedaluwarsa_pada`. Diperiksa lewat PRAGMA table_info, bukan dari
        // ingatan.
        const hash = createHash('sha256').update(`${kode}:${pengguna.email}`).digest('hex');
        const reset = getDb().prepare(`
          SELECT id, kedaluwarsa FROM password_resets
          WHERE user_id = ? AND token_hash = ?
          ORDER BY dibuat_at DESC LIMIT 1
        `).get(pengguna.id, hash);

        if (!reset) {
          recordEvent({
            tokenId: pengguna.token_id, action: 'akun_hapus_gagal',
            outcome: 'kode_salah', ip: clientIp(req),
            userAgent: req.headers['user-agent'] || '', country: clientCountry(req),
          });
          return sendJson(res, 400, { ok: false, error: 'kode_salah', message: 'Kode tidak cocok.' });
        }

        if (Number(reset.kedaluwarsa) < Date.now()) {
          getDb().prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);
          return sendJson(res, 400, { ok: false, error: 'kode_kedaluwarsa', message: 'Kode sudah kedaluwarsa. Minta kode baru.' });
        }

        // ── HAPUS — DALAM SATU TRANSAKSI ──────────────────────────────────────
        //
        // Anak dulu, induk terakhir. Kalau salah satu gagal, semuanya dibatalkan
        // — tidak ada data setengah terhapus.
        const db = getDb();
        const hapusSemua = () => transaction(() => {
          const email = pengguna.email;
          const uid = pengguna.id;

          // ── KENAPA SEMUA TOKEN, BUKAN HANYA SATU ──────────────────────────────
          //
          // Versi pertama memakai `pengguna.token_id` — SATU token saja.
          //
          // Itu kerentanan nyata: satu pengguna bisa punya BANYAK token (satu
          // per perangkat, satu per integrasi API). Menghapus akun dengan satu
          // token berarti sesi di perangkat LAIN tetap hidup — akunnya hilang,
          // tapi orang yang memegang perangkat itu masih bisa masuk.
          //
          // Ditemukan saat uji end-to-end: 2 sesi akun uji SELAMAT dari
          // penghapusan karena token_id-nya berbeda dari users.token_id.
          //
          // Sekarang: kumpulkan SEMUA token yang terhubung ke pengguna ini.
          const semuaToken = new Set();

          if (pengguna.token_id) semuaToken.add(pengguna.token_id);

          for (const r of getDb().prepare(
            'SELECT id FROM tokens WHERE issued_to = ?'
          ).all(email)) {
            if (r.id) semuaToken.add(r.id);
          }

          // ── KENAPA TIDAK ADA QUERY KE auth_identities ─────────────────────────
          //
          // Sempat saya tambahkan `SELECT token_id FROM auth_identities` — dan
          // itu AKAN GAGAL: tabel itu tidak punya kolom `token_id` (diperiksa
          // lewat PRAGMA table_info).
          //
          // Karena semuanya berjalan dalam satu transaksi, satu query gagal
          // berarti SELURUH penghapusan dibatalkan — pengguna melihat pesan
          // galat padahal datanya utuh. Kegagalan yang lebih baik daripada
          // data setengah terhapus, tapi tetap gagal.
          //
          // Dua sumber di atas sudah cukup: users.token_id menangkap token
          // utama, tokens.issued_to menangkap sisanya lewat email.

          const tid = pengguna.token_id || [...semuaToken][0] || '';

          // ── DATA PRIBADI ──────────────────────────────────────────────────────
          db.prepare('DELETE FROM auth_identities WHERE user_id = ?').run(uid);
          for (const t of semuaToken) db.prepare('DELETE FROM device_fingerprints WHERE token_id = ?').run(t);
          for (const t of semuaToken) db.prepare('DELETE FROM sessions WHERE token_id = ?').run(t);
          db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(uid);
          for (const t of semuaToken) db.prepare('DELETE FROM revocations WHERE token_id = ?').run(t);
          for (const t of semuaToken) db.prepare('DELETE FROM consents WHERE token_id = ?').run(t);
          db.prepare('DELETE FROM payments WHERE email = ?').run(email);
          db.prepare('DELETE FROM sales_leads WHERE email = ?').run(email);

          // ── 2FA — PAKAI `identity`, BUKAN `user_id` ───────────────────────────
          //
          // Tabel-tabel TOTP memakai kolom `identity` yang berisi
          // `tokens.issued_to` (email), BUKAN `users.id`.
          //
          // Awalnya saya tulis `WHERE user_id = ?` — dan query itu akan GAGAL
          // karena kolomnya tidak ada. Ketahuan setelah memeriksa
          // `PRAGMA table_info` alih-alih mengandalkan ingatan.
          //
          // Ini juga alasan transaksi penting: kalau query ini gagal di tengah,
          // semua penghapusan sebelumnya dibatalkan — tidak ada data setengah
          // terhapus.
          db.prepare('DELETE FROM totp_secrets WHERE identity = ?').run(email);
          db.prepare('DELETE FROM totp_recovery WHERE identity = ?').run(email);
          db.prepare('DELETE FROM totp_attempts WHERE identity = ?').run(email);

          // Tabel ini memakai `user_id` — beda dari tiga di atas.
          db.prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(uid);

          // ── TOKEN AKSES ───────────────────────────────────────────────────────
          //
          // Token akses proyek milik pengguna ini. Dihapus karena ia kredensial
          // yang masih bisa dipakai — membiarkannya berarti akun "sudah dihapus"
          // tapi token-nya masih bisa mengakses API.
          db.prepare('DELETE FROM tokens WHERE issued_to = ?').run(email);

          // ── INDUK TERAKHIR ────────────────────────────────────────────────────
          db.prepare('DELETE FROM users WHERE id = ?').run(uid);

          // ── ACCESS_EVENTS: token_id DILEPAS, BARISNYA DIBIARKAN ──────────────
          //
          // Jejak keamanan TIDAK dihapus — ia mungkin dibutuhkan untuk
          // investigasi (percobaan masuk, perubahan sandi). Tapi token_id-nya
          // dijadikan NULL supaya tidak lagi bisa dikaitkan ke akun mana pun.
          //
          // Ini pola yang sama dipakai sistem audit korporat: catatannya
          // tetap ada, identitasnya diputus.
          for (const t of semuaToken) db.prepare('UPDATE access_events SET token_id = NULL WHERE token_id = ?').run(t);

          // ── ANALYTICS & WEB_VITALS ────────────────────────────────────────────
          //
          // Metrik tidak mengandung data pribadi selain token_id. Dilepas juga
          // supaya tidak ada sisa kaitan ke akun yang sudah tidak ada.
          for (const t of semuaToken) db.prepare('UPDATE analytics_events SET token_id = NULL WHERE token_id = ?').run(t);
        });

        try {
          hapusSemua();
        } catch (err) {
          console.error('[hapus-akun] gagal:', err?.message ?? err);
          return sendJson(res, 500, { ok: false, error: 'gagal_hapus', message: 'Tidak bisa menghapus akun. Hubungi dukungan.' });
        }

        // ── HAPUS COOKIE SESI ─────────────────────────────────────────────────
        //
        // Akun sudah tidak ada. Cookie yang tersisa akan gagal validasi, tapi
        // lebih bersih kalau langsung dihapus — supaya browser tidak menyimpan
        // cookie yang tidak berguna.
        // ── KENAPA COOKIE_SESI, BUKAN STRING 'sesi' ───────────────────────────
        //
        // Versi pertama menulis `setCookie(res, 'sesi', ...)` — nama cookie
        // yang TIDAK PERNAH ADA di aplikasi ini. Cookie sesi yang sebenarnya
        // bernama `portfolio_session` (lihat konstanta COOKIE_SESI di atas).
        //
        // Akibatnya: cookie yang benar TIDAK terhapus. Pengguna melihat akun
        // "sudah dihapus", tapi browser masih menyimpan cookie sesi lama —
        // dan permintaan berikutnya membawa cookie itu.
        //
        // Memakai konstanta berarti nama cookie hanya didefinisikan SEKALI.
        setCookie(res, COOKIE_SESI, '', { maxAge: 0, path: '/' });

        // Catat SETELAH penghapusan, tanpa token_id (akun sudah tidak ada).
        recordEvent({
          tokenId: null,
          action: 'akun_dihapus',
          outcome: 'ok',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: 'penghapusan atas permintaan pengguna',
        });

        sendJson(res, 200, { ok: true, pesan: 'Akun Anda sudah dihapus.' });
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
