/**
 * Utilitas HTTP — pengurai body, jawaban JSON, CORS, alamat klien.
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
  res.setHeader('access-control-max-age', '600');
}

/**
 * Alamat IP klien.
 * Tunnel Cloudflare menambahkan CF-Connecting-IP; kalau tidak ada, pakai socket.
 */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '';
}

/** Negara dari header Cloudflare (kalau ada). */
export function clientCountry(req) {
  const c = req.headers['cf-ipcountry'];
  return typeof c === 'string' ? c.trim() : '';
}

/** Ambil token dari header atau body. */
export function extractToken(req, body = {}) {
  const header = req.headers['x-project-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof body.token === 'string' && body.token.trim()) return body.token.trim();
  return '';
}

/** Jawaban OPTIONS preflight. */
export function handlePreflight(req, res) {
  applyCors(req, res);
  res.writeHead(204);
  res.end();
}
