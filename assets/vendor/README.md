# Vendor assets for the VIVASTIC portfolio

These files are stored locally and served from the same origin; no runtime CDN is used.

- `assets/js/vendor/gsap.js` → built as `gsap.min.js` — GSAP 3.15.0, `https://gsap.com/standard-license`
- `assets/js/vendor/ScrollTrigger.js` → built as `ScrollTrigger.min.js` — ScrollTrigger 3.15.0, distributed with GSAP 3.15.0, same license
- `assets/js/vendor/lenis.js` → built as `lenis.min.js` — Lenis 1.3.27, MIT; full text in `lenis.LICENSE`
- Lenis' 15-line recommended CSS is included in `assets/css/home-premium.css` and minified during build.

Sources checked against the package registry and official docs on 2026-10-19:
- https://www.npmjs.com/package/gsap
- https://www.npmjs.com/package/lenis
- https://gsap.com/docs/v3/Plugins/ScrollTrigger/
- https://github.com/darkroomengineering/lenis

Only GSAP core, ScrollTrigger, and Lenis are included. Three.js is intentionally not vendored: the existing Canvas 2D renderer already provides the requested particle sphere without a WebGL payload.
