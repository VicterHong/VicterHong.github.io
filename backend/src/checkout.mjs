/**
 * Pembayaran — logika bisnis langganan lewat Midtrans.
 *
 * ── PEMBAGIAN TANGGUNG JAWAB ───────────────────────────────────────────────
 *   midtrans.mjs — bicara ke API Midtrans (HTTP, tanda tangan, terjemahan error)
 *   checkout.mjs — logika bisnis (harga mana, token apa, siapa dapat apa)
 *
 * Pemisahan ini penting: `midtrans.mjs` tidak tahu apa itu "paket
 * Profesional", dan `checkout.mjs` tidak tahu bagaimana cara memanggil API
 * Midtrans. Modul ini sudah dua kali berganti penyedia (Stripe → Xendit →
 * Midtrans) dan hanya lapisan penyedianya yang berubah — logika di sini
 * tetap sama.
 *
 * ── SATU SUMBER HARGA ──────────────────────────────────────────────────────
 * Angka yang ditagih TIDAK dihitung di sini. Ia datang dari `pricing.mjs` —
 * satu sumber yang sama dengan yang ditampilkan di halaman harga.
 *
 * Yang dikirim ke Midtrans adalah angka itu, dan Midtrans mengembalikannya
 * di webhook. Kalau berbeda, ada yang tidak sinkron dan token TIDAK
 * diterbitkan — bukan diabaikan.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { config } from './config.mjs';
import { getDb, transaction } from './db.mjs';
import { PAKET } from './pricing.mjs';
import {
  midtransAktif, buatTransaksiSnap, ambilStatusTransaksi,
  verifikasiTandaTanganMidtrans, statusInternalMidtrans, pesanGalatMidtrans,
} from './midtrans.mjs';
import { issueToken } from './tokens.mjs';

const MS_SEHARI = 86_400_000;

/* ── Status pembayaran ──────────────────────────────────────────────────── */

export const STATUS = {
  PENDING: 'pending',
  DIBAYAR: 'dibayar',
  GAGAL: 'gagal',
  KEDALUWARSA: 'kedaluwarsa',
  DIKEMBALIKAN: 'dikembalikan',
};

/** Paket mana yang bisa dibeli (yang punya harga). */
export function paketBisaDibeli() {
  return PAKET.filter((p) => p.hargaNormal != null);
}

/**
 * Cari paket + hitung harga untuk kombinasi tier & periode.
 *
 * Mengembalikan `null` kalau kombinasinya tidak ada — pemanggil yang
 * memutuskan apa yang ditampilkan.
 */
export function cariHarga(tier, periode) {
  const paket = PAKET.find((p) => p.id === tier);
  if (!paket || paket.hargaNormal == null) return null;

  const tahunan = periode === 'tahunan';
  const diskonPersen = tahunan ? paket.diskon?.tahunan : paket.diskon?.bulanan;
  if (!diskonPersen) return null;

  // Harga per bulan setelah diskon
  const perBulan = Math.round(paket.hargaNormal * (100 - diskonPersen) / 100);

  // ── YANG DITAGIH: total periode, bukan harga per bulan ───────────────────
  // Untuk tahunan, Midtrans menagih SEKALI untuk 12 bulan. Kalau yang dikirim
  // `perBulan`, pembeli ditagih 1/12 dari yang seharusnya — dan itu kerugian
  // nyata yang tidak bisa ditarik kembali.
  const total = tahunan ? perBulan * 12 : perBulan;

  return {
    tier: paket.id,
    namaPaket: paket.nama,
    periode: tahunan ? 'tahunan' : 'bulanan',
    diskonPersen,
    perBulan,
    total,
    satuan: 'IDR',
  };
}

/** Kunci peta harga untuk kombinasi tier + periode. */
function kunciHarga(tier, periode) {
  return `${tier}_${periode}`;
}

/* ── Buat pembayaran ────────────────────────────────────────────────────── */

/**
 * Mulai pembayaran baru.
 *
 * ── KENAPA IDEMPOTENCY KEY DARI KLIEN ──────────────────────────────────────
 * Kuncinya datang dari browser, bukan dibuat di sini. Alasannya: yang tahu
 * "ini percobaan ulang dari klik yang sama" adalah browser — bukan server.
 *
 * Kalau server yang membuat, setiap percobaan ulang dapat kunci baru, dan
 * justru itulah yang menyebabkan dobel tagih. Klien membuat kunci sekali
 * saat tombol diklik, lalu mengirim kunci yang sama untuk setiap percobaan
 * ulang.
 */
