/**
 * Scroll Spy — tandai tautan navigasi yang sedang aktif.
 *
 * ── MASALAH (audit desain P1-6) ─────────────────────────────────────────────
 *
 * CSS sudah punya aturan `.site-nav a[aria-current="page"]` untuk halaman
 * aktif (dipakai docs.html), tapi TIDAK ada yang menandai SECTION aktif
 * saat pengunjung menggulir halaman utama. Akibatnya pengunjung tidak tahu
 * sedang berada di bagian mana — mereka harus menebak dari isi.
 *
 * ── KENAPA IntersectionObserver, BUKAN SCROLL LISTENER ──────────────────────
 *
 * Cara lama (listener scroll + hitung posisi) berarti satu callback per
 * frame untuk setiap section. Proyek ini sudah punya satu scroll-manager
 * untuk alasan itu — menambah listener baru melanggar arsitektur yang
 * sudah dibangun.
 *
 * IntersectionObserver tidak memanggil apa pun saat menggulir; browser
 * memberi tahu HANYA saat sebuah section melewati batas viewport. Jauh
 * lebih hemat, dan tidak menambah beban di jalur scroll.
 *
 * ── PREFERS-REDUCED-MOTION ──────────────────────────────────────────────────
 *
 * Modul ini TIDAK menggerakkan apa pun — ia hanya menandai tautan aktif
 * dengan atribut. Transisi warnanya ditangani CSS, dan CSS sudah mematikan
 * transisi saat reduced-motion aktif. Jadi modul ini tetap berguna dan
 * tidak perlu dimatikan.
 *
 * ── CARA MENENTUKAN "AKTIF" ─────────────────────────────────────────────────
 *
 * Section dianggap aktif kalau ia menempati bagian atas viewport. Ambang
 * `rootMargin: '-30% 0px -55% 0px'` membuat "garis aktif" berada di 30%
 * dari atas layar:
 *
 *   - Batas atas -30% : section yang baru muncul di 30% teratas dianggap aktif
 *   - Batas bawah -55%: section yang sudah lewat 45% bawah tidak lagi aktif
 *
 * Rentang 15% di tengah itu mencegah kedip saat dua section berbagi layar —
 * tanpa rentang, penanda akan berganti-ganti di titik perbatasan.
 *
 * Kalau TIDAK ada section di rentang itu (mis. di antara dua section),
 * penanda terakhir DIPERTAHANKAN. Melepas penanda di sela-sela membuat
 * navigasi terasa berkedip dan tidak menolong siapa pun.
 */

/** Ambil semua tautan nav yang menunjuk ke anchor halaman ini. */
function navLinks(scope) {
  const nav = scope.querySelector('.site-nav');
  if (!nav) return [];
  return [...nav.querySelectorAll('a[href^="#"]')];
}

/** Ambil section yang jadi target tautan nav. */
function targetSections(links, root) {
  const ids = new Set();
  for (const a of links) {
    const id = a.getAttribute('href')?.slice(1);
    if (id) ids.add(id);
  }
  const out = [];
  for (const id of ids) {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (el) out.push(el);
  }
  return out;
}

/**
 * Aktifkan scroll spy.
 *
 * @param {Document|Element} doc  dokumen atau elemen induk
 * @returns {() => void} fungsi untuk menghentikan
 */
export function initScrollSpy(doc = document) {
  const links = navLinks(doc);
  if (!links.length) return () => {};

  const sections = targetSections(links, doc);
  if (!sections.length) return () => {};

  // Peta section → tautan, supaya penandaan O(1).
  const byId = new Map();
  for (const a of links) {
    const id = a.getAttribute('href')?.slice(1);
    if (id) byId.set(id, a);
  }

  let lastActive = null;

  const setActive = (id) => {
    if (id === lastActive) return;
    lastActive = id;
    for (const [linkId, a] of byId) {
      if (linkId === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  };

  // Simpan section yang sedang terlihat; kalau lebih dari satu,
  // pilih yang paling atas (paling dekat dengan garis aktif).
  const visible = new Set();

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }

    if (visible.size === 0) return; // pertahankan penanda terakhir

    // Pilih yang paling atas di viewport.
    let best = null;
    let bestTop = Infinity;
    for (const el of visible) {
      const top = el.getBoundingClientRect().top;
      if (top < bestTop) { bestTop = top; best = el; }
    }
    if (best?.id) setActive(best.id);
  }, {
    rootMargin: '-30% 0px -55% 0px',
    threshold: 0,
  });

  for (const s of sections) observer.observe(s);

  // Kalau halaman dibuka dengan hash (mis. /home#utqvwf), tandai langsung
  // tanpa menunggu scroll — pengunjung sudah "di" section itu.
  const hash = location.hash.slice(1);
  if (hash && byId.has(hash)) setActive(hash);

  return () => observer.disconnect();
}
