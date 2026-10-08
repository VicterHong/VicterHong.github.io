/**
 * Portofolio — logika tampilan.
 *
 * Tidak memakai framework: situs ini beberapa halaman teks dan satu video. React atau
 * Vue akan menambah ratusan kilobita untuk pekerjaan yang bisa diselesaikan puluhan
 * baris DOM. GitHub Pages menyajikan berkas statis apa adanya, jadi tidak ada build
 * step yang bisa rusak.
 *
 * Video hero dimuat dengan SENGAJA gagal-diam: kalau berkasnya belum ada (Higgsfield
 * belum dijalankan), gradien cadangan yang tampil — bukan kotak hitam kosong.
 */

import { profile, about, services, projects, sideProjects, principles, stats } from './data/projects.js';
import { initAstra } from './astra.js';
import { initDepth } from './depth.js';
import { initEditorial } from './editorial.js';
import { initGrain } from './grain.js';
import { initWaveReveal } from './wave-reveal.js';
import { initMagneticCards } from './magnetic.js';
import { initHorizontalScroll } from './hscroll.js';
import { initOrbMenu } from './orb-menu.js';
import { initVariableWeight } from './variable-weight.js';
import { initAllVideoPlayers } from './video-player.js';
import { initMasonry } from './masonry.js';
import { initVitals } from './vitals.js';
import { initExperiments } from './experiment.js';
import { initCookieConsent, consentGiven } from './cookies.js';
import { initRipple } from './ripple.js';
import { initCinematic } from './cinematic.js';
import { pasangMonogram } from './monogram.js';
import { techGroups, techLogos, createTechCard } from './tech-logos.js';
import { createTiltPanel } from './tilt-panel.js';
import { initScrollSpy } from './scroll-spy.js';
import { createSpotlightCarousel } from './spotlight.js';
import { ambilManifest, susunGambar, pantauPerubahan } from './media-loader.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
};

// ── ANGKA RINGKAS ──────────────────────────────────────────────────────────────
// Dihitung dari data proyek, jadi tidak bisa "basi" saat proyek baru ditambahkan.
function renderStats() {
  const s = stats();
  const host = $('#heroStats');
  const entries = [
    { label: 'proyek', value: String(s.projects) },
    { label: 'tes otomatis', value: s.tests.toLocaleString('id-ID') },
    { label: 'teknologi', value: String(s.stacks) },
  ];
  for (const entry of entries) {
    host.append(el('div', {},
      el('dd', { 'data-count': entry.value.replace(/\./g, ''), text: entry.value }),
      el('dt', { text: entry.label }),
    ));
  }
}

// ── TENTANG ────────────────────────────────────────────────────────────────────
function renderAbout() {
  const host = $('#aboutBody');
  if (!host) return;
  for (const p of about.paragraphs) {
    host.append(el('p', { text: p }));
  }

  // Panel tech-stack: SATU kartu besar dengan semua logo, tilt 3D bersama.
  // Menggantikan 16 kartu terpisah yang masing-masing tilt sendiri (terlihat
  // terpecah). Satu panel = kesan tech-stack card yang kohesif.
  const skillsHost = $('#aboutSkills');
  if (!skillsHost) return;

  const panel = createTiltPanel(techGroups, techLogos, createTechCard);
  skillsHost.append(panel);

  initTechPulse(skillsHost);
}

/** Pulse saat logo diklik — jalan di semua perangkat, termasuk sentuh. */
function initTechPulse(root) {
  for (const item of root.querySelectorAll('.tech-item')) {
    item.addEventListener('click', () => {
      item.classList.remove('is-pulse');
      void item.offsetWidth; // paksa reflow supaya animasi bisa diulang
      item.classList.add('is-pulse');
      setTimeout(() => item.classList.remove('is-pulse'), 480);
    });
  }
}

