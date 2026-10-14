/**
 * HOW IT WORKS — gerak scroll satu per satu + jalur penghubung.
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
 * Gerak yang sama bisa dicapai tanpa 34 KB library:
 *
 *   yang dibutuhkan           cara di sini
 *   ─────────────────────     ──────────────────────────────────────────────
 *   reveal satu per satu      IntersectionObserver, satu entri per kartu
 *   jalur yang menggambar     getTotalLength() + stroke-dashoffset
 *   menghormati reduced       matchMedia, dan berhenti tanpa memanggil apa pun
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA SATU PER SATU, BUKAN SEMUA SEKALIGUS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kartu-kartu ini adalah URUTAN — langkah 1 sebelum 2 sebelum 3. Kalau
 * semuanya muncul serempak, urutannya hilang: mata menerima lima kartu
 * sebagai satu blok, bukan sebagai proses.
 *
 * Yang membuat urutan terbaca: tiap kartu muncul saat SENTUHANNYA SENDIRI
 * dengan garis bawah viewport. Kartu berikutnya menyusul beberapa ratus
 * milidetik kemudian — cukup untuk terasa "satu per satu", tidak cukup untuk
 * membuat pengguna menunggu.
 *
 * Jeda 90ms dipilih dari panduan: untuk daftar panjang, stagger 20-100ms
 * membuat total reveal tetap di bawah satu detik. Lebih dari itu terasa
 * lamban, dan pengguna yang menggulir cepat akan melihat kartu kosong.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * JALUR: KENAPA DIGAMBAR, BUKAN DIANIMASIKAN TERUS-MENERUS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Versi aslinya menganimasikan `strokeDashoffset` tanpa henti (loop 3 detik).
 * Gerak yang tidak pernah berhenti menarik mata ke dirinya sendiri, bukan ke
 * isinya — dan di halaman yang isinya penjelasan proses, itu salah.
 *
 * Di sini jalur MENGGAMBAR SEIRING SCROLL: panjang yang sudah terlihat
 * mengikuti seberapa jauh pengguna melewati panggung. Berhenti saat scroll
 * berhenti, selesai saat panggung selesai. Geraknya membawa makna
 * ("sejauh mana Anda sudah membaca"), bukan sekadar hiasan.
 */

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Susun posisi kartu di layar lebar.
 *
 * ── KENAPA DIHITUNG DI JS, BUKAN DITULIS DI CSS ─────────────────────────────
 * Jumlah langkah bisa berubah (2, 3, 5 langkah) dan tingginya bergantung isi
 * kartu. Posisi `top` yang ditulis tetap di CSS akan salah begitu jumlahnya
 * berubah — dan salahnya tidak kelihatan sampai ada yang membuka halamannya.
 *
 * Di sini posisi diturunkan dari indeks: kartu ganjil ke kiri, genap ke
 * kanan, dan jarak antar kartu tetap. Menambah langkah di HTML cukup dengan
 * menambah satu <li> — tidak ada angka yang perlu disesuaikan.
 */
