/**
 * Editorial — sentuhan "exclusive portfolio" dengan gaya khas sendiri.
 *
 * Referensi teknik (Awwwards SOTD / Codrops 2025), DITERAPKAN DENGAN
 * MODIFIKASI supaya tidak meniru persis:
 *
 *   Referensi                      | Yang diadopsi       | Yang dibedakan
 *   -------------------------------|---------------------|---------------------------
 *   Swiss print / offset grid      | Nomor section besar | Nomor memakai format
 *   (Stefan Vitasović)             | sebagai jangkar    | 01—06 + garis aksen,
 *                                  |                     | bukan angka polos
 *   Current-section highlighter    | Rail navigasi kiri  | Rail vertikal dengan
 *   (Stas Bondar)                  | yang menyorot posisi| label kecil, bukan
 *                                  |                     | indikator titik
 *   Editorial minimalism (Untold)  | Marquee teks tipis  | Marquee dua arah
 *                                  | sebagai pemisah     | (satu normal, satu
 *                                  |                     | terbalik) — ritme unik
 *   Brutalist typography           | Eyebrow section     | Eyebrow dengan nomor +
 *   (Max Kruijs)                   | bernomor            | label, gaya korporat
 *
 * Prinsip: setiap elemen harus punya ALASAN, bukan hiasan. Nomor section
 * membantu orientasi di halaman panjang; rail memberi tahu "di mana saya";
 * marquee memberi jeda visual antar blok besar.
 *
 * Semua hormati prefers-reduced-motion; nol dependency.
 */

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 1. PENANDA SECTION (bukan nomor urut) ─────────────────────────────────────
// Nomor 01/02/03 DIHAPUS: section halaman ini tidak berurutan, jadi angka
// menyampaikan informasi yang salah (tell AI — lihat commit message).
// Penggantinya garis aksen saja, yang menyampaikan hal benar tanpa mengklaim urutan.
export function initSectionNumbers() {
  const sections = [...document.querySelectorAll('main > section')]
    .filter((s) => !s.classList.contains('hero'));
  if (!sections.length) return;

  sections.forEach((section) => {
    const head = section.querySelector('.section-head') ?? section;
    if (head.querySelector('.section-eyebrow')) return;

    const eyebrow = document.createElement('p');
    eyebrow.className = 'section-eyebrow';
    eyebrow.setAttribute('aria-hidden', 'true');
    // Hanya garis — tanpa angka. Lihat alasan di atas.
    eyebrow.innerHTML = '<span class="section-rule"></span>';

    // Sisipkan di awal section-head supaya sejajar dengan judul.
    head.prepend(eyebrow);
  });
}

// ── 2. RAIL NAVIGASI SECTION ──────────────────────────────────────────────────
// Rail vertikal di kiri: menunjukkan posisi baca dan memungkinkan lompat antar
// section. Beda dari referensi (indikator titik): di sini rail punya label
// kecil yang muncul saat aktif — lebih informatif, tetap tenang.
export function initSectionRail() {
  if (prefersReduced() || window.innerWidth < 1100) return;
  if (document.querySelector('.section-rail')) return;

  const sections = [...document.querySelectorAll('main > section')]
    .filter((s) => s.id && !s.classList.contains('hero'));
  if (sections.length < 3) return;

  const rail = document.createElement('nav');
  rail.className = 'section-rail';
  rail.setAttribute('aria-label', 'Navigasi bagian');

  const links = [];
  sections.forEach((section, i) => {
    const label = section.querySelector('h2')?.textContent?.trim()
      ?? section.id;
    const link = document.createElement('a');
    link.className = 'section-rail-link';
    link.href = `#${section.id}`;
    link.innerHTML = `<span class="section-rail-num">${String(i + 1).padStart(2, '0')}</span>`
      + `<span class="section-rail-label">${label}</span>`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      section.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
    });
    rail.append(link);
    links.push({ link, section });
  });

  document.body.append(rail);

  // Sorot section yang sedang dilihat. Ambang 0.35 = section dianggap aktif
  // saat sepertiga bagian atasnya masuk viewport — terasa lebih responsif
  // daripada menunggu section penuh terlihat.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = links.find((l) => l.section === entry.target);
      if (!item) continue;
      item.link.classList.toggle('is-active', entry.isIntersecting);
    }
  }, { rootMargin: '-35% 0px -50% 0px', threshold: 0 });

  for (const { section } of links) observer.observe(section);
}

// ── 3. MARQUEE PEMISAH ────────────────────────────────────────────────────────
// Teks berjalan sebagai pemisah antar blok besar. Dua baris dengan arah
// berlawanan — ritme yang jarang dipakai, tetap tenang karena tipografinya
// tipis dan warnanya redup.
export function initMarquee() {
  if (prefersReduced()) return;

  const host = document.querySelector('.marquee-band');
  if (!host || host.dataset.marqueeReady === 'on') return;
  host.dataset.marqueeReady = 'on';

  const phrases = [
    'MINA', 'Spareparts Inventory', 'Self-hosted', 'Zero dependency',
    'Hemat sumber daya', 'Token akses', 'Audit log', 'Auto-revoke',
  ];

  // Dua baris, arah berlawanan. Isi digandakan supaya loop mulus.
  for (const dir of ['left', 'right']) {
    const row = document.createElement('div');
    row.className = `marquee-row marquee-${dir}`;
    const track = document.createElement('div');
    track.className = 'marquee-track';

    // Empat salinan: cukup untuk layar lebar tanpa celah.
    for (let copy = 0; copy < 4; copy += 1) {
      for (const p of phrases) {
        const span = document.createElement('span');
        span.className = 'marquee-item';
        span.textContent = p;
        track.append(span);
      }
    }
    row.append(track);
    host.append(row);
  }
}

// ── 4. EYEBROW SECTION (nomor + label kecil) ─────────────────────────────────
// Sudah ditangani initSectionNumbers — fungsi ini menambahkan kelas pada
// judul section supaya tipografinya bisa diatur terpisah dari judul hero.
export function initSectionTitles() {
  for (const title of document.querySelectorAll('.section-title')) {
    title.classList.add('section-title-editorial');
  }
}

// ── JALANKAN SEMUA ────────────────────────────────────────────────────────────
export function initEditorial() {
  initSectionNumbers();
  initSectionRail();
  initMarquee();
  initSectionTitles();
}