export async function mulaiPembayaran({ tier, periode, email, nama = '', idempotencyKey }) {
  if (!midtransAktif()) {
    throw Object.assign(new Error('Pembayaran belum aktif'), {
      kode: 'pembayaran_nonaktif', statusCode: 503,
    });
  }

  if (!idempotencyKey || String(idempotencyKey).length < 16) {
    throw Object.assign(new Error('Kunci idempotensi wajib diisi (minimal 16 karakter)'), {
      kode: 'idempotency_wajib', statusCode: 400,
    });
  }

  const emailBersih = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailBersih)) {
    throw Object.assign(new Error('Alamat email tidak valid'), {
      kode: 'email_tidak_valid', statusCode: 400,
    });
  }

  const harga = cariHarga(tier, periode);
  if (!harga) {
    throw Object.assign(new Error(`Paket "${tier}" periode "${periode}" tidak tersedia`), {
      kode: 'paket_tidak_ada', statusCode: 400,
    });
  }

    const db = getDb();

  // ── Sudah pernah dicoba dengan kunci ini? ────────────────────────────────
  // Kembalikan yang lama — jangan buat sesi kedua.
  const lama = db.prepare(
    'SELECT * FROM payments WHERE idempotency_key = ?',
  ).get(idempotencyKey);

  if (lama) {
    // Kalau sudah dibayar, tidak ada yang perlu dilakukan
    if (lama.status === STATUS.DIBAYAR) {
      return {
        sudahDibayar: true,
        pembayaranId: lama.id,
        tier: lama.tier,
        periode: lama.periode,
      };
    }

    // Masih pending & transaksi masih ada → kembalikan URL yang sama
    if (lama.status === STATUS.PENDING && lama.midtrans_order_id) {
      try {
        const trx = await ambilStatusTransaksi(lama.midtrans_order_id);
        const st = String(trx?.transaction_status ?? '').toLowerCase();

        // Midtrans: `pending` berarti masih bisa dibayar. `capture` dengan
        // fraud accept juga belum tentu ada URL — jadi hanya `pending` yang
        // dikembalikan URL-nya.
        if (st === 'pending' && trx?.redirect_url) {
          return {
            pembayaranId: lama.id,
            url: trx.redirect_url,
            sesiId: trx.transaction_id ?? lama.midtrans_order_id,
            tier: lama.tier,
            periode: lama.periode,
            jumlah: lama.jumlah,
            dilanjutkan: true,
          };
        }
      } catch {
        // Transaksi tidak bisa diambil — lanjut buat yang baru di bawah
      }
    }
  }

  const id = `pay_${randomBytes(12).toString('hex')}`;
  const sekarang = Date.now();

  // ── Catat SEBELUM memanggil Midtrans ─────────────────────────────────────
  // Kalau urutannya dibalik (panggil Midtrans dulu, catat kemudian) dan
  // pencatatan gagal, akan ada transaksi yang tidak diketahui sistem —
  // dan pembayaran bisa masuk tanpa jejak.
  transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, idempotency_key, tier, periode, jumlah,
                            email, nama, status, dibuat_pada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, idempotencyKey, harga.tier, harga.periode, harga.total,
           emailBersih, String(nama).slice(0, 120), STATUS.PENDING, sekarang);
  });

  try {
    // ── `orderId` = ID PEMBAYARAN KITA ─────────────────────────────────────
    // Ini kunci idempotensi Midtrans. Kalau `order_id` yang sama dikirim dua
    // kali, Midtrans menolak dengan "order_id has been paid" atau
    // mengembalikan yang lama — bukan membuat transaksi baru.
    const trx = await buatTransaksiSnap({
      orderId: id,
      jumlah: harga.total,
      deskripsi: `Langganan ${harga.namaPaket} — ${harga.periode}`,
      emailPelanggan: emailBersih,
      namaPelanggan: String(nama).slice(0, 120),
      metadata: {
        pembayaran_id: id,
        tier: harga.tier,
        periode: harga.periode,
      },
    });

    // Masa berlaku: 24 jam (sama dengan yang diminta di `expiry`)
    const kedaluwarsa = sekarang + MS_SEHARI;

    db.prepare(
      'UPDATE payments SET midtrans_order_id = ?, kedaluwarsa_pada = ? WHERE id = ?',
    ).run(id, kedaluwarsa, id);

    return {
      pembayaranId: id,
      url: trx.redirect_url,
      sesiId: trx.token ?? id,
      tier: harga.tier,
      periode: harga.periode,
      jumlah: harga.total,
    };
  } catch (err) {
    // Tandai gagal — jangan biarkan baris "pending" yang tidak pernah selesai
    db.prepare(
      'UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ?',
    ).run(STATUS.GAGAL, String(err?.kode ?? err?.message ?? 'tidak_diketahui').slice(0, 200), id);

    const terjemahan = pesanGalatMidtrans(err);
    throw Object.assign(new Error(terjemahan.pesan), {
      kode: err?.kode ?? 'midtrans_error',
      saran: terjemahan.saran,
      statusCode: err?.statusCode ?? 400,
    });
  }
}

