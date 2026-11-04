/**
 * Motion kartu proyek: reveal scroll + parallax foto.
 * Hanya menggerakkan foto, bukan seluruh kartu atau teks.
 */

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
);

// Parallax foto: foto bergerak pelan di dalam bingkainya saat scroll
function parallaxPhotos() {
  const photos = document.querySelectorAll('.project-art__photo');
  const viewportHeight = window.innerHeight;
  
  for (const photo of photos) {
    const rect = photo.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const offsetFromCenter = (viewportHeight / 2 - centerY) / viewportHeight;
    const translateY = offsetFromCenter * 20; // -20px to +20px range
    photo.style.setProperty('--parallax-y', `${translateY}px`);
  }
}

let rafId = null;
function onScroll() {
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      parallaxPhotos();
      rafId = null;
    });
  }
}

export function initCardMotion() {
  // Reveal: kartu naik saat masuk viewport
  const revealTargets = document.querySelectorAll('.project-art--reveal');
  for (const target of revealTargets) revealObserver.observe(target);

  // Parallax: foto bergerak saat scroll
  const hasPhotos = document.querySelector('.project-art__photo');
  if (hasPhotos) {
    parallaxPhotos();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
}
