/**
 * Pembayaran — logika bisnis langganan lewat Xendit.
 *
 * ── PEMBAGIAN TANGGUNG JAWAB ───────────────────────────────────────────────
 *   xendit.mjs   — bicara ke API Xendit (HTTP, token webhook, terjemahan error)
 *   checkout.mjs — logika bisnis (harga mana, token apa, siapa dapat apa)
 *
 * Pemisahan ini penting: `xendit.mjs` tidak tahu apa itu "paket Profesional",
 * dan `checkout.mjs` tidak tahu bagaimana cara memanggil API Xendit. Kalau
 * nanti Xendit diganti penyedia lain, hanya `xendit.mjs` yang berubah.
 *
 * ── SATU SUMBER HARGA ──────────────────────────────────────────────────────
 * Angka yang ditagih TIDAK dihitung di sini. Ia datang dari `pricing.mjs` —
 * satu sumber yang sama dengan yang ditampilkan di halaman harga.
 *
 * Yang dikirim ke Xendit adalah angka itu, dan Xendit mengembalikannya di
 * webhook. Kalau berbeda, ada yang tidak sinkron dan itu dicatat sebagai
 * peringatan — bukan diabaikan.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { config } from './config.mjs';
import { getDb, transaction } from './db.mjs';
import { PAKET } from './pricing.mjs';
import {
  xenditAktif, buatInvoice, ambilInvoice,
  verifikasiWebhookXendit, statusInternal, pesanGalatXendit,
} from './xendit.mjs';
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
  // Untuk tahunan, Xendit menagih SEKALI untuk 12 bulan. Kalau yang dikirim
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
  if (!xenditAktif()) {
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

    // Masih pending & invoice masih ada → kembalikan URL yang sama
    if (lama.status === STATUS.PENDING && lama.xendit_invoice_id) {
      try {
        const inv = await ambilInvoice(lama.xendit_invoice_id);
        // Xendit: status PENDING + masih ada invoice_url = masih bisa dibayar
        if (inv?.invoice_url && String(inv.status).toUpperCase() === 'PENDING') {
          return {
            pembayaranId: lama.id,
            url: inv.invoice_url,
            sesiId: inv.id,
            tier: lama.tier,
            periode: lama.periode,
            jumlah: lama.jumlah,
            dilanjutkan: true,
          };
        }
      } catch {
        // Invoice tidak bisa diambil — lanjut buat yang baru di bawah
      }
    }
  }

  const id = `pay_${randomBytes(12).toString('hex')}`;
  const sekarang = Date.now();

  // ── Catat SEBELUM memanggil Xendit ───────────────────────────────────────
  // Kalau urutannya dibalik (panggil Xendit dulu, catat kemudian) dan
  // pencatatan gagal, akan ada invoice yang tidak diketahui sistem —
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
    // ── `externalId` = ID PEMBAYARAN KITA ──────────────────────────────────
    // Ini kunci idempotensi Xendit. Kalau `external_id` yang sama dikirim
    // dua kali, Xendit mengembalikan invoice yang SAMA — bukan membuat
    // yang baru. Jadi dobel-klik tidak menghasilkan dobel tagih.
    //
    // Bedanya dengan Stripe: Stripe pakai header `Idempotency-Key`, Xendit
    // pakai field di body. Efeknya sama.
    const inv = await buatInvoice({
      externalId: id,
      jumlah: harga.total,
      deskripsi: `Langganan ${harga.namaPaket} — ${harga.periode}`,
      emailPelanggan: emailBersih,
      namaPelanggan: String(nama).slice(0, 120),
      metadata: {
        pembayaran_id: id,
        tier: harga.tier,
        periode: harga.periode,
        // Angka ini untuk VERIFIKASI nanti, bukan untuk ditagih —
        // yang ditagih tetap `amount` yang dikirim di atas.
        jumlah_diharapkan: String(harga.total),
      },
    });

    // Xendit mengembalikan `expiry_date` sebagai ISO string
    const kedaluwarsa = inv.expiry_date
      ? new Date(inv.expiry_date).getTime()
      : sekarang + MS_SEHARI;

    db.prepare(
      'UPDATE payments SET xendit_invoice_id = ?, kedaluwarsa_pada = ? WHERE id = ?',
    ).run(inv.id, kedaluwarsa, id);

    return {
      pembayaranId: id,
      url: inv.invoice_url,
      sesiId: inv.id,
      tier: harga.tier,
      periode: harga.periode,
      jumlah: harga.total,
      // ── PERINGATAN YANG HARUS SAMPAI KE LOG ──────────────────────────────
      // Kalau jumlah yang dikembalikan Xendit berbeda dari yang dihitung di
      // sini, itu tanda ada yang tidak sinkron. Pembayaran tetap jalan
      // (Xendit yang menagih), tapi ada yang harus diperiksa.
      ...(inv.amount && Number(inv.amount) !== harga.total
        ? {
            peringatanHarga: {
              dihitung: harga.total,
              diXendit: Number(inv.amount),
            },
          }
        : {}),
    };
  } catch (err) {
    // Tandai gagal — jangan biarkan baris "pending" yang tidak pernah selesai
    db.prepare(
      'UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ?',
    ).run(STATUS.GAGAL, String(err?.kode ?? err?.message ?? 'tidak_diketahui').slice(0, 200), id);

    const terjemahan = pesanGalatXendit(err);
    throw Object.assign(new Error(terjemahan.pesan), {
      kode: err?.kode ?? 'xendit_error',
      saran: terjemahan.saran,
      statusCode: err?.statusCode ?? 400,
    });
  }
}

/* ── Webhook ────────────────────────────────────────────────────────────── */

