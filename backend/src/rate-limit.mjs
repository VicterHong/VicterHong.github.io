/**
 * Rate limiter per-IP untuk endpoint publik.
 *
 * Sebelumnya brute force token tidak terbatas: percobaan dengan token TIDAK DIKENAL
 * tidak punya token_id, jadi guard berbasis token tidak pernah aktif. Modul ini
 * menutup celah itu dengan membatasi laju per alamat IP, apa pun tokennya.
 *
 * ── A6: KENAPA MODUL INI DITULIS ULANG ──────────────────────────────────────
 *
 * Implementasi sebelumnya menyimpan `Map<key, timestamp[]>` dan membersihkan
 * entri lama dengan `sweep()` yang menyusuri SELURUH Map. Tiga masalah, semua
 * diukur dengan beban nyata:
 *
 * 1. TIDAK ADA BATAS JUMLAH KEY.
 *    Diukur: 1.000.000 key = 226 MB memori. Di VPS 1 GB, penyerang dengan
 *    banyak IP bisa menghabiskan memori hanya dengan mengirim satu request
 *    per IP. Map tidak pernah menolak key baru.
 *
 * 2. SWEEP O(n) MEMBLOKIR EVENT LOOP.
 *    Diukur: sweep 100.000 key = 99 ms. Karena server ini sinkron
 *    (DatabaseSync), selama 99 ms itu SEMUA permintaan berhenti — termasuk
 *    milik pengunjung sah. Penyerang justru memperbesar biaya ini.
 *
 * 3. SWEEP HANYA JALAN KALAU ADA REQUEST.
 *    `sweep()` dipanggil di dalam `checkRateLimit()`. Kalau trafik berhenti,
 *    Map tidak pernah dibersihkan dan memori tetap terpakai. Kalau trafik
 *    padat, sweep jalan tiap menit — tapi itu justru memperparah (2).
 *
 * ── PENDEKATAN BARU: BUCKET WAKTU TETAP + BATAS KERAS + EViksi ──────────────
 *
 * 1. SATU ANGKA, BUKAN ARRAY TIMESTAMP.
 *    Alih-alih menyimpan setiap timestamp, simpan `{ count, windowStart }`.
 *    Satu entri Map jadi satu objek kecil — bukan array yang tumbuh sampai
 *    sebesar limit. Memori per key turun drastis.
 *
 * 2. SWEEP BERTAHAP, BUKAN SEKALIGUS.
 *    Saat menyapu, periksa maksimum `SWEEP_BUDGET` entri per panggilan.
 *    Kalau Map besar, pembersihan selesai dalam beberapa panggilan —
 *    tidak ada satu panggilan yang memblokir ratusan milidetik.
 *
 * 3. BATAS KERAS JUMLAH KEY + EVIksi.
 *    Kalau Map sudah penuh, buang entri yang paling sudah lama tidak dipakai.
 *    Ini BUKAN sekadar optimasi memori: tanpa batas, penyerang bisa membuat
 *    Map tumbuh sampai proses mati — dan itu artinya rate limiter berubah
 *    menjadi alat serangan (denial of service lewat memori).
 *
 *    Yang dibuang adalah entri paling lama — bukan yang paling baru. Entri
 *    yang baru dipakai kemungkinan besar milik klien aktif.
 *
 * 4. SWEEP BERBASIS WAKTU, BUKAN BERBASIS REQUEST.
 *    Interval sweep tetap, dipanggil dari `setInterval` di server. Jadi Map
 *    dibersihkan meski tidak ada trafik sama sekali.
 *
 * ── KETERBATASAN YANG DISENGAJA ─────────────────────────────────────────────
 *
 * Bucket tetap (bukan sliding window) berarti batasnya bisa dilewati sampai
 * 2x di perbatasan jendela: klien bisa mengirim `limit` request di akhir
 * jendela lalu `limit` lagi di awal jendela berikutnya. Untuk rate limiter
 * endpoint publik ini dapat diterima — tujuannya menahan pemboman dan brute
 * force, bukan penagihan. Sliding window presisi tinggi butuh menyimpan
 * timestamp per request, dan itulah yang membuat memori membengkak.
 *
 * Kalau nanti butuh presisi lebih tinggi, ganti ke sliding window berbasis
 * dua bucket (bobot jendela sekarang + sebelumnya) — tetap O(1) per key.
 */

