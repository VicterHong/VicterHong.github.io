/**
 * VERIFIKASI TANDA TANGAN WEBHOOK — HMAC-SHA256 dan varian provider.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA MODUL INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * Endpoint webhook adalah pintu masuk yang TERBUKA: siapa pun yang tahu URL-nya
 * bisa mengirim POST ke sana. Yang membedakan permintaan sah dari yang palsu
 * hanya SATU hal — tanda tangan kriptografi.
 *
 * Kalau verifikasinya salah, akibatnya bukan "data kotor", tapi:
 *   · Pesanan palsu yang mengaktifkan langganan tanpa pembayaran
 *   · Pengiriman uang ke rekening penyerang
 *   · Riwayat pembayaran yang tidak bisa dipercaya saat sengketa
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TIGA JENIS SERANGAN YANG DITUTUP MODUL INI
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. TANDA TANGAN PALSU
 *    Penyerang mengirim payload tanpa tahu secret. Ditolak karena HMAC tidak
 *    cocok.
 *
 * 2. TIMING ATTACK
 *    Perbandingan `===` pada string berhenti di karakter pertama yang berbeda.
 *    Waktu eksekusinya membocorkan berapa banyak karakter awal yang sudah benar
 *    — dan dengan cukup banyak percobaan, seluruh tanda tangan bisa direka.
 *
 *    Modul ini memakai `timingSafeEqual`, yang membandingkan dalam waktu tetap
 *    tanpa memandang isinya.
 *
 * 3. REPLAY ATTACK
 *    Payload sah yang dikirim ULANG oleh penyerang. Tanda tangannya benar, jadi
 *    verifikasi tanda tangan saja tidak menangkapnya.
 *
 *    Modul ini menyediakan pemeriksaan TIMESTAMP: permintaan yang lebih tua dari
 *    jendela toleransi ditolak. Untuk webhook yang menyertakan ID peristiwa,
 *    pemanggil juga bisa mencatat ID-nya untuk menolak duplikat.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TANDA TANGAN DIHITUNG DARI BODY MENTAH, BUKAN JSON
 * ══════════════════════════════════════════════════════════════════════════════
 * Ini kesalahan yang paling sering terjadi, dan akibatnya adalah webhook yang
 * SELALU gagal — atau lebih buruk, verifikasi yang dilewati.
 *
 *   Kiriman provider : {"id":"123","jumlah":5000}   ← urutan & spasi persis ini
 *   JSON.parse lalu JSON.stringify di server:
 *                      {"id":"123","jumlah":5000}   ← bisa sama, bisa tidak
 *
 * JSON tidak menjamin urutan kunci atau spasi. Kalau ada satu spasi berbeda,
 * HMAC-nya berbeda, dan webhook yang SAH ditolak.
 *
 * Jadi: hitung HMAC dari BYTE MENTAH body, sebelum di-parse. Modul ini menerima
 * Buffer/string mentah, bukan objek.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jendela toleransi timestamp, dalam detik.
 *
 * ── KENAPA 5 MENIT ────────────────────────────────────────────────────────────
 * Terlalu ketat: webhook yang tertunda karena jaringan lambat akan ditolak, dan
 * pengguna melihat pembayarannya tidak masuk.
 *
 * Terlalu longgar: penyerang punya lebih banyak waktu memakai payload yang
 * tertangkap.
 *
 * 5 menit adalah angka yang dipakai Stripe (default-nya 300 detik) dan cukup
 * longgar untuk retry provider yang lambat.
 */
export const TOLERANSI_DETIK = 300;

/* ── Perbandingan waktu tetap ───────────────────────────────────────────── */

/**
 * Bandingkan dua string dalam WAKTU TETAP.
 *
 * ── KENAPA TIDAK BOLEH `===` ──────────────────────────────────────────────────
 * `"abc" === "abd"` berhenti membandingkan di karakter ketiga. `"abc" === "abc"`
 * membandingkan sampai habis. Selisih waktunya sangat kecil, tapi terukur — dan
 * dengan ribuan percobaan, penyerang bisa menebak tanda tangan karakter demi
 * karakter.
 *
 * ── KENAPA PANJANG DIPERIKSA DULU ────────────────────────────────────────────
 * `timingSafeEqual` MELEMPAR kalau panjang buffer berbeda. Jadi panjangnya harus
 * diperiksa lebih dulu.
 *
 * Membocorkan PANJANG tidak berbahaya: panjang HMAC-SHA256 selalu sama (64
 * karakter hex), dan penyerang sudah tahu itu.
 */
