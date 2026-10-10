/**
 * Utilitas HTTP — pengurai body, jawaban JSON, CORS, alamat klien, cookie.
 *
 * Sengaja memakai modul bawaan Node saja: tidak ada framework, tidak ada dependency.
 */

import { config } from './config.mjs';

/** Batas ukuran body permintaan (byte) — mencegah unggahan raksasa. */
const MAX_BODY = 64 * 1024;

/** Baca seluruh body permintaan sebagai teks, dengan batas ukuran. */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body terlalu besar'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Baca body permintaan BINER dengan batas ukuran yang bisa diatur.
 *
 * Kenapa terpisah dari readBody():
 *
 *   readBody() mengubah hasilnya jadi string UTF-8. Untuk gambar, itu MERUSAK
 *   datanya — byte di atas 0x7F diganti karakter pengganti dan berkasnya tidak
 *   bisa didekode lagi. readBody() juga dibatasi 64 KB, sedangkan gambar
 *   butuh beberapa MB.
 *
 * Mengembalikan Buffer apa adanya, tanpa konversi.
 *
 * `maks` diteruskan pemanggil (bukan konstanta modul) supaya batas unggahan
 * bisa diatur di satu tempat — media.mjs — dan tidak ada dua angka yang
 * harus dijaga tetap sama.
 */
export function bacaBodyBiner(req, maks = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maks) {
        reject(Object.assign(
          new Error(`berkas terlalu besar (maksimum ${Math.round(maks / 1024 / 1024)} MB)`),
          { statusCode: 413 },
        ));
        // Buang sisa data supaya koneksi tidak menggantung menunggu unggahan
        // yang sudah pasti ditolak. Tanpa ini, klien bisa terus mengirim
        // megabyte demi megabyte ke soket yang tidak dibaca siapa pun.
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Baca body dan urai sebagai JSON. Body kosong menghasilkan objek kosong. */
export async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw Object.assign(new Error('JSON tidak valid'), { statusCode: 400 });
  }
}

/** Kirim jawaban JSON. */
export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

/**
 * Header CORS untuk origin yang diizinkan.
 *
 * Dipanggil untuk SETIAP permintaan — bukan hanya preflight. Tanpa header ini pada
 * respons sebenarnya, browser memblokir jawabannya walaupun server sudah menjawab 200.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin ?? '';
  if (!origin) return;
  if (!config.allowedOrigins.includes(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-project-token');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-max-age', '600');
}

/**
 * Alamat IP klien.
 *
 * Backend hanya listen di loopback, jadi satu-satunya perantara yang sah
 * adalah cloudflared — dan edge Cloudflare MENIMPA `CF-Connecting-IP`
 * dengan alamat pengunjung sungguhan. Nilai dari klien tidak bisa lolos
 * ke header itu selama request melewati Cloudflare.
 *
 * `X-Forwarded-For` TIDAK dipercaya: header itu bisa dikirim siapa saja,
 * dan memakainya berarti penyerang bisa memalsukan IP hanya dengan
 * menambahkan satu header. Sebelumnya fallback ini ada — dihapus.
 *
 * Batas panjang 45 karakter = panjang maksimum alamat IPv6 dalam teks
 * (termasuk '::ffff:' prefix). Nilai lebih panjang dari itu bukan alamat
 * valid, dan kalau dibiarkan bisa dipakai untuk membengkakkan kunci
 * rate limit di memori.
 *
 * Fungsi ini mengembalikan IP APA ADANYA (tidak dinormalisasi) karena
 * dipakai juga untuk audit log dan Turnstile remoteip — keduanya butuh
 * alamat asli. Untuk kunci rate limit, pakai `ipBucket()`.
 */
