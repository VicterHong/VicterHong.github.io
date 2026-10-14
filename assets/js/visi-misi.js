/**
 * VISI & MISI — kartu miring "dipin" + jalur mengalir.
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
 *   1. Memutar persegi panjang tidak memindahkan titik tengahnya.
 *   2. Titik tengah kotak pembatas = titik tengah kartu yang diputar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SATU MODUL, BUKAN TIGA
 * ══════════════════════════════════════════════════════════════════════════
 * Kartu, jalur, dan reveal semuanya bergantung pada satu hal yang sama:
 * posisi titik tengah kartu. Memisahkannya ke berkas berbeda berarti tiga
 * tempat yang harus sepakat tentang cara mengukurnya — dan itu persis jenis
 * kesalahan yang membuat garisnya meleset di versi-versi sebelumnya.
 */

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tandai tiap kartu: kiri atau kanan.
 *
 * ── KENAPA DI JS, BUKAN `:nth-child` DI CSS ─────────────────────────────────
 * `:nth-child(odd)` bekerja untuk urutan yang selalu dimulai dari kiri. Kalau
 * nanti ada kartu yang disisipkan di tengah, pola CSS-nya harus ditulis ulang.
 * Di sini sisi ditentukan dari INDEKS, jadi konsisten berapa pun jumlahnya.
 */
function tandaiSisi(langkah) {
  langkah.forEach((li, i) => {
    li.setAttribute('data-sisi', i % 2 === 0 ? 'kiri' : 'kanan');
  });
}

/**
 * Tandai satu kartu sebagai "sudah muncul".
 *
 * Satu helper menandai KEDUANYA (pembungkus dan kartunya), supaya tidak
 * mungkin berbeda. Bug lama: kelas dipasang di elemen yang di-observe padahal
 * CSS menaruh `opacity: 0` di anaknya — kartunya transparan selamanya.
 */
function tandaiMuncul(li) {
  li.classList.add('is-muncul');
  li.querySelector('.vm-item')?.classList.add('is-muncul');
}

/**
 * Gambar jalur yang menghubungkan titik tengah tiap kartu.
 *
 * ── BENTUK KURVA ────────────────────────────────────────────────────────────
 * Bézier kubik dengan TANGEN HORIZONTAL di kedua ujungnya:
 *
 *     M  x1 y1  C  x1+dx/2 y1 , x2-dx/2 y2 , x2 y2
 *
 * Garis keluar sejajar tepi kartu, berbelok di tengah, masuk sejajar tepi
 * kartu berikutnya. Karena ujungnya tersembunyi DI BAWAH kartu, transisinya
 * tidak terlihat sama sekali.
 *
 * ── CARA MENGUKUR ───────────────────────────────────────────────────────────
 * `getBoundingClientRect()` untuk tiap kartu, titik tengahnya dihitung relatif
 * terhadap papan. Titik tengah kotak pembatas = titik tengah kartu (rotasi
 * tidak memindahkannya), jadi hasilnya tepat walau kartunya miring.
 */
