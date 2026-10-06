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
import { icon } from './icons.js';

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Jarak antar kartu dalam busur, dalam px pada skala 1. */
const ARC = {
  stepX: 178,      // geser horizontal per langkah
  stepY: 22,       // turun per langkah (membentuk busur cekung)
  rotate: 21,      // derajat putar per langkah
  scaleStep: 0.05, // pengecilan per langkah
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

  // ── Tombol panah ──────────────────────────────────────────────────────────
  const nav = document.createElement('div');
  nav.className = 'spotlight-nav';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'spotlight-arrow';
  prev.setAttribute('aria-label', 'Proyek sebelumnya');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'spotlight-arrow';
  next.setAttribute('aria-label', 'Proyek berikutnya');
  prev.append(icon('arrow-left', { size: 18 }) ?? document.createTextNode('←'));
  next.append(icon('arrow-right', { size: 18 }) ?? document.createTextNode('→'));
  prev.addEventListener('click', () => goTo(current - 1));
  next.addEventListener('click', () => goTo(current + 1));
  nav.append(prev, next);

  const foot = document.createElement('div');
  foot.className = 'spotlight-foot';
  foot.append(dotsWrap, nav);
  root.append(foot);

  // ── Petunjuk interaksi ────────────────────────────────────────────────────
  const hint = document.createElement('p');
  hint.className = 'spotlight-hint';
  hint.textContent = 'Geser · Sentuh · Tombol panah';
  root.append(hint);

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
        // Di luar jangkauan pandang — sembunyikan supaya tidak ada kartu
        // "nyempil" di tepi panggung.
        card.style.opacity = '0';
        card.style.pointerEvents = 'none';
        continue;
      }

      const x = rel * ARC.stepX;
      const y = abs * ARC.stepY;              // turun makin jauh → busur cekung
      const rot = -sign * ARC.rotate;          // kartu kiri menghadap kanan
      const scale = Math.max(0.6, 1 - abs * ARC.scaleStep);
      // Opacity kartu belakang — kritik: "kartu belakang ~30% hampir hilang,
      // stack terasa datar". Dinaikkan: lantai 0.35 → 0.52, dan peluruhan
      // per langkah 0.3 → 0.24 supaya kartu kedua masih terbaca sebagai karya.
      // Tetap ada gradasi jelas: 1.0 di depan, 0.52 di ujung.
      const op = abs < 0.5 ? 1 : Math.max(0.52, 1 - abs * 0.24);

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
  function goTo(target, instant = false) {
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

    // Animasi mendarat: dari -delta menuju 0, jadi kartu bergerak searah.
    //
    // ── DURASI & EASING ───────────────────────────────────────────────────
    // Sebelumnya 380ms easeOutCubic — terasa agak "kaku" untuk gerakan
    // otomatis yang berulang. Dinaikkan ke 620ms dengan easeOutExpo: cepat di
    // awal, melambat panjang di akhir. Efeknya kartu seperti "melayang" ke
    // posisinya, bukan dipindahkan. Ini yang membuat auto-scroll enak dilihat
    // berulang-ulang, bukan mengganggu.
    //
    // Durasi tetap dari token: 620ms = --motion-slow (bukan angka karangan).
    const dur = 620;   // = --motion-slow
    const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)); // easeOutExpo

    // ── TAHAN TAB-HIDDEN ──────────────────────────────────────────────────
    // Prinsip skill motion-advanced: "Infinite animations must pause when
    // document.visibilityState === 'hidden'." rAF memang otomatis pause saat
    // tab disembunyikan, TAPI performance.now() tetap maju. Akibatnya saat
    // tab dibuka lagi, t sudah > 1 dan kartu "melompat" ke posisi akhir —
    // terlihat seperti glitch. Solusinya: catat waktu pause, lalu geser
    // titik awal supaya durasi yang terlewat tidak dihitung.
    let t0 = performance.now();
    let jeda = 0;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        jeda = performance.now();
      } else if (jeda) {
        // Tab kembali terlihat — geser titik awal sebanyak waktu yang hilang
        t0 += performance.now() - jeda;
        jeda = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const p = ease(t);
      // progress bergerak dari delta → 0 (kartu meluncur ke posisi baru)
      render(delta * (1 - p));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        document.removeEventListener('visibilitychange', onVisibility);
        render();
        syncInfo();
      }
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
    const geser = Math.round(pendingProgress);
    if (geser !== 0) goTo(current - geser);
    else goTo(current, true);
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
  const DRIFT_PX_PER_SEC = 13;   // ~1 kartu (178px) per 13,7 detik — pelan, tenang
  const AUTO_RESUME_MS = 6000;   // jeda setelah kursor keluar, sebelum lanjut

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
      // Kartu tetangga ada di posisi identik, jadi peralihan tidak terlihat.
      while (drift >= 1) {
        drift -= 1;
        current = (current + 1) % items.length;
        syncInfo();
      }
      render(-drift);
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
  nav.addEventListener('click', () => driftStop(true));
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