/**
 * Proses webhook dari Xendit.
 *
 * ── URUTAN YANG TIDAK BOLEH DIBALIK ────────────────────────────────────────
 *   1. Verifikasi token   — SEBELUM apa pun
 *   2. Catat event (idempoten)  — supaya kiriman ulang tidak diproses dua kali
 *   3. Baru proses
 *
 * Kalau langkah 3 dijalankan sebelum 1, siapa pun bisa menerbitkan token
 * gratis dengan mengirim JSON palsu.
 *
 * ── BEDA PENTING DARI STRIPE ───────────────────────────────────────────────
 * Xendit TIDAK menandatangani body. Yang dikirim adalah TOKEN STATIS di
 * header `x-callback-token` — sama di setiap request.
 *
 * Konsekuensinya: verifikasi token saja TIDAK cukup melindungi dari:
 *   • Kiriman ulang (tidak ada cap waktu kriptografis)
 *   • Body yang diubah di tengah jalan (hanya HTTPS yang melindungi)
 *
 * Karena itu tiga lapisan berikutnya WAJIB ada:
 *
 *   1. IDEMPOTENSI — `id` dari Xendit dicek; yang sama tidak diproses dua kali
 *   2. VERIFIKASI JUMLAH — nominal di webhook harus cocok dengan yang tercatat
 *   3. VERIFIKASI STATUS — hanya proses status yang memang final
 *
 * Ketiganya ada di fungsi ini. Tanpa mereka, integrasi ini tidak aman —
 * bukan karena tokennya lemah, tapi karena token statis memang tidak bisa
 * membuktikan bahwa body-nya utuh dan baru.
 *
 * ── BENTUK WEBHOOK XENDIT ──────────────────────────────────────────────────
 * Berbeda dari Stripe yang membungkus event dalam `{id, type, data}`,
 * Xendit mengirim INVOICE LANGSUNG sebagai objek teratas:
 *
 *   { "id": "inv_xxx", "external_id": "pay_xxx", "status": "PAID",
 *     "amount": 200000, "paid_amount": 200000, ... }
 *
 * Jadi tidak ada `event.type` — yang menentukan adalah `status` invoice.
 */
