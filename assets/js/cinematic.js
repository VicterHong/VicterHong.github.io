/**
 * Cinematic scroll effects — teknik dari template PRIOR, ditulis ulang vanilla.
 *
 * Prinsip:
 *   - Nol dependency (PRIOR pakai GSAP; kita pakai rAF + IntersectionObserver)
 *   - Video 2 MB, bukan 265 MB frame sequence — preloader tidak perlu
 *   - Hormati prefers-reduced-motion: semua efek mati, konten langsung terlihat
 *   - Semua animasi hanya transform/opacity/clip-path (tidak memicu layout)
 *
 * Efek:
 *   1. Scroll-scrub video  — video hero berjalan mengikuti posisi scroll
 *   2. Clip-path reveal    — section membuka dari inset kecil ke penuh
 *   3. Parallax            — elemen bergerak dengan kecepatan berbeda saat scroll
 *   4. Text stagger        — kata muncul berurutan saat masuk layar
 *   5. Hero fade           — konten hero memudar saat digulir
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── UTIL: rAF throttle ────────────────────────────────────────────────────────
/** Bungkus handler scroll supaya jalan maksimal sekali per frame. */
function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

/** Bagi teks heading menjadi <span class="cine-word"> per kata.
 *  Menangani elemen bersarang (mis. <span class="accent">) — hanya simpul teks
 *  yang dipecah, jadi styling di dalam heading tetap utuh. */
export function splitWords(el) {
  if (!el || el.dataset.cineSplit === 'done') return [...el.querySelectorAll('.cine-word')];

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const textNode of textNodes) {
    const words = textNode.textContent.split(/(\s+)/); // simpan spasi
    const frag = document.createDocumentFragment();
    for (const part of words) {
      if (/^\s+$/.test(part) || part === '') {
        frag.append(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'cine-word';
        span.textContent = part;
        frag.append(span);
      }
    }
    textNode.replaceWith(frag);
  }

  el.dataset.cineSplit = 'done';
  return [...el.querySelectorAll('.cine-word')];
}

// ── 1. SCROLL-SCRUB VIDEO ─────────────────────────────────────────────────────
/**
 * Video hero tidak autoplay — ia "dikendalikan" posisi scroll.
 * Scroll ke bawah = video maju; scroll ke atas = video mundur.
 * Jauh lebih hemat baterai daripada autoplay loop terus-menerus.
 */
