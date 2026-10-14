/**
 * SENTINEL — RUTE API UNTUK INSPECTOR
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * SEMUA RUTE DI SINI DIKUNCI ADMIN_KEY
 * ══════════════════════════════════════════════════════════════════════════════
 * Isi inspector bukan data publik:
 *
 *   · BODY webhook — bisa memuat data pembayaran, email pelanggan, ID pesanan
 *   · URL tujuan — membuka struktur layanan internal
 *   · Pesan galat — bisa memuat potongan balasan dari server internal
 *   · Tombol KIRIM ULANG — bisa memicu pengiriman ke layanan luar
 *
 * Satu rute yang lupa dikunci berarti semua itu terbuka. Karena itu penguncian
 * dilakukan lewat PEMBUNGKUS (`kunciAdmin`), bukan diperiksa di tiap handler —
 * dengan begitu tidak ada rute yang bisa lupa.
 *
 * ── KENAPA PEMBUNGKUS, BUKAN PEMERIKSAAN DI TIAP HANDLER ─────────────────────
 * Pola "periksa kunci di awal setiap handler" punya satu cara gagal yang sudah
 * terbukti: satu handler baru ditambahkan tanpa pemeriksaan. Tidak ada yang
 * error, tidak ada tes yang gagal — rutenya cuma terbuka.
 *
 * Dengan pembungkus, rute yang tidak dibungkus TIDAK BISA terdaftar: daftar
 * rutenya dibangun dengan `.map(kunciAdmin)`, jadi semua rute lewat situ.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA INSPECTOR INI HALAMAN TERPISAH, BUKAN BAGIAN HALAMAN LAIN
 * ══════════════════════════════════════════════════════════════════════════════
 * Halaman lain di situs ini adalah halaman PUBLIK — di-cache CDN, dibuka
 * pengunjung biasa, dan ikut terindeks mesin pencari.
 *
 * Inspector ini memuat body webhook dan tombol kirim ulang. Menaruhnya di
 * halaman publik berarti:
 *   · Isinya bisa ikut ter-cache dan terlihat orang lain
 *   · Ukuran halaman publik bertambah untuk fitur yang 99% pengunjung tidak
 *     pakai
 *
 * Jadi ia berdiri sendiri, di /sentinel, dan hanya berguna dengan kunci admin.
 */

import { sendJson } from '../http-util.mjs';
import { config } from '../config.mjs';
import { bandingAman } from './tanda-tangan.mjs';
import {
  statistikAntrean,
  bersihkanSelesai,
} from './antrean.mjs';
import {
  daftarSirkuit,
  tutupPaksa,
  AMBANG_GAGAL,
  JENDELA_TUNGGU_MS,
} from './sirkuit.mjs';
// ── KENAPA FUNGSI-FUNGSI INI DARI pengirim.mjs, BUKAN antrean.mjs ──────────
// `antrean.mjs` menyimpan dan mengubah baris; `pengirim.mjs` yang menyajikannya
// untuk UI. Yang membedakan: penyajian menambahkan host, umur pesan, dan sisa
// waktu tunggu — nilai yang DIHITUNG, bukan kolom database.
//
// Saya sempat mengimpor `ambilPesan` dan `daftarPesan` dari antrean.mjs, dan
// seluruh server gagal dimuat. Kesalahannya ketahuan karena modulnya benar-
// benar dimuat saat tes, bukan hanya diperiksa sintaksnya.
import {
  ambilPesan as detailPesan,
  daftarPesan as daftarAntrean,
  kirimUlang,
  jalankanPutaran,
  TIMEOUT_MS,
} from './pengirim.mjs';
import { PROVIDER, TOLERANSI_DETIK } from './tanda-tangan.mjs';
import { terimaWebhook, daftarSumber } from './gerbang.mjs';
import { readBody } from '../http-util.mjs';
import { ringkasMode, setMode } from './mode.mjs';

/* ── Penguncian ─────────────────────────────────────────────────────────── */

/**
 * Bungkus handler dengan pemeriksaan kunci admin.
 *
 * ── KENAPA `bandingAman`, BUKAN `===` ────────────────────────────────────────
 * Perbandingan `===` pada kunci berhenti di karakter pertama yang berbeda.
 * Waktu eksekusinya membocorkan berapa banyak karakter awal yang sudah benar —
 * dan dengan cukup banyak percobaan, kuncinya bisa direka.
 *
 * Fungsi yang sama yang dipakai membandingkan tanda tangan webhook.
 */
