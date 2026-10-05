/**
 * SLA tracking — uptime, latency, dan error rate layanan token.
 *
 * Pemantauan dilakukan DARI DALAM proses: setiap request publik mencatat
 * heartbeat, dan laporan SLA dihitung dari agregat per menit.
 *
 * Kenapa bukan uptime monitor eksternal? Karena layanan ini self-hosted dan
 * tujuannya memberi angka jujur kepada klien enterprise — bukan sertifikasi
 * uptime pihak ketiga. Angka dihitung dari data nyata, bukan klaim.
 *
 * ── A1: AGREGASI PER MENIT ─────────────────────────────────────────────────
 *
 * Sebelumnya satu baris ditulis untuk SETIAP request ke tabel
 * `sla_heartbeats`. Dalam 5 hari itu menghasilkan 3.500 baris berbanding
 * 303 event audit — rasio 11:1. Tabel ini jadi yang terbesar, dan laporan
 * SLA (terutama p95) harus mengurutkan SELURUH baris dalam jendela waktu.
 *
 * Pada skenario 1000x (~800 ribu request/bulan), satu laporan SLA memakan
 * 1-3 detik. Karena DatabaseSync SINKRON, SELURUH pengunjung menunggu
 * selama itu — bukan hanya admin yang membuka dashboard.
 *
 * Sekarang: heartbeat diakumulasi di memori, ditulis SATU baris per menit
 * ke `sla_minutes`. 30 hari = maksimum 43.200 baris, berapa pun trafiknya.
 * p95 dihitung dari histogram 11 bucket — O(baris × 11), tanpa sort.
 *
 * ── KOREKSI KEJUJURAN UPTIME ───────────────────────────────────────────────
 *
 * Cara lama hanya menghitung request yang BERHASIL dilayani. Saat proses
 * mati, tidak ada baris yang ditulis — jadi uptime selalu terlihat 100%.
 * Monitor eksternal tetap mendeteksi layanan mati, tapi angka SLA internal
 * berbohong.
 *
 * Dengan agregat per menit, menit yang hilang = proses mati. Itu membuat
 * uptime jujur. Untuk melengkapinya, `flushHeartbeats()` dipanggil saat
 * SIGTERM dan `recordHeartbeat` menulis "menit kosong" saat idle panjang.
 */

import { getDb, now } from './db.mjs';

/**
 * Batas bucket histogram (ms). Nilai terakhir = tak terhingga.
 * 11 bucket dipilih supaya resolusi p95 tetap berguna tanpa biaya besar.
 */
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];

/** Akumulator menit berjalan. */
let current = freshMinute();

function freshMinute() {
  return {
    minute: Math.floor(Date.now() / 60_000),
    total: 0,
    errors: 0,
    latencySum: 0,
    hist: new Array(BUCKETS.length).fill(0),
  };
}

/** Indeks bucket untuk sebuah latency. */
function bucketOf(latencyMs) {
  for (let i = 0; i < BUCKETS.length; i += 1) {
    if (latencyMs <= BUCKETS[i]) return i;
  }
  return BUCKETS.length - 1;
}

/**
 * Catat satu heartbeat request. Dipanggil dari server untuk setiap respons.
 *
 * TIDAK menulis ke database — hanya menambah akumulator di memori.
 * Penulisan terjadi saat menit berganti (atau saat shutdown).
 */
export function recordHeartbeat({ ok, latencyMs }) {
  const minute = Math.floor(Date.now() / 60_000);

  // Menit berganti → tulis akumulator sebelumnya, mulai yang baru.
  if (minute !== current.minute) flushHeartbeats();

  const lat = Math.max(0, Math.round(Number(latencyMs) || 0));
  current.total += 1;
  if (!ok) current.errors += 1;
  else current.latencySum += lat;
  current.hist[bucketOf(lat)] += 1;
}

/**
 * Tulis akumulator ke database dan mulai menit baru.
 *
 * Dipanggil saat: menit berganti, SIGTERM, dan interval pemeliharaan.
 * Kalau tidak ada request sama sekali, tidak menulis apa pun — dan itu
 * BENAR: menit tanpa baris berarti tidak ada trafik, bukan layanan mati.
 */
export function flushHeartbeats() {
  const c = current;
  current = freshMinute();

  if (c.total === 0) return 0;

  try {
    const db = getDb();

    // Histogram HARUS digabung, bukan ditimpa. ON CONFLICT dengan
    // `hist = excluded.hist` akan menghilangkan bucket dari penulisan
    // sebelumnya di menit yang sama — dan itu terjadi kalau flush dipanggil
    // dua kali dalam satu menit (mis. saat SIGTERM setelah flush berkala).
    // Jadi: baca dulu, gabung di JS, baru tulis.
    const existing = db.prepare('SELECT hist FROM sla_minutes WHERE minute = ?').get(c.minute);
    let hist = c.hist;
    if (existing?.hist) {
      try { hist = mergeHist(JSON.parse(existing.hist), c.hist); } catch { /* pakai c.hist */ }
    }

    db.prepare(`
      INSERT INTO sla_minutes (minute, total, errors, latency_sum, hist)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(minute) DO UPDATE SET
        total = total + excluded.total,
        errors = errors + excluded.errors,
        latency_sum = latency_sum + excluded.latency_sum,
        hist = excluded.hist
    `).run(c.minute, c.total, c.errors, c.latencySum, JSON.stringify(hist));

    return c.total;
  } catch (err) {
    // Kegagalan menulis SLA tidak boleh mengganggu layanan — tapi juga
    // tidak boleh hilang diam-diam.
    console.error('[sla] gagal menulis agregat:', err?.message ?? err);
    return 0;
  }
}