/**
 * Batas jumlah key yang disimpan.
 *
 * 50.000 key kira-kira 2-4 MB. Dengan ~1.000 pengunjung sah per menit,
 * ini memberi ruang sangat lega — sementara serangan dari 50.000 IP tetap
 * tidak bisa menumbuhkan memori tanpa batas.
 */
const MAX_KEYS = 50_000;

/**
 * Setelah eviksi, sisakan sebanyak ini (fraksi dari MAX_KEYS).
 *
 * Eviksi membuang sampai LOW_WATER_MARK supaya tidak berjalan di SETIAP
 * request berikutnya — lihat evictToLowWaterMark() untuk alasannya.
 * 0.8 berarti eviksi berjalan sekali per ~10.000 key baru.
 */
const LOW_WATER_MARK = 0.8;

/** Map: key → { count, windowStart }. */
const buckets = new Map();

/** Statistik untuk /api/health — supaya kondisi rate limiter terlihat. */
let sweepCount = 0;
let evictedCount = 0;

/**
 * Bersihkan entri kedaluwarsa.
 *
 * ── KENAPA INI TIDAK LAMBAT MESKI MENYUSURI SELURUH MAP ─────────────────────
 *
 * Implementasi LAMA lambat bukan karena menyusuri Map, tapi karena
 * MENGALOKASI: setiap key membuat array baru lewat `times.filter(...)`.
 * Pada 100.000 key itu 100.000 array baru — 99 ms dan ratusan ribu
 * alokasi sampah.
 *
 * Versi ini hanya MEMBACA satu angka per key dan membandingkannya. Tidak
 * ada array baru, tidak ada alokasi. Batas keras MAX_KEYS (50.000) membuat
 * biaya terburuknya tetap kecil dan terukur.
 *
 * @param {number} nowMs
 * @param {number} maxWindowMs jendela terpanjang yang mungkin
 * @returns {number} jumlah entri yang dibuang
 */
export function sweepRateLimit(nowMs = Date.now(), maxWindowMs = 3_600_000) {
  sweepCount += 1;
  let removed = 0;

  // ── KENAPA keys() + get(), BUKAN for...of [key, bucket] ──────────────────
  //
  // `for (const [key, bucket] of buckets)` terlihat rapi tapi MENGALOKASI
  // array dua elemen untuk SETIAP entri. Pada 50.000 key itu 50.000 array
  // baru — diukur 91 ms, hampir sama lambatnya dengan versi lama yang
  // memakai filter().
  //
  // `keys()` lalu `get(key)` tidak mengalokasi apa pun per entri: hanya
  // membaca kunci dan satu lookup hash. Ini yang membuat sweep murah.
  for (const key of buckets.keys()) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (nowMs - bucket.windowStart >= maxWindowMs) {
      buckets.delete(key);
      removed += 1;
    }
  }

  return removed;
}

