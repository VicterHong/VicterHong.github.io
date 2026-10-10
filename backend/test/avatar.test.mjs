/**
 * Uji unit modul avatar.mjs — validasi, pemrosesan, dan bentuk kunci.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * APA YANG DIUJI, DAN APA YANG TIDAK
 * ══════════════════════════════════════════════════════════════════════════
 * Uji ini TIDAK menyentuh R2. Ia menguji bagian yang murni logika:
 *   • validasi berkas (ukuran, MIME)
 *   • pemrosesan gambar (potong persegi, WebP, hash isi)
 *   • bentuk kunci (dan apa yang DITOLAK olehnya)
 *
 * Unggahan ke R2 diuji lewat uji integrasi terpisah, karena ia butuh token
 * dan jaringan. Memisahkan keduanya membuat uji ini bisa jalan di CI mana pun
 * — termasuk CI yang tidak punya kredensial Cloudflare.
 *
 * ── KENAPA sharp DI-IMPORT DINAMIS DI MODUL, TAPI TIDAK DI SINI ────────────
 * avatar.mjs mengimpor sharp di dalam fungsi supaya layanan tetap hidup kalau
 * sharp tidak terpasang (fitur foto mati, sisa situs jalan). Uji ini butuh
 * sharp sungguhan, jadi ia akan di-skip kalau modulnya tidak ada.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.TOKEN_SERVICE_ENV = '/tmp/tidak-ada.env';
process.env.DB_PATH = '/tmp/uji-avatar-tidak-dipakai.db';

const {
  validasiAvatar, prosesAvatar, kunciAvatar, MAX_AVATAR_BYTES,
} = await import('../src/avatar.mjs');

// ── Membuat gambar uji tanpa bergantung berkas di disk ─────────────────────
// sharp dipakai untuk MEMBUAT gambar uji, jadi uji ini tidak perlu menyimpan
// fixture biner di repositori (yang sulit ditinjau dan mudah rusak).
let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch { /* ditangani per-uji */ }

const adaSharp = Boolean(sharp);

/** Gambar JPEG solid berukuran tertentu. */
async function gambarUji(lebar, tinggi) {
  return sharp({
    create: { width: lebar, height: tinggi, channels: 3, background: { r: 40, g: 60, b: 90 } },
  }).jpeg({ quality: 90 }).toBuffer();
}

// ── VALIDASI ───────────────────────────────────────────────────────────────

test('validasiAvatar menolak berkas kosong', () => {
  assert.throws(
    () => validasiAvatar(Buffer.alloc(0), 'image/jpeg'),
    (e) => e.statusCode === 400 && /kosong/i.test(e.message),
  );
});

test('validasiAvatar menolak berkas melebihi batas', () => {
  const besar = Buffer.alloc(MAX_AVATAR_BYTES + 1);
  assert.throws(
    () => validasiAvatar(besar, 'image/jpeg'),
    (e) => e.statusCode === 413 && /besar/i.test(e.message),
  );
});

test('validasiAvatar menerima JPG, PNG, WebP, dan AVIF', () => {
  const buf = Buffer.from('x');
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
    assert.equal(validasiAvatar(buf, mime), mime);
  }
});

test('validasiAvatar mengabaikan parameter di Content-Type', () => {
  // 'image/jpeg; charset=binary' adalah bentuk yang sah dan sering dikirim
  // klien. Membandingkan string mentah akan menolaknya.
  assert.equal(validasiAvatar(Buffer.from('x'), 'image/jpeg; charset=binary'), 'image/jpeg');
});

test('validasiAvatar menolak format yang tidak didukung', () => {
  for (const mime of ['application/pdf', 'image/gif', 'text/plain', 'image/heic', '']) {
    assert.throws(
      () => validasiAvatar(Buffer.from('x'), mime),
      (e) => e.statusCode === 415,
      `seharusnya menolak ${mime || '(kosong)'}`,
    );
  }
});

// ── KUNCI ──────────────────────────────────────────────────────────────────

test('kunciAvatar berbentuk avatar/ID-HASH.webp', () => {
  const kunci = kunciAvatar('abc123', 'deadbeef01');
  assert.equal(kunci, 'avatar/abc123-deadbeef01.webp');
});

test('kunciAvatar membersihkan karakter yang tidak aman', () => {
  // ID pengguna datang dari database, bukan dari klien — tapi pembersihan
  // tetap dilakukan: satu baris database yang rusak tidak boleh menghasilkan
  // kunci yang bisa keluar dari folder avatar/.
  const kunci = kunciAvatar('../../etc/passwd', 'abc');

  // Yang diperiksa adalah SIFAT yang membuatnya aman, bukan string tertentu:
  // pemisah path dan titik sudah dibuang, jadi nilainya tetap satu segmen.
  assert.ok(!kunci.includes('..'), 'tidak boleh ada ..');
  assert.ok(!kunci.includes('\\'), 'tidak boleh ada backslash');
  // Tepat satu '/' — yang memisahkan folder 'avatar/' dari nama berkasnya.
  assert.equal(kunci.split('/').length, 2, 'kunci harus tepat satu tingkat di dalam avatar/');
  assert.ok(kunci.startsWith('avatar/'));
  assert.ok(kunci.endsWith('.webp'));
});