// ── LAYANAN ────────────────────────────────────────────────────────────────────
/**
 * Kartu layanan dengan ikon.
 *
 * ── KENAPA IKON DITAMBAHKAN (audit desain + referensi Kombai) ───────────────
 *
 * Diukur: kartu 506x138px tapi isi teks hanya 48px — densitas 35%, artinya
 * 65% ruang kosong. Section terasa sparse dan kartu terlihat seperti pita tipis.
 *
 * Referensi dari Kombai Gallery (Features/Axiom) mengisi ruang kartu dengan
 * elemen visual 220-300px. Kita tidak perlu sebesar itu — cukup ikon yang
 * memberi jangkar visual dan membuat mata tahu di mana mulai membaca.
 *
 * Ikon diambil dari sistem yang SUDAH ADA (30 ikon SVG stroke 1.5px di
 * icons.js) — tidak menambah dependency, tidak menambah berat halaman.
 */
function renderServices() {
  const host = $('#servicesGrid');
  if (!host) return;
  for (const s of services) {
    const card = el('article', { class: 'service-card' });

    // Ikon: aria-hidden karena murni dekoratif — judul sudah menjelaskan
    // maksud kartu. Membacakannya akan mengulang informasi.
    const ic = s.icon ? icon(s.icon, { size: 22, strokeWidth: 1.5 }) : null;
    if (ic) {
      const wrap = el('span', { class: 'service-icon' });
      wrap.setAttribute('aria-hidden', 'true');
      wrap.append(ic);
      card.append(wrap);
    }

    card.append(
      el('h3', { text: s.title }),
      el('p', { text: s.body }),
    );
    host.append(card);
  }
}

// ── ARTEFAK PROYEK ─────────────────────────────────────────────────────────────
/**
 * Visual ringkas per proyek — dari DATA ASLI, bukan screenshot generik.
 *
 * ── KENAPA (PRD desain, diagnosis) ──────────────────────────────────────────
 *
 * "Isi kartu dominan teks. Mata melihat judul dan paragraf panjang, bukan
 *  artefak yang mewakili proyek. Tanpa visual data, perspektif kartu hanya
 *  membengkokkan bidang gelap."
 *
 * ── ATURAN DARI PRD ─────────────────────────────────────────────────────────
 *
 * "Jangan isi artefak dengan angka, log, atau percakapan rekaan. Semua isi
 *  harus bersumber dari data proyek."
 *
 * Jadi: MINA menampilkan metrik nyata (231 tes, ~25 MB, MIT) + stack.
 * Spareparts tidak punya metrics[] — jadi menampilkan label kategori + stack,
 * BUKAN angka karangan. WhatsApp sama.
 *
 * Tiap proyek dapat komposisi berbeda (variasi `variant`) supaya terlihat
 * sebagai tiga karya tersendiri, bukan tiga panel seragam.
 */
function renderProjectArt(p) {
  const art = el('figure', { class: `project-art project-art--${p.variant ?? 'default'}` });

  // Baris atas: label kategori atau judul
  const top = el('div', { class: 'project-art__accent' });
  if (p.metrics?.length) {
    // Proyek dengan metrik: tampilkan angka besar (data nyata)
    const dl = el('dl', { class: 'project-art__metrics' });
    for (const m of p.metrics) {
      dl.append(el('div', { class: 'project-art__metric' },
        el('dd', { text: m.value }),
        el('dt', { text: m.label }),
      ));
    }
    top.append(dl);
  } else {
    // Proyek tanpa metrik: label kategori, bukan angka rekaan
    top.append(el('p', { class: 'project-art__label', text: p.artLabel ?? 'Proyek' }));
  }
  art.append(top);

  // Baris bawah: stack sebagai chip
  const stack = el('div', { class: 'project-art__stack project-art__detail' });
  for (const tech of (p.stack ?? []).slice(0, 5)) {
    stack.append(el('span', { class: 'project-art__chip', text: tech }));
  }
  art.append(stack);

  return art;
}

