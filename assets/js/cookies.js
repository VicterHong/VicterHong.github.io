/**
 * Persetujuan cookie — dua lapis.
 *
 * Lapis 1: banner ringkas (Terima semua / Tolak semua / Atur).
 * Lapis 2: panel rinci dengan sakelar per kategori.
 *
 * Kategori yang ditampilkan hanya yang BENAR-BENAR dipakai situs ini:
 *   - Esensial : sesi login token, keamanan gerbang bot.
 *   - Analitik : ID percobaan A/B anonim + metrik performa (angka saja).
 *
 * Sengaja TIDAK ada kategori pemasaran atau iklan — situs ini tidak
 * memasang keduanya. Mencantumkan kategori yang tidak dipakai adalah
 * ketidakjujuran yang mudah terlihat di daftar cookie.
 *
 * Prinsip kepatuhan yang dipegang:
 *   - "Terima semua" dan "Tolak semua" sama besar, sama gaya. Membuat
 *     salah satunya lebih menonjol adalah pola gelap.
 *   - Kategori non-esensial MATI secara bawaan (consent harus aktif).
 *   - Menutup tanpa memilih = menolak, dan itu dinyatakan jelas.
 *   - Pilihan bisa diubah kapan saja lewat tombol mengambang.
 *
 * Pilihan disimpan di localStorage (bukan cookie) supaya tidak ikut
 * terkirim ke server pada setiap permintaan — lebih hemat dan lebih
 * menghormati privasi.
 */

// Impor katalog ikon langsung (bukan lewat window) — halaman panduan
// tidak memuat app.js, jadi banner harus mandiri agar tetap berikon.
import { icon } from './icons.js';

const STORAGE_KEY = 'portfolio.consent';
const VERSION = 1;

/** Kategori yang tersedia. `locked: true` = tidak bisa dimatikan. */
const CATEGORIES = [
  {
    id: 'essential',
    label: 'Esensial',
    icon: 'lock',
    locked: true,
    description:
      'Dibutuhkan agar situs berfungsi: menyimpan token akses selama sesi berlangsung dan menjalankan pemeriksaan keamanan. Tidak bisa dimatikan.',
  },
  {
    id: 'analytics',
    label: 'Analitik',
    icon: 'chart',
    locked: false,
    description:
      'Mengukur performa halaman (kecepatan muat, responsivitas) dan mencatat varian uji A/B secara anonim. Tidak ada identitas pribadi, tidak dipakai untuk iklan.',
  },
];

/** Pilihan tersimpan, atau null kalau belum pernah memilih. */
function loadConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Versi berbeda = kategori bisa berubah, minta persetujuan ulang.
    if (data.v !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** Simpan pilihan. `choices` = { analytics: true/false }. */
function saveConsent(choices) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: VERSION,
      choices,
      at: Date.now(),
    }));
  } catch {
    /* Mode privasi ketat bisa memblokir localStorage — situs tetap
       berjalan, hanya pilihannya tidak diingat di kunjungan berikutnya. */
  }
}

/** Apakah kategori tertentu diizinkan? Esensial selalu ya. */
export function consentGiven(category) {
  if (category === 'essential') return true;
  const data = loadConsent();
  if (!data) return false; // belum memilih = belum diizinkan
  return data.choices?.[category] === true;
}

/** Terapkan pilihan: beri tahu modul lain yang bergantung padanya. */
function applyConsent(choices) {
  // Modul uji A/B dan pengukuran performa membaca izin ini sebelum
  // mengirim apa pun. Kalau ditolak, keduanya diam.
  window.dispatchEvent(new CustomEvent('consent:change', {
    detail: { analytics: choices.analytics === true },
  }));
}

/** Ganti [data-icon] di dalam sebuah elemen dengan SVG dari katalog.
 *  Pakai <template> untuk mengurai string SVG — cara yang andal, dan
 *  penanda span benar-benar hilang dari DOM (bukan disarangkan).
 *  Catatan: replaceWith(null) akan menyisipkan teks "null", jadi
 *  elemen hasilnya diperiksa dulu sebelum dipakai. */
function paintIcons(root) {
  const tpl = document.createElement('template');
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (!name) return;
    const svg = icon(name, { size: 15 });
    if (!svg) return;
    tpl.innerHTML = svg;
    const node = tpl.content.firstElementChild;
    if (node) el.replaceWith(node);
  });
}

