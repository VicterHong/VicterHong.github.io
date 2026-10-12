#!/usr/bin/env node
/**
 * Setelah PR is-a.dev di-merge: verifikasi domain Brevo + uji kirim email.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA SKRIP INI ADA ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Alur yang benar setelah PR di-merge:
 *
 *   1. Tunggu DNS menyebar (biasanya beberapa menit)
 *   2. Cek record TXT `brevo-code` terbaca
 *   3. Cek Brevo sudah menandai domain terverifikasi
 *   4. UJI KIRIM SUNGGUHAN — ini yang paling penting
 *   5. Kalau berhasil, baru ubah EMAIL_FROM ke noreply@victer.is-a.dev
 *
 * Langkah 4 tidak boleh dilewati: verifikasi domain di dashboard TIDAK
 * menjamin pengiriman berhasil. Bug sebelumnya (7 email ditolak) terjadi
 * justru SETELAH semua record "terlihat benar" — yang membuktikan hanya
 * uji kirim sungguhan.
 *
 * Jalankan: node scripts/cek-verifikasi-brevo.mjs
 *           node scripts/cek-verifikasi-brevo.mjs --tunggu   (tunggu sampai siap)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TUNGGU = process.argv.includes('--tunggu');
const DOMAIN = 'victer.is-a.dev';
const KODE_BREVO = 'brevo-code:739779c7f373936de9f1a1ad3fa4ea27';
const EMAIL_UJI = 'victerphanjaya@gmail.com';

// ── Muat BREVO_API_KEY dari service.env ──────────────────────────────────────
function muatKunci() {
  if (process.env.BREVO_API_KEY) return process.env.BREVO_API_KEY;

  const berkas = [
    '/home/ubuntu/.portfolio-token/service.env',
    resolve(__dirname, '..', '.env'),
  ];
  for (const f of berkas) {
    try {
      for (const baris of readFileSync(f, 'utf8').split('\n')) {
        if (baris.startsWith('BREVO_API_KEY=')) {
          return baris.slice('BREVO_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* lanjut ke berkas berikutnya */ }
  }
  return null;
}

const KUNCI = muatKunci();
if (!KUNCI) {
  console.error('❌ BREVO_API_KEY tidak ditemukan di environment maupun service.env');
  process.exit(1);
}

const H = { 'api-key': KUNCI, accept: 'application/json', 'content-type': 'application/json' };

// ── Bantu ────────────────────────────────────────────────────────────────────
const log = (s) => console.log(`  ${s}`);
const ok = (s) => log(`✅ ${s}`);
const gagal = (s) => log(`❌ ${s}`);
const info = (s) => log(`   ${s}`);

// ══════════════════════════════════════════════════════════════════════════════
// ── 1. CEK DNS: TXT brevo-code ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function cekDnsTxt() {
  const url = `https://cloudflare-dns.com/dns-query?name=${DOMAIN}&type=TXT`;
  const r = await fetch(url, { headers: { accept: 'application/dns-json' } });
  const d = await r.json();

  const semua = (d.Answer ?? []).map((a) => String(a.data ?? '').replace(/"/g, ''));
  const ada = semua.some((t) => t.includes(KODE_BREVO));

  return { ada, semua };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 2. CEK STATUS DOMAIN DI BREVO ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function cekBrevoDomain() {
  const r = await fetch(`https://api.brevo.com/v3/senders/domains/${DOMAIN}`, { headers: H });
  if (!r.ok) return { error: `HTTP ${r.status}` };

  const d = await r.json();
  return {
    terverifikasi: d.verified === true,
    terautentikasi: d.authenticated === true,
    records: d.dns_records ?? {},
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 3. UJI KIRIM SUNGGUHAN ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// ── KENAPA API "SUKSES" TIDAK CUKUP ─────────────────────────────────────────
//
// Brevo MENJAWAB 200 OK bahkan ketika pengiriman nanti ditolak. Penolakan
// terjadi di sisi pengiriman, bukan di API — jadi `ok: true` dari API BUKAN
// bukti email terkirim.
//
// Terbukti: 7 email ditolak ("sender not valid") sementara API selalu
// menjawab sukses. Pengguna tidak menerima apa pun dan tidak ada error
// di mana pun.
//
// Karena itu fungsi ini memeriksa DUA hal:
//   1. Jawaban API (apakah permintaan diterima)
//   2. Log event Brevo (apakah pengiriman benar-benar terjadi)
//
// Yang kedua adalah bukti sebenarnya.

async function ujiKirim() {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      sender: { name: 'VIVASTIC', email: `noreply@${DOMAIN}` },
      to: [{ email: EMAIL_UJI }],
      subject: 'Uji verifikasi domain VIVASTIC',
      htmlContent: '<p>Kalau Anda menerima ini, domain <b>victer.is-a.dev</b> sudah terverifikasi dan email bisa dikirim.</p>',
    }),
  });

  if (!r.ok) {
    const teks = await r.text();
    let pesan = teks;
    try { pesan = JSON.parse(teks).message ?? teks; } catch { /* biarkan mentah */ }
    return { ok: false, pesan: String(pesan).slice(0, 200), tahap: 'api' };
  }

  const d = await r.json().catch(() => ({}));
  const id = d.messageId ?? d.id;

  // ── TUNGGU SEBENTAR, LALU CEK LOG EVENT ───────────────────────────────────
  // Penolakan muncul di log dalam beberapa detik. 8 detik cukup longgar
  // tanpa membuat skrip terasa menggantung.
  await new Promise((r) => setTimeout(r, 8000));

  const log = await cekLogEvent();
  if (log.ditolak) {
    return {
      ok: false,
      tahap: 'pengiriman',
      pesan: log.alasan ?? 'ditolak oleh penyedia',
      id,
    };
  }

  if (log.terkirim) {
    return { ok: true, id, terkirim: true };
  }

  // Tidak ada bukti ditolak maupun terkirim — jangan klaim sukses.
  return {
    ok: false,
    tahap: 'tidak_pasti',
    pesan: 'API menerima, tapi belum ada bukti pengiriman di log',
    id,
  };
}

