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
  Saweria: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" transform="translate(0.000000,300.000000) scale(0.100000,-0.100000)" d="M499 2890 c-19 -1 -44 -6 -57 -13 -12 -7 -35 -29 -51 -48 -16 -19 -35 -55 -42 -79 -7 -25 -13 -94 -13 -155 0 -88 5 -124 23 -177 15 -47 39 -86 79 -135 32 -37 61 -76 65 -86 3 -9 13 -17 20 -17 8 0 20 -7 27 -15 7 -8 38 -29 69 -46 31 -17 83 -36 116 -43 54 -11 60 -15 63 -39 3 -20 -13 -48 -64 -114 -38 -49 -81 -103 -97 -122 -15 -18 -32 -43 -37 -55 -4 -12 -25 -44 -47 -71 -21 -28 -68 -92 -103 -143 -36 -51 -82 -118 -102 -150 -20 -31 -63 -102 -95 -157 -32 -55 -63 -109 -70 -120 -7 -11 -16 -29 -22 -40 -5 -11 -17 -40 -27 -64 -10 -24 -18 -67 -19 -95 l0 -51 45 4 c25 3 59 5 75 5 27 1 30 -2 33 -33 2 -18 -6 -56 -17 -85 -11 -28 -30 -85 -41 -126 -12 -41 -25 -83 -31 -92 -5 -10 -9 -34 -9 -53 0 -30 9 -45 58 -93 32 -31 79 -72 104 -90 26 -18 70 -42 100 -53 29 -10 59 -17 66 -14 6 2 12 15 12 27 0 13 6 44 14 69 8 25 25 68 39 95 14 27 45 68 69 91 23 23 60 49 80 58 21 8 53 15 71 15 19 0 48 -3 65 -6 17 -4 50 -22 73 -42 34 -29 44 -33 58 -24 9 6 31 19 50 27 18 8 43 15 55 15 11 -1 36 -9 54 -18 18 -10 47 -40 65 -67 29 -46 36 -50 78 -55 31 -4 59 -16 87 -38 29 -24 47 -49 62 -89 18 -48 20 -66 12 -110 -5 -29 -7 -55 -4 -58 3 -3 28 -5 56 -5 28 0 57 4 64 8 9 7 10 16 1 41 -7 18 -9 60 -7 95 3 34 13 76 21 93 9 17 35 46 58 63 30 24 54 34 90 38 45 4 52 8 68 41 11 20 30 46 44 59 13 12 41 25 61 29 27 4 50 0 87 -17 l49 -23 23 20 c12 11 44 28 71 37 27 9 65 16 83 16 19 0 50 -7 71 -16 20 -8 49 -27 65 -41 22 -22 27 -24 27 -9 0 9 -8 34 -19 54 -10 20 -32 63 -50 96 -17 32 -31 69 -31 81 0 13 7 31 16 39 8 9 30 16 48 16 32 0 34 -3 94 -123 34 -67 62 -129 62 -138 0 -8 -10 -25 -23 -37 -13 -12 -33 -22 -45 -22 -12 0 -22 -5 -22 -11 0 -6 8 -23 19 -37 10 -15 28 -55 40 -90 11 -34 21 -80 21 -101 0 -22 5 -43 10 -46 6 -4 36 3 68 15 31 12 77 36 101 53 24 18 68 54 97 81 51 47 54 51 54 99 0 27 -7 77 -16 111 -8 33 -29 98 -45 144 -17 45 -29 94 -27 110 3 24 7 27 38 26 19 0 53 -2 75 -5 l40 -4 3 42 c2 29 -6 64 -28 116 -17 40 -53 114 -81 163 -28 49 -68 114 -88 144 -21 30 -40 62 -43 70 -3 8 -58 88 -122 177 -64 89 -116 165 -116 169 0 4 -24 37 -53 73 -30 36 -67 84 -82 106 -16 22 -40 52 -53 66 -16 18 -22 36 -20 55 3 26 7 29 53 36 28 4 78 21 113 40 34 18 74 43 89 55 14 13 30 23 35 23 4 0 8 6 8 14 0 8 10 23 23 33 12 10 37 37 54 59 18 23 41 61 51 85 11 24 24 74 31 110 6 36 11 95 11 131 0 35 -7 89 -16 119 -9 30 -27 69 -40 87 -14 17 -38 39 -54 47 -16 8 -45 15 -64 15 -20 0 -53 -7 -73 -15 -22 -9 -48 -31 -63 -53 -14 -20 -30 -54 -36 -75 -7 -20 -17 -92 -24 -160 -6 -67 -18 -160 -26 -207 -10 -60 -24 -100 -47 -138 -20 -33 -47 -63 -72 -77 -22 -13 -56 -26 -76 -30 -22 -4 -67 1 -125 15 -49 12 -132 28 -184 36 -52 7 -178 14 -279 14 -101 0 -213 -5 -250 -11 -36 -6 -102 -19 -146 -29 -44 -11 -97 -22 -117 -26 -20 -3 -53 -1 -74 6 -20 7 -55 29 -77 49 -22 20 -50 59 -62 86 -12 28 -27 88 -33 135 -6 47 -16 135 -23 195 -6 61 -16 126 -21 145 -6 19 -24 54 -40 76 -20 28 -41 45 -67 53 -21 6 -54 11 -72 11z M1820 2080 c-15 0 -33 -7 -40 -15 -6 -8 -9 -22 -6 -32 4 -13 23 -22 61 -30 31 -7 82 -29 115 -50 33 -21 60 -41 60 -44 0 -4 -21 -12 -47 -18 -27 -7 -66 -24 -88 -38 -22 -15 -53 -40 -68 -57 -15 -17 -38 -51 -51 -76 -13 -25 -29 -63 -35 -85 -5 -22 -12 -69 -14 -104 -2 -35 0 -82 5 -105 5 -23 28 -78 50 -124 29 -58 56 -96 92 -129 28 -25 69 -54 91 -64 22 -9 68 -23 102 -29 55 -11 72 -10 134 6 61 16 79 26 129 74 33 31 67 76 80 103 12 27 26 74 31 105 5 32 9 77 9 102 0 25 -8 75 -19 111 -10 36 -26 81 -36 100 -10 19 -31 51 -48 71 -16 20 -54 55 -84 78 -31 23 -79 47 -114 57 -50 14 -58 19 -53 35 3 12 -4 31 -20 53 -14 18 -36 37 -48 41 -13 3 -30 12 -38 18 -8 7 -39 20 -69 29 -29 9 -66 17 -81 17zM1096 2059 c-12 -1 -37 -4 -56 -8 -19 -4 -58 -19 -85 -34 -28 -16 -65 -41 -82 -57 -18 -16 -33 -36 -33 -44 0 -8 5 -18 11 -22 6 -3 -17 -22 -53 -41 -34 -19 -85 -56 -111 -81 -27 -26 -59 -65 -72 -87 -13 -22 -32 -62 -42 -90 -13 -37 -18 -78 -18 -155 1 -73 6 -120 18 -153 10 -27 24 -61 31 -76 8 -15 33 -44 55 -64 22 -20 59 -46 83 -59 36 -19 58 -23 138 -23 81 1 103 4 150 27 30 14 78 49 107 78 29 29 61 71 71 94 11 22 25 59 32 81 7 22 18 50 23 63 6 13 11 55 11 93 0 40 -5 74 -12 81 -7 7 -12 23 -12 37 0 15 -14 53 -31 86 -17 33 -41 70 -52 82 -11 13 -48 37 -81 55 -34 17 -81 34 -105 37 -25 4 -46 11 -47 16 -2 6 9 19 23 29 15 11 63 32 107 47 56 19 82 32 85 45 2 10 -5 24 -15 31 -10 7 -27 12 -38 12zM1489 1910 c-3 0 -13 -8 -22 -18 -13 -14 -17 -39 -17 -110 0 -69 4 -94 16 -106 8 -9 22 -16 29 -16 7 0 21 7 29 16 12 12 16 37 16 109 0 86 -2 95 -22 109 -12 9 -25 16 -29 16zM1395 1900 c-6 0 -19 -8 -28 -18 -10 -10 -17 -30 -17 -44 0 -14 -7 -42 -16 -63 -8 -20 -14 -51 -12 -69 2 -26 7 -31 28 -31 20 0 30 10 49 49 13 26 26 70 29 97 3 31 0 54 -8 64 -7 8 -18 15 -25 15zM1594 1900 c-6 0 -15 -5 -22 -12 -7 -7 -12 -28 -12 -47 1 -20 6 -56 13 -81 7 -25 18 -55 25 -67 8 -14 22 -23 38 -23 14 0 27 7 31 17 4 9 -1 46 -10 82 -10 36 -17 73 -17 82 0 9 -8 23 -18 32 -10 10 -23 17 -28 17zM1495 1329 c-22 -1 -67 -5 -99 -10 -32 -5 -79 -18 -102 -30 -24 -11 -53 -32 -64 -46 -11 -14 -20 -36 -20 -49 0 -12 11 -36 24 -51 14 -16 42 -37 64 -47 26 -12 45 -30 55 -52 9 -19 31 -43 49 -54 18 -11 38 -22 43 -24 6 -3 -8 -21 -30 -41 -22 -20 -57 -45 -77 -56 -21 -10 -45 -19 -55 -19 -10 0 -28 7 -40 15 -12 9 -25 31 -29 50 -4 22 -2 41 6 50 6 7 10 26 8 42 -2 19 -9 29 -24 31 -11 2 -33 -7 -49 -20 -16 -13 -47 -32 -69 -43 -23 -11 -43 -29 -45 -39 -2 -11 5 -26 15 -33 10 -7 33 -13 51 -13 27 0 35 -6 49 -32 9 -18 28 -45 42 -60 16 -18 40 -29 69 -34 36 -5 44 -11 50 -33 3 -14 16 -47 27 -72 12 -26 42 -64 69 -88 26 -22 59 -44 73 -47 14 -4 44 1 70 11 25 10 58 33 77 55 17 21 44 67 58 102 l25 63 43 1 c25 1 55 10 70 21 14 11 40 46 57 79 24 46 36 60 56 62 15 2 32 9 38 17 8 10 8 19 0 34 -6 12 -21 21 -34 21 -13 0 -45 11 -71 26 -26 14 -60 24 -74 22 -19 -2 -27 -10 -29 -28 -3 -17 4 -31 23 -46 24 -19 27 -27 21 -57 -3 -19 -15 -42 -25 -51 -15 -14 -25 -15 -70 -5 -29 6 -70 24 -93 42 -22 18 -48 42 -56 54 -13 21 -13 23 4 30 11 3 31 20 47 36 15 17 27 36 27 44 0 7 22 24 49 38 27 13 58 36 70 51 12 15 21 37 21 49 0 12 -9 33 -19 46 -10 14 -38 34 -62 46 -24 12 -73 27 -109 32 -36 6 -83 10 -105 10zM2495 860 c-17 0 -36 -5 -43 -12 -7 -7 -12 -21 -12 -31 0 -11 14 -50 32 -86 17 -36 40 -84 51 -106 11 -22 28 -48 39 -57 11 -10 26 -18 34 -18 7 0 25 10 39 23 l26 22 -19 55 c-11 30 -33 81 -50 114 -17 32 -38 67 -48 77 -10 11 -30 19 -49 19zM465 820 c-6 0 -23 -12 -37 -27 -15 -16 -40 -57 -57 -93 -17 -36 -31 -73 -31 -83 0 -10 5 -27 10 -38 7 -13 21 -19 45 -19 26 0 38 7 55 30 12 17 32 57 46 90 13 33 24 71 24 84 0 14 -9 32 -22 40 -12 9 -27 16 -33 16zM615 790 c-3 0 -16 -11 -28 -24 -12 -13 -39 -56 -60 -95 -36 -66 -38 -75 -27 -102 7 -16 21 -34 32 -40 14 -8 25 -6 43 5 12 8 41 49 64 91 22 42 41 86 41 98 0 12 -4 27 -8 33 -4 6 -17 16 -29 23 -12 6 -24 11 -28 11z"/><ellipse cx="105.3" cy="149.0" rx="13.6" ry="24.5" fill="currentColor"/><ellipse cx="192.6" cy="148.3" rx="14.7" ry="25.1" fill="currentColor"/></svg>`,
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
