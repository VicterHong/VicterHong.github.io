const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let started = false;

function revealGridIntro() {
  const hero = document.querySelector('.home-page .hero');
  if (!hero || reducedMotion.matches) return;

  const grid = document.createElement('div');
  grid.className = 'home-pixel-grid';
  grid.setAttribute('aria-hidden', 'true');
  const cells = document.createDocumentFragment();

  for (let column = 0; column < 12; column += 1) {
    for (let row = 0; row < 8; row += 1) {
      const cell = document.createElement('span');
      cell.className = 'home-pixel-cell';
      cell.style.setProperty('--column', String(column));
      cell.style.setProperty('--delay', `${column * 30}ms`);
      cell.style.gridColumn = String(column + 1);
      cell.style.gridRow = String(row + 1);
      cells.append(cell);
    }
  }

  grid.append(cells);
  hero.append(grid);
  window.setTimeout(() => grid.classList.add('is-revealing'), 400);
  // 400ms start + 11 stagger intervals × 30ms + 240ms reveal = 970ms.
  window.setTimeout(() => grid.remove(), 1020);
}

function waitForVendorGlobals() {
  const ready = () => Boolean(window.gsap && window.ScrollTrigger && window.Lenis);
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoad = () => ready()
      ? resolve()
      : reject(new Error('Library motion lokal tidak siap.'));
    window.addEventListener('load', onLoad, { once: true });
    if (document.readyState === 'complete') onLoad();
  });
}

function exposeContentIfMotionFails() {
  document.querySelectorAll('[data-reveal]').forEach((node) => node.classList.add('is-visible'));
  document.querySelectorAll('[data-cine-clip]').forEach((node) => node.classList.add('cine-clip-in'));
}

const SECTION_MOTIFS = [
  { selector: '.home-page main > .hero', layers: ['.hero-copy', '.hero-visual'] },
  { selector: '.home-page #s6ahns', layers: ['.section-head', '.about-layout'] },
  { selector: '.home-page #utqvwf', layers: ['.section-head', '.projects-bento', '.side-projects'] },
  { selector: '.home-page #cckxsk', layers: ['.section-head', '.services-grid'] },
  { selector: '.home-page [id="5nfyzw"]', layers: ['.vm-papan'] },
  { selector: '.home-page [id="89fk39"]', layers: ['.section-title', '.contact-lede', '.contact-links'] },
];

async function initializeMotion(fromGate) {
  try {
    await waitForVendorGlobals();

    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    const Lenis = window.Lenis;
    if (!gsap || !ScrollTrigger || !Lenis) throw new Error('Library motion lokal tidak siap.');

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({
      autoRaf: false,
      anchors: true,
      smoothWheel: true,
      syncTouch: false,
      lerp: 0.12,
    });
    lenis.on('scroll', ScrollTrigger.update);

    const tickLenis = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tickLenis);
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add('lenis-active');

    const timelines = [];
    for (const motif of SECTION_MOTIFS) {
      const section = document.querySelector(motif.selector);
      if (!section) continue;
      const layers = motif.layers
        .map((selector) => section.querySelector(selector))
        .filter((node) => node && node.getClientRects().length > 0);
      if (!layers.length) continue;

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.65,
          invalidateOnRefresh: true,
        },
      });

      layers.forEach((layer, index) => {
        const depth = [0.15, 0.3, 0.5][index] ?? 0.3;
        const travel = depth * 76;
        timeline.fromTo(layer,
          { y: travel },
          { y: -travel, ease: 'none' },
          0,
        );
      });
      timelines.push(timeline);
    }

    // Refresh after the challenge uncovers the page. This listener is
    // registered unconditionally: the gate class can be applied AFTER
    // DOMContentLoaded (cf-gate.js runs later), so even the non-gate path may
    // have measured zero-size sections. One refresh on reveal fixes both.
    requestAnimationFrame(() => ScrollTrigger.refresh(true));
    document.addEventListener('cf-gate:lulus', () => {
      requestAnimationFrame(() => ScrollTrigger.refresh(true));
      if (document.fonts?.ready) document.fonts.ready.then(() => ScrollTrigger.refresh(true));
    }, { once: true });

    window.addEventListener('pagehide', () => {
      lenis.destroy();
      gsap.ticker.remove(tickLenis);
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      document.documentElement.classList.remove('lenis-active');
    }, { once: true });

    window.__vivasticMotion = { lenis, gsap, ScrollTrigger, timelines };
  } catch (error) {
    exposeContentIfMotionFails();
    document.documentElement.classList.remove('lenis-active');
    console.warn('[home-motion] Animasi tambahan tidak aktif; konten tetap tersedia.', error);
  }
}

function start(fromGate = false) {
  if (started) return;
  if (reducedMotion.matches) { started = true; return; }
  if (document.body.classList.contains('cf-gated')
      || document.documentElement.classList.contains('cf-gating')) return;
  started = true;
  revealGridIntro();
  void initializeMotion(fromGate);
}

// Gate detection at module load can race cf-gate.js, which applies
// body.cf-gated after this module executes. Registering the listener on every
// load covers both orders; `start` is idempotent so a double fire is harmless.
if (document.body.classList.contains('home-page')) {
  document.addEventListener('cf-gate:lulus', () => start(true), { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start(false), { once: true });
  } else {
    start(false);
  }
  window.setTimeout(() => start(false), 8500);
}