/** Bangun markup banner + panel, pasang ke halaman. */
function build() {
  const banner = document.createElement('div');
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Persetujuan cookie');
  banner.innerHTML = `
    <div class="cookie-banner-inner">
      <div class="cookie-banner-text">
        <h2>Cookie di situs ini</h2>
        <p>
          Situs memakai penyimpanan browser untuk dua hal: menjaga sesi token
          Anda tetap aktif, dan mengukur performa halaman secara anonim.
          Tidak ada iklan, tidak ada pelacakan lintas situs.
          <a href="/docs#privasi">Selengkapnya</a>
        </p>
      </div>
      <div class="cookie-actions">
        <button type="button" class="cookie-btn cookie-btn--decision" data-consent="reject-all">
          Tolak semua
        </button>
        <button type="button" class="cookie-btn cookie-btn--decision" data-consent="accept-all">
          Terima semua
        </button>
        <button type="button" class="cookie-btn cookie-btn--link" data-consent="open-panel">
          Atur pilihan
        </button>
      </div>
    </div>
  `;

  const scrim = document.createElement('div');
  scrim.className = 'cookie-scrim';
  scrim.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'cookie-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Atur preferensi cookie');

  const cats = CATEGORIES.map((c) => `
    <div class="cookie-cat">
      <div class="cookie-cat-text">
        <h3>
          <span data-icon="${c.icon}"></span>
          ${c.label}
          ${c.locked ? '<span class="cookie-tag">selalu aktif</span>' : ''}
        </h3>
        <p>${c.description}</p>
      </div>
      <label class="cookie-switch">
        <input type="checkbox"
               data-cat="${c.id}"
               ${c.locked ? 'checked disabled' : ''}
               aria-label="${c.label}">
        <span class="cookie-switch-track"></span>
        <span class="cookie-switch-knob"><span data-icon="${c.locked ? 'lock' : 'check'}"></span></span>
      </label>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="cookie-panel-head">
      <div>
        <h2>Preferensi cookie</h2>
        <p>Pilih kategori yang Anda izinkan. Pilihan bisa diubah kapan saja.</p>
      </div>
      <button type="button" class="cookie-close" data-consent="close-panel" aria-label="Tutup">
        <span data-icon="close"></span>
      </button>
    </div>
    <div class="cookie-panel-body">${cats}</div>
    <div class="cookie-panel-foot">
      <button type="button" class="cookie-btn cookie-btn--decision" data-consent="reject-all">
        Tolak semua
      </button>
      <button type="button" class="cookie-btn cookie-btn--decision" data-consent="save">
        Simpan pilihan
      </button>
    </div>
  `;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'cookie-fab';
  fab.setAttribute('aria-label', 'Atur preferensi cookie');
  fab.setAttribute('title', 'Preferensi cookie');
  fab.innerHTML = '<span data-icon="shield"></span>';

  document.body.append(banner, scrim, panel, fab);
  return { banner, scrim, panel, fab };
}

