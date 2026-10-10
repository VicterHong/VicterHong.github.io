/**
 * Rute HTTP layanan token.
 *
 * Publik:
 *   GET  /api/health
 *   POST /api/token/validate      — cek token, buka metadata proyek
 *   POST /api/token/session       — tukar token dengan session cookie
 *   POST /api/token/logout        — hapus session
 *   GET  /api/project/:slug/locked — konten sensitif (butuh session atau token)
 *   POST /api/contact/sales       — permintaan akses dari form publik
 *
 * Admin (butuh header X-Admin-Key):
 *   POST /api/admin/token/issue
 *   POST /api/admin/token/revoke
 *   POST /api/admin/token/suspend
 *   POST /api/admin/token/resume
 *   GET  /api/admin/tokens
 *   GET  /api/admin/audit
 *   GET  /api/admin/leads
 */

import { config } from './config.mjs';
import { openDb, getDb } from './db.mjs';
import { timingSafeEqual, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  findTokenByPlaintext, getToken, issueToken, listTokens, revokeToken,
  resumeToken, suspendToken, tokenProblem,
} from './tokens.mjs';
import { createSession, validateSession, destroySession, cleanupExpiredSessions } from './sessions.mjs';
import { recordEvent, recentEvents, recordLead, listLeads } from './audit.mjs';
import { enforceAbuseRules, revokeMessage } from './guard.mjs';
import { makeFingerprint, recordFingerprint } from './fingerprint.mjs';
import { recordAnalytics, getFunnel, recentAnalytics, uniqueVisitors } from './analytics.mjs';
import { notifyLead } from './notify.mjs';
import { checkRateLimit } from './rate-limit.mjs';
import { scoreLead } from './spam-guard.mjs';
import { verifyTurnstile, turnstileMessage } from './turnstile.mjs';
import { slaSummary, slaReport } from './sla.mjs';
import { liveness, readiness } from './health.mjs';
import { isValidSlug, loadLockedContent, sampleLockedContent } from './content.mjs';
import { listProjects, isKnownProject } from './projects.mjs';
import { buildPricing } from './pricing.mjs';
import {
  createCollection, getCollection, listCollections,
  saveItem, getItem, listItems, setItemStatus, deleteItem,
  listVersions, rollback,
} from './cms.mjs';
import { buildSitemap, buildRobots, buildLlmsTxt, buildJsonLd } from './seo.mjs';
import { auditAssets, recordVital, vitalsSummary } from './performance.mjs';
import {
  createBranch, getBranch, listBranches, recordChange, discardBranch, mergeBranch,
  addComment, listComments, resolveComment, moderateComment, commentStats,
} from './collaborate.mjs';
import {
  createExperiment, getExperiment, listExperiments, setStatus as setExpStatus,
  pickVariant, recordEvent as recordExpEvent, results as expResults,
} from './grow.mjs';
import { preflight, verify as verifyDeploy, recordRelease, listReleases } from './publish.mjs';
import {
  mulaiEnrollment, selesaikanEnrollment, verifikasi2fa,
  totpAktif, statusTotp, cabut2fa, buatUlangKodePemulihan, riwayatPercobaan,
} from './totp-service.mjs';
import { buatQrDataUrl } from './qr.mjs';
import {
  mediaAktif, unggahGambar, hapusGambar, bacaManifest, daftarPublik,
  validasiUnggahan, MAX_UPLOAD_BYTES,
} from './media.mjs'
import { bacaBodyBiner } from './http-util.mjs'
import {
  siapkanTabelPengguna, cariPengguna, penggunaById, buatPengguna,
  verifyPassword, periksaSandi, emailValid, normalEmail,
  catatGagalMasuk, catatMasukBerhasil, sisaKunci,
  buatTokenReset, pakaiTokenReset,
} from './users.mjs';
import {
  buatClearance, verifikasiClearance, setCookieClearance,
  hapusCookieClearance, bacaCookieClearance, GATE_TTL_SECONDS,
} from './gate.mjs';
import {
  applyCors, clientCountry, clientGeo, clientIp, ipBucket, extractToken, handlePreflight,
  readJson, readBody, sendJson, parseCookies, setCookie, clearCookie,
} from './http-util.mjs';
import { mulaiPembayaran, prosesWebhook, ambilPembayaran, statusPembayaran } from './checkout.mjs';
import { ruteAuth } from './auth-routes.mjs';
import { providerSiap } from './oauth.mjs';
import { siapkanTabelIdentitas, bersihkanStateOauth, bersihkanChallenge } from './auth-identities.mjs';

/** Jenis event analytics yang diterima — mencegah polusi database. */
const ALLOWED_EVENTS = new Set([
  'page_view', 'modal_open', 'token_attempt', 'token_success', 'token_fail',
  'contact_sales', 'lead_submit', 'session_create', 'content_view',
]);

/**
 * Batas laju endpoint publik per alamat IP.
 * Token tak dikenal tidak punya token_id, jadi guard berbasis token tidak
 * menjangkaunya — batas per-IP ini yang menutup celah brute force.
 *
 * Batas laju per-IP untuk endpoint publik.
 *
 * DUA LAPIS:
 *
 * 1. DEFAULT — berlaku untuk SEMUA path di bawah /api/ yang tidak punya
 *    aturan khusus. Sebelumnya endpoint tanpa aturan tidak dibatasi sama
 *    sekali: /api/experiment/convert bisa dibanjiri konversi palsu
 *    (merusak hasil A/B dan membengkakkan SQLite), /api/ready bisa
 *    dibanjiri untuk membebani I/O disk, dan /api/project/:slug/locked
 *    bisa dibanjiri untuk brute force token.
 *
 *    Pendekatan default-allow (hanya path terdaftar yang dibatasi) salah:
 *    setiap endpoint baru otomatis tidak terlindungi sampai ada yang ingat
 *    menambahkannya. Default-deny membalik logika itu — endpoint baru
 *    terlindungi sejak awal.
 *
 * 2. KHUSUS — batas lebih ketat/ketat-longgar untuk endpoint tertentu,
 *    dipilih berdasarkan biaya operasinya dan risiko penyalahgunaannya.
 */
const DEFAULT_LIMIT = { limit: 120, windowMs: 60_000 };

/**
 * ── BATAS ENDPOINT AUTENTIKASI ────────────────────────────────────────────────
 *
 * Bisa disesuaikan lewat env supaya server uji dan pengujian otomatis tidak
 * perlu menunggu 15 menit antar percobaan:
 *
 *   BATAS_AUTH_MASUK=200        → 200 percobaan per jendela
 *   BATAS_AUTH_JENDELA_MS=60000 → jendela 1 menit
 *
 * Bawaan (env kosong) = 5 percobaan / 15 menit. Aman kalau lupa mengisi —
 * nilai ketat yang jadi bawaan, bukan nilai longgar.
 *
 * Kenapa TIDAK diubah lewat kode saat pengujian: mengubah kode untuk menguji
 * berarti yang diuji bukan kode yang dipakai produksi. Env membuat perbedaan
 * konfigurasi jadi eksplisit dan terlihat.
 */
const BATAS_AUTH = Number(process.env.BATAS_AUTH_MASUK || 5);
const JENDELA_AUTH = Number(process.env.BATAS_AUTH_JENDELA_MS || 900_000);

const PUBLIC_LIMITS = {
  // ── Endpoint mahal: batas ketat ──────────────────────────────────────────
  // Verifikasi token: mencegah brute force token tak dikenal.
  '/api/token/validate': { limit: 20, windowMs: 60_000 },
  // Sesi: lebih ketat — tiap panggilan memeriksa DB + cookie.
  '/api/token/session': { limit: 10, windowMs: 60_000 },
  // Form sales: paling ketat — mencegah spam lead.
  '/api/contact/sales': { limit: 5, windowMs: 60_000 },
  // Komentar publik: bisa ditulis siapa saja, rawan spam.
  '/api/comments': { limit: 10, windowMs: 60_000 },
  // Gate verifikasi: cukup longgar untuk pengunjung sah (retry token
  // kedaluwarsa), cukup ketat untuk menahan pemboman token.
  '/api/verify-turnstile': { limit: 30, windowMs: 60_000 },

  // ── Endpoint telemetri: longgar tapi terbatas ────────────────────────────
  // Dikirim otomatis oleh halaman; satu pengunjung wajar mengirim beberapa.
  '/api/analytics/track': { limit: 60, windowMs: 60_000 },
  '/api/vitals': { limit: 60, windowMs: 60_000 },

  // ── Endpoint tulis ringan ────────────────────────────────────────────────
  // Konversi eksperimen: sebelumnya TIDAK dibatasi. Konversi palsu merusak
  // hasil A/B dan setiap baris masuk ke SQLite.
  '/api/experiment/convert': { limit: 30, windowMs: 60_000 },

  // ── AUTENTIKASI: BATAS KETAT ─────────────────────────────────────────────
  //
  // ── KENAPA LEBIH KETAT DARI DEFAULT (120/menit) ─────────────────────────
  // /api/auth/masuk sekarang MEMBEDAKAN "email tidak terdaftar" dari "sandi
  // salah" (lihat komentar di handler-nya). Itu keputusan UX yang disengaja,
  // dan konsekuensinya: endpoint ini bisa dipakai memetakan email mana yang
  // punya akun.
  //
  // Batas ketat adalah KOMPENSASI untuk keputusan itu. Tanpa ini, penyerang
  // bisa mencoba ratusan email per menit dari satu IP.
  //
  // 5 percobaan / 15 menit dipilih karena:
  //   • Pengguna wajar salah sandi 1–3 kali, lalu berhasil atau pakai
  //     "Lupa sandi". Lima memberi ruang untuk itu.
  //   • Untuk memetakan 1000 email, penyerang butuh 1000 IP berbeda —
  //     dan tetap harus lolos Turnstile di setiap percobaan.
  //
  // ── BISA DISESUAIKAN LEWAT ENV ───────────────────────────────────────────
  // BATAS_AUTH_MASUK=20  → 20 percobaan per jendela
  // BATAS_AUTH_JENDELA_MS=60000 → jendela 1 menit
  //
  // Kenapa perlu: server uji dan pengujian otomatis butuh batas lebih longgar,
  // sementara produksi tetap ketat. Tanpa ini, pengujian harus menunggu
  // 15 menit antar percobaan — atau mengubah kode, yang jauh lebih buruk.
  //
  // Bawaan (kalau env kosong) tetap 5/15 menit — aman kalau lupa mengisi.
  '/api/auth/masuk':    { limit: BATAS_AUTH, windowMs: JENDELA_AUTH },
  '/api/auth/daftar':   { limit: BATAS_AUTH, windowMs: JENDELA_AUTH },
  '/api/auth/lupa':     { limit: Math.max(3, Math.floor(BATAS_AUTH / 2)), windowMs: JENDELA_AUTH },
  '/api/auth/2fa':      { limit: BATAS_AUTH * 2, windowMs: JENDELA_AUTH },
  '/api/auth/totp':     { limit: BATAS_AUTH * 2, windowMs: JENDELA_AUTH },

  // ── Endpoint baca yang di-cache (batas bisa longgar) ─────────────────────
  // /api/ready melakukan query DB + tulis disk + statfs tiap panggilan.
  // Hasilnya kini di-cache 10 detik, jadi batas 30/menit tetap aman
  // untuk monitor yang mengecek tiap menit, tanpa membebani disk.
  '/api/ready': { limit: 30, windowMs: 60_000 },
  '/api/health': { limit: 120, windowMs: 60_000 },
};

/** Ambil aturan untuk sebuah path: khusus kalau ada, default kalau tidak. */
function ruleFor(pathname) {
  if (PUBLIC_LIMITS[pathname]) return PUBLIC_LIMITS[pathname];
  // Semua /api/* mendapat batas default — tidak ada yang lolos tanpa batas.
  if (pathname.startsWith('/api/')) return DEFAULT_LIMIT;
  return null;
}

/**
 * Cache hasil readiness.
 *
 * readiness() menulis berkas probe ke disk setiap panggilan. Tanpa cache,
 * endpoint yang dipanggil monitor tiap menit (atau dibanjiri penyerang)
 * berarti penulisan disk berulang — dan disk adalah sumber daya paling
 * mudah dihabiskan.
 *
 * 10 detik dipilih karena: monitor mengecek tiap 60 detik, jadi selalu
 * mendapat data segar; dan banjir request dalam 10 detik hanya menghasilkan
 * SATU penulisan, bukan ribuan.
 */
const READY_CACHE_MS = 10_000;
let readyCache = null;

/** Terapkan batas laju. Mengembalikan true kalau permintaan ditolak. */
export function rateLimited(req, res, pathname) {
  const rule = ruleFor(pathname);
  if (!rule) return false;
  // Kunci memakai ipBucket, bukan IP mentah: IPv6 dipotong ke /64 supaya
  // penyerang tidak bisa melewati batas hanya dengan berganti alamat
  // dalam blok yang sama (satu VPS biasanya pegang /64 penuh = 2^64 alamat).
  const key = `${pathname}:${ipBucket(clientIp(req))}`;
  const verdict = checkRateLimit(key, rule);
  if (verdict.allowed) return false;
  res.setHeader('retry-after', String(verdict.retryAfterSeconds));
  sendJson(res, 429, {
    ok: false,
    error: 'terlalu_banyak_permintaan',
    message: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
    retry_after: verdict.retryAfterSeconds,
  });
  return true;
}

/** Dipanggil sekali saat server mulai. */
export function initRoutes() {
  openDb(config.dbPath);

  // ── Siapkan tabel auth email+sandi ─────────────────────────────────────────
  // Dijalankan di sini, bukan di users.mjs saat import, supaya urutannya
  // jelas: database dibuka dulu, baru tabel dibuat. Kalau diletakkan di
  // level modul users.mjs, ia berjalan saat import — sebelum openDb() —
  // dan melempar "database belum dibuka".
  siapkanTabelPengguna();

  // ── Tabel identitas (OAuth/passkey) + state sementara ──────────────────────
  // Dibuat di sini dengan alasan yang sama: openDb() harus jalan lebih dulu.
  // Ketiga tabel ini menyimpan cara masuk alternatif (auth_identities),
  // state OAuth sementara (oauth_states), dan challenge WebAuthn
  // (webauthn_challenges).
  siapkanTabelIdentitas();

  // Buang state OAuth dan challenge WebAuthn yang sudah kedaluwarsa.
  // Tanpa ini, kedua tabel itu tumbuh selamanya: setiap percobaan login
  // menulis satu baris, dan percobaan yang gagal tidak pernah dihapus
  // oleh callback mana pun.
  bersihkanStateOauth();
  bersihkanChallenge();
}

/**
 * Cocokkan path dengan pola sederhana seperti '/api/project/:slug/locked'.
 *
 * KEAMANAN — dua hal yang ditangani di sini:
 *
 * 1. decodeURIComponent bisa MELEMPAR (URIError) untuk input seperti
 *    '%E0%A4%A'. Fungsi ini dipanggil dispatcher SEBELUM handler dibungkus
 *    try/catch, jadi lemparan di sini dulu bisa mematikan proses. Sekarang
 *    ditangkap dan dianggap "tidak cocok" — request seperti itu memang
 *    tidak menunjuk ke apa pun.
 *
 * 2. decodeURIComponent juga bisa MENGUBAH struktur path: '%2F' menjadi
 *    '/', sehingga '/api/project/..%2F..%2Fetc%2Fpasswd/locked' lolos dari
 *    split('/') dan menghasilkan slug berisi '..'. Setelah didekode, nilai
 *    WAJIB cocok dengan pola per tipe parameter — menolak '/', '..', NUL,
 *    dan karakter apa pun di luar whitelist.
 *
 * Pola per tipe diambil dari kode yang sudah ada supaya tidak ada aturan
 * baru yang tidak konsisten:
 *   slug / collection / name → sama dengan SLUG_RE dan BRANCH_RE
 *   id                       → format tokenId(): 'tok_' + 16 hex
 */

