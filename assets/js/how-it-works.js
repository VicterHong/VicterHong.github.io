/**
 * HOW IT WORKS — reveal satu per satu + sumbu yang bertambah tinggi.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA VANILLA, BUKAN REACT + MOTION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Komponen asalnya (21st.dev) memakai React, motion/react, dan Tailwind.
 * Situs ini HTML statis + vanilla JS — dan sudah punya aturan itu sejak awal:
 * `cinematic.js` menulis "Nol dependency (PRIOR pakai GSAP; kita pakai rAF +
 * IntersectionObserver)".
 *
 * Gerak yang sama tanpa 34 KB library:
 *
 *   yang dibutuhkan          cara di sini
 *   ────────────────────     ────────────────────────────────────────────────
 *   reveal satu per satu     IntersectionObserver, satu entri per langkah
 *   sumbu yang bertambah     tinggi elemen di-set seiring langkah muncul
 *   menghormati reduced      matchMedia, berhenti tanpa memanggil apa pun
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA LEBIH SEDERHANA DARI VERSI PERTAMA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Versi pertama menghitung kurva SVG antar kartu: posisi tiap kartu dibaca,
 * titik jangkar dihitung dengan kompensasi rotasi, panjang tiap segmen diukur
 * satu per satu. Itu ~120 baris geometri yang harus dihitung ulang setiap kali
 * ukuran berubah — dan tetap meleset karena kartunya diputar (garisnya
 * berhenti 7,7px di luar tepi kartu, jadi terlihat melayang).
 *
 * Sekarang konektor adalah elemen CSS biasa. Ia menghubungkan tepi kartu ke
 * sumbu, dan keduanya adalah elemen nyata di layout — jadi tidak ada angka
 * yang bisa salah. JS hanya perlu:
 *
 *   1. menandai sisi kiri/kanan tiap langkah (untuk konektor & posisi kartu)
 *   2. menandai langkah yang sudah muncul (untuk reveal)
 *   3. menaikkan sumbu aksen setinggi langkah terakhir yang muncul
 *
 * Semuanya diukur dari DOM saat itu juga — jadi jumlah langkah boleh berubah
 * kapan saja tanpa ada yang perlu disesuaikan.
 */

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tandai tiap langkah: kiri atau kanan.
 *
 * ── KENAPA DI JS, BUKAN `:nth-child` DI CSS ─────────────────────────────────
 * `:nth-child(odd)` bekerja untuk urutan yang selalu dimulai dari kiri. Tapi
 * kalau nanti ada langkah yang disisipkan di tengah, atau daftarnya dimulai
 * dari kanan, pola CSS-nya harus ditulis ulang — dan kesalahannya baru
 * terlihat saat dilihat.
 *
 * Di sini sisi ditentukan dari INDEKS, jadi konsisten berapa pun jumlahnya.
 * Atributnya juga bisa dibaca dari luar (dan diuji) tanpa membuka CSS.
 */
function tandaiSisi(langkah) {
  langkah.forEach((li, i) => {
    li.setAttribute('data-sisi', i % 2 === 0 ? 'kiri' : 'kanan');
  });
}

/**
 * Tandai satu langkah sebagai "sudah muncul".
 *
 * ── KENAPA DUA ELEMEN, BUKAN SATU ───────────────────────────────────────────
 *
 * ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────────
 * Kelas `is-muncul` sempat hanya dipasang di `.hiw-langkah` (elemen yang
 * di-observe). Tapi CSS menaruh `opacity: 0` di `.hiw-item` — anak di dalamnya.
 * Kelas dan pemilik opacity-nya BEDA ELEMEN, jadi kartunya transparan
 * selamanya: sumbunya naik (karena ia membaca `.hiw-langkah`), tapi kartunya
 * tidak pernah terlihat. Persis yang terlihat di tangkapan layar.
 *
 * Sekarang kelas dipasang di KEDUANYA:
 *   `.hiw-langkah` — dipakai `naikkanSumbu()` untuk tahu sejauh mana garis
 *   `.hiw-item`    — pemilik `opacity` + `transform` yang dianimasikan
 *
 * Satu helper, supaya keduanya tidak pernah bisa berbeda lagi.
 */
function tandaiMuncul(li) {
  li.classList.add('is-muncul');
  li.querySelector('.hiw-item')?.classList.add('is-muncul');
}

