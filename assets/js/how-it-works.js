/**
 * HOW IT WORKS — jalur mengalir + reveal kartu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA VANILLA, BUKAN REACT + MOTION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Komponen asalnya (chamaac, 21st.dev) memakai React, motion/react, dan
 * Tailwind. Situs ini HTML statis + vanilla JS — dan sudah punya aturan itu
 * sejak awal: `cinematic.js` menulis "Nol dependency (PRIOR pakai GSAP; kita
 * pakai rAF + IntersectionObserver)".
 *
 * Gerak yang sama tanpa 34 KB library:
 *
 *   yang dibutuhkan          cara di sini
 *   ────────────────────     ────────────────────────────────────────────────
 *   garis mengalir           @keyframes stroke-dashoffset di CSS
 *   reveal satu per satu     IntersectionObserver, satu entri per kartu
 *   jalur antar kartu        satu <path> yang `d`-nya diisi dari titik tengah
 *   menghormati reduced      matchMedia, berhenti tanpa memanggil apa pun
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KUNCI: GARIS DIMULAI DARI TITIK TENGAH KARTU, BUKAN DARI TEPINYA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Ini yang menyelesaikan masalah "garis tidak menempel ke kartu" untuk
 * selamanya — masalah yang bertahan di tiga versi sebelumnya.
 *
 * Versi-versi itu menggambar garis dari TEPI kartu. Tepi bergerak setiap kali
 * ukuran huruf, lebar layar, atau panjang teks berubah. Dan karena kartunya
 * DIMIRINGKAN, `getBoundingClientRect()` mengembalikan kotak PEMBATAS yang
 * ~7,7px lebih besar dari tepi visualnya — jadi garisnya mulai di luar kartu
 * dan terlihat melayang.
 *
 * Sekarang: garis mulai dari TITIK TENGAH kartu dan digambar DI BELAKANG
 * kartu. Ujungnya tersembunyi di bawah kartu, jadi tidak ada celah yang
 * MUNGKIN terlihat — berapa pun ukuran kartunya.
 *
 * Dua sifat membuat ini kokoh:
 *
 *   1. Memutar persegi panjang tidak memindahkan titik tengahnya. Jadi
 *      rotasi 8° sama sekali tidak berpengaruh — tidak perlu kompensasi
 *      trigonometri seperti versi pertama.
 *   2. Kotak pembatas dan tepi visual boleh berbeda; yang dipakai adalah
 *      TITIK TENGAH, dan titik tengah kotak pembatas = titik tengah
 *      persegi panjang yang diputar. Selisih 7,7px itu tidak lagi relevan.
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
 * Tandai satu kartu sebagai "sudah muncul".
 *
 * ── BUG YANG PERNAH TERJADI, JANGAN DIULANG ────────────────────────────────
 * Kelas ini sempat dipasang di elemen yang salah: di `.hiw-langkah` (elemen
 * yang di-observe), padahal CSS menaruh `opacity: 0` di `.hiw-item`. Kelas dan
 * pemilik opacity-nya BEDA ELEMEN, jadi kartunya transparan selamanya —
 * observer jalan, tapi tidak ada yang terlihat.
 *
 * Sekarang satu helper menandai KEDUANYA, jadi tidak mungkin berbeda lagi.
 */
function tandaiMuncul(li) {
  li.classList.add('is-muncul');
  li.querySelector('.hiw-item')?.classList.add('is-muncul');
}

