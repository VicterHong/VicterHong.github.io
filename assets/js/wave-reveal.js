/**
 * Wave Text Reveal Animation
 * Premium reveal effect — letters wave in with stagger
 * Replaces basic fade-in for section titles
 */

export function initWaveReveal() {
  const targets = document.querySelectorAll('[data-wave-reveal]');
  if (!targets.length) return;

  // Check reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    targets.forEach(el => el.classList.add('revealed'));
    return;
  }

  // Split text into individual letters wrapped in spans
  function splitText(element) {
    const text = element.textContent;
    element.innerHTML = '';
    
    Array.from(text).forEach((char, i) => {
      const span = document.createElement('span');
      span.className = 'wave-char';
      span.textContent = char === ' ' ? '\u00A0' : char; // Preserve spaces
      span.style.setProperty('--char-index', i);
      element.appendChild(span);
    });
  }

  // Intersection Observer for scroll-triggered reveals
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.classList.contains('revealed')) {
        entry.target.classList.add('revealed');
        // Stop observing once revealed
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.3,
    rootMargin: '-50px'
  });

  // Process each target
  targets.forEach(element => {
    splitText(element);
    observer.observe(element);
  });

  // Cleanup
  return () => observer.disconnect();
}