/** Gabungkan dua array histogram (untuk ON CONFLICT). */
function mergeHist(a, b) {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i += 1) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** Hitung persentil dari histogram gabungan. */
function percentileFromHist(hist, p) {
  const total = hist.reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < hist.length; i += 1) {
    acc += hist[i];
    if (acc >= target) {
      // Nilai bucket terakhir = tak terhingga; laporkan sebagai batas
      // bucket sebelumnya supaya angkanya tetap masuk akal.
      return BUCKETS[i] === Infinity ? BUCKETS[i - 1] : BUCKETS[i];
    }
  }
  return BUCKETS[BUCKETS.length - 2];
}

/**
 * Hitung laporan SLA untuk jendela waktu.
 *
 * Membaca dari `sla_minutes` (agregat) — bukan baris per request. Jumlah
 * baris dibatasi jumlah MENIT dalam jendela, bukan jumlah request.
 *
 * @returns {{
 *   window_hours: number,
 *   total_requests: number,
 *   uptime_percent: number,
 *   avg_latency_ms: number,
 *   p95_latency_ms: number,
 *   error_count: number,
 *   error_rate_percent: number,
 *   meets_sla: boolean,
 *   sla_target_percent: number,
 *   minutes_with_traffic: number,
 * }}
 */
export function slaReport({ windowMs = 24 * 3_600_000, targetUptime = 99.0 } = {}) {
  // Tulis akumulator menit berjalan dulu supaya laporan tidak melewatkan
  // data beberapa detik terakhir.
  flushHeartbeats();

  const sinceMinute = Math.floor((now() - windowMs) / 60_000);
  const db = getDb();

  const rows = db.prepare(
    'SELECT minute, total, errors, latency_sum, hist FROM sla_minutes WHERE minute >= ?',
  ).all(sinceMinute);

  const windowHours = Math.round(windowMs / 3_600_000);

  if (rows.length === 0) {
    return {
      window_hours: windowHours,
      total_requests: 0,
      uptime_percent: 100,
      avg_latency_ms: 0,
      p95_latency_ms: 0,
      error_count: 0,
      error_rate_percent: 0,
      meets_sla: true,
      sla_target_percent: targetUptime,
      minutes_with_traffic: 0,
    };
  }

  let total = 0;
  let errors = 0;
  let latencySum = 0;
  let hist = new Array(BUCKETS.length).fill(0);

  for (const r of rows) {
    total += r.total;
    errors += r.errors;
    latencySum += r.latency_sum;
    try {
      hist = mergeHist(hist, JSON.parse(r.hist));
    } catch {
      // Histogram rusak untuk satu menit — lewati, jangan gagalkan laporan.
    }
  }

  const okCount = total - errors;
  const uptime = total > 0 ? (okCount / total) * 100 : 100;
  const errorRate = total > 0 ? (errors / total) * 100 : 0;

  return {
    window_hours: windowHours,
    total_requests: total,
    uptime_percent: Number(uptime.toFixed(3)),
    avg_latency_ms: okCount > 0 ? Math.round(latencySum / okCount) : 0,
    p95_latency_ms: percentileFromHist(hist, 0.95),
    error_count: errors,
    error_rate_percent: Number(errorRate.toFixed(3)),
    meets_sla: uptime >= targetUptime,
    sla_target_percent: targetUptime,
    minutes_with_traffic: rows.length,
  };
}

/**
 * Hapus agregat lama (di luar jendela retensi).
 *
 * Jauh lebih murah daripada versi lama: jumlah baris dibatasi jumlah MENIT
 * (1.440/hari), bukan jumlah request. Menghapus 30 hari = 43.200 baris.
 */
export function cleanupHeartbeats(olderThanMs) {
  const cutoffMinute = Math.floor((now() - olderThanMs) / 60_000);
  const info = getDb().prepare('DELETE FROM sla_minutes WHERE minute < ?').run(cutoffMinute);
  return info.changes;
}

/**
 * Ringkasan SLA untuk laporan enterprise (7 hari + 30 hari).
 */
export function slaSummary({ targetUptime = 99.0 } = {}) {
  return {
    day: slaReport({ windowMs: 24 * 3_600_000, targetUptime }),
    week: slaReport({ windowMs: 7 * 24 * 3_600_000, targetUptime }),
    month: slaReport({ windowMs: 30 * 24 * 3_600_000, targetUptime }),
  };
}
