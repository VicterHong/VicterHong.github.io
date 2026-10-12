/**
 * Pengiriman email — dua penyedia, dipilih otomatis.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DUA PENYEDIA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Cloudflare Email (kode asli) WAJIB punya domain sendiri yang sudah
 * di-onboard di Cloudflare. Tanpa domain, ia tidak bisa dipakai SAMA SEKALI.
 *
 * Resend punya mode uji: kirim dari `onboarding@resend.dev` TANPA verifikasi
 * domain. Batasannya: tujuan HANYA email yang dipakai mendaftar Resend.
 *
 * Jadi urutannya:
 *
 *   1. RESEND_API_KEY ada     → pakai Resend
 *   2. CF_* lengkap           → pakai Cloudflare
 *   3. dua-duanya kosong      → tulis kode ke log (fallback)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── PRINSIP: KEGAGALAN EMAIL TIDAK BOLEH MERUSAK ALUR ────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Semua fungsi di sini mengembalikan { ok, error } dan TIDAK melempar untuk
 * kegagalan pengiriman. Alasan:
 *   • "Lupa sandi" harus SELALU membalas sukses (mencegah user enumeration).
 *     Kalau pengiriman melempar, responsnya berubah jadi galat — dan
 *     penyerang bisa menyimpulkan email itu terdaftar.
 *   • Reset sandi yang gagal kirim bukan bencana: pengguna bisa coba lagi.
 *
 * ── TANPA KONFIGURASI, MODUL INI TIDAK RUSAK ─────────────────────────────────
 * Kalau tidak ada penyedia yang siap, fungsi mengembalikan
 * { ok: false, error: 'belum_dikonfigur' } dan PEMANGGIL menulis kode ke log
 * sebagai fallback — supaya alur pengguna tetap bisa diselesaikan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── STRUKTUR: MESIN DI SINI, DESAIN DI src/email/ ────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Berkas ini hanya tahu CARA MENGIRIM. Bentuk setiap email ada di:
 *   • src/email/layout.mjs    → kerangka (tabel, preheader, dark mode)
 *   • src/email/templates.mjs → satu template per alur
 *
 * Pemisahan ini membuat template bisa diuji tanpa jaringan sama sekali —
 * cukup periksa HTML yang dihasilkan.
 */

import { config } from './config.mjs';

import {
  templateResetSandi,
  templateKodeHapusAkun,
  templateKodeBatalHapus,
  templateSelamatDatang,
  templateMasukPerangkatBaru,
  templateStrukPembayaran,
  templateAkunDinonaktifkan,
  templateKodeMasuk,
} from './email/templates.mjs';

/**
 * ── PENYEDIA: CLOUDFLARE EMAIL SERVICE ──────────────────────────────────────
 *
 * Endpoint: POST /accounts/{account_id}/email/sending/send
 * Auth:     Authorization: Bearer <token>
 *
 * Dua jebakan yang mudah salah (dari dokumentasi resmi):
 *   1. `from` adalah STRING untuk REST API ("nama@domain.com"), bukan objek
 *   2. Field-nya snake_case (`reply_to`), bukan camelCase (`replyTo`)
 */
function endpointKirim() {
  return `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/email/sending/send`;
}

/**
 * ── PENYEDIA: BREVO ─────────────────────────────────────────────────────────
 *
 * ── KENAPA BREVO DITAMBAHKAN ────────────────────────────────────────────────
 * Resend MENOLAK domain dari Public Suffix List — termasuk `is-a.dev`:
 *
 *   "We don't allow free public domains. Please use a domain you own instead."
 *
 * Padahal `victer.is-a.dev` adalah domain yang sudah dimiliki pengguna dan
 * sudah terdaftar resmi di repo is-a.dev. Penolakan itu bukan soal
 * kepemilikan, tapi soal kebijakan anti-abuse Resend.
 *
 * Brevo menerimanya. Terbukti dari repo is-a.dev: beberapa domain memakai
 * Brevo DKIM (`brevo1._domainkey.<domain>` → CNAME ke `dkim.brevo.com`),
 * dan PR-nya di-merge (terbaru 2026-10-05).
 *
 * Bonus: kuota gratis Brevo 300/hari (9.000/bulan) lebih besar dari
 * Resend 100/hari (3.000/bulan).
 *
 * ── PERBEDAAN BENTUK YANG MUDAH SALAH ───────────────────────────────────────
 *   1. Header autentikasi `api-key`, BUKAN `Authorization: Bearer`
 *   2. `sender` dan `to` adalah OBJEK/ARRAY OBJEK, bukan string
 *   3. Isi HTML di `htmlContent`, teks di `textContent` (bukan `html`/`text`)
 *   4. `replyTo` camelCase (sama seperti Resend, beda dari Cloudflare)
 */