// ── PROYEK ─────────────────────────────────────────────────────────────────────
function renderProjects() {
  const host = $('#featuredProjects');

  for (const p of projects) {
    const card = el('article', { class: `project${p.featured ? ' is-featured' : ''}` });
    // Pembungkus dalam: efek scroll-stand menulis transform pada `.project`,
    // sedangkan tilt menulis transform pada `.project-card-inner`. Dua efek
    // 3D pada elemen yang sama akan saling menimpa transform — pemisahan ini
    // yang membuat keduanya bisa hidup berdampingan.
    const inner = el('div', { class: 'project-card-inner' });

    // Artefak visual dari data asli — sebelum teks, supaya mata punya
    // titik masuk sebelum membaca.
    inner.append(renderProjectArt(p));

    inner.append(el('div', { class: 'project-head' },
      el('h3', { class: 'project-name', text: p.name }),
      el('span', { class: 'project-sub', text: p.subtitle }),
    ));
    inner.append(el('p', { class: 'project-summary', text: p.summary }));
    if (p.problem) inner.append(el('p', { class: 'project-problem', text: p.problem }));

    const highlights = el('div', { class: 'project-highlights' });
    for (const h of p.highlights) {
      highlights.append(el('div', { class: 'highlight' },
        el('h4', { text: h.title }),
        el('p', { text: h.detail }),
      ));
    }
    inner.append(highlights);

    const foot = el('div', { class: 'project-foot' });

    if (p.metrics.length) {
      const metrics = el('dl', { class: 'project-metrics' });
      for (const m of p.metrics) {
        metrics.append(el('div', {},
          el('dd', { text: m.value }),
          el('dt', { text: m.label }),
        ));
      }
      foot.append(metrics);
    }

    const tags = el('div', { class: 'stack' });
    for (const tech of p.stack) tags.append(el('span', { class: 'tag', text: tech }));
    foot.append(tags);

    const links = el('div', { class: 'project-links' });
    // Proyek dengan bagian terkunci punya halaman detail sendiri.
    // URL memakai kode akses acak (/s/<kode>/) supaya nama proyek tidak
    // muncul di tautan — pola yang dipakai Notion, Figma, Linear.
    // Kode utama = elemen pertama `access_codes`.
    if (p.gated && p.access_codes?.length) {
      links.append(el('a', {
        class: 'project-link project-link-detail',
        href: `/s/${p.access_codes[0]}/`,
        text: 'Detail teknis',
      }));
    }
    // Tombol akses kode mengarah ke HALAMAN KONTAK, bukan ke repo.
    // Repo-nya privat — menautkan langsung ke sana berarti pengunjung
    // mendarat di 404. Jalur yang benar: minta akses dulu lewat kontak,
    // lalu token dikirim setelah disetujui.
    links.append(el('a', {
      class: 'project-link',
      href: '#89fk39',
      text: 'Minta akses kode',
    }));
    foot.append(links);

    inner.append(foot);
    card.append(inner);
    host.append(card);
  }
}

// ── CAROUSEL SPOTLIGHT ─────────────────────────────────────────────────────────
/**
 * Galeri proyek dengan kartu melengkung, bisa digeser.
 *
 * Ditaruh di dalam section Proyek, SEBELUM daftar kartu bento. Alasannya:
 * carousel memberi gambaran cepat seluruh koleksi (mata bisa menjelajah tanpa
 * scroll), sedangkan kartu bento di bawahnya memberi detail yang bisa dibaca.
 * Dua peran berbeda, bukan duplikasi.
 *
 * Warna aksen per proyek diambil dari `p.accent` di data — nilainya nama
 * ('amina', 'parts', 'wa'), bukan hex. Peta di bawah menerjemahkannya ke warna
 * yang selaras dengan palet situs: tetap dalam keluarga hangat, tidak
 * memperkenalkan warna baru yang bertabrakan dengan aksen kuning premium.
 */
const ACCENT_WARNA = {
  amina: '#f5c542',   // kuning premium — proyek unggulan
  parts: '#7fb3d5',   // biru tenang — inventory/logistik
  wa: '#8fc98f',      // hijau tenang — bot percakapan
};