/* ── Webhook ────────────────────────────────────────────────────────────── */

/**
 * Proses webhook dari Midtrans.
 *
 * ── URUTAN YANG TIDAK BOLEH DIBALIK ────────────────────────────────────────
 *   1. Verifikasi tanda tangan  — SEBELUM apa pun
 *   2. Catat event (idempoten)  — supaya kiriman ulang tidak diproses dua kali
 *   3. Baru proses
 *
 * Kalau langkah 3 dijalankan sebelum 1, siapa pun bisa menerbitkan token
 * gratis dengan mengirim JSON palsu.
 *
 * ── TANDA TANGAN MIDTRANS TERIKAT PADA ISI TRANSAKSI ───────────────────────
 * sha512(order_id + status_code + gross_amount + ServerKey)
 *
 * Ini lebih kuat daripada token statis: webhook palsu untuk transaksi BERBEDA
 * tidak bisa dibuat walaupun penyerang tahu satu signature yang valid. Ia
 * harus tahu ServerKey — yang tidak pernah keluar dari server.
 *
 * ── BENTUK WEBHOOK MIDTRANS ────────────────────────────────────────────────
 * Midtrans mengirim objek transaksi langsung sebagai teratas (bukan dibungkus
 * `{id, type, data}` seperti Stripe):
 *
 *   { "order_id": "pay_xxx", "transaction_status": "settlement",
 *     "status_code": "200", "gross_amount": "200000.00",
 *     "fraud_status": "accept", "signature_key": "..." }
 *
 * Yang menentukan adalah `transaction_status`, bukan `event.type`.
 */
export async function prosesWebhook(bodyMentah) {
  let payload;
  try {
    payload = JSON.parse(bodyMentah);
  } catch {
    return { ok: false, statusCode: 400, alasan: 'body_bukan_json', pesan: 'Body bukan JSON' };
  }

  const verifikasi = verifikasiTandaTanganMidtrans(payload);
  if (!verifikasi.ok) {
    return {
      ok: false,
      statusCode: 401,
      alasan: verifikasi.alasan,
      pesan: 'Tanda tangan webhook tidak valid',
    };
  }

  const orderId = payload.order_id;
  const statusTrx = String(payload.transaction_status ?? '').toLowerCase();

  if (!orderId || !statusTrx) {
    return {
      ok: false, statusCode: 400, alasan: 'transaksi_tidak_lengkap',
      pesan: 'Webhook tidak berisi order_id dan transaction_status',
    };
  }

  const db = getDb();
  const sekarang = Date.now();

  // ── Idempotensi ──────────────────────────────────────────────────────────
  // Kunci uniknya gabungan `order_id` + status: Midtrans mengirim webhook
  // BERKALI untuk satu transaksi (pending → settlement), dan masing-masing
  // membawa informasi berbeda. Mengunci hanya pada order_id akan menolak
  // update status yang sah.
  //
  // `transaction_id` ditambahkan karena satu order bisa punya beberapa
  // percobaan transaksi — dan kita ingin masing-masing tercatat.
  const kunciEvent = `${orderId}:${statusTrx}:${payload.transaction_id ?? ''}`;

  const sudahAda = db.prepare('SELECT event_id, diproses FROM payment_events WHERE event_id = ?')
    .get(kunciEvent);

  if (sudahAda) {
    return {
      ok: true,
      statusCode: 200,
      duplikat: true,
      sudahDiproses: Boolean(sudahAda.diproses),
      pesan: 'Webhook sudah pernah diterima',
    };
  }

  db.prepare(`
    INSERT INTO payment_events (event_id, tipe, body_mentah, diterima_pada, diproses)
    VALUES (?, ?, ?, ?, 0)
  `).run(kunciEvent, `transaksi.${statusTrx}`, bodyMentah.slice(0, 200_000), sekarang);

  // ── Proses ───────────────────────────────────────────────────────────────
  let hasil;
  try {
    hasil = await tanganiTransaksi(payload);
  } catch (err) {
    // ── KENAPA TIDAK MELEMPAR ──────────────────────────────────────────────
    // Kalau kita jawab 500, Midtrans akan mengirim ulang. Tapi kalau
    // kegagalannya ada di kode kita (bukan jaringan), kiriman ulang tidak
    // akan berhasil juga — dan kita hanya membanjiri diri sendiri.
    //
    // Webhook sudah tercatat. Yang perlu adalah PERHATIAN MANUSIA.
    // Dicatat sebagai `diproses = -1` supaya terlihat di pemeriksaan.
    db.prepare('UPDATE payment_events SET diproses = -1, catatan = ? WHERE event_id = ?')
      .run(String(err?.message ?? err).slice(0, 500), kunciEvent);

    console.error(`[midtrans] webhook ${kunciEvent} GAGAL diproses:`, err?.stack ?? err);

    return {
      ok: true,
      statusCode: 200,
      gagalDiproses: true,
      pesan: 'Webhook dicatat, tapi pemrosesan gagal — perlu diperiksa manual',
    };
  }

  db.prepare('UPDATE payment_events SET diproses = 1, catatan = ? WHERE event_id = ?')
    .run(String(hasil?.pesan ?? '').slice(0, 500), kunciEvent);

  return { ok: true, statusCode: 200, ...hasil };
}

