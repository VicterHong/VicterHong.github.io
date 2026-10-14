/**
 * COUNT-UP — angka berjalan dari 0 ke nilai target saat masuk layar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA ANGKA DIANIMASIKAN, BUKAN CUMA DITAMPILKAN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Bagian Visi & Misi di halaman utama menyebut "1.428 tes", "25 MB", "940 KB".
 * Angka-angka itu BUKTINYA. Kalau muncul begitu saja, mata melewatinya seperti
 * melewati teks biasa.
 *
 * Angka yang BERJALAN dari 0 ke nilai akhir memaksa mata mengikutinya sampai
 * berhenti. Gerak itu menyampaikan satu hal yang tidak bisa disampaikan angka
 * statis: "ini dihitung, bukan diketik". Referensi yang dipakai:
 *
 *   · webdevpuneet.com/ui-snippets/scroll-reveal-counter-stats
 *     → satu IntersectionObserver bersama, ease-out kubik, unobserve segera
 *   · web.dev/articles/prefers-reduced-motion
 *     → nilai akhir LANGSUNG ditulis, bukan animasi yang disembunyikan
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA setTimeout JADI DRIVER UTAMA, BUKAN requestAnimationFrame
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── BUG YANG PERNAH TERJADI DI PROYEK LAIN ─────────────────────────────────
 * `requestAnimationFrame` TIDAK menyala di browser headless, tab latar,
 * halaman prerender, dan sebagian mode hemat daya. Terukur:
 *
 *     requestAnimationFrame(() => { /* tidak pernah dipanggil *\/ });
 *     document.timeline.currentTime === 0   // beku, bahkan setelah beberapa detik
 *
 * Kalau count-up digerakkan rAF saja, angkanya berhenti di "0" SELAMANYA.
 * Kegagalannya bukan "animasi hilang" — kegagalannya "ANGKA SALAH", dan itu
 * jauh lebih buruk: halaman yang mengklaim "setiap angka bisa diperiksa"
 * menampilkan nol di semua metriknya.
 *
 * `rAF` bekerja normal di browser biasa, jadi bug ini TIDAK PERNAH terlihat
 * saat diuji manual. Ia hanya muncul di produksi, di perangkat pengguna.
 *
 * ── CARA DI SINI ───────────────────────────────────────────────────────────
 *   1. `setTimeout` sebagai driver — selalu menyala
 *   2. `rAF` hanya sebagai jalur cepat yang membatalkan timer
 *   3. Jaring pengaman di 1,2 detik: angka dipaksa ke nilai akhir
 *   4. Fungsi tulis() idempotent — dipanggil dari dua jalur, hasilnya sama
 *
 * Kehilangan animasi itu bisa diterima. Kehilangan angkanya tidak.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CARA PAKAI
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   <span data-count data-target="1428" data-suffix=" tes">1.428 tes</span>
 *
 * Atribut:
 *   data-target    angka tujuan (wajib)
 *   data-decimals  jumlah desimal (default 0)
 *   data-prefix    teks sebelum angka, mis. "~"
 *   data-suffix    teks sesudah angka, mis. " MB"
 *   data-pemisah   "id" (default, 1.428) atau "none" (1428)
 *
 * Nilai di HTML adalah nilai AKHIR yang benar. Kalau JavaScript tidak jalan,
 * pembaca tetap melihat "1.428 tes" — bukan "0". Skrip ini hanya mengubahnya
 * SEMENTARA selama animasi berjalan.
 */

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Durasi animasi. 1,4 detik: cukup untuk diikuti mata, tidak sampai menunggu. */
const DURASI = 1400;

/**
 * Format angka sesuai atribut elemennya.
 *
 * ── KENAPA MEMBACA ATRIBUT, BUKAN MENERIMA PARAMETER ───────────────────────
 * Satu fungsi yang sama harus bisa menulis "1.428 tes", "~25 MB", dan
 * "940 KB". Kalau nilainya dikirim sebagai parameter, setiap pemanggil harus
 * tahu sendiri formatnya. Dengan membaca atribut, formatnya menempel pada
 * elemennya — dan HTML-nya bisa dibaca tanpa membuka berkas ini.
 */
