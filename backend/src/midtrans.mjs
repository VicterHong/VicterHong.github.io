/**
 * Klien Midtrans — pembayaran langganan, modal KTP saja.
 *
 * ── KENAPA MIDTRANS ────────────────────────────────────────────────────────
 * Pilihan ini muncul dari kebutuhan nyata:
 *
 *   Xendit  → butuh badan hukum (PT/CV), tidak menerima individu
 *   Midtrans → menerima INDIVIDU dengan KTP saja
 *
 * Dan yang penting: dengan KTP saja, Midtrans sudah memberi QRIS, GoPay,
 * dan Virtual Account — tiga metode yang paling banyak dipakai pembeli
 * Indonesia. NPWP baru diperlukan kalau mau kartu kredit.
 *
 * Midtrans juga berlisensi Bank Indonesia (bagian dari GoTo Financial), jadi
 * uang pembeli terlindungi dan ada jalur sengketa resmi.
 *
 * ── KEUNGGULAN TEKNIS: TANDA TANGAN DARI ISI TRANSAKSI ─────────────────────
 * Ini yang membuat Midtrans lebih aman daripada Xendit:
 *
 *   Xendit   : token statis di header — sama di setiap request.
 *              Siapa pun yang tahu tokennya bisa memalsukan webhook.
 *
 *   Midtrans : signature = SHA512(order_id + status_code + gross_amount + ServerKey)
 *              Dihitung dari ISI transaksi, bukan token tetap.
 *
 * Efeknya: webhook palsu untuk transaksi berbeda TIDAK bisa dibuat walaupun
 * penyerang tahu satu signature yang valid. Ia harus tahu ServerKey — yang
 * tidak pernah keluar dari server.
 *
 * ── AUTENTIKASI: BASIC AUTH, SAMA SEPERTI XENDIT ───────────────────────────
 *   Authorization: Basic base64("ServerKey:")
 *                                          ↑
 *                                 titik dua di akhir WAJIB
 *
 * ServerKey jadi USERNAME, password KOSONG. Tanpa titik duanya, Midtrans
 * menjawab 401.
 *
 * Verifikasi: https://docs.midtrans.com/reference/api-authorization
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';

/** Batas waktu panggilan API. */
const TIMEOUT_MS = 15_000;

/**
 * URL API — sandbox atau production.
 *
 * ── KENAPA DIPISAH ─────────────────────────────────────────────────────────
 * Midtrans memakai domain berbeda untuk sandbox dan production. Memakai URL
 * production dengan kunci sandbox (atau sebaliknya) menghasilkan error yang
 * membingungkan — bukan pesan yang jelas seperti "kunci salah".
 *
 * Ditentukan dari awalan ServerKey: kunci sandbox Midtrans tidak punya awalan
 * khusus, jadi konfigurasi eksplisit lebih aman daripada menebak.
 */
function urlApi() {
  const dasar = config.midtransProduction
    ? 'https://app.midtrans.com'
    : 'https://app.sandbox.midtrans.com';
  return dasar;
}

/** Apakah pembayaran sudah dikonfigurasi? */
export function midtransAktif() {
  return Boolean(config.midtransServerKey);
}

/**
 * Header autentikasi Midtrans.
 *
 * Format Basic Auth: `username:password`. Midtrans memakai ServerKey sebagai
 * username dan password KOSONG — jadi stringnya harus diakhiri titik dua.
 *
 * Tanpa titik dua itu, Midtrans menolak dengan 401 tanpa penjelasan sebabnya.
 */
