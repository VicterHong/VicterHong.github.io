/**
 * Avatar pengguna — foto profil yang diunggah ke Cloudflare R2.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * HUBUNGANNYA DENGAN AVATAR OTOMATIS
 * ══════════════════════════════════════════════════════════════════════════
 * Sampai sekarang avatar dibuat DI EDGE dari inisial nama (workers/site.ts).
 * Itu bekerja baik dan tetap menjadi CADANGAN: pengguna yang tidak mengunggah
 * foto tetap mendapat avatar berinisial yang stabil, tanpa satu byte pun
 * disimpan.
 *
 * Modul ini menambahkan jalur kedua: foto yang benar-benar diunggah pengguna.
 * Dua jalur itu hidup berdampingan, dan urutan yang dipakai halaman:
 *
 *      foto unggahan  →  avatar OAuth (Google/GitHub)  →  inisial otomatis
 *
 * Alasannya: foto yang dipilih sendiri adalah yang paling mewakili
 * penggunanya. Kalau belum ada, foto dari penyedia identitas lebih baik
 * daripada inisial. Kalau keduanya tidak ada, inisial selalu tersedia.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SATU BERKAS PER PENGGUNA, BUKAN BANYAK VERSI
 * ══════════════════════════════════════════════════════════════════════════
 * Avatar hanya pernah dipakai dalam ukuran kecil (32–128px di halaman).
 * Menyimpan beberapa rendition berarti: beberapa unggahan, beberapa kunci,
 * dan beberapa tempat yang harus dibersihkan saat pengguna mengganti foto.
 *
 * Satu berkas 512×512 WebP cukup untuk SEMUA kebutuhan itu — 512px masih
 * tajam di layar 2x untuk avatar 256px, dan ukurannya ~30–60 KB. Kalau nanti
 * butuh ukuran lain, Cloudflare Images bisa menurunkannya dari berkas ini.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA KUNCI MEMAKAI ID PENGGUNA, BUKAN NAMA ATAU EMAIL
 * ══════════════════════════════════════════════════════════════════════════
 *   • Nama bisa diubah → mengganti nama berarti foto "hilang" (kunci lama
 *     tidak lagi dicari, dan berkasnya jadi sampah di R2).
 *   • Email adalah data pribadi; menaruhnya di kunci berarti ia muncul di
 *     setiap URL gambar dan di log akses Cloudflare.
 *   • ID pengguna tidak pernah berubah dan tidak berarti apa-apa kalau bocor.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA ADA HASH DI NAMA BERKAS
 * ══════════════════════════════════════════════════════════════════════════
 * Kunci berbentuk `avatar/<id>-<hash>.webp`. Hash berasal dari ISI gambar.
 *
 * Tanpa hash, mengganti foto berarti URL-nya tetap sama — dan browser,
 * CDN, serta cache perantara akan terus menyajikan foto LAMA sampai
 * masa berlakunya habis. Itu keluhan yang sulit didiagnosis pengguna
 * ("saya sudah ganti tapi masih yang lama").
 *
 * Dengan hash, mengganti foto menghasilkan URL BARU, jadi cache lama tidak
 * pernah salah saji. Berkas lama dihapus di operasi yang sama, jadi tidak
 * ada penumpukan.
 */

import { createHash } from 'node:crypto';
import { config } from './config.mjs';
import { r2Put, r2Get, r2Delete, mediaAktif } from './media.mjs';

/** Batas ukuran berkas mentah (byte). Lebih kecil dari galeri: ini foto profil. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;   // 4 MB

/** Sisi gambar yang disimpan (persegi). 512px cukup untuk semua pemakaian. */
const SISI = 512;

/** Format yang diterima. Sama dengan galeri — dan HEIC tetap dikecualikan. */
const MIME_DITERIMA = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

