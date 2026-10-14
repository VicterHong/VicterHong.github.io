/**
 * SENTINEL — PENGIRIM WEBHOOK
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PERAN MODUL INI
 * ══════════════════════════════════════════════════════════════════════════════
 * Ia menyatukan tiga hal yang sudah dibangun terpisah:
 *
 *   antrean.mjs  → pesannya ada di mana, kapan boleh dicoba
 *   sirkuit.mjs  → endpoint tujuannya sedang hidup atau mati
 *   tanda-tangan.mjs → memastikan yang masuk memang sah
 *
 * ── KENAPA DIPISAH, BUKAN SATU BERKAS BESAR ──────────────────────────────────
 * Ketiganya bisa diuji sendiri-sendiri, dan itu penting: antrean diuji dengan
 * kiriman ulang, sirkuit diuji dengan endpoint mati, tanda tangan diuji dengan
 * tanda tangan palsu. Kalau semuanya menyatu, menguji satu perilaku berarti
 * menyalakan semuanya — dan kegagalan di satu bagian menutupi bagian lain.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * URUTAN SATU PERCOBAAN PENGIRIMAN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Ambil pesan yang siap kirim dari antrean
 *   2. Periksa sirkuit endpoint tujuannya
 *        → kalau TERBUKA: lewati, kembalikan ke antrean tanpa dicoba
 *        → kalau SETENGAH: catat uji mulai, kirim SATU percobaan
 *   3. Kirim dengan timeout
 *   4. Catat hasilnya ke antrean DAN ke sirkuit
 *
 * ── KENAPA SIRKUIT DIPERIKSA SEBELUM KIRIM, BUKAN SESUDAH ────────────────────
 * Kalau endpointnya sudah jelas mati, mengirim percobaan ke sana hanya membuang
 * waktu tunggu timeout — dan untuk 50 pesan, itu 50 kali timeout berturut-turut.
 *
 * Yang penting: pesannya TIDAK dihapus saat dilewati. Ia dikembalikan ke antrean
 * dengan jadwal yang sama, jadi ia dicoba lagi begitu sirkuitnya menutup.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA PESAN YANG DILEWATI TIDAK DIHITUNG SEBAGAI KEGAGALAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Kalau dihitung, sirkuit yang terbuka akan terus menambah penghitung
 * kegagalannya sendiri — dan jendela tunggunya naik tanpa ada percobaan
 * sungguhan yang gagal. Endpoint yang sudah pulih akan menunggu 30 menit
 * hanya karena pesan-pesan yang dilewati.
 */

import { getDb, now } from '../db.mjs';
import { ambilSiapKirim, catatHasil, JADWAL_BACKOFF_MS } from './antrean.mjs';
import { keadaanSirkuit, catatSukses, catatGagal, catatUjiMulai, hostDari } from './sirkuit.mjs';

/* ── Konfigurasi ────────────────────────────────────────────────────────── */

/**
 * Timeout pengiriman, milidetik.
 *
 * ── KENAPA 10 DETIK ──────────────────────────────────────────────────────────
 * Endpoint webhook yang normal membalas dalam ratusan milidetik. Yang butuh
 * lebih dari 10 detik biasanya sedang bermasalah — dan menunggu lebih lama
 * berarti pekerja yang menunggu tidak bisa mengerjakan pesan lain.
 *
 * Terlalu pendek juga salah: endpoint yang memproses data (menulis ke database,
 * mengirim email) bisa butuh beberapa detik. 3 detik akan memutus banyak
 * endpoint yang sebenarnya sehat.
 */
export const TIMEOUT_MS = 10_000;

/** Batas ukuran balasan yang dibaca, byte. */
export const BATAS_BALASAN_BYTE = 4096;

/* ── Pengiriman satu pesan ──────────────────────────────────────────────── */

/**
 * Kirim satu pesan ke URL tujuannya.
 *
 * Mengembalikan `{ sukses, kodeBalasan, pesanGalat, latensiMs }`.
 *
 * ── KENAPA TIDAK MELEMPAR ────────────────────────────────────────────────────
 * Kegagalan jaringan adalah hal NORMAL di sini, bukan pengecualian. Kalau
 * fungsinya melempar, setiap kegagalan harus ditangkap pemanggil — dan satu
 * tempat yang lupa menangkapnya akan menghentikan seluruh batch.
 *
 * Yang dikembalikan adalah HASIL, dan pemanggilnya memutuskan apa yang
 * dilakukan.
 */