export function initScrollScrubVideo(selector = '#heroVideo') {
  const video = document.querySelector(selector);
  if (!video) return;

  if (prefersReduced()) {
    // Gerakan minimal: tampilkan poster/frame awal saja, tanpa scrub.
    video.pause();
    return;
  }

  // Di perangkat sentuh (mobile/tablet) scrub tidak terasa: pengguna menggulir
  // dengan jari dan tidak melihat hubungan sebab-akibat antara gulir dan video.
  // Lebih baik video berjalan sendiri (autoplay loop) — itulah yang membuat
  // halaman terasa hidup di HP.
  //
  // Loop MULUS tidak lagi diakali dari JS: berkas videonya sendiri sudah
  // seamless (dibuat oleh scripts/make-seamless-loop.sh — crossfade tail→head
  // sehingga frame awal == frame akhir). Atribut `loop` bawaan browser sudah
  // cukup, dan justru paling mulus karena tidak ada seek saat pergantian.
  const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  if (isTouch) {
    video.loop = true;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true; // iOS requirement
    video.setAttribute('playsinline', '');

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* diblokir */ });
    };

    if (video.readyState >= 2) tryPlay();
    else video.addEventListener('canplay', tryPlay, { once: true });

    // Browser mobile sering memblokir autoplay saat mode hemat baterai/data.
    // Coba lagi pada interaksi pertama — sentuhan/scroll apa pun dianggap
    // izin oleh browser. Poster tetap tampil sampai berhasil.
    const retry = () => {
      if (!video.paused) return;
      tryPlay();
    };
    for (const evt of ['touchstart', 'touchend', 'click', 'scroll', 'keydown']) {
      window.addEventListener(evt, retry, { once: true, passive: true });
    }
    // Percobaan terakhir setelah beberapa detik (kadang metadata baru siap).
    setTimeout(retry, 2500);

      // ── HEMAT BATERAI: JANGAN DECODE VIDEO SAAT TIDAK TERLIHAT ──────────
      // Video autoplay loop berarti browser terus mendecode frame — itu beban
      // CPU/GPU nyata yang tidak berhenti selama halaman terbuka. Di HP,
      // decode video 720p terus-menerus adalah penyebab baterai boros terbesar.
      //
      // ── KENAPA PAKAI SCROLL, BUKAN IntersectionObserver ─────────────────
      // Percobaan pertama pakai IntersectionObserver dan GAGAL: video hero
      // ber-`position: fixed`, jadi ia SELALU "terlihat" menurut observer —
      // meskipun pengunjung sudah menggulir jauh ke bawah. Terukur:
      // `terlihatDiLayar: true` padahal scrollY sudah di bagian carousel.
      //
      // Yang benar: video hero relevan HANYA saat pengunjung masih di bagian
      // atas halaman. Jadi patokannya posisi SCROLL, bukan posisi elemen.
      //
      // Ambang 1.2× tinggi layar: di bawah itu video masih "bagian dari
      // pengalaman"; di atasnya pengunjung sudah pindah ke konten lain.
      let videoAktif = true;
      const cekVideo = () => {
        const harusJalan = window.scrollY < window.innerHeight * 1.2;
        if (harusJalan && !videoAktif) {
          videoAktif = true;
          if (video.paused) tryPlay();
        } else if (!harusJalan && videoAktif) {
          videoAktif = false;
          video.pause();
        }
      };
      // rAF-throttle: scroll bisa memicu 100+ kali/detik, dan cekVideo hanya
      // perlu dijalankan sekali per frame.
      let rafVideo = null;
      window.addEventListener('scroll', () => {
        if (rafVideo) return;
        rafVideo = requestAnimationFrame(() => {
          rafVideo = null;
          cekVideo();
        });
      }, { passive: true });
      cekVideo();

      // Tab disembunyikan → pause. Tab kembali → lanjut kalau masih di atas.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          video.pause();
        } else if (window.scrollY < window.innerHeight * 1.2 && video.paused) {
          tryPlay();
        }
      });

      return;
    }

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

    // Smoothing: currentTime mendekati target perlahan — menghindari patah-patah.
    const loop = () => {
      const delta = targetTime - currentTime;
      if (Math.abs(delta) < 0.008) {
        currentTime = targetTime;
        running = false;
      } else {
        currentTime += delta * 0.14;
        requestAnimationFrame(loop);
      }
      try { video.currentTime = currentTime; } catch { /* metadata belum siap */ }
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      requestAnimationFrame(loop);
    };

    window.addEventListener('scroll', rafThrottle(update), { passive: true });
    update();
  };

  if (video.readyState >= 1) setup();
  else video.addEventListener('loadedmetadata', setup, { once: true });
}

// ── 2. CLIP-PATH REVEAL ───────────────────────────────────────────────────────
/**
 * Section membuka seperti lensa: dari inset(18% 14%) ke inset(0).
 * Dipakai untuk section utama — memberi kesan "masuk ke dalam" halaman.
 */
export function initClipReveal(selector = '[data-cine-clip]') {
  const targets = document.querySelectorAll(selector);
  if (!targets.length) return;

  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const t of targets) t.classList.add('cine-clip-in');
    return;
  }

  // Threshold rendah + rootMargin positif: reveal mulai saat section baru
  // menyentuh tepi bawah layar. Di mobile, section tinggi sering tidak pernah
  // mencapai 12% terlihat sebelum pengguna scroll melewatinya.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('cine-clip-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px 10% 0px', threshold: 0.01 });

  for (const t of targets) observer.observe(t);
}

// ── 3. PARALLAX ───────────────────────────────────────────────────────────────
/**
 * Elemen [data-cine-parallax] bergerak vertikal lebih lambat dari scroll.
 * Nilai data = kekuatan dalam piksel (contoh: data-cine-parallax="40").
 * Dipakai di latar/aksen, bukan teks utama — supaya tetap terbaca.
 */
export function initParallax(selector = '[data-cine-parallax]') {
  const targets = [...document.querySelectorAll(selector)];
  if (!targets.length || prefersReduced()) return;

  const update = () => {
    const vh = window.innerHeight;
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -100 || rect.top > vh + 100) continue; // di luar layar
      const strength = Number(el.dataset.cineParallax) || 30;
      // -1 (bawah layar) → +1 (atas layar)
      const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
      el.style.transform = `translate3d(0, ${(-progress * strength).toFixed(1)}px, 0)`;
    }
  };

  window.addEventListener('scroll', rafThrottle(update), { passive: true });
  window.addEventListener('resize', rafThrottle(update), { passive: true });
  update();
}

