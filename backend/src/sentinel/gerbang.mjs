/**
 * SENTINEL — GERBANG MASUK
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PERAN MODUL INI
 * ══════════════════════════════════════════════════════════════════════════════
 * Ini PINTU webhook. Semua yang datang dari luar masuk lewat sini, dan di
 * sini pula keputusan pertama diambil: diterima atau ditolak.
 *
 * ── URUTAN YANG TIDAK BOLEH DIBALIK ─────────────────────────────────────────
 *
 *   1. Sumber dikenal?          → kalau tidak, 404 (jangan beri tahu apa pun)
 *   2. Sumber aktif?            → secret kosong berarti nonaktif
 *   3. Tanda tangan sah?        → SEBELUM body diurai jadi objek
 *   4. Body masuk antrean
 *
 * Langkah 3 harus sebelum langkah 4. Kalau body diproses lebih dulu, payload
 * palsu sudah menyentuh sistem kita — dan pada titik itu sudah terlambat.
 *
 * ── KENAPA 404 UNTUK SUMBER TIDAK DIKENAL ───────────────────────────────────
 * Membalas 401 untuk sumber tidak dikenal, dan 401 juga untuk tanda tangan
 * salah, memberi tahu penyerang bahwa sumbernya ADA. Ia bisa menyisir nama
 * sumber satu per satu dan tahu mana yang terpasang.
 *
 * Dengan 404, sumber tidak dikenal dan sumber tidak aktif terlihat sama
 * dengan URL yang tidak ada — tidak ada informasi yang bocor.
 *
 * ── KENAPA TANDA TANGAN DIPERIKSA DI SINI, BUKAN DI PEMROSES ────────────────
 * Kalau verifikasi dilakukan nanti (saat pesan dikirim), payload palsu sudah
 * TERSIMPAN di antrean. Database kita terisi sampah, dan pembersihannya
 * manual. Verifikasi di pintu masuk berarti yang tersimpan hanya yang sah.
 */

import { config } from '../config.mjs';
import { verifikasiTandaTangan, PROVIDER, pesanAlasan } from './tanda-tangan.mjs';
import { masukAntrean, BATAS_BODY_BYTE } from './antrean.mjs';
import { verifikasiTandaTanganMidtrans } from '../midtrans.mjs';

/* ══ DAFTAR SUMBER ═════════════════════════════════════════════════════════ */

/**
 * Sumber webhook yang dikenal, beserta cara memverifikasinya.
 *
 * ── KENAPA MIDTRANS DIPERLAKUKAN BERBEDA ────────────────────────────────────
 * Provider lain mengirim tanda tangan di HEADER. Midtrans mengirimnya di
 * DALAM BODY (`signature_key`), dan tanda tangannya dihitung dari isi
 * transaksi: sha512(order_id + status_code + gross_amount + ServerKey).
 *
 * Itu berarti verifikasinya butuh body yang sudah diurai, bukan body mentah.
 * Karena itu ia punya fungsi sendiri (`periksaMidtrans`), bukan lewat
 * `verifikasiTandaTangan`.
 *
 * Konsekuensinya: untuk Midtrans, body HARUS diurai sebelum diverifikasi.
 * Itu tidak melemahkan apa pun — `JSON.parse` tidak menjalankan kode, dan
 * verifikasi tetap terjadi SEBELUM apa pun disimpan.
 */
export const SUMBER = {
  stripe: {
    label: 'Stripe',
    ambilSecret: () => config.sentinelStripeSecret,
    periksa: ({ bodyMentah, headers, secret }) =>
      verifikasiTandaTangan({ provider: 'stripe', bodyMentah, headers, secret }),
  },

  github: {
    label: 'GitHub',
    ambilSecret: () => config.sentinelGithubSecret,
    periksa: ({ bodyMentah, headers, secret }) =>
      verifikasiTandaTangan({ provider: 'github', bodyMentah, headers, secret }),
  },

  telegram: {
    label: 'Telegram',
    ambilSecret: () => config.sentinelTelegramSecret,
    periksa: ({ bodyMentah, headers, secret }) =>
      verifikasiTandaTangan({ provider: 'telegram', bodyMentah, headers, secret }),
  },

  hmac: {
    label: 'HMAC sederhana',
    ambilSecret: () => config.sentinelHmacSecret,
    periksa: ({ bodyMentah, headers, secret }) =>
      verifikasiTandaTangan({ provider: 'hmac', bodyMentah, headers, secret }),
  },

  midtrans: {
    label: 'Midtrans',
    ambilSecret: () => config.midtransServerKey,
    // ── VERIFIKASI MIDTRANS BUTUH BODY TERURAI ──────────────────────────────
    // Karena tanda tangannya ada DI DALAM body, bukan di header. `parseBody`
    // menandai bahwa sumber ini perlu diurai lebih dulu.
    parseBody: true,
    periksa: ({ payload }) => verifikasiTandaTanganMidtrans(payload),
  },
};

