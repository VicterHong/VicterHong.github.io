/**
 * Scroll Manager — satu listener scroll untuk semua efek.
 *
 * Masalah: setiap modul (hscroll, variable-weight, cinematic, depth, editorial)
 * memasang listener scroll sendiri. 5+ listener = 5+ callback per frame,
 * masing-masing dengan rAF throttle sendiri. Boros dan sulit di-debug.
 *
 * Solusi: satu listener, satu rAF, semua subscriber dipanggil berurutan.
 * Pola yang sama dipakai Stripe/Linear: satu "scroll bus".
 *
 * ── PREFERS-REDUCED-MOTION (audit desain Batch 2) ───────────────────────────
 *
 * Modul ini adalah SUMBER semua gerak berbasis scroll — kalau di sini tidak
 * ada pemeriksaan reduced-motion, maka SEMUA subscriber tetap berjalan
 * meski pengguna sudah meminta gerak diminimalkan. Itu masalah karena:
 *
 * 1. Pengguna dengan gangguan vestibular (gangguan keseimbangan/pusing)
 *    bisa mual dan pusing karena parallax serta scroll-linked motion.
 *    Permintaan mereka diabaikan bukan sekadar "kurang sopan" — itu
 *    membuat situs tidak bisa dipakai.
 * 2. CSS `@media (prefers-reduced-motion)` TIDAK menjangkau transform yang
 *    di-set lewat JavaScript. Tanpa pemeriksaan di sini, animasi JS tetap
 *    berjalan meski CSS sudah dimatikan.
 *
 * Yang dilakukan: subscriber TIDAK dipanggil saat reduced-motion aktif.
 * Efeknya semua modul berhenti tanpa perlu diubah satu per satu — mereka
 * hanya tidak menerima panggilan. Nilai akhir (state akhir animasi) harus
 * sudah benar tanpa JS, dan itu memang sudah jadi aturan di proyek ini.
 */

const subscribers = new Set();
let scheduled = false;
let lastY = 0;

/**
 * Baca preferensi pengguna SEKARANG (bukan sekali di awal).
 *
 * Preferensi bisa berubah saat halaman terbuka — pengguna bisa menyalakan
 * "reduce motion" di OS tanpa reload. Karena itu kita dengarkan perubahan,
 * bukan hanya membacanya sekali.
 */
const supportsMq = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
let reducedMotion = supportsMq
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

if (supportsMq) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = (e) => {
    reducedMotion = e.matches;
    // Saat preferensi berubah, beri tahu subscriber sekali dengan nilai
    // terakhir supaya mereka bisa menyetel state akhir yang benar —
    // bukan membiarkan elemen di posisi tengah animasi.
    if (reducedMotion) {
      for (const fn of subscribers) {
        try {
          fn({
            y: window.scrollY,
            vh: window.innerHeight,
            docHeight: document.documentElement.scrollHeight,
            lastY,
            reducedMotion: true,
          });
        } catch { /* diabaikan — sama seperti tick() */ }
      }
    }
  };
  // addEventListener lebih modern; addListener untuk browser lama.
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

function tick() {
  scheduled = false;

  // Reduced-motion: jangan panggil subscriber sama sekali.
  // Tidak ada gerak yang perlu dihitung, jadi tidak ada yang dikerjakan.
  if (reducedMotion) return;

  const y = window.scrollY;
  const vh = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;

  for (const fn of subscribers) {
    try {
      fn({ y, vh, docHeight, lastY, reducedMotion: false });
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

/** Apakah gerak sedang diminimalkan — dipakai modul lain untuk memutuskan. */
export function prefersReducedMotion() {
  return reducedMotion;
}
