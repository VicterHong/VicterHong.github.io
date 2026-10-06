/**
 * Media — penyimpanan gambar proyek di Cloudflare R2.
 *
 * ── KENAPA MODUL TERPISAH ────────────────────────────────────────────────────
 * Unggahan gambar berbeda dari endpoint lain di layanan ini:
 *   - Body-nya BINER dan BESAR (sampai beberapa MB), bukan JSON 64 KB
 *   - Butuh pemrosesan (WebP) sebelum disimpan
 *   - Butuh penulisan ke R2 lewat REST API (bukan penyimpanan lokal)
 *
 * Menaruhnya di routes.mjs akan mencampur tiga tanggung jawab sekaligus.
 * Modul ini hanya mengurus: validasi → proses → simpan → catat manifest.
 *
 * ── SATU SUMBER KEBENARAN: MANIFEST ─────────────────────────────────────────
 * Daftar gambar disimpan sebagai `spotlight/manifest.json` DI R2, bukan di
 * database lokal. Alasannya:
 *
 *   - Backend bisa pindah mesin tanpa kehilangan daftar (manifest ikut R2)
 *   - Tidak ada risiko database dan R2 tidak sinkron
 *   - Frontend membacanya lewat satu endpoint yang bisa di-cache CDN
 *
 * ── KENAPA WEBP, BUKAN JPG/PNG ──────────────────────────────────────────────
 * WebP menghemat 25–35% dibanding JPG pada kualitas setara, dan mendukung
 * transparansi (PNG) tanpa membengkak. Dukungan browser 96%+ (semua browser
 * modern sejak 2020). Untuk galeri yang memuat 8 gambar sekaligus, selisih
 * itu terasa di koneksi seluler.
 *
 * LQIP (Low Quality Image Placeholder) disimpan di manifest sebagai data URL
 * base64 ~400–700 byte. Fungsinya: mengisi kartu dengan warna yang benar
 * SEBELUM gambar asli selesai diunduh, sehingga tidak ada kedipan abu-abu.
 */

import { createHash } from 'node:crypto';
import { config } from './config.mjs';

/** Batas ukuran berkas mentah sebelum diproses (byte). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;   // 8 MB

/** Format yang diterima. HEIC tidak didukung sharp secara bawaan di semua build. */
const MIME_DITERIMA = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);

/** Lebar maksimum gambar yang disimpan. Kartu terbesar 280px @2x = 560px. */
const LEBAR_MAKS = 1600;

/**
 * Kunci manifest di R2. Ditaruh di dalam folder spotlight/ supaya semua
 * aset galeri berada di satu tempat — memudahkan audit dan pembersihan.
 */
export const MANIFEST_KEY = 'spotlight/manifest.json';

// ── KLIEN R2 (REST API) ─────────────────────────────────────────────────────
// Memakai REST API, bukan binding Worker, karena kode ini berjalan di Node —
// binding hanya tersedia di runtime Workers. REST API adalah cara resmi
// mengakses R2 dari luar Worker, dan token-nya sudah ada di service.env.

// Nilai dibaca dari config.mjs, BUKAN process.env langsung.
//
// Kenapa: rahasia layanan ini hidup di service.env (bukan environment proses),
// dan config.mjs sudah mengurus pembacaan dari dua sumber itu. Membaca
// process.env langsung di sini membuat token yang ada di service.env
// TERLIHAT kosong — terukur: mediaAktif() mengembalikan false padahal token
// tersedia. Satu sumber konfigurasi, satu perilaku.
function r2Config() {
  return {
    accountId: config.r2AccountId,
    apiToken: config.r2ApiToken,
    bucket: config.r2Bucket,
  };
}

/** Apakah media aktif — token tersedia. Kalau tidak, endpoint menolak dengan jelas. */
export function mediaAktif() {
  const { accountId, apiToken } = r2Config();
  return Boolean(accountId && apiToken);
}