function susunKartu(daftar, item) {
  // ── DAFTAR DI BACA ULANG DI SINI, BUKAN DIPAKAI DARI LUAR ─────────────────
  //
  // ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────────
  // `item` dikumpulkan SEKALI saat init. Kalau jumlah kartunya berubah setelah
  // itu (halaman menyaring langkah, atau konten dimuat bertahap), daftar lama
  // masih menyebut kartu yang sudah tidak ada — dan tinggi panggung dihitung
  // dari jumlah yang salah. Gejalanya: ruang kosong besar di bawah kartu
  // terakhir.
  //
  // Membaca ulang dari DOM setiap kali membuat fungsi ini selalu memakai
  // keadaan sebenarnya.
  const kartu = Array.from(daftar.querySelectorAll('.hiw-item'));
  item = kartu;
  if (!kartu.length) return 0;

  if (window.innerWidth < 768) {
    // Layar sempit: kartu menumpuk. Bersihkan semua posisi absolut supaya
    // tidak ada sisa dari ukuran layar sebelumnya (pengguna memutar ponsel).
    daftar.style.height = '';
    for (const li of kartu) {
      li.style.top = '';
      li.removeAttribute('data-putar');
    }
    return 0;
  }

  // ── JARAK: 300px, BUKAN 210 ────────────────────────────────────────────────
  // Versi pertama memakai 210px dan itu merusak efek "satu per satu": dengan
  // panggung setinggi ~1230px di viewport 900px, EMPAT dari lima kartu sudah
  // terlihat saat halaman dibuka — animasinya selesai sebelum pengguna
  // menggulir sekali pun.
  //
  // 300px memberi jarak yang cukup supaya tiap kartu butuh scroll tersendiri
  // untuk masuk. Panggungnya jadi ~1650px: dua kali tinggi viewport ponsel,
  // jadi geraknya benar-benar mengikuti scroll.
  const JARAK = 300;   // jarak vertikal antar kartu (px)
  const AWAL = 20;     // jarak kartu pertama dari atas panggung

  kartu.forEach((li, i) => {
    li.style.top = `${AWAL + i * JARAK}px`;
    // Bergantian: kiri, kanan, kiri, ... Kemiringan mengikuti arah.
    li.setAttribute('data-putar', i % 2 === 0 ? 'kanan' : 'kiri');
  });

  // Tinggi panggung = kartu terakhir + tingginya + ruang bawah.
  const terakhir = kartu[kartu.length - 1];
  const tinggi = AWAL + (kartu.length - 1) * JARAK + terakhir.offsetHeight + 40;
  daftar.style.height = `${tinggi}px`;
  return tinggi;
}

/**
 * Gambar jalur penghubung antar kartu.
 *
 * ── KENAPA SVG DIHITUNG, BUKAN PATH TETAP ───────────────────────────────────
 * Versi aslinya menulis path "M 290 150 C 500 150, 550 270, 710 270" dengan
 * angka tetap untuk 5 kartu. Begitu jumlah atau tinggi kartunya berbeda,
 * garisnya meleset dari kartunya.
 *
 * Di sini tiap segmen dihitung dari posisi NYATA kartu (getBoundingClientRect),
 * lalu ditarik sebagai kurva kubik. Ujungnya selalu menempel di kartu —
 * berapa pun jumlah langkahnya.
 */