async function renderSpotlight() {
  const host = $('#spotlightHost');
  if (!host) return;

  // Gabungkan proyek unggulan + sampingan jadi satu koleksi.
  // Sampingan tidak punya metrics/subtitle, jadi dipakai deskripsi singkat.
  //
  // ── GAMBAR: DARI MANIFEST, BUKAN HARDCODE ────────────────────────────────
  // Dulu ada map VISUAL yang menuliskan nama berkas untuk tiap proyek. Itu
  // berarti mengganti gambar = mengubah kode + deploy ulang. Sekarang gambar
  // datang dari manifest di R2 yang bisa diunggah admin kapan saja.
  //
  // Pemetaan gambar dilakukan SETELAH manifest diambil, jadi blok ini harus
  // async. Kalau manifest gagal diambil, susunGambar() otomatis memakai
  // gambar bawaan — galeri tetap tampil, tidak ada yang rusak.
  const semuaProyek = [...projects, ...sideProjects];
  const manifest = await ambilManifest();
  const petaGambar = susunGambar(semuaProyek, manifest);

  const items = [
    ...projects.map((p) => ({
      title: p.name,
      label: p.featured ? 'Proyek unggulan' : 'Proyek',
      meta: p.subtitle || p.summary?.slice(0, 70) || '',
      // Rating: dari jumlah tes kalau ada — angka NYATA, bukan karangan.
      // Kalau tidak ada tes, tidak ada rating (elemen disembunyikan).
      rating: (() => {
        const t = (p.metrics ?? []).find((m) => m.label.includes('tes'));
        return t ? Number(String(t.value).replace(/\./g, '')).toLocaleString('id-ID') : '';
      })(),
      accent: ACCENT_WARNA[p.accent] || '#f5c542',
      image: petaGambar.get(p.name)?.url ?? '',
      lqip: petaGambar.get(p.name)?.lqip ?? null,
      })),
    ...sideProjects.map((p) => ({
      title: p.name,
      label: 'Proyek pendukung',
      meta: p.description,
      rating: '',
      accent: '#a9a9b3',
      image: petaGambar.get(p.name)?.url ?? '',
      lqip: petaGambar.get(p.name)?.lqip ?? null,
      })),
  ];

  const carousel = createSpotlightCarousel(items);
  host.append(carousel);

  // ── LIVE UPDATE: ADMIN UNGGAH GAMBAR → KARTU IKUT BERUBAH ────────────────
  // Pemilik minta: "agar bisa memproses ketika tiba tiba update dari backend
  // ke R2". Jadi halaman yang SEDANG TERBUKA tidak perlu di-reload saat admin
  // mengunggah gambar.
  //
  // Cara kerja: pantauPerubahan() memeriksa manifest setiap 20 detik. Kalau
  // updatedAt berubah, callback ini dipanggil dan kita pasang gambar baru ke
  // kartu yang cocok.
  //
  // Yang TIDAK dilakukan: membangun ulang carousel. Itu akan mereset posisi,
  // mematikan auto-scroll, dan menghilangkan gambar yang sudah termuat.
  // Kita hanya menukar gambar di kartu yang sudah ada — jauh lebih ringan dan
  // tidak mengganggu pengunjung yang sedang melihat.
  pantauPerubahan((manifestBaru) => {
    const petaBaru = susunGambar(semuaProyek, manifestBaru);

    // Setiap kartu dicocokkan lewat judul proyeknya (tersimpan di dataset).
    // Cocokkan lewat judul, bukan indeks: urutan kartu bisa berubah kalau
    // data proyek diedit, sedangkan judul tetap.
    for (const kartu of carousel.querySelectorAll('.spotlight-card')) {
      const judul = kartu.dataset.judul;
      if (!judul) continue;

      const gambar = petaBaru.get(judul);
      const media = kartu.querySelector('.spotlight-card-media');
      if (!media) continue;

      // Belum ada gambar baru untuk proyek ini → biarkan seperti sekarang.
      if (!gambar?.url) continue;

      // Sudah pakai gambar yang sama → tidak ada yang perlu dilakukan.
      // Pemeriksaan ini yang mencegah kedipan pada kartu yang tidak berubah.
      if (media.dataset.url === gambar.url && media.classList.contains('is-siap')) continue;

      // Ada gambar baru: lepas holding/gagal, pasang gambarnya.
      media.classList.remove('is-holding', 'is-gagal');
      let img = media.querySelector('img');
      if (!img) {
        // Holding state menghapus elemen img (tidak ada yang menunggu).
        // Sekarang gambarnya datang — buat ulang elemennya.
        img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'eager';
        media.append(img);
      }
      pasangGambar(img, { url: gambar.url, lqip: gambar.lqip ?? null });
    }
  });

  return carousel;
}