/* ══ GERBANG ═══════════════════════════════════════════════════════════════ */

/**
 * Terima webhook dari luar.
 *
 * @param {object} p
 * @param {string} p.sumber          nama sumber ('stripe' | 'github' | ...)
 * @param {string} p.bodyMentah      body permintaan APA ADANYA, belum diurai
 * @param {object} p.headers         header permintaan
 * @returns {{ ok: boolean, kode: number, alasan?: string, pesan?: string, id?: string }}
 */
export function terimaWebhook({ sumber, bodyMentah, headers = {} }) {
  // ── 1. SUMBER DIKENAL? ────────────────────────────────────────────────────
  const definisi = SUMBER[sumber];
  if (!definisi) {
    // 404, bukan 400. Lihat catatan di atas: membedakan "sumber tidak ada"
    // dari "tanda tangan salah" membocorkan sumber mana yang terpasang.
    return {
      ok: false,
      kode: 404,
      alasan: 'sumber_tidak_dikenal',
      pesan: 'Tidak ditemukan',
    };
  }

  // ── 2. SUMBER AKTIF? ──────────────────────────────────────────────────────
  const secret = definisi.ambilSecret();

  if (!secret) {
    // Sumber dikenal tapi belum dikonfigurasi. Sama seperti di atas: 404,
    // supaya tidak membocorkan bahwa sumbernya ada.
    return {
      ok: false,
      kode: 404,
      alasan: 'sumber_nonaktif',
      pesan: 'Tidak ditemukan',
    };
  }

  // ── 3. BATAS UKURAN BODY ──────────────────────────────────────────────────
  // Diperiksa SEBELUM verifikasi: menghitung panjang string jauh lebih murah
  // daripada menghitung HMAC atas 10 MB payload.
  if (Buffer.byteLength(bodyMentah, 'utf8') > BATAS_BODY_BYTE) {
    return {
      ok: false,
      kode: 413,
      alasan: 'body_terlalu_besar',
      pesan: `Body melebihi batas ${BATAS_BODY_BYTE} byte`,
    };
  }

  // ── 4. TANDA TANGAN ───────────────────────────────────────────────────────
  //
  // ── KENAPA PAYLOAD DIURAI UNTUK SEMUA SUMBER ──────────────────────────────
  // Beberapa sumber (Midtrans) menaruh tanda tangannya DI DALAM body, jadi
  // penguraian wajib sebelum verifikasi.
  //
  // Tapi sumber lain juga butuh payload yang terurai — untuk mengambil ID
  // peristiwa (Stripe: `payload.id`). Kalau hanya diurai saat `parseBody`,
  // ID peristiwa sumber lain selalu null, dan idempotensinya jatuh ke sidik
  // jari isi yang jendelanya cuma 1 jam.
  //
  // ── KENAPA AMAN MENGURAI SEBELUM VERIFIKASI ───────────────────────────────
  // `JSON.parse` tidak menjalankan kode dan tidak menyentuh database. Yang
  // penting adalah VERIFIKASI terjadi sebelum apa pun DISIMPAN — dan itu
  // tetap berlaku.
  //
  // Kalau body bukan JSON, `payload` tetap null dan verifikasi tetap jalan
  // dengan body mentah. Sumber yang mewajibkan JSON (parseBody) ditolak
  // lebih tegas di bawah.
  let payload = null;
  try {
    payload = JSON.parse(bodyMentah);
  } catch {
    payload = null;
  }

  if (definisi.parseBody && payload === null) {
    return { ok: false, kode: 400, alasan: 'body_bukan_json', pesan: 'Body bukan JSON' };
  }

  let hasilVerifikasi;
  try {
    hasilVerifikasi = definisi.periksa({ bodyMentah, headers, secret, payload });
  } catch (err) {
    // Verifikasi yang MELEMPAR bukan berarti tanda tangannya sah. Fail-closed:
    // tolak, dan catat supaya terlihat di log.
    console.error(`[sentinel] verifikasi ${sumber} melempar:`, err?.message ?? err);
    return { ok: false, kode: 400, alasan: 'verifikasi_gagal', pesan: 'Tanda tangan tidak valid' };
  }

  if (!hasilVerifikasi?.ok) {
    const alasan = hasilVerifikasi?.alasan ?? 'tanda_tangan_tidak_cocok';
    return {
      ok: false,
      kode: 401,
      alasan,
      pesan: pesanAlasan(alasan) ?? 'Tanda tangan tidak valid',
    };
  }

  // ── 5. MASUK ANTREAN ──────────────────────────────────────────────────────
  const urlTujuan = config.sentinelTujuanUrl || '';

  // ── ID PERISTIWA UNTUK MENOLAK KIRIMAN ULANG ──────────────────────────────
  // Setiap provider menaruh ID-nya di tempat berbeda. Dicari dengan aman:
  // payload bisa saja bukan objek (mis. provider mengirim array).
  const idPeristiwa = ambilIdPeristiwa(sumber, payload, headers);

  const hasil = masukAntrean({
    sumber,
    idPeristiwa,
    url: urlTujuan,
    body: bodyMentah,
    headers: pilihHeaderDiteruskan(headers),
  });

  if (!hasil.ok) {
    return {
      ok: false,
      kode: 400,
      alasan: hasil.alasan,
      pesan: 'Webhook tidak bisa diantrekan',
    };
  }

  // ── DUPLIKAT TETAP DIJAWAB 200 ────────────────────────────────────────────
  // Kalau kita balas non-2xx, provider akan mengirim ulang — dan kiriman ulang
  // itu juga akan terdeteksi duplikat, lalu ditolak lagi, berulang sampai
  // provider menyerah. Yang benar: akui sudah diterima.
  return {
    ok: true,
    kode: 200,
    id: hasil.id,
    duplikat: Boolean(hasil.duplikat),
    alasan: hasil.alasan,
    pesan: hasil.duplikat ? 'Webhook sudah pernah diterima' : 'Webhook diterima',
  };
}

