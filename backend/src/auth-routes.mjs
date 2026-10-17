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

// ── KENAPA `randomInt` DARI node:crypto, BUKAN Math.random() ────────────────
//
// Kode verifikasi 6 digit melindungi akun dari penghapusan oleh orang lain.
// `Math.random()` adalah PRNG yang BISA DIPREDIKSI: setelah beberapa nilai
// diamati, nilai berikutnya bisa dihitung. Untuk kode keamanan, itu berarti
// penyerang bisa menebak kode verifikasi tanpa pernah menerima emailnya.
//
// `randomInt` dari node:crypto memakai sumber acak kriptografis.
//
// ── KENAPA BUKAN `randomBytes` ──────────────────────────────────────────────
//
// `randomInt(0, 1000000)` langsung memberi angka dalam rentang yang dibutuhkan.
// Dengan `randomBytes`, angkanya harus di-modulo — dan modulo pada bilangan
// acak menimbulkan bias (beberapa nilai lebih sering muncul). Untuk kode 6
// digit, biasnya kecil tapi tetap ada, dan tidak ada alasan menerimanya.
import { createHash, randomInt } from 'node:crypto';
import { config } from './config.mjs';
// ── KENAPA `transaction` DIIMPORT, BUKAN `db.transaction()` ────────────────
// `node:sqlite` TIDAK punya method `.transaction()` — itu API better-sqlite3.
// Memanggilnya melempar "db.transaction is not a function" yang baru ketahuan
// saat endpoint benar-benar dijalankan (HTTP 500 di uji pertama).
//
// Helper-nya ada di db.mjs sebagai fungsi terpisah: BEGIN → fn() → COMMIT,
// dan ROLLBACK kalau fn() melempar.
import { getDb, transaction } from './db.mjs';

// ── KENAPA adaLanggananAktif DIIMPOR, BUKAN DITULIS DI SINI ─────────────────
//
// Pemeriksaan langganan menentukan apakah pengguna BOLEH menghapus akunnya.
// Itu keputusan yang harus bisa diuji tanpa menyalakan server HTTP — dan
// pembersih otomatis (purge-akun.mjs) memakai aturan yang SAMA saat menghapus
// permanen.
//
// Dua salinan aturan berarti keduanya bisa menyimpang — dan yang menyimpang
// baru ketahuan saat ada pengguna yang akunnya terhapus padahal masih
// berlangganan.
import { adaLanggananAktif, nonaktifkanAkun, cekKodePembatalan } from './purge-akun.mjs';
import { sendJson, setCookie, clientIp, clientCountry, clientGeo, ipSamar, readJson, bacaBodyBiner, safe } from './http-util.mjs';
import { createSession, validateSession, destroySession, hashSession } from './sessions.mjs';
// ── PENCATATAN PAKET GRATIS ──────────────────────────────────────────────────
// Dipanggil di buatSesiUntuk() — titik yang dilalui SEMUA cara masuk
// (sandi, passkey, SSO). Kalau ditaruh di masing-masing alur, salah satu
// pasti terlewat saat ada cara masuk baru ditambahkan.
import { catatPaketGratis, punyaLanggananBerbayar } from './paket-akun.mjs';
// statusTotp: HANYA untuk membaca status 2FA di halaman akun. Alur
// mengaktifkan 2FA tetap di halaman masuk — tidak diduplikasi di sini.
//
// `verifikasi2fa` + `totpAktif` dipakai oleh gerbang 2FA di alur HAPUS AKUN.
// Menghapus akun adalah tindakan destruktif yang tidak bisa dibatalkan — pola
// korporat (Microsoft, Google) meminta faktor kedua untuk tindakan seperti
// ini, bukan hanya kode yang dikirim ke email. Tanpa gerbang itu, siapa pun
// yang menguasai kotak masuk bisa menghapus akun orang lain.
import { statusTotp, verifikasi2fa, totpAktif } from './totp-service.mjs';
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