function endpointBrevo() {
  return 'https://api.brevo.com/v3/smtp/email';
}

/** Penyedia mana yang aktif. `null` kalau tidak ada yang siap. */
export function penyediaAktif() {
  // ── URUTAN: BREVO → RESEND → CLOUDFLARE ────────────────────────────────────
  //
  // Brevo diperiksa PERTAMA karena ia menerima domain dari Public Suffix List
  // (termasuk `is-a.dev`), sementara Resend menolaknya. Kalau pengguna punya
  // kedua kunci dan domainnya is-a.dev, Resend akan gagal saat verifikasi
  // domain — jadi Brevo yang harus menang.
  //
  // Urutan lengkapnya berdasarkan "bekerja di paling banyak keadaan":
  //   1. Brevo     — terima domain publik + tanpa domain (sender tunggal)
  //   2. Resend    — tanpa domain, tapi TOLAK domain publik
  //   3. Cloudflare— wajib domain sendiri yang sudah di-onboard
  if (config.brevoApiKey) return 'brevo';
  if (config.resendApiKey) return 'resend';
  if (config.cfApiToken && config.cfAccountId && config.emailFrom) return 'cloudflare';
  return null;
}

/** Apakah pengiriman email sudah dikonfigurasi? */
export function emailSiap() {
  return penyediaAktif() !== null;
}

/**
 * Alamat pengirim yang dipakai.
 *
 * Resend menyediakan `onboarding@resend.dev` untuk mode uji — bisa dipakai
 * tanpa verifikasi domain. Cloudflare TIDAK punya padanan itu.
 */
function alamatPengirim() {
  if (config.emailFrom) return config.emailFrom;
  if (penyediaAktif() === 'resend') return 'VIVASTIC <onboarding@resend.dev>';
  if (penyediaAktif() === 'brevo') return config.brevoSenderEmail || '';
  return '';
}

/**
 * Kirim satu email (HTML + teks).
 *
 * @returns {Promise<{ok: boolean, error?: string, id?: string, penyedia?: string}>}
 */
async function kirim({ ke, subjek, html, teks, balasKe }) {
  const penyedia = penyediaAktif();
  if (!penyedia) {
    return { ok: false, error: 'belum_dikonfigur' };
  }

  const dari = alamatPengirim();

  try {
    const res = penyedia === 'brevo'
      ? await kirimBrevo({ ke, dari, subjek, html, teks, balasKe })
      : penyedia === 'resend'
        ? await kirimResend({ ke, dari, subjek, html, teks, balasKe })
        : await kirimCloudflare({ ke, dari, subjek, html, teks, balasKe });

    if (!res.ok) return res;

    const data = await res.res.json().catch(() => ({}));
    return { ok: true, id: data.id ?? data.messageId, penyedia };

  } catch (e) {
    // Termasuk AbortError (timeout) dan kegagalan jaringan
    return { ok: false, error: `jaringan: ${e?.message ?? 'tidak diketahui'}` };
  }
}

/**
 * Kirim lewat Resend.
 *
 * Tiga perbedaan dari Cloudflare yang mudah tertukar:
 *   1. `to` adalah ARRAY, bukan string
 *   2. `from` boleh berisi nama: "VIVASTIC <alamat@domain>"
 *   3. Field-nya camelCase (`replyTo`), Cloudflare snake_case (`reply_to`)
 */
async function kirimResend({ ke, dari, subjek, html, teks, balasKe }) {
  const muatan = {
    from: dari,
    to: [ke],                    // ARRAY — beda dari Cloudflare
    subject: subjek,
    html,
    text: teks,
  };
  if (balasKe) muatan.reply_to = balasKe;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(muatan),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch { /* bukan JSON */ }
    return { ok: false, res, error: `resend_${res.status}: ${detail}` };
  }

  return { ok: true, res };
}