function renderSideProjects() {
  const host = $('#sideProjects');
  for (const p of sideProjects) {
    // ── KENAPA CARD JADI <a> ATAU <div> BERGANTUNG `p.repo` ─────────────────
    // Sebagian proyek sampingan repo-nya privat (mis. EFMS Fintech). Kalau
    // card-nya tetap <a href> ke repo privat, pengunjung mengklik dan mendarat
    // di halaman 404 — pengalaman rusak yang tidak kelihatan dari kode, hanya
    // ketahuan saat tautannya benar-benar dibuka.
    //
    // Jadi: repo ada → card jadi tautan. Repo tidak ada → card jadi <div>
    // biasa, tanpa pointer dan tanpa cursor. Tidak ada tautan mati.
    const adaRepo = Boolean(p.repo);
    const card = adaRepo
      ? el('a', { class: 'side-project', href: p.repo, target: '_blank', rel: 'noopener' })
      : el('div', { class: 'side-project is-nolink' });

    card.append(el('h3', { text: p.name }));
    card.append(el('p', { text: p.description }));
    const tags = el('div', { class: 'stack' });
    for (const tech of p.stack) tags.append(el('span', { class: 'tag', text: tech }));
    card.append(tags);
    host.append(card);
  }
}

// ── PRINSIP ────────────────────────────────────────────────────────────────────
function renderPrinciples() {
  const host = $('#principles');
  for (const p of principles) {
    host.append(el('div', { class: 'principle' },
      el('h3', { text: p.title }),
      el('p', { text: p.body }),
    ));
  }
}

// ── KONTAK ─────────────────────────────────────────────────────────────────────
function renderContact() {
  const host = $('#contactLinks');
  const links = [
    { label: 'GitHub', href: profile.links.github },
    { label: 'Ko-fi', href: profile.links.kofi },
    { label: 'Saweria', href: profile.links.saweria },
  ];
  for (const link of links) {
    host.append(el('a', {
      class: 'contact-link', href: link.href, target: '_blank', rel: 'noopener', text: link.label,
    }));
  }
}

