/**
 * Panel logo teknologi — SATU kartu besar dengan semua logo, tilt 3D bersama.
 *
 * Kenapa digabung:
 *   - 16 kartu terpisah masing-masing tilt sendiri terlihat "aneh" dan terpecah.
 *     Satu panel memberi kesan tech-stack card yang kohesif (seperti portofolio
 *     premium di Framer/Dribbble).
 *   - Efek tilt lebih terasa: seluruh panel miring sebagai satu bidang.
 *   - Logo tetap interaktif per item: hover menyala sesuai warna merek.
 *
 * Teknik (dari referensi tilt-card Framer):
 *   - perspective pada container, rotateX/rotateY pada panel
 *   - pointermove → hitung posisi relatif → miring maks 10°
 *   - glare/kilau mengikuti kursor
 *   - pointerleave → kembali ke posisi netral dengan transisi
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Buat panel tech-stack yang bisa di-tilt.
 * @param {Array<{group: string, keys: string[]}>} groups
 * @param {Record<string, {label: string, color: string, render: () => SVGElement}>} logos
 * @param {(key: string) => HTMLElement} createCard
 * @returns {HTMLElement}
 */
export function createTiltPanel(groups, logos, createCard) {
  const stage = document.createElement('div');
  stage.className = 'tilt-stage';

  const panel = document.createElement('div');
  panel.className = 'tilt-panel';

  // Glare: kilau yang mengikuti kursor
  const glare = document.createElement('div');
  glare.className = 'tilt-glare';
  glare.setAttribute('aria-hidden', 'true');
  panel.append(glare);

  // Isi: grup + logo
  const content = document.createElement('div');
  content.className = 'tilt-content';

  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'tech-group';

    const title = document.createElement('h3');
    title.className = 'tech-group-title';
    title.textContent = group.group;
    section.append(title);

    const row = document.createElement('div');
    row.className = 'tech-row';
    for (const key of group.keys) {
      row.append(createCard(key));
    }
    section.append(row);
    content.append(section);
  }

  panel.append(content);
  stage.append(panel);

  initTilt(stage, panel, glare);
  return stage;
}

/** Pasang interaksi tilt pada panel. */
function initTilt(stage, panel, glare) {
  if (prefersReduced()) return;

  const isTouch = window.matchMedia('(hover: none)').matches;
  const MAX_DEG = 9;
  let raf = null;

  // Saat pointer bergerak di area stage
  stage.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const rect = panel.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0..1
      const py = (e.clientY - rect.top) / rect.height;   // 0..1

      const rotY = (px - 0.5) * MAX_DEG * 2;
      const rotX = -(py - 0.5) * MAX_DEG * 2;

      panel.style.transform =
        `perspective(1100px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale(1.015)`;
      panel.classList.add('is-active');

      // Glare mengikuti kursor
      glare.style.background =
        `radial-gradient(circle at ${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%, ` +
        'rgba(255, 157, 107, 0.14), transparent 55%)';
      glare.style.opacity = '1';
    });
  });

  stage.addEventListener('pointerleave', () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    panel.style.transform = '';
    panel.classList.remove('is-active');
    glare.style.opacity = '0';
  });

  // Di perangkat sentuh: miringkan sedikit saat panel terlihat (efek statis 3D)
  if (isTouch) {
    panel.style.transform = 'perspective(1100px) rotateX(4deg) rotateY(-3deg)';
  }
}