/**
 * Kirim lewat Brevo.
 *
 * ── PERBEDAAN BENTUK DARI DUA PENYEDIA LAIN ─────────────────────────────────
 *
 *   1. Header `api-key`, BUKAN `Authorization: Bearer`
 *   2. `sender` adalah OBJEK { email, name } — bukan string
 *   3. `to` adalah ARRAY OBJEK [{ email }] — bukan array string
 *   4. Isi di `htmlContent` / `textContent` — bukan `html` / `text`
 *
 * Empat perbedaan ini menghasilkan galat yang tidak jelas kalau tertukar
 * ("missing parameter sender"), tanpa menyebut mana yang salah.
 *
 * ── PARSING NAMA PENGIRIM ───────────────────────────────────────────────────
 * `EMAIL_FROM` boleh berbentuk "VIVASTIC <noreply@domain.com>". Brevo minta
 * nama dan alamat sebagai FIELD TERPISAH, jadi string itu harus diurai.
 * Kalau tidak diurai, Brevo menolak dengan "invalid sender email".
 */
async function kirimBrevo({ ke, dari, subjek, html, teks, balasKe }) {
  // Urai "Nama <alamat@domain>" → { name, email }
  const cocok = String(dari ?? '').match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  const pengirim = cocok
    ? { name: cocok[1] || 'VIVASTIC', email: cocok[2].trim() }
    : { name: 'VIVASTIC', email: String(dari ?? '').trim() };

  const muatan = {
    sender: pengirim,
    to: [{ email: ke }],
    subject: subjek,
    htmlContent: html,
    textContent: teks,
  };
  if (balasKe) muatan.replyTo = { email: balasKe };

  const res = await fetch(endpointBrevo(), {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,   // BUKAN Authorization: Bearer
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(muatan),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()).slice(0, 250); } catch { /* bukan JSON */ }
    return { ok: false, res, error: `brevo_${res.status}: ${detail}` };
  }

  return { ok: true, res };
}

/**
 * Kirim lewat Cloudflare Email Service.
 *
 *  1. `from` adalah STRING ("nama@domain.com"), BUKAN objek { address, name }
 *  2. Field-nya snake_case (`reply_to`), bukan camelCase
 */
