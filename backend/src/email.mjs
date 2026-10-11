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
 * ── KENAPA RESEND DIPERIKSA DULU ─────────────────────────────────────────────
 *
 * Resend bisa dipakai TANPA domain — jadi ia bekerja di lebih banyak keadaan.
 * Kalau Cloudflare diperiksa dulu, orang yang sudah mengisi RESEND_API_KEY
 * tapi belum punya domain akan mendapat "belum dikonfigurasi" padahal
 * sebenarnya siap.
 *
 * Begitu domain tersedia, isi CF_* DAN hapus RESEND_API_KEY — otomatis
 * berpindah ke Cloudflare.
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
 */

import { config } from './config.mjs';

/**
 * ── PENYEDIA: CLOUDFLARE EMAIL SERVICE ──────────────────────────────────────
 *
 * Dipilih setelah membaca skill `cloudflare-email-service` dan dokumentasi
 * resminya. Alasan:
 *   • Satu platform dengan hosting situs — tidak ada akun pihak ketiga lagi
 *   • REST API sederhana: cukup fetch, tidak perlu pustaka SMTP
 *     (proyek ini sengaja nol dependensi)
 *   • Domain sudah di Cloudflare, jadi verifikasi SPF/DKIM lebih singkat
 *
 * ── PERBEDAAN DARI RESEND YANG PERLU DICATAT ────────────────────────────────
 * Dokumentasi resmi menyebutkan dua jebakan yang mudah salah:
 *
 *   1. `from` adalah STRING untuk REST API ("nama@domain.com"), bukan objek
 *      { address, name }. Objek dipakai di Workers binding — tertukar akan
 *      ditolak. (Skill: "Use { address, name } for REST, { email, name } for
 *      Workers")
 *   2. Field-nya snake_case (`reply_to`), bukan camelCase (`replyTo`).
 *
 * Endpoint: POST /accounts/{account_id}/email/sending/send
 * Auth:     Authorization: Bearer <API_TOKEN>
 */
function endpointKirim() {
  return `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/email/sending/send`;
}

/** Penyedia mana yang aktif. `null` kalau tidak ada yang siap. */
export function penyediaAktif() {
  // ── URUTAN: RESEND DULU ────────────────────────────────────────────────────
  //
  // Resend bisa dipakai TANPA domain sendiri, jadi ia bekerja di lebih banyak
  // keadaan. Cloudflare WAJIB punya domain yang sudah di-onboard.
  //
  // Kalau Cloudflare diperiksa dulu, orang yang sudah mengisi RESEND_API_KEY
  // tapi belum punya domain akan mendapat "belum dikonfigurasi" padahal
  // sebenarnya siap mengirim.
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
 * ── KENAPA RESEND PUNYA DEFAULT, CLOUDFLARE TIDAK ───────────────────────────
 *
 * Resend menyediakan `onboarding@resend.dev` untuk mode uji — bisa dipakai
 * tanpa verifikasi domain apa pun. Cloudflare TIDAK punya padanan itu: alamat
 * pengirimnya WAJIB di domain yang sudah di-onboard, jadi tidak ada default
 * yang masuk akal.
 */
function alamatPengirim() {
  if (config.emailFrom) return config.emailFrom;
  if (penyediaAktif() === 'resend') return 'onboarding@resend.dev';
  return '';
}

/**
 * Kirim satu email HTML + teks.
 *
 * @returns {Promise<{ok: boolean, error?: string, id?: string}>}
 */
async function kirim({ ke, subjek, html, teks }) {
  const penyedia = penyediaAktif();
  if (!penyedia) {
    return { ok: false, error: 'belum_dikonfigur' };
  }

  const dari = alamatPengirim();

  try {
    const res = penyedia === 'resend'
      ? await kirimResend({ ke, dari, subjek, html, teks })
      : await kirimCloudflare({ ke, dari, subjek, html, teks });

    if (!res.ok) return res;

    const data = await res.res.json().catch(() => ({}));
    return { ok: true, id: data.id, penyedia };

  } catch (e) {
    // Termasuk AbortError (timeout) dan kegagalan jaringan
    return { ok: false, error: `jaringan: ${e?.message ?? 'tidak diketahui'}` };
  }
}

/**
 * Kirim lewat Resend.
 *
 * ── BENTUK YANG BERBEDA DARI CLOUDFLARE ─────────────────────────────────────
 *
 *   1. `to` adalah ARRAY, bukan string — Cloudflare memakai string
 *   2. `from` boleh berisi nama: "Vivastic <onboarding@resend.dev>"
 *   3. Field-nya camelCase (`replyTo`), Cloudflare snake_case (`reply_to`)
 *
 * Ketiga perbedaan ini mudah tertukar, dan tertukarnya menghasilkan galat
 * yang tidak jelas ("invalid to field") tanpa menyebut mana yang salah.
 */
async function kirimResend({ ke, dari, subjek, html, teks }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: dari,
      to: [ke],                    // ARRAY — beda dari Cloudflare
      subject: subjek,
      html,
      text: teks,
    }),
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
 * Kirim lewat Cloudflare Email Service.
 *
 * ── DUA JEBAKAN YANG MUDAH SALAH (dari dokumentasi resmi) ───────────────────
 *
 *   1. `from` adalah STRING ("nama@domain.com"), BUKAN objek { address, name }.
 *      Objek dipakai di Workers binding — tertukar akan ditolak.
 *   2. Field-nya snake_case (`reply_to`), bukan camelCase (`replyTo`).
 */
