/**
 * Video narasi per proyek — pemutar ringan yang menghormati preferensi pengguna.
 *
 * Prinsip:
 *   - Lazy: video TIDAK dimuat sampai bagian ini terlihat (IntersectionObserver)
 *   - Hormati prefers-reduced-motion: tampilkan poster statis, tanpa video
 *   - Format: WebM dulu (kecil), MP4 fallback (kompatibel)
 *   - Loop mulus: video dibuat periodik, tidak ada jump saat ulang
 *   - Nol dependency
 *
 * Cara pakai:
 *   const player = createNarrativeVideo({ slug: 'mina', title: '...', caption: '...' });
 *   host.append(player);
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Apakah video untuk slug ini tersedia. */
const AVAILABLE = new Set(['mina', 'spareparts', 'portal', 'hero']);

/**
 * Akar situs — dihitung dari lokasi modul ini.
 * Modul ada di <root>/assets/js/narrative.js, jadi naik tiga tingkat dari
 * file ini menghasilkan akar situs. Ini membuat video tetap ketemu baik
 * halaman berada di root maupun di subfolder seperti /mina/.
 */
function siteRoot() {
  const url = new URL(import.meta.url);
  return new URL('../../../', url).href;
}

/**
 * Buat elemen pemutar video narasi.
 * @param {{slug: string, title: string, caption: string, aspect?: string}} opts
 * @returns {HTMLElement}
 */
export function createNarrativeVideo({ slug, title, caption = '', aspect = '16 / 9' }) {
  const wrap = document.createElement('figure');
  wrap.className = 'narrative-video';

  const frame = document.createElement('div');
  frame.className = 'narrative-frame';
  frame.style.aspectRatio = aspect;

  const available = AVAILABLE.has(slug);

  if (available && !prefersReduced()) {
    // Video dimuat lazy — sumber baru dipasang saat terlihat.
    const video = document.createElement('video');
    video.className = 'narrative-media';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-label', title);

    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      // Nama berkas mengikuti pola <slug>-<tema>
      const names = {
        mina: 'mina-terminal',
        spareparts: 'spareparts-shelf',
        portal: 'portal-door',
        hero: 'hero-narrative',
      };
      const base = names[slug] ?? slug;
      const root = siteRoot();
      video.append(
        Object.assign(document.createElement('source'), { src: `${root}assets/narrative/${base}.webm`, type: 'video/webm' }),
        Object.assign(document.createElement('source'), { src: `${root}assets/narrative/${base}.mp4`, type: 'video/mp4' }),
      );
      video.load();
      video.addEventListener('canplay', () => {
        wrap.classList.add('is-ready');
        video.play().catch(() => { /* autoplay diblokir: poster tetap tampil */ });
      }, { once: true });
    };

    // Lazy: muat saat 200px dari viewport
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { load(); io.disconnect(); }
        }
      }, { rootMargin: '200px' });
      io.observe(wrap);
    } else {
      load();
    }

    frame.append(video);

    // Badge "NARASI" + durasi
    const badge = document.createElement('span');
    badge.className = 'narrative-badge';
    badge.textContent = 'NARASI';
    frame.append(badge);
  } else {
    // Poster statis (reduced-motion atau video belum tersedia)
    const poster = document.createElement('div');
    poster.className = 'narrative-poster';
    poster.innerHTML = `<svg viewBox="0 0 100 56" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="56" fill="#131316"/>
      <g stroke="#ff7a45" stroke-width="0.2" opacity="0.4" fill="none">
        <path d="M15 16 L35 25 L50 19 L68 28 L85 17"/>
        <path d="M18 40 L38 34 L54 43 L72 36 L88 45"/>
        <path d="M35 25 L38 34 M50 19 L54 43 M68 28 L72 36"/>
      </g>
      <g fill="#ffb088">
        <circle cx="15" cy="16" r="0.7"/><circle cx="35" cy="25" r="0.8"/>
        <circle cx="50" cy="19" r="0.9"/><circle cx="68" cy="28" r="0.8"/>
        <circle cx="85" cy="17" r="0.7"/><circle cx="18" cy="40" r="0.7"/>
        <circle cx="38" cy="34" r="0.8"/><circle cx="54" cy="43" r="0.9"/>
        <circle cx="72" cy="36" r="0.8"/><circle cx="88" cy="45" r="0.7"/>
      </g>
    </svg>`;
    frame.append(poster);

    const badge = document.createElement('span');
    badge.className = 'narrative-badge';
    badge.textContent = 'NARASI';
    frame.append(badge);
  }

  wrap.append(frame);

  const cap = document.createElement('figcaption');
  cap.className = 'narrative-caption';
  const h = document.createElement('strong');
  h.textContent = title;
  cap.append(h);
  if (caption) {
    const p = document.createElement('span');
    p.textContent = caption;
    cap.append(p);
  }
  wrap.append(cap);

  return wrap;
}
