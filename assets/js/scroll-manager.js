/**
 * Scroll Manager — satu listener scroll untuk semua efek.
 *
 * Masalah: setiap modul (hscroll, variable-weight, cinematic, depth, editorial)
 * memasang listener scroll sendiri. 5+ listener = 5+ callback per frame,
 * masing-masing dengan rAF throttle sendiri. Boros dan sulit di-debug.
 *
 * Solusi: satu listener, satu rAF, semua subscriber dipanggil berurutan.
 * Pola yang sama dipakai Stripe/Linear: satu "scroll bus".
 */

const subscribers = new Set();
let scheduled = false;
let lastY = 0;

function tick() {
  scheduled = false;
  const y = window.scrollY;
  const vh = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;

  for (const fn of subscribers) {
    try {
      fn({ y, vh, docHeight, lastY });
    } catch (err) {
      // Satu subscriber gagal tidak boleh mematikan yang lain.
      console.warn('[scroll-manager] subscriber error:', err.message);
    }
  }
  lastY = y;
}

function onScroll() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(tick);
}

let initialized = false;

/** Daftarkan fungsi yang dipanggil setiap frame scroll. Kembalikan unsubscribe. */
export function onScrollFrame(fn) {
  if (!initialized) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    initialized = true;
    lastY = window.scrollY;
  }
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Jumlah subscriber aktif — untuk debugging. */
export function scrollSubscriberCount() {
  return subscribers.size;
}
