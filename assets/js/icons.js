/**
 * Icon set — SVG inline, bukan emoji.
 *
 * KENAPA BUKAN EMOJI:
 *   1. Emoji tampil berbeda di setiap OS/browser — hasil desain tidak konsisten
 *   2. Emoji ditandai sebagai "AI slop" oleh banyak reviewer & alat deteksi
 *   3. Emoji tidak bisa diwarnai lewat CSS (harus font khusus)
 *   4. Emoji mengganggu screen reader (dibaca sebagai nama emoji)
 *   5. Ukuran & alignment emoji tidak bisa dikontrol presisi
 *
 * ICON SVG:
 *   - Warna mengikuti `currentColor` → otomatis sesuai konteks
 *   - Ukuran presisi lewat width/height
 *   - Screen reader mengabaikan (aria-hidden) — teks tetap jadi sumber makna
 *   - Satu berkas, nol permintaan jaringan tambahan
 *
 * Gaya: stroke 1.5px, kotak 24×24, sudut membulat — konsisten dengan
 * bahasa desain korporat (Linear, Stripe, Vercel memakai gaya serupa).
 */

/** Buat elemen SVG dari path. */
function svg(paths, { size = 16, strokeWidth = 1.5, className = 'icon' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', String(strokeWidth));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.classList.add(className);

  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    el.appendChild(p);
  }
  return el;
}

/**
 * Katalog icon — nama semantik, bukan nama bentuk.
 * Setiap icon punya jalur yang sudah dioptimalkan (tanpa perintah berlebih).
 */
export const ICONS = {
  // Keamanan & akses
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9z'],
  shield: ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z', 'M9 12l2 2 4-4'],
  key: ['M15 7a4 4 0 1 1-3.5 5.9L4 20.5V17H7v-2h2l2-2', 'M16 8h.01'],
  eye: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],

  // Navigasi & aksi
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  copy: ['M8 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  check: ['M4 12l5 5L20 6'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  external: ['M14 5h5v5', 'M19 5l-9 9', 'M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],

  // Status
  alert: ['M12 3l9.5 16.5H2.5L12 3z', 'M12 10v4', 'M12 17h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  x: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M15 9l-6 6', 'M9 9l6 6'],

  // Dokumen & data
  book: ['M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2V5z', 'M8 7h8', 'M8 11h8'],
  file: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4z', 'M14 3v4h4'],
  code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  server: ['M4 5h16v6H4z', 'M4 13h16v6H4z', 'M8 8h.01', 'M8 16h.01'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],

  // Kontak & orang
  mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  github: ['M9 19c-4 1.5-4-2-6-2.5', 'M15 22v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6-1.5 6-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.9 1.4a13 13 0 0 0-6.9 0C5.1 1.3 3.9 1.7 3.9 1.7a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 2.4 8.9c0 5 3 6.3 6 6.6a3.4 3.4 0 0 0-.9 2.6V22'],

  // Teknis
  terminal: ['M5 7l4 4-4 4', 'M12 15h7'],
  activity: ['M3 12h4l2.5-7 4 14L16 12h5'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
};

/**
 * Render icon sebagai elemen SVG siap pakai.
 * @param {string} name — kunci dari ICONS
 * @param {object} opts — { size, strokeWidth, className }
 * @returns {SVGElement|null}
 */
export function icon(name, opts = {}) {
  const paths = ICONS[name];
  if (!paths) return null;
  return svg(paths, opts);
}

/** String HTML untuk icon — dipakai saat membangun markup lewat innerHTML. */
export function iconHtml(name, { size = 16, strokeWidth = 1.5, className = 'icon' } = {}) {
  const paths = ICONS[name];
  if (!paths) return '';
  const d = paths.map(p => `<path d="${p}"/>`).join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}" class="${className}" aria-hidden="true" focusable="false">${d}</svg>`;
}
