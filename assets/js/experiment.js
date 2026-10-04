/**
 * Eksperimen A/B — ambil varian dari server, terapkan, catat konversi.
 *
 * Meniru "Grow"/"Convert" Framer: menguji perubahan dengan DATA.
 * Client hanya perlu menandai elemen mana yang berubah per varian:
 *
 *   <h1 data-ab="headline">...</h1>
 *   <script type="application/json" data-ab-variants>
 *     {
 *       "hero-test": {
 *         "control": { "headline": "Judul asli" },
 *         "variant": { "headline": "Judul baru yang lebih spesifik" }
 *       }
 *     }
 *   </script>
 *
 * Varian dipilih server (deterministik per pengunjung) supaya tidak ada
 * flicker dan tidak bisa dimanipulasi client.
 */

const STORAGE_KEY = 'ab_visitor';
let activeExperiment = null;
let activeVariant = null;

/** ID pengunjung anonim — hanya untuk konsistensi varian, bukan tracking. */
function visitorId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

async function resolveApiBase() {
  try {
    const res = await fetch('/backend-url.json', { cache: 'no-store' });
    if (!res.ok) return '';
    const d = await res.json();
    return d?.api_base ? d.api_base.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

/**
 * Jalankan eksperimen.
 * @param {string} slug — nama eksperimen
 * @param {object} variants — peta varian → peta elemen → teks baru
 */
export async function runExperiment(slug, variants) {
  try {
    const base = await resolveApiBase();
    const res = await fetch(`${base}/api/experiment/${slug}?v=${encodeURIComponent(visitorId())}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.variant) return null;

    activeExperiment = slug;
    activeVariant = data.variant;

    const map = variants?.[data.variant];
    if (!map) return data.variant;

    // Terapkan perubahan ke elemen bertanda data-ab.
    for (const [key, value] of Object.entries(map)) {
      const el = document.querySelector(`[data-ab="${key}"]`);
      if (el && typeof value === 'string') el.textContent = value;
    }

    return data.variant;
  } catch {
    return null; // gagal-diam: eksperimen tidak boleh merusak halaman
  }
}

/** Catat konversi (mis. setelah form terkirim). */
export function trackConversion(event = 'conversion') {
  if (!activeExperiment || !activeVariant) return;
  const payload = JSON.stringify({
    slug: activeExperiment,
    variant: activeVariant,
    event,
    visitor: visitorId(),
  });

  try {
    const base = window.__apiBase ?? '';
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${base}/api/experiment/convert`, new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch(`${base}/api/experiment/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch { /* gagal-diam */ }
}

/**
 * Inisialisasi otomatis dari blok <script type="application/json" data-ab-variants>.
 * Format: { "<slug>": { "<variant>": { "<data-ab key>": "teks" } } }
 */
export async function initExperiments() {
  const block = document.querySelector('script[data-ab-variants]');
  if (!block) return;

  let config;
  try {
    config = JSON.parse(block.textContent);
  } catch {
    return;
  }

  for (const [slug, variants] of Object.entries(config)) {
    await runExperiment(slug, variants);
    break; // satu eksperimen per halaman — cukup untuk kebutuhan portofolio
  }
}

/** Varian yang sedang aktif (untuk debugging manual). */
export function activeVariantInfo() {
  return { experiment: activeExperiment, variant: activeVariant };
}
