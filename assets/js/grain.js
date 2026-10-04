/**
 * Film Grain Overlay — optimized.
 *
 * Versi lama: generate ImageData full-viewport 24×/detik → mahal di CPU
 * (di Android mid-range bisa memakan 15-25% CPU terus-menerus).
 *
 * Versi ini: pre-generate N frame noise kecil (128×128), lalu tile ke layar.
 * Biaya CPU hanya saat berpindah frame (bukan generate), dan ukuran kecil
 * membuat memory footprint rendah. Teknik yang sama dipakai di compositing
 * film dan situs production kelas korporasi.
 */

const FRAME_COUNT = 6;        // Variasi frame sebelum mengulang (cukup untuk mata)
const NOISE_SIZE = 128;       // Ukuran tekstur noise (di-tile, bukan full-screen)
const FPS_DESKTOP = 18;       // Sedikit lebih lambat dari 24 — tidak terlihat bedanya
const FPS_MOBILE = 12;        // Mobile lebih hemat baterai

export function initGrain() {
  // Hormati reduced-motion: tidak ada grain sama sekali (bersih + hemat).
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const fps = isMobile ? FPS_MOBILE : FPS_DESKTOP;
  const frameInterval = 1000 / fps;

  // Pre-generate frame noise (sekali saja, dipakai berulang).
  const frames = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const c = document.createElement('canvas');
    c.width = NOISE_SIZE;
    c.height = NOISE_SIZE;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);
    const buf = new Uint32Array(imageData.data.buffer);
    for (let i = 0; i < buf.length; i++) {
      const n = (Math.random() * 255) | 0;
      buf[i] = (255 << 24) | (n << 16) | (n << 8) | n;
    }
    ctx.putImageData(imageData, 0, 0);
    frames.push(c);
  }

  // Layer tampilan: satu canvas kecil yang di-scale + di-tile via CSS.
  const canvas = document.createElement('canvas');
  canvas.className = 'grain-overlay';
  canvas.width = NOISE_SIZE;
  canvas.height = NOISE_SIZE;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let frameIndex = 0;
  let rafId = null;
  let lastSwitch = 0;

  // Jeda saat tab tidak terlihat — nol CPU di background (penting untuk baterai).
  let visible = !document.hidden;
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) loop(performance.now());
  });

  function loop(now) {
    if (!visible) return; // berhenti total saat tab tidak aktif
    rafId = requestAnimationFrame(loop);
    if (now - lastSwitch < frameInterval) return;
    lastSwitch = now;

    frameIndex = (frameIndex + 1) % FRAME_COUNT;
    ctx.drawImage(frames[frameIndex], 0, 0);
  }

  // Frame pertama langsung tampil.
  ctx.drawImage(frames[0], 0, 0);
  rafId = requestAnimationFrame(loop);

  // Cleanup
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    canvas.remove();
  };
}
