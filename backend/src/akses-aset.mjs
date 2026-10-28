/**
 * Penyajian aset React + model 3D di balik gate sesi.
 *
 * ── MENGAPA MODUL INI ADA ────────────────────────────────────────────────────
 * Aset 3D adalah produk yang dijual, bukan pelengkap halaman. Berkas .glb yang
 * bisa diunduh tanpa bayar sama saja dengan menyerahkan produknya. Karena itu
 * aset TIDAK disajikan sebagai berkas statis: setiap byte harus melewati
 * pemeriksaan sesi lebih dulu.
 *
 * Berkasnya juga sengaja disimpan DI LUAR repo (`~/.portfolio-token/content/`),
 * sebab repo ini publik dan apa pun di dalam `dist/` bisa diunduh siapa saja
 * yang tahu URL-nya.
 *
 * ── TIGA LAPIS YANG HARUS SEMUA ADA ──────────────────────────────────────────
 * 1. Otorisasi sesi     — tidak ada byte keluar sebelum ini lulus
 * 2. Daftar putih path  — URL tak terdaftar tidak pernah menyentuh disk
 * 3. Header no-store    — tiga lapis, karena Cloudflare membaca berurutan
 *                         Cloudflare-CDN-Cache-Control > CDN-Cache-Control >
 *                         Cache-Control. Satu header saja tidak cukup: Edge
 *                         Cache TTL di Cache Rule MENGALAHKAN no-store.
 */

import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';
import { parseCookies } from './http-util.mjs';
import { cariKunciById, masalahKunci } from './akses-kunci.mjs';
import { recordEvent } from './audit.mjs';

/** Akar penyimpanan aset. Di luar repo, tidak pernah di-deploy. */
export const AKAR_ASET = join(homedir(), '.portfolio-token', 'content', 'react');

/**
 * Header untuk setiap byte yang keluar dari modul ini.
 *
 * `no-store` + `private` memastikan tidak ada cache bersama yang menyimpannya.
 * `CDN-Cache-Control` dan `Cloudflare-CDN-Cache-Control` ditambahkan karena
 * Cloudflare mendahulukan keduanya di atas `Cache-Control`.
 *
 * `Vary: Cookie` SENGAJA TIDAK dipakai. OWASP jelas: Vary bukan batas
 * otorisasi. Cookie diperiksa di kode, bukan di cache key.
 */
export const HEADER_ASET = Object.freeze({
  'Cache-Control': 'no-store, private, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const TIPE = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
});

/**
 * Cookie akses aplikasi: `kunciId.expiry.hmac`
 *
 * ── KENAPA STATELESS, BUKAN TABEL `sessions` ────────────────────────────────
 * `createSession()` menempel ke tabel `tokens` (lewat token_id dan max_devices).
 * Kunci akses aplikasi hidup di tabel `access_keys`, jadi memaksakan sesi ke
 * sana akan selalu gagal. Cookie HMAC membuat verifikasi mandiri: tidak ada
 * baris database yang perlu ditulis atau dibaca per permintaan aset, dan
 * pencabutan tetap bekerja karena kunci aslinya diperiksa ulang di sini.
 *
 * Isi cookie BUKAN rahasia: `kunciId` dan waktu kedaluwarsa bisa dibaca siapa
 * pun yang memegangnya. Yang mengikatnya adalah HMAC dengan `config.secret`,
 * jadi cookie tidak bisa dipalsukan tanpa secret itu.
 */
export const NAMA_COOKIE_AKSES = 'vx_akses';

function tandaTangan(isi) {
  return createHmac('sha256', config.secret).update(`akses:${isi}`).digest('base64url');
}

/** Buat nilai cookie untuk satu kunci. */
export function buatCookieAkses(kunciId, jamBerlaku = 24 * 30) {
  const kedaluwarsa = Date.now() + jamBerlaku * 3_600_000;
  const isi = `${kunciId}.${kedaluwarsa}`;
  return { nilai: `${isi}.${tandaTangan(isi)}`, detik: jamBerlaku * 3600 };
}

/** Verifikasi nilai cookie. Mengembalikan kunciId atau null. */
export function verifikasiCookieAkses(nilai) {
  if (typeof nilai !== 'string') return null;
  const bagian = nilai.split('.');
  if (bagian.length !== 3) return null;

  const [kunciId, kedaluwarsaStr, tanda] = bagian;
  if (!/^ak_[a-f0-9]{16}$/.test(kunciId)) return null;

  const kedaluwarsa = Number(kedaluwarsaStr);
  if (!Number.isFinite(kedaluwarsa) || Date.now() > kedaluwarsa) return null;

  const harapan = tandaTangan(`${kunciId}.${kedaluwarsaStr}`);
  // Panjang harus sama sebelum timingSafeEqual, kalau tidak ia melempar.
  if (tanda.length !== harapan.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(tanda), Buffer.from(harapan))) return null;
  } catch {
    return null;
  }

  return kunciId;
}