/**
 * Tangani satu transaksi Midtrans.
 *
 * ── KENAPA `capture` DIPERLAKUKAN HATI-HATI ────────────────────────────────
 * Untuk kartu kredit, `capture` berarti otorisasi berhasil tapi dana belum
 * tentu cair — bisa menyusul `settlement` beberapa jam kemudian, atau `deny`
 * kalau terdeteksi fraud.
 *
 * Memberi token saat `capture` berisiko: kalau nanti di-deny, pembeli sudah
 * dapat akses padahal tidak membayar. Karena itu `statusInternalMidtrans()`
 * hanya menganggap `capture` sebagai lunas kalau `fraud_status` = `accept`.
 *
 * Fungsi ini idempoten: kalau dipanggil dua kali untuk transaksi yang sama,
 * token hanya terbit sekali (dicek dari status pembayaran di database).
 */
async function tanganiTransaksi(payload) {
  const orderId = payload.order_id;
  const status = statusInternalMidtrans(payload.transaction_status, payload.fraud_status);

  const db = getDb();
  const bayar = db.prepare('SELECT * FROM payments WHERE id = ?').get(orderId);

  if (!bayar) {
    throw new Error(`Pembayaran ${orderId} tidak ada di database`);
  }

  // ── VERIFIKASI JUMLAH ────────────────────────────────────────────────────
  // Tanda tangan Midtrans sudah mengikat gross_amount ke transaksi ini, jadi
  // secara teori jumlahnya tidak bisa diubah. Tapi memeriksanya tetap penting:
  // ia menangkap kesalahan KONFIGURASI — kalau nominal yang dikirim ke
  // Midtrans berbeda dari yang tercatat di database.
  //
  // `gross_amount` datang sebagai string "200000.00" — dibandingkan sebagai
  // angka setelah diparse, karena perbandingan string akan gagal untuk
  // format yang berbeda ("200000" vs "200000.00").
  const ditagih = Math.round(Number(payload.gross_amount ?? 0));
  if (ditagih !== bayar.jumlah) {
    throw new Error(
      `Jumlah tidak cocok untuk ${orderId}: tercatat ${bayar.jumlah}, `
      + `dibayar ${ditagih}. Token TIDAK diterbitkan — perlu diperiksa manual.`,
    );
  }

  if (status === 'kedaluwarsa') {
    db.prepare('UPDATE payments SET status = ? WHERE id = ? AND status = ?')
      .run(STATUS.KEDALUWARSA, orderId, STATUS.PENDING);
    return { pesan: 'Transaksi kedaluwarsa' };
  }

  if (status === 'gagal') {
    db.prepare('UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ? AND status = ?')
      .run(STATUS.GAGAL, String(payload.transaction_status ?? 'gagal'), orderId, STATUS.PENDING);
    return { pesan: 'Transaksi gagal' };
  }

  if (status === 'dikembalikan') {
    db.prepare('UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ?')
      .run(STATUS.DIKEMBALIKAN, 'dana_dikembalikan', orderId);
    return { pesan: 'Dana dikembalikan' };
  }

  if (status !== 'dibayar') {
    return { pesan: `Status "${payload.transaction_status}" dicatat, tidak ada tindakan`, diabaikan: true };
  }

  // ── Sudah dibayar? Jangan terbitkan token kedua ──────────────────────────
  if (bayar.status === STATUS.DIBAYAR && bayar.token_id) {
    return { pesan: 'Sudah dibayar — token tidak diterbitkan ulang', sudahDibayar: true };
  }

  // ── Terbitkan token ──────────────────────────────────────────────────────
  const tierToken = bayar.tier === 'profesional' ? 'professional' : 'standard';

  // ── MASA BERLAKU ─────────────────────────────────────────────────────────
  // Bulanan: 35 hari (30 + 5 hari tenggang) — supaya pembeli tidak langsung
  // kehilangan akses kalau perpanjangan telat sehari.
  // Tahunan: 370 hari (365 + 5).
  const masaHari = bayar.periode === 'tahunan' ? 370 : 35;

  const token = issueToken({
    secret: config.secret,
    projectSlug: 'semua',
    tier: tierToken,
    label: `${bayar.nama || bayar.email} — ${bayar.tier} ${bayar.periode}`,
    issuedTo: bayar.email,
    issuedBy: 'midtrans',
    expiresInDays: masaHari,
    maxIps: 5,
    maxDevices: 5,
    notes: `Pembayaran ${bayar.id} · transaksi ${payload.transaction_id ?? ''}`,
    prefix: config.tokenPrefix,
    segments: config.tokenSegments,
    segmentLength: config.tokenSegmentLength,
  });

  transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = ?, dibayar_pada = ?, midtrans_order_id = ?, token_id = ?
      WHERE id = ?
    `).run(STATUS.DIBAYAR, Date.now(), orderId, token.id, orderId);
  });

  console.log(`[midtrans] ✅ ${orderId} dibayar — token ${token.id} diterbitkan untuk ${bayar.email}`);

  return {
    pesan: 'Pembayaran berhasil, token diterbitkan',
    tokenId: token.id,
    // Token plaintext HANYA ada di sini dan tidak disimpan di database.
    // Ia dikembalikan ke pemanggil untuk diteruskan ke pembeli — lalu hilang.
    token: token.token,
    email: bayar.email,
    tier: bayar.tier,
    periode: bayar.periode,
  };
}

/* ── Cek status ─────────────────────────────────────────────────────────── */

/** Ambil pembayaran berdasarkan ID, untuk ditampilkan ke pembeli. */
export function ambilPembayaran(id) {
  const baris = getDb().prepare(`
    SELECT id, tier, periode, jumlah, email, nama, status,
           dibuat_pada, dibayar_pada, token_id
    FROM payments WHERE id = ?
  `).get(id);

  if (!baris) return null;

  // ── JANGAN KIRIM token_id KE PUBLIK ──────────────────────────────────────
  // ID token bukan rahasia besar, tapi tidak ada gunanya dibagikan — dan
  // menyebutkannya mengundang orang mencoba menebak token aslinya.
  const { token_id, ...aman } = baris;

  return {
    ...aman,
    // Petunjuk apakah token sudah terbit, tanpa menyebut ID-nya
    tokenTerbit: Boolean(token_id),
  };
}

/** Apakah pembayaran sudah siap dipakai? Untuk endpoint konfigurasi publik. */
export function statusPembayaran() {
  // ── KENAPA TIDAK ADA DAFTAR "HARGA SIAP" ─────────────────────────────────
  // Versi Stripe memeriksa apakah setiap kombinasi tier+periode punya
  // `price_id` yang terdaftar. Midtrans TIDAK memerlukan itu — nominal
  // dikirim langsung saat transaksi dibuat, bukan disimpan di dashboard.
  //
  // Jadi yang perlu diperiksa hanya: apakah kredensial sudah ada.
  const tersedia = paketBisaDibeli().flatMap((p) => {
    const hasil = [];
    for (const periode of ['bulanan', 'tahunan']) {
      const harga = cariHarga(p.id, periode);
      if (!harga) continue;
      hasil.push({
        tier: p.id,
        periode,
        jumlah: harga.total,
        perBulan: harga.perBulan,
        diskonPersen: harga.diskonPersen,
      });
    }
    return hasil;
  });

  return {
    aktif: midtransAktif(),
    penyedia: 'midtrans',
    // Sandbox atau production — supaya halaman bisa menampilkan peringatan
    // kalau ini masih mode uji
    sandbox: !config.midtransProduction,
    harga: tersedia,
  };
}
