/**
 * Logo interaktif — simbol coding yang bergerak mengikuti interaksi user.
 *
 * Konsep: kurung siku `{ }` dengan kursor berkedip, titik oranye di tengah.
 * Bisa digerakkan:
 *   - Hover  → kurung membuka, kursor berkedip cepat
 *   - Klik   → animasi "compile" (kurung menutup lalu membuka)
 *   - Scroll → kurung berputar halus mengikuti posisi halaman
 *
 * Semua vanilla: SVG + rAF. Nol dependency. Hormati prefers-reduced-motion.
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Buat elemen logo interaktif.
 * @returns {SVGElement}
 */
export function createInteractiveLogo() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'logo-mark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Victer logo');

  // Kurung kiri: {
  const left = document.createElementNS(NS, 'path');
  left.setAttribute('d', 'M22 14 C14 14 14 24 14 28 C14 30 12 32 9 32 C12 32 14 34 14 36 C14 40 14 50 22 50');
  left.setAttribute('class', 'logo-bracket logo-bracket-left');

  // Kurung kanan: }
  const right = document.createElementNS(NS, 'path');
  right.setAttribute('d', 'M42 14 C50 14 50 24 50 28 C50 30 52 32 55 32 C52 32 50 34 50 36 C50 40 50 50 42 50');
  right.setAttribute('class', 'logo-bracket logo-bracket-right');

  // Titik tengah (kursor berkedip)
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '32');
  dot.setAttribute('cy', '32');
  dot.setAttribute('r', '3.5');
  dot.setAttribute('class', 'logo-dot');

  // Garis horizontal (seperti underscore kursor)
  const bar = document.createElementNS(NS, 'rect');
  bar.setAttribute('x', '27');
  bar.setAttribute('y', '32');
  bar.setAttribute('width', '10');
  bar.setAttribute('height', '3');
  bar.setAttribute('rx', '1.5');
  bar.setAttribute('class', 'logo-bar');

  svg.append(left, right, dot, bar);

  // ── Animasi ────────────────────────────────────────────────────────────────
  if (prefersReduced()) {
    svg.classList.add('logo-static');
    return svg;
  }

  let state = 'idle';        // idle | hover | click
  let clickUntil = 0;
  let raf = null;

  const animate = () => {
    const now = performance.now();
    if (state === 'click' && now > clickUntil) state = 'hover';

    // Kurung membuka saat hover/klik
    const openAmount = state === 'click' ? 1 : state === 'hover' ? 0.6 : 0;
    const targetOffset = openAmount * 4;
    const targetRotate = state === 'click' ? 180 : 0;

    // Terapkan dengan transisi halus
    const currentLeft = parseFloat(left.dataset.offset || '0');
    const nextLeft = currentLeft + (targetOffset - currentLeft) * 0.15;
    left.dataset.offset = String(nextLeft);
    right.dataset.offset = String(nextLeft);
    left.style.transform = `translateX(${-nextLeft}px)`;
    right.style.transform = `translateX(${nextLeft}px)`;

    // Rotasi saat klik
    const currentRot = parseFloat(svg.dataset.rot || '0');
    const nextRot = currentRot + (targetRotate - currentRot) * 0.12;
    svg.dataset.rot = String(nextRot);
    svg.style.transform = `rotate(${nextRot}deg)`;

    // Kursor berkedip lebih cepat saat hover
    const speed = state === 'idle' ? 1 : 3;
    svg.dataset.blink = String((parseFloat(svg.dataset.blink || '0') + 0.05 * speed) % (Math.PI * 2));
    const blink = Math.sin(parseFloat(svg.dataset.blink));
    bar.style.opacity = state === 'idle'
      ? (blink > 0 ? '1' : '0.15')
      : '1';
    dot.style.opacity = state === 'idle'
      ? (blink > 0 ? '0.9' : '0.4')
      : '1';

    if (state !== 'idle' || Math.abs(nextLeft - targetOffset) > 0.01) {
      raf = requestAnimationFrame(animate);
    } else {
      raf = null;
    }
  };

  const start = () => {
    if (raf) return;
    raf = requestAnimationFrame(animate);
  };

  svg.addEventListener('pointerenter', () => {
    state = 'hover';
    start();
  });
  svg.addEventListener('pointerleave', () => {
    if (state !== 'click') {
      state = 'idle';
      start();
    }
  });
  svg.addEventListener('click', () => {
    state = 'click';
    clickUntil = performance.now() + 900;
    start();
  });

  // Idle blink tetap jalan
  start();

  return svg;
}

/** Ganti brand-mark lama dengan logo interaktif. */
export function mountInteractiveLogo(selector = '.brand-mark') {
  // Beberapa halaman punya lebih dari satu mark (header + kartu login).
  // Ganti SEMUANYA — kalau hanya yang pertama, sisa mark tetap statis dan
  // tampilannya jadi tidak konsisten dalam satu layar.
  const lama = document.querySelectorAll(selector);
  if (!lama.length) return;

  const pertama = createInteractiveLogo();
  pertama.classList.add('brand-mark-live');
  lama[0].replaceWith(pertama);

  // Salinan berikutnya: instance terpisah supaya masing-masing punya state
  // animasi sendiri. Kalau node yang sama dipindah, browser hanya merender
  // satu tempat — mark kedua akan hilang.
  for (let i = 1; i < lama.length; i++) {
    const salinan = createInteractiveLogo();
    salinan.classList.add('brand-mark-live');
    lama[i].replaceWith(salinan);
  }
}