/* ══ PEMBANTU ══════════════════════════════════════════════════════════════ */

/**
 * Cari ID peristiwa dari payload, sesuai kebiasaan tiap provider.
 *
 * ── KENAPA HARUS TAHAN BENTUK APA PUN ───────────────────────────────────────
 * Payload datang dari luar dan bentuknya tidak dijamin. `payload.id` pada
 * array mengembalikan undefined (tidak melempar), tapi `payload.data.id` akan
 * MELEMPAR kalau `payload.data` bukan objek. Satu webhook berbentuk aneh
 * tidak boleh menggagalkan seluruh permintaan.
 */
function ambilIdPeristiwa(sumber, payload, headers) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const data = obj.data && typeof obj.data === 'object' ? obj.data : {};

  switch (sumber) {
    case 'stripe':
      return obj.id ?? null;

    case 'github':
      // GitHub menaruh ID unik di header — lebih andal daripada body, karena
      // bentuk body berbeda per jenis event.
      return headers['x-github-delivery'] ?? null;

    case 'telegram':
      // Telegram tidak punya ID peristiwa. `update_id` adalah yang terdekat:
      // ia naik berurutan, jadi berguna untuk urutan — tapi BUKAN pengenal
      // unik. Dikembalikan null supaya idempotensi jatuh ke sidik jari isi.
      return null;

    case 'midtrans':
      // Midtrans bisa mengirim notifikasi yang sama beberapa kali untuk satu
      // transaksi (mis. `pending` lalu `settlement`). Yang membedakan adalah
      // kombinasi order + status + transaction_id.
      if (!obj.order_id) return null;
      return `${obj.order_id}:${obj.transaction_status ?? '?'}:${obj.transaction_id ?? '?'}`;

    default:
      return obj.id ?? null;
  }
}

/**
 * Header mana yang diteruskan ke tujuan.
 *
 * ── KENAPA TIDAK SEMUA HEADER ───────────────────────────────────────────────
 * Header permintaan memuat `authorization`, `cookie`, dan header internal
 * Cloudflare. Meneruskan semuanya ke layanan lain berarti membocorkan
 * kredensial kita ke pihak ketiga.
 *
 * ── KENAPA TETAP MENERUSKAN SEBAGIAN ────────────────────────────────────────
 * Layanan tujuan sering perlu tahu JENIS peristiwa, dan itu ada di header
 * (mis. `x-github-event`). Tanpa itu, penerima hanya dapat body tanpa konteks.
 *
 * Daftar putih, bukan daftar hitam: header baru yang muncul tidak otomatis
 * ikut terkirim.
 */
const HEADER_DITERUSKAN = [
  'content-type',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'x-gitlab-event',
  'stripe-signature',
  'x-telegram-bot-api-secret-token',
];

function pilihHeaderDiteruskan(headers) {
  const hasil = {};
  for (const [kunci, nilai] of Object.entries(headers)) {
    if (HEADER_DITERUSKAN.includes(kunci.toLowerCase())) {
      hasil[kunci.toLowerCase()] = String(nilai);
    }
  }
  return hasil;
}

/* ══ INFORMASI UNTUK INSPECTOR ═════════════════════════════════════════════ */

/**
 * Daftar sumber + status aktifnya — untuk ditampilkan di inspector.
 *
 * ── KENAPA SECRET TIDAK DIKEMBALIKAN, HANYA STATUSNYA ───────────────────────
 * Yang perlu diketahui operator adalah "sumber mana yang siap menerima".
 * Nilai secret-nya sendiri tidak berguna untuk ditampilkan, dan menampilkannya
 * berarti ia muncul di layar, di screenshot, dan di log akses.
 */
export function daftarSumber() {
  return Object.entries(SUMBER).map(([id, s]) => ({
    id,
    label: s.label,
    aktif: Boolean(s.ambilSecret()),
    header: PROVIDER[id]?.header ?? (s.parseBody ? '(di dalam body)' : '(tidak ada)'),
  }));
}