// ── 4. TEXT STAGGER ───────────────────────────────────────────────────────────
/**
 * Heading dipecah per kata, lalu muncul berurutan saat masuk layar.
 * Mirip .intro__heading PRIOR.
 */
export function initTextStagger(selector = '[data-cine-words]') {
  const targets = document.querySelectorAll(selector);
  if (!targets.length) return;

  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const el of targets) el.classList.add('cine-words-in');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const words = splitWords(el);
      words.forEach((w, i) => {
        w.style.transitionDelay = `${Math.min(i * 55, 500)}ms`;
      });
      el.classList.remove('cine-words-pending');
      el.classList.add('cine-words-in');
      observer.unobserve(el);
    }
  }, { rootMargin: '0px 0px 12% 0px', threshold: 0.01 });

  for (const el of targets) {
    // Sembunyikan kata SEBELUM masuk layar supaya tidak ada flash.
    el.classList.add('cine-words-pending');
    observer.observe(el);
  }
}

// ── 5. HERO FADE ──────────────────────────────────────────────────────────────
/**
 * Konten hero memudar + bergerak naik saat digulir — memberi kedalaman
 * dan mendorong mata ke bagian berikutnya.
 */
export function initHeroFade(selector = '.hero') {
  const hero = document.querySelector(selector);
  if (!hero || prefersReduced()) return;

  const content = hero.querySelectorAll('.hero-kicker, .hero-title, .hero-lede, .hero-actions, .hero-stats');
  if (!content.length) return;

  const update = () => {
    const rect = hero.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -rect.top / (rect.height * 0.7)));
    const opacity = 1 - progress * 0.85;
    const shift = progress * 36;
    for (const el of content) {
      el.style.opacity = opacity.toFixed(3);
      el.style.transform = `translate3d(0, ${-shift.toFixed(1)}px, 0)`;
    }
  };

  window.addEventListener('scroll', rafThrottle(update), { passive: true });
  // Sengaja TIDAK memanggil update() langsung: entrance animation sedang
  // berjalan saat init, dan update() akan menimpa opacity-nya sehingga animasi
  // masuk tidak terlihat. Fade baru aktif saat pengguna benar-benar menggulir.
  // Kalau halaman dibuka dalam keadaan sudah tergulir, scroll event berikutnya
  // yang menyinkronkan posisi.
  if (window.scrollY > 4) update();
}

// ── 6. ENTRANCE ANIMATION ─────────────────────────────────────────────────────
/**
 * Animasi saat halaman dimuat — TIDAK bergantung scroll.
 *
 * Kenapa penting: di mobile, pengguna sering scroll cepat sehingga animasi
 * berbasis scroll terlewat. Entrance animation selalu terlihat karena berjalan
 * begitu halaman siap, apa pun kecepatan scroll pengguna.
 */
export function initEntrance(selector = '.hero-kicker, .hero-title, .hero-lede, .hero-actions, .hero-stats') {
  if (prefersReduced()) return;

  const nodes = [...document.querySelectorAll(selector)];
  if (!nodes.length) return;

  // Mulai dari keadaan tersembunyi, lalu muncul berurutan.
  // Durasi & kurva disamakan dengan [data-reveal] di CSS: 720ms easeOutQuart.
  // Sebelumnya 850ms cubic-bezier(0.2, 0.7, 0.3, 1) — kurva itu berhenti lebih
  // mendadak, sehingga hero terasa "jepret" dibanding section di bawahnya.
  nodes.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translate3d(0, 1.375rem, 0)';
    el.style.transition = 'opacity 720ms cubic-bezier(0.165, 0.84, 0.44, 1), transform 720ms cubic-bezier(0.165, 0.84, 0.44, 1)';
    el.style.transitionDelay = `${i * 110}ms`;
  });

  // Jalankan setelah frame berikutnya supaya transisi terpicu.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nodes.forEach((el) => {
        el.style.opacity = '';
        el.style.transform = '';
      });
    });
  });

  // Bersihkan inline style setelah selesai supaya hero-fade bisa mengambil alih.
  const totalMs = nodes.length * 110 + 720;
  setTimeout(() => {
    nodes.forEach((el) => {
      el.style.transition = '';
      el.style.transitionDelay = '';
    });
  }, totalMs);
}

// ── JALANKAN SEMUA ────────────────────────────────────────────────────────────
/** Pasang semua efek sinematik. Panggil setelah DOM siap. */
export function initCinematic() {
  initEntrance();        // jalan seketika — selalu terlihat
  initScrollScrubVideo();
  initClipReveal();
  initParallax();
  initTextStagger();
  initHeroFade();
}
