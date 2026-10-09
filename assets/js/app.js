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
//
// ── KENAPA TAUTAN KONTAK PAKAI LOGO MEREK, BUKAN IKON GENERIK ────────────────
//
// Versi sebelumnya memakai ikon yang SAYA GAMBAR SENDIRI: sebuah cangkir untuk
// Ko-fi dan sebuah kubus untuk Saweria. Keduanya salah. Ikon itu tidak dikenali
// siapa pun — pengunjung melihat "cangkir" dan "kubus", bukan Ko-fi dan Saweria.
//
// Ikon merek bekerja karena pengunjung SUDAH tahu bentuknya. Logo yang tidak
// tepat bukan sekadar kurang cantik: ia memaksa orang membaca label teks, dan
// itu artinya ikonnya tidak melakukan tugasnya sama sekali.
//
// ── SUMBER SETIAP LOGO ───────────────────────────────────────────────────────
//   GitHub   simple-icons (octocat resmi) — sudah benar, tidak diubah
//   Ko-fi    simple-icons `kofi` — cangkir dengan HATI di dalamnya
//   Saweria  diturunkan dari favicon resmi saweria.co (maskot bertelinga
//            panjang, satu warna) — Saweria tidak ada di koleksi ikon mana pun,
//            jadi bentuknya diambil langsung dari aset resmi mereka
//
// ── KENAPA SAWERIA JADI SILUET SATU WARNA ────────────────────────────────────
// Maskot aslinya punya 6 warna (pixel art 48×48). Di ukuran ikon 20px, 6 warna
// itu saling menelan dan hasilnya jadi bintik tidak berbentuk. Siluet satu warna
// mempertahankan hal yang membuatnya dikenali — bentuk telinga — dan itu satu-
// satunya yang bertahan di ukuran kecil.
//
// Diverifikasi: masih terbaca di 40px, dan di 20px bentuknya masih utuh.
//
// ── SEMUA IKON PAKAI currentColor ────────────────────────────────────────────
// Supaya warna mengikuti CSS (`color`), bukan di-hardcode. Tema berubah → ikon
// ikut berubah, tanpa perlu menyentuh JavaScript.
const IKON_KONTAK = {
  GitHub: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`,
  'Ko-fi': `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493c1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87c-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182c2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546c-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195c-1.09-2-1.298-4.155-1.298-7.506c0-2.181.857-3.402 3.012-3.714c1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545c1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142c0 1.533.858 2.857 1.949 3.897c.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896c1.117-1.039 1.974-2.364 1.974-3.897c0-1.662-1.247-3.142-3.039-3.142c-1.065 0-1.792.545-2.338 1.298c-.493-.753-1.246-1.298-2.312-1.298"/></svg>`,
  Saweria: `<svg viewBox="0 0 960 960" aria-hidden="true"><g transform="translate(0.000000,960.000000) scale(0.100000,-0.100000)"><path fill="currentColor" d="M1550 9587 c0 -36 -67 -102 -173 -171 -125 -81 -157 -113 -217 -216 -134 -229 -159 -326 -167 -645 -4 -173 -2 -254 12 -374 22 -198 34 -243 100 -376 30 -60 68 -144 85 -187 17 -42 49 -100 70 -130 22 -29 70 -99 108 -155 169 -252 392 -451 622 -554 146 -66 195 -99 222 -152 47 -92 21 -178 -92 -302 -38 -41 -90 -112 -115 -157 -26 -44 -74 -109 -106 -144 -32 -34 -79 -95 -104 -133 -25 -39 -69 -97 -98 -129 -29 -31 -79 -99 -110 -150 -32 -51 -77 -119 -100 -150 -23 -32 -64 -96 -90 -143 -26 -47 -67 -108 -91 -135 -24 -27 -77 -101 -118 -164 -42 -63 -97 -142 -122 -175 -25 -33 -65 -96 -87 -140 -23 -44 -61 -108 -86 -142 -24 -34 -68 -115 -99 -180 -30 -65 -75 -143 -99 -174 -24 -31 -72 -116 -108 -190 -35 -74 -84 -164 -109 -201 -54 -78 -80 -142 -119 -295 -36 -141 -53 -270 -46 -349 8 -111 81 -208 191 -257 166 -74 196 -103 196 -190 0 -39 -10 -73 -45 -148 -31 -65 -54 -135 -70 -211 -13 -62 -38 -167 -55 -233 -43 -165 -34 -233 61 -431 34 -72 50 -92 146 -181 59 -55 134 -119 167 -143 32 -23 82 -64 110 -89 28 -26 87 -66 131 -90 44 -24 120 -71 170 -104 103 -70 147 -88 264 -111 95 -19 144 -41 183 -83 42 -44 131 -173 209 -301 80 -132 110 -167 224 -259 95 -78 145 -104 281 -149 168 -54 249 -103 274 -164 12 -30 12 -30 340 -30 327 0 327 0 351 38 36 56 141 104 334 152 114 28 186 52 250 84 122 61 265 155 334 220 107 102 148 112 496 121 198 5 250 3 298 -10 86 -22 152 -60 222 -125 66 -61 126 -95 308 -174 337 -147 980 -178 1321 -65 62 21 263 123 325 165 60 40 247 259 286 333 74 141 143 191 328 236 156 38 181 49 287 119 52 35 130 83 173 107 43 24 109 69 145 99 37 31 97 78 134 106 36 27 116 102 176 166 116 123 141 166 163 282 33 176 -25 533 -110 675 -22 36 -45 79 -50 94 -18 46 -13 133 9 176 22 45 54 66 165 112 95 39 155 91 184 160 32 73 35 129 16 259 -30 210 -57 291 -139 423 -25 40 -54 96 -65 125 -32 80 -66 143 -130 241 -32 49 -74 127 -94 174 -19 47 -62 127 -95 179 -33 51 -78 129 -100 174 -22 44 -66 112 -97 150 -31 38 -75 101 -97 139 -22 39 -71 111 -108 160 -37 50 -87 124 -110 165 -24 41 -62 100 -85 130 -23 30 -66 93 -94 140 -29 47 -85 126 -125 175 -40 50 -91 118 -114 152 -23 34 -64 87 -91 118 -27 31 -69 89 -92 128 -23 39 -90 130 -148 202 -154 189 -172 234 -131 315 26 51 65 76 222 144 137 59 161 72 228 126 25 20 79 60 121 88 81 54 210 192 284 304 22 33 71 101 108 151 77 103 103 150 140 252 14 39 43 109 65 156 54 116 68 166 88 321 13 105 15 178 11 348 -8 294 -16 330 -124 557 -102 215 -119 236 -274 340 -110 74 -164 126 -175 168 -6 25 -6 25 -209 25 -203 0 -203 0 -215 -30 -19 -45 -85 -98 -197 -158 -56 -30 -119 -72 -141 -95 -63 -65 -208 -335 -227 -421 -20 -93 -52 -429 -65 -686 -15 -285 -25 -357 -71 -495 -67 -200 -97 -253 -189 -337 -111 -100 -164 -130 -248 -135 -58 -4 -80 1 -167 33 -262 96 -284 102 -495 129 -393 51 -533 63 -955 81 -245 10 -642 -17 -1050 -72 -253 -34 -340 -55 -465 -115 -194 -94 -277 -80 -432 72 -94 92 -132 158 -188 325 -46 134 -47 147 -100 844 -21 268 -30 301 -186 626 -53 112 -111 169 -256 250 -113 64 -170 110 -188 154 -12 30 -12 30 -216 30 -165 0 -204 -3 -204 -13z"/></g></svg>`,
};