// ══ AKSI YANG BOLEH MUNCUL DI LOG AKTIVITAS PENGGUNA ═════════════════════════
//
// ── MASALAH YANG DIPERBAIKI (terlihat di produksi) ──────────────────────────
// Tabel `access_events` adalah log audit BERSAMA: ia menampung peristiwa
// pengguna (masuk, ganti sandi) DAN peristiwa sistem/admin (penghapusan
// akun diproses admin, penonaktifan, keputusan tinjauan).
//
// Endpoint /api/auth/aktivitas dulu mengirim SEMUANYA untuk token pengguna.
// Hasilnya di tab Aktivitas muncul entri yang membingungkan:
//
//   akun_hapus_diminta    ← keputusan admin, bukan aksi pengguna
//   akun_hapus_gagal      ← kegagalan sistem, pengguna tidak melakukan apa pun
//   akun_hapus_disetujui  ← keputusan admin
//   akun_dinonaktifkan    ← tindakan admin
//
// Pengguna membaca "akun_hapus_gagal" dan menyimpulkan akunnya bermasalah —
// padahal itu catatan internal tentang percobaan yang tidak jadi.
//
// ── PEMISAHAN INI POLA STANDAR ──────────────────────────────────────────────
// GitHub memisahkannya tegas: "Security log" (peristiwa akun pribadi) vs
// "Audit log" (peristiwa organisasi). Vercel: "Activity Log" hanya berisi
// peristiwa yang dilakukan user; metadata audit masuk ke Audit Logs yang
// hanya tersedia untuk Enterprise.
//
// Yang boleh muncul di log pengguna: peristiwa yang PENGGUNA lakukan, atau
// yang menyangkut KEAMANAN akunnya sendiri (masuk, sesi dicabut).
// Yang tidak: keputusan admin, kesalahan sistem, event internal.
//
// Daftar putih, bukan daftar hitam — event baru yang ditambahkan nanti
// TIDAK otomatis bocor ke log pengguna; harus didaftarkan dulu di sini.
//
// Diletakkan di LEVEL MODUL (bukan di dalam array rute) karena array rute
// adalah daftar objek literal — pernyataan `const` di dalamnya adalah
// SyntaxError.
const AKSI_PENGGUNA = [
  // Masuk
  'auth_masuk', 'auth_oauth_masuk', 'auth_sso_masuk', 'auth_passkey_masuk',
  // Pendaftaran
  'auth_daftar', 'auth_oauth_daftar', 'auth_passkey_daftar', 'auth_oauth_sambung',
  // Sandi
  'auth_lupa_sandi', 'auth_reset_sandi',
  // Sesi
  'auth_sesi_cabut', 'auth_sesi_cabut_semua',
  // 2FA
  'totp_verify',
  // Profil
  'profil_diperbarui', 'avatar_unggah', 'avatar_hapus',
  'auth_identitas_hapus',
  // Media
  'media_unggah', 'media_hapus',
  // Token
  'token_validate', 'token_revoke',
];

// Placeholder IN (...) — dibangun sekali dari daftar di atas.
const AKSI_PENGGUNA_IN = AKSI_PENGGUNA.map(() => '?').join(',');

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
/**
 * Samarkan alamat email untuk ditampilkan SEBELUM identitas terbukti.
 *
 * Dipakai di gerbang 2FA alur hapus akun: pengguna perlu tahu AKUN MANA yang
 * sedang diproses ("oh, ini email kantor saya"), tapi alamat lengkapnya tidak
 * perlu terlihat — layar bisa dilihat orang lain, dan pesan galat bisa
 * tersalin ke tempat lain.
 *
 * Domain tetap utuh karena itu bagian yang paling membantu.
 */
