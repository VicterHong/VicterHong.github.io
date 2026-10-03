/**
 * Depth — efek 3D tingkat Framer/Awwwards, nol dependency.
 *
 * Teknik diambil dari komponen Framer Marketplace & Awwwards (2025):
 *   1. Scroll-stand  — kartu proyek "tidur" (rotateX miring + turun) lalu
 *      BERDIRI tegak saat masuk viewport. Pola "Scroll Stand" (Juan Mora /
 *      Awwwards) — reveal yang jauh lebih berkesan daripada fade biasa.
 *   2. Tilt berlapis — kartu miring mengikuti kursor, dan isinya bergeser di
 *      Z yang berbeda (judul lebih maju dari isi) sehingga terasa seperti
 *      objek fisik. Ditambah glare specular yang mengikuti pointer
 *      (teknik Framer "3D Tilt Parallax Card").
 *   3. Spotlight     — sorot radial mengikuti kursor di atas kartu.
 *
 * Prinsip sama dengan astra.js: hanya transform/opacity (GPU compositing),
 * tidak memicu layout; hormati prefers-reduced-motion; gagal-diam.
 *
 * Catatan performa: semua handler pointer memakai rAF-throttle dan hanya
 * menulis CSS custom property — bukan mengganti string transform di setiap
 * event (menghindari style recalc beruntun).
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = () => window.matchMedia('(hover: none)').matches;

// ── 1. SCROLL-STAND ───────────────────────────────────────────────────────────
// Kartu masuk dalam keadaan "tidur" (miring ke belakang + turun + redup),
// lalu berdiri tegak saat discroll. Kemiringan dikurangi berdasarkan jarak
// elemen ke tengah viewport — jadi terasa seperti mengangkat objek.
//
// PENTING: efek ini menulis transform pada elemen yang SAMA dengan tilt
// (initDepthTilt). Karena itu keduanya tidak boleh dipasang pada elemen yang
// sama — di sini scroll-stand memakai pembungkus (.project / .principle)
// dan tilt dipasang pada elemen dalam. Kalau digabung, transform saling
// menimpa dan kartu "melompat".
export function initScrollStand(selector = '.project, .principle, .service-card') {
  if (prefersReduced() || !('IntersectionObserver' in window)) return;

  const cards = [...document.querySelectorAll(selector)];
  if (!cards.length) return;

  // Mulai dari keadaan tidur — CSS menyediakan transisi, JS hanya menandai.
  for (const card of cards) card.classList.add('depth-sleeping');

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target;
      // Jeda bertingkat berdasarkan urutan dalam induk — kartu kedua dan
      // ketiga berdiri setelah yang pertama, seperti berbaris.
      const siblings = [...(card.parentElement?.children ?? [])];
      const idx = Math.max(0, siblings.indexOf(card));
      setTimeout(() => {
        card.classList.remove('depth-sleeping');
        card.classList.add('depth-standing');
      }, Math.min(idx * 110, 550));
      observer.unobserve(card);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  for (const card of cards) observer.observe(card);
}

// ── 2. TILT BERLAPIS + GLARE ──────────────────────────────────────────────────
// Kartu miring mengikuti kursor; isi kartu bergeser di Z berbeda.
// Sudut lebih besar dari astra.initTilt (1.2°) karena di sini tujuannya
// memang terasa 3D — tapi tetap dibatasi supaya teks tidak sulit dibaca.
export function initDepthTilt(selector = '.project-card-inner, .side-project, .terminal') {
  if (prefersReduced() || isTouch()) return;

  for (const card of document.querySelectorAll(selector)) {
    const maxDeg = 4.5;
    let raf = null;
    let glare = card.querySelector(':scope > .depth-glare');
    if (!glare) {
      glare = document.createElement('span');
      glare.className = 'depth-glare';
      glare.setAttribute('aria-hidden', 'true');
      card.append(glare);
    }

    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;

        card.style.setProperty('--rx', ((0.5 - py) * maxDeg * 2).toFixed(2) + 'deg');
        card.style.setProperty('--ry', ((px - 0.5) * maxDeg * 2).toFixed(2) + 'deg');
        card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        card.classList.add('is-tilting');
      });
    };
    const onLeave = () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.classList.remove('is-tilting');
    };

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
  }
}

// ── 3. SPOTLIGHT ──────────────────────────────────────────────────────────────
// Sorot radial halus yang mengikuti kursor di atas kartu. Dipakai di kartu
// proyek unggulan — memberi kesan "permukaan kaca" tanpa gambar.
export function initSpotlight(selector = '.project.is-featured') {
  if (prefersReduced() || isTouch()) return;

  for (const card of document.querySelectorAll(selector)) {
    let raf = null;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--sx', ((e.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
        card.style.setProperty('--sy', ((e.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
      });
    };
    card.addEventListener('pointermove', onMove);
  }
}

// ── JALANKAN SEMUA ────────────────────────────────────────────────────────────
export function initDepth() {
  initScrollStand();
  initDepthTilt();
  initSpotlight();
}