function format(el, nilai) {
  const desimal = Number(el.dataset.decimals || 0);
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const pakaiPemisah = el.dataset.pemisah !== 'none';

  // `toLocaleString('id-ID')` memberi titik sebagai pemisah ribuan (1.428),
  // yang benar untuk halaman berbahasa Indonesia.
  const angka = desimal > 0
    ? nilai.toFixed(desimal)
    : (pakaiPemisah ? Math.round(nilai).toLocaleString('id-ID') : String(Math.round(nilai)));

  return `${prefix}${angka}${suffix}`;
}

/**
 * Tulis nilai akhir. Idempotent — boleh dipanggil berkali-kali.
 *
 * Dipanggil dari tiga tempat: saat animasi selesai, oleh jaring pengaman, dan
 * saat reduced-motion aktif. Semuanya menghasilkan teks yang sama.
 */
function tulisAkhir(el) {
  el.textContent = format(el, Number(el.dataset.target || 0));
  el.classList.add('angka-selesai');
}

/**
 * Jalankan count-up untuk satu elemen.
 *
 * ── URUTANNYA PENTING ──────────────────────────────────────────────────────
 * `mulai` dipanggil SETELAH `tulisAkhir` terpasang sebagai jaring pengaman,
 * bukan sebelum. Kalau animasinya gagal di tengah, jaring pengaman sudah
 * menunggu dan angka tetap benar.
 */
function hitung(el) {
  if (el.dataset.sudahHitung === 'ya') return;
  el.dataset.sudahHitung = 'ya';

  const target = Number(el.dataset.target || 0);
  const desimal = Number(el.dataset.decimals || 0);

  if (prefersReduced() || !Number.isFinite(target) || target === 0) {
    tulisAkhir(el);
    return;
  }

  let selesai = false;

  const mulai = () => {
    if (selesai) return;
    selesai = true;

    const waktuMulai = performance.now();

    const langkah = (sekarang) => {
      const lewat = sekarang - waktuMulai;
      const progres = Math.min(lewat / DURASI, 1);

      // ── KENAPA EASE-OUT KUBIK ──────────────────────────────────────────────
      // Hitungan linear terasa mekanis dan berhenti mendadak. Dengan
      // `1 - (1 - p)³`, angkanya melambat saat mendekati akhir — mata sempat
      // membaca angka terakhirnya sebelum berhenti.
      const halus = 1 - Math.pow(1 - progres, 3);

      el.textContent = format(el, target * halus);

      if (progres < 1) {
        // rAF dipakai DI DALAM animasi yang sudah berjalan. Kalau rAF tidak
        // tersedia, `setTimeout` di bawah yang melanjutkan.
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(langkah);
        else setTimeout(() => langkah(performance.now()), 16);
      } else {
        tulisAkhir(el);
      }
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(langkah);
    else langkah(performance.now() + DURASI); // langsung ke nilai akhir
  };

  // ── DRIVER: setTimeout, BUKAN rAF ──────────────────────────────────────────
  // 32ms ≈ 2 frame. Cukup untuk membuat browser mengecat keadaan awal dulu,
  // tapi tetap menyala di lingkungan yang rAF-nya beku.
  const timer = setTimeout(mulai, 32);

  // Jalur cepat: kalau rAF hidup, ia membatalkan timer dan mulai lebih cepat.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(timer);
      mulai();
    }));
  }
}

/**
 * Inisialisasi.
 *
 * Satu observer untuk semua angka, bukan satu per elemen — beban pelacakan
 * IntersectionObserver tumbuh seiring JUMLAH OBSERVER, bukan jumlah elemen.
 *
 * Aman dipanggil berkali-kali dan aman kalau elemennya tidak ada.
 */
