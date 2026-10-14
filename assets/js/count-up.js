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
 * FADE — kalimat visi muncul dengan fade ala korporasi.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA FADE, BUKAN KETIKAN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Versi sebelumnya mengetik kalimat visi huruf per huruf. Itu memaksa pembaca
 * MENUNGGU ~1,5 detik sebelum kalimatnya bisa dibaca utuh — dan pembaca yang
 * sudah paham tidak bisa mempercepatnya. Di situs korporat efek itu terasa
 * seperti halaman yang lambat memuat, bukan seperti animasi.
 *
 * Fade menyampaikan hal yang sama tanpa menahan pembaca: teksnya langsung
 * lengkap di DOM, yang bergerak hanya kejelasannya.
 *
 * ── KENAPA TIDAK MEMAKAI ULANG [data-reveal] ───────────────────────────────
 * Sistem reveal situs ini (`observeReveals()` di app.js) mencari `[data-reveal]`
 * di dalam `main`. Elemen visi berada di dalam kartu yang JUGA muncul dengan
 * reveal — dua reveal bersarang pada elemen yang sama membuat teksnya muncul
 * dua kali (sekali dari kartunya, sekali dari dirinya).
 *
 * Yang dipakai di sini: kelas `.is-terlihat` yang dipasang saat kartunya sudah
 * selesai muncul. Satu gerakan, bukan dua.
 *
 * ── DURASI DAN EASING ──────────────────────────────────────────────────────
 * Keduanya memakai token yang sudah dipakai seluruh situs (`--dur-reveal`
 * 720ms, `--ease-out-quart`) — lihat catatan di visi-misi.css. Fade dengan
 * durasi berbeda dari blok lain akan terasa sebagai ketidakkonsistenan yang
 * sulit disebutkan tapi terasa.
 */
export function pasangFadeVisi(akar = document) {
  const semua = [...akar.querySelectorAll('.vm-kartu--visi .vm-teks')];
  if (!semua.length) return;

  const tampilkan = (el) => el.classList.add('is-terlihat');

  // Reduced motion atau tanpa IntersectionObserver: langsung terlihat.
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    for (const el of semua) tampilkan(el);
    return;
  }

  // ── KENAPA MENUNGGU KARTUNYA, BUKAN MENGAMATI TEKSNYA ────────────────────
  // Teksnya ada DI DALAM kartu yang naik 28px saat muncul. Kalau teksnya
  // beranimasi sendiri sambil kartunya bergerak, dua gerakan itu bertumpuk —
  // dan hasilnya terbaca sebagai kartu yang bergetar, bukan sebagai dua
  // elemen yang muncul berurutan.
  //
  // Jadi: tunggu kartunya SELESAI bergerak (`transitionend`), baru teksnya
  // menyusul. Itu urutan yang sama dipakai seksi lain di halaman ini.
  const pemicu = akar.querySelectorAll('.vm-langkah');
  if (!pemicu.length) {
    for (const el of semua) tampilkan(el);
    return;
  }

  const pengamat = new IntersectionObserver((entri) => {
    for (const e of entri) {
      if (!e.isIntersecting) continue;
      pengamat.unobserve(e.target);

      const item = e.target.querySelector('.vm-item');
      const teks = e.target.querySelector('.vm-kartu--visi .vm-teks');
      if (!teks) continue;

      if (!item) { tampilkan(teks); continue; }

      // Kalau kartunya sudah muncul sebelum ini (mis. pengguna menggulir balik),
      // tidak ada transisi yang akan menyala — langsung tampilkan.
      if (item.classList.contains('is-muncul')) {
        setTimeout(() => tampilkan(teks), 120);
        continue;
      }

      const sekali = (ev) => {
        if (ev.propertyName !== 'transform') return;
        item.removeEventListener('transitionend', sekali);
        tampilkan(teks);
      };
      item.addEventListener('transitionend', sekali);

      // Jaring pengaman: kalau `transitionend` tidak menyala (transisi
      // dibatalkan, elemen disembunyikan), tetap tampilkan setelah 1,5 detik.
      setTimeout(() => tampilkan(teks), 1500);
    }
  }, { threshold: 0.3 });

  for (const li of pemicu) pengamat.observe(li);

  // Gate Cloudflare: selama gate aktif isi halaman `display: none`, dan elemen
  // tersembunyi tidak pernah memicu IntersectionObserver.
  document.addEventListener('cf-gate:lulus', () => {
    for (const el of semua) {
      const kotak = el.getBoundingClientRect();
      if (kotak.top < window.innerHeight && kotak.height > 0) tampilkan(el);
    }
  });
}

export default initCountUp;
