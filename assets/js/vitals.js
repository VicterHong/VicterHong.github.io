/**
 * Core Web Vitals — ukur performa nyata dari pengunjung, kirim ke server.
 *
 * Meniru "Performance" Framer: angka dari pengunjung sungguhan (field data),
 * bukan hanya tes lab. Ringan: hanya 5 metrik, dikirim sekali per halaman,
 * pakai sendBeacon supaya tidak menunda unload.
 *
 * Metrik:
 *   LCP  — Largest Contentful Paint  (kapan konten utama terlihat)
 *   INP  — Interaction to Next Paint (responsivitas)
 *   CLS  — Cumulative Layout Shift   (kestabilan visual)
 *   TTFB — Time to First Byte        (kecepatan server)
 *   FCP  — First Contentful Paint    (kapan konten mulai muncul)
 *
 * Hormati privasi: tidak ada ID pengguna, tidak ada cookie, hanya angka.
 */

const ENDPOINT = '/api/vitals';
const sent = new Set();

function send(name, value, rating) {
  if (sent.has(name)) return;
  sent.add(name);

  const payload = JSON.stringify({
    name,
    value: Math.round(value * 1000) / 1000,
    rating,
    path: location.pathname,
    connection: navigator.connection?.effectiveType ?? '',
  });

  // sendBeacon: tidak menunda unload, tidak butuh response.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      return;
    }
  } catch { /* lanjut ke fetch */ }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => { /* gagal-diam: metrik tidak boleh mengganggu pengguna */ });
}

/** Ambil endpoint dari berkas tunnel (backend mungkin di host lain). */
async function resolveEndpoint() {
  try {
    const res = await fetch('/backend-url.json', { cache: 'no-store' });
    if (!res.ok) return ENDPOINT;
    const d = await res.json();
    if (!d?.api_base) return ENDPOINT;
    return d.api_base.replace(/\/$/, '') + '/api/vitals';
  } catch {
    return ENDPOINT;
  }
}

export function initVitals() {
  if (typeof PerformanceObserver === 'undefined') return;

  // ── TTFB (dari navigation timing) ──
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (nav && nav.responseStart > 0) {
    const ttfb = nav.responseStart - nav.requestStart;
    send('ttfb', ttfb, ttfb <= 800 ? 'good' : ttfb <= 1800 ? 'needs-improvement' : 'poor');
  }

  // ── FCP ──
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          const fcp = entry.startTime;
          send('fcp', fcp, fcp <= 1800 ? 'good' : fcp <= 3000 ? 'needs-improvement' : 'poor');
        }
      }
    }).observe({ type: 'paint', buffered: true });
  } catch { /* browser lama */ }

  // ── LCP ──
  try {
    let lcpValue = 0;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      lcpValue = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // LCP final diukur saat halaman disembunyikan (standar web-vitals).
    const reportLcp = () => {
      if (lcpValue > 0) {
        send('lcp', lcpValue, lcpValue <= 2500 ? 'good' : lcpValue <= 4000 ? 'needs-improvement' : 'poor');
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportLcp();
    }, { once: true });
    window.addEventListener('pagehide', reportLcp, { once: true });
  } catch { /* browser lama */ }

  // ── CLS ──
  try {
    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    const reportCls = () => {
      send('cls', clsValue, clsValue <= 0.1 ? 'good' : clsValue <= 0.25 ? 'needs-improvement' : 'poor');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportCls();
    }, { once: true });
    window.addEventListener('pagehide', reportCls, { once: true });
  } catch { /* browser lama */ }

  // ── INP (interaksi) ──
  try {
    let worstInp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > worstInp) worstInp = entry.duration;
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });

    const reportInp = () => {
      if (worstInp > 0) {
        send('inp', worstInp, worstInp <= 200 ? 'good' : worstInp <= 500 ? 'needs-improvement' : 'poor');
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportInp();
    }, { once: true });
  } catch { /* browser lama */ }
}