export function bandingAman(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');

  // Panjang berbeda → pasti tidak sama. Diperiksa dulu karena timingSafeEqual
  // melempar, bukan mengembalikan false.
  if (bufA.length !== bufB.length) return false;

  // Panjang 0 untuk keduanya: secara teknis "sama", tapi tanda tangan kosong
  // tidak pernah sah. Mengembalikan true di sini akan membuka pintu.
  if (bufA.length === 0) return false;

  return timingSafeEqual(bufA, bufB);
}

/* ── HMAC umum ──────────────────────────────────────────────────────────── */

/**
 * Hitung HMAC-SHA256 dari body mentah.
 *
 * @param {Buffer|string} bodyMentah  byte body, SEBELUM di-JSON.parse
 * @param {string} secret
 * @param {string} encoding           'hex' (default) atau 'base64'
 */
export function hitungHmac(bodyMentah, secret, encoding = 'hex') {
  return createHmac('sha256', String(secret ?? ''))
    .update(bodyMentah)
    .digest(encoding);
}

/* ── Verifikator per provider ───────────────────────────────────────────── */

/**
 * Stripe: header `stripe-signature` berisi `t=<timestamp>,v1=<hmac>`.
 *
 * ── YANG DITANDATANGANI: `<timestamp>.<body>` ────────────────────────────────
 * Bukan body saja. Timestamp-nya ikut ditandatangani, dan itu yang membuat
 * replay bisa dideteksi: penyerang tidak bisa memakai ulang tanda tangan lama
 * dengan timestamp baru, karena timestamp-nya sendiri bagian dari yang
 * ditandatangani.
 *
 * ── KENAPA v1 SAJA ───────────────────────────────────────────────────────────
 * Stripe mengirim beberapa skema (`v1` = HMAC-SHA256, `v0` = skema lama). Yang
 * dipakai sekarang v1. Menerima v0 berarti menerima skema yang sudah usang dan
 * lebih lemah.
 */
export function verifikasiStripe({ bodyMentah, header, secret, toleransiDetik = TOLERANSI_DETIK, sekarang = Date.now() }) {
  if (!secret) return { ok: false, alasan: 'secret_kosong' };
  if (!header) return { ok: false, alasan: 'header_kosong' };

  // Parse "t=123,v1=abc,v1=def" — v1 bisa lebih dari satu saat rotasi secret
  const bagian = String(header).split(',').map((x) => x.trim());
  let timestamp = null;
  const tandaTangan = [];

  for (const b of bagian) {
    const [k, v] = b.split('=');
    if (k === 't') timestamp = v;
    else if (k === 'v1' && v) tandaTangan.push(v);
  }

  if (!timestamp) return { ok: false, alasan: 'timestamp_hilang' };
  if (!tandaTangan.length) return { ok: false, alasan: 'tanda_tangan_hilang' };

  // ── TIMESTAMP: DIPERIKSA SEBELUM HMAC ──────────────────────────────────────
  // Dua alasan:
  //   1. Lebih murah — tidak perlu hitung HMAC untuk permintaan yang sudah jelas
  //      kedaluwarsa
  //   2. Kalau timestamp-nya tidak masuk akal (bukan angka, atau jauh di masa
  //      depan), tidak ada gunanya melanjutkan
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, alasan: 'timestamp_tidak_valid' };

  const selisihDetik = Math.abs(Math.floor(sekarang / 1000) - ts);
  if (selisihDetik > toleransiDetik) {
    return { ok: false, alasan: 'timestamp_kedaluwarsa', selisihDetik, toleransiDetik };
  }

  const diharapkan = hitungHmac(`${timestamp}.${bodyMentah}`, secret);

  // Beberapa v1 bisa dikirim saat rotasi secret — cocok dengan SALAH SATU
  // dianggap sah.
  const cocok = tandaTangan.some((t) => bandingAman(diharapkan, t));
  return cocok ? { ok: true } : { ok: false, alasan: 'tanda_tangan_tidak_cocok' };
}

