/**
 * Lapisan gerak tunggal: Lenis (scroll halus) + GSAP ScrollTrigger (masuk saat
 * digulir), satu set token, satu tempat.
 *
 * Aturannya:
 *   - Konten SELALU terlihat tanpa skrip. Kelas `.motion-on` di <html> baru
 *     dipasang setelah pustaka berhasil dimuat; sebelum itu tidak ada yang
 *     disembunyikan. Kalau pustaka gagal dimuat, halaman tetap utuh.
 *   - Hanya transform dan opacity yang dianimasikan.
 *   - `prefers-reduced-motion` mematikan perjalanan (tanpa geser, tanpa scroll
 *     halus) tapi tetap menampilkan semuanya.
 *   - Setiap bagian masuk sebagai urutan: judul, teks, gambar — jeda 70 ms,
 *     naik 24 px. Sekali saja, saat bagian masuk layar.
 *
 * Pustaka divendor di assets/js/vendor (CSP situs `script-src 'self'`).
 */

const EASE = 'power3.out';
const RISE = 24;
const STAGGER = 0.07;
const DURATION = 0.8;

function muat(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`gagal memuat ${src}`));
    document.head.append(s);
  });
}

/** Lokasi pustaka relatif terhadap modul ini, supaya bekerja di /s/<kode>/ juga. */
function vendor(nama) {
  return new URL(`./vendor/${nama}`, import.meta.url).href;
}

const BAGIAN = 'main .section, main .hero, .case-studies, .metrik-bagian, .diagram-bagian, .sandbox-bagian';

/** Anak yang ikut urutan masuk di satu bagian, dalam urutan baca. */
function anakMasuk(bagian) {
  const pilih = [
    ':scope > .section-head > *',
    ':scope > h2', ':scope > .section-note',
    '.service-row', '.project', '.case-panel', '.vm-langkah',
    '.contact-card', '.side-project', 'figure', 'img.hero-shot',
  ];
  const hasil = [];
  for (const sel of pilih) {
    for (const el of bagian.querySelectorAll(sel)) {
      if (!hasil.includes(el)) hasil.push(el);
    }
  }
  return hasil.slice(0, 24);
}

function pasangMasuk(gsap) {
  for (const bagian of document.querySelectorAll(BAGIAN)) {
    if (bagian.classList.contains('hero')) continue;
    const anak = anakMasuk(bagian);
    if (!anak.length) continue;
    // Judul tidak pernah dipudarkan: ia hanya naik. Pembaca yang menggulir cepat,
    // pencetak, dan pembaca layar tetap mendapat judul di setiap posisi.
    const judul = anak.filter((e) => /^H[1-3]$/.test(e.tagName));
    const isi = anak.filter((e) => !judul.includes(e));
    const pemicu = { trigger: bagian, start: 'top 82%', once: true };
    if (judul.length) gsap.from(judul, { y: RISE, duration: DURATION, ease: EASE, scrollTrigger: pemicu });
    if (isi.length) {
      gsap.from(isi, {
        y: RISE,
        autoAlpha: 0,
        duration: DURATION,
        ease: EASE,
        stagger: STAGGER,
        delay: 0.08,
        scrollTrigger: { ...pemicu },
      });
    }
  }
}

/** Langkah tanda: hero masuk berurutan saat halaman dibuka, gambar melayang pelan. */
function pasangHero(gsap) {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  // Judul tetap terbaca sejak frame pertama: hanya naik sedikit, tanpa memudar.
  // Halaman yang judulnya menunggu animasi terasa lambat dan gagal bagi pembaca
  // cepat. Kalimat penjelas dan tombol menyusul dalam 1,2 detik.
  const judul = hero.querySelector('.hero-title');
  if (judul) gsap.from(judul, { y: RISE, duration: 0.9, ease: EASE });
  const urutan = hero.querySelectorAll('.hero-lede, .hero-actions, .hero-stats');
  gsap.from(urutan, { y: RISE, autoAlpha: 0, duration: 0.7, ease: EASE, stagger: 0.08, delay: 0.1 });

  const gambar = hero.querySelector('.hero-shot');
  if (gambar) {
    gsap.from(gambar, { scale: 1.06, autoAlpha: 0, duration: 1.1, ease: 'power2.out' });
    // Hero mengalah saat digulir: gambar sedikit tertinggal dan meredup, jadi
    // seksi berikutnya tidak pernah tertimpa gambar yang masih bergerak.
    gsap.to(gambar, {
      yPercent: 6,
      autoAlpha: 0.35,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'center top', end: 'bottom top', scrub: true },
    });
  }
  const terminal = hero.querySelector('.hero-terminal');
  if (terminal) {
    gsap.from(terminal, { y: 32, autoAlpha: 0, duration: 0.8, ease: EASE, delay: 0.3 });
  }
}