/**
 * Ukuran minimum sisi pendek (piksel).
 *
 * ── KENAPA ADA BATAS BAWAH, PADAHAL BATAS ATAS SUDAH ADA ──────────────────
 * Foto 64×64 yang diperbesar ke 512px akan terlihat buram dan pecah. Lebih
 * baik ditolak dengan pesan yang jelas daripada diterima lalu membuat
 * halaman profil terlihat tidak profesional — dan pengguna tidak akan tahu
 * kenapa fotonya jelek.
 *
 * 200px dipilih sebagai titik di mana memperbesar ke 512px masih dapat
 * diterima (faktor 2.5×); di bawah itu, hasilnya terlihat rusak.
 */
const SISI_MIN = 200;

/** Apakah penyimpanan avatar aktif. */
export function avatarAktif() {
  return mediaAktif();
}

/** Kunci avatar untuk seorang pengguna. */
export function kunciAvatar(userId, hash) {
  const id = String(userId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!id) throw Object.assign(new Error('id pengguna tidak valid'), { statusCode: 400 });
  return `avatar/${id}-${hash}.webp`;
}

/**
 * Proses foto mentah menjadi avatar persegi.
 *
 * ── KENAPA DIPOTONG PERSEGI DI SERVER, BUKAN DIKIRIM APA ADANYA ───────────
 * Halaman menampilkan avatar dalam lingkaran. Kalau berkasnya tidak persegi,
 * CSS `object-fit: cover` akan memotongnya — tapi potongan itu berbeda di
 * setiap tempat avatar muncul (header 32px, panel profil 64px), dan hasilnya
 * bisa memotong bagian penting (wajah) secara berbeda-beda.
 *
 * Memotong sekali di server berarti: satu hasil, konsisten di semua tempat.
 *
 * `position: 'attention'` (bukan `'center'`) memakai deteksi saliency sharp
 * untuk memilih area yang paling "menarik" — pada foto orang, itu biasanya
 * wajah. Memotong dari tengah akan memenggal dahi pada foto portrait.
 */
export async function prosesAvatar(buffer) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    throw Object.assign(
      new Error('sharp tidak tersedia di server ini — unggahan foto dinonaktifkan'),
      { statusCode: 503 },
    );
  }

  // Metadata dulu: sekaligus membuktikan berkas ini benar-benar gambar.
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw Object.assign(new Error('berkas bukan gambar yang bisa dibaca'), { statusCode: 400 });
  }
  if (!meta.width || !meta.height) {
    throw Object.assign(new Error('gambar tidak punya dimensi'), { statusCode: 400 });
  }

  // ── PERIKSA UKURAN SETELAH ORIENTASI EXIF ────────────────────────────────
  // Foto ponsel sering tersimpan "miring" dengan tag EXIF yang membalikkannya.
  // `rotate()` tanpa argumen menerapkan orientasi itu. Tanpa langkah ini, foto
  // portrait 4000×3000 bisa terbaca sebagai 3000×4000 dan — lebih buruk —
  // hasil potongannya ikut miring.
  const dinormalisasi = sharp(buffer).rotate();
  const metaNormal = await dinormalisasi.metadata();
  const pendek = Math.min(metaNormal.width ?? 0, metaNormal.height ?? 0);
  if (pendek < SISI_MIN) {
    throw Object.assign(
      new Error(`foto terlalu kecil — sisi terpendek minimal ${SISI_MIN}px (foto Anda ${pendek}px)`),
      { statusCode: 400 },
    );
  }

  const hasil = await sharp(buffer)
    .rotate()
    .resize({ width: SISI, height: SISI, fit: 'cover', position: 'attention' })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();

  const hash = createHash('sha256').update(hasil).digest('hex').slice(0, 10);

  return {
    webp: hasil,
    hash,
    lebar: SISI,
    tinggi: SISI,
    bytesAsli: buffer.length,
    bytesWebp: hasil.length,
  };
}

/**
 * Validasi berkas mentah SEBELUM diproses.
 *
 * Urutan: ukuran dulu (paling murah untuk ditolak), lalu MIME. MIME dari
 * klien tidak dipercaya penuh — sharp yang memutuskan saat membaca metadata.
 */
