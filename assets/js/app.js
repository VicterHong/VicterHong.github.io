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
  Saweria: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" transform="translate(0.000000,300.000000) scale(0.100000,-0.100000)" d="M518 2890 c-29 -1 -67 -7 -84 -14 -21 -9 -38 -29 -52 -59 -12 -26 -26 -65 -32 -89 -5 -24 -10 -77 -10 -118 0 -41 7 -105 14 -141 8 -37 26 -89 39 -116 14 -27 58 -84 97 -126 53 -57 89 -85 142 -112 42 -21 85 -35 107 -35 21 0 42 -5 49 -12 7 -7 12 -20 12 -30 0 -10 -19 -46 -43 -80 -23 -35 -83 -117 -132 -183 -50 -66 -123 -166 -163 -222 -40 -56 -72 -104 -72 -107 0 -3 -30 -52 -67 -109 -38 -56 -98 -163 -135 -237 -53 -105 -69 -146 -70 -185 l-3 -50 45 1 c25 1 61 3 80 5 35 4 35 4 34 -36 -1 -22 -18 -89 -39 -150 -20 -60 -41 -120 -47 -132 -6 -12 -11 -39 -11 -61 0 -21 8 -50 18 -65 9 -14 47 -50 83 -80 37 -29 83 -63 103 -75 20 -12 59 -29 85 -37 27 -8 49 -15 50 -15 1 0 7 33 14 73 9 54 23 92 54 143 32 53 55 78 101 109 52 35 67 40 115 39 31 0 69 -8 89 -18 19 -10 44 -29 57 -43 l23 -25 30 21 c16 12 43 24 60 27 17 4 42 4 55 0 14 -3 41 -20 60 -37 19 -16 37 -43 41 -58 6 -26 10 -29 60 -33 37 -3 64 -12 87 -30 19 -14 46 -49 61 -78 18 -35 27 -67 27 -100 0 -27 -4 -52 -10 -55 -5 -3 -10 -15 -10 -26 0 -16 7 -19 49 -19 27 0 62 3 79 6 29 6 30 7 20 38 -6 17 -15 35 -19 40 -5 6 -9 26 -9 46 0 20 11 59 24 86 13 28 42 66 64 86 23 21 56 40 76 44 20 3 42 4 50 1 9 -4 16 3 20 19 4 13 23 42 42 64 32 36 41 40 83 40 33 0 57 -7 85 -26 l38 -26 31 30 c18 17 45 36 60 41 16 6 54 11 86 11 46 0 66 -6 104 -30 25 -16 60 -48 77 -72 18 -24 42 -66 56 -93 14 -31 26 -80 30 -123 4 -40 7 -72 8 -72 1 0 23 7 50 15 26 8 65 25 85 37 20 12 64 44 98 71 35 27 72 62 84 78 11 16 17 29 13 29 -3 0 -1 7 6 15 8 10 10 28 5 51 -3 20 -10 44 -15 53 -5 9 -28 72 -50 140 -23 67 -40 133 -38 145 3 18 8 20 38 17 19 -2 55 -4 80 -5 43 -1 45 0 48 30 2 18 -10 66 -28 112 -17 44 -39 91 -49 104 -10 13 -30 48 -44 78 -14 30 -53 96 -87 145 -33 50 -60 94 -60 99 0 5 -17 32 -38 60 -21 28 -61 83 -87 121 -27 39 -91 125 -142 193 -51 67 -93 125 -93 130 -1 4 -14 23 -30 42 -17 19 -30 44 -30 55 0 12 5 26 12 33 7 7 28 12 47 12 20 0 60 11 89 23 29 12 76 42 105 66 28 25 71 68 95 95 24 28 54 74 67 101 14 28 29 74 35 104 5 29 10 92 10 140 0 47 -5 104 -11 126 -6 22 -19 59 -30 83 -14 31 -30 47 -54 58 -19 8 -57 14 -85 14 -28 0 -64 -7 -80 -15 -16 -8 -37 -27 -47 -42 -11 -16 -27 -48 -36 -73 -10 -25 -24 -112 -33 -195 -8 -82 -19 -175 -25 -205 -6 -30 -19 -71 -29 -90 -10 -20 -38 -54 -63 -77 -25 -23 -62 -46 -83 -52 -32 -9 -56 -7 -129 10 -49 12 -110 27 -135 34 -25 7 -99 19 -165 26 -75 7 -169 9 -250 5 -71 -4 -148 -11 -170 -16 -22 -5 -67 -16 -100 -23 -33 -8 -86 -22 -118 -31 -47 -14 -65 -15 -99 -6 -26 7 -60 29 -90 58 -37 35 -54 62 -69 107 -11 33 -25 103 -30 155 -5 52 -14 131 -19 175 -6 44 -19 105 -31 135 -11 30 -28 63 -37 74 -9 10 -29 24 -44 32 -15 8 -51 14 -80 14z M1856 2088 c-34 1 -67 -1 -74 -6 -8 -5 -12 -23 -10 -43 3 -32 6 -34 49 -40 25 -4 68 -18 95 -32 27 -14 58 -34 68 -46 19 -21 19 -21 -10 -21 -17 0 -53 -12 -81 -26 -29 -14 -68 -43 -87 -64 -19 -22 -44 -56 -54 -77 -11 -21 -25 -62 -32 -92 -8 -33 -11 -90 -8 -150 4 -71 12 -112 30 -157 l25 -61 -56 31 c-56 31 -57 31 -206 31 -138 0 -154 -2 -195 -23 -25 -13 -56 -34 -69 -45 -23 -22 -24 -22 -13 -1 6 11 18 41 27 65 9 24 19 88 22 142 4 76 2 113 -12 165 -10 37 -28 83 -41 103 -12 20 -43 54 -68 76 -26 23 -68 48 -96 57 -27 9 -63 16 -79 16 -17 0 -31 3 -31 8 1 4 20 19 43 34 24 15 65 32 93 39 27 6 55 13 62 15 6 2 12 19 12 38 0 22 -6 36 -16 40 -9 3 -35 6 -58 6 -23 0 -46 -4 -52 -8 -5 -5 -34 -19 -65 -31 -31 -12 -73 -38 -94 -57 -32 -29 -37 -38 -32 -64 6 -27 3 -30 -29 -39 -20 -5 -60 -28 -89 -50 -30 -23 -65 -55 -78 -73 -14 -18 -34 -53 -44 -78 -11 -25 -24 -54 -28 -65 -5 -11 -9 -22 -10 -25 -1 -3 -6 -14 -11 -25 -5 -11 -9 -61 -9 -111 0 -50 5 -102 12 -115 6 -13 25 -53 41 -89 17 -36 43 -77 59 -91 15 -14 42 -34 58 -43 17 -9 52 -25 78 -36 27 -11 67 -20 90 -20 23 0 72 11 108 23 37 13 86 36 109 52 23 16 57 47 76 69 l34 41 0 -36 c0 -24 8 -45 23 -61 13 -14 45 -35 70 -46 33 -15 47 -27 47 -41 0 -10 13 -30 29 -43 15 -12 37 -28 47 -35 18 -11 17 -13 -11 -37 -16 -15 -43 -34 -59 -42 -17 -9 -42 -20 -58 -25 -23 -6 -31 -3 -47 18 -11 13 -23 34 -26 45 -4 12 0 27 10 38 10 10 15 30 13 47 -2 24 -8 28 -36 31 -23 2 -41 -4 -63 -22 -16 -14 -47 -30 -68 -36 -26 -7 -41 -17 -44 -32 -3 -12 -2 -30 4 -40 7 -13 21 -18 50 -18 33 0 41 -4 49 -24 5 -14 26 -43 46 -65 30 -34 43 -41 73 -41 36 0 37 -2 70 -74 20 -44 51 -91 75 -115 23 -23 57 -46 76 -51 22 -6 47 -6 71 0 23 6 53 28 82 58 24 27 58 76 73 110 27 58 31 62 62 62 19 0 48 7 65 15 23 10 39 30 55 66 12 28 22 54 22 59 0 4 18 10 39 14 34 5 40 10 46 36 4 19 2 36 -5 45 -7 8 -26 15 -42 15 -16 0 -51 9 -78 21 -26 11 -61 19 -76 17 -24 -2 -29 -8 -32 -35 -3 -27 2 -34 27 -48 17 -8 31 -23 31 -33 0 -9 -11 -30 -24 -47 l-24 -30 -58 20 c-33 11 -76 35 -96 54 -21 18 -38 36 -38 40 0 3 14 14 30 23 17 10 37 33 45 53 12 26 27 39 65 56 27 11 56 32 65 45 8 13 15 32 15 44 0 11 3 20 6 20 4 0 27 -18 51 -40 24 -23 65 -50 91 -62 33 -15 75 -22 140 -26 89 -4 95 -3 158 28 45 22 76 46 104 81 21 27 48 74 59 104 16 43 21 79 21 159 0 77 -5 121 -21 172 -11 37 -31 84 -44 104 -13 20 -46 57 -74 83 -29 25 -76 55 -107 66 -30 12 -63 21 -74 21 -16 0 -19 5 -13 30 4 22 0 36 -12 50 -10 11 -22 20 -26 20 -4 0 -38 19 -75 42 -56 36 -77 43 -128 46zM1411 1890 c-15 7 -23 6 -35 -6 -9 -8 -16 -24 -16 -36 0 -11 -8 -49 -17 -84 -16 -59 -16 -65 -1 -80 14 -14 17 -14 35 5 11 12 28 45 37 73 9 27 16 65 16 84 0 23 -6 37 -19 44zM1502 1898 c-12 2 -24 -3 -27 -11 -3 -7 -4 -58 -3 -113 3 -98 3 -99 28 -99 l25 0 0 110 c0 107 -1 110 -23 113zM1617 1893 c-7 3 -21 1 -30 -5 -11 -5 -17 -21 -17 -42 0 -19 7 -57 16 -84 9 -28 26 -61 37 -73 18 -19 21 -19 35 -5 15 14 14 22 0 83 -9 38 -19 80 -22 94 -3 15 -12 29 -19 32zM2505 870 c-13 0 -31 -7 -40 -17 -11 -10 -15 -26 -12 -42 3 -14 24 -69 47 -121 23 -52 49 -101 58 -107 9 -7 28 -13 42 -13 14 0 31 5 38 12 7 7 12 23 12 36 0 13 -18 62 -39 108 -22 46 -49 98 -61 114 -13 19 -30 30 -45 30zM2337 838 c-17 2 -31 -5 -46 -24 -11 -15 -21 -30 -21 -33 0 -4 27 -61 61 -126 33 -66 68 -124 78 -128 9 -5 28 -4 43 2 15 5 28 20 32 35 5 20 -9 54 -58 148 -53 103 -68 124 -89 126zM474 820 c-5 0 -19 -7 -30 -15 -12 -7 -38 -52 -59 -99 -36 -82 -37 -86 -21 -111 10 -15 26 -25 39 -25 13 0 31 6 40 13 9 6 32 47 52 90 19 43 35 84 35 91 0 7 -10 22 -23 34 -13 12 -28 22 -33 22zM627 790 c-4 0 -19 -11 -32 -24 -13 -13 -37 -51 -54 -85 -17 -33 -31 -71 -31 -84 0 -13 9 -32 19 -41 11 -10 30 -16 43 -14 17 2 33 22 65 83 23 44 42 92 43 107 0 17 -8 33 -22 42 -12 9 -26 16 -31 16z"/><circle cx="105.5" cy="147.7" r="22.0" fill="currentColor"/><circle cx="192.5" cy="147.2" r="22.6" fill="currentColor"/></svg>`,
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