/**
 * Gambar jalur yang menghubungkan titik tengah tiap kartu.
 *
 * ── BENTUK KURVA ────────────────────────────────────────────────────────────
 * Kurva Bézier kubik dengan TANGEN HORIZONTAL di kedua ujungnya:
 *
 *     M  x1 y1  C  x1+dx/2 y1 , x2-dx/2 y2 , x2 y2
 *
 * Karena `dx` sama untuk kedua titik kontrol, keduanya berada di kolom x yang
 * sama (titik tengah). Itu yang membuat kurvanya berbentuk S yang mulus:
 * meninggalkan kartu secara mendatar, berbelok di tengah, lalu masuk ke kartu
 * berikutnya secara mendatar juga.
 *
 * ── KENAPA TANGEN HORIZONTAL PENTING ────────────────────────────────────────
 * Garis yang menembus tepi kartu secara miring terlihat seperti menusuk.
 * Dengan tangen horizontal, ujungnya keluar sejajar tepi kartu — dan karena
 * ujungnya tersembunyi DI BAWAH kartu, transisinya tidak terlihat sama sekali.
 *
 * ── CARA MENGUKUR ───────────────────────────────────────────────────────────
 * `getBoundingClientRect()` untuk tiap kartu, lalu titik tengahnya dihitung
 * relatif terhadap papan. Titik tengah kotak pembatas = titik tengah kartu
 * (rotasi tidak memindahkannya), jadi hasilnya tepat walau kartunya miring.
 *
 * Dipanggil ulang saat ukuran berubah dan saat font selesai dimuat — posisi
 * kartu bergeser setiap kali teks membungkus ulang.
 */