function headerAuth() {
  const dasar = Buffer.from(`${config.midtransServerKey}:`, 'utf8').toString('base64');
  return {
    Authorization: `Basic ${dasar}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Panggil API Midtrans.
 *
 * @param {string} metode  'POST' atau 'GET'
 * @param {string} jalur   '/snap/v1/transactions'
 * @param {object} data    Body (untuk POST)
 */
export async function panggilMidtrans(metode, jalur, data = {}) {
  if (!config.midtransServerKey) {
    throw Object.assign(new Error('Midtrans belum dikonfigurasi'), {
      kode: 'midtrans_belum_dikonfigurasi',
      statusCode: 503,
    });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${urlApi()}${jalur}`, {
      method: metode,
      headers: headerAuth(),
      body: metode === 'POST' ? JSON.stringify(data) : undefined,
      signal: ctl.signal,
    });

    const isi = await res.json().catch(() => null);

    if (!res.ok) {
      // ── BENTUK ERROR MIDTRANS ───────────────────────────────────────────
      // Midtrans mengembalikan `error_messages` sebagai ARRAY, bukan string.
      // Ini berbeda dari hampir semua API lain — dan sumber bug yang mudah
      // terjadi kalau diasumsikan string.
      const pesanArr = isi?.error_messages ?? [];
      const pesan = Array.isArray(pesanArr) ? pesanArr.join('; ') : String(pesanArr);

      throw Object.assign(new Error(pesan || `Midtrans menjawab ${res.status}`), {
        kode: isi?.status_code ?? `http_${res.status}`,
        statusCode: res.status === 401 ? 503 : 400,
        midtransStatus: res.status,
        pesanAsli: pesanArr,
      });
    }

    return isi;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw Object.assign(new Error('Midtrans tidak menjawab dalam 15 detik'), {
        kode: 'midtrans_timeout',
        statusCode: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Snap: halaman pembayaran ───────────────────────────────────────────── */

/**
 * Buat transaksi Snap — halaman pembayaran yang di-host Midtrans.
 *
 * ── KENAPA SNAP, BUKAN CORE API ────────────────────────────────────────────
 * Snap memberi satu halaman berisi SEMUA metode yang aktif: QRIS, GoPay,
 * VA semua bank, dan (kalau NPWP ada) kartu. Pembeli memilih sendiri.
 *
 * Core API butuh UI sendiri per metode — jauh lebih banyak kerja, dan
 * hasilnya tidak lebih baik untuk kasus ini.
 *
 * ── `order_id` ADALAH KUNCI IDEMPOTENSI ────────────────────────────────────
 * Kalau `order_id` yang sama dikirim dua kali, Midtrans menolak dengan
 * "order_id has been paid" atau mengembalikan yang lama — bukan membuat
 * transaksi baru.
 *
 * Jadi `order_id` = ID pembayaran internal kita (`pay_xxx`).
 *
 * ── `gross_amount` SEBAGAI STRING ──────────────────────────────────────────
 * Midtrans menerima angka, tapi mengembalikannya sebagai STRING di webhook.
 * Mengirim sebagai string sejak awal menghindari perbedaan format yang bisa
 * membuat perbandingan jumlah gagal.
 *
 * IDR tidak punya sen: Rp 200.000 dikirim sebagai "200000.00" atau "200000".
 * Format "200000.00" lebih aman karena itulah yang dikembalikan Midtrans.
 */
export async function buatTransaksiSnap({
  orderId,
  jumlah,
  deskripsi,
  emailPelanggan = '',
  namaPelanggan = '',
  suksesUrl,
  metadata = {},
}) {
  // ── FORMAT JUMLAH: "200000.00" ───────────────────────────────────────────
  // Midtrans mengembalikan gross_amount sebagai string dengan dua desimal.
  // Mengirim format yang sama membuat perbandingan di webhook langsung cocok.
  const jumlahStr = `${jumlah}.00`;

  const data = {
    transaction_details: {
      order_id: orderId,
      gross_amount: Number(jumlah),
    },

    item_details: [{
      id: metadata.tier ?? 'langganan',
      price: Number(jumlah),
      quantity: 1,
      name: deskripsi.slice(0, 50),
    }],

    // Metadata dikembalikan utuh di webhook — inilah yang memberitahu sistem
    // paket mana yang dibeli.
    custom_field1: metadata.pembayaran_id ?? orderId,
    custom_field2: `${metadata.tier ?? ''}|${metadata.periode ?? ''}`,

    callbacks: {
      finish: suksesUrl ?? config.checkoutSuksesUrl,
    },

    // ── KENAPA `expiry` DIISI ───────────────────────────────────────────────
    // Default Midtrans adalah 24 jam, tapi mengisinya eksplisit membuat
    // perilakunya tidak bergantung pada pengaturan dashboard — yang bisa
    // diubah orang lain tanpa sepengetahuan kita.
    expiry: { unit: 'hours', duration: 24 },
  };

  if (emailPelanggan) {
    data.customer_details = {
      email: emailPelanggan,
      ...(namaPelanggan ? { first_name: namaPelanggan.slice(0, 50) } : {}),
    };
  }

  return panggilMidtrans('POST', '/snap/v1/transactions', data);
}

/** Ambil status transaksi — untuk cek tanpa menunggu webhook. */
export async function ambilStatusTransaksi(orderId) {
  return panggilMidtrans('GET', `/v2/${encodeURIComponent(orderId)}/status`);
}

/** Batalkan transaksi supaya tidak bisa dibayar lagi. */
export async function batalkanTransaksi(orderId) {
  return panggilMidtrans('POST', `/${encodeURIComponent(orderId)}/cancel`);
}

/* ── Webhook ────────────────────────────────────────────────────────────── */

/**
 * Verifikasi tanda tangan webhook Midtrans.
 *
 * ── RUMUSNYA: sha512(order_id + status_code + gross_amount + ServerKey) ────
 * Ini yang membuat Midtrans lebih aman daripada penyedia dengan token statis:
 * tanda tangannya terikat pada ISI transaksi, bukan pada token tetap.
 *
 * Artinya webhook palsu untuk transaksi BERBEDA tidak bisa dibuat walaupun
 * penyerang tahu satu signature valid. Ia harus tahu ServerKey — yang tidak
 * pernah keluar dari server.
 *
 * ── KENAPA URUTANNYA PENTING ───────────────────────────────────────────────
 * Urutan penggabungan string harus PERSIS: order_id dulu, lalu status_code,
 * lalu gross_amount, baru ServerKey. Mengubah urutannya menghasilkan hash
 * yang berbeda dan verifikasi selalu gagal.
 *
 * ── `gross_amount` HARUS STRING PERSIS ─────────────────────────────────────
 * Midtrans mengirim "200000.00" — bukan 200000. Mengubahnya jadi angka lalu
 * kembali ke string akan menghasilkan "200000" (tanpa .00) dan hash-nya
 * berbeda. Jadi nilainya dipakai APA ADANYA dari payload.
 */
export function verifikasiTandaTanganMidtrans(payload) {
  if (!config.midtransServerKey) {
    return { ok: false, alasan: 'server_key_kosong' };
  }

  const { order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signature } = payload ?? {};

  if (!orderId || !statusCode || !grossAmount || !signature) {
    return { ok: false, alasan: 'field_tidak_lengkap' };
  }

  const diharapkan = createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${config.midtransServerKey}`, 'utf8')
    .digest('hex');

  const bufferHarapan = Buffer.from(diharapkan, 'utf8');
  const bufferDiterima = Buffer.from(String(signature), 'utf8');

  // Panjang harus sama sebelum timingSafeEqual — ia melempar kalau beda
  if (bufferHarapan.length !== bufferDiterima.length) {
    return { ok: false, alasan: 'tanda_tangan_tidak_cocok' };
  }

  if (timingSafeEqual(bufferHarapan, bufferDiterima)) {
    return { ok: true };
  }

  return { ok: false, alasan: 'tanda_tangan_tidak_cocok' };
}

/* ── Terjemahan status & error ──────────────────────────────────────────── */

/**
 * Status transaksi Midtrans → status internal kita.
 *
 * ── NILAI STATUS MIDTRANS ──────────────────────────────────────────────────
 *   capture    — kartu berhasil, tapi BELUM tentu dana masuk (fraud check)
 *   settlement — dana sudah masuk. Ini yang final.
 *   pending    — menunggu pembayaran (QRIS belum discan, VA belum dibayar)
 *   deny       — ditolak (fraud)
 *   cancel     — dibatalkan
 *   expire     — kedaluwarsa
 *   refund     — dikembalikan
 *
 * ── KENAPA `capture` DIPERLAKUKAN HATI-HATI ────────────────────────────────
 * Untuk kartu kredit, `capture` berarti otorisasi berhasil tapi dana belum
 * tentu cair — bisa menyusul `settlement` beberapa jam kemudian, atau
 * `deny` kalau terdeteksi fraud.
 *
 * Memberi token saat `capture` berisiko: kalau nanti di-deny, pembeli sudah
 * dapat akses padahal tidak membayar.
 *
 * Karena itu `capture` diperlakukan sebagai PENDING kecuali `fraud_status`
 * sudah `accept`.
 */
export function statusInternalMidtrans(transactionStatus, fraudStatus = null) {
  const status = String(transactionStatus ?? '').toLowerCase();

  switch (status) {
    case 'settlement':
      return 'dibayar';

    case 'capture':
      // Kartu: hanya dianggap lunas kalau fraud check sudah lolos
      return String(fraudStatus ?? '').toLowerCase() === 'accept' ? 'dibayar' : 'pending';

    case 'pending':
      return 'pending';

    case 'deny':
    case 'cancel':
      return 'gagal';

    case 'expire':
      return 'kedaluwarsa';

    case 'refund':
    case 'partial_refund':
      return 'dikembalikan';

    default:
      return 'pending';
  }
}

/**
 * Terjemahkan error Midtrans jadi pesan Indonesia yang bisa ditindaklanjuti.
 *
 * Sama seperti versi penyedia sebelumnya: pembeli butuh tahu APA YANG HARUS
 * DILAKUKAN, bukan kode error teknis.
 */
export function pesanGalatMidtrans(err) {
  const pesanAsli = Array.isArray(err?.pesanAsli) ? err.pesanAsli.join(' ') : '';
  const gabung = `${err?.message ?? ''} ${pesanAsli}`.toLowerCase();

  // ── COCOKKAN DARI ISI PESAN, BUKAN KODE ─────────────────────────────────
  // Midtrans memakai status_code HTTP sebagai "kode error", bukan kode
  // semantik seperti penyedia lain. Jadi pencocokan harus dari pesannya.
  if (gabung.includes('order_id has been paid') || gabung.includes('sudah dibayar')) {
    return {
      pesan: 'Pembayaran untuk pesanan ini sudah selesai.',
      saran: 'Tidak perlu membayar lagi. Kalau token akses belum diterima, hubungi saya lewat halaman kontak.',
    };
  }

  if (gabung.includes('unauthorized') || gabung.includes('server key')) {
    return {
      pesan: 'Pembayaran sedang tidak bisa diproses.',
      saran: 'Ini masalah di sisi kami, bukan Anda. Coba lagi sebentar lagi, atau hubungi saya lewat halaman kontak.',
    };
  }

  if (gabung.includes('transaction_details') || gabung.includes('gross_amount')) {
    return {
      pesan: 'Data pembayaran tidak lengkap.',
      saran: 'Muat ulang halaman lalu coba lagi. Kalau tetap gagal, hubungi saya.',
    };
  }

  if (gabung.includes('timeout') || err?.kode === 'midtrans_timeout') {
    return {
      pesan: 'Layanan pembayaran tidak menjawab.',
      saran: 'Periksa koneksi Anda lalu coba lagi. Pembayaran tidak akan dobel — sistem kami mencegahnya.',
    };
  }

  return {
    pesan: 'Pembayaran tidak bisa diproses.',
    saran: 'Coba lagi sebentar lagi. Kalau tetap gagal, hubungi saya lewat halaman kontak — saya bantu prosesnya.',
  };
}