// ── VIDEO HERO ─────────────────────────────────────────────────────────────────
// Kalau berkas video belum ada, jangan tampilkan apa pun yang rusak: cukup biarkan
// gradien cadangan yang bekerja. Kegagalan di sini tidak boleh memunculkan ikon
// "video rusak" di halaman.
//
// Mode scroll-scrub (teknik PRIOR): video TIDAK autoplay — posisinya dikendalikan
// scroll. Lebih hemat baterai, dan memberi rasa sinematik.
function loadHeroVideo() {
  const video = $('#heroVideo');
  if (!video) return;

  // Hormati preferensi pengguna: jangan paksa video bergerak.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Prefer WebM (lebih kecil), fallback MP4 (kompatibilitas luas).
  // Browser memilih format pertama yang didukung lewat <source> — TIDAK perlu
  // probe HEAD manual (dulu itu menambah 1 round-trip dan meninggalkan
  // request yang di-abort di network log). Kalau semua gagal, event 'error'
  // pada <video> yang menangani: gradien cadangan tetap tampil.
  const sources = [
    { src: 'assets/hero.webm', type: 'video/webm' },
    { src: 'assets/hero.mp4', type: 'video/mp4' },
  ];

  video.innerHTML = '';
  for (const s of sources) {
    video.appendChild(el('source', { src: s.src, type: s.type }));
  }

  // Mode: desktop pakai scroll-scrub (video dikendalikan gulir);
  // perangkat sentuh pakai autoplay loop (scrub tidak terasa di HP).
  // cinematic.js yang menentukan perilaku akhirnya.
  const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  if (isTouch) {
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
  } else {
    video.autoplay = false;
    video.loop = false;
    video.pause();
  }

  video.addEventListener('loadeddata', () => {
    video.classList.add('is-ready', 'is-scrub');
  }, { once: true });

  // Semua sumber gagal (berkas belum ada): biarkan gradien cadangan tampil.
  video.addEventListener('error', () => {
    video.classList.remove('is-ready', 'is-scrub');
  }, { once: true });

  video.load();
}

// ── MUNCUL SAAT DIGULIR ────────────────────────────────────────────────────────
function observeReveals() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('is-visible'));
    return;
  }
  // Threshold rendah + rootMargin positif: animasi mulai saat elemen baru
  // menyentuh tepi bawah layar, bukan setelah 8% terlihat. Di mobile scroll
  // cepat, animasi yang menunggu terlalu lama sering terlewat sepenuhnya.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px 10% 0px', threshold: 0.01 });
  targets.forEach((t) => observer.observe(t));
}

// ── KEPALA SAAT DIGULIR ────────────────────────────────────────────────────────
function watchHeader() {
  const header = $('.site-header');
  const bar = $('#scrollProgress');
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 24);
    // Progress bar: persentase halaman yang sudah digulir.
    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
      bar.style.width = pct.toFixed(1) + '%';
    }
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

// ── JALANKAN ───────────────────────────────────────────────────────────────────
// Tandai bahwa JS berhasil dimuat — CSS memakai ini untuk jaring pengaman:
// tanpa .js-ready, konten langsung terlihat (tidak menunggu animasi).
document.documentElement.classList.add('js-ready');

renderStats();
renderAbout();
renderServices();
renderProjects();
// `await` — galeri menunggu daftar gambar dari backend (maks 4 detik).
// Kalau backend lambat atau mati, ambilManifest() menyerah dan susunGambar()
// memakai gambar bawaan; galeri tetap muncul, tidak pernah kosong.
await renderSpotlight();
renderSideProjects();
renderPrinciples();
renderContact();
$('#year').textContent = String(new Date().getFullYear());
loadHeroVideo();
observeReveals();
watchHeader();

// Stagger untuk daftar yang dirender JS (kartu proyek, prinsip, kontak).
// Ditandai SEBELUM initAstra supaya observer langsung menangkapnya.
for (const id of ['featuredProjects', 'sideProjects', 'principles', 'contactLinks', 'heroStats']) {
  const node = document.getElementById(id);
  if (node) node.dataset.stagger = '';
}

// Micro-interactions Astra — setelah DOM terisi supaya elemen dinamis ikut terpasang.
initAstra();

// Efek 3D tingkat Framer/Awwwards — scroll-stand, tilt berlapis, glare,
// spotlight. Dipanggil setelah render supaya kartu proyek sudah ada.
initDepth();

// Sentuhan editorial: nomor section, rail navigasi, marquee. Dipanggil
// setelah semua section ter-render supaya nomor & rail menangkap semuanya.
initEditorial();

// Film grain overlay — tactile texture (2026 trend). Dipanggil awal supaya
// canvas dibuat sebelum interaksi lain.
initGrain();

// Wave text reveal — premium animation untuk section titles. Dipanggil
// setelah DOM terisi supaya [data-wave-reveal] sudah ada.
initWaveReveal();

