/**
 * Klien Xendit — pembayaran langganan untuk pasar Indonesia.
 *
 * ── KENAPA XENDIT, BUKAN STRIPE ────────────────────────────────────────────
 * Stripe tidak mendukung Indonesia secara penuh — statusnya *preview*
 * (undangan saja), dan yang di-approve hanya bisa settle IDR lewat metode
 * lokal. Kebanyakan bisnis Indonesia tidak bisa mendaftar sendiri.
 *
 * Jalan "pakai rekening Payoneer" juga tidak sah: Stripe mensyaratkan badan
 * hukum, tax ID, DAN rekening bank FISIK di negara yang sama. Virtual account
 * tidak memenuhi itu — dan kalau dipaksa, akunnya bisa dibekukan setelah ada
 * pembayaran masuk.
 *
 * Xendit berlisensi Bank Indonesia, settle IDR langsung ke rekening bank
 * Indonesia, dan mendukung QRIS, VA (BCA/Mandiri/BNI/BRI), GoPay, OVO, DANA,
 * ShopeePay, kartu — yang memang dipakai pembeli Indonesia.
 *
 * ── TANPA SDK ──────────────────────────────────────────────────────────────
 * Sama seperti modul lain di proyek ini: `fetch` bawaan sudah cukup. SDK
 * Xendit menambah dependensi untuk tiga panggilan API.
 *
 * ── AUTENTIKASI: BASIC AUTH, BUKAN BEARER ──────────────────────────────────
 * Ini beda dari Stripe dan sumber kesalahan yang paling sering:
 *
 *   Stripe  : Authorization: Bearer sk_live_xxx
 *   Xendit  : Authorization: Basic base64("sk_live_xxx:")
 *                                            ↑
 *                                    titik dua di akhir WAJIB
 *
 * Secret key jadi USERNAME, password KOSONG. Tanpa titik duanya, Xendit
 * menjawab 401 tanpa penjelasan yang jelas.
 *
 * Verifikasi: https://docs.xendit.co/quick-setup
 */

import { timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';

const API = 'https://api.xendit.co';

/** Batas waktu panggilan API. */
const TIMEOUT_MS = 15_000;

/** Apakah pembayaran sudah dikonfigurasi? */
export function xenditAktif() {
  return Boolean(config.xenditSecretKey && config.xenditCallbackToken);
}

/**
 * Header autentikasi Xendit.
 *
 * ── KENAPA `Buffer.from(kunci + ':')` ──────────────────────────────────────
 * Format Basic Auth adalah `username:password`. Xendit memakai secret key
 * sebagai username dan password KOSONG — jadi stringnya harus diakhiri
 * titik dua.
 *
 * Tanpa titik dua itu, Xendit menolak dengan 401 dan pesannya tidak
 * menjelaskan sebabnya. Ini kesalahan yang menghabiskan waktu paling lama
 * saat pertama kali integrasi.
 */
function headerAuth() {
  const dasar = Buffer.from(`${config.xenditSecretKey}:`, 'utf8').toString('base64');
  return {
    Authorization: `Basic ${dasar}`,
    'Content-Type': 'application/json',
    // Versi API — dipin agar perubahan Xendit tidak memutus integrasi
    'api-version': '2024-11-30',
  };
}

/**
 * Panggil API Xendit.
 *
 * @param {string} metode  'POST' atau 'GET'
 * @param {string} jalur   '/v2/invoices'
 * @param {object} data    Body (untuk POST)
 */
export async function panggilXendit(metode, jalur, data = {}) {
  if (!config.xenditSecretKey) {
    throw Object.assign(new Error('Xendit belum dikonfigurasi'), {
      kode: 'xendit_belum_dikonfigurasi',
      statusCode: 503,
    });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API}${jalur}`, {
      method: metode,
      headers: headerAuth(),
      body: metode === 'POST' ? JSON.stringify(data) : undefined,
      signal: ctl.signal,
    });

    const isi = await res.json().catch(() => null);

    if (!res.ok) {
      // ── BENTUK ERROR XENDIT ─────────────────────────────────────────────
      // { error_code: "DATA_NOT_FOUND", message: "..." }
      //
      // `error_code` yang berguna untuk logika; `message` untuk manusia.
      const kode = isi?.error_code ?? `http_${res.status}`;
      const pesan = isi?.message ?? `Xendit menjawab ${res.status}`;

      throw Object.assign(new Error(pesan), {
        kode,
        statusCode: res.status === 401 ? 503 : 400,
        xenditStatus: res.status,
      });
    }

    return isi;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw Object.assign(new Error('Xendit tidak menjawab dalam 15 detik'), {
        kode: 'xendit_timeout',
        statusCode: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Invoice ────────────────────────────────────────────────────────────── */

/**
 * Buat Invoice — halaman pembayaran yang di-host Xendit.
 *
 * ── KENAPA INVOICE, BUKAN PAYMENT REQUEST ──────────────────────────────────
 * Invoice memberi satu halaman checkout berisi SEMUA metode yang aktif:
 * QRIS, VA semua bank, e-wallet, kartu. Pembeli memilih sendiri.
 *
 * Payment Request butuh UI sendiri per metode — jauh lebih banyak kerja,
 * dan hasilnya tidak lebih baik untuk kasus ini.
 *
 * ── `externalId` ADALAH KUNCI IDEMPOTENSI ──────────────────────────────────
 * Ini pengaman terhadap dobel tagih. Kalau `externalId` yang sama dikirim
 * dua kali, Xendit mengembalikan invoice yang SAMA — bukan membuat yang baru.
 *
 * Bedanya dengan Stripe: Stripe pakai header `Idempotency-Key`, Xendit pakai
 * field di body. Efeknya sama.
 *
 * Jadi `externalId` = ID pembayaran internal kita (`pay_xxx`). Kalau
 * pengguna klik "Bayar" dua kali, keduanya menghasilkan invoice yang sama.
 *
 * ── `amount` DALAM RUPIAH PENUH ────────────────────────────────────────────
 * Rp 200.000 dikirim sebagai `200000`. IDR tidak punya sen — tidak ada
 * perkalian 100 seperti USD. Salah satu nol saja berarti 10x salah tagih.
 */
export async function buatInvoice({
  externalId,
  jumlah,
  deskripsi,
  emailPelanggan = '',
  namaPelanggan = '',
  suksesUrl,
  gagalUrl,
  metadata = {},
  durasiDetik = 24 * 3600,
}) {
  const data = {
    external_id: externalId,
    amount: jumlah,
    currency: 'IDR',
    description: deskripsi.slice(0, 255),

    // ── KENAPA `invoice_duration` DIISI ────────────────────────────────────
    // Default Xendit adalah 24 jam, tapi kalau dikosongkan ia bisa jadi
    // 30 hari — dan invoice lama yang menggantung membuat rekonsiliasi
    // sulit. 24 jam cukup untuk pembeli yang serius.
    invoice_duration: durasiDetik,

    success_redirect_url: suksesUrl ?? config.checkoutSuksesUrl,
    failure_redirect_url: gagalUrl ?? config.checkoutBatalUrl,

    // ── KENAPA `should_send_email` MATI ────────────────────────────────────
    // Token akses dikirim oleh SISTEM KITA lewat email sendiri, dengan
    // konteks yang jelas. Kalau Xendit juga mengirim email, pembeli menerima
    // DUA email dan bingung mana yang berisi token.
    should_send_email: false,

    // Metadata dikembalikan utuh di webhook — inilah yang memberitahu sistem
    // paket mana yang dibeli.
    metadata,
  };

  // Field pelanggan hanya dikirim kalau ada isinya — Xendit menolak
  // string kosong untuk field email.
  if (emailPelanggan) data.payer_email = emailPelanggan;
  if (namaPelanggan) data.customer = { given_names: namaPelanggan };

  return panggilXendit('POST', '/v2/invoices', data);
}

/** Ambil invoice berdasarkan ID Xendit — untuk cek status. */
export async function ambilInvoice(invoiceId) {
  return panggilXendit('GET', `/v2/invoices/${encodeURIComponent(invoiceId)}`);
}

/** Batalkan invoice supaya tidak bisa dibayar lagi. */
export async function batalkanInvoice(invoiceId) {
  return panggilXendit('POST', `/invoices/${encodeURIComponent(invoiceId)}/expire!`);
}

/* ── Webhook ────────────────────────────────────────────────────────────── */

/**
 * Verifikasi webhook Xendit.
 *
 * ── CARA KERJA: TOKEN STATIS, BUKAN HMAC ───────────────────────────────────
 * Ini BEDA dari Stripe, dan penting dipahami:
 *
 *   Stripe : tanda tangan HMAC per-request (dihitung dari body + waktu)
 *   Xendit : token statis di header `x-callback-token`
 *
 * Artinya: Xendit TIDAK menandatangani body. Yang dikirim adalah token yang
 * sama di setiap request.
 *
 * Konsekuensinya — dan ini yang harus disadari:
 *   • Tidak ada perlindungan replay dari sisi kriptografi
 *   • Tidak ada jaminan body tidak diubah di tengah jalan (walau HTTPS
 *     menanganinya)
 *
 * Karena itu, verifikasi token SAJA tidak cukup. Perlindungan tambahan yang
 * WAJIB ada di lapisan pemrosesan:
 *
 *   1. Idempotensi lewat `event_id` — webhook yang sama tidak diproses dua kali
 *   2. Verifikasi jumlah — nominal di webhook harus cocok dengan yang tercatat
 *   3. Verifikasi status — hanya proses status yang memang final
 *
 * Ketiganya ada di `checkout.mjs`. Verifikasi token di sini adalah lapisan
 * PERTAMA, bukan satu-satunya.
 *
 * Perbandingan memakai `timingSafeEqual` supaya waktu eksekusi tidak
 * membocorkan berapa karakter yang sudah benar.
 */
export function verifikasiWebhookXendit(headerToken) {
  if (!config.xenditCallbackToken) {
    return { ok: false, alasan: 'callback_token_kosong' };
  }
  if (!headerToken) {
    return { ok: false, alasan: 'token_tidak_ada' };
  }

  const diharapkan = Buffer.from(config.xenditCallbackToken, 'utf8');
  const diterima = Buffer.from(String(headerToken), 'utf8');

  // Panjang harus sama sebelum timingSafeEqual — ia melempar kalau beda
  if (diharapkan.length !== diterima.length) {
    return { ok: false, alasan: 'token_tidak_cocok' };
  }

  if (timingSafeEqual(diharapkan, diterima)) {
    return { ok: true };
  }

  return { ok: false, alasan: 'token_tidak_cocok' };
}

/* ── Terjemahan status & error ──────────────────────────────────────────── */

/**
 * Status invoice Xendit → status internal kita.
 *
 * Xendit: PENDING | PAID | SETTLED | EXPIRED | FAILED
 * Kita  : pending | dibayar | gagal | kedaluwarsa
 *
 * ── KENAPA `PAID` DAN `SETTLED` SAMA-SAMA "DIBAYAR" ───────────────────────
 * PAID = pembeli sudah membayar.
 * SETTLED = uang sudah masuk rekening kita.
 *
 * Untuk penerbitan token, yang penting adalah PAID — pembeli sudah
 * menunaikan kewajibannya. Menunggu SETTLED berarti pembeli menunggu 1-2
 * hari kerja sebelum bisa mengakses, dan itu tidak perlu.
 */
export function statusInternal(statusXendit) {
  const peta = {
    PENDING: 'pending',
    PAID: 'dibayar',
    SETTLED: 'dibayar',
    EXPIRED: 'kedaluwarsa',
    FAILED: 'gagal',
  };
  return peta[String(statusXendit).toUpperCase()] ?? 'pending';
}

/**
 * Terjemahkan error Xendit jadi pesan Indonesia yang bisa ditindaklanjuti.
 *
 * Sama seperti versi Stripe: pembeli butuh tahu APA YANG HARUS DILAKUKAN,
 * bukan kode error teknis.
 */
export function pesanGalatXendit(err) {
  const kode = String(err?.kode ?? '').toUpperCase();

  const peta = {
    INVALID_API_KEY: {
      pesan: 'Pembayaran sedang tidak bisa diproses.',
      saran: 'Ini masalah di sisi kami, bukan Anda. Coba lagi sebentar lagi, atau hubungi saya lewat halaman kontak.',
    },
    API_VALIDATION_ERROR: {
      pesan: 'Data pembayaran tidak lengkap.',
      saran: 'Periksa email dan coba lagi. Kalau tetap gagal, hubungi saya.',
    },
    REQUEST_FORBIDDEN_ERROR: {
      pesan: 'Pembayaran tidak diizinkan untuk akun ini.',
      saran: 'Hubungi saya lewat halaman kontak — saya akan bantu prosesnya secara manual.',
    },
    SERVER_ERROR: {
      pesan: 'Layanan pembayaran sedang gangguan.',
      saran: 'Tunggu beberapa menit lalu coba lagi.',
    },
    xendit_timeout: {
      pesan: 'Layanan pembayaran tidak menjawab.',
      saran: 'Periksa koneksi Anda lalu coba lagi. Pembayaran tidak akan dobel — sistem kami mencegahnya.',
    },
  };

  const cocok = peta[kode];
  if (cocok) return cocok;

  return {
    pesan: 'Pembayaran tidak bisa diproses.',
    saran: 'Coba lagi sebentar lagi. Kalau tetap gagal, hubungi saya lewat halaman kontak — saya bantu prosesnya.',
  };
}