function gambarJalur(papan, jalur, langkah) {
  const path = jalur?.querySelector('path');
  if (!path || langkah.length < 2) return;

  const kotakPapan = papan.getBoundingClientRect();
  const lebar = Math.round(kotakPapan.width);
  const tinggi = Math.round(kotakPapan.height);
  if (lebar < 2 || tinggi < 2) return;

  // viewBox disetel sama persis dengan ukuran piksel — jadi 1 satuan = 1 px
  // dan tidak ada peregangan yang bisa mengubah ketebalan garis.
  jalur.setAttribute('viewBox', `0 0 ${lebar} ${tinggi}`);
  jalur.setAttribute('width', lebar);
  jalur.setAttribute('height', tinggi);

  const titik = langkah.map((li) => {
    const kartu = li.querySelector('.hiw-kartu') ?? li;
    const r = kartu.getBoundingClientRect();
    return {
      x: Math.round(r.left - kotakPapan.left + r.width / 2),
      y: Math.round(r.top - kotakPapan.top + r.height / 2),
    };
  });

  let d = `M ${titik[0].x} ${titik[0].y}`;
  for (let i = 1; i < titik.length; i++) {
    const a = titik[i - 1];
    const b = titik[i];
    const setengah = (b.x - a.x) / 2;
    d += ` C ${a.x + setengah} ${a.y}, ${b.x - setengah} ${b.y}, ${b.x} ${b.y}`;
  }

  path.setAttribute('d', d);
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

  // Papan adalah pembungkus yang memuat SVG + daftar. Kalau tidak ada
  // (HTML lama), jalurnya dilewati saja — kartunya tetap tampil.
  const papan = timeline.closest('.hiw-papan') ?? timeline;
  const jalur = papan.querySelector('.hiw-jalur');
  const langkah = Array.from(timeline.querySelectorAll('.hiw-langkah'));
  if (!langkah.length) return;

  // ── Penanda "JS hidup" ────────────────────────────────────────────────────
  // Tanpa ini, kartu tetap `opacity: 0` selamanya kalau skrip gagal dimuat.
  // Pola yang sama dengan `.js-ready` di main.css.
  document.documentElement.classList.add('js-ready');

  // Sisi kiri/kanan ditandai SEBELUM apa pun — posisi kartu dan arah
  // rotasinya bergantung padanya.
  tandaiSisi(langkah);

  // ── Jalur: digambar setelah layout siap ───────────────────────────────────
  // Satu frame ditunda supaya font dan ukuran kartu sudah final saat diukur.
  const gambar = () => gambarJalur(papan, jalur, langkah);
  if (jalur) requestAnimationFrame(gambar);

  // ── Reduced motion: kartu langsung muncul, garis berhenti mengalir ───────
  //
  // Kartunya tetap terlihat semua (itu informasi), dan jalurnya tetap
  // tergambar (itu juga informasi — ia menunjukkan urutan). Yang hilang hanya
  // geraknya: animasi dash dimatikan CSS, transisi reveal dilewati di sini.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const li of langkah) tandaiMuncul(li);
    if (jalur) requestAnimationFrame(gambar);
    return;
  }

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
      // Jeda bertingkat: kartu yang masuk bersamaan tetap muncul berurutan,
      // 110ms satu sama lain. Kartu yang masuk sendiriian (scroll lambat)
      // tidak menunggu — `i` = 0 saat hanya satu yang masuk.
      e.target.style.setProperty('--hiw-tunda', `${i * 110}ms`);
      tandaiMuncul(e.target);
      pengamat.unobserve(e.target);

      // ── Jalur digambar ulang saat kartu ini muncul ─────────────────────────
      // Sebelum muncul, kartunya `translateY(28px)` — kotak pembatasnya ada di
      // posisi yang lebih rendah dari posisi finalnya. Kalau jalurnya dibiarkan
      // memakai ukuran itu, ujungnya berhenti di tempat yang salah.
      //
      // Digambar dua kali: sekali segera (supaya jalurnya mengikuti gerakan),
      // sekali setelah transisi selesai (supaya ujungnya tepat di posisi
      // final). Yang kedua itu yang menentukan.
      if (jalur) {
        requestAnimationFrame(gambar);
        setTimeout(gambar, 800);
      }
    });
  }, {
    // ── KENAPA rootMargin NEGATIF, BUKAN POSITIF ─────────────────────────────
    // Nilai negatif MEMPERSEMPIT area pemicu, sehingga kartu harus masuk
    // sedikit ke dalam layar sebelum muncul. Dengan rootMargin positif,
    // kartu yang masih di bawah layar sudah dianggap masuk — dan beberapa
    // terpicu sekaligus sehingga urutannya hilang.
    //
    // Batas atas tetap 0 supaya kartu yang sudah lewat tidak pernah "belum
    // muncul" — kartu pertama harus terlihat tanpa menunggu scroll.
    //
    // -8% dipilih supaya kartu mulai memudar begitu tepinya masuk ~8% ke
    // dalam layar. Dengan nilai yang lebih besar (pernah dipakai -18%),
    // animasinya selesai SEBELUM mata sempat sampai saat menggulir — dan
    // pemilik proyek melaporkan "ga fade animation sama sekali".
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.01,
  });

  for (const li of langkah) pengamat.observe(li);

  // ── Jaring pengaman ───────────────────────────────────────────────────────
  //
  // Kalau observer tidak pernah menembak (bug browser, halaman dibuka dengan
  // scroll sudah di tengah, atau elemen dirender ulang), kartu tetap
  // transparan SELAMANYA. Sekali diperiksa di 2,5 detik — bukan loop — dan
  // hanya untuk kartu yang sudah terlihat.
  setTimeout(() => {
    const kini = Array.from(timeline.querySelectorAll('.hiw-langkah'));
    const batas = window.innerHeight;

    for (const li of kini) {
      if (li.classList.contains('is-muncul')) continue;
      if (li.getBoundingClientRect().top < batas) tandaiMuncul(li);
    }
    if (jalur) gambar();
  }, 2500);

  // ── Ukuran berubah ────────────────────────────────────────────────────────
  //
  // Jalur diukur dari posisi kartu, dan posisi itu berubah saat lebar layar
  // berubah (kartu mengecil, teks membungkus ulang). Tanpa perhitungan ulang,
  // jalurnya berhenti di tempat yang salah.
  //
  // Ditunda 150ms: `resize` menyala terus saat pengguna menyeret tepi jendela,
  // dan menghitung pada setiap frame membuang kerja yang langsung basi.
  let timerUbah = null;
  window.addEventListener('resize', () => {
    clearTimeout(timerUbah);
    timerUbah = setTimeout(gambar, 150);
  });

  // Font web bisa tiba setelah init dan mengubah tinggi kartu — posisi
  // titik tengahnya ikut bergeser. Satu perhitungan ulang setelah font siap
  // menutup selisih itu.
  if (document.fonts?.ready) {
    document.fonts.ready.then(gambar).catch(() => {});
  }
}

export default initHowItWorks;