/** Baca log event Brevo — bukti sebenarnya pengiriman. */
async function cekLogEvent() {
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=10&sort=desc', { headers: H });
    if (!r.ok) return { ditolak: false, terkirim: false };

    const d = await r.json();
    const peristiwa = d.events ?? [];

    // Cari peristiwa terbaru untuk subjek uji ini.
    const relevan = peristiwa.filter((e) => (e.subject ?? '').includes('Uji verifikasi domain'));

    const error = relevan.find((e) => e.event === 'error');
    if (error) {
      // Alasan dari Brevo sangat spesifik — sertakan supaya bisa langsung
      // ditindaklanjuti tanpa membuka dashboard.
      return { ditolak: true, terkirim: false, alasan: error.reason };
    }

    const terkirim = relevan.some((e) =>
      ['delivered', 'sent', 'opened', 'click', 'unique_opened'].includes(e.event),
    );
    return { ditolak: false, terkirim };
  } catch {
    return { ditolak: false, terkirim: false };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── JALANKAN ────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function sekali() {
  console.log('');
  console.log('  ══ CEK VERIFIKASI DOMAIN BREVO ══');
  console.log('');

  // 1. DNS
  log('1. DNS TXT brevo-code');
  const dns = await cekDnsTxt();
  if (dns.ada) {
    ok('record TXT brevo-code terbaca di DNS');
  } else {
    gagal('record TXT brevo-code BELUM terbaca');
    info(`TXT yang ada: ${dns.semua.length === 0 ? '(tidak ada)' : dns.semua.join(' | ').slice(0, 120)}`);
  }
  console.log('');

  // 2. Brevo
  log('2. Status domain di Brevo');
  const bv = await cekBrevoDomain();
  if (bv.error) {
    gagal(`gagal baca status: ${bv.error}`);
  } else {
    info(`verified      : ${bv.terverifikasi}`);
    info(`authenticated : ${bv.terautentikasi}`);
    for (const [k, v] of Object.entries(bv.records)) {
      const st = v?.status === true ? '✅' : '❌';
      info(`  ${st} ${k} (host: ${v?.host_name ?? '-'})`);
    }
  }
  console.log('');

  // 3. Uji kirim
  log('3. Uji kirim sungguhan dari noreply@' + DOMAIN);
  const kirim = await ujiKirim();
  if (kirim.ok) {
    ok(`email terkirim — ID: ${kirim.id}`);
    info('Cek kotak masuk ' + EMAIL_UJI + ' (termasuk folder spam)');
  } else {
    gagal(`ditolak: ${kirim.pesan}`);
  }
  console.log('');

  return dns.ada && bv.terverifikasi && kirim.ok;
}

if (!TUNGGU) {
  const sukses = await sekali();
  console.log(sukses
    ? '  ✅ SEMUA SIAP — domain terverifikasi, email bisa dikirim\n'
    : '  ⏳ BELUM SIAP — jalankan lagi setelah PR di-merge\n');
  process.exit(sukses ? 0 : 1);
}

// Mode tunggu: cek tiap 2 menit, maksimal 30 kali (1 jam)
console.log('  ⏳ Mode tunggu: cek tiap 2 menit, maksimal 1 jam');
for (let i = 1; i <= 30; i++) {
  console.log(`\n  ── percobaan ${i}/30 ──`);
  const sukses = await sekali();
  if (sukses) {
    console.log('\n  ✅ DOMAIN SIAP — lanjut ubah EMAIL_FROM ke noreply@' + DOMAIN + '\n');
    process.exit(0);
  }
  if (i < 30) await new Promise((r) => setTimeout(r, 120_000));
}
console.log('\n  ⏰ Waktu habis — PR mungkin belum di-merge. Jalankan lagi nanti.\n');
process.exit(1);