// Magnetic cards — physics-based hover untuk project cards. Dipanggil
// setelah render supaya [data-magnetic] sudah terpasang.
initMagneticCards();

// Horizontal scroll pinned section — premium showcase (FASE 2). Dipanggil
// setelah DOM siap supaya [data-hscroll] sudah ada.
initHorizontalScroll();

// Floating orb menu — replaces rail navigation (FASE 2). Dipanggil
// setelah sections ter-render supaya observer bisa track.
initOrbMenu();

// Variable font weight on scroll — dynamic typography (FASE 2). Dipanggil
// setelah [data-variable-weight] titles sudah ada.
initVariableWeight();

// Three.js particle system — DISABLED (user prefer video background).
// Uncomment line below to enable particles instead of video.
// initParticles();

// Custom video player — ornamental controls (FASE 3). Dipanggil
// setelah DOM ready untuk video [data-custom-player].
initAllVideoPlayers();

// Masonry portfolio layout — staggered grid (FASE 3). Dipanggil
// setelah content rendered supaya items sudah ada.
initMasonry();

// Core Web Vitals — ukur performa nyata dari pengunjung (Framer Performance).
// Ringan: hanya 5 metrik, dikirim sekali per halaman via sendBeacon.
// Hanya berjalan setelah pengunjung memberi izin kategori analitik —
// mengukur tanpa izin bukan pilihan yang dihormati.
// Eksperimen A/B — varian dari server (Framer Grow/Convert). Gagal-diam
// kalau tidak ada eksperimen aktif, jadi tidak pernah mengganggu halaman.
// Ikut menunggu izin analitik karena mengirim ID pengunjung anonim.
function startAnalytics() {
  initVitals();
  initExperiments();
}

if (consentGiven('analytics')) {
  startAnalytics();
} else {
  // Kalau pengunjung memberi izin nanti (dari banner), baru jalankan.
  window.addEventListener('consent:change', (e) => {
    if (e.detail?.analytics) startAnalytics();
  }, { once: true });
}

// Banner persetujuan cookie — dua lapis, sama di semua halaman.
initCookieConsent();

// Ganti penanda [data-icon] dengan SVG dari katalog icons.js.
// Dipakai agar tidak ada emoji di markup — ikon SVG konsisten di semua
// OS, bisa diwarnai CSS, dan tidak dibaca screen reader sebagai emoji.
document.querySelectorAll('[data-icon]').forEach((el) => {
  const svg = icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 16 });
  if (svg) el.replaceWith(svg);
});

// Menu navigasi di layar kecil — panel dropdown + tirai gelap.
// 6 tautan tidak muat di bawah ~900px; tanpa ini nav membungkus & terpotong.
(function initNavToggle() {
  const toggle = $('#navToggle');
  const nav = $('#siteNav');
  const scrim = $('#navScrim');
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
    if (scrim) scrim.classList.toggle('is-visible', open);
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains('is-open'));
  });

  if (scrim) scrim.addEventListener('click', () => setOpen(false));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });

  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setOpen(false);
  }, { passive: true });
})();

// Monogram — ganti mark statis dengan inisial VV.
// Statis, bukan animasi: logo korporat tidak berputar atau berkedip.
pasangMonogram();

// Efek tekan tombol — gelombang dari titik sentuh (Material Design 3).
// Satu listener terdelegasi, jadi tombol yang dibuat belakangan (banner
// cookie, modal) otomatis ikut tanpa didaftarkan ulang.
initRipple();

// Efek sinematik (teknik PRIOR, vanilla) — clip reveal, parallax, text stagger,
// scroll-scrub video, hero fade. Semua hormati prefers-reduced-motion.
initCinematic();

// Tandai section aktif di navigasi saat menggulir (audit desain P1-6).
// Pakai IntersectionObserver, BUKAN listener scroll — proyek ini punya satu
// scroll-manager, dan menambah listener baru melanggar arsitektur itu.
initScrollSpy();
