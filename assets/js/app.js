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
import { initCinematic } from './cinematic.js';
import { mountInteractiveLogo } from './logo.js';
import { techGroups, techLogos, createTechCard } from './tech-logos.js';
import { createTiltPanel } from './tilt-panel.js';

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
function renderServices() {
  const host = $('#servicesGrid');
  if (!host) return;
  for (const s of services) {
    host.append(el('article', { class: 'service-card' },
      el('h3', { text: s.title }),
      el('p', { text: s.body }),
    ));
  }
}

// ── PROYEK ─────────────────────────────────────────────────────────────────────
function renderProjects() {
  const host = $('#featuredProjects');

  for (const p of projects) {
    const card = el('article', { class: `project${p.featured ? ' is-featured' : ''}` });

    card.append(el('div', { class: 'project-head' },
      el('h3', { class: 'project-name', text: p.name }),
      el('span', { class: 'project-sub', text: p.subtitle }),
    ));
    card.append(el('p', { class: 'project-summary', text: p.summary }));
    if (p.problem) card.append(el('p', { class: 'project-problem', text: p.problem }));

    const highlights = el('div', { class: 'project-highlights' });
    for (const h of p.highlights) {
      highlights.append(el('div', { class: 'highlight' },
        el('h4', { text: h.title }),
        el('p', { text: h.detail }),
      ));
    }
    card.append(highlights);

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
    links.append(el('a', {
      class: 'project-link', href: p.repo, target: '_blank', rel: 'noopener', text: 'Buka repo',
    }));
    foot.append(links);

    card.append(foot);
    host.append(card);
  }
}

function renderSideProjects() {
  const host = $('#sideProjects');
  for (const p of sideProjects) {
    const card = el('a', {
      class: 'side-project', href: p.repo, target: '_blank', rel: 'noopener',
    });
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
  // Cek HEAD dulu supaya tidak ada request besar kalau berkas belum ada.
  const sources = [
    { src: 'assets/hero.webm', type: 'video/webm' },
    { src: 'assets/hero.mp4', type: 'video/mp4' },
  ];

  function trySource(index) {
    if (index >= sources.length) return;       // semua gagal: gradien cadangan yang tampil
    const { src, type } = sources[index];
    fetch(src, { method: 'HEAD' })
      .then((res) => {
        if (!res.ok) return trySource(index + 1);
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.startsWith('video/')) return trySource(index + 1);

        // Bersihkan source lama dan tambahkan <source> element agar browser memilih format terbaik.
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
        video.load();
      })
      .catch(() => trySource(index + 1));
  }

  trySource(0);
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

// Logo interaktif — ganti brand-mark statis dengan simbol coding yang bergerak.
mountInteractiveLogo();

// Efek sinematik (teknik PRIOR, vanilla) — clip reveal, parallax, text stagger,
// scroll-scrub video, hero fade. Semua hormati prefers-reduced-motion.
initCinematic();
