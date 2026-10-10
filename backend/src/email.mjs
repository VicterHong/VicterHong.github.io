/**
 * Pengiriman email — pembungkus tipis untuk API Resend.
 *
 * ── KENAPA RESEND ───────────────────────────────────────────────────────────
 * Dipilih pemilik proyek. Alasan teknisnya cocok:
 *   • API HTTP sederhana — cukup `fetch`, tidak perlu pustaka SMTP
 *     (proyek ini sengaja nol dependensi)
 *   • 3.000 email/bulan gratis — cukup untuk reset sandi
 *   • Domain bisa diverifikasi (SPF/DKIM) sehingga email tidak masuk spam
 *
 * ── PRINSIP: KEGAGALAN EMAIL TIDAK BOLEH MERUSAK ALUR ───────────────────────
 * Semua fungsi di sini mengembalikan { ok, error } dan TIDAK melempar untuk
 * kegagalan pengiriman. Alasan:
 *   • "Lupa sandi" harus SELALU membalas sukses (mencegah user enumeration).
 *     Kalau pengiriman melempar, responsnya berubah jadi galat — dan
 *     penyerang bisa menyimpulkan email itu terdaftar.
 *   • Reset sandi yang gagal kirim bukan bencana: pengguna bisa coba lagi.
 *
 * ── TANPA API KEY, MODUL INI TIDAK RUSAK ────────────────────────────────────
 * Kalau RESEND_API_KEY belum diset, fungsi mengembalikan
 * { ok: false, error: 'belum_dikonfigur' } dan MENULIS TAUTAN ke log server.
 * Jadi alur reset bisa diuji dan dipakai manual sebelum email dikonfigurasi.
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

/** Apakah pengiriman email sudah dikonfigurasi? */
export function emailSiap() {
  return Boolean(config.cfApiToken && config.cfAccountId && config.emailFrom);
}

/**
 * Kirim satu email HTML + teks.
 *
 * @returns {Promise<{ok: boolean, error?: string, id?: string}>}
 */
async function kirim({ ke, subjek, html, teks }) {
  if (!emailSiap()) {
    return { ok: false, error: 'belum_dikonfigur' };
  }

  try {
    const res = await fetch(endpointKirim(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cfApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // `to` dan `from` STRING untuk REST API — bukan array, bukan objek.
        // Dokumentasi Cloudflare memakai bentuk ini di contoh curl resminya.
        to: ke,
        from: config.emailFrom,
        subject: subjek,
        html,
        text: teks,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Baca pesan galat Cloudflare untuk log — jangan diteruskan ke pengguna
      // (bisa memuat detail internal seperti status domain).
      let detail = '';
      try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch { /* bukan JSON */ }
      return { ok: false, error: `cf_${res.status}: ${detail}` };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.id };
  } catch (e) {
    // Termasuk AbortError (timeout) dan kegagalan jaringan
    return { ok: false, error: `jaringan: ${e?.message ?? 'tidak diketahui'}` };
  }
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