function gambarJalur(svg, item) {
  const panggung = svg.parentElement;
  const kotakPanggung = panggung.getBoundingClientRect();

  svg.setAttribute('viewBox', `0 0 ${kotakPanggung.width} ${kotakPanggung.height}`);
  svg.innerHTML = '';

  // ── KENAPA < 2 KARTU TIDAK DIGAMBAR ────────────────────────────────────────
  // Jalur menghubungkan kartu satu ke kartu berikutnya. Dengan satu kartu
  // tidak ada yang dihubungkan — menggambarnya berarti ada garis yang keluar
  // dari kartu menuju ruang kosong. Dikosongkan DI SINI (setelah innerHTML
  // dibersihkan) supaya sisa jalur dari perhitungan sebelumnya ikut hilang.
  if (item.length < 2 || window.innerWidth < 768) return null;

  // Titik jangkar: tengah-bawah kartu → tengah-atas kartu berikutnya.
  const titik = item.map((li) => {
    const r = li.getBoundingClientRect();
    return {
      x: r.left - kotakPanggung.left + r.width / 2,
      y: r.top - kotakPanggung.top,
      bawah: r.bottom - kotakPanggung.top,
    };
  });

  let d = '';
  for (let i = 0; i < titik.length - 1; i += 1) {
    const a = titik[i];
    const b = titik[i + 1];

    // Kurva keluar dari bawah kartu A, masuk ke atas kartu B. Titik kendali
    // di tengah jarak vertikal — menghasilkan lengkung lembut, bukan siku.
    const tengahY = (a.bawah + b.y) / 2;
    d += `M ${a.x} ${a.bawah} C ${a.x} ${tengahY}, ${b.x} ${tengahY}, ${b.x} ${b.y} `;
  }

  // Dua lapis: jalur redup (selalu terlihat) + jalur aksen (tergambar).
  // Tanpa lapis pertama, jalur yang belum tergambar tidak terlihat sama sekali
  // dan hubungan antar kartu hilang di awal scroll.
  const NS = 'http://www.w3.org/2000/svg';
  const dasar = document.createElementNS(NS, 'path');
  dasar.setAttribute('d', d);
  svg.appendChild(dasar);

  const isi = document.createElementNS(NS, 'path');
  isi.setAttribute('d', d);
  isi.classList.add('hiw-jalur-isi');
  svg.appendChild(isi);

  // ── PANJANG KUMULATIF DI SETIAP JANGKAR KARTU ──────────────────────────────
  //
  // ── KENAPA PER JANGKAR, BUKAN SATU PANJANG TOTAL ───────────────────────────
  // Versi sebelumnya memetakan kemajuan jalur ke POSISI SCROLL. Dua masalah
  // nyata dari situ:
  //
  //   1. Saat halaman dibuka, panggung sudah sebagian terlihat — jadi jalurnya
  //      sudah 24% tergambar sebelum pengguna menyentuh apa pun.
  //   2. Jalur berhenti di 68%: panggung selesai lewat layar sebelum nilainya
  //      mencapai 1, jadi garisnya tidak pernah tersambung penuh.
  //
  // Sekarang jalur diikat ke HAL YANG SAMA dengan kartunya: jumlah kartu yang
  // sudah muncul. Segmen ke kartu N tergambar saat kartu N muncul — jadi garis
  // dan kartu selalu sinkron, dan jalurnya pasti selesai saat kartu terakhir
  // muncul (berapa pun tinggi panggung atau ukuran layarnya).
  const NS2 = 'http://www.w3.org/2000/svg';
  const panjangTotal = isi.getTotalLength();

  // Panjang kumulatif sampai titik tengah tiap segmen. Dipakai untuk tahu
  // seberapa jauh garis harus tergambar setelah kartu ke-N muncul.
  const jangkar = [0];
  for (let i = 0; i < titik.length - 1; i += 1) {
    const a = titik[i];
    const b = titik[i + 1];
    const tengahY = (a.bawah + b.y) / 2;
    const contoh = document.createElementNS(NS2, 'path');
    contoh.setAttribute('d', `M ${a.x} ${a.bawah} C ${a.x} ${tengahY}, ${b.x} ${tengahY}, ${b.x} ${b.y}`);
    // Panjang kumulatif: panjang semua segmen sebelumnya + segmen ini.
    const sebelumnya = jangkar[jangkar.length - 1];
    jangkar.push(sebelumnya + contoh.getTotalLength());
  }

  isi.style.strokeDasharray = String(panjangTotal);
  // Mulai dari kosong — tersambung penuh setelah kartu terakhir muncul.
  isi.style.strokeDashoffset = String(panjangTotal);

  return { isi, jangkar, panjangTotal };
}

/**
 * Gambar jalur sejauh kartu ke-`jumlah` (indeks 1 = baru kartu pertama).
 *
 * Transisi `stroke-dashoffset` di CSS membuat perpindahannya mengalir, bukan
 * melompat — jadi satu segmen tergambar mulus tiap kartu muncul.
 */
function gambarSejauh(dataJalur, jumlah) {
  if (!dataJalur) return;
  const { isi, jangkar, panjangTotal } = dataJalur;

  // Kartu pertama tidak punya segmen sebelum dirinya — jalur baru mulai
  // tergambar saat kartu KEDUA muncul.
  const indeksSegmen = Math.max(0, Math.min(jangkar.length - 1, jumlah - 1));
  const tergambar = jangkar[indeksSegmen] ?? 0;

  isi.style.strokeDashoffset = String(Math.max(0, panjangTotal - tergambar));
}

