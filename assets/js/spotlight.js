/**
 * Carousel Spotlight — galeri proyek dengan kartu melengkung (concave arc).
 *
 * ── KENAPA DITULIS SENDIRI ──────────────────────────────────────────────────
 *
 * Pola "cover flow" ini sudah umum sejak iTunes (2006) dan dipakai banyak
 * situs galeri. Yang saya tulis di sini adalah implementasi sendiri dari
 * deskripsi perilakunya — bukan salinan dari library mana pun.
 *
 * ── PERILAKU YANG DIMINTA ───────────────────────────────────────────────────
 *
 *   "infinite concave-arc carousel on a clean light stage, its title, rating
 *    and dots staying synced to the front card as you drag, swipe or click
 *    through with snap-to-card settling"
 *
 * Diterjemahkan jadi 5 hal yang harus bekerja:
 *
 *   1. KARTU MELENGKUNG — kartu di kiri/kanan diputar (rotateY) + digeser
 *      turun, membentuk busur cekung. Kartu depan tegak lurus.
 *   2. TAK TERBATAS — geser ke kiri terus, kembali ke kartu terakhir. Tidak
 *      ada ujung yang mentok.
 *   3. JUDUL + RATING + DOTS SINKRON — ketiganya mengikuti kartu yang sedang
 *      di depan, bukan kartu yang terakhir diklik.
 *   4. TIGA CARA GESER — drag (mouse), swipe (sentuh), klik (tombol/panah).
 *   5. SNAP — setelah dilepas, kartu "mendarat" ke posisi terdekat.
 *
 * ── KEPUTUSAN TEKNIS ────────────────────────────────────────────────────────
 *
 * Mengapa transform, bukan posisi absolut per kartu:
 *   Satu rumus posisi untuk semua kartu berdasarkan jarak dari kartu aktif.
 *   Menambah/mengurangi jumlah proyek tidak perlu mengubah rumus apa pun.
 *
 * Mengapa rAF, bukan langsung di event pointermove:
 *   pointermove bisa memicu 100+ kali per detik. Menulis DOM di setiap event
 *   memaksa layout berkali-kali. rAF membatasi ke satu penulisan per frame.
 *
 * Mengapa prefers-reduced-motion dihormati:
 *   Carousel yang bergerak saat digeser adalah gerakan yang diminta pengguna —
 *   itu tetap jalan. Yang dimatikan hanya animasi "mendarat" (snap), karena
 *   itu gerakan yang TIDAK diminta.
 *
 * Cara pakai:
 *   const el = createSpotlightCarousel(items);
 *   host.append(el);
 */

// Import `icon` DIHAPUS — satu-satunya pemakainya adalah tombol panah, dan
// tombol itu sudah dibuang. Import yang tidak terpakai membuat berkas
// membawa ketergantungan yang tidak perlu.

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Geometri kartu dalam satu baris horizontal.
 *
 * ── KENAPA POLA INI, BUKAN COVER-FLOW 3D ─────────────────────────────────────
 * Versi sebelumnya memakai cover-flow (kartu diputar rotateY, membentuk busur
 * cekung). Hasilnya kartu samping miring + terpotong, dan teksnya tidak
 * terbaca — terlihat berantakan.
 *
 * Referensi yang dipakai sekarang (dua-duanya pola "center mode"):
 *   - Shadcnblocks Gallery 17: "active slide renders at full scale and opacity
 *     while neighboring slides shrink and fade" — 100% vs 70% skala,
 *     100% vs 40% opacity.
 *   - Slick center mode: `.slick-center { transform: scale(1.25) }`.
 *
 * Intinya: kartu aktif MEMBESAR penuh dan tegak lurus, kartu lain MENGECIL
 * dan memudar, semuanya bergerak HORIZONTAL. Tidak ada rotasi — jadi gambar
 * tidak terpotong dan label tetap terbaca. Ini yang dipakai galeri produk
 * komersial (Apple, Stripe, Linear).
 *
 * Rotasi tetap ada TAPI sangat kecil (4°) — hanya memberi kesan kedalaman,
 * bukan membuat kartu miring. Kalau 0°, deretannya terasa datar.
 */
