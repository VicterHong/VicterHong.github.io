/**
 * Halaman panduan — latar video, progres scroll, header.
 *
 * Diambil dari perilaku halaman utama supaya kedua halaman terasa satu situs:
 *   - Video latar: scroll-scrub di desktop, autoplay loop di perangkat sentuh
 *   - Progres scroll di bawah header
 *   - Header berubah saat digulir
 *
 * Semua gagal-diam: kalau video tidak ada, gradien cadangan yang tampil.
 */

const $ = (sel) => document.querySelector(sel);

// ── 1. VIDEO LATAR ─────────────────────────────────────────────────────────
// Sama seperti halaman utama: dua sumber (WebM kecil, MP4 luas), browser
// memilih sendiri lewat <source>. Tidak ada probe HEAD manual.
function loadHeroVideo() {
  const video = $('#heroVideo');
  if (!video) return;

  // Hormati preferensi pengguna: jangan paksa video bergerak.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const sources = [
    { src: 'assets/hero.webm', type: 'video/webm' },
    { src: 'assets/hero.mp4', type: 'video/mp4' },
  ];

  for (const s of sources) {
    const el = document.createElement('source');
    el.src = s.src;
    el.type = s.type;
    video.appendChild(el);
  }

  const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;

  if (isTouch) {
    // Perangkat sentuh: autoplay loop (scrub tidak terasa dengan jari).
    video.loop = true;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };

    if (video.readyState >= 2) tryPlay();
    else video.addEventListener('canplay', tryPlay, { once: true });

    // Browser mobile sering memblokir autoplay — coba lagi pada interaksi
    // pertama (sentuhan/scroll apa pun dianggap izin).
    const retry = () => { if (video.paused) tryPlay(); };
    for (const evt of ['touchstart', 'touchend', 'click', 'scroll', 'keydown']) {
      window.addEventListener(evt, retry, { once: true, passive: true });
    }
    setTimeout(retry, 2500);
  } else {
    // Desktop: video dikendalikan posisi scroll (scrub).
    video.autoplay = false;
    video.loop = false;
    video.pause();

    let duration = 0;
    let targetTime = 0;
    let currentTime = 0;
    let running = false;

    const setup = () => {
      duration = video.duration;
      if (!duration || !Number.isFinite(duration)) return;

      const update = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        targetTime = progress * duration;
        startLoop();
      };

      const loop = () => {
        // Gerak halus menuju waktu target (lerp) — tidak melompat.
        currentTime += (targetTime - currentTime) * 0.12;
        if (Math.abs(targetTime - currentTime) < 0.01) {
          currentTime = targetTime;
          running = false;
        }
        try { video.currentTime = currentTime; } catch { /* belum siap */ }
        if (running) requestAnimationFrame(loop);
      };

      const startLoop = () => {
        if (running) return;
        running = true;
        requestAnimationFrame(loop);
      };

      window.addEventListener('scroll', update, { passive: true });
      update();
    };

    if (video.readyState >= 1) setup();
    else video.addEventListener('loadedmetadata', setup, { once: true });

    video.addEventListener('loadeddata', () => {
      video.classList.add('is-ready', 'is-scrub');
    }, { once: true });
  }

  video.load();
}

// ── 2. PROGRES SCROLL + HEADER ─────────────────────────────────────────────
function initScrollChrome() {
  const bar = $('#scrollProgress');
  const header = $('.site-header');
  if (!bar && !header) return;

  let scheduled = false;

  const update = () => {
    scheduled = false;

    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
      bar.style.width = pct.toFixed(2) + '%';
    }

    if (header) {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    }
  };

  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

// ── 3. MENU NAVIGASI (layar kecil) ─────────────────────────────────────────
// Di bawah 900px, 6 tautan + CTA tidak muat — nav jadi panel dropdown yang
// dibuka lewat tombol. Tombol CTA tetap terlihat (aksi utama).
function initNavToggle() {
  const toggle = $('#navToggle');
  const nav = $('#siteNav');
  const scrim = $('#navScrim');
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
    // Tirai gelap di belakang panel — memisahkan menu dari konten halaman.
    if (scrim) scrim.classList.toggle('is-visible', open);
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains('is-open'));
  });

  // Klik tirai → tutup.
  if (scrim) scrim.addEventListener('click', () => setOpen(false));

  // Klik tautan → tutup panel (pengguna sudah memilih tujuan).
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  // Klik di luar panel → tutup.
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  // Esc → tutup.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  // Layar diperbesar → pastikan panel tertutup supaya nav desktop normal.
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setOpen(false);
  }, { passive: true });
}

// ── 4. JALANKAN ────────────────────────────────────────────────────────────
loadHeroVideo();
initScrollChrome();
initNavToggle();

// Logo interaktif — sama seperti halaman utama supaya kedua halaman konsisten.
import('./logo.js').then(({ mountInteractiveLogo }) => {
  mountInteractiveLogo();
}).catch(() => { /* logo statis tetap tampil kalau modul gagal dimuat */ });