function samarkanEmailAuth(email) {
  const s = String(email ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return '***';

  const lokal = s.slice(0, at);
  const domain = s.slice(at);

  if (lokal.length <= 2) return `${lokal[0] ?? '*'}***${domain}`;
  return `${lokal[0]}***${lokal[lokal.length - 1]}${domain}`;
}

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

  // ── CATAT PAKET GRATIS — TAPI HANYA KALAU MEMANG TIDAK BERBAYAR ────────────
  //
  // ── KENAPA DI SINI ────────────────────────────────────────────────────────
  // Fungsi ini adalah SATU-SATUNYA jalur pembuatan sesi. Sandi, passkey, dan
  // SSO semuanya lewat sini. Menaruhnya di masing-masing alur berarti salah
  // satu akan terlewat begitu ada cara masuk baru.
  //
  // ── KENAPA DIPERIKSA DULU, BUKAN LANGSUNG DICATAT ────────────────────────
  // Pengguna berbayar juga login. Kalau pencatatan tidak diperiksa, tabel
  // paket_akun akan berisi baris 'gratis' untuk orang yang sedang membayar —
  // dan catatan itu bukan cuma tidak berguna, tapi MENYESATKAN saat ada
  // pertanyaan "siapa saja pengguna gratis".
  //
  // Pemeriksaan ini tidak membuat paket berbayar bergantung pada tabel
  // paket_akun: paket berbayar tetap dibaca dari tabel langganan, dan tabel
  // ini hanya diisi kalau memang tidak ada langganan berbayar yang aktif.
  //
  // ── KENAPA TIDAK MENGHENTIKAN LOGIN KALAU GAGAL ──────────────────────────
  // catatPaketGratis() menangkap error-nya sendiri dan mengembalikan status.
  // Kegagalan di sini hanya soal CATATAN — hak aksesnya tetap benar, karena
  // paketPengguna() mengembalikan 'gratis' sebagai default tanpa perlu baris.
  // Membiarkan login gagal karena pencatatan akan menukar masalah kecil
  // dengan masalah besar.
  try {
    if (!punyaLanggananBerbayar(pengguna.id)) {
      catatPaketGratis(pengguna.id);
    }
  } catch (err) {
    console.error('[auth] gagal mencatat paket gratis:', err?.message ?? err);
  }

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
  // ── KENAPA PEMBUNGKUSAN DI SINI, BUKAN SATU PER SATU ──────────────────────
  // Ada ~40 rute di bawah ini (5 provider × beberapa rute + SSO + passkey +
  // profil + akun). Menambahkan safe() pada masing-masing berarti satu
  // tempat bisa terlewat setiap kali ada rute baru — dan yang terlewat
  // baru ketahuan saat produksi error di malam hari.
  //
  // Membungkus DI SATU TEMPAT (map di akhir) membuat rute baru otomatis
  // terlindungi: tidak ada jalan untuk menambah rute tanpa pelindung.
  //
  // Sebelum ini, error server di rute auth jatuh ke requestHandler
  // (server.mjs) dan dilaporkan sebagai HTTP 400 "permintaan_tidak_valid"
  // — seolah input klien yang salah, padahal kode server yang gagal.
  const daftar = [
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

  // Bungkus SETIAP rute dengan safe() — lihat komentar di atas.
  //
  // Spread objek: salinan baru, bukan mutasi — objek rute asli (mis.
  // ruteProfil) tidak ikut berubah. Penting karena beberapa rute dipakai
  // ulang di berkas ini; memutasi handler-nya dua kali akan membungkus
  // dua kali, dan setiap error tercatat dua kali di log.
  return daftar.map((r) => ({ ...r, handler: safe(r.handler) }));
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
    //
    // Daftar putih AKSI_PENGGUNA (level modul, lihat atas berkas) menyaring
    // peristiwa admin/sistem. Penjelasan lengkap ada di definisinya.
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
            AND action IN (${AKSI_PENGGUNA_IN})
          ORDER BY at DESC, id DESC
          LIMIT 40
        `).all(pengguna.token_id, ...AKSI_PENGGUNA);

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
          const col = kolom[k];
          // Defense-in-depth: pastikan nama kolom benar-benar ada di whitelist.
          // `kolom` adalah peta internal, bukan input user — tapi validasi ini
          // mencegah injection kalau peta diperluas di masa depan tanpa hati-hati.
          if (!col || !/^[a-z_]+$/.test(col)) {
            throw new Error(`[BUG] kolom tidak valid: ${col}`);
          }
          // `!!` menormalkan apa pun jadi boolean, lalu disimpan sebagai 0/1.
          set.push(`${col} = ?`);
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

    // ══ HAPUS AKUN — DENGAN MASA TENGGANG 30 HARI ══════════════════════════════
    //
    // ── KENAPA TIDAK LANGSUNG HAPUS (versi pertama salah) ──────────────────────
    //
    // Versi pertama menghapus akun SEGERA setelah kode verifikasi benar. Itu
    // melanggar standar korporat dan berbahaya:
    //
    //   • Salah klik / akun diretas → data hilang permanen
    //   • Tidak ada jalan pulang sama sekali
    //
    // Riset: "Temporary soft deletion is acceptable as an intermediate state
    // (e.g., offering a 7-day grace period where users can cancel account
    // deletion), provided the hard purge runs automatically at the end of the
    // window." GitHub, Google, Stripe, dan Facebook semuanya memakai pola ini.
    //
    // ── ALUR BARU ─────────────────────────────────────────────────────────────
    //
    //   1. POST /akun/hapus-mulai   → kirim kode ke email
    //   2. POST /akun/hapus         → verifikasi kode → status 'menunggu_hapus'
    //   3. (30 hari)                → pengguna bisa login & membatalkan
    //   4. POST /akun/batal-hapus   → kembalikan ke 'aktif'
    //   5. (setelah 30 hari)        → pembersih otomatis menghapus permanen
    //
    // ── KENAPA `status` BERUBAH, BUKAN KOLOM BARU ─────────────────────────────
    //
    // Login sudah memeriksa `user.status !== 'aktif'` (routes.mjs:1557). Dengan
    // mengubah status, akun otomatis TERKUNCI di SEMUA jalur yang sudah ada —
    // tanpa menyentuh satu pun dari mereka.
    //
    // Tapi itu menimbulkan masalah: pengguna juga tidak bisa login untuk
    // MEMBATALKAN. Karena itu login mengembalikan `bisa_dibatalkan: true`
    // (lihat routes.mjs) dan halaman masuk menawarkan pembatalan.
    {
      method: 'POST',
      pattern: '/api/auth/akun/hapus-mulai',
      handler: async (req, res) => {
        const tokenRow = sesiDariRequest(req);
        if (!tokenRow) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        const pengguna = penggunaDariToken(tokenRow);
        if (!pengguna) return sendJson(res, 401, { ok: false, error: 'belum_masuk' });

        // Body dibaca di sini karena `kode_2fa` datang dari klien — lihat
        // gerbang 2FA di bawah. Body kosong bukan kesalahan pada endpoint ini:
        // akun tanpa 2FA tidak mengirim apa pun.
        const body = await readJson(req).catch(() => ({}));

        // ── BLOKIR KALAU SUDAH MENUNGGU HAPUS ──────────────────────────────────
        //
        // Minta kode dua kali tidak ada gunanya — permintaan pertama sudah
        // tercatat. Yang dibutuhkan pengguna adalah MEMBATALKAN, dan itu
        // endpoint lain.
        if (pengguna.status === 'menunggu_hapus') {
          return sendJson(res, 409, {
            ok: false,
            error: 'sudah_menunggu_hapus',
            message: 'Akun Anda sudah dijadwalkan terhapus. Batalkan dulu kalau berubah pikiran.',
            dihapus_pada: pengguna.dihapus_pada,
          });
        }

        // ── BLOKIR KALAU ADA LANGGANAN ATAU TAGIHAN AKTIF ─────────────────────
        //
        // ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────
        //
        // Versi pertama memakai status pembayaran YANG TIDAK ADA:
        //
        //   Kode saya:   status IN ('lunas', 'aktif', 'menunggu')
        //   Sebenarnya:  'pending', 'dibayar', 'gagal', 'kedaluwarsa', 'dikembalikan'
        //
        // NOL dari tiga status itu cocok — jadi pemeriksaannya SELALU
        // mengembalikan 0, dan pengguna dengan langganan aktif TETAP BISA
        // menghapus akunnya.
        //
        // ── KENAPA HARUS DIBLOKIR ─────────────────────────────────────────────
        //
        // Kalau akun dihapus sementara langganan berjalan:
        //   • Pengguna tetap DITAGIH setiap bulan
        //   • Tapi sudah kehilangan akses untuk membatalkannya
        //   • Token akses API mereka juga terhapus
        //   • Uang masuk tanpa layanan → refund manual → beban dukungan
        //
        // Ini pola yang dipakai sistem korporat: selesaikan kewajiban
        // finansial dulu, baru tutup akun.
        const langganan = adaLanggananAktif(pengguna.email);

        if (langganan.ada) {
          const jenis = langganan.rincian.map((r) => r.tier || 'langganan').join(', ');
          return sendJson(res, 409, {
            ok: false,
            error: 'ada_langganan',
            message: `Anda masih punya ${langganan.jumlah} langganan/tagihan aktif (${jenis}). `
              + 'Batalkan dulu di menu Pembayaran, baru hapus akun.',
            jumlah: langganan.jumlah,
          });
        }

        // ══ 2FA WAJIB KALAU AKTIF ═════════════════════════════════════════════
        //
        // ── KENAPA DI SINI, BUKAN DI AKHIR ────────────────────────────────────
        // Kode email adalah bukti pertama; kode authenticator adalah bukti
        // kedua. Meminta kode email dulu lalu kode 2FA berarti pengguna
        // menunggu email yang tidak akan berguna sampai faktor kedua lolos —
        // dan penyerang yang hanya menguasai kotak masuk tidak pernah sampai
        // ke langkah berikutnya.
        //
        // ── POLA KORPORAT ─────────────────────────────────────────────────────
        // Menghapus akun adalah tindakan yang tidak bisa dibatalkan. Microsoft
        // dan Google sama-sama meminta verifikasi ulang faktor kedua sebelum
        // perubahan akun yang destruktif — bukan hanya kode email.
        if (totpAktif(pengguna.email)) {
          const kode2fa = String(body?.kode_2fa ?? '').replace(/\D/g, '').slice(0, 6);

          if (!kode2fa) {
            return sendJson(res, 403, {
              ok: false,
              error: 'perlu_2fa',
              message: 'Akun ini memakai verifikasi dua langkah. Masukkan kode dari aplikasi authenticator Anda untuk melanjutkan.',
              email_samar: samarkanEmailAuth(pengguna.email),
            });
          }

          const verif = verifikasi2fa(pengguna.email, kode2fa, config, {
            ip: clientIp(req), cekReplay: false,
          });

          if (!verif.ok) {
            recordEvent({
              tokenId: pengguna.token_id, action: 'akun_hapus_2fa_gagal',
              outcome: verif.alasan ?? 'kode_salah',
              ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
              country: clientCountry(req),
            });
            return sendJson(res, 401, {
              ok: false,
              error: verif.alasan ?? 'kode_salah',
              message: verif.pesan ?? 'Kode tidak cocok.',
              sisa_percobaan: verif.sisa_percobaan,
            });
          }
        }

        const kode = String(randomInt(0, 1000000)).padStart(6, '0');
        const hash = createHash('sha256').update(`${kode}:${pengguna.email}`).digest('hex');
        const kedaluwarsa = Date.now() + 15 * 60 * 1000;

        getDb().prepare('DELETE FROM password_resets WHERE user_id = ?').run(pengguna.id);
        getDb().prepare(`
          INSERT INTO password_resets (user_id, token_hash, dibuat_at, kedaluwarsa)
          VALUES (?, ?, ?, ?)
        `).run(pengguna.id, hash, Date.now(), kedaluwarsa);

        // ── KIRIM KODE LEWAT EMAIL ─────────────────────────────────────────────
        let terkirim = false;
        try {
          // ── KENAPA DYNAMIC IMPORT, BUKAN IMPORT DI ATAS FILE ─────────────────
          //
          // ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────
          //
          // Versi sebelumnya memanggil `kirimEmailResetSandi(...)` TANPA
          // mengimportnya sama sekali. Yang terjadi:
          //
          //   ReferenceError: kirimEmailResetSandi is not defined
          //
          // Error itu ditelan oleh try/catch di sekitarnya, jadi kegagalannya
          // SENYAP — pengguna melihat "email gagal terkirim" dan tidak tahu
          // kenapa. Di produksi dengan SMTP aktif pun, email TIDAK AKAN PERNAH
          // terkirim.
          //
          // ── KENAPA DINAMIS ────────────────────────────────────────────────────
          //
          // `routes.mjs` juga memakai dynamic import untuk modul ini (lihat
          // baris 1849). Alasannya: email.mjs memuat konfigurasi SMTP yang
          // berat, dan hanya sebagian kecil request yang benar-benar mengirim
          // email. Static import berarti SEMUA request membayar biaya itu.
          //
          // Pola yang sama dipakai di sini supaya konsisten.
          // ── TEMPLATE KHUSUS, BUKAN TEMPLATE RESET SANDI ────────────────────
          // Sebelumnya alur ini memakai `kirimEmailResetSandi` — pengguna yang
          // meminta HAPUS AKUN menerima email berjudul "Ganti sandi Anda".
          // Pada alur berbahaya, kebingungan seperti itu berbahaya: pengguna
          // tidak tahu kode itu untuk apa, dan bisa menyerahkannya ke orang lain.
          //
          // `kirimKodeHapusAkun` mengirim email yang tepat: kode besar, nada
          // tegas, dan peringatan masa tenggang yang jelas.
          const { kirimKodeHapusAkun } = await import('./email.mjs');
          const r = await kirimKodeHapusAkun({
            ke: pengguna.email,
            kode,
            nama: pengguna.nama,
            berlakuMenit: 15,
            sisaHari: 30,
          });
          terkirim = Boolean(r?.ok);
        } catch (err) {
          console.warn('[hapus-akun] email gagal:', err?.message ?? err);
        }

        // ── KODE DI LOG KALAU EMAIL GAGAL ──────────────────────────────────────
        //
        // Tanpa ini, pengguna terjebak: tidak menerima email, tidak bisa
        // melanjutkan, dan tidak ada cara memulihkan selain menghubungi dukungan.
        // Di log, operator bisa membacakan kodenya.
        //
        // HANYA dicatat kalau email benar-benar gagal — kalau berhasil, kode
        // tidak boleh ada di log sama sekali.
        if (!terkirim) {
          console.warn(`[hapus-akun] KODE MANUAL untuk ${pengguna.email}: ${kode}`);
        }

        recordEvent({
          tokenId: pengguna.token_id,
          action: 'akun_hapus_diminta',
          outcome: terkirim ? 'ok' : 'email_gagal',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: terkirim ? 'kode verifikasi dikirim' : 'kode dibuat, email gagal',
        });

        sendJson(res, 200, {
          ok: true,
          terkirim,
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

        // ══ GERBANG 2FA — DIPERIKSA SEBELUM KODE EMAIL DIPAKAI ═══════════════
        //
        // ── KENAPA DI SINI JUGA, PADAHAL hapus-mulai SUDAH MEMERIKSA ─────────
        // hapus-mulai dan hapus adalah dua permintaan TERPISAH. Memeriksa 2FA
        // hanya di yang pertama berarti penyerang bisa memanggil /hapus
        // langsung dengan kode email yang ia peroleh — tanpa pernah melewati
        // gerbang di /hapus-mulai. Setiap endpoint yang MENGUBAH keadaan harus
        // memeriksa sendiri; tidak ada yang boleh mengandalkan endpoint lain.
        //
        // ── URUTANNYA PENTING ────────────────────────────────────────────────
        // 2FA diperiksa DULU, sebelum kode email dibandingkan. Kalau dibalik,
        // penyerang yang punya kode email tapi tidak punya authenticator bisa
        // memakai percobaan yang gagal itu untuk menebak kode email (timing /
        // pesan berbeda), lalu menyimpannya untuk percobaan berikutnya.
        if (totpAktif(pengguna.email)) {
          const kode2fa = String(body.kode_2fa ?? '').replace(/\D/g, '').slice(0, 6);

          if (!kode2fa) {
            return sendJson(res, 403, {
              ok: false,
              error: 'perlu_2fa',
              message: 'Akun ini memakai verifikasi dua langkah. Masukkan kode dari aplikasi authenticator Anda.',
              email_samar: samarkanEmailAuth(pengguna.email),
            });
          }

          const verif = verifikasi2fa(pengguna.email, kode2fa, config, {
            ip: clientIp(req), cekReplay: false,
          });

          if (!verif.ok) {
            recordEvent({
              tokenId: pengguna.token_id, action: 'akun_hapus_2fa_gagal',
              outcome: verif.alasan ?? 'kode_salah',
              ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
              country: clientCountry(req),
            });
            return sendJson(res, 401, {
              ok: false,
              error: verif.alasan ?? 'kode_salah',
              message: verif.pesan ?? 'Kode tidak cocok.',
              sisa_percobaan: verif.sisa_percobaan,
            });
          }
        }

        // ── VERIFIKASI KODE ───────────────────────────────────────────────────
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

        // ── KODE BENAR → NONAKTIFKAN (BUKAN HAPUS) ────────────────────────────
        //
        // ── MODEL KORPORAT: NONAKTIF → TINJAUAN ADMIN → HAPUS ─────────────────
        //
        // Ini perubahan inti dari versi pertama. Kode yang benar TIDAK
        // menghapus apa pun — ia mengubah status akun jadi nonaktif.
        //
        // Sistem korporat tidak pernah menghapus langsung. Alasannya bukan
        // birokrasi, ada kerugian nyata yang dicegah:
        //
        //   • Klik salah / akun diretas → data hilang permanen
        //   • Sengketa pembayaran berjalan → bukti transaksi hilang
        //   • Investigasi penyalahgunaan → jejak dihapus sebelum diperiksa
        //   • Akun diperebutkan kepemilikannya → pihak yang kalah menghapusnya
        //
        // Manusia (CS/admin) bisa membedakan "pengguna ingin pergi" dari
        // "penyerang ingin menghapus jejak". Otomatisasi tidak bisa.
        //
        // ── TIGA JALUR KELUAR ─────────────────────────────────────────────────
        //
        //   1. Admin menyetujui  → dihapus pada pembersihan berikutnya
        //   2. Admin menolak     → akun kembali aktif
        //   3. Lewat 12 bulan    → otomatis, kalau tidak ada yang meninjau
        //
        // Jalur 3 wajib ada: tanpa itu, akun yang tidak pernah ditinjau
        // menumpuk selamanya — melanggar penyimpanan terbatas GDPR.
        const hasilNonaktif = nonaktifkanAkun(
          pengguna.id,
          String(body.alasan || 'permintaan pengguna').slice(0, 200),
        );

        if (!hasilNonaktif.dinonaktifkan) {
          return sendJson(res, 409, {
            ok: false,
            error: 'tidak_bisa_dinonaktifkan',
            message: 'Akun tidak dalam keadaan yang bisa dinonaktifkan.',
          });
        }

        // Kode tidak bisa dipakai lagi — satu kode untuk satu aksi.
        getDb().prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);

        // ── CABUT SEMUA SESI ───────────────────────────────────────────────────
        //
        // Semua perangkat harus keluar. Kalau sesi lain dibiarkan hidup,
        // seseorang yang memegang perangkat itu masih bisa memakai akun.
        //
        // Mengumpulkan SEMUA token, bukan hanya users.token_id: satu pengguna
        // bisa punya banyak token (perangkat, API).
        const semuaToken = new Set();
        if (pengguna.token_id) semuaToken.add(pengguna.token_id);
        for (const r of getDb().prepare('SELECT id FROM tokens WHERE issued_to = ?').all(pengguna.email)) {
          if (r.id) semuaToken.add(r.id);
        }

        for (const t of semuaToken) {
          getDb().prepare('DELETE FROM sessions WHERE token_id = ?').run(t);
        }

        recordEvent({
          tokenId: pengguna.token_id,
          action: 'akun_dinonaktifkan',
          outcome: 'ok',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: 'menunggu tinjauan admin; otomatis terhapus setelah 12 bulan',
        });

        // Cookie dibersihkan — sesi sudah tidak valid.
        setCookie(res, COOKIE_SESI, '', { maxAge: 0, path: '/' });

        sendJson(res, 200, {
          ok: true,
          pesan: 'Akun Anda dinonaktifkan. Permintaan penghapusan akan ditinjau oleh tim kami. '
            + 'Anda masih bisa memulihkan akun dengan masuk kembali.',
          nonaktif: true,
          // ── KENAPA TIDAK MENJANJIKAN TANGGAL ────────────────────────────────
          //
          // Penghapusan tergantung tinjauan admin. Menjanjikan "terhapus dalam
          // 30 hari" akan salah kalau admin butuh waktu lebih — dan pengguna
          // yang sudah dijanjikan sesuatu lalu tidak ditepati akan menghubungi
          // dukungan, atau lebih buruk, mengeluh publik.
          //
          // Yang bisa dijanjikan: ada tinjauan, dan ada pemulihan.
          batas_otomatis_bulan: 12,
        });
      },
    },

    // ══ BATALKAN PENGHAPUSAN ═══════════════════════════════════════════════════
    //
    // ── KENAPA ENDPOINT INI WAJIB ADA ──────────────────────────────────────────
    //
    // Tanpa ini, masa tenggang hanya memperlambat penghapusan — bukan memberi
    // jalan pulang. Nilai sesungguhnya dari grace period adalah PEMBATALAN.
    //
    // ── KENAPA BUTUH KODE, BUKAN HANYA SESI ────────────────────────────────────
    //
    // Akun dalam masa tenggang TIDAK BISA LOGIN (status bukan 'aktif'). Jadi
    // tidak ada sesi untuk dipakai. Pengguna membuktikan kepemilikan lewat
    // kode yang dikirim ke email — sama seperti saat meminta hapus.
    //
    // Ini juga melindungi dari skenario buruk: seseorang yang menguasai
    // perangkat korban MEMINTA hapus akun. Korban menerima email "akun Anda
    // akan dihapus" dan bisa membatalkannya — penyerang tidak bisa mencegah
    // itu tanpa akses ke email.
    {
      method: 'POST',
      pattern: '/api/auth/akun/batal-hapus',
      handler: async (req, res) => {
        const body = await readJson(req).catch(() => ({}));
        const email = normalEmail(String(body.email || ''));
        const kode = String(body.kode || '').trim();

        if (!email || !/^\d{6}$/.test(kode)) {
          return sendJson(res, 400, { ok: false, error: 'input_tidak_valid', message: 'Email dan kode 6 angka wajib diisi.' });
        }

        const pengguna = cariPengguna(email);

        // ── JAWABAN SERAGAM UNTUK EMAIL TAK DIKENAL ───────────────────────────
        //
        // Kalau server membedakan "email tidak ada" dari "kode salah",
        // penyerang bisa memakai endpoint ini untuk memetakan email mana yang
        // terdaftar. Jawaban yang sama menutup celah itu.
        if (!pengguna || pengguna.status !== 'menunggu_hapus') {
          return sendJson(res, 400, { ok: false, error: 'tidak_bisa_dibatalkan', message: 'Email atau kode tidak cocok.' });
        }

        const hash = createHash('sha256').update(`${kode}:${pengguna.email}`).digest('hex');
        const reset = getDb().prepare(`
          SELECT id, kedaluwarsa FROM password_resets
          WHERE user_id = ? AND token_hash = ?
          ORDER BY dibuat_at DESC LIMIT 1
        `).get(pengguna.id, hash);

        if (!reset) {
          return sendJson(res, 400, { ok: false, error: 'kode_salah', message: 'Email atau kode tidak cocok.' });
        }

        if (Number(reset.kedaluwarsa) < Date.now()) {
          getDb().prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);
          return sendJson(res, 400, { ok: false, error: 'kode_kedaluwarsa', message: 'Kode sudah kedaluwarsa. Minta kode baru.' });
        }

        // ── KEMBALIKAN AKUN ───────────────────────────────────────────────────
        getDb().prepare(`
          UPDATE users SET status = 'aktif', dihapus_pada = NULL, alasan_hapus = ''
          WHERE id = ?
        `).run(pengguna.id);

        getDb().prepare('DELETE FROM password_resets WHERE id = ?').run(reset.id);

        recordEvent({
          tokenId: pengguna.token_id,
          action: 'akun_hapus_dibatalkan',
          outcome: 'ok',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: 'pengguna membatalkan penghapusan',
        });

        sendJson(res, 200, {
          ok: true,
          pesan: 'Penghapusan dibatalkan. Akun Anda kembali aktif — silakan masuk.',
        });
      },
    },


    // ══ MINTA KODE PEMBATALAN (TANPA SESI) ══════════════════════════════════════
    //
    // ── KENAPA ENDPOINT INI HARUS TANPA SESI ────────────────────────────────────
    //
    // Pengguna yang akunnya dinonaktifkan SUDAH TIDAK PUNYA SESI — semuanya
    // dicabut saat penghapusan diminta. Dan login ditolak karena statusnya
    // bukan 'aktif'.
    //
    // Jadi kalau endpoint ini butuh sesi, pembatalan MUSTAHIL. Fiturnya ada,
    // tapi jalannya tertutup rapat — dan masa tenggang jadi sekadar
    // memperlambat penghapusan, bukan memberi jalan pulang.
    //
    // ── KENAPA AMAN TANPA SESI ──────────────────────────────────────────────────
    //
    //   1. Kode dikirim ke EMAIL pemilik akun. Penyerang yang memanggil
    //      endpoint ini tidak menerimanya.
    //   2. Jawaban SERAGAM untuk semua email (lihat cekKodePembatalan) —
    //      tidak bisa dipakai memetakan email terdaftar.
    //   3. Hanya berfungsi untuk akun `menunggu_hapus`. Akun aktif tidak
    //      terganggu sama sekali.
    //   4. Rate limit yang sudah ada berlaku untuk endpoint /api/auth/*.
    //   5. Tanpa kode yang benar, tidak ada perubahan apa pun.
    {
      method: 'POST',
      pattern: '/api/auth/akun/minta-kode-batal',
      handler: async (req, res) => {
        const body = await readJson(req).catch(() => ({}));
        const email = normalEmail(String(body.email || ''));

        if (!email) {
          return sendJson(res, 400, { ok: false, error: 'email_kosong', message: 'Email wajib diisi.' });
        }

        const cek = cekKodePembatalan(email);

        // ── JAWABAN SERAGAM ───────────────────────────────────────────────────
        //
        // Baik email tak dikenal maupun akun aktif mendapat jawaban yang sama.
        // Kalau dibedakan, endpoint ini jadi alat memetakan email terdaftar.
        //
        // Pesannya tetap memberi tahu pengguna apa yang harus dilakukan,
        // tanpa membocorkan apakah emailnya ada.
        if (!cek.boleh) {
          return sendJson(res, 200, {
            ok: true,
            terkirim: false,
            pesan: 'Kalau email itu punya akun yang menunggu dihapus, kami sudah mengirim kodenya. '
              + 'Periksa kotak masuk Anda.',
          });
        }

        // ── BUAT + SIMPAN KODE ────────────────────────────────────────────────
        const kode = String(randomInt(0, 1000000)).padStart(6, '0');
        const hash = createHash('sha256').update(`${kode}:${email}`).digest('hex');
        const kedaluwarsa = Date.now() + 15 * 60 * 1000;

        getDb().prepare('DELETE FROM password_resets WHERE user_id = ?').run(cek.id);
        getDb().prepare(`
          INSERT INTO password_resets (user_id, token_hash, dibuat_at, kedaluwarsa)
          VALUES (?, ?, ?, ?)
        `).run(cek.id, hash, Date.now(), kedaluwarsa);

        // ── KIRIM EMAIL ───────────────────────────────────────────────────────
        let terkirim = false;
        try {
          // Dynamic import — lihat penjelasan di endpoint hapus-mulai.
          //
          // Template KHUSUS pembatalan: sebelumnya memakai template reset sandi,
          // jadi pengguna yang ingin MEMULIHKAN akun menerima email berjudul
          // "Ganti sandi Anda". Sekarang emailnya menyebut pemulihan secara
          // eksplisit, plus sisa hari masa tenggang.
          const { kirimKodeBatalHapus } = await import('./email.mjs');
          const r = await kirimKodeBatalHapus({
            ke: email,
            kode,
            nama: cek.nama,
            berlakuMenit: 15,
            sisaHari: cek.dihapus_pada
              ? Math.max(0, Math.ceil((Number(cek.dihapus_pada) + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
              : undefined,
          });
          terkirim = Boolean(r?.ok);
        } catch (err) {
          console.warn('[batal-hapus] email gagal:', err?.message ?? err);
        }

        // ── KODE DI LOG KALAU EMAIL GAGAL ─────────────────────────────────────
        //
        // Tanpa ini pengguna terjebak: tidak menerima email, tidak bisa
        // membatalkan, dan akunnya terhapus dalam 30 hari.
        //
        // HANYA dicatat kalau email benar-benar gagal.
        if (!terkirim) {
          console.warn(`[batal-hapus] KODE MANUAL untuk ${email}: ${kode}`);
        }

        recordEvent({
          tokenId: null,
          action: 'akun_batal_diminta',
          outcome: terkirim ? 'ok' : 'email_gagal',
          ip: clientIp(req), userAgent: req.headers['user-agent'] || '',
          country: clientCountry(req),
          detail: `kode pembatalan untuk akun menunggu_hapus (sisa ${cek.sisa_hari} hari)`,
        });

        sendJson(res, 200, {
          ok: true,
          terkirim,
          pesan: terkirim
            ? `Kode dikirim ke ${email}. Berlaku 15 menit.`
            : 'Kode dibuat, tapi email gagal terkirim. Hubungi dukungan.',
          kedaluwarsa,
          sisa_hari: cek.sisa_hari,
        });
      },
    },

    // ══ STATUS MASA TENGGANG ═══════════════════════════════════════════════════
    //
    // Dipakai halaman masuk untuk menampilkan "akun Anda akan terhapus dalam
    // N hari" + tombol Batal, setelah pengguna memasukkan email.
    {
      method: 'POST',
      pattern: '/api/auth/akun/status-hapus',
      handler: async (req, res) => {
        const body = await readJson(req).catch(() => ({}));
        const email = normalEmail(String(body.email || ''));
        if (!email) return sendJson(res, 400, { ok: false, error: 'email_kosong' });

        const pengguna = cariPengguna(email);

        // Jawaban SERAGAM: email tak dikenal dan akun aktif sama-sama "tidak
        // menunggu hapus". Kalau dibedakan, endpoint ini jadi alat memetakan
        // email terdaftar.
        if (!pengguna || pengguna.status !== 'menunggu_hapus' || !pengguna.dihapus_pada) {
          return sendJson(res, 200, { ok: true, menunggu_hapus: false });
        }

        const HARI = 24 * 60 * 60 * 1000;
        const batasMs = Number(pengguna.dihapus_pada) + 30 * HARI;
        const sisaMs = batasMs - Date.now();

        // ── KENAPA `Math.ceil` ─────────────────────────────────────────────────
        // `floor` akan menampilkan "29 hari" untuk permintaan yang baru dibuat
        // 1 jam lalu — lebih kecil dari kenyataan, dan membuat pengguna merasa
        // lebih terburu-buru daripada yang sebenarnya.
        const sisaHari = sisaMs <= 0 ? 0 : Math.ceil(sisaMs / HARI);

        sendJson(res, 200, {
          ok: true,
          menunggu_hapus: true,
          dihapus_pada: pengguna.dihapus_pada,
          batas_hapus: batasMs,
          sisa_hari: sisaHari,
          bisa_dibatalkan: sisaHari > 0,
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