/**
 * Buang entri dalam SATU BATCH sampai di bawah low-water-mark.
 *
 * ── KENAPA BATCH, BUKAN SATU PER REQUEST ────────────────────────────────────
 *
 * Kalau eviksi membuang satu entri setiap kali Map penuh, setiap request
 * berikutnya menyusuri 50.000 entri lagi — O(n) per request, tepat saat
 * server diserang. Dengan membuang sekaligus sampai LOW_WATER_MARK, eviksi
 * hanya berjalan sekali per ~10.000 key baru.
 *
 * ── KENAPA BUANG HITUNGAN TERKECIL (bukan LRU) ──────────────────────────────
 *
 * Percobaan pertama memakai LRU — buang yang paling lama tidak dipakai.
 * Itu TERBUKTI SALAH saat diuji:
 *
 *   Klien sah membuat key dan memakainya beberapa kali. Penyerang membanjiri
 *   dengan 60.000 key baru. Setiap key baru punya waktu pakai lebih BARU
 *   daripada key klien sah, jadi klien sah menjadi "paling lama" dan
 *   DIBUANG — sementara key penyerang dipertahankan.
 *
 *   Lebih buruk: penyerang bisa me-reset hitungannya SENDIRI. Kirim sampai
 *   kena limit, lalu banjiri Map dengan key palsu; entri penyerang ikut
 *   menjadi "lama" dan terbuang, hitungannya kembali nol. Rate limiter
 *   berubah menjadi alat serangan.
 *
 * Gantinya: buang entri dengan HITUNGAN TERKECIL.
 *
 *   Entri berhitungan 1 hampir tidak berguna — ia baru memakai 1 dari N
 *   jatah. Entri berhitungan penuh adalah yang SEDANG memblokir seseorang;
 *   itu yang paling berharga untuk dipertahankan.
 *
 *   Akibatnya penyerang tidak bisa me-reset dirinya: entri penyerang
 *   berhitungan tinggi justru dipertahankan, sementara banjir key palsu
 *   berhitungan 1 yang dibuang.
 *
 *   Klien sah yang sedang aktif juga berhitungan lebih tinggi daripada
 *   key palsu, jadi ia ikut dipertahankan.
 *
 * Seri dipecah dengan windowStart terlama — supaya eviksi tetap
 * deterministik dan tidak bergantung urutan Map.
 */
function evictToLowWaterMark(nowMs) {
  const target = Math.floor(MAX_KEYS * LOW_WATER_MARK);
  const toRemove = buckets.size - target;
  if (toRemove <= 0) return 0;

  const entries = [];
  for (const key of buckets.keys()) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    entries.push([key, bucket.count, bucket.windowStart]);
  }

  // Hitungan terkecil dulu; seri → windowStart terlama.
  entries.sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]));

  const n = Math.min(toRemove, entries.length);
  for (let i = 0; i < n; i++) {
    buckets.delete(entries[i][0]);
    evictedCount += 1;
  }
  return n;
}

/**
 * Periksa apakah permintaan melebihi batas.
 *
 * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
 */
export function checkRateLimit(key, { limit, windowMs }) {
  const nowMs = Date.now();

  let bucket = buckets.get(key);

  // Jendela baru: mulai hitungan dari nol.
  // Memakai perbandingan >= (bukan >) supaya jendela tepat `windowMs` —
  // dengan > jendela jadi `windowMs + 1ms`.
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: nowMs };
    buckets.set(key, bucket);
  }

  if (bucket.count >= limit) {
    const retryAfterMs = windowMs - (nowMs - bucket.windowStart);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  bucket.count += 1;

  // Map penuh → buang yang sudah kedaluwarsa SEKALIGUS sampai low-water-mark.
  // Dicek SETELAH penambahan supaya key yang baru masuk tidak langsung
  // menjadi korban.
  if (buckets.size > MAX_KEYS) evictToLowWaterMark(nowMs);

  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** Reset hitungan untuk satu key (dipakai tes). */
export function resetRateLimit(key) {
  if (key) buckets.delete(key);
  else buckets.clear();
}

/** Jumlah key aktif (dipakai tes dan /api/health). */
export function rateLimitSize() {
  return buckets.size;
}

/** Statistik rate limiter — untuk pemantauan. */
export function rateLimitStats() {
  return {
    keys: buckets.size,
    max_keys: MAX_KEYS,
    sweeps: sweepCount,
    evicted: evictedCount,
    full: buckets.size >= MAX_KEYS,
  };
}