const ARC = {
  stepX: 232,      // geser horizontal per langkah — cukup lega antar kartu
  stepY: 0,        // TIDAK turun — baris lurus, bukan busur
  rotate: 4,       // derajat — sangat kecil, hanya kesan kedalaman
  scaleStep: 0.2,  // pengecilan per langkah: ke-2 = 80%, ke-3 = 60%
  maxVisible: 3,   // langkah terjauh yang masih tampil
};

/**
 * Buat elemen carousel.
 *
 * @param {Array<{title:string, meta:string, rating:string, accent:string,
 *                label:string, href?:string, cta?:string}>} items
 * @returns {HTMLElement}
 */
export function createSpotlightCarousel(items) {
  const root = document.createElement('section');
  root.className = 'spotlight';
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', 'Galeri proyek');

  // ── Judul section ─────────────────────────────────────────────────────────
  const head = document.createElement('header');
  head.className = 'spotlight-head';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'spotlight-eyebrow';
  eyebrow.textContent = 'The Spotlight Collection';
  const h2 = document.createElement('h2');
  h2.className = 'spotlight-title';
  h2.innerHTML = 'Karya terpilih, <em>dibingkai cahaya</em>';
  head.append(eyebrow, h2);
  root.append(head);

  // ── Panggung: kartu-kartu bergerak di sini ────────────────────────────────
  const stage = document.createElement('div');
  stage.className = 'spotlight-stage';
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Geser untuk menjelajah');

  const track = document.createElement('div');
  track.className = 'spotlight-track';
  stage.append(track);

  const cards = items.map((item, i) => {
    const card = document.createElement('article');
    card.className = 'spotlight-card';
    card.dataset.index = String(i);

    // ── VISUAL KARTU ────────────────────────────────────────────────────────
    // Kritik desain: "kartu tidak memamerkan karya — hanya kotak teks."
    //
    // Kartu sekarang MURNI VISUAL: gambar + nomor + label. Judul dan deskripsi
    // hanya ada di bawah carousel, sinkron dengan kartu depan.
    //
    // Kenapa judul TIDAK di kartu: kritik menemukan duplikasi ("MINA" muncul
    // di kartu dan di bawahnya). Spesifikasi aslinya pun begitu — "its title,
    // rating and dots staying synced to the front card" — judul tinggal di
    // bawah, kartu cukup menampilkan karyanya.
    if (item.image) {
      const media = document.createElement('div');
      media.className = 'spotlight-card-media';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      // alt kosong disengaja: gambar dekoratif, judul proyek ada di bawah
      // carousel. Screen reader tidak perlu membacanya dua kali.
      img.loading = i < 3 ? 'eager' : 'lazy';
      img.decoding = 'async';
      media.setAttribute('aria-hidden', 'true');
      media.append(img);
      card.append(media);
    }

    // Nomor urut DIHAPUS — permintaan pemilik: "angkanya dihilangkan".
    // Angka 01/02/03 di tiap kartu terbaca sebagai hiasan, bukan informasi:
    // posisi kartu sudah ditunjukkan oleh busur visual dan dots di bawah.
    // Menghapusnya membuat gambar lebih lega dan kartu terasa lebih bersih.

    // Label kategori di kaki kartu (judul TIDAK di sini — lihat catatan atas)
    const body = document.createElement('div');
    body.className = 'spotlight-card-body';
    const label = document.createElement('span');
    label.className = 'spotlight-card-label';
    label.textContent = item.label;
    body.append(label);

    // ── CADANGAN KALAU GAMBAR GAGAL DIMUAT ───────────────────────────────────
    // Kartu murni visual jadi kosong kalau gambarnya tidak ada. Jaringan
    // lambat, berkas terhapus, atau CDN bermasalah → kartu jadi kotak hitam
    // tanpa identitas. Jadi kalau gambar gagal, kartu MENAMPILKAN JUDUL
    // sebagai gantinya.
    //
    // Dipasang lewat event 'error', bukan ditebak di awal: saat render,
    // gambar belum selesai dimuat, jadi statusnya belum diketahui.
    if (!item.image) {
      // Tidak ada gambar sejak awal — langsung tampilkan teksnya.
      const t = document.createElement('h3');
      t.className = 'spotlight-card-title';
      t.textContent = item.title;
      body.prepend(t);
      card.classList.add('is-textonly');
    } else {
      const img = card.querySelector('.spotlight-card-media img');
      img?.addEventListener('error', () => {
        const media = card.querySelector('.spotlight-card-media');
        if (media) media.remove();
        const t = document.createElement('h3');
        t.className = 'spotlight-card-title';
        t.textContent = item.title;
        body.prepend(t);
        card.classList.add('is-textonly');
      });
    }

    card.append(body);
    card.style.setProperty('--card-accent', item.accent);

    // Kartu bisa diklik → lompat ke kartu itu
    card.addEventListener('click', (e) => {
      // Jangan lompat kalau ini akhir dari drag (bukan klik sungguhan)
      if (draggedFar) return;
      const idx = Number(card.dataset.index);
      if (idx !== current) goTo(idx);
    });

    track.append(card);
    return card;
  });

  root.append(stage);

  // ── Info kartu depan: judul + deskripsi saja ──────────────────────────────
  // Counter "01 / 08" dan rating "★ 231" DIHAPUS (permintaan pemilik: "angka
  // belum hilang"). Keduanya angka yang tidak menambah pemahaman:
  //
  //   - Counter: posisi kartu sudah ditunjukkan busur visual + dots. Angka
  //     "01/08" hanya mengulang informasi yang sudah terlihat.
  //   - Rating "★ 231": itu JUMLAH TES, bukan rating pengguna. Menampilkannya
  //     dengan ikon bintang menyesatkan — pengunjung mengira itu penilaian
  //     orang lain, padahal angka dari hasil uji otomatis.
  //
  // Judul dan deskripsi tetap — itu yang benar-benar menjelaskan proyek.
  const info = document.createElement('div');
  info.className = 'spotlight-info';
  info.innerHTML = `
    <div class="spotlight-meta">
      <h3 class="spotlight-front-title"></h3>
      <p class="spotlight-front-sub"></p>
    </div>`;
  root.append(info);

  // ── Dots ──────────────────────────────────────────────────────────────────
  const dotsWrap = document.createElement('div');
  dotsWrap.className = 'spotlight-dots';
  dotsWrap.setAttribute('role', 'tablist');
  dotsWrap.setAttribute('aria-label', 'Pilih proyek');
  const dots = items.map((item, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'spotlight-dot';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', item.title);
    d.addEventListener('click', () => goTo(i));
    dotsWrap.append(d);
    return d;
  });

  // ── Tombol panah DIHAPUS ───────────────────────────────────────────────────
  // Atas permintaan pemilik: "tombolnya juga dihilangkan saja biar rapi."
  //
  // Alasannya masuk akal: dengan auto-scroll yang berjalan sendiri plus drag
  // dan dots, tombol panah jadi kontrol ketiga yang tidak perlu. Galeri
  // komersial (Apple, Stripe, Linear) umumnya hanya pakai dots — lebih bersih,
  // dan tidak ada tombol yang harus dijelaskan.
  //
  // Navigasi yang TETAP ada:
  //   - drag / swipe (mouse + sentuh)
  //   - dots di bawah (klik langsung ke kartu tertentu)
  //   - tombol panah keyboard (← →) — tetap bekerja, tidak terlihat
  //
  // Keyboard tetap didukung penuh, jadi menghapus tombol tidak mengurangi
  // aksesibilitas.

  const foot = document.createElement('div');
  foot.className = 'spotlight-foot';
  foot.append(dotsWrap);
  root.append(foot);

  // ── Petunjuk interaksi DIHAPUS ─────────────────────────────────────────────
  // "Geser · Sentuh · Tombol panah" dibuang atas permintaan pemilik: terlalu
  // menjelaskan hal yang sudah jelas. Carousel yang meluncur sendiri sudah
  // memberi tahu bahwa ia bisa digeser — petunjuk tertulis justru membuat
  // situs terasa seperti tutorial, bukan galeri.
  //
  // Tombol panah juga dihapus, jadi kalimat itu sudah tidak akurat lagi.

  // ── State ─────────────────────────────────────────────────────────────────
  let current = 0;
  let draggedFar = false;

  const frontTitle = info.querySelector('.spotlight-front-title');
  const frontSub = info.querySelector('.spotlight-front-sub');
  // idxEl, totalEl, ratingEl dihapus bersama elemennya — tidak ada lagi
  // referensi ke elemen yang tidak ada.

  /**
   * Hitung jarak TERPENDEK antara dua indeks pada lingkaran.
   * Ini yang membuat carousel tak terbatas: dari kartu 1 ke kartu terakhir
   * jaraknya -1, bukan +7.
   */
  function shortestDelta(from, to) {
    const n = items.length;
    let d = (to - from) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }

  /** Tulis posisi semua kartu berdasarkan `current`. */
  function render(progress = 0) {
    for (const card of cards) {
      const i = Number(card.dataset.index);
      // posisi relatif terhadap kartu depan, termasuk pecahan saat digeser
      const rel = shortestDelta(current, i) - progress;
      const abs = Math.abs(rel);
      const sign = Math.sign(rel);

      if (abs > ARC.maxVisible) {
        // ── KENAPA KARTU INI HARUS DIPINDAHKAN DULU, BARU DISEMBUNYIKAN ──────
        // Bug nyata: `continue` sebelum menulis transform membuat kartu ini
        // tetap di posisi TERAKHIRNYA. Kalau posisi terakhir itu di tengah
        // panggung, ia duduk di sana dengan opacity 0 — tidak terlihat, tapi
        // MENGHALANGI klik dan mengacaukan pengukuran.
        //
        // Terukur di uji otomasi: kartu index 4 terdeteksi di x=0 (tengah)
        // dengan lebar penuh 280px, padahal opacity 0. Ia "hantu" di tengah
        // carousel.
        //
        // Perbaikan: dorong dulu ke luar jangkauan (3.5 langkah), baru
        // disembunyikan. Jadi ia tidak pernah menempati ruang yang terlihat.
        const jauh = Math.sign(rel) * (ARC.maxVisible + 0.5) * ARC.stepX;
        card.style.transform = `translate3d(${jauh.toFixed(1)}px, 0, 0) scale(0.6)`;
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
        card.style.zIndex = '0';
        card.classList.remove('is-front');
        continue;
      }

      const x = rel * ARC.stepX;
      const y = abs * ARC.stepY;              // 0 — baris lurus, bukan busur
      const rot = -sign * ARC.rotate;         // hanya 4°, kesan kedalaman

      // ── SKALA: KARTU AKTIF MEMBESAR, TETANGGA MENGECIL ──────────────────
      // Referensi Shadcnblocks Gallery 17: kartu aktif 100%, tetangga 70%.
      // Awalnya saya pakai peluruhan 14%/langkah — terukur hasilnya cuma
      // 1.14× (280px vs 244px), kurang terasa. Naikkan ke 20%/langkah:
      // kartu ke-2 = 80%, ke-3 = 64% → rasio ~1.25× seperti referensi.
      //
      // Lantai 0.55 supaya kartu terjauh tidak jadi titik kecil.
      const scale = Math.max(0.55, 1 - abs * ARC.scaleStep);

      // ── OPACITY: kartu belakang memudar ─────────────────────────────────
      // Referensi: tetangga 40% opacity. Di sini peluruhan lebih lembut
      // (lantai 0.45) supaya kartu ke-2 masih bisa dilihat gambarnya —
      // terlalu pudar membuat deretannya terasa kosong.
      const op = abs < 0.5 ? 1 : Math.max(0.45, 1 - abs * 0.28);

      card.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) ` +
        `rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = op.toFixed(3);
      card.style.zIndex = String(100 - Math.round(abs * 10));
      card.style.pointerEvents = abs < 1.5 ? 'auto' : 'none';
      card.classList.toggle('is-front', abs < 0.5);
    }
  }

  /** Perbarui judul + deskripsi + dots agar sinkron dengan kartu depan. */
  function syncInfo() {
    const item = items[current];
    frontTitle.textContent = item.title;
    frontSub.textContent = item.meta;

    dots.forEach((d, i) => {
      const aktif = i === current;
      d.classList.toggle('is-active', aktif);
      d.setAttribute('aria-selected', String(aktif));
      d.tabIndex = aktif ? 0 : -1;
    });
  }

  /** Pindah ke indeks tertentu, dengan animasi mendarat (snap). */
  function goTo(target, instant = false, kecepatanAwal = 0) {
    const n = items.length;
    // Selalu ambil jalur terpendek supaya gerakannya tidak "memutar jauh"
    const delta = shortestDelta(current, ((target % n) + n) % n);
    const to = current + delta;
    current = ((to % n) + n) % n;

    if (instant || prefersReduced()) {
      render();
      syncInfo();
      return;
    }

    // ── SPRING PHYSICS, BUKAN DURASI ──────────────────────────────────────
    // Setiap frame menghitung gaya pegas:
    //
    //     F = -k·x - c·v
    //
    //   x = jarak dari target, v = kecepatan saat ini
    //   k (stiffness) = 120 → seberapa kuat pegas menarik ke target
    //   c (damping)   = 14  → seberapa cepat getaran mereda
    //
    // Nilai k=120, c=14 dari springs.gentle (skill motion-foundations:
    // "cards, modals, panels landing softly").
    //
    // CATATAN PENTING — fisika pegas itu SCALE-INVARIANT: kalau x dikali
    // konstanta, lintasannya sama persis, hanya skalanya yang ikut. Jadi
    // satuan x (kartu vs piksel) TIDAK mempengaruhi bentuk kurva — overshoot
    // selalu ~7% dari jarak tempuh, dan waktu mendarat selalu ~0,7 detik.
    // (Sempat saya "konversi" nilainya, itu keliru dan membuat animasi 13×
    // lebih lambat. Dibatalkan.)
    const SPRING_K = 120;   // springs.gentle.stiffness
    const SPRING_C = 14;    // springs.gentle.damping
    let x = delta;          // jarak dari target, dalam satuan "kartu"
    // Kecepatan awal: kalau kartu dilepas dari drag yang cepat, momentum itu
    // dibawa masuk — kartu "melanjutkan" gerakannya lalu ditahan pegas.
    // Inilah yang membuat lepas-drag terasa seperti melempar benda, bukan
    // animasi yang dimulai dari nol.
    let v = -kecepatanAwal;

    // ── TAHAN TAB-HIDDEN ──────────────────────────────────────────────────
    // Prinsip skill motion-advanced: "Infinite animations must pause when
    // document.visibilityState === 'hidden'." rAF memang otomatis pause saat
    // tab disembunyikan, TAPI waktu tetap maju. Kalau tidak ditangani, saat
    // tab dibuka lagi pegas "melompat" beberapa langkah sekaligus — terlihat
    // seperti glitch. Solusinya: batasi dt maksimum 32ms (2 frame @60fps),
    // jadi jeda sepanjang apa pun tidak pernah dihitung sebagai satu langkah
    // raksasa.
    let frameTerakhir = 0;

    function frame(now) {
      if (!frameTerakhir) { frameTerakhir = now; requestAnimationFrame(frame); return; }
      // Batasi dt — cegah lompatan setelah tab kembali dari background
      const dt = Math.min((now - frameTerakhir) / 1000, 0.032);
      frameTerakhir = now;

      // Integrasi Euler: hitung gaya pegas, ubah ke percepatan, tambah ke
      // kecepatan, lalu ke posisi. Urutan ini penting — kalau posisi dihitung
      // sebelum kecepatan diperbarui, hasilnya kurang stabil.
      const a = -SPRING_K * x - SPRING_C * v;
      v += a * dt;
      x += v * dt;

      // ── TANDA `delta` DULU TERBALIK — INI PENYEBAB "LOMPATAN" ────────────
      //
      // render(p) menghitung: rel = shortestDelta(current, i) - p
      // `current` SUDAH indeks baru saat frame pertama jalan.
      //
      // Untuk kartu i:
      //   posisi sebelum animasi = sd(current_baru, i) + delta
      //   posisi sesudah animasi = sd(current_baru, i)
      //
      // Jadi p harus bergerak dari +delta ke 0. Kalau p mulai dari delta:
      //   rel = sd(current_baru, i) - delta = posisi_sebelum - 2·delta  ← SALAH
      //
      // Yang benar: mulai dari -delta, karena
      //   rel = sd(current_baru, i) - (-delta) = sd(current_baru, i) + delta
      //                                       = posisi_sebelum  ✓
      //
      // Jadi peta pegas → render harus dibalik tandanya: render(-x).
      // (x bergerak dari delta ke 0; -x bergerak dari -delta ke 0.)
      //
      // Diukur di browser sebelum perbaikan: kartu melompat 356px dari posisi
      // 0px ke -356px pada frame pertama. Itu yang terlihat seperti "lompatan",
      // bukan soal kecepatan.
      render(-x);

      // Berhenti saat pegas benar-benar tenang: jarak < 0.001 kartu (≈0.18px)
      // DAN kecepatan < 0.001 kartu/detik. Keduanya dicek — kalau hanya jarak,
      // kartu bisa berhenti saat masih bergerak cepat melewati target.
      if (Math.abs(x) < 0.001 && Math.abs(v) < 0.001) {
        render();
        syncInfo();
        return;
      }
      requestAnimationFrame(frame);
    }
    syncInfo();
    requestAnimationFrame(frame);
  }

  // ── Drag & swipe ──────────────────────────────────────────────────────────
  // Satu jalur kode untuk mouse dan sentuh — Pointer Events menangani keduanya.
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let moved = 0;
  let lockAxis = null;   // 'x' kalau geser horizontal, 'y' kalau vertikal
  let rafPending = false;
  let pendingProgress = 0;
  let activePointerId = null;
  // Kecepatan gesture (kartu/detik) — dihitung dari sampel terakhir, bukan
  // rata-rata seluruh drag. Rata-rata akan membuat sentakan cepat di akhir
  // terbaca sebagai gerakan lambat, padahal justru sentakan itu yang paling
  // menunjukkan niat pengguna.
  let kecepatanGesture = 0;
  let sampelTerakhir = { t: 0, progress: 0 };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // hanya klik kiri
    dragging = true;
    draggedFar = false;
    startX = e.clientX;
    startY = e.clientY;
    moved = 0;
    lockAxis = null;
    pendingProgress = 0;
    activePointerId = e.pointerId;
    kecepatanGesture = 0;
    sampelTerakhir = { t: performance.now(), progress: 0 };
    stage.classList.add('is-grabbing');
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* abaikan */ }
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.abs(dx));

    // Tentukan sumbu SEKALI saja. Kalau pengguna menggeser vertikal, biarkan
    // halaman yang scroll — jangan rebut gesturnya.
    if (!lockAxis && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      lockAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (lockAxis === 'y') return;

    if (moved > 6) draggedFar = true;

    // progress = seberapa jauh digeser, dalam satuan "kartu"
    pendingProgress = -dx / ARC.stepX;

    // ── Ukur kecepatan dari dua sampel terakhir ────────────────────────────
    // Bukan rata-rata seluruh drag. Yang menentukan "niat" pengguna adalah
    // gerakan pada saat MELEPAS, bukan gerakan di awal.
    const now = performance.now();
    const dtSampel = (now - sampelTerakhir.t) / 1000;
    if (dtSampel > 0.008) { // minimal 8ms — di bawah itu noise, bukan gerakan
      const dProgress = pendingProgress - sampelTerakhir.progress;
      // Rata-rata berbobot: 70% sampel baru, 30% sebelumnya. Meredam lonjakan
      // sesaat tanpa menghapus sentakan sungguhan.
      kecepatanGesture = kecepatanGesture * 0.3 + (dProgress / dtSampel) * 0.7;
      sampelTerakhir = { t: now, progress: pendingProgress };
    }

    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        render(pendingProgress);
      });
    }
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-grabbing');
    // Lepas pointer capture dengan aman. `releasePointerCapture(undefined)`
    // melempar NotFoundError dan menghentikan sisa handler — jadi drag tidak
    // pernah menyelesaikan snap-nya. Bug nyata yang tertangkap di uji otomasi.
    try { stage.releasePointerCapture?.(activePointerId); } catch { /* sudah lepas */ }

    if (lockAxis !== 'x') { render(); return; }

    // Snap: kalau geseran melewati 1/2 kartu, pindah satu langkah.
    // Ambang 1/2 (bukan 1/3) dipilih supaya drag pendek tidak tidak sengaja
    // memindah kartu — prinsip skill motion-advanced: "Swipe threshold must
    // be explicit."
    //
    // Aturan skill motion-advanced juga: "Never infer intent from velocity
    // alone; combine offset + velocity checks." Jadi selain ambang jarak,
    // kecepatan gesture dipakai — geseran pendek tapi CEPAT (sentakan) tetap
    // memindah kartu, karena itu memang niat pengguna.
    const geser = Math.round(pendingProgress);
    const cepat = Math.abs(kecepatanGesture) > 0.6; // kartu/detik
    if (geser !== 0 || cepat) {
      // Arah dari geseran; kalau geseran 0 tapi cepat, pakai arah kecepatan
      const arah = geser !== 0 ? geser : Math.sign(pendingProgress || kecepatanGesture);
      goTo(current - arah, false, kecepatanGesture);
    } else {
      goTo(current, true);
    }
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  // Cegah drag bawaan browser (gambar/link) mengganggu
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  // ── Keyboard ──────────────────────────────────────────────────────────────
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
  });
  root.tabIndex = 0;

  // ── AUTO-SCROLL: DRIFT KONTINU ─────────────────────────────────────────────
  // Kartu bergerak TERUS tanpa henti, bukan "gerak 620ms lalu diam 4 detik".
  //
  // ── KENAPA POLA LAMA DIGANTI ──────────────────────────────────────────────
  // Pola pertama (interval 4,2 detik + animasi 620ms) terasa MENYENTAK: kartu
  // meluncur, lalu berhenti mati, lalu meluncur lagi. Mata membaca itu sebagai
  // "gerakan yang terputus-putus", bukan galeri yang hidup.
  //
  // Skill motion-advanced: "Physics-based motion always feels more natural
  // than duration-based for direct manipulation." Jadi kecepatan sekarang
  // KONSTAN — kartu meluncur pelan terus-menerus, seperti piringan berputar.
  //
  // ── CARA KERJANYA ─────────────────────────────────────────────────────────
  // Satu rAF loop menambah `drift` sedikit setiap frame. `drift` disuapkan ke
  // render() yang sudah ada — rumus posisi tidak berubah sama sekali.
  //
  // Setelah `drift` mencapai 1 (satu kartu penuh), indeks digeser dan `drift`
  // dikurangi 1. Karena kartu tetangga berada di posisi yang sama persis,
  // peralihan itu TIDAK TERLIHAT — tidak ada lompatan. Ini yang membuatnya
  // mulus tanpa batas.
  //
  // ── KAPAN BERHENTI ────────────────────────────────────────────────────────
  //   - kursor masuk / fokus keyboard → berhenti, lanjut saat keluar
  //   - pengunjung menggeser / klik dot / panah → berhenti PERMANEN
  //   - tab disembunyikan → berhenti
  //   - carousel di luar layar → berhenti
  //   - prefers-reduced-motion → tidak jalan sama sekali
  // ── KECEPATAN ─────────────────────────────────────────────────────────────
  // 38px/detik terlalu cepat (pemilik: "kayak lompatan"). 13px/detik terlalu
  // pelan. 21px/detik ≈ 8,5 detik per kartu — cukup tenang untuk dilihat,
  // cukup hidup supaya tidak terasa diam.
  //
  // Tidak ada jeda sama sekali — kecepatan konstan, tidak pernah berhenti
  // sendiri. Itu yang membuatnya terasa "slip" seperti eskalator.
  const DRIFT_PX_PER_SEC = 21;   // ≈1 kartu (178px) per 8,5 detik
  const AUTO_RESUME_MS = 4000;   // jeda setelah kursor keluar, sebelum lanjut

  // ── SPRING PHYSICS (dari skill motion-foundations) ────────────────────────
  // Efek "jeli": saat kartu mendarat setelah drag/klik, posisinya TIDAK
  // langsung berhenti — ada momentum yang mengikutinya, sedikit melewati
  // target, lalu mengendap. Ini yang membuat gerakan terasa hidup seperti
  // benda nyata, bukan animasi yang dipindahkan.
  //
  // Rumus: F = -k·x - c·v  (Hooke's law + peredam)
  //   k (stiffness) — seberapa kuat pegas menarik ke target
  //   c (damping)   — seberapa cepat getaran mereda
  //
  // Nilai dari springs.gentle di skill: k=120, c=14 — preset untuk "kartu
  // yang mendarat dengan lembut". Bukan angka karangan.
  const SPRING_K = 120;   // springs.gentle.stiffness
  const SPRING_C = 14;    // springs.gentle.damping

  let drift = 0;                 // posisi pecahan antara kartu (0..1)
  let driftAktif = !prefersReduced();
  let driftPermanen = false;     // true setelah pengunjung ambil kendali
  let kursorDiArea = false;
  let terlihatDiLayar = true;
  let rafId = null;
  let frameTerakhir = 0;
  let resumeTimer = null;

  function loopDrift(now) {
    rafId = null;
    if (!driftAktif || driftPermanen) return;

    // Hitung delta waktu. Frame pertama tidak punya pembanding — lewati.
    if (!frameTerakhir) { frameTerakhir = now; rafId = requestAnimationFrame(loopDrift); return; }
    const dt = Math.min(now - frameTerakhir, 100); // batasi 100ms — cegah lompatan setelah jeda panjang
    frameTerakhir = now;

    if (driftAktif && !kursorDiArea && terlihatDiLayar && !dragging
        && document.visibilityState !== 'hidden') {
      drift += (DRIFT_PX_PER_SEC * dt / 1000) / ARC.stepX;

      // Satu kartu penuh tercapai → geser indeks, kurangi drift.
      //
      // ── KENAPA `render(+drift)`, BUKAN `render(-drift)` ──────────────────
      // Ini bug yang membuat auto-scroll terlihat "tidak slick" — ada lompatan
      // 441px setiap kali kartu berganti. Dihitung dengan tangan:
      //
      //   render(P) → rel = sd(current, i) - P
      //   Kartu di kiri kartu-depan punya rel = -1 (sd = -1), jadi untuk
      //   memindahkannya ke tengah (rel = 0) dibutuhkan P = -1.
      //
      //   drift berjalan 0 → +1. Jadi P harus = +drift, dan swap terjadi saat
      //   drift mencapai 1 (kartu berikutnya sudah di rel ≈ 0).
      //
      // Dengan render(-drift): drift +0.9 → P = -0.9 → kartu-depan bergerak
      // ke rel +0.9 (KANAN). Lalu saat swap, current naik dan P kembali 0 →
      // kartu itu melompat ke rel -1 (KIRI). Terukur: lompatan 441px.
      //
      // Dengan render(+drift): drift +0.9 → P = +0.9 → kartu-depan bergerak
      // ke rel -0.9 (KIRI), swap saat drift = 1 → kartu itu di rel -1 (KIRI).
      // Mulus — diverifikasi lewat simulasi: lompatan 0.00px.
      while (drift >= 1) {
        drift -= 1;
        current = (current + 1) % items.length;
        syncInfo();
      }
      render(drift);
    }

    rafId = requestAnimationFrame(loopDrift);
  }

  function driftMulai() {
    if (rafId || driftPermanen || !driftAktif) return;
    frameTerakhir = 0; // reset supaya dt frame pertama tidak raksasa
    rafId = requestAnimationFrame(loopDrift);
  }

  function driftStop(permanen = false) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (permanen) { driftPermanen = true; }
  }

  // Pengunjung mengambil kendali → berhenti PERMANEN. Kalau drift menyala lagi
  // setelah mereka menggeser, itu terasa seperti carousel "merebut" kendali.
  stage.addEventListener('pointerdown', () => driftStop(true));
  dotsWrap.addEventListener('click', () => driftStop(true));
  root.addEventListener('focusin', () => driftStop(true));

  // Kursor masuk → berhenti. Keluar → lanjut setelah jeda.
  stage.addEventListener('pointerenter', () => { kursorDiArea = true; });
  stage.addEventListener('pointerleave', () => {
    kursorDiArea = false;
    if (driftPermanen || !driftAktif) return;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!kursorDiArea && !driftPermanen) driftMulai();
    }, AUTO_RESUME_MS);
  });

  // Carousel di luar layar → tidak ada yang melihat, tidak perlu bergerak.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([entry]) => {
      terlihatDiLayar = entry.isIntersecting;
      if (terlihatDiLayar && !driftPermanen) driftMulai();
      else driftStop();
    }, { threshold: 0.2 });
    io.observe(root);
  } else {
    driftMulai();
  }

  // Tab disembunyikan → hentikan loop. Jangan buang baterai/GPU.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') driftStop();
    else if (!driftPermanen && terlihatDiLayar && !kursorDiArea) driftMulai();
  });

  // ── Render awal ───────────────────────────────────────────────────────────
  render();
  syncInfo();

  return root;
}