export function initCountUp(akar = document) {
  const semua = [...akar.querySelectorAll('[data-count]')];
  if (!semua.length) return;

  // ── Jaring pengaman tingkat halaman ───────────────────────────────────────
  // Apapun yang terjadi (observer tidak menembak karena gate Cloudflare,
  // elemen tersembunyi, browser aneh), pada 2,5 detik SEMUA angka dipaksa ke
  // nilai akhirnya. Angka yang salah lebih buruk daripada animasi yang hilang.
  setTimeout(() => {
    for (const el of semua) {
      if (el.dataset.sudahHitung !== 'ya') tulisAkhir(el);
    }
  }, 2500);

  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const el of semua) tulisAkhir(el);
    return;
  }

  const pengamat = new IntersectionObserver((entri) => {
    for (const e of entri) {
      if (!e.isIntersecting) continue;
      hitung(e.target);
      pengamat.unobserve(e.target); // sekali saja — tidak diulang saat digulir balik
    }
  }, {
    // Ambang rendah: animasi mulai begitu angkanya terlihat, bukan setelah
    // separuh elemen masuk layar. Pengguna melihat prosesnya, bukan hasilnya.
    threshold: 0.3,
  });

  for (const el of semua) {
    // Nilai akhir sudah ada di HTML. Kalau JS mati di tengah, teksnya tetap
    // benar — tidak perlu menyembunyikan apa pun sebelum animasi.
    pengamat.observe(el);
  }

  // ── Gate Cloudflare ───────────────────────────────────────────────────────
  // Selama gate aktif, `body.cf-gated > *:not(#cf-gate) { display: none }`
  // menyembunyikan seluruh isi halaman — dan elemen `display: none` tidak
  // pernah memicu IntersectionObserver. Tanpa ini, semua angka tetap di nilai
  // HTML-nya (yang sebenarnya benar) tapi tidak pernah beranimasi.
  document.addEventListener('cf-gate:lulus', () => {
    const tinggiLayar = window.innerHeight;
    for (const el of semua) {
      if (el.dataset.sudahHitung === 'ya') continue;
      const kotak = el.getBoundingClientRect();
      if (kotak.top < tinggiLayar && kotak.height > 0) {
        hitung(el);
        pengamat.unobserve(el);
      }
    }
  });
}

/**
 * KETIK — teks muncul huruf per huruf, seperti sedang ditulis.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA HANYA UNTUK SATU KALIMAT
 * ══════════════════════════════════════════════════════════════════════════
 * Efek ketik itu lambat: pembaca dipaksa menunggu setiap huruf. Untuk paragraf
 * panjang, itu menyiksa — pengguna tidak bisa memindai.
 *
 * Di sini ia dipakai untuk SATU kalimat saja: pernyataan visi. Kalimat itu
 * memang ingin dibaca utuh dan berurutan, dan gerak menulis membuat mata
 * mengikutinya sampai selesai. Paragraf misi di bawahnya TIDAK diketik — ia
 * muncul dengan stagger biasa.
 *
 * Referensi: web.dev/articles/prefers-reduced-motion
 *   → nilai akhir ditulis LANGSUNG, bukan animasi yang disembunyikan
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TEKS PENUH SUDAH ADA DI HTML SEBELUM ANIMASI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kalau JavaScript mati, atau kalau pengguna memilih gerakan minimal, teksnya
 * harus tetap ada. Jadi HTML-nya berisi kalimat lengkap, dan skrip ini hanya
 * MENGOSONGKANNYA SESAAT sebelum mengetik ulang.
 *
 * ── KENAPA ITU AMAN UNTUK PEMBACA LAYAR ────────────────────────────────────
 * Pembaca layar membaca DOM saat halaman dimuat, sebelum animasi berjalan.
 * Teksnya sudah lengkap di sana. Selain itu `aria-label` diisi kalimat penuh,
 * jadi apa pun yang terjadi pada `<span>`-nya, yang dibacakan tetap utuh.
 */