/**
 * Apakah permintaan ini membawa cookie akses yang sah?
 *
 * Dua lapis: HMAC harus valid, DAN kunci aslinya harus masih hidup di database.
 * Lapis kedua itulah yang membuat pencabutan langsung berlaku — tanpa itu,
 * cookie yang sudah terbit akan tetap jalan sampai kedaluwarsa.
 *
 * @returns {{ ok: true, kunciRow: object } | { ok: false }}
 */
export function sesiAset(req) {
  const cookies = parseCookies(req);
  const nilai = cookies[NAMA_COOKIE_AKSES] ?? '';
  if (!nilai) return { ok: false };

  const kunciId = verifikasiCookieAkses(nilai);
  if (!kunciId) return { ok: false };

  const row = cariKunciById(kunciId);
  if (!row || masalahKunci(row)) return { ok: false };

  return { ok: true, kunciRow: row };
}

/**
 * Sajikan satu aset. Otorisasi diperiksa SEBELUM disk disentuh.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} relPath path relatif, sudah lolos daftar putih pemanggil
 * @param {{ projectSlug?: string, action?: string }} [meta] untuk audit
 * @returns {boolean} true kalau request sudah ditangani
 */
export function sajikanAset(req, res, relPath, meta = {}) {
  const { projectSlug = 'akses-3d', action = 'aset', lewatiOtorisasi = false } = meta;

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || '';
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);

  // ── 1. OTORISASI ───────────────────────────────────────────────────────────
  // `lewatiOtorisasi` hanya dipakai pemanggil yang SUDAH memvalidasi kode di
  // URL dan baru saja menerbitkan cookie pada respons ini. Cookie itu belum
  // ada di permintaan, jadi memeriksanya lagi akan selalu gagal.
  const sesi = lewatiOtorisasi ? { ok: true, kunciRow: null } : sesiAset(req);
  if (!sesi.ok) {
    recordEvent({ projectSlug, action, outcome: 'tanpa_sesi', ip, userAgent });
    res.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      ...HEADER_ASET,
    });
    res.end(JSON.stringify({
      ok: false,
      error: 'sesi_diperlukan',
      message: 'Sesi diperlukan untuk mengakses aset ini.',
    }));
    return true;
  }

  // ── 2. VALIDASI PATH ───────────────────────────────────────────────────────
  // Tolak apa pun yang mencoba keluar dari akar. Pemeriksaan dilakukan dua
  // kali: sekali pada bentuk mentah, sekali pada hasil resolve — karena
  // `normalize` saja tidak cukup untuk semua bentuk encoding.
  const mentah = String(relPath ?? '');
  if (!mentah || mentah.includes('\0') || mentah.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...HEADER_ASET });
    res.end(JSON.stringify({ ok: false, error: 'path_tidak_valid' }));
    return true;
  }

  const bersih = normalize(mentah).replace(/^[\\/]+/, '');
  const penuh = resolve(join(AKAR_ASET, bersih));

  // Sabuk pengaman kedua: hasil resolve wajib masih di dalam akar.
  if (penuh !== AKAR_ASET && !penuh.startsWith(AKAR_ASET + sep)) {
    recordEvent({
      tokenId: sesi.kunciRow?.id, projectSlug, action,
      outcome: 'path_keluar_akar', ip, userAgent, detail: mentah.slice(0, 120),
    });
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', ...HEADER_ASET });
    res.end(JSON.stringify({ ok: false, error: 'akses_ditolak' }));
    return true;
  }

  // ── 3. STATIS SAJA ─────────────────────────────────────────────────────────
  let st;
  try {
    st = statSync(penuh);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...HEADER_ASET });
    res.end(JSON.stringify({ ok: false, error: 'tidak_ditemukan' }));
    return true;
  }

  if (!st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...HEADER_ASET });
    res.end(JSON.stringify({ ok: false, error: 'tidak_ditemukan' }));
    return true;
  }

  // ── 4. ALIRKAN ─────────────────────────────────────────────────────────────
  // createReadStream, bukan readFileSync: model 3D bisa puluhan MB dan
  // membacanya ke memori akan memblokir event loop.
  const ext = bersih.slice(bersih.lastIndexOf('.')).toLowerCase();
  const tipe = TIPE[ext] ?? 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': tipe,
    'Content-Length': st.size,
    // Tanpa ETag: ETag memungkinkan cache bersyarat (304), dan itu berarti
    // byte aset bisa disajikan ulang dari cache tanpa menyentuh gate ini.
    ...HEADER_ASET,
  });

  if (req.method === 'HEAD') return res.end(), true;

  const aliran = createReadStream(penuh);
  aliran.on('error', () => {
    // Header sudah terkirim; satu-satunya tindakan aman adalah memutus koneksi.
    if (!res.writableEnded) res.destroy();
  });
  aliran.pipe(res);

  return true;
}

/**
 * Muat manifest aset (nama berkas + hash) kalau ada.
 * Dipakai untuk membangun daftar putih URL → berkas.
 */
export function muatManifest() {
  try {
    return JSON.parse(readFileSync(join(AKAR_ASET, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}