/**
 * Naikkan sumbu aksen setinggi bagian yang sudah dilalui.
 *
 * ── KENAPA SAMPAI LANGKAH TERAKHIR YANG MUNCUL, BUKAN POSISI SCROLL ─────────
 * Kalau sumbu dipetakan ke posisi scroll, ia bisa sudah 40% terisi saat
 * halaman baru dibuka (karena sebagian timeline memang sudah terlihat) dan
 * berhenti di 70% saat timeline selesai lewat layar. Dua-duanya salah.
 *
 * Dengan mengikatnya ke langkah yang sudah muncul, sumbu dan kartu selalu
 * sinkron — dan sumbu pasti penuh tepat saat langkah terakhir muncul.
 *
 * ── CARA MENGUKUR ───────────────────────────────────────────────────────────
 * Titik tengah marker langkah terakhir, relatif terhadap timeline. Memakai
 * `getBoundingClientRect()` karena marker bisa punya margin yang tidak ikut
 * terhitung di `offsetTop`.
 */
function naikkanSumbu(timeline, sumbuIsi, langkah) {
  if (!sumbuIsi) return;

  const muncul = langkah.filter((li) => li.classList.contains('is-muncul'));
  if (!muncul.length) {
    sumbuIsi.style.height = '0px';
    return;
  }

  const kotakTimeline = timeline.getBoundingClientRect();
  const terakhir = muncul[muncul.length - 1];
  const marker = terakhir.querySelector('.hiw-marker') ?? terakhir;
  const kotakMarker = marker.getBoundingClientRect();

  // ── KENAPA SAMPAI BAWAH MARKER, BUKAN TENGAHNYA ────────────────────────────
  //
  // ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────────
  // Versi pertama berhenti di TENGAH marker terakhir. Itu terlihat benar
  // selama belum semua langkah muncul (garis "berjalan" menuju marker
  // berikutnya), tapi salah begitu langkah terakhir muncul: garisnya berhenti
  // di tengah lingkaran, dan bagian bawah timeline terlihat kosong —
  // seperti ada satu langkah lagi yang belum muncul.
  //
  // Kalau SEMUA langkah sudah muncul, sumbu harus melewati marker terakhir
  // sampai bawah. Kalau belum, ia berhenti di tengah marker terakhir yang
  // muncul — supaya terlihat "sedang berjalan" ke langkah berikutnya.
  const semuaMuncul = muncul.length === langkah.length;

  const tinggi = semuaMuncul
    ? kotakMarker.bottom - kotakTimeline.top
    : kotakMarker.top - kotakTimeline.top + kotakMarker.height / 2;

  sumbuIsi.style.height = `${Math.max(0, tinggi)}px`;
}

/**
 * Inisialisasi.
 *
 * Aman dipanggil berkali-kali dan aman kalau elemennya tidak ada — halaman
 * lain yang memuat berkas ini tidak akan error.
 */