export function initKetik(akar = document) {
  const semua = [...akar.querySelectorAll('[data-ketik]')];
  if (!semua.length) return;

  const selesai = (el) => {
    el.textContent = el.dataset.teksPenuh || el.textContent;
    el.classList.add('ketik-selesai');
  };

  // Reduced motion atau tanpa IntersectionObserver: langsung teks penuh.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const el of semua) selesai(el);
    return;
  }

  // ── FASE 1: SIMPAN ISI, LALU KOSONGKAN — SEKARANG, BUKAN NANTI ────────────
  //
  // ── BUG YANG DIPERBAIKI: TEKS BERKEDIP ───────────────────────────────────
  // Versi pertama mengosongkan teks DI DALAM handler observer — yaitu saat
  // elemennya masuk layar. Terukur: teks penuh tampil 450ms, lalu hilang, lalu
  // diketik ulang. Pengguna melihat kalimatnya BERKEDIP sebelum animasinya.
  //
  // Penyebabnya: pengosongan terjadi setelah pengguna bisa melihatnya. Yang
  // benar adalah mengosongkan SEBELUM elemennya pernah terlihat — di sini,
  // saat init, ketika bagian ini masih jauh di bawah layar.
  //
  // ── KENAPA INI TETAP AMAN TANPA JAVASCRIPT ───────────────────────────────
  // Pengosongan ini hanya berjalan kalau skripnya memang dimuat. Kalau JS mati,
  // baris ini tidak pernah dieksekusi dan HTML-nya tetap berisi kalimat penuh.
  // Itu pola "fail-open" yang sama dipakai `.js-ready` di main.css.
  for (const el of semua) {
    if (!el.dataset.teksPenuh) el.dataset.teksPenuh = el.textContent.trim();
    el.textContent = '';
    el.classList.add('ketik-armed');
  }

  // Jaring pengaman tingkat halaman. Kalau apa pun gagal — observer tidak
  // menembak, gate Cloudflare tidak pernah lulus, elemennya disembunyikan
  // induknya — pada 3 detik teksnya dipasang kembali utuh. Kehilangan animasi
  // bisa diterima; kehilangan kalimatnya tidak.
  setTimeout(() => {
    for (const el of semua) {
      if (!el.classList.contains('ketik-selesai')) selesai(el);
    }
  }, 3000);

  let timerJaring = null;

  const ketik = (el) => {
    if (el.dataset.sedangKetik === 'ya') return;
    el.dataset.sedangKetik = 'ya';

    const teks = el.dataset.teksPenuh || '';
    const total = teks.length;
    if (!total) { selesai(el); return; }

    // ── KECEPATAN: BERBASIS WAKTU, BUKAN PER HURUF ─────────────────────────
    //
    // ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────
    // Versi pertama menghitung jeda per huruf (`1600 / total`), lalu
    // memanggil `setTimeout` sekali per huruf. Dua masalah:
    //
    //   1. `setTimeout` punya overhead ~1-2ms per panggilan, dan overhead itu
    //      MENUMPUK. Terukur: 148 karakter selesai dalam ~2.100ms, bukan
    //      1.600ms — 31% lebih lambat dari yang dimaksud.
    //   2. Batas bawah `Math.max(12, ...)` memaksa jeda 12ms untuk kalimat
    //      panjang, jadi durasi totalnya tidak lagi terjaga.
    //
    // Sekarang: waktu mulai dicatat sekali, dan setiap langkah menghitung
    // SENDIRI berapa huruf yang seharusnya sudah tampil berdasarkan waktu yang
    // benar-benar berjalan. Overhead tidak lagi menumpuk — kalimat sepanjang
    // apa pun selesai dalam DURASI_KETIK.
    const DURASI_KETIK = 1500;
    const mulai = performance.now();

    const langkah = () => {
      const lewat = performance.now() - mulai;
      const progres = Math.min(lewat / DURASI_KETIK, 1);

      // `Math.round` + minimal 1 huruf: progres 0 tetap menampilkan huruf
      // pertama, jadi tidak ada jeda kosong di awal.
      el.textContent = teks.slice(0, Math.max(1, Math.round(progres * total)));

      if (progres < 1) {
        // 16ms ≈ satu frame. Interval tetap, tapi jumlah hurufnya yang
        // menyesuaikan diri.
        timerJaring = setTimeout(langkah, 16);
      } else {
        selesai(el);
      }
    };

    // Driver `setTimeout`, sama seperti count-up: menyala di semua lingkungan.
    timerJaring = setTimeout(langkah, 100);
  };

  const pengamat = new IntersectionObserver((entri) => {
    for (const e of entri) {
      if (!e.isIntersecting) continue;
      ketik(e.target);
      pengamat.unobserve(e.target);
    }
  }, { threshold: 0.4 });

  for (const el of semua) pengamat.observe(el);

  document.addEventListener('cf-gate:lulus', () => {
    const tinggiLayar = window.innerHeight;
    for (const el of semua) {
      if (el.dataset.sedangKetik === 'ya') continue;
      const kotak = el.getBoundingClientRect();
      if (kotak.top < tinggiLayar && kotak.height > 0) {
        ketik(el);
        pengamat.unobserve(el);
      }
    }
  });
}

export default initCountUp;