async function kirimCloudflare({ ke, dari, subjek, html, teks }) {
  const res = await fetch(endpointKirim(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: ke,                      // STRING — beda dari Resend
      from: dari,
      subject: subjek,
      html,
      text: teks,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch { /* bukan JSON */ }
    return { ok: false, res, error: `cf_${res.status}: ${detail}` };
  }

  return { ok: true, res };
}

/** Bentuk dasar email agar konsisten: latar gelap, aksen emas, tanpa gambar. */
function bungkusHtml({ judul, isi }) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="width:32px;height:32px;border-radius:10px;background:#f5c542;margin-bottom:24px"></div>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#f4f4f5;letter-spacing:-0.02em">${judul}</h1>
    ${isi}
    <hr style="margin:32px 0 16px;border:none;border-top:1px solid rgba(255,255,255,0.09)">
    <p style="margin:0;font-size:12px;color:#71717a">
      Email otomatis dari area klien Victer. Jangan balas pesan ini.
    </p>
  </div>
</body></html>`;
}

/**
 * Kirim tautan reset sandi.
 *
 * ── TAUTAN MEMUAT TOKEN DI QUERY STRING ─────────────────────────────────────
 * Ini praktik standar untuk reset sandi. Risikonya: token bisa tercatat di
 * log server/proxy. Mitigasi yang dipakai:
 *   • TTL 1 jam — jendela penyalahgunaan sempit
 *   • sekali pakai — begitu dipakai, tidak berlaku lagi
 *   • permintaan baru membatalkan token lama
 *   • yang disimpan di database hanya HASH token
 */
export async function kirimEmailResetSandi({ ke, nama, token }) {
  const dasar = config.siteUrl || 'https://portfolio-victer.pages.dev';
  const tautan = `${dasar}/reset-sandi?token=${encodeURIComponent(token)}`;
  const sapa = nama ? `Halo ${nama},` : 'Halo,';

  const teks = `${sapa}

Kami menerima permintaan untuk mengganti sandi akun Anda.

Buka tautan ini untuk membuat sandi baru:
${tautan}

Tautan berlaku 1 jam dan hanya bisa dipakai sekali.

Kalau Anda tidak meminta ini, abaikan email ini — sandi Anda tidak berubah.`;

  const html = bungkusHtml({
    judul: 'Ganti sandi Anda',
    isi: `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#a1a1aa">${sapa}</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa">
        Kami menerima permintaan untuk mengganti sandi akun Anda.
      </p>
      <a href="${tautan}"
         style="display:inline-block;padding:12px 24px;background:#f5c542;color:#0a0a0b;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px">
        Buat sandi baru
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
        Tautan berlaku <strong style="color:#a1a1aa">1 jam</strong> dan hanya bisa dipakai sekali.
      </p>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#71717a">
        Kalau Anda tidak meminta ini, abaikan email ini — sandi Anda tidak berubah.
      </p>
    `,
  });

  const hasil = await kirim({ ke, subjek: 'Ganti sandi akun Victer', html, teks });

  if (!hasil.ok) {
    // ── JALUR CADANGAN: TULIS KE LOG ─────────────────────────────────────────
    // Kalau email belum dikonfigurasi atau gagal, tautan ditulis ke log server
    // supaya pemilik bisa meneruskannya manual. Ini menjaga alur reset tetap
    // bisa dipakai sebelum Resend disiapkan — lebih baik daripada fitur yang
    // tampak ada tapi diam-diam tidak mengirim apa pun.
    console.error(`[email] GAGAL kirim reset ke ${ke}: ${hasil.error}`);
    console.error(`[email] TAUTAN RESET MANUAL untuk ${ke}: ${tautan}`);
  }

  return hasil;
}