export function initHowItWorks(akar = document) {
  const timeline = akar.querySelector('[data-hiw]');
  if (!timeline) return;

  const sumbuIsi = timeline.querySelector('.hiw-sumbu-isi');
  const langkah = Array.from(timeline.querySelectorAll('.hiw-langkah'));
  if (!langkah.length) return;

  // ── Penanda "JS hidup" ────────────────────────────────────────────────────
  // Tanpa ini, kartu tetap `opacity: 0` selamanya kalau skrip gagal dimuat.
  // Pola yang sama dengan `.js-ready` di main.css.
  document.documentElement.classList.add('js-ready');

  // Sisi kiri/kanan ditandai SEBELUM apa pun — konektor dan posisi kartu
  // bergantung padanya.
  tandaiSisi(langkah);

  // ── Reduced motion: semua langsung muncul, sumbu langsung penuh ───────────
  //
  // Tidak ada yang disembunyikan dan tidak ada yang dianimasikan — pengguna
  // meminta gerak diminimalkan. Sumbu penuh diatur CSS (`height: 100%
  // !important` di media query), jadi JS tidak perlu menyentuhnya.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const li of langkah) tandaiMuncul(li);
    return;
  }

  // Timer untuk menunda pengangkatan sumbu sampai transisi kartu selesai.
  // Satu timer di scope ini, bukan properti di observer — supaya jelas bahwa
  // hanya ada SATU penundaan yang berjalan pada satu waktu.
  let timerSumbu = null;

  const pengamat = new IntersectionObserver((entri) => {
    // Daftar dibaca ulang: jumlah langkah bisa berubah setelah init, dan
    // daftar lama akan menyebut elemen yang sudah tidak ada.
    const kini = Array.from(timeline.querySelectorAll('.hiw-langkah'));

    // Urutkan berdasarkan indeks DOM, bukan urutan kedatangan: browser bisa
    // melaporkan beberapa entri sekaligus saat pengguna menggulir cepat, dan
    // urutan laporan tidak dijamin sama dengan urutan di halaman.
    const masuk = entri
      .filter((e) => e.isIntersecting)
      .sort((a, b) => kini.indexOf(a.target) - kini.indexOf(b.target));

    masuk.forEach((e, i) => {
      // Jeda bertingkat: langkah yang masuk bersamaan tetap muncul berurutan,
      // 90ms satu sama lain. Langkah yang masuk sendiriian (scroll lambat)
      // tidak menunggu — `i` = 0 saat hanya satu yang masuk.
      e.target.style.setProperty('--hiw-tunda', `${i * 90}ms`);
      tandaiMuncul(e.target);
      pengamat.unobserve(e.target);
    });

    // Sumbu menyusul setelah transisi kartu selesai, supaya garisnya terlihat
    // "menyambung" ke marker yang baru muncul — bukan mendahuluinya.
    clearTimeout(timerSumbu);
    timerSumbu = setTimeout(() => naikkanSumbu(timeline, sumbuIsi, kini), 220);
  }, {
    // ── KENAPA rootMargin NEGATIF, BUKAN POSITIF ─────────────────────────────
    // `0px 0px -18%` MEMPERSEMPIT area pemicu, sehingga langkah harus benar-
    // benar masuk ~18% ke dalam layar sebelum muncul. Dengan rootMargin
    // positif, langkah yang masih di bawah layar sudah dianggap masuk — dan
    // beberapa terpicu sekaligus sehingga urutannya hilang.
    //
    // Batas atas tetap 0 supaya langkah yang sudah lewat tidak pernah "belum
    // muncul" — langkah pertama harus terlihat tanpa menunggu scroll.
    rootMargin: '0px 0px -18% 0px',
    threshold: 0.01,
  });

  for (const li of langkah) pengamat.observe(li);

  // ── Jaring pengaman ───────────────────────────────────────────────────────
  //
  // Kalau observer tidak pernah menembak (bug browser, halaman dibuka dengan
  // scroll sudah di tengah, atau elemen dirender ulang), kartu tetap
  // transparan SELAMANYA. Sekali diperiksa di 2,5 detik — bukan loop — dan
  // hanya untuk langkah yang sudah terlihat.
  setTimeout(() => {
    const kini = Array.from(timeline.querySelectorAll('.hiw-langkah'));
    const batas = window.innerHeight;
    let adaBaru = false;

    for (const li of kini) {
      if (li.classList.contains('is-muncul')) continue;
      if (li.getBoundingClientRect().top < batas) {
        tandaiMuncul(li);
        adaBaru = true;
      }
    }

    if (adaBaru) naikkanSumbu(timeline, sumbuIsi, kini);
  }, 2500);

  // ── Ukuran berubah ────────────────────────────────────────────────────────
  //
  // Sumbu diukur dari posisi marker, dan posisi itu berubah saat lebar layar
  // berubah (kartu menumpuk di ponsel, teks membungkus ulang di layar sempit).
  // Tanpa perhitungan ulang, sumbunya berhenti di tempat yang salah.
  //
  // Ditunda 150ms: `resize` menyala terus saat pengguna menyeret tepi jendela,
  // dan menghitung pada setiap frame membuang kerja yang langsung basi.
  let timerUbah = null;
  window.addEventListener('resize', () => {
    clearTimeout(timerUbah);
    timerUbah = setTimeout(() => {
      const kini = Array.from(timeline.querySelectorAll('.hiw-langkah'));
      naikkanSumbu(timeline, sumbuIsi, kini);
    }, 150);
  });

  // Font web bisa tiba setelah init dan mengubah tinggi kartu — posisi marker
  // ikut bergeser. Satu perhitungan ulang setelah font siap menutup selisih itu.
  if (document.fonts?.ready) {
    document.fonts.ready
      .then(() => naikkanSumbu(timeline, sumbuIsi, langkah))
      .catch(() => {});
  }
}

export default initHowItWorks;