/**
 * GitHub: header `x-hub-signature-256` berisi `sha256=<hex>`.
 *
 * ── KENAPA HANYA sha256, TIDAK sha1 ──────────────────────────────────────────
 * GitHub mengirim dua header: `x-hub-signature` (SHA-1, lama) dan
 * `x-hub-signature-256` (SHA-256, sekarang). SHA-1 sudah tidak aman untuk
 * tanda tangan — tabrakan bisa dibuat dengan biaya yang terjangkau.
 *
 * Modul ini HANYA menerima yang SHA-256. Menerima SHA-1 "untuk kompatibilitas"
 * berarti penyerang bisa memakai yang terlemah dari dua skema.
 */
export function verifikasiGitHub({ bodyMentah, header, secret }) {
  if (!secret) return { ok: false, alasan: 'secret_kosong' };
  if (!header) return { ok: false, alasan: 'header_kosong' };

  const s = String(header);
  if (!s.startsWith('sha256=')) {
    return { ok: false, alasan: 'skema_tidak_didukung' };
  }

  const diterima = s.slice('sha256='.length);
  const diharapkan = hitungHmac(bodyMentah, secret);

  return bandingAman(diharapkan, diterima)
    ? { ok: true }
    : { ok: false, alasan: 'tanda_tangan_tidak_cocok' };
}

/**
 * Telegram: header `x-telegram-bot-api-secret-token` berisi SECRET LANGSUNG —
 * bukan HMAC.
 *
 * ── KENAPA TIDAK ADA TIMESTAMP ───────────────────────────────────────────────
 * Telegram tidak mengirim timestamp, jadi replay tidak bisa dideteksi dari
 * tanda tangannya. Yang bisa dilakukan: pemanggil mencatat `update_id` dan
 * menolak yang sudah pernah diproses.
 *
 * ── KENAPA INI TETAP AMAN ────────────────────────────────────────────────────
 * Secret-nya dikirim apa adanya, jadi keamanannya bergantung pada HTTPS dan
 * kerahasiaan secret. Itu memang cara Telegram bekerja — dan karena secret-nya
 * panjang dan acak, menebaknya tidak mungkin.
 *
 * `bandingAman` tetap dipakai: perbandingan `===` pada secret bisa dibocorkan
 * lewat waktu, sama seperti HMAC.
 */
export function verifikasiTelegram({ header, secret }) {
  if (!secret) return { ok: false, alasan: 'secret_kosong' };
  if (!header) return { ok: false, alasan: 'header_kosong' };

  return bandingAman(secret, header)
    ? { ok: true }
    : { ok: false, alasan: 'secret_tidak_cocok' };
}

/**
 * Verifikator generik: HMAC-SHA256 dari body mentah, dikirim di satu header.
 *
 * ── KENAPA PERLU, PADAHAL SUDAH ADA STRIPE DAN GITHUB ────────────────────────
 * Keduanya punya bentuk header yang berbeda. Untuk provider yang tidak punya
 * verifikator khusus, bentuk paling umum adalah: HMAC dari body, dikirim
 * sebagai hex di satu header.
 *
 * ── KENAPA TIDAK MENYERTAKAN TIMESTAMP ───────────────────────────────────────
 * Karena providernya tidak mengirimkannya. Kalau ada, pakai verifikator khusus
 * yang memeriksanya — timestamp adalah satu-satunya pertahanan terhadap replay.
 */
export function verifikasiHmacSederhana({ bodyMentah, header, secret, encoding = 'hex', prefiks = '' }) {
  if (!secret) return { ok: false, alasan: 'secret_kosong' };
  if (!header) return { ok: false, alasan: 'header_kosong' };

  let diterima = String(header);
  if (prefiks && diterima.startsWith(prefiks)) diterima = diterima.slice(prefiks.length);

  const diharapkan = hitungHmac(bodyMentah, secret, encoding);

  return bandingAman(diharapkan, diterima)
    ? { ok: true }
    : { ok: false, alasan: 'tanda_tangan_tidak_cocok' };
}

/* ── Pemilih verifikator ────────────────────────────────────────────────── */

/**
 * Daftar provider yang dikenal, dengan header yang dipakai masing-masing.
 *
 * ── KENAPA DIPISAH DARI FUNGSINYA ────────────────────────────────────────────
 * Daftar ini dipakai dua tempat: untuk memilih verifikator, dan untuk
 * MENAMPILKAN pilihan di UI inspector. Kalau ditulis dua kali, keduanya bisa
 * berbeda — dan provider yang ada di UI tapi tidak ada di sini akan gagal
 * dengan pesan yang membingungkan.
 */
