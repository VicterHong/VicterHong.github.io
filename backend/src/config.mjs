/**
 * Konfigurasi layanan token.
 *
 * Rahasia dibaca dari berkas env terpisah (tidak pernah di repo). Semua nilai lain
 * punya default aman supaya layanan bisa dijalankan tanpa konfigurasi tambahan.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const ENV_FILE = process.env.TOKEN_SERVICE_ENV ?? join(HOME, '.portfolio-token', 'service.env');

/** Baca berkas env sederhana: KEY=VALUE per baris, # komentar. */
function readEnvFile(path) {
  const out = {};
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Buang kutip pembungkus kalau ada.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // Berkas belum ada: pakai default. Bukan error saat pengembangan.
  }
  return out;
}

const fileEnv = readEnvFile(ENV_FILE);

const pick = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

export const config = {
  /** Port HTTP. 8788 dipilih karena bebas di VPS ini. */
  port: Number(pick('PORT', '8788')),

  /** Bind hanya ke loopback: akses publik lewat tunnel, bukan langsung. */
  host: pick('HOST', '127.0.0.1'),

  /** Lokasi database SQLite. */
  dbPath: pick('DB_PATH', join(HOME, '.portfolio-token', 'tokens.db')),

  /** Lokasi berkas konten terkunci (per proyek). */
  contentDir: pick('CONTENT_DIR', join(HOME, '.portfolio-token', 'content')),

  /**
   * Secret untuk menandatangani token yang diterbitkan.
   * WAJIB ada di service.env saat produksi — kalau kosong, layanan menolak start.
   */
  secret: pick('SERVICE_SECRET', ''),

  /**
   * Kunci admin untuk endpoint penerbitan/pencabutan token.
   * WAJIB ada di service.env saat produksi.
   */
  adminKey: pick('ADMIN_KEY', ''),

  /** Email sales untuk notifikasi permintaan akses. */
  salesEmail: pick('SALES_EMAIL', ''),

  /**
   * ── OWNER / ADMIN ─────────────────────────────────────────────────────────
   * Email akun yang boleh melihat konten eksperimen (seksi 3D di beranda).
   *
   * KENAPA DAFTAR TERPISAH, BUKAN `role` DI TABEL USERS
   *   Tabel `users` tidak punya kolom peran, dan menambahkannya berarti
   *   migrasi + endpoint pengelolaan peran yang belum dibutuhkan. Untuk satu
   *   akun pemilik, daftar di env lebih kecil permukaannya: tidak ada jalur
   *   untuk menaikkan peran lewat API, dan tidak ada kolom yang bisa salah
   *   di-set oleh kode lain.
   *
   * KENAPA FALLBACK KE SALES_EMAIL
   *   Di produksi saat ini hanya SALES_EMAIL yang terisi, dan itu alamat
   *   pemilik. OWNER_EMAIL didahulukan supaya peran bisa dipisah nanti tanpa
   *   mengubah kode; kalau kosong, SALES_EMAIL dipakai agar fitur tidak mati
   *   diam-diam pada konfigurasi yang sudah berjalan.
   *
   * Dibaca sebagai daftar dipisah koma, dibandingkan huruf kecil semua.
   */
  ownerEmails: (() => {
    const mentah = pick('OWNER_EMAIL', '') || pick('SALES_EMAIL', '');
    return String(mentah)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  })(),

  /**
   * ── PENGIRIMAN EMAIL (RESEND) ────────────────────────────────────────────
   *
   * Dipakai untuk tautan reset sandi. Kalau `resendApiKey` kosong, modul
   * email.mjs TIDAK rusak: ia menulis tautan reset ke log server sebagai
   * jalur cadangan, sehingga alur reset tetap bisa dipakai manual sebelum
   * email dikonfigurasi.
   *
   * EMAIL_FROM wajib memakai domain yang sudah diverifikasi di Resend
   * (SPF + DKIM). Mengirim dari domain yang belum diverifikasi akan ditolak
   * Resend dengan 403 — dan email reset tidak pernah sampai.
   *
   * Contoh: "Victer <noreply@portfolio-victer.pages.dev>"
   */
  // ── PENYEDIA EMAIL ─────────────────────────────────────────────────────────
  //
  // Tiga pilihan, dipilih otomatis oleh email.mjs (urutan: Brevo → Resend →
  // Cloudflare):
  //
  //   1. BREVO — satu-satunya yang menerima domain dari Public Suffix List
  //        BREVO_API_KEY      — kunci dari brevo.com → SMTP & API → API Keys
  //        BREVO_SENDER_EMAIL — alamat pengirim yang sudah diverifikasi
  //
  //        KENAPA BREVO DIPERIKSA PERTAMA: Resend MENOLAK `is-a.dev`
  //        ("We don't allow free public domains"). Brevo menerimanya —
  //        terbukti dari repo is-a.dev yang memakai Brevo DKIM.
  //        Kuota gratis: 300/hari (9.000/bulan).
  //
  //   2. RESEND — bisa dipakai TANPA domain sendiri, TAPI tolak domain publik
  //        RESEND_API_KEY  — kunci dari resend.com/api-keys
  //        EMAIL_FROM      — opsional; default `onboarding@resend.dev`
  //
  //   3. CLOUDFLARE EMAIL — butuh domain sendiri yang sudah di-onboard
  //        CF_ACCOUNT_ID   — ID akun Cloudflare
  //        CF_API_TOKEN    — token dengan izin kirim email
  //        EMAIL_FROM      — alamat pengirim di domain terverifikasi
  //
  // Kalau ketiganya kosong, email.mjs TIDAK rusak: pemanggil menulis kode
  // ke log server sebagai jalur cadangan — supaya alur pengguna tetap bisa
  // diselesaikan (dengan bantuan admin).
  brevoApiKey: pick('BREVO_API_KEY', ''),
  brevoSenderEmail: pick('BREVO_SENDER_EMAIL', ''),

  resendApiKey: pick('RESEND_API_KEY', ''),

  cfAccountId: pick('CF_ACCOUNT_ID', '') || pick('CLOUDFLARE_ACCOUNT_ID', ''),
  cfApiToken: pick('CF_API_TOKEN', '') || pick('CLOUDFLARE_API_TOKEN', ''),
  emailFrom: pick('EMAIL_FROM', ''),

  /** URL situs publik — dipakai untuk menyusun tautan reset sandi.
   *  Harus absolut: tautan relatif tidak berguna di dalam email. */
  siteUrl: pick('SITE_URL', 'https://portfolio-victer.pages.dev'),

  /**
   * ── OAUTH (SSO) — BELUM AKTIF ──────────────────────────────────────────────
   *
   * Dikosongkan = tombol SSO TIDAK ditampilkan di halaman masuk/daftar.
   * Frontend menanyakannya lewat /api/config dan menyembunyikan tombolnya
   * kalau kosong — supaya tidak ada tombol yang mengarah ke endpoint mati.
   *
   * Untuk mengaktifkan:
   *   1. Buat OAuth app di Google Cloud Console / GitHub Developer Settings
   *   2. Isi CLIENT_ID + CLIENT_SECRET di env
   *   3. Tambahkan endpoint /api/auth/google dan /api/auth/github di routes.mjs
   *      (alur: redirect → callback → tukar code → buat/temukan pengguna → sesi)
   *   4. Tombol muncul sendiri, tanpa mengubah HTML
   */
  googleClientId: pick('GOOGLE_CLIENT_ID', ''),
  googleClientSecret: pick('GOOGLE_CLIENT_SECRET', ''),
  githubClientId: pick('GITHUB_CLIENT_ID', ''),
  githubClientSecret: pick('GITHUB_CLIENT_SECRET', ''),
  microsoftClientId: pick('MICROSOFT_CLIENT_ID', ''),
  microsoftClientSecret: pick('MICROSOFT_CLIENT_SECRET', ''),

  // ── LINKEDIN ────────────────────────────────────────────────────────────────
  // Dua nilai dari halaman app LinkedIn (Products → "Sign In with LinkedIn
  // using OpenID Connect" harus ditambahkan dulu, lalu ambil dari tab Auth).
  //
  // Kenapa LinkedIn: self-serve tanpa review, OIDC penuh, dan cocok untuk
  // audiens korporat/B2B — lihat penjelasan lengkap di src/oauth.mjs.
  //
  // Redirect URL yang didaftarkan di LinkedIn:
  //   https://<domain>/api/auth/linkedin/callback
  linkedinClientId: pick('LINKEDIN_CLIENT_ID', ''),
  linkedinClientSecret: pick('LINKEDIN_CLIENT_SECRET', ''),

  // ── APPLE: TIGA NILAI + SATU KUNCI ──────────────────────────────────────────
  // Apple tidak memberi client secret berupa string. Yang dipakai adalah JWT
  // yang ditandatangani private key .p8 milik developer, jadi butuh:
  //   APPLE_CLIENT_ID   — Services ID (mis. 'id.vivastic.signin'), BUKAN App ID
  //   APPLE_TEAM_ID     — 10 karakter, dari halaman Membership
  //   APPLE_KEY_ID      — 10 karakter, dari kunci .p8 yang diunduh
  //   APPLE_PRIVATE_KEY — isi berkas .p8 (PEM). Baris baru ditulis \n
  //                       karena env tidak bisa memuat baris baru asli.
  //
  // Kenapa Services ID, bukan App ID: hanya Services ID yang bisa dipakai
  // untuk alur web (redirect_uri). App ID untuk aplikasi native.
  appleClientId: pick('APPLE_CLIENT_ID', ''),
  appleTeamId: pick('APPLE_TEAM_ID', ''),
  appleKeyId: pick('APPLE_KEY_ID', ''),
  applePrivateKey: pick('APPLE_PRIVATE_KEY', ''),

  /**
   * ── SSO PERUSAHAAN (OIDC) ──────────────────────────────────────────────────
   *
   * Empat nilai. Semuanya bisa didapat dari dokumen discovery IdP, yang
   * URL-nya biasanya: https://<domain-IdP>/.well-known/openid-configuration
   *
   * Kenapa OIDC, bukan SAML: OIDC memakai JWT dan endpoint yang ditemukan
   * otomatis (discovery), sehingga SATU implementasi bekerja untuk Okta,
   * Azure AD, Google Workspace, Keycloak, Auth0, dan Cloudflare Access.
   * SAML butuh parsing XML dan konfigurasi per vendor.
   *
   * Cara mengisi:
   *   1. Buat aplikasi OIDC di IdP organisasi
   *   2. Redirect URI: https://<situs>/api/auth/sso/callback
   *   3. Salin issuer, client id, client secret ke bawah ini
   */
  ssoIssuer: pick('SSO_ISSUER', ''),
  ssoClientId: pick('SSO_CLIENT_ID', ''),
  ssoClientSecret: pick('SSO_CLIENT_SECRET', ''),

  /**
   * Label yang dilihat pengguna di tombol, mis. "Masuk dengan Okta".
   * Kosong = tombol memakai teks bawaan "Masuk dengan SSO perusahaan".
   */
  ssoLabel: pick('SSO_LABEL', ''),

  /**
   * Domain email yang boleh memakai SSO ini, dipisah koma.
   *
   * Kosong = semua domain boleh (cocok untuk broker yang menangani
   * banyak organisasi).
   *
   * Diisi = hanya email dari domain itu yang diarahkan ke SSO. Berguna
   * kalau SSO hanya untuk organisasi tertentu — mis. 'vivastic.id'.
   */
  ssoDomains: pick('SSO_DOMAINS', ''),

  /** @deprecated Diganti ssoIssuer. Dipertahankan agar env lama tidak rusak. */
  ssoEntryPoint: pick('SSO_ENTRY_POINT', ''),

  /**
   * ── ORIGIN WEBAUTHN (PASSKEY) ─────────────────────────────────────────────
   *
   * WebAuthn mengikat kredensial ke domain. Daftar ini harus memuat SEMUA
   * host yang melayani halaman masuk — kalau tidak, pendaftaran passkey
   * gagal dengan pesan yang membingungkan pengguna.
   *
   * Dipisah koma. SITE_URL selalu ikut otomatis, jadi biasanya cukup
   * menambahkan domain preview:
   *   WEBAUTHN_ORIGINS=https://staging.vivastic.id,https://abc.pages.dev
   */
  webauthnOrigins: pick('WEBAUTHN_ORIGINS', ''),

  /** Proyek default untuk akun yang dibuat lewat OAuth/passkey. */
  defaultProject: pick('DEFAULT_PROJECT', 'mina'),

  /** URL webhook untuk notifikasi lead baru (Discord/Slack/generik). Kosong = nonaktif. */
  leadWebhookUrl: pick('LEAD_WEBHOOK_URL', ''),

  /**
   * Cloudflare Turnstile — CAPTCHA tanpa geser.
   *
   * siteKey dipakai frontend (aman dilihat publik).
   * secretKey dipakai backend untuk memverifikasi token (RAHASIA).
   *
   * Kosong = Turnstile nonaktif; form tetap dilindungi penapis lapis lain
   * (honeypot, waktu isi, batas laju, heuristik isi). Jadi situs tidak pernah
   * rusak hanya karena key belum dipasang.
   */
  turnstileSiteKey: pick('TURNSTILE_SITE_KEY', ''),
  turnstileSecretKey: pick('TURNSTILE_SECRET_KEY', ''),

  /**
   * Hostname yang boleh menyelesaikan Turnstile.
   *
   * Cloudflare mengembalikan hostname tempat token diselesaikan. Tanpa
   * daftar ini, token dari preview deployment atau domain lain tetap
   * diterima — jadi penyerang bisa mendaftarkan widget Turnstile di
   * domainnya sendiri dan memakai token yang dihasilkan untuk situs ini.
   *
   * Format: dipisah koma. Kosong = pemeriksaan dilewati (untuk pengembangan),
   * dan server menolak start di produksi kalau kosong (lihat validateConfig).
   *
   * JANGAN masukkan domain preview (mis. *.pages.dev dengan hash acak) —
   * itu berubah tiap deploy dan akan membuat pengunjung ditolak.
   */
  turnstileHostnames: pick('TURNSTILE_HOSTNAMES', '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  /** Origin yang boleh mengakses API (CORS). */
  allowedOrigins: pick('ALLOWED_ORIGINS', 'https://victerhong.github.io')
    .split(',').map((s) => s.trim()).filter(Boolean),

  /** Batas laju default per token per menit. */
  rateLimitPerMinute: Number(pick('RATE_LIMIT_PER_MINUTE', '30')),

  /** Auto-revoke: jumlah IP berbeda maksimum dalam jendela waktu. */
  maxDistinctIps: Number(pick('MAX_DISTINCT_IPS', '3')),

  /** Auto-revoke: jendela waktu untuk menghitung IP berbeda (jam). */
  ipWindowHours: Number(pick('IP_WINDOW_HOURS', '24')),

  /** Auto-revoke: jumlah request gagal berturut-turut sebelum token dikunci. */
  maxFailedAttempts: Number(pick('MAX_FAILED_ATTEMPTS', '12')),

  /** Panjang segmen token acak (karakter, bukan byte). */
  tokenSegmentLength: Number(pick('TOKEN_SEGMENT_LENGTH', '4')),

  /** Jumlah segmen token (contoh: 4 segmen → VP-XXXX-XXXX-XXXX-XXXX). */
  tokenSegments: Number(pick('TOKEN_SEGMENTS', '4')),

  /** Awalan token supaya mudah dikenali. */
  tokenPrefix: pick('TOKEN_PREFIX', 'VP-'),

  /** Durasi sesi cookie (jam). */
  sessionDurationHours: Number(pick('SESSION_DURATION_HOURS', '24')),

  /** Maksimum sesi aktif per token (device). */
  maxDevices: Number(pick('MAX_DEVICES', '3')),

  /**
   * ── Cloudflare R2 (penyimpanan gambar galeri) ──────────────────────────
   *
   * Dibaca lewat `pick()` yang sama dengan rahasia lain — jadi nilainya
   * boleh datang dari environment ATAU service.env. Ini yang membuat
   * modul media tidak perlu tahu dari mana asalnya.
   *
   * Kalau token kosong, fitur unggah gambar NONAKTIF tapi situs tetap
   * jalan normal (galeri memakai gambar bawaan). Fitur opsional tidak
   * boleh mematikan layanan inti.
   */
  r2AccountId: pick('CLOUDFLARE_ACCOUNT_ID', ''),
  r2ApiToken: pick('CLOUDFLARE_API_TOKEN', ''),
  r2Bucket: pick('R2_BUCKET', 'portfolio-assets'),

  /**
   * ── MIDTRANS (pembayaran langganan) ────────────────────────────────────
   *
   * ── KENAPA MIDTRANS ────────────────────────────────────────────────────
   * Pilihan ini muncul dari kebutuhan nyata:
   *
   *   Xendit   → butuh badan hukum (PT/CV), tidak menerima individu
   *   Midtrans → menerima INDIVIDU dengan KTP saja
   *
   * Dengan KTP saja, Midtrans sudah memberi QRIS, GoPay, dan Virtual
   * Account — tiga metode yang paling banyak dipakai pembeli Indonesia.
   * NPWP baru diperlukan kalau mau kartu kredit.
   *
   * Midtrans berlisensi Bank Indonesia (bagian dari GoTo Financial), jadi
   * uang pembeli terlindungi dan ada jalur sengketa resmi.
   *
   * ── TANDA TANGAN DARI ISI TRANSAKSI ────────────────────────────────────
   * Webhook Midtrans ditandatangani dengan:
   *   sha512(order_id + status_code + gross_amount + ServerKey)
   *
   * Ini lebih aman daripada token statis: tanda tangannya terikat pada ISI
   * transaksi, jadi webhook palsu untuk transaksi berbeda tidak bisa dibuat
   * walaupun penyerang tahu satu signature yang valid.
   *
   * Karena itu TIDAK ADA webhook secret terpisah — ServerKey sendiri yang
   * jadi kunci tanda tangannya.
   *
   * ── KALAU KOSONG ───────────────────────────────────────────────────────
   * Fitur pembayaran NONAKTIF tapi situs tetap jalan normal — tombol
   * berubah jadi ajakan menghubungi, bukan checkout yang rusak.
   */
  midtransServerKey: pick('MIDTRANS_SERVER_KEY', ''),
  midtransClientKey: pick('MIDTRANS_CLIENT_KEY', ''),

  /**
   * Sandbox atau production?
   *
   * ── KENAPA EKSPLISIT, BUKAN DITEBAK DARI KUNCI ─────────────────────────
   * Kunci sandbox Midtrans tidak punya awalan khusus seperti Xendit
   * (`xnd_development_`). Menebak dari bentuk kunci tidak bisa diandalkan —
   * dan salah tebak berarti memakai URL production dengan kunci sandbox,
   * yang menghasilkan error membingungkan.
   *
   * Default `false` (sandbox) supaya aman: lupa menyetel berarti tidak ada
   * uang sungguhan yang bergerak.
   */
  midtransProduction: pick('MIDTRANS_PRODUCTION', 'false').toLowerCase() === 'true',

  /** Alamat halaman setelah bayar berhasil / gagal. */
  checkoutSuksesUrl: pick('CHECKOUT_SUKSES_URL', 'https://portfolio-victer.pages.dev/pesanan'),
  checkoutBatalUrl: pick('CHECKOUT_BATAL_URL', 'https://portfolio-victer.pages.dev/pricing'),

  /* ══ SENTINEL — GATEWAY WEBHOOK ═════════════════════════════════════════════
   *
   * ── KENAPA SATU SECRET PER SUMBER, BUKAN SATU UNTUK SEMUA ─────────────────
   * Kalau semua sumber memakai secret yang sama, satu kebocoran membuka
   * SEMUA sumber. Dengan secret terpisah, GitHub yang bocor tidak membuat
   * penyerang bisa memalsukan webhook Stripe.
   *
   * ── KENAPA DIBIARKAN KOSONG, BUKAN WAJIB ──────────────────────────────────
   * Sumber yang secret-nya kosong berarti NONAKTIF — endpoint masuknya
   * menolak semua permintaan. Itu lebih aman daripada menerima tanpa
   * verifikasi, dan lebih jelas daripada "aktif tapi tidak memeriksa apa pun".
   *
   * Jadi tidak ada yang perlu dikonfigurasi supaya situs tetap jalan: yang
   * belum disetel hanya tidak bisa menerima webhook.
   */
  sentinelStripeSecret: pick('SENTINEL_STRIPE_SECRET', ''),
  sentinelGithubSecret: pick('SENTINEL_GITHUB_SECRET', ''),
  sentinelTelegramSecret: pick('SENTINEL_TELEGRAM_SECRET', ''),
  sentinelHmacSecret: pick('SENTINEL_HMAC_SECRET', ''),

  /**
   * Ke mana webhook yang diterima diteruskan.
   *
   * ── KENAPA SATU TUJUAN GLOBAL DULU ────────────────────────────────────────
   * Antrean menyimpan URL tujuan PER PESAN, jadi secara teknis tiap sumber
   * bisa punya tujuan berbeda. Tapi konfigurasi per-sumber berarti lebih
   * banyak yang harus dijaga tetap benar, dan belum ada kebutuhan nyatanya.
   *
   * Kosong = webhook diterima dan DICATAT, tapi tidak diteruskan ke mana pun.
   * Itu berguna untuk memantau saja tanpa mengirim ke layanan lain.
   */
  sentinelTujuanUrl: pick('SENTINEL_TUJUAN_URL', ''),

  /**
   * Jeda antar putaran worker pengirim (ms).
   *
   * ── KENAPA 15 DETIK ───────────────────────────────────────────────────────
   * Terlalu cepat berarti query database berulang tanpa ada yang baru.
   * Terlalu lambat berarti webhook menumpuk dan pengiriman tertunda.
   *
   * 15 detik: cukup responsif untuk webhook (yang toleransinya detik sampai
   * menit), cukup jarang untuk tidak membebani CPU.
   */
  sentinelIntervalMs: Number(pick('SENTINEL_INTERVAL_MS', '15000')),
  };

/**
 * Peringatan konfigurasi — diisi oleh validateConfig(), TIDAK memblokir startup.
 *
 * Kapan sesuatu masuk sini: kalau ia hanya bisa diperiksa BENTUKNYA di sini,
 * sementara kebenarannya bergantung pada keadaan luar (status verifikasi di
 * penyedia email, ketersediaan jaringan). Config tidak punya cara mengetahui
 * keadaan itu, jadi ia tidak boleh mematikan layanan.
 *
 * Contoh nyata: EMAIL_FROM memakai domain pihak lain (is-a.dev) — dulu ini
 * memblokir startup, dan layanan mati justru SETELAH domainnya berhasil
 * diverifikasi. Sekarang ia hanya peringatan.
 */
const warnings = [];

/** Apakah konfigurasi cukup untuk menjalankan layanan produksi. */
export function validateConfig() {
  const problems = [];
  // Peringatan TIDAK memblokir startup — lihat penjelasan di
  // validateWarnings() dan pemeriksaan EMAIL_FROM di bawah.
  warnings.length = 0;
  if (!config.secret || config.secret.length < 24) {
    // SERVICE_SECRET adalah pondasi semua tanda tangan (session, gate, HMAC).
    // Tanpa ini, server TIDAK BOLEH jalan — bukan sekadar peringatan.
    problems.push('SERVICE_SECRET wajib diisi (minimal 24 karakter) di ' + ENV_FILE);
  }
  if (!config.adminKey || config.adminKey.length < 24) {
    // ADMIN_KEY melindungi semua endpoint admin. Sama kritisnya.
    problems.push('ADMIN_KEY wajib diisi (minimal 24 karakter) di ' + ENV_FILE);
  }

  // Turnstile — konsistensi konfigurasi.
  //
  // Kenapa TIDAK memakai NODE_ENV: service produksi ini ternyata tidak
  // menyetel NODE_ENV (diperiksa langsung di /proc/<pid>/environ). Validasi
  // yang bergantung padanya tidak akan pernah jalan — perlindungan yang
  // terlihat ada tapi diam-diam tidak aktif.
  //
  // Gantinya: SITE_KEY dipakai sebagai penanda. Kalau site key diisi, artinya
  // situs memang menampilkan widget Turnstile ke pengunjung — dan kalau
  // widget ditampilkan, secret HARUS ada. Kalau tidak, pengunjung melihat
  // widget yang tidak bisa diverifikasi, dan (dengan fail-closed) semua
  // orang ditolak.
  //
  // Ini logika yang tidak bisa "lupa diset": site key dan secret key selalu
  // dibuat bersamaan di dashboard Cloudflare.
  if (config.turnstileSiteKey) {
    if (!config.turnstileSecretKey) {
      problems.push('TURNSTILE_SITE_KEY diisi tapi TURNSTILE_SECRET_KEY kosong — '
        + 'widget ditampilkan tapi tidak bisa diverifikasi. Isi keduanya di ' + ENV_FILE);
    }
    if (config.turnstileHostnames.length === 0) {
      problems.push('TURNSTILE_HOSTNAMES wajib diisi kalau Turnstile aktif — '
        + 'daftar hostname yang boleh menyelesaikan widget (dipisah koma) di ' + ENV_FILE);
    }
  }

  // ── Midtrans: konsistensi konfigurasi ───────────────────────────────────
  //
  // Pola yang sama dengan Turnstile: kunci sebagai penanda. Kalau ServerKey
  // diisi, artinya pembayaran memang diaktifkan.
  //
  // ── KENAPA TIDAK ADA CEK WEBHOOK SECRET ────────────────────────────────
  // Xendit butuh token webhook terpisah karena tanda tangannya tidak ada —
  // hanya token statis. Midtrans TIDAK butuh itu: webhook-nya ditandatangani
  // dengan ServerKey sendiri lewat sha512(order_id + status_code +
  // gross_amount + ServerKey).
  //
  // Jadi ServerKey yang kosong berarti dua masalah sekaligus: tidak bisa
  // memanggil API, DAN tidak bisa memverifikasi webhook. Satu pemeriksaan
  // menutup keduanya.
  if (config.midtransServerKey && config.midtransServerKey.length < 20) {
    problems.push('MIDTRANS_SERVER_KEY terlalu pendek — '
      + 'periksa apakah kuncinya tersalin lengkap dari dashboard Midtrans. '
      + 'Isi di ' + ENV_FILE);
  }

  // ── Email: pengirim harus alamat yang VALID ──────────────────────────────
  //
  // ── KENAPA PEMERIKSAAN INI ADA ───────────────────────────────────────────
  //
  // 7 email ditolak Brevo dengan alasan yang sama:
  //
  //   Sending has been rejected because the sender you used
  //   noreply@victer.is-a.dev is not valid.
  //   Validate your sender or authenticate your domain
  //
  // Penyebabnya: domain `is-a.dev` dikelola lewat PR GitHub — pemiliknya
  // TIDAK BISA menambah DNS record sembarangan. Alamat dari domain itu
  // tidak akan bisa dipakai sampai domainnya benar-benar diverifikasi.
  //
  // ── PENTING: PEMERIKSAAN INI TIDAK BOLEH MEMBLOKIR STARTUP ───────────────
  //
  // Versi pertama pemeriksaan ini menambahkan masalah ke `problems`, dan
  // `server.mjs` memanggil `process.exit(1)` kalau ada masalah apa pun.
  //
  // Akibatnya nyata: setelah domain `victer.is-a.dev` BERHASIL diverifikasi
  // di Brevo, layanan justru MATI — pemeriksaan ini masih menganggap
  // domain itu tidak valid, padahal statusnya sudah berubah. Layanan masuk
  // restart-loop dan seluruh situs tidak bisa diakses.
  //
  // Pelajarannya: pemeriksaan yang hanya bisa memeriksa BENTUK tidak boleh
  // memblokir startup. Ia tidak punya cara mengetahui apakah domain sudah
  // diverifikasi di penyedia — itu fakta runtime, bukan fakta konfigurasi.
  // Yang boleh memblokir hanyalah hal yang PASTI salah (kredensial kosong).
  //
  // Karena itu pemeriksaan ini sekarang mengembalikan `warnings`, bukan
  // `problems`. Server mencatatnya sebagai peringatan dan tetap jalan.
  if (config.emailFrom || config.brevoApiKey || config.resendApiKey) {
    const alamat = config.emailFrom || config.brevoSenderEmail || '';
    const cocok = alamat.match(/<([^>]+)>/) ?? [null, alamat];
    const surel = (cocok[1] ?? '').trim();

    if (!surel) {
      // Alamat kosong = email tidak akan bisa dikirim sama sekali.
      // Ini fakta konfigurasi yang pasti salah → tetap blokir.
      problems.push('EMAIL_FROM kosong padahal penyedia email diisi — '
        + 'email tidak akan bisa dikirim. Isi di ' + ENV_FILE);
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(surel)) {
      // Bentuk tidak sah → pasti salah → tetap blokir.
      problems.push(`EMAIL_FROM bukan alamat email yang sah: "${surel}". `
        + 'Format yang diterima: "Nama <alamat@domain>" atau "alamat@domain". '
        + 'Isi di ' + ENV_FILE);
    } else {
      // Domain pihak lain — HANYA PERINGATAN, bukan blokir.
      // Domain seperti ini MEMANG BISA dipakai kalau sudah diverifikasi di
      // penyedia (terbukti: victer.is-a.dev berhasil diverifikasi Brevo).
      // Config tidak punya cara mengetahui status verifikasi, jadi ia tidak
      // boleh mengambil keputusan yang mematikan layanan.
      const domainPihakLain = ['is-a.dev', 'github.io', 'pages.dev', 'workers.dev'];
      const domain = surel.split('@')[1] ?? '';
      const kena = domainPihakLain.find(
        (d) => domain === d || domain.endsWith('.' + d),
      );

      if (kena) {
        warnings.push(
          `EMAIL_FROM memakai domain "${domain}" (dikelola pihak lain). `
          + `Ini BEKERJA kalau domain sudah diverifikasi di dashboard penyedia `
          + `email, tapi GAGAL kalau belum — penyedia akan menolak setiap `
          + `pengiriman dengan "sender is not valid". `
          + `Cek status di dashboard penyedia sebelum mengandalkannya. `
          + `Kalau belum terverifikasi, pakai alamat yang sudah terverifikasi.`,
        );
      }
    }
  }

  return problems;
}

/**
 * Peringatan konfigurasi — layanan TETAP JALAN.
 *
 * Dipisahkan dari `validateConfig()` karena keduanya punya konsekuensi
 * berbeda: `problems` menghentikan startup, `warnings` hanya dicatat.
 *
 * Kapan sesuatu masuk `warnings`: kalau ia hanya bisa diperiksa BENTUKNYA
 * di sini, sementara kebenarannya bergantung pada keadaan luar (status
 * verifikasi di penyedia, ketersediaan jaringan). Config tidak punya cara
 * mengetahui keadaan itu, jadi ia tidak boleh mematikan layanan.
 */
export function validateWarnings() {
  return warnings;
}

export { ENV_FILE };