export async function kirimSatu({ url, body, headers = {}, timeoutMs = TIMEOUT_MS, fetchImpl = fetch }) {
  const mulai = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // ── PENANDA SUMBER ────────────────────────────────────────────────────
        // Penerima bisa tahu ini dari sistem webhook, bukan permintaan biasa.
        'user-agent': 'SentinelLite/1.0',
        ...headers,
      },
      body,
      signal: ctl.signal,
    });

    const latensiMs = Date.now() - mulai;

    // ── SUKSES HANYA 2xx ──────────────────────────────────────────────────────
    // 3xx adalah pengalihan — kita tidak mengikutinya, dan menganggapnya
    // sukses berarti kita tidak pernah tahu apakah pesannya benar-benar sampai.
    // 4xx adalah penolakan; mengulanginya biasanya tidak membantu, tapi 429
    // (terlalu banyak permintaan) memang perlu diulang — jadi tetap dicatat
    // sebagai gagal dan biarkan backoff yang menanganinya.
    const sukses = res.status >= 200 && res.status < 300;

    // Balasan dibaca DENGAN BATAS — endpoint yang membalas dengan body raksasa
    // tidak boleh menghabiskan memori.
    let cuplikan = '';
    try {
      const teks = await res.text();
      cuplikan = teks.slice(0, BATAS_BALASAN_BYTE);
    } catch {
      // Balasan yang tidak bisa dibaca bukan kegagalan pengiriman — statusnya
      // sudah cukup untuk memutuskan.
    }

    return {
      sukses,
      kodeBalasan: res.status,
      pesanGalat: sukses ? '' : `HTTP ${res.status}${cuplikan ? ': ' + cuplikan.slice(0, 200) : ''}`,
      latensiMs,
    };
  } catch (err) {
    const latensiMs = Date.now() - mulai;

    // ── BEDAKAN TIMEOUT DARI GALAT JARINGAN LAIN ─────────────────────────────
    // Keduanya gagal, tapi penyebabnya berbeda dan itu berguna saat diperiksa:
    // timeout berarti endpointnya lambat, ECONNREFUSED berarti tidak ada yang
    // mendengarkan di sana.
    const pesan = err?.name === 'AbortError'
      ? `Timeout setelah ${timeoutMs}ms`
      : (err?.message ?? String(err));

    return { sukses: false, kodeBalasan: null, pesanGalat: pesan.slice(0, 300), latensiMs };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Satu putaran pengiriman ────────────────────────────────────────────── */

/**
 * Jalankan satu putaran: ambil pesan yang siap, kirim, catat hasilnya.
 *
 * Mengembalikan ringkasan putaran itu.
 *
 * ── KENAPA SATU PUTARAN, BUKAN LOOP TANPA HENTI ──────────────────────────────
 * Fungsi yang berjalan terus-menerus tidak bisa diuji, tidak bisa dihentikan
 * dengan rapi, dan menyulitkan pemantauan. Satu putaran bisa dipanggil dari
 * penjadwal, dari tes, atau dari tombol "kirim sekarang" di UI.
 */
export async function jalankanPutaran({ batas = 10, sekarang = now(), fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const pesan = ambilSiapKirim(batas, sekarang);

  const ringkas = {
    diambil: pesan.length,
    terkirim: 0,
    gagal: 0,
    dilewati: 0,       // sirkuit terbuka
    masukDlq: 0,
    detail: [],
  };

  // ── SATU PERCOBAAN UJI PER HOST DALAM SATU PUTARAN ───────────────────────
  //
  // ── BUG YANG DIPERBAIKI ───────────────────────────────────────────────────
  // Versi sebelumnya mengambil SEMUA pesan dari antrean di awal putaran, lalu
  // memeriksa sirkuitnya satu per satu di dalam loop.
  //
  // Akibatnya: kalau 5 pesan menuju host yang sirkuitnya baru lewat jendela
  // tunggu, kelimanya melihat keadaan "setengah terbuka, boleh uji" — karena
  // `catatUjiMulai` yang menandainya baru dipanggil SATU PER SATU di dalam
  // loop, dan pesan berikutnya sudah terlanjur diambil.
  //
  // Hasilnya: 5 percobaan berturut-turut ke endpoint yang masih mati — persis
  // yang ingin dicegah oleh keadaan setengah terbuka.
  //
  // Perbaikannya: host yang sudah dipakai untuk uji dicatat di sini, dan pesan
  // berikutnya ke host yang sama langsung dilewati tanpa memeriksa lagi.
  const hostSudahDiuji = new Set();

  for (const p of pesan) {
    const k = keadaanSirkuit(p.url, sekarang);

    // ── HOST INI SUDAH DAPAT PERCOBAAN UJINYA DI PUTARAN INI ─────────────────
    if (k.keadaan === 'setengah_terbuka' && hostSudahDiuji.has(k.host)) {
      const tungguSampai = k.tungguSampai > 0 ? k.tungguSampai : sekarang + 30_000;
      getDb().prepare('UPDATE sentinel_antrean SET jadwal_berikut = ? WHERE id = ?')
        .run(tungguSampai, p.id);

      ringkas.dilewati++;
      ringkas.detail.push({ id: p.id, hasil: 'dilewati', alasan: 'uji_sedang_berjalan', host: k.host });
      continue;
    }

    // ── SIRKUIT TERBUKA: LEWATI, JANGAN DICATAT SEBAGAI KEGAGALAN ─────────────
    if (!k.bolehKirim) {
      // Kembalikan ke antrean dengan jadwal yang sama. Pesannya TIDAK dihapus.
      //
      // `jadwal_berikut` disetel ke waktu tutupnya sirkuit, jadi ia otomatis
      // dicoba lagi begitu sirkuitnya menutup — tanpa perlu ada yang
      // membangunkannya.
      const tungguSampai = k.tungguSampai > 0 ? k.tungguSampai : sekarang + 30_000;
      getDb().prepare('UPDATE sentinel_antrean SET jadwal_berikut = ? WHERE id = ?')
        .run(tungguSampai, p.id);

      ringkas.dilewati++;
      ringkas.detail.push({ id: p.id, hasil: 'dilewati', alasan: 'sirkuit_terbuka', host: k.host });
      continue;
    }

    // ── SETENGAH TERBUKA: CATAT UJI MULAI SEBELUM KIRIM ──────────────────────
    // Ini yang memastikan hanya SATU percobaan uji yang lewat.
    if (k.keadaan === 'setengah_terbuka' || (k.tungguSampai > 0 && k.tungguSampai <= sekarang)) {
      const uji = catatUjiMulai(p.url, sekarang);

      // Tandai host-nya — pesan berikutnya ke host ini tidak boleh ikut uji.
      if (uji.ok) hostSudahDiuji.add(k.host);

      if (!uji.ok) {
        // Pekerja lain sudah mengambil percobaan ujinya.
        getDb().prepare('UPDATE sentinel_antrean SET jadwal_berikut = ? WHERE id = ?')
          .run(sekarang + 30_000, p.id);
        ringkas.dilewati++;
        ringkas.detail.push({ id: p.id, hasil: 'dilewati', alasan: 'uji_sedang_berjalan', host: k.host });
        continue;
      }
    }

    const hasil = await kirimSatu({ url: p.url, body: p.body, headers: bacaHeader(p.headers), timeoutMs, fetchImpl });

    const catatan = catatHasil(p.id, {
      sukses: hasil.sukses,
      kodeBalasan: hasil.kodeBalasan,
      pesanGalat: hasil.pesanGalat,
      latensiMs: hasil.latensiMs,
      sekarang,
    });

    // ── CATAT KE SIRKUIT ─────────────────────────────────────────────────────
    // Sirkuit dan antrean punya penghitungnya sendiri, dan keduanya perlu tahu
    // hasil percobaan ini.
    if (hasil.sukses) {
      catatSukses(p.url, { sekarang });
      ringkas.terkirim++;
      ringkas.detail.push({ id: p.id, hasil: 'terkirim', kode: hasil.kodeBalasan, latensiMs: hasil.latensiMs });
    } else {
      const s = catatGagal(p.url, { pesanGalat: hasil.pesanGalat, sekarang });
      ringkas.gagal++;
      if (catatan.status === 'dlq') ringkas.masukDlq++;
      ringkas.detail.push({
        id: p.id,
        hasil: catatan.status === 'dlq' ? 'dlq' : 'gagal',
        kode: hasil.kodeBalasan,
        galat: hasil.pesanGalat.slice(0, 120),
        sirkuit: s.keadaan,
      });
    }
  }

  return ringkas;
}

/**
 * Header disimpan sebagai JSON di database.
 *
 * ── KENAPA TIDAK DIPERCAYA BEGITU SAJA ───────────────────────────────────────
 * Isinya datang dari database, dan database bisa berisi apa saja — termasuk
 * baris dari versi lama yang formatnya berbeda, atau baris yang disunting
 * manual. JSON.parse yang melempar akan menghentikan seluruh putaran
 * pengiriman hanya karena satu baris rusak.
 *
 * Header yang tidak bisa dibaca dikembalikan kosong: pesannya tetap terkirim,
 * hanya tanpa header tambahan.
 */
function bacaHeader(teks) {
  try {
    const h = JSON.parse(teks || '{}');
    if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
    return h;
  } catch {
    return {};
  }
}

/* ── Kirim ulang manual ─────────────────────────────────────────────────── */

/**
 * Kembalikan pesan ke antrean untuk dicoba lagi — dari UI inspector.
 *
 * ── KENAPA INI PERLU ─────────────────────────────────────────────────────────
 * Pesan di DLQ menunggu diperiksa manusia. Setelah penyebabnya diperbaiki
 * (URL salah, endpoint diperbaiki), pesannya perlu dicoba lagi — dan menunggu
 * jadwal backoff berikutnya berarti menunggu sampai 6 jam.
 *
 * ── KENAPA SIRKUITNYA IKUT DITUTUP PAKSA ────────────────────────────────────
 * Kalau sirkuitnya masih terbuka, pengiriman ulang ini akan langsung dilewati
 * dan pesannya kembali menunggu. Orang yang menekan "kirim ulang" sudah
 * memperbaiki sesuatu — biarkan percobaannya benar-benar terjadi.
 */
export function kirimUlang(id, { sekarang = now(), tutupSirkuit = true } = {}) {
  const db = getDb();
  const baris = db.prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(id);
  if (!baris) return { ok: false, alasan: 'tidak_ditemukan' };

  if (baris.status === 'dikirim') {
    return { ok: false, alasan: 'sudah_terkirim' };
  }

  // Kembalikan ke antrean: status menunggu, jadwal sekarang, penghitung direset.
  db.prepare(`
    UPDATE sentinel_antrean
    SET status = 'menunggu', jadwal_berikut = ?, percobaan = 0,
        selesai_at = NULL, pesan_galat = ''
    WHERE id = ?
  `).run(sekarang, id);

  if (tutupSirkuit) {
    // Paksa tutup supaya percobaannya benar-benar terjadi.
    db.prepare(`
      UPDATE sentinel_sirkuit
      SET keadaan = 'tertutup', gagal_beruntun = 0, buka_sampai = 0
      WHERE host = ?
    `).run(hostDari(baris.url));
  }

  return { ok: true, id, host: hostDari(baris.url) };
}

/** Ambil satu pesan untuk ditampilkan di UI inspector. */
export function ambilPesan(id) {
  const baris = getDb().prepare('SELECT * FROM sentinel_antrean WHERE id = ?').get(id);
  if (!baris) return null;

  return {
    ...baris,
    headers: bacaHeader(baris.headers),
    host: hostDari(baris.url),
    // Berapa lama pesan ini sudah menunggu
    umurMs: now() - baris.diterima_at,
    // Percobaan berikutnya, kalau masih menunggu
    berikutnyaDalamMs: baris.status === 'menunggu' && baris.jadwal_berikut > now()
      ? baris.jadwal_berikut - now()
      : 0,
    maksPercobaan: JADWAL_BACKOFF_MS.length,
  };
}

/**
 * Daftar pesan terbaru untuk UI inspector.
 *
 * ── KENAPA BODY TIDAK DIKIRIM DI DAFTAR ─────────────────────────────────────
 * Body bisa sampai 256 KB, dan daftar berisi 50 pesan berarti 12 MB untuk satu
 * permintaan — cukup untuk membuat browser tersendat. Body diambil hanya saat
 * pesannya dibuka satu per satu.
 */
export function daftarPesan({ batas = 50, status = null, sumber = null, sekarang = now() } = {}) {
  const db = getDb();

  const syarat = [];
  const nilai = [];
  if (status) { syarat.push('status = ?'); nilai.push(status); }
  if (sumber) { syarat.push('sumber = ?'); nilai.push(sumber); }

  const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

  const baris = db.prepare(`
    SELECT id, sumber, id_peristiwa, url, status, percobaan,
           kode_balasan, pesan_galat, latensi_ms,
           diterima_at, terakhir_coba_at, selesai_at, jadwal_berikut,
           LENGTH(body) AS ukuran_body
    FROM sentinel_antrean
    ${where}
    ORDER BY diterima_at DESC
    LIMIT ?
  `).all(...nilai, batas);

  return baris.map((b) => ({
    ...b,
    host: hostDari(b.url),
    umurMs: sekarang - b.diterima_at,
    berikutnyaDalamMs: b.status === 'menunggu' && b.jadwal_berikut > sekarang
      ? b.jadwal_berikut - sekarang
      : 0,
  }));
}