export function clientIp(req) {
  // ── URUTAN PEMBACAAN, DAN BATAS KEMAMPUANNYA ─────────────────────────────
  // `X-Client-IP` diperiksa lebih dulu karena Cloudflare MENIMPA
  // `CF-Connecting-IP` di setiap hop fetch() antar domain.
  //
  // ── PENTING: NILAI INI TIDAK SEPENUHNYA AKURAT ───────────────────────────
  // Rantai permintaan punya EMPAT hop:
  //
  //   browser → pages.dev → workers.dev → tunnel → backend
  //
  // Di setiap hop, Cloudflare menimpa header IP. Terukur: backend menerima
  // `2a06:98c0:3600::103` (IP Cloudflare) meski Pages Function dan Worker
  // sama-sama mencoba meneruskan IP asli.
  //
  // Jadi nilai yang dikembalikan fungsi ini adalah **IP Cloudflare**, bukan
  // IP pengunjung. Itu SUDAH CUKUP untuk dua pemakaian:
  //
  //   1. Rate limit per-IP — Cloudflare punya banyak IP edge, tapi jauh
  //      lebih sedikit daripada tanpa batas sama sekali. Batas laju tetap
  //      berfungsi, hanya lebih longgar dari yang ideal.
  //   2. Audit log — mencatat IP Cloudflare lebih baik daripada kosong.
  //
  // Yang TIDAK BOLEH memakai nilai ini: apa pun yang butuh akurasi
  // per-pengunjung, seperti mengikat cookie ke mesin. Itu sebabnya
  // clearance gate memakai nonce acak, bukan IP — lihat gate.mjs.
  //
  // ── KENAPA TETAP AMAN DARI PEMALSUAN ────────────────────────────────────
  // Header dari klien tidak dipercaya. Worker SELALU menimpanya, dan backend
  // hanya listen di loopback — satu-satunya jalur masuk adalah tunnel.
  // Kalau backend pernah dibuka ke jaringan publik, header ini HARUS
  // diabaikan.
  const xc = req.headers['x-client-ip'];
  if (typeof xc === 'string') {
    const v = xc.trim();
    if (v && v.length <= 45) return v;
  }

  // Cadangan: kalau permintaan datang langsung (bukan lewat Worker), header
  // Cloudflare masih asli.
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string') {
    const v = cf.trim();
    if (v && v.length <= 45) return v;
  }
  return req.socket?.remoteAddress ?? '';
}

/**
 * Kunci rate limit dari sebuah IP.
 *
 * IPv6: satu pelanggan VPS biasanya memegang satu blok /64 penuh — itu
 * 2^64 alamat. Kalau setiap alamat dihitung sebagai kunci sendiri,
 * penyerang cukup berganti alamat di tiap request dan SEMUA batas per-IP
 * hilang. Jadi IPv6 dipotong ke prefiks /64 sebelum dijadikan kunci.
 *
 * IPv4 dikembalikan apa adanya (tidak ada ruang untuk berpindah alamat
 * dalam satu alokasi).
 *
 * Bentuk IPv4-mapped IPv6 (`::ffff:1.2.3.4`) dinormalkan ke IPv4 supaya
 * satu pengunjung tidak terhitung sebagai dua kunci berbeda.
 */
export function ipBucket(ip) {
  let a = String(ip ?? '').trim().toLowerCase();
  if (!a) return 'unknown';

  // Buang zona interface (mis. 'fe80::1%eth0') — bukan bagian alamat.
  const pct = a.indexOf('%');
  if (pct !== -1) a = a.slice(0, pct);

  // IPv4-mapped: ambil bagian IPv4-nya saja.
  if (a.startsWith('::ffff:') && a.includes('.')) return a.slice(7);

  // IPv4 biasa.
  if (!a.includes(':')) return a;

  // IPv6: ambil 4 grup pertama (64 bit) sebagai prefiks.
  // Perlu menangani bentuk '::' yang menyingkat grup nol.
  const [headRaw, tailRaw] = a.split('::');
  const head = headRaw ? headRaw.split(':').filter(Boolean) : [];
  if (tailRaw !== undefined) {
    const tail = tailRaw ? tailRaw.split(':').filter(Boolean) : [];
    // Hitung berapa grup nol yang diwakili '::' supaya posisinya benar.
    const missing = 8 - head.length - tail.length;
    const full = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail];
    return full.slice(0, 4).join(':') + '::/64';
  }
  return head.slice(0, 4).join(':') + '::/64';
}

/** Negara dari header Cloudflare (kalau ada). */
export function clientCountry(req) {
  const c = req.headers['cf-ipcountry'];
  return typeof c === 'string' ? c.trim() : '';
}

/**
 * Data geografi dari header Cloudflare.
 *
 * ── KENAPA DARI HEADER, BUKAN DARI API GEO ─────────────────────────────────
 * Cloudflare sudah menghitung ini di setiap request — gratis, tanpa panggilan
 * jaringan tambahan, tanpa API key, tanpa batas kuota. Yang perlu dilakukan
 * hanya membaca headernya.
 *
 * Layanan geo pihak ketiga (MaxMind, ipinfo) memberi kota yang lebih presisi,
 * tapi menambah dependensi eksternal pada jalur kritis login — dan itu berarti
 * login gagal saat layanan itu sedang down.
 *
 * ── KENAPA SEMUA NILAI OPSIONAL ────────────────────────────────────────────
 * Header ini HANYA ada kalau request melewati Cloudflare. Di server uji lokal
 * tidak ada satu pun, dan itu bukan kesalahan — pemanggil harus tetap bekerja
 * dengan nilai kosong. Setiap pembacaan mengembalikan string kosong, bukan
 * undefined, supaya tidak perlu penanganan khusus di pemanggil.
 *
 * ── KENAPA DIPOTONG 80 KARAKTER ────────────────────────────────────────────
 * Nilai ini datang dari header HTTP, yang bisa dikirim siapa saja. Tanpa
 * batas, satu request bisa menulis nilai sepanjang megabyte ke database —
 * pengisian disk yang tidak perlu. 80 karakter jauh lebih dari cukup untuk
 * nama kota atau organisasi terpanjang yang wajar.
 *
 * @returns {{kota: string, wilayah: string, asn: string, zonaWaktu: string}}
 */
