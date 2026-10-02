/**
 * Rate limiter per-IP untuk endpoint publik.
 *
 * Sebelumnya brute force token tidak terbatas: percobaan dengan token TIDAK DIKENAL
 * tidak punya token_id, jadi guard berbasis token tidak pernah aktif. Modul ini
 * menutup celah itu dengan membatasi laju per alamat IP, apa pun tokennya.
 *
 * Implementasi: sliding window sederhana di memori. Cukup untuk satu proses Node;
 * restart layanan mengosongkan hitungan (dapat diterima — penyerang tidak bisa
 * memicu restart).
 */

/** Map: key → array timestamp (ms). */
const buckets = new Map();

/** Bersihkan entri lama secara berkala supaya memori tidak tumbuh tanpa batas. */
let lastSweep = Date.now();
function sweep(nowMs, maxWindowMs) {
  if (nowMs - lastSweep < 60_000) return;
  lastSweep = nowMs;
  for (const [key, times] of buckets) {
    const fresh = times.filter((t) => nowMs - t < maxWindowMs);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

/**
 * Periksa apakah permintaan melebihi batas.
 * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
 */
export function checkRateLimit(key, { limit, windowMs }) {
  const nowMs = Date.now();
  sweep(nowMs, Math.max(windowMs, 3_600_000));

  const times = (buckets.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  if (times.length >= limit) {
    const oldest = times[0];
    const retryAfterMs = windowMs - (nowMs - oldest);
    buckets.set(key, times);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  times.push(nowMs);
  buckets.set(key, times);
  return { allowed: true, remaining: limit - times.length, retryAfterSeconds: 0 };
}

/** Reset hitungan untuk satu key (dipakai tes). */
export function resetRateLimit(key) {
  if (key) buckets.delete(key);
  else buckets.clear();
}

/** Jumlah key aktif (dipakai tes). */
export function rateLimitSize() {
  return buckets.size;
}