function gambarJalur(papan, jalur, langkah) {
  const path = jalur?.querySelector('path');
  if (!path || langkah.length < 2) return;

  const kotakPapan = papan.getBoundingClientRect();
  const lebar = Math.round(kotakPapan.width);
  const tinggi = Math.round(kotakPapan.height);
  if (lebar < 2 || tinggi < 2) return;

  jalur.setAttribute('viewBox', `0 0 ${lebar} ${tinggi}`);
  jalur.setAttribute('width', lebar);
  jalur.setAttribute('height', tinggi);

  const titik = langkah.map((li) => {
    const kartu = li.querySelector('.vm-kartu') ?? li;
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
 * Aman dipanggil berkali-kali dan aman kalau elemennya tidak ada.
 */
export function initVisiMisi(akar = document) {
  const timeline = akar.querySelector('[data-vm]');
  if (!timeline) return;

  const papan = timeline.closest('.vm-papan') ?? timeline;
  const jalur = papan.querySelector('.vm-jalur');
  const langkah = Array.from(timeline.querySelectorAll('.vm-langkah'));
  if (!langkah.length) return;

  // Sisi kiri/kanan ditandai SEBELUM apa pun — posisi kartu dan arah
  // rotasinya bergantung padanya.
  tandaiSisi(langkah);

  const gambar = () => gambarJalur(papan, jalur, langkah);

  // Satu frame ditunda supaya font dan ukuran kartu sudah final saat diukur.
  if (jalur) requestAnimationFrame(gambar);

  // ── Reduced motion: kartu langsung muncul, garis berhenti mengalir ───────
  // Kartunya tetap terlihat semua (itu informasi), dan jalurnya tetap
  // tergambar (itu juga informasi — ia menunjukkan urutan). Yang hilang hanya
  // geraknya: animasi dash dimatikan CSS, transisi reveal dilewati di sini.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const li of langkah) tandaiMuncul(li);
    if (jalur) requestAnimationFrame(gambar);
    return;
  }

  const pengamat = new IntersectionObserver((entri) => {
    const kini = Array.from(timeline.querySelectorAll('.vm-langkah'));

    // Urutkan berdasarkan indeks DOM, bukan urutan kedatangan: browser bisa
    // melaporkan beberapa entri sekaligus saat pengguna menggulir cepat.
    const masuk = entri
      .filter((e) => e.isIntersecting)
      .sort((a, b) => kini.indexOf(a.target) - kini.indexOf(b.target));

    masuk.forEach((e, i) => {
      // Jeda bertingkat 110ms: kartu yang masuk bersamaan tetap muncul
      // berurutan. Kartu yang masuk sendiriian tidak menunggu (`i` = 0).
      e.target.style.setProperty('--vm-tunda', `${i * 110}ms`);
      tandaiMuncul(e.target);
      pengamat.unobserve(e.target);

      // Jalur digambar ulang: sebelum muncul, kartunya `translateY(28px)` —
      // kotak pembatasnya ada di posisi yang lebih rendah dari posisi
      // finalnya. Digambar dua kali: segera (mengikuti gerakan) dan setelah
      // transisi selesai (yang menentukan posisi akhir).
      if (jalur) {
        requestAnimationFrame(gambar);
        setTimeout(gambar, 800);
      }
    });
  }, {
    // -8%: kartu mulai muncul begitu tepinya masuk ~8% ke dalam layar.
    // Dengan nilai yang lebih besar, animasinya selesai SEBELUM mata sempat
    // sampai saat menggulir.
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.01,
  });

  for (const li of langkah) pengamat.observe(li);

  // ── Jaring pengaman ───────────────────────────────────────────────────────
  // Kalau observer tidak pernah menembak (bug browser, halaman dibuka dengan
  // scroll sudah di tengah, gate Cloudflare), kartu tetap transparan
  // SELAMANYA. Sekali diperiksa di 2,5 detik, bukan loop.
  setTimeout(() => {
    for (const li of langkah) {
      if (li.classList.contains('is-muncul')) continue;
      if (li.getBoundingClientRect().top < window.innerHeight) tandaiMuncul(li);
    }
    if (jalur) gambar();
  }, 2500);

  // ── Ukuran berubah ────────────────────────────────────────────────────────
  // Jalur diukur dari posisi kartu, dan posisi itu berubah saat lebar layar
  // berubah. Ditunda 150ms: `resize` menyala terus saat menyeret tepi jendela.
  let timerUbah = null;
  window.addEventListener('resize', () => {
    clearTimeout(timerUbah);
    timerUbah = setTimeout(gambar, 150);
  });

  // Font web bisa tiba setelah init dan mengubah tinggi kartu — titik
  // tengahnya ikut bergeser.
  if (document.fonts?.ready) {
    document.fonts.ready.then(gambar).catch(() => {});
  }

  // ── Gate Cloudflare ───────────────────────────────────────────────────────
  // Selama gate aktif, isi halaman disembunyikan (`display: none`), dan elemen
  // `display: none` tidak pernah memicu IntersectionObserver.
  document.addEventListener('cf-gate:lulus', () => {
    for (const li of langkah) {
      if (li.classList.contains('is-muncul')) continue;
      const kotak = li.getBoundingClientRect();
      if (kotak.top < window.innerHeight && kotak.height > 0) {
        tandaiMuncul(li);
        pengamat.unobserve(li);
      }
    }
    if (jalur) requestAnimationFrame(gambar);
  });
}

export default initVisiMisi;