export const PROVIDER = {
  stripe: {
    label: 'Stripe',
    header: 'stripe-signature',
    punyaTimestamp: true,
  },
  github: {
    label: 'GitHub',
    header: 'x-hub-signature-256',
    punyaTimestamp: false,
  },
  telegram: {
    label: 'Telegram',
    header: 'x-telegram-bot-api-secret-token',
    punyaTimestamp: false,
  },
  hmac: {
    label: 'HMAC sederhana',
    header: 'x-signature',
    punyaTimestamp: false,
  },
};

/**
 * Verifikasi tanda tangan dari provider mana pun.
 *
 * @param {object} p
 * @param {string} p.provider        'stripe' | 'github' | 'telegram' | 'hmac'
 * @param {Buffer|string} p.bodyMentah
 * @param {object} p.headers         header permintaan (huruf besar-kecil bebas)
 * @param {string} p.secret
 * @param {number} [p.toleransiDetik]
 * @param {number} [p.sekarang]
 */
export function verifikasiTandaTangan({ provider, bodyMentah, headers = {}, secret, toleransiDetik, sekarang }) {
  const p = PROVIDER[provider];
  if (!p) return { ok: false, alasan: 'provider_tidak_dikenal' };

  // ── HEADER DICARI TANPA MEMANDANG HURUF BESAR-KECIL ────────────────────────
  // Node menurunkan semua nama header jadi huruf kecil, tapi pemanggil bisa
  // mengirim objek buatan (dari tes, atau dari penyimpanan riwayat) dengan
  // huruf apa pun. Mencari persis akan gagal untuk kasus itu.
  const kunci = Object.keys(headers).find((k) => k.toLowerCase() === p.header.toLowerCase());
  const nilaiHeader = kunci ? headers[kunci] : undefined;

  if (provider === 'stripe') {
    return verifikasiStripe({ bodyMentah, header: nilaiHeader, secret, toleransiDetik, sekarang });
  }
  if (provider === 'github') {
    return verifikasiGitHub({ bodyMentah, header: nilaiHeader, secret });
  }
  if (provider === 'telegram') {
    return verifikasiTelegram({ header: nilaiHeader, secret });
  }
  return verifikasiHmacSederhana({ bodyMentah, header: nilaiHeader, secret });
}

/**
 * Pesan alasan yang bisa ditampilkan ke pengguna.
 *
 * ── KENAPA PESANNYA BERPEMBEDA ───────────────────────────────────────────────
 * "Tanda tangan tidak cocok" untuk semua kegagalan membuat penyebabnya tidak
 * bisa didiagnosis — dan yang paling sering terjadi bukan serangan, tapi
 * KONFIGURASI YANG SALAH (secret keliru, header tidak diteruskan proxy,
 * timestamp mesin yang tidak sinkron).
 *
 * Membedakan alasannya membuat penyebab yang wajar bisa dikenali. Yang TIDAK
 * dibedakan: detail perbandingan tanda tangan — itu tidak boleh dibocorkan.
 */
export function pesanAlasan(alasan) {
  const pesan = {
    secret_kosong: 'Secret webhook belum dikonfigurasi di server.',
    header_kosong: 'Header tanda tangan tidak ada di permintaan.',
    header_tidak_ditemukan: 'Header tanda tangan tidak diteruskan. Periksa konfigurasi proxy.',
    timestamp_hilang: 'Timestamp tidak ada di header tanda tangan.',
    timestamp_tidak_valid: 'Timestamp di header bukan angka yang sah.',
    timestamp_kedaluwarsa: 'Permintaan terlalu lama. Periksa apakah jam server Anda sinkron.',
    tanda_tangan_hilang: 'Tanda tangan tidak ada di header.',
    tanda_tangan_tidak_cocok: 'Tanda tangan tidak cocok. Secret kemungkinan salah.',
    skema_tidak_didukung: 'Skema tanda tangan tidak didukung. Server hanya menerima SHA-256.',
    secret_tidak_cocok: 'Secret token tidak cocok.',
    provider_tidak_dikenal: 'Provider webhook tidak dikenal.',
  };
  return pesan[alasan] ?? 'Verifikasi tanda tangan gagal.';
}