async function kirimCloudflare({ ke, dari, subjek, html, teks, balasKe }) {
  const muatan = {
    to: ke,                      // STRING — beda dari Resend
    from: dari,
    subject: subjek,
    html,
    text: teks,
  };
  if (balasKe) muatan.reply_to = balasKe;

  const res = await fetch(endpointKirim(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(muatan),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch { /* bukan JSON */ }
    return { ok: false, res, error: `cf_${res.status}: ${detail}` };
  }

  return { ok: true, res };
}

/**
 * Kirim email dari template, dengan jalur cadangan log.
 *
 * ── KENAPA SATU PEMBUNGKUS UNTUK SEMUA ───────────────────────────────────────
 * Setiap alur butuh perilaku yang sama saat gagal:
 *   1. Catat kegagalannya (untuk diagnosa)
 *   2. Jangan lempar (alur pengguna tidak boleh rusak)
 *   3. Tulis data penting ke log supaya bisa diteruskan manual
 *
 * Menyalin ketiganya ke delapan fungsi berarti delapan kesempatan untuk
 * salah. Pembungkus ini membuat perilaku gagal konsisten.
 *
 * @param {object} opsi
 * @param {string} opsi.ke          - alamat tujuan
 * @param {object} opsi.template    - hasil template*() → { subjek, html, teks }
 * @param {string} [opsi.label]     - nama alur untuk log
 * @param {string} [opsi.cadangan]  - teks yang ditulis ke log kalau gagal
 */
async function kirimTemplate({ ke, template, label = 'email', cadangan = '' }) {
  const hasil = await kirim({
    ke,
    subjek: template.subjek,
    html: template.html,
    teks: template.teks,
  });

  if (!hasil.ok) {
    console.error(`[email] GAGAL kirim ${label} ke ${ke}: ${hasil.error}`);
    if (cadangan) console.error(`[email] CADANGAN ${label} untuk ${ke}: ${cadangan}`);
  }

  return hasil;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── FUNGSI PUBLIK — satu per alur ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Kirim tautan reset sandi.
 *
 * ── TAUTAN MEMUAT TOKEN DI QUERY STRING ─────────────────────────────────────
 * Ini praktik standar. Risikonya: token bisa tercatat di log server/proxy.
 * Mitigasi: TTL 1 jam, sekali pakai, permintaan baru membatalkan token lama,
 * dan yang disimpan di database hanya HASH token.
 */
export async function kirimEmailResetSandi({ ke, nama, token }) {
  const dasar = config.siteUrl || 'https://victer.is-a.dev';
  const tautan = `${dasar}/reset-sandi?token=${encodeURIComponent(token)}`;

  const template = templateResetSandi({ nama, tautan, berlakuMenit: 60 });

  return kirimTemplate({
    ke,
    template,
    label: 'reset-sandi',
    cadangan: `TAUTAN RESET MANUAL → ${tautan}`,
  });
}

/**
 * Kirim kode konfirmasi penghapusan akun.
 *
 * ── KENAPA BUKAN templateResetSandi ─────────────────────────────────────────
 * Versi sebelumnya memakai template reset sandi untuk kode hapus akun —
 * pengguna menerima email berjudul "Ganti sandi Anda" saat meminta hapus akun.
 * Membingungkan, dan pada alur berbahaya seperti ini kebingungan berarti
 * pengguna menyerahkan kode ke orang yang salah.
 */
export async function kirimKodeHapusAkun({ ke, nama, kode, berlakuMenit = 15, sisaHari = 30 }) {
  const template = templateKodeHapusAkun({ nama, kode, berlakuMenit, sisaHari });

  return kirimTemplate({
    ke,
    template,
    label: 'kode-hapus-akun',
    cadangan: `KODE HAPUS AKUN → ${kode} (berlaku ${berlakuMenit} menit)`,
  });
}

/** Kirim kode pembatalan penghapusan akun (pemulihan). */
export async function kirimKodeBatalHapus({ ke, nama, kode, berlakuMenit = 15, sisaHari }) {
  const template = templateKodeBatalHapus({ nama, kode, berlakuMenit, sisaHari });

  return kirimTemplate({
    ke,
    template,
    label: 'kode-batal-hapus',
    cadangan: `KODE BATAL HAPUS → ${kode} (berlaku ${berlakuMenit} menit)`,
  });
}

/** Kirim email selamat datang setelah pendaftaran. */
export async function kirimSelamatDatang({ ke, nama, email, tautanVerifikasi }) {
  const template = templateSelamatDatang({ nama, email: email ?? ke, tautanVerifikasi });

  return kirimTemplate({ ke, template, label: 'selamat-datang' });
}

/** Kirim peringatan masuk dari perangkat baru. */
export async function kirimPeringatanMasukBaru({
  ke, nama, perangkat, lokasi, ip, waktu, tautanAmankan,
}) {
  const template = templateMasukPerangkatBaru({
    nama, perangkat, lokasi, ip, waktu, tautanAmankan,
  });

  return kirimTemplate({ ke, template, label: 'masuk-perangkat-baru' });
}

/** Kirim struk pembayaran setelah pembayaran berhasil. */
export async function kirimStrukPembayaran({
  ke, nama, email, nomorPesanan, paket, periode, jumlah, status, waktu, tautanPesanan,
}) {
  const template = templateStrukPembayaran({
    nama, email: email ?? ke, nomorPesanan, paket, periode, jumlah, status, waktu, tautanPesanan,
  });

  return kirimTemplate({ ke, template, label: 'struk-pembayaran' });
}

/** Kirim pemberitahuan akun dinonaktifkan (masa tenggang dimulai). */
export async function kirimAkunDinonaktifkan({ ke, nama, sisaHari = 30, tautanPulihkan }) {
  const template = templateAkunDinonaktifkan({ nama, sisaHari, tautanPulihkan });

  return kirimTemplate({ ke, template, label: 'akun-dinonaktifkan' });
}

/** Kirim kode masuk (2FA / verifikasi langkah tambahan). */
export async function kirimKodeMasuk({ ke, nama, kode, berlakuMenit = 10, lokasi, ip }) {
  const template = templateKodeMasuk({ nama, kode, berlakuMenit, lokasi, ip });

  return kirimTemplate({
    ke,
    template,
    label: 'kode-masuk',
    cadangan: `KODE MASUK → ${kode} (berlaku ${berlakuMenit} menit)`,
  });
}
