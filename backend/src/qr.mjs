/**
 * Generator QR code untuk enrollment 2FA.
 *
 * ── KENAPA PAKAI `qrencode` (BINARY), BUKAN LIBRARY ─────────────────────────
 * Backend ini punya NOL dependensi. Menambahkan library QR (mis. `qrcode`)
 * berarti menambah puluhan paket transitive yang harus dipercaya dan
 * diperbarui selamanya — untuk fitur yang hanya menghasilkan satu gambar.
 *
 * `qrencode` sudah ada di sistem (diverifikasi: versi 4.1.1) dan menghasilkan
 * QR yang bisa dibaca semua aplikasi authenticator. Kalau binary tidak ada,
 * modul ini GAGAL DENGAN JELAS — dan endpoint enrollment mengembalikan
 * pesan yang bisa ditindaklanjuti, bukan QR kosong.
 *
 * ── KENAPA PNG, BUKAN SVG ───────────────────────────────────────────────────
 * Diukur untuk URI otpauth khas:
 *   SVG      → 63.879 byte  (base64: 85 KB) — terlalu besar untuk balasan JSON
 *   PNG -s 4 →    647 byte  (base64: 864 B)
 *   PNG -s 8 →    711 byte  (base64: 948 B)  ← dipilih
 *   PNG -s 10→  1.040 byte  (base64: 1,4 KB)
 *
 * -s 8 berarti 8 piksel per modul → 424×424 px. Cukup tajam untuk dipindai
 * dari layar, tapi tetap di bawah 1 KB.
 *
 * ── KENAPA BASE64, BUKAN FILE ───────────────────────────────────────────────
 * QR dikirim inline sebagai data URL. Tidak ada berkas yang ditulis ke disk,
 * tidak ada URL publik yang bisa ditebak, dan tidak ada pembersihan yang
 * perlu dijadwalkan. Secret TOTP hanya ada di memori selama satu permintaan.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Ukuran modul dalam piksel. 8 dipilih dari pengukuran (lihat catatan di atas).
const SKALA = 8;

// Batas waktu. qrencode untuk URI pendek selesai dalam <50ms; 5 detik adalah
// batas yang sangat longgar — kalau terlampaui, ada yang salah dengan sistem.
const TIMEOUT_MS = 5000;

/**
 * Hasilkan QR code sebagai data URL PNG.
 *
 * @param {string} isi - teks yang di-encode (biasanya URI otpauth://)
 * @returns {Promise<{ok: true, dataUrl: string, byte: number} | {ok: false, alasan: string, pesan: string}>}
 */
export async function buatQrDataUrl(isi) {
  const teks = String(isi ?? '').trim();
  if (!teks) {
    return { ok: false, alasan: 'isi_kosong', pesan: 'Tidak ada yang bisa di-encode.' };
  }

  // Batas panjang: QR versi 40 (terbesar) menampung ~2.953 byte pada
  // koreksi error rendah. URI otpauth khas ~150 byte. Batas 1.200 byte
  // memberi ruang lega tanpa membiarkan input liar menghabiskan CPU.
  if (teks.length > 1200) {
    return {
      ok: false,
      alasan: 'isi_terlalu_panjang',
      pesan: `URI terlalu panjang (${teks.length} karakter, maks 1200).`,
    };
  }

  try {
    // Tulis ke stdout (`-o -`) — tidak ada berkas sementara yang perlu
    // dibersihkan, dan tidak ada nama berkas yang bisa bentrok saat
    // beberapa permintaan datang bersamaan.
    const { stdout } = await execFileAsync(
      'qrencode',
      ['-t', 'PNG', '-s', String(SKALA), '-o', '-', teks],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,   // 1 MB — jauh di atas kebutuhan (~1 KB)
        encoding: 'buffer',       // PNG itu biner; jangan decode sebagai teks
      },
    );

    if (!stdout || stdout.length === 0) {
      return { ok: false, alasan: 'qr_kosong', pesan: 'qrencode tidak menghasilkan gambar.' };
    }

    return {
      ok: true,
      dataUrl: `data:image/png;base64,${stdout.toString('base64')}`,
      byte: stdout.length,
    };
  } catch (err) {
    // Bedakan "binary tidak ada" dari kegagalan lain — pesannya berbeda
    // untuk admin (yang bisa memperbaiki) vs pengguna (yang tidak bisa).
    if (err?.code === 'ENOENT') {
      return {
        ok: false,
        alasan: 'qrencode_tidak_ada',
        pesan: 'Generator QR tidak terpasang di server. Hubungi admin.',
      };
    }
    if (err?.killed || err?.signal) {
      return {
        ok: false,
        alasan: 'qr_timeout',
        pesan: 'Pembuatan QR terlalu lama. Coba lagi.',
      };
    }
    return {
      ok: false,
      alasan: 'qr_gagal',
      pesan: 'Gagal membuat QR code.',
    };
  }
}

/**
 * Cek apakah generator QR tersedia.
 *
 * Dipakai saat startup untuk memberi peringatan lebih awal — lebih baik
 * tahu saat boot daripada saat klien pertama mencoba mendaftar 2FA.
 */
export async function qrTersedia() {
  try {
    await execFileAsync('qrencode', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
