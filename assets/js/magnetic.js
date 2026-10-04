/**
 * Magnetic Cards Effect
 * Premium hover interaction — cards follow cursor with smooth physics
 * Applied to project cards for exclusive feel
 */

export function initMagneticCards() {
  const cards = document.querySelectorAll('[data-magnetic]');
  if (!cards.length) return;

  // Check reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  cards.forEach(card => {
    let animationFrameId = null;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    // Smooth lerp (linear interpolation)
    const lerp = (start, end, factor) => start + (end - start) * factor;

    // Mouse move handler
    function handleMouseMove(e) {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate distance from center
      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;

      // Magnetic strength (pixels) — subtle, not aggressive
      const strength = 0.3;
      targetX = deltaX * strength;
      targetY = deltaY * strength;
    }

    // Animation loop with smooth physics
    function animate() {
      // Smooth lerp towards target (spring-like easing)
      currentX = lerp(currentX, targetX, 0.15);
      currentY = lerp(currentY, targetY, 0.15);

      // Apply transform
      card.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(1.02)`;

      // Continue animation if not settled
      if (Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    }

    // Mouse enter — start tracking
    card.addEventListener('mouseenter', () => {
      card.classList.add('is-magnetic-active');
      card.addEventListener('mousemove', handleMouseMove);
    });

    // Mouse move — update targets and animate
    card.addEventListener('mousemove', () => {
      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(animate);
      }
    });

    // Mouse leave — reset
    card.addEventListener('mouseleave', () => {
      card.classList.remove('is-magnetic-active');
      card.removeEventListener('mousemove', handleMouseMove);
      
      // Animate back to rest position
      targetX = 0;
      targetY = 0;
      
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      
      // Spring back animation
      function springBack() {
        currentX = lerp(currentX, 0, 0.2);
        currentY = lerp(currentY, 0, 0.2);
        card.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(1)`;
        
        if (Math.abs(currentX) > 0.1 || Math.abs(currentY) > 0.1) {
          requestAnimationFrame(springBack);
        } else {
          card.style.transform = '';
        }
      }
      springBack();
    });
  });

  // Touch device detection — disable magnetic on touch
  if ('ontouchstart' in window) {
    cards.forEach(card => card.removeAttribute('data-magnetic'));
  }
}