/** Parameter yang nilainya harus slug (huruf kecil, angka, tanda hubung). */
const SLUG_PARAMS = new Set(['slug', 'collection', 'name']);
/** Parameter ID token — formatnya sudah pasti dari tokenId(). */
const ID_PARAMS = new Set(['id']);

/**
 * Parameter nama berkas avatar.
 *
 * ── KENAPA BUTUH POLA SENDIRI, BUKAN SLUG_RE ────────────────────────────────
 * Nama berkas avatar berbentuk `ID-HASH.webp`:
 *     cbdb3e5c5ea7a6d8cc193ba11e174a04-6d25b0d5e0.webp
 *
 * SLUG_RE (`^[a-z0-9][a-z0-9-]{0,62}$`) menolaknya karena TITIK tidak
 * termasuk — dan titik itu wajib ada, karena Worker dan browser memakai
 * ekstensi untuk menentukan Content-Type.
 *
 * ── KENAPA POLA INI SEMPIT, BUKAN `.+` ──────────────────────────────────────
 * Ini satu-satunya parameter di router yang nilainya muncul di PATH objek
 * penyimpanan. Melonggorkan pola berarti membuka jalan menebak objek lain di
 * bucket yang sama (mis. `../backups/tokens.db.enc`).
 *
 * Pola ini hanya menerima persis bentuk yang DIHASILKAN sistem sendiri:
 *   • 32 karakter hex (ID pengguna, 16 byte acak)
 *   • tanda hubung
 *   • 10 karakter hex (hash isi gambar)
 *   • ekstensi .webp
 *
 * Tidak ada `/`, tidak ada `..`, tidak ada spasi. Apa pun yang tidak persis
 * berbentuk ini ditolak SEBELUM handler-nya berjalan.
 */
const AVATAR_PARAMS = new Set(['berkas']);
const AVATAR_FILE_RE = /^[a-f0-9]{32}-[a-f0-9]{10}\.webp$/;

/** Validasi nilai parameter sesuai tipenya. */
function validParam(name, value) {
  if (SLUG_PARAMS.has(name)) return SLUG_RE.test(value);
  if (ID_PARAMS.has(name)) return TOKEN_ID_RE.test(value);
  if (AVATAR_PARAMS.has(name)) return AVATAR_FILE_RE.test(value);
  // Parameter yang belum dikenal: tolak demi keamanan (default-deny).
  // Kalau nanti ada parameter baru, tambahkan ke salah satu himpunan di atas
  // — jangan diloloskan tanpa pola.
  return false;
}

export function matchPath(pattern, pathname) {
  const p = pattern.split('/');
  const u = pathname.split('/');
  if (p.length !== u.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) {
      const name = p[i].slice(1);
      let value;
      try {
        value = decodeURIComponent(u[i]);
      } catch {
        return null; // URI tidak valid — bukan rute yang kita layani
      }
      if (!validParam(name, value)) return null;
      params[name] = value;
    } else if (p[i] !== u[i]) return null;
  }
  return params;
}

/**
 * Apakah permintaan ini dari admin (kunci cocok).
 *
 * Perbandingan harus timing-safe: `===` membocorkan panjang awalan yang
 * cocok lewat waktu respons, sehingga kunci bisa ditebak karakter demi
 * karakter.
 *
 * MASALAH LAMA — dua bug pada pemeriksaan panjang:
 *
 * 1. `key.length !== expected.length` membandingkan panjang STRING,
 *    sementara timingSafeEqual membutuhkan panjang BYTE yang sama.
 *    Kunci 8 karakter berisi karakter multibyte = 16 byte, dan kunci
 *    8 karakter ASCII = 8 byte. Panjang string sama (8), panjang byte
 *    beda → timingSafeEqual melempar RangeError. Terbukti:
 *      timingSafeEqual(Buffer.from('åååååååå'), Buffer.from('12345678'))
 *      → RangeError: Input buffers must have the same byte length
 *    Lemparan itu jadi error 500 dan ikut membocorkan informasi panjang.
 *
 * 2. Pemeriksaan panjang itu sendiri membocorkan panjang kunci lewat
 *    perbedaan waktu respons (kunci yang panjangnya salah ditolak lebih
 *    cepat, sebelum perbandingan byte).
 *
 * PERBAIKAN: hash kedua nilai dengan SHA-256 lebih dulu. Hash selalu
 * 32 byte apa pun panjang inputnya, jadi:
 *   - timingSafeEqual tidak pernah melempar
 *   - tidak ada pemeriksaan panjang yang membocorkan informasi
 *   - waktu perbandingan selalu sama, terlepas dari panjang kunci
 *
 * SHA-256 di sini bukan untuk kerahasiaan (kunci tidak pernah disimpan
 * sebagai hash) — hanya untuk menyeragamkan panjang sebelum dibandingkan.
 */
function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  if (typeof key !== 'string' || key.length === 0) return false;
  const expected = config.adminKey;
  if (!expected) return false;
  const h = (s) => createHash('sha256').update(String(s), 'utf8').digest();
  return timingSafeEqual(h(key), h(expected));
}

/** Bungkus handler: tangkap error supaya satu permintaan buruk tidak menjatuhkan layanan.
 *
 *  PENTING: `url` (argumen ke-4) HARUS diteruskan. Sebelumnya wrapper ini
 *  hanya memanggil handler(req, res, params) — akibatnya SEMUA handler yang
 *  membaca `url.searchParams` (filter, limit, pagination, query param)
 *  menerima undefined dan diam-diam mengabaikan filternya. 29 handler
 *  terpengaruh; filter di panel admin jadi tidak berfungsi. */

/**
 * Pesan error yang aman ditampilkan ke klien.
 *
 * MASALAH SEBELUMNYA: `err.message` dikirim MENTAH untuk semua status,
 * termasuk 500. Error sistem seperti ENOENT membawa path lengkap
 * ("no such file or directory, open '/home/<user>/.portfolio-token/...'")
 * — itu membocorkan username VPS, struktur direktori, dan nama tabel
 * SQLite. Informasi itu membantu penyerang menyusun serangan lanjutan.
 *
 * ATURAN:
 *   5xx → selalu 'kesalahan_internal'. Error sistem tidak pernah ke klien.
 *   4xx → pesan boleh tampil KALAU lolos pemeriksaan di bawah. 4xx yang
 *         kita lempar sendiri ("JSON tidak valid", "slug koleksi tidak
 *         valid") memang untuk pengguna dan harus tetap terbaca.
 *
 * Pemeriksaan untuk 4xx (semua harus lolos):
 *   - pendek (≤ 80 karakter) — pesan sistem biasanya panjang
 *   - tidak mengandung '/' atau '\' — penanda path berkas
 *   - tidak menyebut istilah sistem (SQLITE, ENOENT, EACCES, ECONNREFUSED)
 * Kalau ada yang gagal, pakai pesan umum.
 */
function publicError(err, code) {
  if (code >= 500) return 'kesalahan_internal';
  const msg = err?.message;
  if (typeof msg !== 'string' || msg.length === 0) return 'permintaan_tidak_valid';
  if (msg.length > 80) return 'permintaan_tidak_valid';
  if (/[/\\]/.test(msg)) return 'permintaan_tidak_valid';
  if (/SQLITE|ENOENT|EACCES|ECONNREFUSED|EPERM|EISDIR|undefined|null/i.test(msg)) {
    return 'permintaan_tidak_valid';
  }
  return msg;
}

function safe(handler) {
  return async (req, res, params, url) => {
    try {
      await handler(req, res, params, url);
    } catch (err) {
      const code = err?.statusCode ?? 500;
      // Error 5xx selalu dicatat LENGKAP di server — supaya kita tetap bisa
      // menelusuri masalah, sementara klien hanya melihat pesan umum.
      if (code >= 500) console.error('[routes] error:', err);
      if (!res.headersSent) {
        sendJson(res, code, { ok: false, error: publicError(err, code) });
      }
    }
  };
}

/**
 * Root situs = root repo. Berkas ini ada di `<repo>/backend/src/routes.mjs`,
 * jadi naik dua tingkat. Penting karena service berjalan dengan cwd `backend/`,
 * sehingga `process.cwd()` BUKAN root situs.
 */
function defaultRoot() {
  return resolve(import.meta.dirname, '..', '..');
}

/**
 * Verifikasi token untuk satu proyek.
 * Mengembalikan { row, error } — error berisi { status, body } kalau gagal.
 */