/**
 * Inisialisasi.
 *
 * Aman dipanggil berkali-kali dan aman kalau elemennya tidak ada — halaman
 * lain yang memuat berkas ini tidak akan error.
 */
export function initHowItWorks(akar = document) {
  const panggung = akar.querySelector('[data-hiw]');
  if (!panggung) return;

  const daftar = panggung.querySelector('.hiw-daftar');
  const item = Array.from(panggung.querySelectorAll('.hiw-item'));
  const svg = panggung.querySelector('.hiw-jalur');
  if (!daftar || !item.length) return;

  // ── Penanda "JS hidup" ────────────────────────────────────────────────────
  // Tanpa ini, kartu tetap `opacity: 0` selamanya kalau skrip gagal dimuat.
  // Pola yang sama dengan `.js-ready` di main.css.
  document.documentElement.classList.add('js-ready');

  // Data jalur: { isi, jangkar, panjangTotal } — atau null kalau jalur tidak
  // digambar (layar sempit / kurang dari 2 kartu).
  let dataJalur = null;

  // Berapa kartu yang sudah muncul — sumber tunggal untuk jalur. Dipakai juga
  // saat ukuran layar berubah, supaya jalur yang dihitung ulang langsung
  // berada di panjang yang benar (bukan mulai dari nol lagi).
  let sudahMuncul = 0;

  /**
   * Hitung ulang tata letak: posisi kartu, tinggi panggung, dan jalur.
   *
   * ── KENAPA KARTU DIBACA ULANG DARI DOM ─────────────────────────────────────
   * Daftar `item` dikumpulkan sekali saat init. Kalau jumlah kartunya berubah
   * setelah itu, daftar lama menyebut kartu yang sudah tidak ada — posisi dan
   * jalur dihitung dari jumlah yang salah, dan hasilnya ruang kosong besar
   * atau garis yang menunjuk ke tempat kosong.
   *
   * Membaca ulang di setiap perhitungan membuat fungsi ini selalu benar,
   * berapa pun jumlah kartunya saat itu.
   */
  const tata = () => {
    const kartuKini = Array.from(panggung.querySelectorAll('.hiw-item'));
    const tinggi = susunKartu(daftar, kartuKini);
    dataJalur = gambarJalur(svg, kartuKini);
    gambarSejauh(dataJalur, sudahMuncul);
    return tinggi;
  };

  tata();

  // ── Reveal satu per satu ──────────────────────────────────────────────────
  //
  // Reduced motion: semua langsung muncul. Tidak ada yang disembunyikan dan
  // tidak ada yang dianimasikan — pengguna meminta gerak diminimalkan.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    const kartuKini = Array.from(panggung.querySelectorAll('.hiw-item'));
    for (const li of kartuKini) li.classList.add('is-muncul');
    sudahMuncul = kartuKini.length;
    gambarSejauh(dataJalur, sudahMuncul);
    return;
  }

  const pengamat = new IntersectionObserver((entri) => {
    // Daftar kartu dibaca ulang: jumlahnya bisa berubah setelah init, dan
    // `item` yang lama akan menyebut elemen yang sudah tidak ada.
    const kartuKini = Array.from(panggung.querySelectorAll('.hiw-item'));

    // Urutkan berdasarkan indeks DOM, bukan urutan kedatangan: browser bisa
    // melaporkan beberapa entri sekaligus saat pengguna menggulir cepat, dan
    // urutan laporan tidak dijamin sama dengan urutan di halaman.
    const masuk = entri
      .filter((e) => e.isIntersecting)
      .sort((a, b) => kartuKini.indexOf(a.target) - kartuKini.indexOf(b.target));

    masuk.forEach((e, i) => {
      // Jeda bertingkat: kartu yang masuk bersamaan tetap muncul berurutan,
      // 90ms satu sama lain. Kartu yang masuk sendiriian (scroll lambat)
      // tidak menunggu — `i` = 0 saat hanya satu yang masuk.
      e.target.style.setProperty('--hiw-tunda', `${i * 90}ms`);
      e.target.classList.add('is-muncul');
      pengamat.unobserve(e.target);
    });

    // ── JALUR MENGIKUTI KARTU ─────────────────────────────────────────────────
    // Satu angka: berapa kartu yang sudah muncul. Jalur menggambar segmennya
    // satu per satu dengan angka yang sama — jadi garis dan kartu tidak pernah
    // bisa berbeda posisi, dan jalur pasti tersambung penuh saat kartu terakhir
    // muncul.
    const total = kartuKini.filter((li) => li.classList.contains('is-muncul')).length;
    if (total !== sudahMuncul) {
      sudahMuncul = total;
      gambarSejauh(dataJalur, sudahMuncul);
    }
  }, {
    // ── KENAPA rootMargin NEGATIF, BUKAN POSITIF ───────────────────────────────
    //
    // Versi pertama memakai `0px 0px 10% 0px` (memperluas area pemicu ke bawah)
    // supaya kartu tinggi di ponsel tetap terpicu. Efek sampingnya: kartu yang
    // masih 10% DI BAWAH layar sudah dianggap masuk — jadi beberapa kartu
    // terpicu sekaligus dan geraknya kehilangan urutan.
    //
    // Sekarang kebalikannya: `-18%` di bawah MEMPERSEMPIT area pemicu, sehingga
    // kartu harus benar-benar masuk ~18% ke dalam layar sebelum muncul. Dengan
    // jarak 300px, hanya satu (kadang dua) kartu yang berada di zona itu pada
    // satu waktu — dan itulah yang membuat urutannya terbaca.
    //
    // Batas atas tetap 0 supaya kartu yang sudah lewat tidak pernah "belum
    // muncul" — kartu pertama harus terlihat tanpa menunggu scroll.
    rootMargin: '0px 0px -18% 0px',
    threshold: 0.01,
  });

  for (const li of item) pengamat.observe(li);

  // ── Jaring pengaman ───────────────────────────────────────────────────────
  //
  // Kalau observer tidak pernah menembak (bug browser, halaman dibuka dengan
  // scroll sudah di tengah, atau elemen dirender ulang), kartu tetap
  // transparan SELAMANYA. Sekali diperiksa di 2,5 detik — bukan loop — dan
  // hanya untuk kartu yang sudah terlihat.
  setTimeout(() => {
    const kartuKini = Array.from(panggung.querySelectorAll('.hiw-item'));
    const batas = window.innerHeight;
    let adaBaru = false;
    for (const li of kartuKini) {
      if (li.classList.contains('is-muncul')) continue;
      if (li.getBoundingClientRect().top < batas) {
        li.classList.add('is-muncul');
        adaBaru = true;
      }
    }
    if (adaBaru) {
      sudahMuncul = kartuKini.filter((li) => li.classList.contains('is-muncul')).length;
      gambarSejauh(dataJalur, sudahMuncul);
    }
  }, 2500);

  // ── Ukuran berubah ────────────────────────────────────────────────────────
  // Posisi kartu dan jalur dihitung dari ukuran nyata. Saat lebar berubah
  // (memutar ponsel, mengubah ukuran jendela), keduanya harus dihitung ulang —
  // kalau tidak, jalurnya menempel di tempat yang salah.
  //
  // Ditunda 150ms: `resize` menyala terus saat pengguna menyeret tepi jendela,
  // dan menghitung jalur pada setiap frame membuang kerja yang langsung basi.
  let timerUbah = null;
  window.addEventListener('resize', () => {
    clearTimeout(timerUbah);
    timerUbah = setTimeout(tata, 150);
  });

  // Font web bisa tiba setelah init dan mengubah tinggi kartu. Satu
  // perhitungan ulang setelah font siap menutup selisih itu.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => tata()).catch(() => {});
  }
}

export default initHowItWorks;
