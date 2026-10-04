/**
 * Magnetic Buttons — physics-based hover untuk tombol & CTA.
 *
 * Kenapa hanya tombol (bukan kartu):
 * Kartu proyek sudah punya transform dari depth.js (scroll-stand + tilt).
 * Dua sumber transform di elemen yang sama = saling menimpa → kartu "lompat".
 * Situs kelas korporasi (Linear, Stripe, Vercel) memakai magnetic HANYA di
 * elemen aksi (tombol/CTA) — di situlah efek terasa premium, bukan di kartu.
 *
 * Implementasi: satu loop lerp bersama untuk semua tombol (hemat CPU),
 * pointer events, hormati reduced-motion + perangkat sentuh.
 */

const MAX_OFFSET = 6;   // px — halus, tidak "melompat" (korporat = restrained)
const LERP = 0.18;      // kecepatan mengejar target

export function initMagneticCards() {
  // Hormati preferensi pengguna & perangkat.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) return;

  const targets = document.querySelectorAll(
    '.btn, .nav-cta, .contact-link, .project-links a, .orb-item'
  );
  if (!targets.length) return;

  // Satu state per tombol; satu rAF loop untuk semuanya.
  const items = [];
  for (const el of targets) {
    if (el.dataset.magneticOn === 'on') continue;
    el.dataset.magneticOn = 'on';
    items.push({ el, x: 0, y: 0, tx: 0, ty: 0, active: false });
  }
  if (!items.length) return;

  let raf = null;
  let running = false;

  function tick() {
    let needsMore = false;

    for (const it of items) {
      it.x += (it.tx - it.x) * LERP;
      it.y += (it.ty - it.y) * LERP;

      // Berhenti menulis kalau sudah cukup dekat (menghindari style churn).
      if (Math.abs(it.tx - it.x) > 0.05 || Math.abs(it.ty - it.y) > 0.05) {
        needsMore = true;
      } else {
        it.x = it.tx;
        it.y = it.ty;
      }

      if (it.x === 0 && it.y === 0 && !it.active) {
        // Kembali istirahat: lepas inline transform supaya CSS bisa mengatur.
        if (it.el.style.transform) it.el.style.transform = '';
        continue;
      }
      it.el.style.transform = `translate3d(${it.x.toFixed(2)}px, ${it.y.toFixed(2)}px, 0)`;
    }

    if (needsMore || items.some(i => i.active)) {
      raf = requestAnimationFrame(tick);
    } else {
      running = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  for (const it of items) {
    it.el.addEventListener('pointermove', (e) => {
      const rect = it.el.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      it.tx = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, relX * 0.22));
      it.ty = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, relY * 0.22));
      it.active = true;
      start();
    });

    it.el.addEventListener('pointerleave', () => {
      it.tx = 0;
      it.ty = 0;
      it.active = false;
      start();
    });
  }

  // Cleanup (dipakai kalau modul di-unmount; di halaman statis tidak wajib).
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}