function renderContact() {
  const host = $('#contactLinks');
  const links = [
    { label: 'GitHub', href: profile.links.github },
    { label: 'Ko-fi', href: profile.links.kofi },
    { label: 'Saweria', href: profile.links.saweria },
  ];
  for (const link of links) {
    const a = el('a', {
      class: 'contact-link', href: link.href, target: '_blank', rel: 'noopener',
    });

    // ── BUG YANG PERNAH ADA DI SINI ──────────────────────────────────────────
    // Versi pertama menulis `a.appendChild(pembungkus.firstChild)` — itu
    // mengambil SVG dari dalam span lalu MEMBUANG span-nya. Akibatnya SVG jadi
    // anak langsung <a> tanpa kelas, tidak ada aturan CSS yang mengenainya, dan
    // ukurannya jatuh ke 0×0. Ikonnya ada di DOM tapi tidak terlihat sama sekali.
    //
    // Yang benar: span-nya yang di-append, bukan isinya. Span itu yang membawa
    // kelas `.contact-ikon` tempat ukuran 18×18 didefinisikan.
    //
    // `innerHTML` di sini aman: isinya literal yang kita tulis sendiri di
    // IKON_KONTAK, bukan data dari pengguna atau server.
    const pembungkus = document.createElement('span');
    pembungkus.className = 'contact-ikon';
    pembungkus.innerHTML = IKON_KONTAK[link.label] || '';
    a.appendChild(pembungkus);

    a.appendChild(el('span', { class: 'contact-label', text: link.label }));
    host.append(a);
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
