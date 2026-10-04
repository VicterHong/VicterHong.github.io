/**
 * Horizontal Scroll Pinned Section
 * Premium portfolio showcase — cards scroll sideways while section pinned
 * Inspired by Polar26 + Immersive Garden (modified)
 */

export function initHorizontalScroll() {
  const section = document.querySelector('[data-hscroll]');
  if (!section) return;

  const track = section.querySelector('[data-hscroll-track]');
  if (!track) return;

  // Check reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  let pinned = false;
  let scrollProgress = 0;

  // Calculate scroll distance
  function updateScroll() {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;

    // Start pinning when section enters viewport
    const pinStart = sectionTop - viewportHeight * 0.2;
    const pinEnd = sectionTop + sectionHeight - viewportHeight;

    if (scrollY >= pinStart && scrollY <= pinEnd) {
      pinned = true;
      section.classList.add('is-pinned');

      // Calculate progress (0 to 1)
      const progress = (scrollY - pinStart) / (pinEnd - pinStart);
      scrollProgress = Math.max(0, Math.min(1, progress));

      // Move track horizontally
      const trackWidth = track.scrollWidth;
      const containerWidth = section.offsetWidth;
      const maxScroll = trackWidth - containerWidth;
      const translateX = -maxScroll * scrollProgress;

      track.style.transform = `translate3d(${translateX}px, 0, 0)`;
    } else {
      if (pinned) {
        section.classList.remove('is-pinned');
        pinned = false;
      }
    }
  }

  // Throttled scroll handler (performance)
  let rafId;
  function handleScroll() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      updateScroll();
      rafId = null;
    });
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', updateScroll, { passive: true });

  // Initial calculation
  updateScroll();

  // Cleanup
  return () => {
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener('resize', updateScroll);
    if (rafId) cancelAnimationFrame(rafId);
  };
}