export function initCookieConsent() {
  // Kalau modul ikon belum siap, banner tetap tampil tanpa ikon —
  // fungsinya tidak boleh bergantung pada hiasan.
  const { banner, scrim, panel, fab } = build();
  paintIcons(document.body);

  // ── `saved` HARUS BISA DIPERBARUI (BUG YANG DIPERBAIKI) ──────────────────
  // Versi lama memakai `const saved = loadConsent()` — dibaca SEKALI saat
  // init, dan TIDAK PERNAH diperbarui.
  //
  // Akibatnya: pengunjung klik "Terima semua" → pilihan tersimpan ke
  // localStorage, TAPI `saved` masih berisi nilai lama (null). Saat mereka
  // membuka panel "Atur pilihan", toggle analitik terisi dari `saved` yang
  // basi → TIDAK tercentang, padahal mereka baru saja menerima semua.
  //
  // Dua dampak:
  //   1. Membingungkan — pengunjung mengira pilihannya tidak tersimpan,
  //      lalu klik "Simpan pilihan" → analitik justru ikut MATI
  //   2. Tidak jujur — panel menampilkan keadaan yang bukan keadaan
  //      sebenarnya. Untuk dialog persetujuan, itu cacat kepatuhan.
  //
  // `let` (bukan `const`) supaya commit() bisa memperbaruinya.
  let saved = loadConsent();

  // Keluar lebih cepat dari masuk — saat pengguna sudah memutuskan,
  // jangan tahan mereka menonton animasi. Kelas `is-hiding` mempercepat
  // turunnya bilah dan melepas tahapan muncul bertahap.
  const showBanner = () => {
    banner.classList.remove('is-hiding');
    banner.classList.add('is-visible');
  };
  const hideBanner = () => {
    banner.classList.add('is-hiding');
    banner.classList.remove('is-visible');
  };

  const openPanel = () => {
    // ── ISI ULANG TOGGLE SETIAP PANEL DIBUKA ─────────────────────────────────
    // Ini yang membuat panel selalu menampilkan keadaan SEBENARNYA.
    //
    // `saved` dibaca ulang (bukan disalin sekali di init) — jadi kalau
    // pengunjung klik "Terima semua" lalu membuka panel, toggle analitik
    // sudah tercentang. Sebelumnya nilai basi membuat toggle tampil mati.
    //
    // `cat?.locked` dilewati: kategori esensial selalu aktif dan tidak boleh
    // diubah. Toggle-nya sudah `disabled` di markup, tapi pemeriksaan di sini
    // membuat niatnya eksplisit — dan mencegah bug kalau markup berubah.
    panel.querySelectorAll('input[data-cat]').forEach((input) => {
      const id = input.dataset.cat;
      const cat = CATEGORIES.find((c) => c.id === id);
      if (cat?.locked) return;
      input.checked = saved?.choices?.[id] === true;
    });
    scrim.classList.add('is-visible');
    panel.classList.add('is-visible');
    document.body.classList.add('cookie-panel-open');
    hideBanner();
    // Fokus ke tombol tutup supaya pengguna keyboard tidak tersesat.
    panel.querySelector('.cookie-close')?.focus();
  };

  const closePanel = () => {
    scrim.classList.remove('is-visible');
    panel.classList.remove('is-visible');
    document.body.classList.remove('cookie-panel-open');
  };

  /**
   * Simpan pilihan dan tutup semua lapisan.
   *
   * ── `saved` DIPERBARUI DI SINI (BUG YANG DIPERBAIKI) ─────────────────────
   * Ini baris yang membuat panel selalu menampilkan keadaan sebenarnya.
   *
   * Tanpa ini, urutan berikut terjadi:
   *   1. Klik "Terima semua"  → localStorage = { analytics: true }
   *   2. `saved` masih null   → panel berikutnya membaca nilai basi
   *   3. Toggle tampil TIDAK tercentang, padahal pengunjung baru menerima
   *
   * Sekarang `saved` selalu mencerminkan apa yang terakhir dipilih, jadi
   * panel "Atur pilihan" menampilkan keadaan yang JUJUR.
   */
  const commit = (choices) => {
    saveConsent(choices);
    applyConsent(choices);
    // Perbarui salinan di memori supaya openPanel() membaca nilai terbaru.
    saved = loadConsent();
    hideBanner();
    closePanel();
    fab.classList.add('is-visible');
  };

  banner.addEventListener('click', (e) => {
    const action = e.target.closest('[data-consent]')?.dataset.consent;
    if (action === 'accept-all') commit({ analytics: true });
    else if (action === 'reject-all') commit({ analytics: false });
    else if (action === 'open-panel') openPanel();
  });

  panel.addEventListener('click', (e) => {
    const action = e.target.closest('[data-consent]')?.dataset.consent;
    if (action === 'close-panel') {
      // Menutup tanpa menyimpan = belum memilih. Banner dimunculkan lagi
      // supaya pilihan tetap eksplisit — bukan diam-diam dianggap setuju.
      closePanel();
      if (!loadConsent()) showBanner();
    } else if (action === 'reject-all') {
      // Perbarui toggle dulu supaya panel mencerminkan pilihan ini kalau
      // pengunjung membukanya lagi dalam sesi yang sama. Tanpa ini, toggle
      // masih menampilkan keadaan sebelum tombol ditekan.
      //
      // (commit() juga memperbarui `saved`, jadi dua-duanya konsisten.)
      panel.querySelectorAll('input[data-cat]').forEach((input) => {
        const cat = CATEGORIES.find((c) => c.id === input.dataset.cat);
        if (cat?.locked) return;
        input.checked = false;
      });
      commit({ analytics: false });
    } else if (action === 'save') {
      const choices = {};
      panel.querySelectorAll('input[data-cat]').forEach((input) => {
        choices[input.dataset.cat] = input.checked;
      });
      commit(choices);
    }
  });

  scrim.addEventListener('click', () => {
    closePanel();
    if (!loadConsent()) showBanner();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('is-visible')) {
      closePanel();
      if (!loadConsent()) showBanner();
    }
  });

  fab.addEventListener('click', openPanel);

  // Keputusan awal:
  if (saved) {
    // Sudah pernah memilih — jangan ganggu lagi, cukup sediakan tombol
    // mengambang untuk mengubah pilihan.
    applyConsent(saved.choices ?? {});
    fab.classList.add('is-visible');
  } else {
    // Belum pernah memilih — tampilkan banner setelah halaman sempat
    // tenang, supaya tidak berebut perhatian dengan konten utama.
    setTimeout(showBanner, 900);
  }
}

/** Buka panel preferensi dari luar (mis. tautan di footer). */
export function openCookieSettings() {
  document.querySelector('.cookie-fab')?.click();
}
