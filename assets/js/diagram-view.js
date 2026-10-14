/**
 * DIAGRAM ARSITEKTUR — tampilan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TAB PER PROYEK, BUKAN TIGA DIAGRAM BERTUMPUK
 * ══════════════════════════════════════════════════════════════════════════════
 * Tiga diagram berisi 7–8 langkah masing-masing berarti 22 kotak di satu
 * halaman. Yang penting tenggelam di antaranya — dan pengunjung yang mencari
 * cara kerja SATU proyek harus memilah sendiri mana miliknya.
 *
 * Dengan tab, hanya satu alur yang tampil sekaligus. Sisanya satu klik jauhnya.
 *
 * ── KENAPA DUA TINGKAT KEDALAMAN ────────────────────────────────────────────
 * Pemilik bisnis butuh tahu ALURNYA. Engineer butuh tahu BAGAIMANA.
 *
 * Jadi tiap langkah menampilkan satu kalimat saat dilihat, dan penjelasan
 * teknis saat diklik. Yang tidak butuh detail tidak dipaksa membacanya.
 *
 * ── KENAPA PAKAI <details>, BUKAN AKORDEON BUATAN SENDIRI ───────────────────
 * <details>/<summary> sudah menangani: buka-tutup dengan keyboard, status
 * terbuka untuk pembaca layar, dan pencarian dalam halaman (Ctrl+F bisa
 * menemukan teks di dalam <details> yang tertutup). Akordeon buatan sendiri
 * harus mengimplementasikan ketiganya — dan biasanya hanya satu yang dikerjakan.
 */

import { alurProyek, JENIS_LANGKAH } from './data/alur.js';

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

/* ── Render satu langkah ────────────────────────────────────────────────── */

function kotakLangkah(step, nomor) {
  const jenis = JENIS_LANGKAH[step.jenis] ?? { label: step.jenis, kelas: 'proses' };

  // ── <details> PER LANGKAH ─────────────────────────────────────────────────
  // Tiap langkah bisa dibuka sendiri. Membuka satu tidak menutup yang lain —
  // pengunjung bisa membandingkan dua langkah berdampingan.
  const kotak = el('details', `alur-langkah alur-langkah--${jenis.kelas}`);

  const ringkas = el('summary', 'alur-ringkas');

  // Nomor urut — membantu saat merujuk langkah dalam percakapan.
  ringkas.append(el('span', 'alur-nomor', String(nomor).padStart(2, '0')));

  const teks = el('span', 'alur-teks');
  teks.append(el('span', 'alur-label', step.label));
  teks.append(el('span', 'alur-kalimat', step.ringkas));
  ringkas.append(teks);

  // Lencana jenis — menunjukkan di mana ini bagian keamanan.
  ringkas.append(el('span', 'alur-jenis', jenis.label));

  kotak.append(ringkas);

  // ── ISI TERBUKA ───────────────────────────────────────────────────────────
  const isi = el('div', 'alur-isi');
  isi.append(el('p', 'alur-detail', step.detail));

  if (step.fakta?.length) {
    const ul = el('ul', 'alur-fakta');
    for (const f of step.fakta) {
      ul.append(el('li', null, f));
    }
    isi.append(ul);
  }

  kotak.append(isi);

  return kotak;
}

/* ── Render satu alur ───────────────────────────────────────────────────── */

function panelAlur(slug, data) {
  const panel = el('div', 'alur-panel');
  panel.id = `alur-panel-${slug}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `alur-tab-${slug}`);
  panel.hidden = true;

  panel.append(el('p', 'alur-panel-ringkas', data.ringkas));

  const daftar = el('div', 'alur-daftar');
  data.langkah.forEach((s, i) => {
    daftar.append(kotakLangkah(s, i + 1));
  });
  panel.append(daftar);

  return panel;
}

/* ── Pemasangan ─────────────────────────────────────────────────────────── */

/**
 * Pasang diagram arsitektur.
 *
 * @param {string} idHost  id elemen tempat diagram dipasang
 */
export function pasangDiagram(idHost = 'diagramHost') {
  const host = document.getElementById(idHost);
  if (!host) return;

  host.replaceChildren();

  const slugList = Object.keys(alurProyek);

  // ── TAB ───────────────────────────────────────────────────────────────────
  const tabBar = el('div', 'alur-tab-bar');
  tabBar.setAttribute('role', 'tablist');

  const panelWadah = el('div', 'alur-panel-wadah');

  let tabAktif = slugList[0];

  function pilihTab(slug, { fokus = false } = {}) {
    tabAktif = slug;

    for (const t of tabBar.querySelectorAll('.alur-tab')) {
      const aktif = t.dataset.slug === slug;
      t.classList.toggle('alur-tab--aktif', aktif);
      // ── aria-selected DIWAJIBKAN UNTUK tablist ─────────────────────────────
      // Tanpa ini, pembaca layar tidak tahu tab mana yang sedang aktif — ia
      // membacakan semuanya sebagai pilihan yang sama.
      t.setAttribute('aria-selected', aktif ? 'true' : 'false');
      // Hanya tab aktif yang bisa di-Tab masuk. Panah kiri/kanan memindahkan
      // fokus antar tab — pola tab yang benar, dan itu yang diharapkan
      // pengguna keyboard.
      t.tabIndex = aktif ? 0 : -1;
      if (aktif && fokus) t.focus();
    }

    for (const p of panelWadah.querySelectorAll('.alur-panel')) {
      p.hidden = p.id !== `alur-panel-${slug}`;
    }
  }

  slugList.forEach((slug) => {
    const data = alurProyek[slug];
    const tab = el('button', 'alur-tab', data.judul.replace(/^Cara /, ''));
    tab.type = 'button';
    tab.dataset.slug = slug;
    tab.id = `alur-tab-${slug}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `alur-panel-${slug}`);

    tab.addEventListener('click', () => pilihTab(slug));

    // ── NAVIGASI PANAH ────────────────────────────────────────────────────────
    // Konvensi tab: panah kiri/kanan berpindah tab, Home/End ke ujung.
    // Tanpa ini, pengguna keyboard harus menekan Tab melewati setiap tab.
    tab.addEventListener('keydown', (e) => {
      const i = slugList.indexOf(tabAktif);
      let tujuan = null;

      if (e.key === 'ArrowRight') tujuan = slugList[(i + 1) % slugList.length];
      else if (e.key === 'ArrowLeft') tujuan = slugList[(i - 1 + slugList.length) % slugList.length];
      else if (e.key === 'Home') tujuan = slugList[0];
      else if (e.key === 'End') tujuan = slugList[slugList.length - 1];

      if (tujuan) {
        e.preventDefault();
        pilihTab(tujuan, { fokus: true });
      }
    });

    tabBar.append(tab);
  });

  host.append(tabBar);

  for (const slug of slugList) {
    panelWadah.append(panelAlur(slug, alurProyek[slug]));
  }
  host.append(panelWadah);

  pilihTab(tabAktif);
}