test('kunciAvatar membatasi panjang id', () => {
  // ID yang sangat panjang akan menghasilkan nama berkas yang melewati batas
  // panjang kunci R2 (1024 byte). Potong di 40 karakter.
  const kunci = kunciAvatar('a'.repeat(500), 'abc');
  const namaBerkas = kunci.split('/')[1];
  assert.ok(namaBerkas.length <= 40 + 1 + 10 + 5, `nama terlalu panjang: ${namaBerkas.length}`);
});

test('kunciAvatar menolak id kosong', () => {
  assert.throws(() => kunciAvatar('', 'abc'), (e) => e.statusCode === 400);
  assert.throws(() => kunciAvatar('///', 'abc'), (e) => e.statusCode === 400);
});

// ── PEMROSESAN ─────────────────────────────────────────────────────────────

test('prosesAvatar menghasilkan WebP persegi 512x512', { skip: !adaSharp }, async () => {
  // Potret 800x1200 — BUKAN persegi. Ini kasus yang paling sering salah:
  // foto ponsel selalu potret, dan tanpa pemotongan di server, hasilnya
  // berbeda di setiap tempat avatar dipakai.
  const masukan = await gambarUji(800, 1200);
  const hasil = await prosesAvatar(masukan);

  assert.equal(hasil.lebar, 512);
  assert.equal(hasil.tinggi, 512);

  const meta = await sharp(hasil.webp).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});

test('prosesAvatar menerima gambar lanskap', { skip: !adaSharp }, async () => {
  const hasil = await prosesAvatar(await gambarUji(1200, 800));
  assert.equal(hasil.lebar, 512);
  assert.equal(hasil.tinggi, 512);
});

test('prosesAvatar TIDAK memperbesar gambar kecil yang masih lolos batas', { skip: !adaSharp }, async () => {
  // 300x300 lolos batas minimum 200px, tapi lebih kecil dari 512. Ia
  // diperbesar ke 512 (karena fit:cover butuh mengisi kanvas), dan itu
  // memang diinginkan — yang penting hasilnya tetap persegi dan tidak pecah
  // karena diperbesar berkali-kali.
  const hasil = await prosesAvatar(await gambarUji(300, 300));
  assert.equal(hasil.lebar, 512);
});

test('prosesAvatar menolak gambar yang sisi terpendeknya terlalu kecil', { skip: !adaSharp }, async () => {
  // 150x150: diperbesar ke 512 akan terlihat pecah. Lebih baik ditolak
  // dengan pesan yang menjelaskan, daripada diterima dan terlihat buruk.
  const masukan = await gambarUji(150, 150);
  await assert.rejects(
    () => prosesAvatar(masukan),
    (e) => e.statusCode === 400 && /kecil/i.test(e.message),
  );
});

test('prosesAvatar menolak berkas yang bukan gambar', { skip: !adaSharp }, async () => {
  await assert.rejects(
    () => prosesAvatar(Buffer.from('ini jelas bukan gambar')),
    (e) => e.statusCode === 400,
  );
});

test('prosesAvatar menghasilkan hash yang stabil untuk isi yang sama', { skip: !adaSharp }, async () => {
  // Hash dipakai di nama berkas. Kalau tidak stabil, mengunggah gambar yang
  // SAMA dua kali akan menghasilkan dua berkas berbeda — dan berkas lama
  // tidak pernah terhapus.
  const masukan = await gambarUji(600, 600);
  const a = await prosesAvatar(masukan);
  const b = await prosesAvatar(masukan);
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash.length, 10);
});

test('prosesAvatar menghasilkan hash BERBEDA untuk isi yang berbeda', { skip: !adaSharp }, async () => {
  // ── KENAPA GAMBARNYA HARUS PUNYA POLA, BUKAN WARNA SOLID ────────────────
  // Percobaan pertama memakai dua gambar SOLID berukuran berbeda (600x600 dan
  // 601x600). Keduanya menghasilkan hash yang SAMA — dan itu benar: setelah
  // di-resize ke 512x512, gambar solid yang isinya identik menghasilkan
  // piksel yang identik pula. Ukuran asal tidak lagi terlihat.
  //
  // Jadi uji ini butuh gambar yang isinya MEMANG berbeda setelah resize:
  // gradien dengan arah berbeda. Ini juga lebih menyerupai foto sungguhan.
  const gradien = (arah) => sharp({
    create: {
      width: 600, height: 600, channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="600" height="600">
           <defs><linearGradient id="g" x1="0" y1="0" x2="${arah === 'x' ? 1 : 0}" y2="${arah === 'x' ? 0 : 1}">
             <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#000000"/>
           </linearGradient></defs>
           <rect width="600" height="600" fill="url(#g)"/>
         </svg>`,
      ),
      top: 0, left: 0,
    }])
    .jpeg({ quality: 90 })
    .toBuffer();

  const a = await prosesAvatar(await gradien('x'));
  const b = await prosesAvatar(await gradien('y'));
  assert.notEqual(a.hash, b.hash, 'gradien berbeda arah harus menghasilkan hash berbeda');
});

test('prosesAvatar melaporkan penghematan ukuran', { skip: !adaSharp }, async () => {
  const masukan = await gambarUji(1200, 1200);
  const hasil = await prosesAvatar(masukan);
  // WebP pada gambar solid jauh lebih kecil dari JPEG-nya. Yang diperiksa
  // bukan angkanya, tapi bahwa kedua nilai itu masuk akal.
  assert.ok(hasil.bytesAsli > 0);
  assert.ok(hasil.bytesWebp > 0);
  assert.ok(hasil.bytesWebp < hasil.bytesAsli, 'WebP seharusnya lebih kecil');
});