export function kunciAdmin(rute) {
  return {
    ...rute,
    handler: async (req, res, params, url, ...sisa) => {
      const dikirim = req.headers['x-admin-key'];

      if (!config.adminKey) {
        // Kunci belum dikonfigurasi → TOLAK SEMUA. Membiarkan lewat berarti
        // inspector terbuka untuk siapa pun yang tahu URL-nya.
        return sendJson(res, 503, {
          ok: false,
          error: 'admin_belum_dikonfigurasi',
          message: 'ADMIN_KEY belum diset di server.',
        });
      }

      if (!dikirim || !bandingAman(config.adminKey, dikirim)) {
        return sendJson(res, 401, {
          ok: false,
          error: 'kunci_admin_salah',
          message: 'Header x-admin-key tidak ada atau tidak cocok.',
        });
      }

      return rute.handler(req, res, params, url, ...sisa);
    },
  };
}

/* ── Baca body ──────────────────────────────────────────────────────────── */

async function bacaJson(req) {
  try {
    const bagian = [];
    for await (const potongan of req) bagian.push(potongan);
    const teks = Buffer.concat(bagian).toString('utf8');
    return teks ? JSON.parse(teks) : {};
  } catch {
    return null;
  }
}

/* ── Rute ───────────────────────────────────────────────────────────────── */

/**
 * Semua rute inspector.
 *
 * Dikembalikan sebagai array yang SUDAH dibungkus — pemanggilnya tidak bisa
 * lupa mengunci satu pun.
 */