export function clientGeo(req) {
  const ambil = (nama) => {
    const v = req.headers[nama];
    return typeof v === 'string' ? v.trim().slice(0, 80) : '';
  };

  // ── URUTAN PEMBACAAN: X- DULU, LALU CF- ─────────────────────────────────────
  //
  // `X-Geo-*` adalah header yang DISET functions/[[path]].js — sudah terbukti
  // bertahan melewati rantai empat hop (browser -> pages.dev -> workers.dev ->
  // tunnel -> backend).
  //
  // `cf-*` dibaca sebagai cadangan: kalau backend suatu saat diakses langsung
  // lewat Cloudflare tanpa melewati Functions, header aslinya tersedia.
  //
  // Membaca keduanya berarti kedua jalur berfungsi, dan tidak ada yang perlu
  // diubah kalau topologinya berubah.
  const ambilDua = (x, cf) => ambil(x) || ambil(cf);

  return {
    kota: ambilDua('x-geo-city', 'cf-ipcity'),
    wilayah: ambilDua('x-geo-region', 'cf-region'),
    // Cloudflare mengirim ASN sebagai angka telanjang ("7713").
    asn: ambilDua('x-geo-asn', 'cf-asn'),
    // Zona waktu IANA (mis. "Asia/Jakarta"). Lebih berguna daripada offset
    // karena menyebut WILAYAHNYA, bukan hanya selisih jam.
    zonaWaktu: ambilDua('x-geo-timezone', 'cf-timezone'),
    // Negara ikut dibaca di sini supaya satu sumber untuk semua geo.
    negara: ambilDua('x-geo-country', 'cf-ipcountry'),
  };
}

/** Ambil token dari header atau body. */
export function extractToken(req, body = {}) {
  const header = req.headers['x-project-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof body.token === 'string' && body.token.trim()) return body.token.trim();
  return '';
}

/** Parse cookie dari header. */
export function parseCookies(req) {
  const raw = req.headers.cookie ?? '';
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = v.join('=').trim();
  }
  return out;
}

/** Set cookie httpOnly Secure SameSite. */
export function setCookie(res, name, value, { maxAgeSeconds = 86400, httpOnly = true, secure = true, sameSite = 'None' } = {}) {
  let cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  if (sameSite) cookie += `; SameSite=${sameSite}`;
  const existing = res.getHeader('set-cookie');
  if (Array.isArray(existing)) {
    res.setHeader('set-cookie', [...existing, cookie]);
  } else if (existing) {
    res.setHeader('set-cookie', [existing, cookie]);
  } else {
    res.setHeader('set-cookie', cookie);
  }
}

/**
 * Hapus cookie (set expired).
 *
 * ── KENAPA OPSINYA HARUS BOLEH DISESUAIKAN ───────────────────────────────────
 * Browser mencocokkan cookie untuk penghapusan berdasarkan nama, domain,
 * path, DAN atribut keamanannya. Cookie yang diset dengan `Secure` +
 * `SameSite=Lax` tidak terhapus oleh Set-Cookie tanpa atribut yang sama —
 * browser menganggapnya cookie yang berbeda.
 *
 * Akibatnya pengguna menekan "Keluar" dan masih terlihat masuk: cookie
 * sesinya tidak pernah benar-benar dibuang.
 *
 * Karena itu fungsi ini meneruskan opsi apa pun yang diberikan pemanggil,
 * supaya penghapusan bisa memakai atribut yang PERSIS SAMA dengan saat
 * cookie itu diset.
 */
export function clearCookie(res, name, opsi = {}) {
  setCookie(res, name, '', { ...opsi, maxAgeSeconds: 0 });
}

/** Jawaban OPTIONS preflight. */
export function handlePreflight(req, res) {
  applyCors(req, res);
  res.writeHead(204);
  res.end();
}
