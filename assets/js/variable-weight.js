/**
 * Variable Font Weight on Scroll
 * Section titles change weight dynamically based on scroll position
 * Premium typography effect from Obys reference (modified)
 */

export function initVariableWeight() {
  const titles = document.querySelectorAll('[data-variable-weight]');
  if (!titles.length) return;

  // Check reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  // Update weight based on scroll position
  function updateWeights() {
    titles.forEach(title => {
      const rect = title.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // Calculate position in viewport (0 at top, 1 at bottom)
      const positionInViewport = (rect.top + rect.height / 2) / viewportHeight;
      
      // Weight range: 400 (light) when entering → 700 (bold) at center → 400 when leaving
      // Peak weight at viewport center (positionInViewport = 0.5)
      const distanceFromCenter = Math.abs(positionInViewport - 0.5);
      const weight = 400 + (1 - distanceFromCenter * 2) * 300; // 400 to 700
      
      // Clamp between 400 and 700
      const clampedWeight = Math.max(400, Math.min(700, weight));
      
      title.style.fontWeight = Math.round(clampedWeight);
    });
  }

  // Throttled scroll handler
  let rafId;
  function handleScroll() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      updateWeights();
      rafId = null;
    });
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', updateWeights, { passive: true });

  // Initial calculation
  updateWeights();

  // Cleanup
  return () => {
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener('resize', updateWeights);
    if (rafId) cancelAnimationFrame(rafId);
  };
}
