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
import { aktifkanLangganan } from './langganan-aktivasi.mjs';
import { listProjects } from './projects.mjs';

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
    if (lama.email !== emailBersih || lama.tier !== harga.tier || lama.periode !== harga.periode) {
      throw Object.assign(new Error('Kunci permintaan sudah digunakan untuk pesanan lain'), {
        kode: 'idempotency_konflik', statusCode: 409,
      });
    }
    if (lama.status !== STATUS.PENDING && lama.status !== STATUS.DIBAYAR) {
      throw Object.assign(new Error('Pesanan telah selesai. Mulai pesanan baru dengan kunci baru.'), {
        kode: 'pesanan_terminal', statusCode: 409,
      });
    }
    if (lama.status === STATUS.PENDING && !lama.payment_url && !lama.midtrans_order_id) {
      throw Object.assign(new Error('Pembuatan pembayaran belum dapat dipastikan. Periksa pesanan, jangan membuat transaksi kedua.'), {
        kode: 'pembayaran_diproses', statusCode: 409,
      });
    }
    if (lama.status === STATUS.DIBAYAR) {
      return {
        sudahDibayar: true,
        pembayaranId: lama.id,
        tier: lama.tier,
        periode: lama.periode,
      };
    }

    // ── URL TERSIMPAN — JALUR UTAMA UNTUK PERCOBAAN ULANG ──────────────────
    //
    // ── KENAPA INI DIDAHULUKAN, BUKAN MEMANGGIL MIDTRANS ───────────────────
    // API status v2 Midtrans tidak mengenal transaksi Snap yang belum dibuka
    // pembeli ("Transaction doesn't exist") — jadi URL-nya tidak bisa diambil
    // dari sana. URL yang kita simpan sendiri adalah satu-satunya sumber yang
    // bisa diandalkan, dan mengembalikannya berarti percobaan ulang TIDAK
    // membuat transaksi kedua.
    //
    // Batas waktunya mengikuti `kedaluwarsa_pada` (24 jam, sama dengan expiry
    // Snap). Setelah lewat, transaksi lama memang sudah mati — aman membuat
    // yang baru.
    if (
      lama.status === STATUS.PENDING &&
      lama.payment_url &&
      lama.kedaluwarsa_pada &&
      Number(lama.kedaluwarsa_pada) > Date.now()
    ) {
      return {
        pembayaranId: lama.id,
        url: lama.payment_url,
        sesiId: lama.snap_token ?? lama.midtrans_order_id ?? lama.id,
        tier: lama.tier,
        periode: lama.periode,
        jumlah: lama.jumlah,
        dilanjutkan: true,
      };
    }

    // Masih pending & transaksi masih ada → tanya Midtrans
    if (lama.status === STATUS.PENDING && lama.midtrans_order_id) {
      let trx = null;
      try {
        trx = await ambilStatusTransaksi(lama.midtrans_order_id);
      } catch {
        // Status tidak terbaca dan tidak ada URL tersimpan. JANGAN buat
        // transaksi kedua — kalau yang lama ternyata masih bisa dibayar,
        // pembeli bisa tertagih dua kali. Minta periksa halaman pesanan.
        throw Object.assign(new Error(
          'Pembayaran sebelumnya belum bisa dipastikan selesai. Buka halaman pesanan untuk memeriksa statusnya, atau coba lagi sebentar lagi.'
        ), { kode: 'status_tidak_terbaca', statusCode: 409 });
      }

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

      // Sudah dibayar di Midtrans tapi webhook belum sampai. Jangan buat
      // transaksi kedua — beri tahu pembeli untuk menunggu sebentar.
      const fraud = String(trx?.fraud_status ?? '').toLowerCase();
      if (st === 'settlement' || (st === 'capture' && fraud === 'accept')) {
        throw Object.assign(new Error(
          'Pembayaran sudah diterima dan sedang diproses. Tunggu sebentar, lalu buka halaman pesanan.'
        ), { kode: 'pembayaran_diproses', statusCode: 409 });
      }

      // expire / cancel / deny → transaksi lama sudah terminal. Baris ini
      // dipakai ulang di bawah (kunci idempotensi UNIK — INSERT baru ditolak).
      if (!['expire', 'cancel', 'deny', 'failure'].includes(st)) {
        throw Object.assign(new Error('Status pembayaran belum terminal; periksa pesanan.'), {
          kode: 'status_tidak_terbaca', statusCode: 409,
        });
      }
      db.prepare(
        'UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ?',
      ).run(STATUS.KEDALUWARSA, `midtrans:${st || 'tidak_dikenal'}`, lama.id);
      throw Object.assign(new Error('Mulai pesanan baru dengan kunci baru.'), {
        kode: 'pesanan_terminal', statusCode: 409,
      });
    }
  }

  const id = lama ? lama.id : `pay_${randomBytes(12).toString('hex')}`;
  const sekarang = Date.now();

  // ── Catat SEBELUM memanggil Midtrans ─────────────────────────────────────
  // Kalau urutannya dibalik (panggil Midtrans dulu, catat kemudian) dan
  // pencatatan gagal, akan ada transaksi yang tidak diketahui sistem —
  // dan pembayaran bisa masuk tanpa jejak.
  //
  // ── KENAPA BARIS LAMA DIPAKAI ULANG, BUKAN INSERT BARU ───────────────────
  // `idempotency_key` UNIK. Percobaan ulang dengan kunci yang sama (mis.
  // kirim ulang setelah transaksi pertama gagal) akan ditolak database
  // dengan "UNIQUE constraint failed" — pembeli melihat galat internal dan
  // tidak pernah bisa mencoba lagi. Memakai ulang barisnya menjaga janji
  // kunci itu: satu kunci = satu baris pembayaran, berapa pun percobaannya.
  if (lama) {
    transaction(() => {
      db.prepare(`
        UPDATE payments
        SET tier = ?, periode = ?, jumlah = ?, email = ?, nama = ?,
            status = ?, alasan_gagal = NULL, dibuat_pada = ?
        WHERE id = ?
      `).run(harga.tier, harga.periode, harga.total, emailBersih,
             String(nama).slice(0, 120), STATUS.PENDING, sekarang, id);
    });
  } else {
    transaction(() => {
      db.prepare(`
        INSERT INTO payments (id, idempotency_key, tier, periode, jumlah,
                              email, nama, status, dibuat_pada)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, idempotencyKey, harga.tier, harga.periode, harga.total,
             emailBersih, String(nama).slice(0, 120), STATUS.PENDING, sekarang);
    });
  }

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

    // URL + token disimpan supaya percobaan ulang mengembalikan yang SAMA
    // (lihat catatan di db.mjs). `snap_token` juga dipakai halaman /pesanan
    // kalau nanti perlu membuka ulang halaman pembayaran.
    db.prepare(
      'UPDATE payments SET midtrans_order_id = ?, payment_url = ?, snap_token = ?, kedaluwarsa_pada = ? WHERE id = ?',
    ).run(id, trx.redirect_url ?? null, trx.token ?? null, kedaluwarsa, id);

    return {
      pembayaranId: id,
      url: trx.redirect_url,
      sesiId: trx.token ?? id,
      tier: harga.tier,
      periode: harga.periode,
      jumlah: harga.total,
    };
  } catch (err) {
    // A network timeout does not prove Snap did not create a chargeable order.
    // Keep the reservation pending; a retry must reconcile, never POST again.
    db.prepare(
      'UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ?',
    ).run(STATUS.PENDING, 'status_pembuatan_belum_pasti', id);

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

  // Always reconcile with the provider: a previously pending/challenged
  // response must not suppress a later accepted payment with the same event id.

  db.prepare(`
    INSERT OR IGNORE INTO payment_events (event_id, tipe, body_mentah, diterima_pada, diproses)
    VALUES (?, ?, ?, ?, 0)
  `).run(kunciEvent, `transaksi.${statusTrx}`, JSON.stringify({ order_id: orderId, transaction_status: statusTrx }), sekarang);

  // ── Proses ───────────────────────────────────────────────────────────────
  let hasil;
  try {
    // Signature does not cover transaction_status or fraud_status.
    const confirmed = await ambilStatusTransaksi(orderId);
    if (confirmed?.order_id !== orderId || Number(confirmed.gross_amount) !== Number(payload.gross_amount)) {
      throw new Error('status_provider_tidak_cocok');
    }
    hasil = tanganiTransaksi(confirmed);
  } catch (err) {
    // ── KENAPA TIDAK MELEMPAR ──────────────────────────────────────────────
    // Kalau kita jawab 500, Midtrans akan mengirim ulang. Tapi kalau
    // kegagalannya ada di kode kita (bukan jaringan), kiriman ulang tidak
    // akan berhasil juga — dan kita hanya membanjiri diri sendiri.
    //
    // Webhook sudah tercatat. Yang perlu adalah PERHATIAN MANUSIA.
    // Dicatat sebagai `diproses = -1` supaya terlihat di pemeriksaan.
    db.prepare('UPDATE payment_events SET diproses = -1, catatan = ? WHERE event_id = ?')
      .run('pemrosesan_gagal_perlu_retry', kunciEvent);

    return {
      ok: false,
      statusCode: 503,
      gagalDiproses: true,
      pesan: 'Webhook dicatat; pemrosesan belum selesai, kirim ulang.',
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
function tanganiTransaksi(payload) {
  const result = transaction(() => terapkanTransaksi(payload));
  if (result.tokenId) {
    const bayar = getDb().prepare('SELECT * FROM payments WHERE id=?').get(payload.order_id);
    kirimStrukSesudahCommit(payload, bayar);
  }
  return result;
}

function terapkanTransaksi(payload) {
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
  const ditagih = Number(payload.gross_amount);
  if (!Number.isSafeInteger(ditagih) || ditagih !== bayar.jumlah || (payload.currency && payload.currency !== 'IDR')) {
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
  if (bayar.token_id || bayar.status === STATUS.DIKEMBALIKAN) {
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
    scopes: listProjects().map(p => p.slug),
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


  // ── AKTIFKAN LANGGANAN ─────────────────────────────────────────────────────
  //
  // ── BUG YANG DIPERBAIKI: PEMBELI TIDAK MENDAPAT AKSES PAKETNYA ───────────
  // Webhook ini sudah menerbitkan TOKEN AKSES, tapi paket pengguna dibaca dari
  // tabel `langganan` — dan tabel itu tidak pernah diisi. Akibatnya pembeli
  // yang sudah membayar tetap dianggap GRATIS: semua proyek terkunci dan dia
  // tidak bisa membuat token. Uangnya masuk, aksesnya tidak.
  //
  // ── KENAPA HASILNYA DIPERIKSA, BUKAN DIAIBAIKAN ──────────────────────────
  // Aktivasi bisa gagal dengan cara yang TIDAK salah secara teknis:
  //   · pembeli membayar dengan email yang belum terdaftar
  //   · paketnya tidak dikenal
  //
  // Dalam kasus itu, pembayaran TETAP SAH (uangnya sudah masuk) tapi aksesnya
  // tidak bisa dibuat otomatis. Itu harus terlihat di log supaya bisa
  // ditindaklanjuti manual — bukan gagal diam-diam.
    const hasil = aktifkanLangganan({
      paymentId: bayar.id,
      email: bayar.email,
      paket: bayar.tier,
      periode: bayar.periode,
      nama: bayar.nama,
    });

    if (!hasil.aktif) {
      throw new Error('aktivasi_langganan_belum_selesai');
    }

  // ── STRUK PEMBAYARAN ───────────────────────────────────────────────────────
  //
  // Dikirim SETELAH token terbit dan pembayaran tersimpan. Kalau email gagal,
  // pembayaran tetap sah — `kirimStrukPembayaran` tidak melempar dan hanya
  // mencatat ke log. Pembeli masih bisa melihat pesanannya di /pesanan.
  //
  // Tidak di-await: webhook Midtrans punya batas waktu balasan, dan menunggu
  // SMTP di jalur kritis bisa membuat Midtrans menganggap webhook gagal lalu
  // mengirim ulang — pembayaran tercatat dua kali.
  return {
    pesan: 'Pembayaran berhasil, token diterbitkan',
    tokenId: token.id,
    token: token.token,
    email: bayar.email,
    tier: bayar.tier,
    periode: bayar.periode,
  };
}

function kirimStrukSesudahCommit(payload, bayar) {
  const orderId = bayar.id;
  (async () => {
    try {
      const { kirimStrukPembayaran } = await import('./email.mjs');
      await kirimStrukPembayaran({
        ke: bayar.email,
        nama: bayar.nama,
        email: bayar.email,
        nomorPesanan: orderId,
        paket: bayar.tier === 'profesional' ? 'Profesional' : 'Standar',
        periode: bayar.periode === 'tahunan' ? 'Tahunan (12 bulan)' : 'Bulanan',
        jumlah: rupiah(payload.gross_amount ?? bayar.jumlah),
        status: 'Lunas',
        waktu: Date.now(),
      });
    } catch (err) {
      console.error('[midtrans] struk gagal dikirim:', err?.message ?? err);
    }
  })();

}

/**
 * Format angka rupiah untuk struk.
 *
 * Midtrans mengirim `gross_amount` sebagai string desimal ("150000.00").
 * Tanpa pembersihan, struk menampilkan "Rp150000.00" — terlihat seperti
 * kesalahan sistem, padahal cuma format.
 */
function rupiah(nilai) {
  const angka = Number(String(nilai ?? 0).split('.')[0]);
  if (!Number.isFinite(angka)) return String(nilai ?? '-');
  return 'Rp' + angka.toLocaleString('id-ID');
}

/* ── Cek status ─────────────────────────────────────────────────────────── */

/** Ambil pembayaran berdasarkan ID, untuk ditampilkan ke pembeli. */
export function ambilPembayaran(id) {
  const baris = getDb().prepare(`
    SELECT id, tier, periode, jumlah, email, nama, status,
           dibuat_pada, dibayar_pada, kedaluwarsa_pada, token_id, payment_url
    FROM payments WHERE id = ?
  `).get(id);

  if (!baris) return null;

  // ── JANGAN KIRIM token_id KE PUBLIK ──────────────────────────────────────
  // ID token bukan rahasia besar, tapi tidak ada gunanya dibagikan — dan
  // menyebutkannya mengundang orang mencoba menebak token aslinya.
  const { token_id, ...aman } = baris;

  // ── URL PEMBAYARAN HANYA SAAT MASIH PENDING ──────────────────────────────
  // Setelah dibayar (atau gagal/kedaluwarsa), URL-nya tidak ada gunanya dan
  // hanya menambah data yang bisa disalahpahami. Yang mengakses endpoint ini
  // tidak perlu login, jadi yang dikirim dijaga sekecil mungkin.
  const urlPembayaran =
    baris.status === 'pending' && baris.payment_url &&
    Number(baris.kedaluwarsa_pada) > Date.now()
      ? baris.payment_url
      : null;

  return {
    ...aman,
    // Petunjuk apakah token sudah terbit, tanpa menyebut ID-nya
    tokenTerbit: Boolean(token_id),
    ...(urlPembayaran ? { url_pembayaran: urlPembayaran } : {}),
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