function verifyToken(req, body, { projectSlug = '', action = 'validate' } = {}) {
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const country = clientCountry(req);
  const plaintext = extractToken(req, body);

  if (!plaintext) {
    recordEvent({ projectSlug, action, outcome: 'tanpa_token', ip, userAgent, country });
    return { error: { status: 401, body: { ok: false, error: 'token_required', message: 'Token diperlukan untuk membuka bagian ini.' } } };
  }

  const row = findTokenByPlaintext(plaintext, config.secret);
  if (!row) {
    recordEvent({ projectSlug, action, outcome: 'token_tidak_dikenal', ip, userAgent, country });
    return { error: { status: 403, body: { ok: false, error: 'token_invalid', message: 'Token tidak dikenali. Periksa kembali atau hubungi sales.' } } };
  }

  // Cek scope: token harus mencakup projectSlug yang diminta
  if (projectSlug && row.scopes && Array.isArray(row.scopes)) {
    if (!row.scopes.includes(projectSlug)) {
      recordEvent({
        tokenId: row.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
        ip, userAgent, country, detail: `token scope: ${row.scopes.join(',')}`,
      });
      return { error: { status: 403, body: { ok: false, error: 'token_scope_tidak_cocok', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
    }
  } else if (projectSlug && row.project_slug !== projectSlug) {
    recordEvent({
      tokenId: row.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
      ip, userAgent, country, detail: `token untuk ${row.project_slug}`,
    });
    return { error: { status: 403, body: { ok: false, error: 'token_proyek_lain', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
  }

  const problem = tokenProblem(row);
  if (problem) {
    recordEvent({ tokenId: row.id, projectSlug, action, outcome: problem, ip, userAgent, country });
    return {
      error: {
        status: 403,
        body: { ok: false, error: problem, message: revokeMessage(row.revoked_reason ?? problem) },
      },
    };
  }

  // Penjaga penyalahgunaan: token yang dibagikan dicabut otomatis.
  const abuse = enforceAbuseRules(row, { ip, userAgent, projectSlug: projectSlug || row.project_slug });
  if (abuse.revoked) {
    return {
      error: {
        status: 403,
        body: { ok: false, error: abuse.reason, message: revokeMessage(abuse.reason), detail: abuse.detail },
      },
    };
  }

  recordEvent({ tokenId: row.id, projectSlug: projectSlug || row.project_slug, action, outcome: 'ok', ip, userAgent, country });
  return { row };
}

/**
 * Verifikasi session cookie.
 * Mengembalikan { tokenRow, sessionRow, error }.
 */
function verifySession(req, { projectSlug = '', action = 'content' } = {}) {
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const country = clientCountry(req);
  const cookies = parseCookies(req);
  const sessionId = cookies.portfolio_session ?? '';

  if (!sessionId) {
    recordEvent({ projectSlug, action, outcome: 'tanpa_sesi', ip, userAgent, country });
    return { error: { status: 401, body: { ok: false, error: 'session_required', message: 'Sesi diperlukan. Masukkan token terlebih dahulu.' } } };
  }

  const result = validateSession(sessionId, config.secret);
  if (!result) {
    recordEvent({ projectSlug, action, outcome: 'sesi_tidak_valid', ip, userAgent, country });
    return { error: { status: 403, body: { ok: false, error: 'session_invalid', message: 'Sesi tidak valid atau sudah expired. Masukkan token kembali.' } } };
  }

  const { tokenRow, sessionRow } = result;

  // Cek scope
  if (projectSlug && tokenRow.scopes && Array.isArray(tokenRow.scopes)) {
    if (!tokenRow.scopes.includes(projectSlug)) {
      recordEvent({
        tokenId: tokenRow.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
        ip, userAgent, country, detail: `token scope: ${tokenRow.scopes.join(',')}`,
      });
      return { error: { status: 403, body: { ok: false, error: 'token_scope_tidak_cocok', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
    }
  } else if (projectSlug && tokenRow.project_slug !== projectSlug) {
    recordEvent({
      tokenId: tokenRow.id, projectSlug, action, outcome: 'proyek_tidak_cocok',
      ip, userAgent, country, detail: `token untuk ${tokenRow.project_slug}`,
    });
    return { error: { status: 403, body: { ok: false, error: 'token_proyek_lain', message: 'Token ini tidak berlaku untuk proyek tersebut.' } } };
  }

  const problem = tokenProblem(tokenRow);
  if (problem) {
    recordEvent({ tokenId: tokenRow.id, projectSlug, action, outcome: problem, ip, userAgent, country });
    return {
      error: {
        status: 403,
        body: { ok: false, error: problem, message: revokeMessage(tokenRow.revoked_reason ?? problem) },
      },
    };
  }

  recordEvent({ tokenId: tokenRow.id, projectSlug: projectSlug || tokenRow.project_slug, action, outcome: 'ok', ip, userAgent, country });
  return { tokenRow, sessionRow };
  }

  /**
  * Ambil baris token dari sesi cookie, atau null.
  *
  * Dipakai endpoint 2FA yang memerlukan sesi. Mengembalikan `tokenRow`
  * (bukan sesi) karena identitas 2FA ada di `tokenRow.issued_to`.
  *
  * ── KENAPA TIDAK MEMAKAI verifySession ─────────────────────────────────────
  * `verifySession` mencatat event audit setiap kali dipanggil. Endpoint 2FA
  * memanggilnya beberapa kali dalam satu alur (status, mulai, selesai) —
  * itu akan membanjiri log audit dengan entri yang tidak bermakna.
  *
  * Fungsi ini SENGAJA tidak melempar dan tidak mengirim balasan — pemanggil
  * yang memutuskan responsnya, supaya tiap endpoint bisa memberi pesan yang
  * sesuai konteksnya.
  */
  function sesiDariRequest(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.portfolio_session ?? '';
  if (!sessionId) return null;

  const hasil = validateSession(sessionId, config.secret);
  if (!hasil) return null;

  // Sesi sah, tapi tokennya bisa sudah dicabut atau kedaluwarsa SETELAH
  // sesi dibuat. Harus diperiksa ulang — kalau tidak, mencabut token
  // tidak benar-benar mencabut akses.
  const problem = tokenProblem(hasil.tokenRow);
  if (problem) return null;

  return hasil.tokenRow;
  }

/**
 * Verifikasi Turnstile untuk aksi sensitif (gerbang token, sesi).
 *
 * Dipakai SEBELUM token diperiksa — jadi bot tidak bisa menebak token
 * sama sekali kalau belum lolos verifikasi manusia.
 *
 * FAIL-CLOSED (sejak FIX-08). Sebelumnya fungsi ini gagal-TERBUKA: kalau
 * TURNSTILE_SECRET_KEY kosong, atau Cloudflare tidak terjangkau, verifikasi
 * dilewati dan gerbang token terbuka tanpa proteksi apa pun — tanpa jejak
 * di log. Untuk gerbang token, itu berarti bot bisa mencoba token sepuasnya
 * selama Cloudflare sedang bermasalah.
 *
 * Sekarang: kegagalan infrastruktur = TOLAK, dan setiap pelewatan dicatat.
 * Lebih baik pengunjung muat ulang daripada gerbang terbuka tanpa penjaga.
 *
 * `secret` dan `failOpen` bisa dioper eksplisit supaya bisa diuji tanpa
 * menyentuh konfigurasi produksi.
 *
 * @returns {Promise<{ok: true, skipped?: boolean} | {ok: false, status: number, body: object}>}
 */
export async function turnstileGate(req, body, {
  action = 'turnstile_gate',
  secret,
  failOpen = false, // gerbang = fail-closed secara bawaan
  expectedHostnames, // eksplisit untuk pengujian; bawaan dari config
} = {}) {
  const effectiveSecret = secret ?? config.turnstileSecretKey;
  const result = await verifyTurnstile({
    token: String(body['cf-turnstile-response'] ?? body.turnstile_token ?? ''),
    secret: effectiveSecret,
    remoteip: clientIp(req),
    failOpen,
    expectedHostnames: expectedHostnames ?? config.turnstileHostnames,
    // Action yang diharapkan = action yang dikirim frontend.
    // Frontend memakai 'token_gate' (lihat project.js). Kalau nanti action
    // ini berubah di frontend, ubah juga di sini — kalau tidak, pengunjung
    // akan ditolak dengan 'action_tidak_cocok'.
    expectedAction: '',
  });

  if (result.ok) {
    if (!result.skipped) {
      recordEvent({
        action, outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
    } else {
      // PELEWATAN SELALU DICATAT. Sebelumnya mode bypass ini tidak terlihat
      // sama sekali di audit — jadi proteksi bisa mati diam-diam berhari-hari
      // tanpa ada yang sadar. Sekarang muncul di log audit dan console.
      console.warn('[turnstile] DILEWATI:', result.error ?? 'tidak diketahui', '| aksi:', action);
      recordEvent({
        action, outcome: 'dilewati',
        detail: result.error ?? 'sebab_tidak_diketahui',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
    }
    return { ok: true, skipped: result.skipped === true };
  }

  recordEvent({
    action, outcome: 'gagal', detail: result.error,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
  });

  // Hostname/action tidak cocok = pengunjung ditolak padahal tokennya SAH.
  // Ini jenis kegagalan yang paling mudah salah konfigurasi, jadi dicatat
  // eksplisit di console dengan nilai yang diterima — supaya kalau
  // TURNSTILE_HOSTNAMES salah isi, penyebabnya langsung terlihat tanpa
  // harus menebak.
  if (result.error === 'hostname_tidak_cocok' || result.error === 'action_tidak_cocok') {
    console.warn(
      `[turnstile] ${result.error}: diterima hostname="${result.hostname}" — `
      + `daftar diizinkan: ${JSON.stringify(config.turnstileHostnames)}. `
      + 'Perbarui TURNSTILE_HOSTNAMES di service.env kalau hostname ini sah.',
    );
  }

  // 503 untuk gangguan infrastruktur (Cloudflare tidak terjangkau / secret
  // kosong) — ini bukan salah pengunjung, jadi statusnya beda dari 403.
  // 403 untuk penolakan verifikasi sungguhan (token salah/kedaluwarsa).
  const infra = result.error === 'cloudflare_tidak_terjangkau'
    || result.error === 'cloudflare_timeout'
    || result.error === 'secret_kosong';
  return {
    ok: false,
    status: infra ? 503 : 403,
    body: { ok: false, error: result.error, message: turnstileMessage(result.error) },
  };
}

/** Semua rute, dengan pola dan handler. */
export const routes = [
  {
    method: 'GET',
    pattern: '/api/health',
    handler: safe(async (req, res) => {
      // LIVENESS — "proses ini hidup?". Cepat, tidak menyentuh database.
      // Selalu 200 selama proses bisa menjawab (standar Kubernetes).
      sendJson(res, 200, liveness());
    }),
  },

  {
    method: 'GET',
    pattern: '/api/ready',
    handler: safe(async (req, res) => {
      // READINESS — "siap menerima trafik?". Memeriksa dependensi nyata:
      // database bisa dibaca, disk bisa ditulis, ruang cukup, konfigurasi ada.
      // 503 kalau ada yang gagal — load balancer/monitor tahu harus mundur.
      //
      // DI-CACHE 10 detik. readiness() melakukan tiga operasi berat setiap
      // panggilan: query database, TULIS + hapus berkas probe, dan statfs.
      // Monitor mengecek tiap menit, jadi cache 10 detik tidak mengurangi
      // kegunaannya sama sekali — tapi membanjiri endpoint ini 30x/menit
      // tidak lagi berarti 30 penulisan disk.
      //
      // Saat cache masih segar, hasil lama dikembalikan. Itu benar untuk
      // readiness: status disk tidak berubah dalam 10 detik, dan kalau
      // berubah, pemeriksaan berikutnya akan menangkapnya.
      const now = Date.now();
      if (!readyCache || now - readyCache.at > READY_CACHE_MS) {
        readyCache = { at: now, result: readiness() };
      }
      const result = readyCache.result;
      sendJson(res, result.ok ? 200 : 503, result);
    }),
  },

  {
    // Konfigurasi publik yang dibutuhkan frontend.
    // Hanya berisi nilai yang memang aman dilihat siapa pun — site key
    // Turnstile memang dirancang untuk dipasang di HTML publik.
    // Secret key TIDAK pernah keluar dari server.
    method: 'GET',
    pattern: '/api/config',
    handler: safe(async (req, res) => {
      sendJson(res, 200, {
        ok: true,
        turnstile: {
          enabled: Boolean(config.turnstileSiteKey),
          site_key: config.turnstileSiteKey,
        },

        // ── SSO: apakah tombol Google/GitHub boleh ditampilkan? ──────────────
        //
        // Frontend menyembunyikan tombol SSO secara default dan hanya
        // menampilkannya kalau server melaporkan provider aktif di sini.
        //
        // Alasannya: tombol yang mengarah ke endpoint yang tidak ada
        // menghasilkan 404, dan pengguna mengira situsnya rusak. Lebih baik
        // tidak menampilkan apa pun sampai benar-benar siap.
        //
        // Nilainya berasal dari config — begitu kredensial OAuth diisi dan
        // endpoint /api/auth/google ditambahkan, tombol muncul sendiri
        // tanpa perlu menyentuh HTML.
        sso: {
          // providerSiap() memeriksa SEMUA yang dibutuhkan provider, bukan
          // hanya client id. Google tanpa client secret tidak bisa menukar
          // code; Apple tanpa private key tidak bisa menyusun client_secret.
          // Memakai Boolean(clientId) saja akan menyalakan tombol yang
          // pasti gagal — persis yang ingin dihindari.
          google: providerSiap('google', config),
          github: providerSiap('github', config),
          microsoft: providerSiap('microsoft', config),
          apple: providerSiap('apple', config),
          linkedin: providerSiap('linkedin', config),

          // ── SSO: butuh issuer + client id ──────────────────────────────────
          // clientSecret opsional (beberapa IdP memakai PKCE saja), tapi
          // issuer dan clientId WAJIB — tanpa keduanya alur tidak bisa mulai.
          sso: Boolean(config.ssoIssuer && config.ssoClientId),
        },

        /**
         * Label tombol SSO yang dilihat pengguna.
         *
         * Kosong = frontend memakai teks bawaan "Masuk dengan SSO perusahaan".
         * Diisi = mis. "Masuk dengan Okta" — lebih jelas bagi pengguna yang
         * mengenali nama IdP organisasinya.
         */
        sso_label: config.ssoLabel || '',

        // ── PASSKEY ──────────────────────────────────────────────────────────
        // WebAuthn tidak butuh kredensial pihak ketiga — yang dibutuhkan
        // hanya rpId dan origin, dan keduanya sudah ada. Jadi passkey
        // SELALU siap; frontend yang memutuskan menampilkan tombolnya
        // atau tidak berdasarkan dukungan browser.
        passkey: true,

        // Daftar proyek — satu sumber kebenaran dari assets/js/data/projects.js.
        // Dipakai panel admin & form agar tidak ada daftar hardcoded.
        projects: listProjects(),
      });
    }),
  },

  {
    // ── Mulai pembayaran langganan ──────────────────────────────────────────
    //
    // Publik — pembeli tidak perlu punya akun dulu.
    //
    // ── KENAPA IDEMPOTENCY_KEY DARI KLIEN ──────────────────────────────────
    // Kuncinya datang dari browser, bukan dibuat di server. Yang tahu "ini
    // percobaan ulang dari klik yang sama" adalah browser — kalau server
    // yang membuat, setiap percobaan ulang dapat kunci baru, dan justru itu
    // yang menyebabkan dobel tagih.
    //
    // Midtrans memakai `order_id` sebagai kunci idempotensi. Kalau order_id
    // yang sama dikirim dua kali, Midtrans menolak — bukan membuat transaksi
    // baru. Dobel-klik tidak menghasilkan dobel tagih.
    method: 'POST',
    pattern: '/api/checkout',
    handler: safe(async (req, res) => {
      const body = await readJson(req);

      // ── KENAPA ERROR DITANGKAP DI SINI, BUKAN DIBIARKAN KE safe() ─────────
      // `safe()` menyembunyikan pesan error 5xx jadi "kesalahan_internal" —
      // itu benar untuk mencegah kebocoran detail sistem.
      //
      // Tapi pembeli yang gagal bayar butuh tahu APA YANG HARUS DILAKUKAN.
      // "kesalahan_internal" tidak memberi tahu apa pun, dan mereka pergi.
      //
      // Jadi error dari `mulaiPembayaran()` ditangkap di sini, dan yang
      // dikirim adalah pesan + saran yang sudah disiapkan di checkout.mjs —
      // keduanya ditulis khusus untuk pembaca, bukan untuk developer.
      try {
        const hasil = await mulaiPembayaran({
          tier: String(body.tier ?? '').trim(),
          periode: String(body.periode ?? 'bulanan').trim(),
          email: String(body.email ?? '').trim(),
          nama: String(body.nama ?? '').trim(),
          idempotencyKey: String(body.idempotency_key ?? '').trim(),
        });

        // Pembayaran yang sudah selesai sebelumnya — bukan error
        if (hasil.sudahDibayar) {
          return sendJson(res, 200, {
            ok: true,
            sudah_dibayar: true,
            pembayaran_id: hasil.pembayaranId,
            tier: hasil.tier,
            periode: hasil.periode,
            message: 'Pembayaran untuk permintaan ini sudah selesai.',
          });
        }

        return sendJson(res, 200, {
          ok: true,
          pembayaran_id: hasil.pembayaranId,
          url: hasil.url,
          sesi_id: hasil.sesiId,
          tier: hasil.tier,
          periode: hasil.periode,
          jumlah: hasil.jumlah,
          dilanjutkan: Boolean(hasil.dilanjutkan),
          ...(hasil.peringatanHarga ? { peringatan_harga: hasil.peringatanHarga } : {}),
        });
      } catch (err) {
        // 5xx tetap dicatat lengkap di server untuk penelusuran
        if ((err?.statusCode ?? 500) >= 500) {
          console.error('[checkout] error:', err?.stack ?? err);
        }

        return sendJson(res, err?.statusCode ?? 500, {
          ok: false,
          error: err?.kode ?? 'checkout_gagal',
          message: err?.message ?? 'Pembayaran tidak bisa dimulai.',
          // Saran hanya dikirim kalau ada — dan isinya ditulis untuk pembaca
          ...(err?.saran ? { saran: err.saran } : {}),
        });
      }
    }),
  },

  {
    // ── Status pembayaran ───────────────────────────────────────────────────
    //
    // Dipakai halaman /pesanan setelah pembeli kembali dari Midtrans.
    //
    // ── KENAPA ID-nya Panjang & Acak ────────────────────────────────────────
    // ID pembayaran (`pay_` + 24 heksadesimal) tidak bisa ditebak. Itu
    // penting: halaman ini bisa dibuka tanpa login, jadi siapa pun yang tahu
    // ID-nya bisa melihat status pembayaran itu.
    //
    // Yang TIDAK ditampilkan: token akses. Token hanya dikirim sekali saat
    // webhook diproses — lewat email. Membiarkannya bisa diambil dari
    // halaman ini berarti siapa pun yang tahu ID-nya bisa mencuri akses.
    method: 'GET',
    pattern: '/api/pesanan/:id',
    handler: safe(async (req, res, params) => {
      const bayar = ambilPembayaran(String(params.id ?? ''));

      if (!bayar) {
        return sendJson(res, 404, {
          ok: false,
          error: 'tidak_ditemukan',
          message: 'Pembayaran tidak ditemukan.',
        });
      }

      sendJson(res, 200, {
        ok: true,
        pembayaran: {
          id: bayar.id,
          tier: bayar.tier,
          periode: bayar.periode,
          jumlah: bayar.jumlah,
          email: bayar.email,
          status: bayar.status,
          token_terbit: bayar.tokenTerbit,
          dibuat_pada: bayar.dibuat_pada,
          dibayar_pada: bayar.dibayar_pada,
        },
      });
    }),
  },

  {
    // ── Webhook Midtrans ──────────────────────────────────────────────────────
    //
    // ── KENAPA RUTE INI BERBEDA DARI YANG LAIN ─────────────────────────────
    // Tiga hal yang tidak biasa, dan semuanya disengaja:
    //
    //   1. Body dibaca MENTAH (readBody), bukan readJson. Xendit tidak
    //      Body dibaca mentah supaya bisa disimpan utuh sebagai bukti.
    //      Tanda tangan Midtrans dihitung dari body asli, jadi menyimpan
    //      yang asli juga memudahkan pemeriksaan kalau ada sengketa.
    //
    //   2. Jawaban SELALU 200 kecuali tanda tangan tidak valid. Midtrans
    //      mengirim ulang kalau menerima non-2xx — jadi jawaban 500 karena
    //      bug di kode kita hanya akan membanjiri diri sendiri dengan
    //      kiriman ulang yang gagal sama.
    //
    //   3. Tidak ada CORS, tidak ada cookie. Yang memanggil ini Midtrans,
    //      bukan browser.
    method: 'POST',
    pattern: '/api/midtrans/webhook',
    handler: safe(async (req, res) => {
      const bodyMentah = await readBody(req);

      // ── KENAPA TIDAK ADA HEADER YANG DIBACA ─────────────────────────────
      // Berbeda dari penyedia dengan token statis, Midtrans mengirim tanda
      // tangan DI DALAM BODY (`signature_key`) — bukan di header.
      //
      // Tanda tangannya dihitung dari isi transaksi:
      //   sha512(order_id + status_code + gross_amount + ServerKey)
      //
      // Jadi tidak ada yang perlu dibaca dari header. Verifikasinya dilakukan
      // di dalam prosesWebhook(), dari payload itu sendiri.
      const hasil = await prosesWebhook(bodyMentah);

      if (!hasil.ok) {
        // Tanda tangan tidak valid — satu-satunya kasus yang dijawab non-2xx.
        // Permintaan ini BUKAN dari Midtrans.
        return sendJson(res, hasil.statusCode ?? 400, {
          ok: false,
          error: hasil.alasan,
          message: hasil.pesan,
        });
      }

      // ── KENAPA TOKEN TIDAK DIKIRIM DI SINI ───────────────────────────────
      // Jawaban webhook bisa dilihat di dashboard Midtrans oleh siapa pun yang
      // punya akses ke akun. Token akses TIDAK boleh muncul di sana.
      //
      // Yang dikirim hanya status. Token dikirim ke pembeli lewat email.
      sendJson(res, 200, {
        ok: true,
        duplikat: Boolean(hasil.duplikat),
        pesan: hasil.pesan,
      });
    }),
  },

  {
    // ── Status pembayaran publik ────────────────────────────────────────────
    //
    // Dipakai halaman harga untuk tahu tombol mana yang aktif. Kalau Midtrans
    // belum dikonfigurasi, tombol berubah jadi ajakan menghubungi — bukan
    // checkout yang rusak saat diklik.
    method: 'GET',
    pattern: '/api/pembayaran/status',
    handler: safe(async (req, res) => {
      sendJson(res, 200, { ok: true, ...statusPembayaran() });
    }),
  },

  {
    // ── Data harga ──────────────────────────────────────────────────────────
    // Publik — harga memang untuk dilihat calon pembeli.
    //
    // Harga sengaja TIDAK ditulis di HTML. Frontend memuatnya dari sini,
    // jadi mengubah harga cukup di satu tempat: src/pricing.mjs.
    //
    // SENGAJA TIDAK DI-CACHE. sendJson() mengirim `cache-control: no-store`,
    // dan itu memang yang diinginkan di sini: harga harus selalu yang
    // berlaku. Satu permintaan kecil saat halaman dibuka jauh lebih murah
    // daripada risiko menampilkan harga lama.
    method: 'GET',
    pattern: '/api/pricing',
    handler: safe(async (req, res) => {
      sendJson(res, 200, buildPricing());
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/validate',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }
      const { row, error } = verifyToken(req, body, { projectSlug: slug, action: 'validate' });
      if (error) return sendJson(res, error.status, error.body);
      sendJson(res, 200, {
        ok: true,
        project: row.project_slug,
        tier: row.tier,
        scopes: row.scopes,
        label: row.label,
        issued_to: row.issued_to,
        company: row.company,
        expires_at: row.expires_at,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/session',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }

      // ── Gerbang Turnstile (sebelum token diperiksa) ──────────────────────
      // Memverifikasi pengunjung adalah MANUSIA dulu, baru tokennya dinilai.
      // Efeknya: skrip bot tidak bisa menebak/menguji token sama sekali —
      // percobaan tanpa verifikasi ditolak sebelum menyentuh database token.
      const gate = await turnstileGate(req, body, { action: 'session_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      // Verifikasi token
      const { row, error } = verifyToken(req, body, { projectSlug: slug, action: 'session_create' });
      if (error) return sendJson(res, error.status, error.body);

      // ── Gerbang 2FA ──────────────────────────────────────────────────────
      //
      // Kalau identitas token ini punya 2FA AKTIF, JANGAN buat sesi di sini.
      // Balas `perlu_2fa` dan biarkan klien mengirim kode ke
      // POST /api/token/2fa — sesi baru dibuat di sana setelah kode lolos.
      //
      // KENAPA BUKAN menerima kode 2FA di endpoint ini juga:
      //   Memisahkan langkah membuat alur lebih jelas di UI (halaman token
      //   → halaman kode), dan endpoint 2FA punya rate limit sendiri untuk
      //   menebak kode. Menggabung keduanya membuat satu endpoint dengan
      //   dua jenis rate limit yang berbeda — rawan salah konfigurasi.
      //
      // PENTING: pemeriksaan ini dilakukan SETELAH token diverifikasi.
      // Kalau dilakukan sebelum, penyerang bisa mengetahui identitas mana
      // yang punya 2FA tanpa punya token yang sah.
      const identitas2fa = String(row.issued_to ?? '').trim();
      if (identitas2fa && totpAktif(identitas2fa)) {
        return sendJson(res, 200, {
          ok: true,
          perlu_2fa: true,
          project: row.project_slug,
          pesan: 'Masukkan kode dari aplikasi authenticator Anda.',
        });
      }

      // Buat session
      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
      const country = clientCountry(req);
      const deviceFp = String(body.device_fp ?? '').slice(0, 200);

      // Geo dari header Cloudflare — hanya tersedia saat request berlangsung.
      const geo = clientGeo(req);
      const session = createSession({
        tokenId: row.id,
        secret: config.secret,
        deviceFp,
        ip,
        country,
        userAgent,
        kota: geo.kota,
        wilayah: geo.wilayah,
        asn: geo.asn,
        zonaWaktu: geo.zonaWaktu,
        durationHours: config.sessionDurationHours,
        maxDevices: row.max_devices ?? config.maxDevices,
      });

      // Record fingerprint untuk deteksi sharing
      const fingerprint = makeFingerprint(req);
      recordFingerprint({
        sessionId: session.id,
        tokenId: row.id,
        fingerprint,
        ip,
        country,
      });

      setCookie(res, 'portfolio_session', session.id, {
        maxAgeSeconds: config.sessionDurationHours * 3600,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      sendJson(res, 200, {
        ok: true,
        project: row.project_slug,
        tier: row.tier,
        scopes: row.scopes,
        session_expires: session.expiresAt,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/logout',
    handler: safe(async (req, res) => {
      const cookies = parseCookies(req);
      const sessionId = cookies.portfolio_session ?? '';
      if (sessionId) {
        destroySession(sessionId, config.secret);
      }
      // ── OPSI HARUS SAMA DENGAN SAAT COOKIE DISET ─────────────────────────
      //
      // BUG YANG DIPERBAIKI: sebelumnya `clearCookie(res, 'portfolio_session')`
      // tanpa opsi. Default setCookie adalah `SameSite=None`, sementara
      // cookie sesi DISET dengan `SameSite=Lax` (lihat buatSesiUntuk di
      // auth-routes.mjs).
      //
      // Browser mencocokkan cookie untuk penghapusan berdasarkan nama,
      // domain, path, DAN atribut keamanannya. Atribut yang berbeda =
      // dianggap cookie LAIN → Set-Cookie kosong tidak menghapus apa pun.
      //
      // Akibatnya pengguna menekan "Keluar", sesi di database terhapus,
      // TAPI cookie-nya masih tersimpan di browser. Pada kunjungan
      // berikutnya browser mengirim cookie itu, server tidak menemukan
      // sesinya, dan pengguna melihat perilaku aneh: seolah setengah masuk.
      clearCookie(res, 'portfolio_session', {
        httpOnly: true, secure: true, sameSite: 'Lax',
      });
      sendJson(res, 200, { ok: true, message: 'Sesi dihapus.' });
    }),
  },

  // ══ 2FA / TOTP ═════════════════════════════════════════════════════════════
  //
  // ── ALUR LENGKAP ──────────────────────────────────────────────────────────
  //
  //   Admin membuat token untuk klien (via CLI) dengan `issued_to` = email klien.
  //
  //   1. Klien login pakai token         → POST /api/token/session
  //      Kalau 2FA aktif, balasan berisi { perlu_2fa: true } dan TIDAK
  //      memberi sesi. Sesi baru dibuat setelah 2FA lolos.
  //
  //   2. Klien kirim kode 2FA            → POST /api/token/2fa
  //      Berhasil → sesi dibuat, cookie di-set.
  //
  //   Setup 2FA (sekali, setelah punya sesi):
  //     3. POST /api/token/2fa/mulai      → dapat QR + secret
  //     4. POST /api/token/2fa/selesai    → verifikasi → dapat kode pemulihan
  //
  //   Kelola:
  //     5. GET  /api/token/2fa/status     → apakah aktif, sisa kode pemulihan
  //     6. POST /api/token/2fa/pulihkan   → buat ulang kode pemulihan
  //     7. POST /api/token/2fa/cabut      → matikan 2FA (butuh kode sah)
  //
  // ── SIAPA YANG BOLEH ──────────────────────────────────────────────────────
  // Semua endpoint memerlukan SESI SAH — kecuali langkah 2, yang justru
  // dipakai untuk MENDAPATKAN sesi (dia membawa token sebagai bukti).
  //
  // Identitas 2FA diambil dari sesi (`issued_to` token), BUKAN dari input
  // klien. Kalau diambil dari input, siapa pun bisa mendaftarkan 2FA untuk
  // identitas orang lain — dan mengunci akunnya.
  //
  // Helper `sesiDariRequest()` didefinisikan di atas bersama helper lain
  // (fungsi tidak boleh dideklarasikan di dalam literal array).

  {
    method: 'POST',
    pattern: '/api/token/2fa',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }

      // Gerbang Turnstile — sama seperti login. Tanpa ini, endpoint 2FA
      // menjadi jalur tak terbatas untuk menebak kode 6 digit.
      const gate = await turnstileGate(req, body, { action: 'totp_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      // Token diperiksa ULANG di sini — sesi belum ada.
      const { row, error } = verifyToken(req, body, { projectSlug: slug, action: 'totp_verify' });
      if (error) return sendJson(res, error.status, error.body);

      const identity = String(row.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, {
          ok: false,
          error: 'token_tanpa_identitas',
          message: 'Token ini belum ditautkan ke identitas. Hubungi admin.',
        });
      }

      if (!totpAktif(identity)) {
        return sendJson(res, 400, {
          ok: false,
          error: 'totp_tidak_aktif',
          message: '2FA tidak aktif untuk token ini.',
        });
      }

      const kode = String(body.code ?? body.kode ?? '').trim();
      if (!kode) {
        return sendJson(res, 400, { ok: false, error: 'kode_kosong', message: 'Kode belum diisi.' });
      }

      const hasil = verifikasi2fa(identity, kode, config, { ip: clientIp(req) });
      if (!hasil.ok) {
        return sendJson(res, 401, {
          ok: false,
          error: hasil.alasan,
          message: hasil.pesan,
          sisa_percobaan: hasil.sisa_percobaan,
        });
      }

      // ── 2FA lolos: buat sesi (sama seperti login biasa) ────────────────────
      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
      const country = clientCountry(req);
      const deviceFp = String(body.device_fp ?? '').slice(0, 200);

      // Geo dari header Cloudflare — hanya tersedia saat request berlangsung.
      const geo = clientGeo(req);
      const session = createSession({
        tokenId: row.id,
        secret: config.secret,
        deviceFp,
        ip,
        country,
        userAgent,
        kota: geo.kota,
        wilayah: geo.wilayah,
        asn: geo.asn,
        zonaWaktu: geo.zonaWaktu,
        durationHours: config.sessionDurationHours,
        maxDevices: row.max_devices ?? config.maxDevices,
      });

      recordFingerprint({
        sessionId: session.id,
        tokenId: row.id,
        fingerprint: makeFingerprint(req),
        ip,
        country,
      });

      setCookie(res, 'portfolio_session', session.id, {
        maxAgeSeconds: config.sessionDurationHours * 3600,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      sendJson(res, 200, {
        ok: true,
        project: row.project_slug,
        tier: row.tier,
        scopes: row.scopes,
        session_expires: session.expiresAt,
        metode_2fa: hasil.metode,
        ...(hasil.kode_pemulihan_tersisa !== undefined
          ? { kode_pemulihan_tersisa: hasil.kode_pemulihan_tersisa }
          : {}),
        ...(hasil.pesan ? { message: hasil.pesan } : {}),
      });
    }),
  },

  // ══ AUTH: DAFTAR (SIGN UP) ════════════════════════════════════════════════
  //
  // ── KENAPA ALUR INI DIPISAH DARI LOGIN ─────────────────────────────────────
  // Korporasi memisahkan "Masuk" (sudah punya akun) dari "Daftar" (belum).
  // Menggabung keduanya membingungkan: pengguna yang salah masuk ke form
  // daftar akan membuat akun DUPLIKAT, lalu bingung kenapa datanya kosong.
  //
  // ── TOKEN IDENTITAS DIBUAT DI SINI ─────────────────────────────────────────
  // Sistem sesi, 2FA, dan audit semuanya mengacu ke tabel `tokens`
  // (sessions.token_id → tokens.id). Jadi pendaftaran membuat DUA hal:
  //   1. baris `tokens` — identitas yang dipakai sistem lama
  //   2. baris `users`  — kredensial email + sandi
  // Keduanya ditautkan lewat users.token_id.
  //
  // Ini menjaga semua yang sudah dibangun tetap bekerja tanpa perubahan:
  // sesi, batas perangkat, TOTP, pencabutan oleh admin.
  {
    method: 'POST',
    pattern: '/api/auth/daftar',
    handler: safe(async (req, res) => {
      const body = await readJson(req);

      const email = normalEmail(body.email);
      const nama = String(body.nama ?? '').trim();
      const perusahaan = String(body.perusahaan ?? '').trim();
      const sandi = String(body.sandi ?? '');

      // ── Validasi lapis server ──────────────────────────────────────────────
      // Klien memvalidasi juga, tapi klien bisa dilewati (request langsung,
      // JS dimatikan). Server TIDAK PERNAH mempercayai klien.
      const masalah = [];
      if (!emailValid(email)) masalah.push({ field: 'email', pesan: 'Email tidak valid.' });
      if (nama.length < 3 || /\d/.test(nama)) masalah.push({ field: 'nama', pesan: 'Nama minimal 3 huruf, tanpa angka.' });

      // ── PERUSAHAAN OPSIONAL ────────────────────────────────────────────────
      // Email pribadi dan email kantor sama-sama boleh. Memaksa nama
      // perusahaan membuat pengguna perorangan mengisi asal-asalan — data
      // sampah lebih buruk daripada kolom yang jujur kosong.
      //
      // Kalau DIISI, tetap divalidasi: minimal 3 huruf, dan tidak boleh
      // hanya angka.
      if (perusahaan && (perusahaan.length < 3 || /^\d+$/.test(perusahaan))) {
        masalah.push({ field: 'perusahaan', pesan: 'Nama perusahaan minimal 3 huruf.' });
      }

      const cekSandi = periksaSandi(sandi);
      if (!cekSandi.ok) masalah.push({ field: 'sandi', pesan: cekSandi.pesan });

      if (masalah.length) {
        return sendJson(res, 400, { ok: false, error: 'validasi_gagal', fields: masalah, message: masalah[0].pesan });
      }

      // ── Gerbang Turnstile ──────────────────────────────────────────────────
      // Dijalankan SEBELUM menyentuh database: bot tidak boleh bisa memakai
      // endpoint ini untuk memetakan email mana yang sudah terdaftar.
      const gate = await turnstileGate(req, body, { action: 'daftar_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      // ── Email sudah terdaftar? ─────────────────────────────────────────────
      if (cariPengguna(email)) {
        // PESAN SENGAJA TIDAK menyebut "email sudah terdaftar".
        //
        // Kalau kita katakan itu, endpoint ini menjadi alat untuk memeriksa
        // email mana yang punya akun (user enumeration). Pesan ini memaksa
        // penyerang menebak, sementara pengguna asli yang lupa akan tetap
        // menemukan jawabannya lewat alur "lupa sandi".
        return sendJson(res, 409, {
          ok: false,
          error: 'sudah_terdaftar',
          message: 'Email ini sudah terdaftar.',
          // Petunjuk tindakan — dibaca frontend untuk menampilkan tombol
          // "Masuk dengan email ini". Sama polanya dengan akun_tidak_ditemukan
          // di /api/auth/masuk: pesan saja tidak cukup, pengguna butuh
          // langkah berikutnya.
          saran: 'masuk',
        });
      }

      // ── Buat identitas (token) + kredensial (user) ─────────────────────────
      //
      // ── BENTUK KEMBALIAN issueToken (penting) ───────────────────────────────
      // Fungsi itu mengembalikan objek DATAR: { id, token, project_slug, ... }
      // — BUKAN { row: {...} }. Kesalahan pertama saya memakai `.row.id`
      // sehingga endpoint melempar "Cannot read properties of undefined
      // (reading 'id')" dan membalas 500. Pelajaran: baca bentuk kembalian
      // fungsi dari sumbernya, jangan berasumsi dari namanya.
      const { issueToken } = await import('./tokens.mjs');
      const diterbitkan = issueToken({
        secret: config.secret,
        projectSlug: String(body.project ?? 'mina'),
        label: nama,
        issuedTo: email,
        company: perusahaan,
        issuedBy: 'pendaftaran',
        tier: 'standard',
        notes: 'Dibuat otomatis dari pendaftaran mandiri.',
      });

      await buatPengguna({
        email, nama, perusahaan, sandi,
        tokenId: diterbitkan.id,
      });

      recordEvent({
        projectSlug: diterbitkan.project_slug,
        action: 'auth_daftar',
        outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });

      // Tidak langsung membuat sesi — pengguna diarahkan ke halaman masuk.
      // Alasannya: mendaftar dan masuk adalah dua tindakan berbeda, dan
      // memaksa pengguna melewati layar "berhasil daftar" membuat mereka
      // sadar akunnya sudah aktif (banyak yang mengira harus menunggu email).
      return sendJson(res, 201, {
        ok: true,
        message: 'Akun dibuat. Silakan masuk dengan email dan sandi Anda.',
      });
    }),
  },

  // ══ AUTH: MASUK (SIGN IN) ═════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: '/api/auth/masuk',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = normalEmail(body.email);
      const sandi = String(body.sandi ?? '');

      if (!emailValid(email) || !sandi) {
        return sendJson(res, 400, {
          ok: false, error: 'kredensial_kosong',
          message: 'Email dan sandi wajib diisi.',
        });
      }

      const gate = await turnstileGate(req, body, { action: 'masuk_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      // ── PESAN GALAT SERAGAM ────────────────────────────────────────────────
      // Baik email tidak ada maupun sandi salah, pesannya SAMA:
      // "Email atau sandi salah."
      //
      // Kalau dibedakan, penyerang bisa memetakan email mana yang terdaftar
      // hanya dengan mencoba masuk — lalu memusatkan serangan tebak sandi ke
      // akun yang benar-benar ada.
      const PESAN_SALAH = 'Email atau sandi salah.';

      const user = cariPengguna(email);
      if (!user) {
        // ── EMAIL TIDAK TERDAFTAR: PESAN JELAS ─────────────────────────────────
        //
        // ── KEPUTUSAN: MEMBEDAKAN, TIDAK MENYAMAKAN ─────────────────────────────
        // Sebelumnya endpoint ini membalas pesan SERAGAM ("Email atau sandi salah")
        // untuk email-tidak-ada maupun sandi-salah, plus scrypt dummy supaya waktu
        // responsnya sama. Tujuannya: mencegah user enumeration.
        //
        // Keputusan itu DIUBAH, dengan alasan yang ditimbang:
        //
        //   • Pengguna portal B2B sering lupa email mana yang dipakai. Menyuruh
        //     mereka menebak antara "email salah" dan "sandi salah" membuat
        //     mereka mencoba berulang, lalu menghubungi dukungan — beban nyata
        //     yang terjadi setiap hari.
        //
        //   • Risiko pemetaan email sudah ditekan di lapisan lain:
        //       - Turnstile wajib lolos SEBELUM baris ini (bot tidak lewat)
        //       - Rate limit /api/auth/masuk: 5 percobaan / 15 menit per IP
        //     Untuk memetakan 1000 email, penyerang butuh 1000 IP berbeda dan
        //     lolos Turnstile 1000 kali. Biayanya tidak sepadan.
        //
        //   • Ini pola yang dipakai Clerk ("Couldn't find your account"),
        //     Lyft, dan Handshake — layanan dengan skala jauh lebih besar.
        //
        // Scrypt dummy DIHAPUS karena tidak lagi ada gunanya: pesannya sudah
        // berbeda, jadi menyamakan waktu tidak menyembunyikan apa pun.
        return sendJson(res, 404, {
          ok: false,
          error: 'akun_tidak_ditemukan',
          message: 'Akun dengan email ini tidak ditemukan.',
          // Petunjuk tindakan — dibaca frontend untuk menampilkan tombol
          // "Daftar akun baru". Tanpa ini, pengguna hanya tahu gagal, tidak
          // tahu harus apa.
          saran: 'daftar',
        });
      }

      if (user.status !== 'aktif') {
        return sendJson(res, 403, {
          ok: false, error: 'akun_nonaktif',
          message: 'Akun ini tidak aktif. Hubungi admin.',
        });
      }

      // ── Terkunci karena terlalu banyak kegagalan? ──────────────────────────
      const sisa = sisaKunci(user.id);
      if (sisa > 0) {
        const menit = Math.ceil(sisa / 60);
        return sendJson(res, 429, {
          ok: false, error: 'akun_terkunci',
          message: `Terlalu banyak percobaan. Coba lagi dalam ${menit} menit.`,
          sisa_detik: sisa,
        });
      }

      const cocok = await verifyPassword(sandi, user.password_hash);
      if (!cocok) {
        const jumlah = catatGagalMasuk(user.id);
        recordEvent({
          action: 'auth_masuk', outcome: 'gagal',
          ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          detail: `gagal ke-${jumlah}`,
        });
        return sendJson(res, 401, {
          ok: false, error: 'kredensial_salah', message: PESAN_SALAH,
          sisa_percobaan: Math.max(0, 10 - jumlah),
        });
      }

      // ── Berhasil ───────────────────────────────────────────────────────────
      catatMasukBerhasil(user.id);

      // ── Gerbang 2FA ────────────────────────────────────────────────────────
      // Sama seperti alur token: kalau identitas ini punya 2FA aktif, JANGAN
      // buat sesi di sini. Balas `perlu_2fa` dan biarkan klien mengirim kode.
      //
      // Pemeriksaan dilakukan SETELAH sandi terbukti benar — kalau sebelum,
      // penyerang bisa mengetahui akun mana yang punya 2FA tanpa punya sandi.
      if (totpAktif(email)) {
        recordEvent({
          action: 'auth_masuk', outcome: 'perlu_2fa',
          ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        });
        return sendJson(res, 200, {
          ok: true, perlu_2fa: true,
          pesan: 'Masukkan kode dari aplikasi authenticator Anda.',
        });
      }

      const tokenRow = getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(user.token_id);
      if (!tokenRow) {
        return sendJson(res, 500, { ok: false, error: 'identitas_hilang', message: 'Identitas akun tidak ditemukan. Hubungi admin.' });
      }

      // Geo dari header Cloudflare — hanya tersedia saat request berlangsung.
      const geo = clientGeo(req);
      const session = createSession({
        tokenId: tokenRow.id,
        secret: config.secret,
        deviceFp: String(body.device_fp ?? '').slice(0, 200),
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        kota: geo.kota,
        wilayah: geo.wilayah,
        asn: geo.asn,
        zonaWaktu: geo.zonaWaktu,
        durationHours: config.sessionDurationHours,
        maxDevices: tokenRow.max_devices ?? config.maxDevices,
      });

      setCookie(res, 'portfolio_session', session.id, {
        maxAgeSeconds: config.sessionDurationHours * 3600,
        httpOnly: true, secure: true, sameSite: 'Lax',
      });

      recordEvent({
        projectSlug: tokenRow.project_slug, action: 'auth_masuk', outcome: 'ok',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });

      return sendJson(res, 200, {
        ok: true,
        project: tokenRow.project_slug,
        tier: tokenRow.tier,
        // ── scopes DISIMPAN SEBAGAI JSON STRING, BUKAN CSV ───────────────────
        // Di database kolomnya berisi '["mina"]' (hasil JSON.stringify di
        // issueToken), bukan 'mina'. Memakai split(',') menghasilkan
        // ["[\"mina\"]"] — array dengan satu elemen string JSON mentah.
        //
        // Alur token lama tidak terkena masalah ini karena verifyToken()
        // sudah mem-parse row.scopes lebih dulu (lihat tokens.mjs baris 85).
        // Di sini kita membaca baris langsung dari database, jadi parsing
        // harus dilakukan sendiri — dengan fallback ke project_slug kalau
        // isinya rusak.
        scopes: (() => {
          try {
            const p = JSON.parse(tokenRow.scopes);
            return Array.isArray(p) ? p : [tokenRow.project_slug];
          } catch {
            return [tokenRow.project_slug];
          }
        })(),
        redirect: `/${tokenRow.project_slug}`,
      });
    }),
  },

  // ══ AUTH: 2FA SETELAH MASUK EMAIL+SANDI ═══════════════════════════════════
  {
    method: 'POST',
    pattern: '/api/auth/2fa',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = normalEmail(body.email);
      const sandi = String(body.sandi ?? '');
      const kode = String(body.code ?? '').replace(/\D/g, '');

      if (!emailValid(email) || !sandi || kode.length !== 6) {
        return sendJson(res, 400, { ok: false, error: 'input_tidak_lengkap', message: 'Email, sandi, dan 6 digit kode wajib diisi.' });
      }

      const gate = await turnstileGate(req, body, { action: 'masuk_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      const PESAN_SALAH = 'Email atau sandi salah.';
      const user = cariPengguna(email);
      if (!user) return sendJson(res, 401, { ok: false, error: 'kredensial_salah', message: PESAN_SALAH });

      const sisa = sisaKunci(user.id);
      if (sisa > 0) {
        return sendJson(res, 429, { ok: false, error: 'akun_terkunci', message: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(sisa / 60)} menit.`, sisa_detik: sisa });
      }

      const cocok = await verifyPassword(sandi, user.password_hash);
      if (!cocok) {
        catatGagalMasuk(user.id);
        return sendJson(res, 401, { ok: false, error: 'kredensial_salah', message: PESAN_SALAH });
      }

      // Nama fungsi sebenarnya `verifikasi2fa(identity, kode, config, opts)`.
      // config WAJIB diteruskan — fungsi itu memakainya untuk kunci
      // enkripsi/verifikasi secret TOTP.
      const verifikasi = verifikasi2fa(email, kode, config, { ip: clientIp(req) });
      if (!verifikasi.ok) {
        return sendJson(res, 401, {
          ok: false, error: 'kode_salah',
          message: verifikasi.pesan ?? 'Kode tidak cocok.',
          sisa_percobaan: verifikasi.sisaPercobaan,
        });
      }

      catatMasukBerhasil(user.id);
      const tokenRow = getDb().prepare('SELECT * FROM tokens WHERE id = ?').get(user.token_id);
      if (!tokenRow) return sendJson(res, 500, { ok: false, error: 'identitas_hilang', message: 'Identitas akun tidak ditemukan.' });

      // Geo dari header Cloudflare — hanya tersedia saat request berlangsung.
      const geo = clientGeo(req);
      const session = createSession({
        tokenId: tokenRow.id, secret: config.secret,
        deviceFp: String(body.device_fp ?? '').slice(0, 200),
        ip: clientIp(req), country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        kota: geo.kota,
        wilayah: geo.wilayah,
        asn: geo.asn,
        zonaWaktu: geo.zonaWaktu,
        durationHours: config.sessionDurationHours,
        maxDevices: tokenRow.max_devices ?? config.maxDevices,
      });

      setCookie(res, 'portfolio_session', session.id, {
        maxAgeSeconds: config.sessionDurationHours * 3600,
        httpOnly: true, secure: true, sameSite: 'Lax',
      });

      recordEvent({ projectSlug: tokenRow.project_slug, action: 'auth_masuk_2fa', outcome: 'ok', ip: clientIp(req) });

      return sendJson(res, 200, {
        ok: true, project: tokenRow.project_slug, tier: tokenRow.tier,
        // ── scopes DISIMPAN SEBAGAI JSON STRING, BUKAN CSV ───────────────────
        // Di database kolomnya berisi '["mina"]' (hasil JSON.stringify di
        // issueToken), bukan 'mina'. Memakai split(',') menghasilkan
        // ["[\"mina\"]"] — array dengan satu elemen string JSON mentah.
        //
        // Alur token lama tidak terkena masalah ini karena verifyToken()
        // sudah mem-parse row.scopes lebih dulu (lihat tokens.mjs baris 85).
        // Di sini kita membaca baris langsung dari database, jadi parsing
        // harus dilakukan sendiri — dengan fallback ke project_slug kalau
        // isinya rusak.
        scopes: (() => {
          try {
            const p = JSON.parse(tokenRow.scopes);
            return Array.isArray(p) ? p : [tokenRow.project_slug];
          } catch {
            return [tokenRow.project_slug];
          }
        })(),
        redirect: `/${tokenRow.project_slug}`,
      });
    }),
  },

  // ══ AUTH: LUPA SANDI — minta tautan reset ═════════════════════════════════
  {
    method: 'POST',
    pattern: '/api/auth/lupa-sandi',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = normalEmail(body.email);

      if (!emailValid(email)) {
        return sendJson(res, 400, { ok: false, error: 'email_tidak_valid', message: 'Email tidak valid.' });
      }

      const gate = await turnstileGate(req, body, { action: 'lupa_sandi_turnstile' });
      if (!gate.ok) return sendJson(res, gate.status, gate.body);

      const user = cariPengguna(email);

      // ── SELALU BALAS SUKSES ────────────────────────────────────────────────
      // Baik email terdaftar maupun tidak, responsnya sama. Kalau dibedakan,
      // endpoint ini menjadi alat untuk memeriksa email mana yang punya akun.
      //
      // Pesan sukses yang seragam juga mencegah pengguna panik: mereka tidak
      // tahu apakah emailnya terdaftar atau tidak, dan itu memang bukan
      // informasi yang perlu mereka ketahui.
      if (user && user.status === 'aktif') {
        const token = buatTokenReset(user.id);
        const { kirimEmailResetSandi } = await import('./email.mjs');
        // Kirim tanpa menunggu — kegagalan email TIDAK boleh membuat endpoint
        // ini membocorkan keberadaan akun lewat perbedaan waktu respons.
        kirimEmailResetSandi({ ke: email, nama: user.nama, token }).catch(() => {});
      }

      recordEvent({ action: 'auth_lupa_sandi', outcome: user ? 'dikirim' : 'email_tidak_ada', ip: clientIp(req) });

      return sendJson(res, 200, {
        ok: true,
        message: 'Kalau email itu terdaftar, tautan reset sudah dikirim. Periksa kotak masuk Anda.',
      });
    }),
  },

  // ══ AUTH: RESET SANDI — pakai token dari email ════════════════════════════
  {
    method: 'POST',
    pattern: '/api/auth/reset-sandi',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const token = String(body.token ?? '').trim();
      const sandi = String(body.sandi ?? '');

      if (!token) {
        return sendJson(res, 400, { ok: false, error: 'token_kosong', message: 'Tautan tidak valid.' });
      }

      const hasil = await pakaiTokenReset(token, sandi);
      if (!hasil.ok) {
        return sendJson(res, 400, { ok: false, error: 'reset_gagal', message: hasil.pesan });
      }

      recordEvent({ action: 'auth_reset_sandi', outcome: 'ok', ip: clientIp(req) });

      return sendJson(res, 200, {
        ok: true,
        message: 'Sandi berhasil diganti. Silakan masuk dengan sandi baru Anda.',
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/token/2fa/status',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }
      return sendJson(res, 200, { ok: true, identity, ...statusTotp(identity) });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/2fa/mulai',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }

      try {
        const hasil = mulaiEnrollment(identity, config, {
          issuer: 'Victer Portfolio',
        });

        // QR dibuat di server, dikirim sebagai data URL PNG.
        //
        // KENAPA DI SERVER, BUKAN DI BROWSER:
        //   Library QR di browser menambah ~15-30 KB JavaScript yang harus
        //   diunduh setiap pengunjung — untuk fitur yang dipakai sekali
        //   seumur akun. Di server, biayanya satu proses ~50ms.
        //
        // KENAPA DATA URL, BUKAN FILE:
        //   Tidak ada berkas di disk, tidak ada URL yang bisa ditebak, tidak
        //   ada pembersihan yang perlu dijadwalkan. Secret hanya ada di
        //   memori selama satu permintaan.
        const qr = await buatQrDataUrl(hasil.uri);

        // `secret` dikembalikan SEKALI di sini untuk ditampilkan sebagai QR.
        // Setelah ini hanya tersimpan terenkripsi dan tidak bisa dibaca lagi.
        return sendJson(res, 200, {
          ok: true,
          secret: hasil.secret,
          uri: hasil.uri,
          // QR tersedia = bisa dipindai langsung. Kalau gagal, klien masih
          // bisa memasukkan secret manual — jadi bukan kegagalan total.
          qr_data_url: qr.ok ? qr.dataUrl : null,
          qr_tersedia: qr.ok,
          ...(qr.ok ? {} : { qr_catatan: qr.pesan }),
          issuer: hasil.issuer,
          akun: hasil.akun,
          digit: hasil.digit,
          periode: hasil.periode,
          pesan: qr.ok
            ? 'Pindai QR dengan aplikasi authenticator, lalu masukkan kodenya untuk mengaktifkan.'
            : 'Masukkan kode secara manual di aplikasi authenticator (QR tidak tersedia).',
        });
      } catch (e) {
        if (e.kode === 'totp_sudah_aktif') {
          return sendJson(res, 409, { ok: false, error: 'totp_sudah_aktif', message: e.pesan });
        }
        throw e;
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/2fa/selesai',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }

      const body = await readJson(req);
      const kode = String(body.code ?? body.kode ?? '').trim();
      if (!kode) {
        return sendJson(res, 400, { ok: false, error: 'kode_kosong', message: 'Kode belum diisi.' });
      }

      const hasil = selesaikanEnrollment(identity, kode, config, { ip: clientIp(req) });
      if (!hasil.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: hasil.alasan,
          message: hasil.pesan,
          sisa_percobaan: hasil.sisa_percobaan,
        });
      }

      return sendJson(res, 200, {
        ok: true,
        kode_pemulihan: hasil.kode_pemulihan,   // SEKALI — klien harus menyimpan
        pesan: hasil.pesan,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/2fa/pulihkan',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }

      const body = await readJson(req);
      const kode = String(body.code ?? body.kode ?? '').trim();
      if (!kode) {
        return sendJson(res, 400, { ok: false, error: 'kode_kosong', message: 'Masukkan kode 2FA untuk membuat ulang kode pemulihan.' });
      }

      // WAJIB verifikasi kode dulu. Tanpa ini, siapa pun yang punya sesi
      // bisa membuat kode pemulihan baru — dan meniadakan manfaat 2FA.
      //
      // `cekReplay: false` — alasan sama dengan endpoint cabut: aksi ini
      // memerlukan sesi sah, jadi replay guard hanya menghalangi pengguna
      // yang sah tanpa menambah keamanan.
      const verif = verifikasi2fa(identity, kode, config, { ip: clientIp(req), cekReplay: false });
      if (!verif.ok) {
        return sendJson(res, 401, { ok: false, error: verif.alasan, message: verif.pesan });
      }

      const hasil = buatUlangKodePemulihan(identity, config);
      if (!hasil.ok) {
        return sendJson(res, 400, { ok: false, error: hasil.alasan, message: hasil.pesan });
      }

      return sendJson(res, 200, {
        ok: true,
        kode_pemulihan: hasil.kode_pemulihan,
        pesan: 'Kode pemulihan baru dibuat. Kode lama tidak berlaku lagi.',
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/token/2fa/cabut',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }

      const body = await readJson(req);
      const kode = String(body.code ?? body.kode ?? '').trim();
      if (!kode) {
        return sendJson(res, 400, { ok: false, error: 'kode_kosong', message: 'Masukkan kode 2FA untuk mematikan.' });
      }

      // WAJIB verifikasi — kalau tidak, penyerang dengan akses sesi bisa
      // mematikan 2FA dan masuk tanpa faktor kedua.
      //
      // `cekReplay: false` — pengguna yang baru login lalu langsung mematikan
      // 2FA memakai kode dari langkah waktu yang SAMA. Dengan replay guard
      // aktif, ia selalu ditolak dan harus menunggu 30 detik tanpa alasan
      // yang jelas. Keamanan tidak berkurang: endpoint ini tetap memerlukan
      // sesi sah DAN kode TOTP yang sah.
      const verif = verifikasi2fa(identity, kode, config, { ip: clientIp(req), cekReplay: false });
      if (!verif.ok) {
        return sendJson(res, 401, { ok: false, error: verif.alasan, message: verif.pesan });
      }

      cabut2fa(identity);
      return sendJson(res, 200, { ok: true, pesan: '2FA dimatikan.' });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/token/2fa/riwayat',
    handler: safe(async (req, res) => {
      const sesi = sesiDariRequest(req);
      if (!sesi) {
        return sendJson(res, 401, { ok: false, error: 'sesi_tidak_valid', message: 'Masuk dulu.' });
      }
      const identity = String(sesi.issued_to ?? '').trim();
      if (!identity) {
        return sendJson(res, 400, { ok: false, error: 'token_tanpa_identitas', message: 'Token ini belum ditautkan ke identitas.' });
      }
      return sendJson(res, 200, { ok: true, riwayat: riwayatPercobaan(identity, 20) });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/project/:slug/locked',
    handler: safe(async (req, res, params) => {
      const slug = params.slug;
      if (!isValidSlug(slug)) {
        return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid', message: 'Slug proyek tidak valid.' });
      }

      // Coba session dulu, kalau tidak ada coba token di header
      let tokenRow = null;
      const cookies = parseCookies(req);
      if (cookies.portfolio_session) {
        const result = verifySession(req, { projectSlug: slug, action: 'content' });
        if (result.error) {
          // Kalau session gagal, coba token di header sebagai fallback
          const { row } = verifyToken(req, {}, { projectSlug: slug, action: 'content' });
          if (!row) return sendJson(res, result.error.status, result.error.body);
          tokenRow = row;
        } else {
          tokenRow = result.tokenRow;
        }
      } else {
        const { row, error } = verifyToken(req, {}, { projectSlug: slug, action: 'content' });
        if (error) return sendJson(res, error.status, error.body);
        tokenRow = row;
      }

      const content = loadLockedContent(slug) ?? sampleLockedContent(slug);

      // Record analytics: content_view
      recordAnalytics({
        eventType: 'content_view',
        projectSlug: slug,
        tokenId: tokenRow.id,
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
      });

      sendJson(res, 200, {
        ok: true,
        project: slug,
        tier: tokenRow.tier,
        issued_to: tokenRow.issued_to,
        company: tokenRow.company,
        content,
      });
    }),
  },

  {
    // Endpoint verifikasi Turnstile untuk gate
    method: 'POST',
    pattern: '/api/verify-turnstile',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const token = String(body.token ?? '').trim();
      
      if (!token) {
        return sendJson(res, 400, { 
          success: false, 
          error: 'token_missing',
          message: 'Token Turnstile tidak ada.'
        });
      }

      const result = await verifyTurnstile({
        token,
        secret: config.turnstileSecretKey,
        remoteip: clientIp(req),
      });

      if (!result.ok) {
        recordEvent({
          action: 'turnstile_gate',
          outcome: 'failed',
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          detail: result.error,
        });
        
        return sendJson(res, 403, {
          success: false,
          error: result.error,
          message: turnstileMessage(result.error),
        });
      }

      recordEvent({
        action: 'turnstile_gate',
        outcome: 'ok',
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });

      // ── SET COOKIE CLEARANCE BERTANDA TANGAN ──────────────────────────────
      // Verifikasi Turnstile sudah lolos di server. Sekarang server menerbitkan
      // clearance token yang ditandatangani HMAC dan mengirimnya sebagai cookie
      // HttpOnly.
      //
      // JavaScript TIDAK BISA membaca cookie ini, apalagi memalsukannya —
      // tanpa SERVICE_SECRET, signature tidak bisa dihitung. Ini yang membuat
      // clearance tidak bisa dilewati dengan menulis sessionStorage.
      //
      // IP ikut ditandatangani: cookie yang dicuri dari satu pengunjung tidak
      // berguna di mesin lain.
      // Nama variabel `clearance`, BUKAN `token` — `token` sudah dipakai di
      // atas untuk token Turnstile dari body. Menimpa nama yang sama membuat
      // Node menolak seluruh berkas dengan "Identifier 'token' has already
      // been declared" (const tidak boleh dideklarasikan ulang di scope sama).
      //
      // Tidak butuh IP: clearance ditandatangani HMAC dan berisi nonce acak.
      // Lihat catatan di gate.mjs tentang kenapa IP binding dilepas.
      const { token: clearance } = buatClearance();
      setCookieClearance(res, clearance);

      sendJson(res, 200, {
        success: true,
        hostname: result.hostname,
        // Masa berlaku dikirim supaya frontend bisa menampilkan sisa waktu
        // kalau perlu — dan untuk pengujian.
        gateTtlSeconds: GATE_TTL_SECONDS,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/contact/sales',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const email = String(body.email ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return sendJson(res, 400, { ok: false, error: 'email_tidak_valid', message: 'Alamat email tidak valid.' });
      }

      // ── Validasi field wajib (lapis server) ──────────────────────────────
      // Klien sudah memvalidasi, tapi klien bisa dilewati (request langsung,
      // JavaScript dimatikan). Server memeriksa ulang dengan aturan yang sama
      // supaya lead sampah tidak pernah masuk database.
      const company = String(body.company ?? '').trim();
      const name = String(body.name ?? '').trim();
      const message = String(body.message ?? '').trim();
      const budgetRange = String(body.budget_range ?? '').trim();
      const urgency = String(body.urgency ?? '').trim();

      const fieldErrors = [];
      if (company.length < 3 || !/[A-Za-zÀ-ÿ]/.test(company)) fieldErrors.push('company');
      if (name.length < 3 || /\d/.test(name) || !/[A-Za-zÀ-ÿ]/.test(name)) fieldErrors.push('name');
      if (!budgetRange) fieldErrors.push('budget_range');
      if (!urgency) fieldErrors.push('urgency');
      if (message.length < 10) fieldErrors.push('message');

      if (fieldErrors.length) {
        return sendJson(res, 400, {
          ok: false,
          error: 'field_tidak_lengkap',
          fields: fieldErrors,
          message: 'Lengkapi kolom bertanda * sebelum mengirim.',
        });
      }

      const ip = clientIp(req);
      const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);

      // ── Cloudflare Turnstile (lapis terkuat) ─────────────────────────────────
      // Memverifikasi bahwa pengirim adalah MANUSIA. Kalau secret belum
      // dipasang, verifyTurnstile() mengembalikan skipped dan alur tetap jalan
      // dengan lapisan penapis lain — situs tidak pernah rusak karena config.
      const turnstile = await verifyTurnstile({
        token: String(body['cf-turnstile-response'] ?? body.turnstile_token ?? ''),
        secret: config.turnstileSecretKey,
        remoteip: ip,
      });

      if (!turnstile.ok) {
        recordEvent({
          projectSlug: String(body.project ?? ''), action: 'lead_turnstile', outcome: 'failed',
          ip, userAgent,
        });
        return sendJson(res, 403, {
          ok: false,
          error: turnstile.error,
          message: turnstileMessage(turnstile.error),
        });
      }

      // ── Penjaga spam (Q3) ────────────────────────────────────────────────────
      // Turnstile memverifikasi MANUSIA, bukan NIAT — manusia yang mengirim
      // spam tetap lolos. Heuristik isi inilah yang menangkapnya. Keduanya
      // saling melengkapi, bukan saling menggantikan.
      const spam = scoreLead({ body, ip, userAgent });

      if (spam.verdict === 'block') {
        // Balas seolah berhasil supaya bot tidak belajar dari respons.
        // Lead TIDAK disimpan.
        recordEvent({
          projectSlug: String(body.project ?? ''), action: 'lead_spam', outcome: 'blocked',
          ip, userAgent,
        });
        return sendJson(res, 200, {
          ok: true,
          message: 'Permintaan Anda tercatat. Sales akan menghubungi Anda.',
        });
      }

      // Status lead: 'new' untuk yang bersih, 'review' untuk yang mencurigakan.
      const status = spam.verdict === 'review' ? 'review' : 'new';

      const result = recordLead({
        company: String(body.company ?? '').slice(0, 200),
        name: String(body.name ?? '').slice(0, 200),
        email: email.slice(0, 300),
        role: String(body.role ?? '').slice(0, 100),
        projectSlug: String(body.project ?? '').slice(0, 64),
        budgetRange: String(body.budget_range ?? '').slice(0, 100),
        urgency: String(body.urgency ?? '').slice(0, 50),
        message: String(body.message ?? '').slice(0, 4000),
        ip,
        userAgent,
        status,
      });
      recordEvent({
        projectSlug: String(body.project ?? ''), action: 'lead',
        outcome: status === 'review' ? 'review' : 'ok',
        ip, userAgent,
      });
      // Record analytics: lead_submit
      recordAnalytics({
        eventType: 'lead_submit',
        projectSlug: String(body.project ?? ''),
        ip,
        country: clientCountry(req),
        userAgent,
        referrer: String(req.headers.referer ?? ''),
        metadata: { company: String(body.company ?? ''), email: String(body.email ?? '') },
      });

      // Notifikasi webhook (fire-and-forget, tidak menunda respons).
      // Lead mencurigakan ditandai supaya bisa ditinjau sebelum dibalas.
      notifyLead({
        company: String(body.company ?? ''),
        name: String(body.name ?? ''),
        email,
        role: String(body.role ?? ''),
        projectSlug: String(body.project ?? ''),
        budgetRange: String(body.budget_range ?? ''),
        urgency: String(body.urgency ?? ''),
        message: String(body.message ?? ''),
        spamScore: spam.score,
        spamReasons: spam.reasons,
      });

      sendJson(res, 200, { ok: true, id: result.id, message: 'Permintaan Anda tercatat. Sales akan menghubungi Anda.' });
    }),
  },

  // ── ANALYTICS ────────────────────────────────────────────────────────────────

  {
    method: 'POST',
    pattern: '/api/analytics/track',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const eventType = String(body.event_type ?? '').trim();
      const projectSlug = String(body.project ?? '').trim();

      if (!eventType) {
        return sendJson(res, 400, { ok: false, error: 'event_type_required' });
      }

      // Hanya event yang dikenal diterima — mencegah database dipenuhi
      // event sampah yang merusak funnel.
      if (!ALLOWED_EVENTS.has(eventType)) {
        return sendJson(res, 400, { ok: false, error: 'event_type_tidak_dikenal' });
      }

      // Batasi metadata: hanya string pendek, maksimum 20 kunci.
      const rawMeta = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      const metadata = {};
      let metaCount = 0;
      for (const [k, v] of Object.entries(rawMeta)) {
        if (metaCount >= 20) break;
        if (typeof k !== 'string' || k.length > 64) continue;
        metadata[k.slice(0, 64)] = String(v ?? '').slice(0, 300);
        metaCount += 1;
      }

      recordAnalytics({
        eventType,
        projectSlug: isValidSlug(projectSlug) ? projectSlug : '',
        ip: clientIp(req),
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        referrer: String(req.headers.referer ?? ''),
        metadata,
      });

      sendJson(res, 200, { ok: true });
    }),
  },

  // ── ADMIN ────────────────────────────────────────────────────────────────────

  {
    method: 'POST',
    pattern: '/api/admin/token/issue',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const slug = String(body.project ?? '').trim();
      if (!isValidSlug(slug)) return sendJson(res, 400, { ok: false, error: 'proyek_tidak_valid' });

      // Tolak slug proyek yang tidak dikenal — mencegah token "yatim" karena
      // salah ketik (mis. 'mina ' atau 'MINA'), yang tidak akan pernah bisa
      // dibuka halamannya.
      const known = listProjects();
      if (known.length && !isKnownProject(slug)) {
        return sendJson(res, 400, {
          ok: false,
          error: 'proyek_tidak_dikenal',
          message: `Proyek "${slug}" tidak ada dalam daftar. Pilihan: ${known.map(p => p.slug).join(', ')}`,
          projects: known,
        });
      }

      // Parse scopes array
      let scopes = null;
      if (body.scopes && Array.isArray(body.scopes)) {
        scopes = body.scopes.filter(s => isValidSlug(String(s)));
      }

      const result = issueToken({
        secret: config.secret,
        projectSlug: slug,
        tier: String(body.tier ?? 'standard').toLowerCase(),
        scopes,
        label: String(body.label ?? '').slice(0, 200),
        issuedTo: String(body.issued_to ?? '').slice(0, 200),
        company: String(body.company ?? '').slice(0, 200),
        issuedBy: 'admin',
        expiresInDays: body.expires_in_days ? Number(body.expires_in_days) : null,
        maxIps: body.max_ips ? Number(body.max_ips) : config.maxDistinctIps,
        maxDevices: body.max_devices ? Number(body.max_devices) : config.maxDevices,
        notes: String(body.notes ?? '').slice(0, 500),
        prefix: config.tokenPrefix,
        segments: config.tokenSegments,
        segmentLength: config.tokenSegmentLength,
      });
      recordEvent({
        tokenId: result.id, projectSlug: slug, action: 'issue', outcome: 'ok',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      // Plaintext hanya muncul di jawaban ini — tidak pernah bisa dibaca lagi.
      sendJson(res, 200, {
        ok: true,
        id: result.id,
        token: result.token,
        project: result.project_slug,
        tier: result.tier,
        scopes: result.scopes,
        expires_at: result.expires_at,
        max_ips: result.max_ips,
        max_devices: result.max_devices,
        warning: 'Simpan token ini sekarang. Nilainya tidak bisa ditampilkan lagi.',
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/revoke',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const id = String(body.id ?? '').trim();
      if (!id) return sendJson(res, 400, { ok: false, error: 'id_diperlukan' });
      const result = revokeToken(id, String(body.reason ?? 'manual').slice(0, 200), {
        automatic: false, detail: String(body.detail ?? '').slice(0, 500),
      });
      recordEvent({
        tokenId: id, action: 'revoke', outcome: result.revoked ? 'ok' : 'tidak_ada',
        ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      });
      sendJson(res, 200, { ok: true, revoked: result.revoked });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/suspend',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const result = suspendToken(String(body.id ?? ''), String(body.reason ?? 'ditangguhkan admin'));
      sendJson(res, 200, { ok: true, ...result });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/token/resume',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const result = resumeToken(String(body.id ?? ''));
      sendJson(res, 200, { ok: true, ...result });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/tokens',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const rows = listTokens({
        projectSlug: url?.searchParams.get('project') ?? null,
        status: url?.searchParams.get('status') ?? null,
        tier: url?.searchParams.get('tier') ?? null,
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 500),
      });
      sendJson(res, 200, { ok: true, count: rows.length, tokens: rows });
    }),
  },

  // ══ SESI AKTIF — IP PENUH (ADMIN) ══════════════════════════════════════════
  //
  // ── KENAPA ENDPOINT INI ADA ───────────────────────────────────────────────
  // Halaman Sesi aktif milik pengguna menerima IP TERSAMAR (`103.179.•.•`),
  // karena halaman itu bisa dibuka di tempat yang terlihat orang lain.
  //
  // Tapi admin butuh IP PENUH untuk pekerjaan yang sah:
  //   • menyelidiki insiden ("dari mana sesi ini sebenarnya?")
  //   • memverifikasi laporan abuse ke penyedia
  //   • mencocokkan dengan log firewall atau log tunnel
  //   • memastikan dua sesi benar-benar dari jaringan yang sama
  //
  // Masking yang tidak bisa ditembus sama sekali akan memaksa admin menggali
  // database langsung — dan pekerjaan rutin kehilangan jejak audit di API.
  //
  // ── DIKUNCI DENGAN ADMIN_KEY ──────────────────────────────────────────────
  // Sama seperti endpoint admin lain: header `x-admin-key`, dibandingkan
  // dengan timingSafeEqual. Tanpa kunci yang benar, endpoint ini menjawab 401
  // tanpa membocorkan apakah ada data atau tidak.
  {
    method: 'GET',
    pattern: '/api/admin/sesi',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });

      // Filter opsional: token tertentu, atau semua sesi aktif.
      const tokenId = url?.searchParams.get('token') ?? null;
      const batas = Math.min(Number(url?.searchParams.get('limit') ?? 200), 1000);

      const KOLOM = `
        SELECT s.id, s.token_id, s.ip, s.country, s.kota, s.wilayah, s.asn,
               s.zona_waktu, s.user_agent, s.created_at, s.last_seen, s.expires_at,
               t.project_slug, t.issued_to
        FROM sessions s
        LEFT JOIN tokens t ON t.id = s.token_id
      `;

      const rows = tokenId
        ? getDb().prepare(`${KOLOM} WHERE s.token_id = ? AND s.expires_at > ?
                           ORDER BY s.last_seen DESC LIMIT ?`)
            .all(tokenId, Date.now(), batas)
        : getDb().prepare(`${KOLOM} WHERE s.expires_at > ?
                           ORDER BY s.last_seen DESC LIMIT ?`)
            .all(Date.now(), batas);

      sendJson(res, 200, {
        ok: true,
        count: rows.length,
        // ── IP PENUH, TANPA MASKER ──────────────────────────────────────────
        // Ini satu-satunya tempat IP lengkap dikirim lewat API. Dilindungi
        // admin key, dan sengaja TIDAK ada versi tersamar di sini — admin
        // yang sudah terautentikasi memang butuh nilai aslinya.
        sesi: rows.map((r) => ({
          id: r.id,
          token_id: r.token_id,
          project: r.project_slug || '',
          issued_to: r.issued_to || '',
          ip: r.ip || '',
          negara: r.country || '',
          kota: r.kota || '',
          wilayah: r.wilayah || '',
          asn: r.asn || '',
          zona_waktu: r.zona_waktu || '',
          user_agent: String(r.user_agent || '').slice(0, 300),
          dibuat_pada: r.created_at,
          terakhir_aktif: r.last_seen,
          kedaluwarsa_pada: r.expires_at,
        })),
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/audit',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const events = recentEvents({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 1000),
        tokenId: url?.searchParams.get('token') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });
      sendJson(res, 200, { ok: true, count: events.length, events });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/leads',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const leads = listLeads({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 500),
        status: url?.searchParams.get('status') ?? null,
      });
      sendJson(res, 200, { ok: true, count: leads.length, leads });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/token/:id',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const row = getToken(params.id);
      if (!row) return sendJson(res, 404, { ok: false, error: 'token_tidak_ada' });
      // token_hash tidak pernah dikembalikan.
      const { token_hash: _ignored, ...safeRow } = row;
      sendJson(res, 200, { ok: true, token: safeRow });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cleanup',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const removed = cleanupExpiredSessions();
      sendJson(res, 200, { ok: true, removed });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/analytics/funnel',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const project = url?.searchParams.get('project') ?? null;
      const days = Math.min(Number(url?.searchParams.get('days') ?? 30), 365);
      const windowMs = days * 24 * 60 * 60 * 1000;

      const funnel = getFunnel({ projectSlug: project, windowMs });
      const visitors = uniqueVisitors({ projectSlug: project, windowMs });

      sendJson(res, 200, {
        ok: true,
        project: project ?? 'all',
        days,
        funnel,
        unique_visitors: visitors,
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/analytics/events',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const events = recentAnalytics({
        limit: Math.min(Number(url?.searchParams.get('limit') ?? 100), 1000),
        eventType: url?.searchParams.get('type') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });
      sendJson(res, 200, { ok: true, count: events.length, events });
    }),
  },

  // ── SLA (enterprise) ─────────────────────────────────────────────────────────

  {
    method: 'GET',
    pattern: '/api/admin/sla',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const days = Math.min(Number(url?.searchParams.get('days') ?? 0), 90);
      if (days > 0) {
        return sendJson(res, 200, { ok: true, report: slaReport({ windowMs: days * 86_400_000 }) });
      }
      sendJson(res, 200, { ok: true, sla: slaSummary() });
    }),
  },

  // ── Audit export (enterprise) ────────────────────────────────────────────────

  {
    method: 'GET',
    pattern: '/api/admin/export/audit',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const format = (url?.searchParams.get('format') ?? 'json').toLowerCase();
      const limit = Math.min(Number(url?.searchParams.get('limit') ?? 5000), 50_000);
      const events = recentEvents({
        limit,
        tokenId: url?.searchParams.get('token') ?? null,
        projectSlug: url?.searchParams.get('project') ?? null,
      });

      if (format === 'csv') {
        const header = 'id,token_id,project_slug,action,outcome,ip,country,detail,at\n';
        const rows = events.map((e) => [
          e.id, e.token_id ?? '', e.project_slug, e.action, e.outcome,
          e.ip, e.country,
          `"${String(e.detail ?? '').replace(/"/g, '""')}"`,
          new Date(Number(e.at)).toISOString(),
        ].join(',')).join('\n');
        const body = header + rows;
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'content-disposition': `attachment; filename="audit-export-${Date.now()}.csv"`,
          'cache-control': 'no-store',
        });
        return res.end(body);
      }

      sendJson(res, 200, {
        ok: true,
        exported_at: new Date().toISOString(),
        count: events.length,
        events,
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/projects',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, projects: listProjects() });
    }),
  },

  // ══ CMS ══════════════════════════════════════════════════════════════════════
  // Publik: hanya konten PUBLISHED. Admin: semua + manajemen.

  {
    method: 'GET',
    pattern: '/api/cms/:collection/items',
    handler: safe(async (req, res, params, url) => {
      const collection = params.collection;
      const isAdminReq = isAdmin(req);
      const includeDraft = isAdminReq && url?.searchParams.get('draft') === '1';
      const limit = Number(url?.searchParams.get('limit') ?? 100);
      sendJson(res, 200, {
        ok: true,
        collection,
        items: listItems(collection, { includeDraft, limit }),
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/cms/:collection/items/:slug',
    handler: safe(async (req, res, params, url) => {
      const includeDraft = isAdmin(req) && url?.searchParams.get('draft') === '1';
      const item = getItem(params.collection, params.slug, { includeDraft });
      if (!item) return sendJson(res, 404, { ok: false, error: 'item_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/cms/collections',
    handler: safe(async (req, res) => {
      sendJson(res, 200, { ok: true, collections: listCollections() });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/collection',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const col = createCollection({
          slug: String(body.slug ?? ''),
          title: body.title,
          fields: body.fields,
        });
        sendJson(res, 200, { ok: true, collection: col });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/item',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const item = saveItem({
          collection: String(body.collection ?? ''),
          itemSlug: String(body.slug ?? ''),
          data: body.data,
          status: String(body.status ?? 'draft'),
          author: 'admin',
          message: String(body.message ?? ''),
        });
        sendJson(res, 200, { ok: true, item });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/status',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const item = setItemStatus(
        String(body.collection ?? ''), String(body.slug ?? ''), String(body.status ?? '')
      );
      if (!item) return sendJson(res, 404, { ok: false, error: 'item_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/delete',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const ok = deleteItem(String(body.collection ?? ''), String(body.slug ?? ''));
      sendJson(res, 200, { ok: true, deleted: ok });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/cms/versions/:collection/:slug',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, {
        ok: true,
        versions: listVersions(params.collection, params.slug),
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/cms/rollback',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const item = rollback(
        String(body.collection ?? ''), String(body.slug ?? ''), Number(body.version ?? 0)
      );
      if (!item) return sendJson(res, 404, { ok: false, error: 'versi_tidak_ada' });
      sendJson(res, 200, { ok: true, item });
    }),
  },

  // ══ SEO / AEO ════════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/seo/sitemap',
    handler: safe(async (req, res) => {
      const { xml, count } = buildSitemap();
      res.writeHead(200, {
        'content-type': 'application/xml; charset=utf-8',
        'content-length': Buffer.byteLength(xml),
        'cache-control': 'public, max-age=3600',
      });
      res.end(xml);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/robots',
    handler: safe(async (req, res) => {
      const body = buildRobots();
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'public, max-age=3600',
      });
      res.end(body);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/llms',
    handler: safe(async (req, res) => {
      // Data proyek dibaca dari berkas data frontend supaya satu sumber.
      const { loadPortfolioData } = await import('./portfolio-data.mjs');
      const data = await loadPortfolioData();
      const body = buildLlmsTxt(data);
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'public, max-age=3600',
      });
      res.end(body);
    }),
  },

  {
    method: 'GET',
    pattern: '/api/seo/jsonld',
    handler: safe(async (req, res) => {
      const { loadPortfolioData } = await import('./portfolio-data.mjs');
      sendJson(res, 200, { ok: true, data: buildJsonLd(await loadPortfolioData()) });
    }),
  },

  // ══ PERFORMANCE ══════════════════════════════════════════════════════════════

  {
    method: 'POST',
    pattern: '/api/vitals',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      const ok = recordVital({
        name: body.name,
        value: body.value,
        rating: body.rating,
        path: body.path,
        country: clientCountry(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        connection: body.connection,
      });
      sendJson(res, ok ? 200 : 400, { ok });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/performance',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const days = Number(url?.searchParams.get('days') ?? 7);
      sendJson(res, 200, { ok: true, vitals: vitalsSummary({ days }) });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/performance/assets',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const root = url?.searchParams.get('root') || defaultRoot();
      try {
        sendJson(res, 200, { ok: true, audit: auditAssets(root) });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    }),
  },

  // ══ COLLABORATE ══════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/admin/branches',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, branches: listBranches() });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/branch/:name',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const branch = getBranch(params.name);
      if (!branch) return sendJson(res, 404, { ok: false, error: 'branch_tidak_ada' });
      sendJson(res, 200, { ok: true, branch });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/create',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const branch = createBranch({
          name: String(body.name ?? ''),
          base: String(body.base ?? 'main'),
          message: String(body.message ?? ''),
        });
        sendJson(res, 200, { ok: true, branch });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/change',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        recordChange({
          branch: String(body.branch ?? ''),
          collection: String(body.collection ?? ''),
          itemSlug: String(body.slug ?? ''),
          action: String(body.action ?? 'update'),
          payload: body.payload ?? {},
        });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/merge',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const name = String(body.branch ?? '');
      // Terapkan tiap perubahan ke CMS produksi.
      const result = mergeBranch(name, (change) => {
        if (!change.collection || !change.item_slug) return false;
        saveItem({
          collection: change.collection,
          itemSlug: change.item_slug,
          data: change.payload?.data ?? {},
          status: change.payload?.status ?? 'draft',
          author: 'merge',
          message: `merge dari branch ${name}`,
        });
        return true;
      });
      sendJson(res, result.ok ? 200 : 400, result);
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/branch/discard',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      discardBranch(String(body.branch ?? ''));
      sendJson(res, 200, { ok: true });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/comments',
    handler: safe(async (req, res, params, url) => {
      const target = url?.searchParams.get('target');
      const resolvedParam = url?.searchParams.get('resolved');
      const resolved = resolvedParam === null ? null : resolvedParam === '1';
      sendJson(res, 200, { ok: true, comments: listComments({ target, resolved }) });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/comments',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      try {
        const result = addComment({
          target: String(body.target ?? ''),
          anchor: String(body.anchor ?? ''),
          body: String(body.body ?? ''),
          author: String(body.author ?? 'guest').slice(0, 80),
          parentId: body.parent_id ? Number(body.parent_id) : null,
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/comment/resolve',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      resolveComment(Number(body.id ?? 0), body.resolved !== false);
      sendJson(res, 200, { ok: true });
    }),
  },

  // ── A8: moderasi komentar ─────────────────────────────────────────────────
  // Komentar publik masuk sebagai 'pending' dan tidak tampil sampai disetujui.
  // Endpoint ini yang menyetujui / menolak.
  {
    method: 'GET',
    pattern: '/api/admin/comments',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const statusParam = url?.searchParams.get('status');
      // Tanpa parameter status → tampilkan SEMUA (termasuk pending), karena
      // itulah gunanya panel moderasi. Publik tidak pernah sampai ke sini
      // (route /api/admin/* dibatasi loopback + butuh kunci admin).
      const status = statusParam === null ? null : String(statusParam);
      const target = url?.searchParams.get('target');
      const limit = Number(url?.searchParams.get('limit') ?? 200);
      sendJson(res, 200, {
        ok: true,
        stats: commentStats(),
        comments: listComments({ target, status, limit }),
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/comment/moderate',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const id = Number(body.id ?? 0);
      if (!id) return sendJson(res, 400, { ok: false, error: 'id_kosong' });
      try {
        const result = moderateComment(id, String(body.status ?? ''));
        sendJson(res, 200, { ok: true, ...result, stats: commentStats() });
      } catch (err) {
        // Pesan dari moderateComment sudah menjelaskan nilai yang sah —
        // aman ditampilkan karena tidak membocorkan detail sistem.
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  // ══ GROW (eksperimen A/B) ════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/experiment/:slug',
    handler: safe(async (req, res, params, url) => {
      // Publik: hanya memberi varian untuk pengunjung — bukan data hasil.
      const visitor = url?.searchParams.get('v') ?? clientIp(req);
      const variant = pickVariant(params.slug, visitor);
      if (!variant) return sendJson(res, 404, { ok: false, error: 'eksperimen_tidak_aktif' });
      recordExpEvent({
        slug: params.slug, variant, event: 'exposure',
        visitor, country: clientCountry(req),
      });
      sendJson(res, 200, { ok: true, variant });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/experiment/convert',
    handler: safe(async (req, res) => {
      const body = await readJson(req);
      recordExpEvent({
        slug: String(body.slug ?? ''),
        variant: String(body.variant ?? ''),
        event: String(body.event ?? 'conversion'),
        visitor: String(body.visitor ?? clientIp(req)),
        country: clientCountry(req),
      });
      sendJson(res, 200, { ok: true });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/experiments',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, experiments: listExperiments() });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/experiment/:slug/results',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const r = expResults(params.slug);
      if (!r) return sendJson(res, 404, { ok: false, error: 'eksperimen_tidak_ada' });
      sendJson(res, 200, { ok: true, results: r });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/experiment',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      try {
        const exp = createExperiment({
          slug: String(body.slug ?? ''),
          name: body.name,
          variants: body.variants,
          goal: body.goal,
        });
        if (body.status) setExpStatus(String(body.slug), String(body.status));
        sendJson(res, 200, { ok: true, experiment: getExperiment(String(body.slug)) });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }),
  },

  // ══ PUBLISH ══════════════════════════════════════════════════════════════════

  {
    method: 'GET',
    pattern: '/api/admin/preflight',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      // Tanpa parameter root → preflight memakai root repo (default benar).
      const root = url?.searchParams.get('root') || undefined;
      sendJson(res, 200, { ok: true, preflight: preflight(root) });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/releases',
    handler: safe(async (req, res, params, url) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      sendJson(res, 200, { ok: true, releases: listReleases(Number(url?.searchParams.get('limit') ?? 50)) });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/publish/verify',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const url = String(body.url ?? '');
      if (!/^https?:\/\//.test(url)) return sendJson(res, 400, { ok: false, error: 'url_tidak_valid' });
      const result = await verifyDeploy(url, { expectMarker: body.marker ?? null });
      sendJson(res, 200, { ok: true, verify: result });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/release',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const body = await readJson(req);
      const id = recordRelease({
        version: String(body.version ?? ''),
        commit: String(body.commit ?? ''),
        checks: body.checks ?? [],
        ok: Boolean(body.ok),
      });
      sendJson(res, 200, { ok: true, id });
    }),
  },

  // ── MEDIA: GALERI PROYEK ──────────────────────────────────────────────────
  // Gambar galeri HANYA bisa masuk lewat endpoint di bawah ini. Frontend
  // tidak pernah menulis — ia hanya membaca daftar dan menampilkan berkas.
  //
  // KENAPA DI BACKEND, BUKAN LANGSUNG KE R2 DARI BROWSER:
  //   - Kunci R2 tidak boleh ada di browser (siapa pun bisa menghapus isi bucket)
  //   - Konversi WebP + LQIP butuh CPU; sharp jalan di Node, bukan di Worker
  //   - Validasi tipe berkas yang sesungguhnya cuma bisa setelah didekode

  {
    method: 'GET',
    pattern: '/api/gate/check',
    handler: safe(async (req, res) => {
      // ── PUBLIK: apakah pengunjung sudah punya clearance sah? ──────────────
      // Dipanggil setiap kali halaman dibuka. Kalau clearance ada dan sah,
      // gate TIDAK ditampilkan sama sekali.
      //
      // Kenapa endpoint terpisah, bukan langsung dari verify-turnstile:
      // clearance berlaku 30 menit dan mencakup SEMUA halaman. Halaman baru
      // (mis. /docs dibuka 10 menit setelah verifikasi) hanya perlu TANYA
      // apakah clearance-nya masih sah — tidak perlu verifikasi ulang.
      //
      // Biaya: satu permintaan kecil (~100 byte respons). Itu harga yang
      // dibayar untuk clearance yang tidak bisa dipalsukan.

      // ── PENGGUNA YANG SUDAH LOGIN: LEWATI GATE ──────────────────────────
      //
      // ── MASALAH YANG DIPERBAIKI ─────────────────────────────────────────
      // Sebelumnya gate hanya memeriksa cookie clearance. Pengguna yang baru
      // berhasil masuk — sudah melewati Turnstile di form login — tetap
      // diminta verifikasi LAGI saat diarahkan ke /home. Dua verifikasi
      // berurutan untuk satu kunjungan.
      //
      // ── KENAPA INI SALAH ────────────────────────────────────────────────
      // Gate dirancang untuk PENGUNJUNG ANONIM: mencegah bot memanen konten
      // publik (landing page, harga, dokumentasi). Pengguna yang sudah login
      // BUKAN sasaran gate — ia sudah membuktikan identitasnya dengan cara
      // yang lebih kuat:
      //
      //   Login : email + sandi + Turnstile   ← tiga faktor
      //   Gate  : Turnstile saja              ← satu faktor
      //
      // Meminta gate SETELAH login berarti memverifikasi ulang dengan bukti
      // yang LEBIH LEMAH daripada yang sudah dimiliki. Itu tidak menambah
      // keamanan sedikit pun — hanya menambah gesekan.
      //
      // ── KENAPA TIDAK MENGHAPUS GATE SAMA SEKALI ─────────────────────────
      // Pengunjung anonim TETAP harus melewatinya. Gate masih berguna untuk
      // mencegah bot memanen halaman publik. Yang berubah hanya: pengguna
      // terautentikasi tidak perlu melewatinya dua kali.
      const sesi = sesiDariRequest(req);
      if (sesi) {
        sendJson(res, 200, {
          ok: true,
          bersih: true,
          // Penanda bahwa ini lolos karena SESI, bukan clearance. Berguna
          // untuk debug dan untuk memastikan gate tidak salah lapor.
          karena: 'sesi',
        });
        return;
      }

      const token = bacaCookieClearance(req);
      const hasil = verifikasiClearance(token);

      if (hasil.ok) {
        sendJson(res, 200, {
          ok: true,
          bersih: true,
          expiresAt: hasil.expiresAt,
          karena: 'clearance',
        });
        return;
      }

      // Clearance tidak sah — beri tahu alasan SPESIFIK hanya kalau itu
      // membantu (kedaluwarsa vs tidak ada), tapi JANGAN bocorkan detail
      // internal seperti perbedaan IP (itu bisa dipakai memetakan jaringan).
      const publik = hasil.alasan === 'kedaluwarsa' ? 'kedaluwarsa' : 'perlu_verifikasi';
      sendJson(res, 200, {
        ok: true,
        bersih: false,
        alasan: publik,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/gate/clear',
    handler: safe(async (req, res) => {
      // Hapus clearance — dipakai saat pengunjung keluar, atau saat
      // pengujian. Tidak butuh admin key: menghapus clearance MILIK SENDIRI
      // tidak berbahaya (efeknya hanya verifikasi ulang).
      hapusCookieClearance(res);
      sendJson(res, 200, { ok: true });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/projects',
    handler: safe(async (req, res) => {
      // PUBLIK — daftar nama proyek. Dipakai panel admin untuk mengisi saran
      // slug saat mengunggah gambar, supaya admin tidak salah ketik dan
      // gambar tidak tersimpan dengan slug yang tidak cocok proyek mana pun.
      //
      // Aman dilihat publik: ini hanya nama proyek yang sudah tampil di
      // halaman depan. Tidak ada data internal.
      sendJson(res, 200, { ok: true, projects: listProjects() });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/media/manifest',
    handler: safe(async (req, res) => {
      // PUBLIK — frontend memanggil ini tanpa kunci apa pun.
      // Yang dikembalikan hanya daftar (slug, label, URL) tanpa LQIP,
      // jadi ukurannya kecil dan aman dilihat siapa saja.
      if (!mediaAktif()) {
        return sendJson(res, 200, { ok: true, aktif: false, images: [] });
      }
      const manifest = await bacaManifest();
      // Cache 5 menit di CDN. Cukup lama untuk mengurangi permintaan
      // berulang, cukup pendek supaya gambar yang baru diunggah admin
      // muncul tanpa perlu menunggu lama.
      res.setHeader('cache-control', 'public, max-age=300');
      sendJson(res, 200, {
        ok: true,
        aktif: true,
        updatedAt: manifest.updatedAt,
        count: manifest.images.length,
        images: daftarPublik(manifest),
      });
    }),
  },

  {
    method: 'GET',
    pattern: '/api/admin/media',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const manifest = await bacaManifest();
      sendJson(res, 200, {
        ok: true,
        aktif: mediaAktif(),
        maxBytes: MAX_UPLOAD_BYTES,
        updatedAt: manifest.updatedAt,
        count: manifest.images.length,
        // Panel admin menerima LQIP juga — dipakai untuk pratinjau kartu
        // tanpa mengunduh gambar penuh.
        images: manifest.images,
      });
    }),
  },

  {
    method: 'POST',
    pattern: '/api/admin/media',
    handler: safe(async (req, res) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });

      // Body BINER, bukan JSON. Dikirim sebagai application/octet-stream
      // dengan metadata di query string, supaya tidak perlu multipart parser
      // (satu dependensi lebih sedikit, satu lapisan lebih sedikit yang bisa salah).
      const url = new URL(req.url ?? '/', 'http://localhost');
      const slug = String(url.searchParams.get('slug') ?? '').trim();
      const label = String(url.searchParams.get('label') ?? '').trim();
      const urutanRaw = url.searchParams.get('urutan');
      const urutan = urutanRaw === null ? null : Number(urutanRaw);

      if (!slug) return sendJson(res, 400, { ok: false, error: 'slug_wajib' });
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(slug)) {
        return sendJson(res, 400, { ok: false, error: 'slug_tidak_valid' });
      }

      const buffer = await bacaBodyBiner(req, MAX_UPLOAD_BYTES);
      // Dipanggil di sini juga supaya penolakan terjadi SEBELUM sharp
      // menyentuh berkasnya (lebih cepat, pesan errornya lebih tepat).
      validasiUnggahan(buffer, req.headers['content-type']);

      const hasil = await unggahGambar({
        slug,
        label: label || slug,
        buffer,
        contentType: req.headers['content-type'],
        urutan: Number.isFinite(urutan) ? urutan : null,
      });

      // `action` + `outcome` adalah kontrak recordEvent() — bukan `kind`.
      // Memakai nama field yang salah membuat INSERT gagal dengan
      // "Provided value cannot be bound to SQLite parameter 3", dan
      // SELURUH permintaan ikut gagal walau gambarnya sudah tersimpan di R2.
      // Pelajaran: peristiwa audit tidak boleh bisa menggagalkan operasi
      // utamanya — kalau perlu, bungkus dengan try/catch di masa depan.
      recordEvent({
        action: 'media_unggah',
        outcome: 'berhasil',
        detail: `${slug} → ${hasil.entri.bytes} byte (hemat ${hasil.hemat}%)`,
        ip: clientIp(req),
      });

      sendJson(res, 200, {
        ok: true,
        entri: hasil.entri,
        hematPersen: hasil.hemat,
        totalGambar: hasil.manifest.images.length,
      });
    }),
  },

  {
    method: 'DELETE',
    pattern: '/api/admin/media/:slug',
    handler: safe(async (req, res, params) => {
      if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'admin_key_salah' });
      const hasil = await hapusGambar(params.slug);
      recordEvent({
        action: 'media_hapus',
        outcome: 'berhasil',
        detail: params.slug,
        ip: clientIp(req),
      });
      sendJson(res, 200, { ok: true, dihapus: hasil.dihapus.slug, totalGambar: hasil.manifest.images.length });
    }),
  },

  // ══ AUTH: OAUTH / SSO / PASSKEY ══════════════════════════════════════════════
  //
  // Didaftarkan di akhir karena semua polanya lebih spesifik daripada rute
  // yang sudah ada — tidak ada yang bertabrakan. resolveRoute() memakai
  // pencocokan pertama yang berhasil, jadi urutan ini aman.
  //
  // Yang ada di sini:
  //   GET  /api/auth/:provider           → mulai alur (Google/MS/Apple/GitHub)
  //   GET  /api/auth/:provider/callback  → selesai alur
  //   POST /api/auth/:provider/callback  → varian form_post (Apple)
  //   GET  /api/auth/sso                 → SSO perusahaan
  //   GET  /api/auth/sso/callback        → callback SSO
  //   POST /api/auth/passkey/registrasi/mulai   → mulai daftar passkey
  //   POST /api/auth/passkey/registrasi/selesai → selesai daftar passkey
  //   POST /api/auth/passkey/masuk/mulai        → mulai masuk passkey
  //   POST /api/auth/passkey/masuk/selesai      → selesai masuk passkey
  //   GET  /api/auth/identitas                  → daftar cara masuk
  //   POST /api/auth/identitas/hapus            → cabut satu cara masuk
  ...ruteAuth(),
];

/** Cari rute yang cocok untuk satu permintaan. */
export function resolveRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPath(route.pattern, pathname);
    if (params) return { route, params };
  }
  return null;
}

export { handlePreflight, applyCors };
