/**
 * Astra — micro-interactions & transisi halus.
 *
 * Prinsip: gerakan harus terasa, bukan terlihat. Semua efek di sini:
 *   - nol dependency, ringan (rAF + transform/opacity saja, tidak memicu layout)
 *   - hormati prefers-reduced-motion — semua efek mati total
 *   - gagal-diam: kalau elemen tidak ada, tidak error
 *
 * Efek yang disediakan:
 *   1. Stagger reveal  — elemen muncul berurutan, bukan serentak
 *   2. Magnetic button — tombol sedikit tertarik ke kursor
 *   3. Card tilt       — kartu miring halus mengikuti kursor
 *   4. Counter         — angka naik saat masuk layar
 *   5. Scroll progress — garis tipis di atas halaman
 *   6. Link underline  — garis bawah tumbuh dari kiri
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 1. STAGGER REVEAL ─────────────────────────────────────────────────────────
// Anak-anak elemen [data-stagger] muncul berurutan dengan jeda kecil.
// Threshold rendah + rootMargin positif = animasi mulai LEBIH AWAL, jadi
// pengguna melihat prosesnya (bukan hasil akhir). Di mobile scroll cepat,
// animasi yang menunggu 10% terlihat sering terlewat.
export function initStagger(root = document) {
  if (prefersReduced()) return;
  const groups = root.querySelectorAll('[data-stagger]');
  if (!groups.length || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const children = [...entry.target.children];
      children.forEach((child, i) => {
        // 90ms per anak (dari 70ms) — selaras dengan stagger judul di template.
        // Batas 480ms (dari 420ms) supaya daftar panjang tidak terasa lambat.
        child.style.transitionDelay = `${Math.min(i * 90, 480)}ms`;
        child.classList.add('astra-in');
      });
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px 8% 0px', threshold: 0.01 });

  for (const g of groups) observer.observe(g);
}

// ── 2. MAGNETIC BUTTON ────────────────────────────────────────────────────────
// Tombol bergeser sedikit ke arah kursor. Kekuatan kecil (maks 4px) supaya halus.
export function initMagnetic(selector = '.btn, .project-link, .contact-link') {
  if (prefersReduced()) return;
  if (window.matchMedia('(hover: none)').matches) return; // sentuh: tidak perlu

  for (const node of document.querySelectorAll(selector)) {
    let raf = null;
    const strength = 0.25;
    const max = 4;

    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = node.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) * strength;
        const dy = (e.clientY - (rect.top + rect.height / 2)) * strength;
        const clamp = (v) => Math.max(-max, Math.min(max, v));
        node.style.transform = `translate(${clamp(dx)}px, ${clamp(dy)}px)`;
      });
    };
    const onLeave = () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      node.style.transform = '';
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    node.addEventListener('blur', onLeave);
  }
}

// ── 3. CARD TILT ──────────────────────────────────────────────────────────────
// CATATAN: fungsi ini sekarang TIDAK dipanggil oleh initAstra() — depth.js
// menggantikannya dengan versi lebih kaya (tilt berlapis + glare + scroll-stand).
// Dibiarkan diekspor supaya masih bisa dipakai manual untuk elemen yang tidak
// ditangani depth.js. Jangan pasang keduanya pada elemen yang sama: keduanya
// menulis properti transform, dan yang terakhir menang.
export function initTilt(selector = '.project, .side-project, .principle') {
  if (prefersReduced()) return;
  if (window.matchMedia('(hover: none)').matches) return;

  for (const card of document.querySelectorAll(selector)) {
    let raf = null;
    const maxDeg = 1.2;

    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg)`;
      });
    };
    const onLeave = () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      card.style.transform = '';
    };

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
  }
}

// ── 4. COUNTER ────────────────────────────────────────────────────────────────
// Angka naik dari 0 ke nilai akhir saat masuk layar. Format id-ID.
export function initCounters(selector = '[data-count]') {
  const nodes = document.querySelectorAll(selector);
  if (!nodes.length) return;

  const format = (n, node) => {
    const decimals = Number(node.dataset.countDecimals ?? 0);
    return Number(n).toLocaleString('id-ID', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const node of nodes) node.textContent = format(node.dataset.count, node);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      observer.unobserve(node);

      const target = Number(node.dataset.count);
      const duration = 900;
      const start = performance.now();

      const tick = (t) => {
        const p = Math.min((t - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        node.textContent = format(target * eased, node);
        if (p < 1) requestAnimationFrame(tick);
        else node.textContent = format(target, node);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.5 });

  for (const node of nodes) {
    node.textContent = format(0, node);
    observer.observe(node);
  }
}

// ── 5. SCROLL PROGRESS ────────────────────────────────────────────────────────
// CATATAN: bar progress sekarang berada di dalam .site-header (dikelola app.js
// watchHeader) supaya menempel pada header sticky. Fungsi ini dibiarkan
// diekspor untuk halaman yang tidak punya header sticky, tapi TIDAK dipanggil
// oleh initAstra() — dua bar akan tampil bersamaan kalau dipanggil.
export function initScrollProgress() {
  if (prefersReduced()) return;
  const bar = document.createElement('div');
  bar.className = 'astra-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.append(bar);

  let raf = null;
  const update = () => {
    raf = null;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  }, { passive: true });
  update();
}

// ── 6. LINK UNDERLINE ─────────────────────────────────────────────────────────
// Sudah murni CSS (.astra-underline). Fungsi ini hanya menandai elemen.
export function initUnderlines(selector = '.site-nav a, .contact-link, .project-link') {
  for (const node of document.querySelectorAll(selector)) {
    node.classList.add('astra-underline');
  }
}

// ── JALANKAN SEMUA ────────────────────────────────────────────────────────────
/** Pasang semua micro-interaction. Panggil setelah DOM siap. */
export function initAstra() {
  initStagger();
  initMagnetic();
  // initTilt() sengaja TIDAK dipanggil: depth.js menangani tilt dengan versi
  // lebih kaya (lapisan Z + glare + scroll-stand). Memanggil keduanya pada
  // elemen yang sama membuat transform saling menimpa.
  initCounters();
  // initScrollProgress() juga TIDAK dipanggil — bar progress ada di dalam
  // header sticky (app.js watchHeader). Memanggil keduanya = dua bar.
  initUnderlines();
}