/**
 * Gambar proyek bergeser pelan di DALAM bingkainya (kedalaman ringan).
 * Gambar diperbesar 12% lalu digeser ±5%, jadi tepinya tidak pernah keluar
 * dari figure dan tidak pernah menindih judul di atas atau di bawahnya.
 */
function pasangParalaks(gsap) {
  for (const media of document.querySelectorAll('.project-art img, .project-art video, [data-paralaks]')) {
    const bingkai = media.closest('figure') ?? media.parentElement;
    if (bingkai) bingkai.style.overflow = 'hidden';
    gsap.fromTo(media, { yPercent: -5, scale: 1.12 }, {
      yPercent: 5,
      scale: 1.12,
      ease: 'none',
      scrollTrigger: { trigger: bingkai ?? media, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
}

/**
 * Video loop proyek: diputar hanya saat terlihat, dijeda di luar layar
 * (hemat CPU dan baterai). Tanpa motion layer pun, poster tetap tampil.
 */
export function pasangVideoLoop(root = document) {
  const videos = [...root.querySelectorAll('video.project-loop')];
  if (!videos.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) { v.muted = true; v.play().catch(() => {}); } else v.pause();
    }
  }, { threshold: 0.25 });
  for (const v of videos) io.observe(v);
}

function pasangLenis(Lenis, gsap, ScrollTrigger) {
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // Scroll yang tidak datang dari Lenis (window.scrollTo dari skrip lain,
  // pemulihan posisi browser, lompatan jangkar dari halaman lain) harus
  // dihormati. Tanpa ini Lenis menarik halaman kembali ke posisinya sendiri,
  // dan halaman terasa "macet" di satu bagian.
  // Lompatan besar (lebih dari setengah layar dalam satu peristiwa scroll)
  // bukan gulir roda; itu skrip, jangkar, atau pemulihan posisi. Lenis
  // dihentikan dan disinkronkan ke posisi baru supaya tidak menarik balik.
  let terakhir = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const lompat = Math.abs(y - terakhir) > window.innerHeight * 0.5;
    terakhir = y;
    if (lompat && Math.abs(y - lenis.scroll) > 2) {
      lenis.stop();
      lenis.scrollTo(y, { immediate: true, force: true });
      lenis.start();
    }
  }, { passive: true });

  // Tautan jangkar ikut scroll halus, dengan ruang untuk kepala yang menempel.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"], a[href^="/home#"]');
    if (!a) return;
    const id = a.getAttribute('href').split('#')[1];
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { offset: -84 });
    history.replaceState(null, '', `#${id}`);
  });
  return lenis;
}

export async function initMotion() {
  const tenang = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (tenang) return { aktif: false, alasan: 'reduced-motion' };
  pasangVideoLoop();
  try {
    await muat(vendor('gsap.min.js'));
    await muat(vendor('ScrollTrigger.min.js'));
    await muat(vendor('lenis.min.js'));
  } catch (error) {
    return { aktif: false, alasan: error.message };
  }
  const { gsap, ScrollTrigger, Lenis } = window;
  if (!gsap || !ScrollTrigger || !Lenis) return { aktif: false, alasan: 'pustaka tidak lengkap' };

  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('motion-on');
  const lenis = pasangLenis(Lenis, gsap, ScrollTrigger);
  pasangHero(gsap);
  pasangMasuk(gsap);
  pasangParalaks(gsap);

  // Konten yang dirender belakangan (galeri dari manifest) perlu ukuran ulang.
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.addEventListener('cf-gate:lulus', () => ScrollTrigger.refresh(), { once: true });
  // Nama khusus: `window.__motion` dipakai alat ukur luar, jangan ditimpa.
  window.__vvMotion = { gsap, ScrollTrigger, lenis };
  return { aktif: true };
}