export function validasiAvatar(buffer, contentType) {
  if (!buffer || buffer.length === 0) {
    throw Object.assign(new Error('berkas kosong'), { statusCode: 400 });
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw Object.assign(
      new Error(`foto terlalu besar (maksimum ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB)`),
      { statusCode: 413 },
    );
  }
  const mime = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!MIME_DITERIMA.has(mime)) {
    throw Object.assign(
      new Error('format tidak didukung — pakai JPG, PNG, WebP, atau AVIF'),
      { statusCode: 415 },
    );
  }
  return mime;
}

/**
 * Simpan avatar pengguna, hapus yang lama.
 *
 * ── KENAPA HAPUS SESUDAH SIMPAN, BUKAN SEBELUM ─────────────────────────────
 * Kalau penghapusan dilakukan lebih dulu lalu penyimpanan gagal, pengguna
 * kehilangan fotonya DAN tidak mendapat yang baru — hasilnya avatar kosong.
 *
 * Dengan urutan ini, kegagalan menyimpan meninggalkan foto lama tetap utuh.
 * Risiko sisanya: kalau penghapusan yang gagal, tersisa satu berkas yatim.
 * Itu jauh lebih ringan — dan bisa dibersihkan kapan saja dengan membandingkan
 * isi folder `avatar/` terhadap kolom `avatar_key` di database.
 *
 * @param {object} args
 * @param {string} args.userId   ID pengguna (dari sesi, bukan dari klien)
 * @param {string} args.kunciLama Kunci avatar sebelumnya, kalau ada
 * @param {Buffer} args.buffer   Berkas mentah
 * @param {string} args.contentType Content-Type dari header
 */
export async function simpanAvatar({ userId, kunciLama, buffer, contentType }) {
  if (!avatarAktif()) {
    throw Object.assign(
      new Error('penyimpanan foto belum dikonfigurasi'),
      { statusCode: 503 },
    );
  }

  validasiAvatar(buffer, contentType);
  const hasil = await prosesAvatar(buffer);

  const kunci = kunciAvatar(userId, hasil.hash);

  // Kalau isinya sama persis, kuncinya sama — tidak perlu menulis ulang.
  if (kunciLama && kunciLama === kunci) {
    return { kunci, hasil, tidakBerubah: true };
  }

  await r2Put(kunci, hasil.webp, 'image/webp');

  // Hapus berkas lama SETELAH yang baru tersimpan. Kegagalan di sini tidak
  // membatalkan operasi — fotonya sudah aman, yang tersisa hanya berkas yatim.
  if (kunciLama && kunciLama !== kunci) {
    try {
      await r2Delete(kunciLama);
    } catch {
      // Sengaja senyap: foto baru sudah tersimpan, dan gagal menghapus berkas
      // lama bukan alasan memberi tahu pengguna bahwa unggahannya gagal.
    }
  }

  return {
    kunci,
    hasil,
    hemat: hasil.bytesAsli > 0
      ? Math.round((1 - hasil.bytesWebp / hasil.bytesAsli) * 100)
      : 0,
  };
}

/** Hapus avatar pengguna dari R2. */
export async function hapusAvatar(kunci) {
  if (!kunci) return { dihapus: false };
  if (!avatarAktif()) {
    throw Object.assign(new Error('penyimpanan foto belum dikonfigurasi'), { statusCode: 503 });
  }
  await r2Delete(kunci);
  return { dihapus: true };
}

/**
 * Ambil berkas avatar dari R2.
 *
 * Dipakai endpoint publik `/api/avatar/<kunci>` — halaman memuatnya lewat
 * Worker yang sama dengan sisa situs, bukan URL R2 langsung.
 */
export async function ambilAvatar(kunci) {
  if (!kunci) return null;
  // Tolak percobaan keluar dari folder avatar/ — sama seperti /media.
  if (kunci.includes('..') || kunci.startsWith('/')) return null;
  return r2Get(kunci);
}