export function ruteSentinel() {
  const rute = [
    /* ── Ringkasan: angka-angka untuk kartu di atas halaman ─────────────── */
    {
      method: 'GET',
      pattern: '/api/sentinel/ringkasan',
      handler: async (req, res) => {
        const stat = statistikAntrean();
        const sirkuit = daftarSirkuit();

        return sendJson(res, 200, {
          ok: true,
          antrean: stat,
          sirkuit: {
            total: sirkuit.length,
            terbuka: sirkuit.filter((s) => s.keadaan === 'terbuka').length,
            setengah: sirkuit.filter((s) => s.keadaan === 'setengah_terbuka').length,
            daftar: sirkuit.slice(0, 10),
          },
          konfigurasi: {
            ambangGagal: AMBANG_GAGAL,
            timeoutMs: TIMEOUT_MS,
            jendelaTunggu: JENDELA_TUNGGU_MS,
            toleransiTandaTanganDetik: TOLERANSI_DETIK,
          },
        });
      },
    },

    /* ── Daftar pesan ──────────────────────────────────────────────────── */
    {
      method: 'GET',
      pattern: '/api/sentinel/pesan',
      handler: async (req, res, _params, url) => {
        const batas = Math.min(Number(url.searchParams.get('batas')) || 50, 200);
        const status = url.searchParams.get('status') || null;
        const sumber = url.searchParams.get('sumber') || null;

        return sendJson(res, 200, {
          ok: true,
          pesan: daftarAntrean({ batas, status, sumber }),
          provider: Object.entries(PROVIDER).map(([id, p]) => ({ id, ...p })),
        });
      },
    },

    /* ── Detail satu pesan — TERMASUK BODY ─────────────────────────────── */
    {
      method: 'GET',
      pattern: '/api/sentinel/pesan/:pesanId',
      handler: async (req, res, params) => {
        const p = detailPesan(params.pesanId);
        if (!p) {
          return sendJson(res, 404, { ok: false, error: 'tidak_ditemukan' });
        }

        // ── BODY DIKIRIM DI SINI, BUKAN DI DAFTAR ───────────────────────────
        // Body bisa sampai 256 KB. Daftar berisi 50 pesan berarti 12 MB untuk
        // satu permintaan — cukup untuk membuat browser tersendat.
        return sendJson(res, 200, { ok: true, pesan: p });
      },
    },

    /* ── Kirim ulang satu pesan ────────────────────────────────────────── */
    {
      method: 'POST',
      pattern: '/api/sentinel/pesan/:pesanId/kirim-ulang',
      handler: async (req, res, params) => {
        const hasil = kirimUlang(params.pesanId);

        if (!hasil.ok) {
          const kode = hasil.alasan === 'tidak_ditemukan' ? 404 : 409;
          return sendJson(res, kode, { ok: false, error: hasil.alasan });
        }

        // ── DIJALANKAN SEKARANG, TIDAK MENUNGGU PENJADWAL ───────────────────
        // Orang yang menekan tombol ini ingin tahu hasilnya SEKARANG. Kalau
        // hanya dijadwalkan, dia harus menunggu sampai 10 detik untuk tahu
        // apakah perbaikannya berhasil — dan itu terasa seperti tombolnya
        // tidak bekerja.
        const putaran = await jalankanPutaran({ batas: 1 });

        return sendJson(res, 200, {
          ok: true,
          host: hasil.host,
          hasil: putaran.detail[0] ?? { hasil: 'tidak_diproses' },
        });
      },
    },

    /* ── Tutup paksa sirkuit ───────────────────────────────────────────── */
    {
      method: 'POST',
      pattern: '/api/sentinel/sirkuit/tutup',
      handler: async (req, res) => {
        const body = await bacaJson(req);
        if (body === null) return sendJson(res, 400, { ok: false, error: 'body_tidak_valid' });

        const host = String(body.host ?? '').trim();
        if (!host) return sendJson(res, 400, { ok: false, error: 'host_kosong' });

        // `tutupPaksa` menerima URL atau host. Host saja tidak punya skema,
        // jadi dibungkus supaya `hostDari` bisa mem-parse-nya.
        const hasil = tutupPaksa(host.includes('://') ? host : `https://${host}`);

        return sendJson(res, 200, { ok: true, host: hasil.host, keadaan: hasil.keadaan });
      },
    },

    /* ── Bersihkan pesan yang sudah selesai ────────────────────────────── */
    {
      method: 'POST',
      pattern: '/api/sentinel/bersihkan',
      handler: async (req, res) => {
        const body = await bacaJson(req);
        if (body === null) return sendJson(res, 400, { ok: false, error: 'body_tidak_valid' });

        // ── BATAS MINIMAL 1 JAM ─────────────────────────────────────────────
        // Tanpa batas, permintaan dengan `hari: 0` akan menghapus SEMUA riwayat
        // pengiriman — termasuk yang baru saja berhasil dan sedang diperiksa
        // orang. Batas ini mencegah kesalahan yang tidak bisa dibatalkan.
        const hari = Math.max(Number(body.hari) || 7, 1 / 24);

        const hasil = bersihkanSelesai({ lebihTuaDariMs: hari * 24 * 60 * 60 * 1000 });

        return sendJson(res, 200, {
          ok: true,
          dihapus: hasil.dihapus,
          // Disebut supaya jelas apa yang TIDAK dihapus.
          catatan: 'Pesan DLQ tidak dihapus — itu bukti ada yang salah.',
        });
      },
    },

    /* ── Kirim sekarang: jalankan satu putaran tanpa menunggu penjadwal ── */
    {
      method: 'POST',
      pattern: '/api/sentinel/kirim-sekarang',
      handler: async (req, res) => {
        const body = await bacaJson(req);
        if (body === null) return sendJson(res, 400, { ok: false, error: 'body_tidak_valid' });

        // Batas 50: cukup untuk membersihkan tumpukan, tidak cukup untuk
        // membuat satu permintaan HTTP berjalan sampai timeout.
        const batas = Math.min(Math.max(Number(body.batas) || 20, 1), 50);

        const ringkas = await jalankanPutaran({ batas });
        return sendJson(res, 200, { ok: true, ...ringkas });
      },
    },

    /* ── Mode keamanan: lihat & ubah ────────────────────────────────────── */
    {
      method: 'GET',
      pattern: '/api/sentinel/mode',
      handler: async (req, res) => {
        return sendJson(res, 200, { ok: true, ...ringkasMode() });
      },
    },

    {
      method: 'POST',
      pattern: '/api/sentinel/mode',
      handler: async (req, res) => {
        const body = await bacaJson(req);
        if (body === null) return sendJson(res, 400, { ok: false, error: 'body_tidak_valid' });

        const modeBaru = String(body.mode ?? '').trim();
        const hasil = setMode(modeBaru);

        if (!hasil.ok) {
          return sendJson(res, 400, {
            ok: false,
            error: hasil.alasan,
            message: 'Mode tidak dikenal. Pilihan: normal, pro.',
          });
        }

        // ── RINGKASAN DIKEMBALIKAN, BUKAN HANYA "OK" ────────────────────────
        // Yang menekan tombol ini ingin tahu APA YANG BERUBAH. Mengembalikan
        // ringkasannya berarti UI bisa langsung menampilkan nilai barunya
        // tanpa permintaan kedua.
        return sendJson(res, 200, { ok: true, ...ringkasMode() });
      },
    },

    /* ── Daftar sumber: mana yang siap menerima webhook ─────────────────── */
    {
      method: 'GET',
      pattern: '/api/sentinel/sumber',
      handler: async (req, res) => {
        return sendJson(res, 200, {
          ok: true,
          sumber: daftarSumber(),
          tujuan: config.sentinelTujuanUrl || null,
          intervalMs: config.sentinelIntervalMs,
        });
      },
    },
  ];

  // ── SEMUA RUTE DIKUNCI DI SINI ─────────────────────────────────────────────
  // Bukan di tiap handler. Satu tempat, tidak ada yang bisa lupa.
  return rute.map(kunciAdmin);
}