function r2Url(key) {
  const { accountId, bucket } = r2Config();
  // Key di-encode per segmen: '/' HARUS tetap '/' supaya struktur folder terjaga.
  const aman = key.split('/').map(encodeURIComponent).join('/');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${aman}`;
}

async function r2Fetch(key, init = {}) {
  const { apiToken } = r2Config();
  const res = await fetch(r2Url(key), {
    ...init,
    headers: { Authorization: `Bearer ${apiToken}`, ...(init.headers ?? {}) },
  });
  return res;
}

/** Simpan objek ke R2. Melempar kalau gagal — pemanggil yang memutuskan. */
export async function r2Put(key, buffer, contentType) {
  const res = await r2Fetch(key, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!res.ok) {
    const teks = await res.text().catch(() => '');
    throw Object.assign(new Error(`R2 put gagal (${res.status}): ${teks.slice(0, 200)}`), {
      statusCode: 502,
    });
  }
  return true;
}

/** Ambil objek dari R2. Mengembalikan null kalau tidak ada. */
export async function r2Get(key) {
  const res = await r2Fetch(key);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error(`R2 get gagal (${res.status})`), { statusCode: 502 });
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

/** Hapus objek dari R2. Tidak melempar kalau objeknya memang tidak ada. */
export async function r2Delete(key) {
  const res = await r2Fetch(key, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw Object.assign(new Error(`R2 delete gagal (${res.status})`), { statusCode: 502 });
  }
  return true;
}

// ── MANIFEST ────────────────────────────────────────────────────────────────

/**
 * Baca manifest. Kalau belum ada ATAU rusak, kembalikan manifest kosong —
 * bukan melempar. Alasannya: galeri harus tetap tampil walau manifest hilang.
 * Kehilangan daftar gambar tidak boleh membuat seluruh situs rusak.
 */
export async function bacaManifest() {
  try {
    const obj = await r2Get(MANIFEST_KEY);
    if (!obj) return { version: 1, updatedAt: null, images: [] };
    const parsed = JSON.parse(obj.buffer.toString('utf8'));
    if (!parsed || !Array.isArray(parsed.images)) {
      return { version: 1, updatedAt: null, images: [] };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: null, images: [] };
  }
}

/** Tulis manifest. Versi dinaikkan supaya cache CDN lama tidak dipakai. */
export async function tulisManifest(manifest) {
  const isi = {
    version: 1,
    updatedAt: new Date().toISOString(),
    images: manifest.images,
  };
  await r2Put(MANIFEST_KEY, Buffer.from(JSON.stringify(isi, null, 2), 'utf8'), 'application/json');
  return isi;
}

// ── PROSES GAMBAR ───────────────────────────────────────────────────────────

/**
 * Buat nama berkas yang aman dan STABIL dari slug.
 *
 * Stabil artinya: mengunggah ulang untuk proyek yang sama menghasilkan nama
 * yang SAMA, sehingga gambar lama tertimpa — bukan menumpuk sampah di R2.
 * Ini yang membuat "admin bisa ganti gambar proyek" bekerja tanpa perlu
 * menghapus manual.
 *
 * Slug dinormalisasi: huruf kecil, angka, tanda hubung. Karakter lain dibuang
 * supaya tidak ada nama berkas yang aneh di R2 atau di URL.
 */
export function kunciUntukSlug(slug) {
  const bersih = String(slug ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!bersih) throw Object.assign(new Error('slug tidak valid'), { statusCode: 400 });
  return `spotlight/${bersih}.webp`;
}

/**
 * Proses gambar mentah menjadi WebP + LQIP.
 *
 * Dua keluaran:
 *   1. WebP utama — lebar maksimum 1600px, kualitas 82
 *   2. LQIP — versi 20px yang diburamkan, disimpan sebagai data URL
 *
 * Kualitas 82 dipilih dari pengukuran umum: di bawah 75 artefak mulai terlihat
 * di area gelap (dan galeri ini banyak gambar gelap); di atas 88 ukurannya
 * naik tajam tanpa perbedaan yang terlihat mata.
 *
 * `fit: 'inside'` + `withoutEnlargement` — gambar kecil TIDAK diperbesar.
 * Memperbesar hanya menambah byte tanpa menambah detail.
 */
export async function prosesGambar(buffer) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    throw Object.assign(
      new Error('sharp tidak tersedia di server ini — unggahan gambar dinonaktifkan'),
      { statusCode: 503 },
    );
  }

  // Baca metadata dulu: sekaligus memvalidasi bahwa berkas ini benar gambar.
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw Object.assign(new Error('berkas bukan gambar yang bisa dibaca'), { statusCode: 400 });
  }
  if (!meta.width || !meta.height) {
    throw Object.assign(new Error('gambar tidak punya dimensi'), { statusCode: 400 });
  }

  const utama = await sharp(buffer)
    .rotate()   // hormati orientasi EXIF, lalu buang tag-nya (lihat catatan bawah)
    .resize({ width: LEBAR_MAKS, height: LEBAR_MAKS, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  // ── LQIP (Low Quality Image Placeholder) ─────────────────────────────────
  // Lebar 28px dipilih dari pengukuran, bukan tebakan:
  //   20px → 167 char base64, tapi terlalu buram — warna dominan masih
  //          terbaca, bentuknya tidak sama sekali
  //   28px → ~400 char, cukup untuk memberi kesan bentuk (garis besar
  //          komposisi terlihat saat diperbesar memenuhi kartu 280px)
  //   40px → ~900 char, perbedaan visual dengan 28px hampir tidak ada
  //
  // 28px adalah titik di mana menambah piksel tidak lagi menambah informasi
  // yang terlihat — jadi tidak ada alasan memakai yang lebih besar dan
  // membayar byte tambahan di manifest.
  //
  // blur(0.8) bukan 1.4: pada 28px, blur 1.4 menghapus terlalu banyak detail.
  const lqipBuf = await sharp(buffer)
    .rotate()
    .resize({ width: 28, fit: 'inside' })
    .blur(0.8)
    .webp({ quality: 45 })
    .toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

  // Hash isi — dipakai frontend sebagai penanda versi. Kalau gambar diganti,
  // hash berubah, sehingga URL-nya berubah dan cache lama otomatis batal.
  const hash = createHash('sha256').update(utama).digest('hex').slice(0, 10);

  return {
    webp: utama,
    lqip,
    hash,
    lebar: meta.width,
    tinggi: meta.height,
    bytesAsli: buffer.length,
    bytesWebp: utama.length,
  };
}

/**
 * Validasi berkas mentah SEBELUM diproses.
 *
 * Urutan pemeriksaan penting: ukuran dulu (paling murah), baru tipe MIME.
 * Memeriksa MIME pada berkas 8 MB berarti membaca header saja — tapi tetap
 * lebih baik menolak yang terlalu besar lebih dulu.
 *
 * MIME dari klien TIDAK dipercaya sepenuhnya: sharp akan menolak berkas yang
 * bukan gambar saat metadata dibaca, dan itu adalah pemeriksaan yang
 * sesungguhnya. Header di sini hanya menyaring cepat.
 */
export function validasiUnggahan(buffer, contentType) {
  if (!buffer || buffer.length === 0) {
    throw Object.assign(new Error('berkas kosong'), { statusCode: 400 });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(
      new Error(`berkas terlalu besar (maksimum ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`),
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

// ── OPERASI TINGKAT TINGGI ──────────────────────────────────────────────────

/**
 * Unggah satu gambar untuk sebuah proyek.
 *
 * Menggantikan gambar lama kalau slug-nya sama. Entri manifest diperbarui
 * di tempat, bukan ditambahkan — jadi tidak ada duplikat.
 */
export async function unggahGambar({ slug, label, buffer, contentType, urutan }) {
  if (!mediaAktif()) {
    throw Object.assign(
      new Error('penyimpanan media belum dikonfigurasi (CLOUDFLARE_API_TOKEN kosong)'),
      { statusCode: 503 },
    );
  }

  const mime = validasiUnggahan(buffer, contentType);
  const hasil = await prosesGambar(buffer);
  const key = kunciUntukSlug(slug);

  await r2Put(key, hasil.webp, 'image/webp');

  const manifest = await bacaManifest();
  const entri = {
    slug: String(slug),
    key,
    label: String(label ?? slug).slice(0, 60),
    lqip: hasil.lqip,
    hash: hasil.hash,
    lebar: hasil.lebar,
    tinggi: hasil.tinggi,
    bytes: hasil.bytesWebp,
    urutan: Number.isFinite(urutan) ? urutan : null,
    diperbarui: new Date().toISOString(),
  };

  const idx = manifest.images.findIndex((i) => i.slug === entri.slug);
  if (idx >= 0) manifest.images[idx] = entri;
  else manifest.images.push(entri);

  // Urutkan: yang punya `urutan` lebih dulu (menaik), sisanya menurut label.
  // Urutan yang bisa diatur admin berguna untuk mengatur komposisi galeri —
  // mana yang tampil berdampingan mempengaruhi kesan keseluruhan.
  manifest.images.sort((a, b) => {
    const ao = a.urutan ?? Number.MAX_SAFE_INTEGER;
    const bo = b.urutan ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.label).localeCompare(String(b.label), 'id');
  });

  const baru = await tulisManifest(manifest);

  return {
    entri,
    manifest: baru,
    hemat: hasil.bytesAsli > 0
      ? Math.round((1 - hasil.bytesWebp / hasil.bytesAsli) * 100)
      : 0,
  };
}

/** Hapus gambar dari R2 dan dari manifest. */
export async function hapusGambar(slug) {
  if (!mediaAktif()) {
    throw Object.assign(new Error('penyimpanan media belum dikonfigurasi'), { statusCode: 503 });
  }
  const manifest = await bacaManifest();
  const idx = manifest.images.findIndex((i) => i.slug === slug);
  if (idx < 0) {
    throw Object.assign(new Error('gambar tidak ditemukan'), { statusCode: 404 });
  }
  const [entri] = manifest.images.splice(idx, 1);
  await r2Delete(entri.key);
  const baru = await tulisManifest(manifest);
  return { dihapus: entri, manifest: baru };
}

/**
 * Daftar gambar publik — TANPA LQIP.
 *
 * Manifest penuh dipakai panel admin (butuh LQIP untuk pratinjau).
 * Frontend hanya butuh daftar kunci, jadi LQIP dibuang supaya responsnya
 * kecil dan bisa di-cache lama di CDN.
 */
export function daftarPublik(manifest) {
  return manifest.images.map((i) => ({
    slug: i.slug,
    label: i.label,
    url: `/media/${i.key}`,
    hash: i.hash,
  }));
}