export async function prosesWebhook(bodyMentah, headerToken) {
  const verifikasi = verifikasiWebhookXendit(headerToken);
  if (!verifikasi.ok) {
    return {
      ok: false,
      statusCode: 401,
      alasan: verifikasi.alasan,
      pesan: 'Token webhook tidak valid',
    };
  }

  let inv;
  try {
    inv = JSON.parse(bodyMentah);
  } catch {
    return { ok: false, statusCode: 400, alasan: 'body_bukan_json', pesan: 'Body bukan JSON' };
  }

  if (!inv?.id || !inv?.external_id) {
    return {
      ok: false, statusCode: 400, alasan: 'invoice_tidak_lengkap',
      pesan: 'Webhook tidak berisi id dan external_id',
    };
  }

  const db = getDb();
  const sekarang = Date.now();

  // ── Idempotensi ──────────────────────────────────────────────────────────
  // Kunci uniknya gabungan `id` + `status`: Xendit mengirim webhook BERKALI
  // untuk satu invoice (PENDING → PAID), dan masing-masing membawa informasi
  // berbeda. Mengunci hanya pada `id` akan menolak update status yang sah.
  const kunciEvent = `${inv.id}:${String(inv.status).toUpperCase()}`;

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
  `).run(kunciEvent, `invoice.${String(inv.status).toLowerCase()}`, bodyMentah.slice(0, 200_000), sekarang);

  // ── Proses berdasarkan status ────────────────────────────────────────────
  let hasil;
  try {
    hasil = await tanganiInvoice(inv);
  } catch (err) {
    // ── KENAPA TIDAK MELEMPAR ──────────────────────────────────────────────
    // Kalau kita jawab 500, Xendit akan mengirim ulang. Tapi kalau
    // kegagalannya ada di kode kita (bukan jaringan), kiriman ulang tidak
    // akan berhasil juga — dan kita hanya membanjiri diri sendiri.
    //
    // Webhook sudah tercatat. Yang perlu adalah PERHATIAN MANUSIA.
    // Dicatat sebagai `diproses = -1` supaya terlihat di pemeriksaan.
    db.prepare('UPDATE payment_events SET diproses = -1, catatan = ? WHERE event_id = ?')
      .run(String(err?.message ?? err).slice(0, 500), kunciEvent);

    console.error(`[xendit] webhook ${kunciEvent} GAGAL diproses:`, err?.stack ?? err);

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
 * Tangani satu invoice Xendit.
 *
 * Hanya tiga status yang bertindak — sisanya dicatat saja:
 *   PAID / SETTLED → pembayaran berhasil, terbitkan token
 *   EXPIRED        → invoice kedaluwarsa, tidak ada yang perlu dilakukan
 *   FAILED         → pembayaran gagal
 *
 * ── PAID DAN SETTLED SAMA-SAMA MENERBITKAN TOKEN ───────────────────────────
 * PAID    = pembeli sudah membayar.
 * SETTLED = uang sudah masuk rekening.
 *
 * Untuk penerbitan token, yang penting adalah PAID — pembeli sudah
 * menunaikan kewajibannya. Menunggu SETTLED berarti pembeli menunggu 1-2
 * hari kerja sebelum bisa mengakses, dan itu tidak perlu.
 *
 * Fungsi ini idempoten: kalau dipanggil dua kali untuk invoice yang sama,
 * token hanya terbit sekali (dicek dari status pembayaran di database).
 */
async function tanganiInvoice(inv) {
  const status = String(inv.status).toUpperCase();
  const pembayaranId = inv.external_id;

  const db = getDb();
  const bayar = db.prepare('SELECT * FROM payments WHERE id = ?').get(pembayaranId);

  if (!bayar) {
    throw new Error(`Pembayaran ${pembayaranId} tidak ada di database`);
  }

  // ── VERIFIKASI JUMLAH ────────────────────────────────────────────────────
  // Karena Xendit tidak menandatangani body, ini lapisan penting: kalau
  // nominal di webhook berbeda dari yang kita minta, ada yang salah —
  // dan token TIDAK boleh diterbitkan untuk jumlah yang tidak cocok.
  //
  // Ini yang membedakan integrasi aman dari yang tidak.
  const ditagih = Number(inv.paid_amount ?? inv.amount ?? 0);
  if (ditagih !== bayar.jumlah) {
    throw new Error(
      `Jumlah tidak cocok untuk ${pembayaranId}: tercatat ${bayar.jumlah}, `
      + `dibayar ${ditagih}. Token TIDAK diterbitkan — perlu diperiksa manual.`,
    );
  }

  if (status === 'EXPIRED') {
    db.prepare('UPDATE payments SET status = ? WHERE id = ? AND status = ?')
      .run(STATUS.KEDALUWARSA, pembayaranId, STATUS.PENDING);
    return { pesan: 'Invoice kedaluwarsa' };
  }

  if (status === 'FAILED') {
    db.prepare('UPDATE payments SET status = ?, alasan_gagal = ? WHERE id = ? AND status = ?')
      .run(STATUS.GAGAL, 'pembayaran_gagal', pembayaranId, STATUS.PENDING);
    return { pesan: 'Pembayaran gagal' };
  }

  if (status !== 'PAID' && status !== 'SETTLED') {
    return { pesan: `Status "${status}" dicatat, tidak ada tindakan`, diabaikan: true };
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
    issuedBy: 'xendit',
    expiresInDays: masaHari,
    maxIps: 5,
    maxDevices: 5,
    notes: `Pembayaran ${bayar.id} · invoice ${inv.id}`,
    prefix: config.tokenPrefix,
    segments: config.tokenSegments,
    segmentLength: config.tokenSegmentLength,
  });

  transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = ?, dibayar_pada = ?, xendit_invoice_id = ?, token_id = ?
      WHERE id = ?
    `).run(STATUS.DIBAYAR, Date.now(), String(inv.id ?? ''), token.id, pembayaranId);
  });

  console.log(`[xendit] ✅ ${pembayaranId} dibayar — token ${token.id} diterbitkan untuk ${bayar.email}`);

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
  // `price_id` yang terdaftar. Xendit TIDAK memerlukan itu — nominal
  // dikirim langsung saat invoice dibuat, bukan disimpan di dashboard.
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
    aktif: xenditAktif(),
    penyedia: 'xendit',
    harga: tersedia,
  };
}
