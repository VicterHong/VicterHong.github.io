/**
 * Floating Orb Menu
 * Replaces rail navigation — simpler, more playful
 * Follows scroll position and highlights active section
 */

export function initOrbMenu() {
  // Check if rail navigation exists (we're replacing it)
  const existingRail = document.querySelector('.section-rail');
  if (existingRail) {
    existingRail.style.display = 'none'; // Hide old rail
  }

  // Section mapping
  const sections = [
    { id: 's6ahns', label: 'Tentang' },
    { id: 'cckxsk', label: 'Layanan' },
    { id: 'utqvwf', label: 'Proyek' },
    { id: '5nfyzw', label: 'Cara kerja' },
    { id: '89fk39', label: 'Kontak' }
  ];

  // Create orb menu
  const menu = document.createElement('nav');
  menu.className = 'orb-menu';
  menu.setAttribute('aria-label', 'Navigasi cepat');

  const inner = document.createElement('div');
  inner.className = 'orb-menu-inner';

  sections.forEach(section => {
    const orb = document.createElement('a');
    orb.className = 'orb-item';
    orb.href = `#${section.id}`;
    orb.setAttribute('data-label', section.label);
    orb.setAttribute('data-section', section.id);
    orb.setAttribute('aria-label', `Ke bagian ${section.label}`);
    inner.appendChild(orb);
  });

  menu.appendChild(inner);
  document.body.appendChild(menu);

  // Show menu after hero section
  const heroSection = document.querySelector('.hero');
  const heroObserver = new IntersectionObserver(([entry]) => {
    menu.classList.toggle('is-visible', !entry.isIntersecting);
  }, { threshold: 0.1 });

  if (heroSection) heroObserver.observe(heroSection);

  // Track active section
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        const orbs = menu.querySelectorAll('.orb-item');
        orbs.forEach(orb => {
          orb.classList.toggle('is-active', orb.dataset.section === id);
        });
      }
    });
  }, {
    threshold: 0.3,
    rootMargin: '-20% 0px -60% 0px'
  });

  sections.forEach(section => {
    const el = document.getElementById(section.id);
    if (el) sectionObserver.observe(el);
  });

  // Smooth scroll on click
  menu.addEventListener('click', (e) => {
    if (e.target.classList.contains('orb-item')) {
      e.preventDefault();
      const targetId = e.target.dataset.section;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  // Cleanup
  return () => {
    heroObserver.disconnect();
    sectionObserver.disconnect();
    menu.remove();
  };
}
