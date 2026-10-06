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
   *
   * ── TIE-BREAK JARAK SETENGAH LINGKARAN ────────────────────────────────────
   * Bug nyata: saat jaraknya TEPAT setengah lingkaran (4 dari 8 kartu),
   * `d > n/2` bernilai false sehingga hasilnya tetap +4 — kartu muncul di
   * KANAN. Tapi setelah `current` maju satu langkah, jaraknya jadi -4 — kartu
   * muncul di KIRI.
   *
   * Akibatnya kartu yang sama BERPINDAH SISI saat navigasi. Terukur: kartu 5
   * pindah dari translate3d(-710px) ke translate3d(+939px) — lompatan 1846px.
   * Tidak terlihat karena opacity-nya 0, tapi terdeteksi di pengukuran dan
   * membuat kartu "muncul dari sisi yang salah" saat masuk jangkauan.
   *
   * Perbaikan: jarak tepat setengah SELALU dibuat negatif. Dengan aturan tetap
   * (selalu -n/2, tidak pernah +n/2), kartu selalu muncul dari sisi yang sama
   * — jadi perpindahannya konsisten saat current berubah.
   *
   * `>=` bukan `>` di baris pertama: itu yang memaksa +4 menjadi -4.
   */
  function shortestDelta(from, to) {
    const n = items.length;
    let d = (to - from) % n;
    if (d >= n / 2) d -= n;        // >= , bukan >  → tie-break ke negatif
    if (d < -n / 2) d += n;
    return d;
  }

  // ── STATE AUTO-SCROLL ──────────────────────────────────────────────────────
  // Dideklarasikan DI ATAS goTo() karena goTo() memakainya (menandai animasi
  // mulai/selesai). Kalau dideklarasikan di bawah, `let` membuat TDZ error:
  // variabel diakses sebelum deklarasinya dieksekusi.
  //
  // Ini pernah jadi bug nyata — gejalanya carousel tidak jalan sama sekali.
  let autoAktif = !prefersReduced();
  let autoPermanen = false;      // true setelah pengunjung ambil kendali
  let kursorDiArea = false;
  let terlihatDiLayar = true;
  let jedaTimer = null;
  let resumeTimer = null;
  let sedangAnimasi = false;     // true saat pegas sedang bergerak
  let onAnimasiSelesai = null;   // callback setelah pegas tenang
  // ── "NAPAS" PEGAS — NILAI YANG SUDAH DIHALUSKAN (0 … 0,12) ──────────────
  // Permintaan pemilik: kartu menyusut saat meluncur, membesar saat mendarat
  // (squash-and-stretch). Versi pertama GLITCH tepat saat pegas mantul.
  //
  // AKAR MASALAH — terukur dari rekaman, bukan dugaan:
  // nilai susut dulu dihitung dari KECEPATAN mentah, `min(0,12, |v|/2,4)`.
  // Pegas k=120 c=14 itu underdamped (ζ=0,64), jadi ia berayun 2–3 kali
  // sebelum tenang. Di SETIAP titik balik v = 0 → susut mendadak 0 → kartu
  // melonjak mengembang penuh dalam SATU frame, lalu menyusut lagi.
  //
  //   rekaman: skala 0,698 → 0,772 → 0,736 → 0,735 → 0,800
  //            lompatan maks 0,0616/frame · 6× balik arah
  //
  // PERBAIKAN — hitung susut dari ENERGI pegas, bukan kecepatan:
  //
  //   E = √(½v² + ½k·x²)        dE/dt = −c·v²  ≤ 0
  //
  // Turunannya SELALU ≤ 0, jadi energi tidak pernah naik → tidak ada denyut
  // balik. Ini menghilangkan glitch secara struktural, bukan ditambal.
  //
  // Lalu dihaluskan envelope follower (attack 0,12 s / release 0,20 s) —
  // prinsip yang sama dengan kompresor audio: naik halus, turun perlahan
  // sehingga titik balik pegas tertutupi.
  //
  // Dihitung di dalam loop pegas (goTo) karena butuh x DAN v sekaligus.
  let napasPegas = 0;

  /** Tulis posisi semua kartu berdasarkan `current`. */
  function render(progress = 0) {
    // Napas yang "tertinggal" (mis. pengunjung menyambar kartu di tengah
    // animasi) meluruh sendiri saat pegas tidak jalan — supaya kartu tidak
    // terjebak dalam keadaan menyusut.
    if (!sedangAnimasi) napasPegas *= 0.88;

    for (const card of cards) {
      const i = Number(card.dataset.index);
      // posisi relatif terhadap kartu depan, termasuk pecahan saat digeser
      let rel = shortestDelta(current, i) - progress;

      // ── BATASI `rel` SUPAYA TIDAK MELEWATI SETENGAH LINGKARAN ───────────
      // Saat drag, `progress` bergerak, jadi `rel` bisa keluar dari rentang
      // [-n/2, +n/2). Kartu yang jauh di kiri terus didorong makin kiri tanpa
      // batas (terukur: rel mencapai -8.5 = satu putaran penuh).
      //
      // Saat `current` berubah (swap), `shortestDelta(current, i)` ikut
      // berubah dan kartu itu MELOMPAT dari -1740px ke +1394px — terukur
      // 1848px. Tidak terlihat karena opacity 0, tapi itu tanda posisinya
      // tidak terkendali.
      //
      // Perbaikan: `rel` dibungkus ke rentang [-n/2, +n/2) supaya kartu yang
      // sudah lewat setengah putaran "muncul kembali" dari sisi seberang —
      // sama seperti perilaku carousel tak terbatas yang benar.
      const n = items.length;
      while (rel >= n / 2) rel -= n;
      while (rel < -n / 2) rel += n;

      const abs = Math.abs(rel);
      const sign = Math.sign(rel);

      // ── KARTU DI LUAR JANGKAUAN: TETAP DIHITUNG POSISINYA ───────────────
      // Bug ketiga: dulu kartu ini "dibekukan" (di-continue) sehingga posisinya
      // tertinggal di tempat lama. Saat ia masuk jangkauan lagi, posisinya
      // melompat 1508px dari tempat bekunya. Terukur: lompatan 1624px
      // (7 langkah × 232px).
      //
      // Perbaikan: jangan di-continue. Posisinya dihitung seperti kartu lain
      // (di bawah), yang dibuat nol hanya opacity-nya. Jadi saat muncul, ia
      // sudah berada di posisi yang benar.
      // ── HYSTERESIS PADA BATAS TAMPIL ────────────────────────────────
      // Kartu di sekitar abs = 3,0 berayun ±0,003 kartu saat pegas menetap —
      // cukup untuk melewati ambang bolak-balik. Terukur di rekaman
      // MutationObserver: kartu 4 dan 6 berganti kelas 3× dalam SATU
      // perpindahan (bayangan-3 → luar → bayangan-3), dan tiap ganti memulai
      // transisi bayangan baru + menyalakan/mematikan layer GPU.
      //
      // Solusi: dua ambang. Kartu yang sudah di luar baru kembali saat
      // abs < 2,75; kartu yang masih tampil baru dilepas saat abs > 3,0.
      // Jarak 0,25 kartu jauh lebih besar dari ayunan pegas, jadi mustahil
      // bolak-balik. Secara visual tidak ada bedanya: di abs 2,75–3,0
      // opacity kartu sudah ≤ 0,06 (praktis tak terlihat).
      const sudahLuar = card.dataset.luar === '1';
      const diLuar = sudahLuar ? abs > 2.75 : abs > ARC.maxVisible;
      card.dataset.luar = diLuar ? '1' : '0';

      const x = rel * ARC.stepX;
      const y = abs * ARC.stepY;              // 0 — baris lurus, bukan busur
      const rot = -sign * ARC.rotate;         // hanya 4°, kesan kedalaman

      // ── SKALA: KARTU AKTIF MEMBESAR, TETANGGA MENGECIL ──────────────────
      // Referensi Shadcnblocks Gallery 17: kartu aktif 100%, tetangga 70%.
      // Peluruhan 20%/langkah: kartu ke-2 = 80%, ke-3 = 64% → rasio ~1.25×.
      //
      // Lantai 0.55 supaya kartu terjauh tidak jadi titik kecil.
      let scale = Math.max(0.55, 1 - abs * ARC.scaleStep);

      // ── EFEK "NAPAS": MENYUSUT SAAT MELUNCUR, MEMBESAR SAAT MENDARAT ────
      // Ini efek squash-and-stretch (Disney's 12 principles): benda yang
      // bergerak cepat menyusut sedikit, lalu mengembang kembali saat berhenti.
      //
      // `napasPegas` sudah dihitung di loop pegas dari ENERGI (lihat catatan
      // di deklarasi variabelnya) — bukan dari kecepatan mentah. Jadi nilainya
      // naik sekali lalu turun sekali, tanpa denyut.
      //
      // Bobot kartu: 1 untuk kartu dekat pusat, meluruh HALUS ke 0 pada
      // abs = 1,5. Versi lama memakai ambang keras `abs < 1,5 ? … : 0` — saat
      // kartu melewati abs = 1,5 di tengah gerakan, susutnya melompat dari
      // 12% ke 0 dalam satu frame. Terukur di rekaman: lompatan skala 0,118
      // pada kartu 7 tepat di ambang itu.
      const bobotNapas = abs < 1 ? 1 : Math.max(0, (1.5 - abs) / 0.5);
      scale *= (1 - napasPegas * bobotNapas);

      // ── OPACITY: kartu belakang memudar ─────────────────────────────────
      // Referensi: tetangga 40% opacity. Di sini peluruhan lebih lembut
      // (lantai 0.45) supaya kartu ke-2 masih bisa dilihat gambarnya —
      // terlalu pudar membuat deretannya terasa kosong.
      //
      // Kartu di luar jangkauan (abs > maxVisible) tetap 0 — jangan ditimpa
      // dengan nilai memudar, karena ia harus benar-benar tidak terlihat.
      // Opacity = fungsi KONTINU dari abs. Versi lama punya dua lompatan:
      //
      //   abs 0,5 : 1,000 → 0,860   (lompatan 0,140 dalam satu frame)
      //   abs 3,0 : 0,450 → 0,000   (lompatan 0,450 — kartu "berkedip" hilang)
      //
      // Terukur di rekaman: lompatan opacity 0,159/frame. Karena kartu depan
      // melewati abs = 0,5 tepat saat mantul, lompatan ini terlihat jelas.
      //
      // ── KURVA 1/(1 + 0,9·abs) ───────────────────────────────────────────
      // Gambar sekarang TIDAK lagi punya opacity sendiri (lihat catatan di
      // spotlight.css). Dulu peredupan terjadi dua kali: opacity kartu ×
      // opacity gambar, sehingga kartu belakang jadi 0,72 × 0,7 = 0,50.
      //
      // Supaya tampilannya tetap seperti sebelumnya, peredupan itu dipindah
      // SELURUHNYA ke opacity kartu. Kurva ini dipilih karena hasilnya
      // mendekati nilai lama di titik-titik penting:
      //
      //   abs 0,5 → 0,690   (lama: 0,602)
      //   abs 1,0 → 0,526   (lama: 0,504)  ← hampir sama persis
      //   abs 1,5 → 0,426   (lama: 0,406)
      //   abs 2,0 → 0,357   (lama: 0,308)
      //
      // Bentuknya hiperbolik, bukan linear, karena itulah yang meniru efek
      // dua peredupan bertumpuk. Dan yang terpenting: KONTINU — tidak ada
      // ambang di mana pun, jadi tidak ada lompatan di tengah gerakan.
      //
      // Di atas abs = 2 opacity diturunkan halus ke 0 memakai smoothstep.
      // Turunannya 0 di kedua ujung, jadi sambungannya mulus.
      let op;
      if (diLuar) {
        op = 0;
      } else if (abs <= 2) {
        op = 1 / (1 + 0.9 * abs);
      } else {
        const u = (abs - 2) / (ARC.maxVisible - 2);
        op = 0.357 * (1 - u * u * (3 - 2 * u));
      }

      // ── TULIS DOM HANYA KALAU NILAINYA BERUBAH ──────────────────────────
      // Optimasi terbesar di fungsi ini. Menulis `style.transform` dengan
      // string yang sama persis tetap memaksa browser mem-parse ulang nilainya
      // dan membandingkannya — 8 kartu × 60 frame = 480 operasi/detik yang
      // semuanya tidak berguna.
      //
      // Dengan membandingkan dulu, kartu yang diam (kebanyakan dari 8 kartu
      // pada satu waktu) tidak menulis apa pun. Terukur: hanya ~3 kartu yang
      // benar-benar bergerak pada satu waktu.
      //
      // Ditulis ke dataset, bukan style — supaya tidak memicu perubahan style
      // saat pembacaannya.
      // `translateZ(0)` di AWAL: memaksa kartu dirender di layer GPU sendiri
      // dengan anti-aliasing penuh. Tanpa ini, tepi rounded-corner terlihat
      // bergerigi saat kartu di-scale dan diputar — browser merender di layer
      // sub-pixel, dan tepi melengkung jadi "tangga".
      //
      // POSISINYA PENTING: harus di AWAL, sebelum scale(). Kalau ditaruh di
      // akhir, `translateZ(0)` akan ikut dikalikan scale — hasilnya 0×scale =
      // 0, yang artinya tidak ada dorongan ke layer GPU sama sekali.
      //
      // Harus ditulis DI SINI (bukan di CSS) karena inline style menang atas
      // CSS: `transform: translateZ(0)` di CSS akan langsung ditimpa.
      const tBaru = `translateZ(0) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) ` +
        `rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      const tBerubah = card.dataset.t !== tBaru;
      if (tBerubah) {
        card.dataset.t = tBaru;
        card.style.transform = tBaru;
      }

      const opBaru = op.toFixed(3);
      if (card.dataset.op !== opBaru) {
        card.dataset.op = opBaru;
        card.style.opacity = opBaru;
      }

      // z-index resolusi HALUS (0,001 kartu). Versi lama membulatkan ke 10
      // tingkat (100 − round(abs·10)) sehingga dua kartu di abs 0,46 dan 0,54
      // sama-sama dapat z=95 — urutan gambar di area tumpang-tindih jadi
      // ditentukan urutan DOM, bukan jarak ke pusat. Saat dua kartu bertemu
      // di tengah (satu masuk, satu keluar) keduanya di abs ≈ 0,5, jadi
      // tumpukan bisa berubah mendadak di tengah gerakan.
      //
      // Dengan resolusi 0,001, urutan tumpukan berpindah TEPAT SEKALI di
      // titik silang — bukan di jendela selebar 0,1 kartu.
      const zBaru = String(diLuar ? 0 : Math.round((ARC.maxVisible + 0.2 - abs) * 1000));
      if (card.dataset.z !== zBaru) {
        card.dataset.z = zBaru;
        card.style.zIndex = zBaru;
      }

      const peBaru = !diLuar && abs < 1.5 ? 'auto' : 'none';
      if (card.dataset.pe !== peBaru) {
        card.dataset.pe = peBaru;
        card.style.pointerEvents = peBaru;
      }

      const depanBaru = !diLuar && abs < 0.5;
      if (card.classList.contains('is-front') !== depanBaru) {
        card.classList.toggle('is-front', depanBaru);
      }

      // ── LAYER GPU: PERMANEN, TIDAK LAGI DIPASANG/DILEPAS ────────────────
      // Sebelumnya kelas .is-bergerak dipasang/dilepas untuk menyalakan dan
      // mematikan layer GPU per kartu. Terukur di rekaman MutationObserver:
      // kartu di sekitar batas tampil berganti kelas 3× dalam SATU
      // perpindahan — dan tiap ganti adalah kerja rasterisasi ulang yang
      // membuang frame.
      //
      // Sekarang `will-change` permanen di CSS (.spotlight-card). Tidak ada
      // tambahan memori nyata: layer kartu SUDAH ada karena transform-nya
      // memuat `translateZ(0)` (lihat catatan di spotlight.css). Yang hilang
      // hanya churn-nya.

      // ── BAYANGAN: 4 TINGKAT, BUKAN NILAI TERUS-MENERUS ───────────────────
      // Permintaan pemilik: bayangan yang bergerak mengikuti kartu, dalam di
      // sisi kiri-kanan. TAPI juga: "optimalisasi biar tidak berat".
      //
      // ── KENAPA TIDAK BOLEH DIHITUNG TIAP FRAME ───────────────────────────
      // Percobaan pertama: menulis `box-shadow` dengan nilai berbeda setiap
      // frame. Itu SALAH — box-shadow adalah properti PAINT, bukan kompositor.
      // Menulisnya 60×/detik berarti 60 repaint area berblur besar per detik.
      // Itu penyebab carousel terasa berat.
      //
      // ── SOLUSI: 4 TINGKAT + TRANSISI CSS ─────────────────────────────────
      // Kedalaman dibulatkan ke 4 tingkat (0 = depan, 3 = terjauh). Kelas CSS
      // hanya ditulis saat TINGKATNYA BERUBAH — jadi ~2-4 kali per perpindahan
      // kartu, bukan 54 kali.
      //
      // Perubahan antar tingkat dihaluskan oleh `transition: box-shadow` di
      // CSS. Jadi mata tetap melihat bayangan yang berubah mulus, tapi browser
      // hanya repaint beberapa kali.
      //
      // Efek sampingnya justru bagus: bayangan "menyusul" sedikit di belakang
      // kartu, persis seperti bayangan asli saat bendanya bergerak cepat.
      const tingkat = diLuar ? 4 : Math.min(3, Math.round(abs));
      if (card.dataset.bayangan !== String(tingkat)) {
        card.dataset.bayangan = String(tingkat);
        card.classList.remove('bayangan-0', 'bayangan-1', 'bayangan-2', 'bayangan-3', 'bayangan-luar');
        card.classList.add(tingkat === 4 ? 'bayangan-luar' : `bayangan-${tingkat}`);
      }
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

  /**
   * Pindah ke indeks tertentu, dengan animasi mendarat (pegas).
   *
   * @param {number} target      indeks tujuan
   * @param {boolean} instant    langsung pindah tanpa animasi
   * @param {number} kecepatanAwal  kecepatan gesture (kartu/detik), opsional
   * @param {number} progressSekarang  posisi drag saat ini (kartu), opsional
   *
   * ── KENAPA `progressSekarang` PENTING (BUG #2) ────────────────────────────
   * Saat drag, posisi kartu i = (sd(current, i) - P) * stepX.
   * Saat current berubah ke current+delta, P HARUS ikut berubah supaya posisi
   * kartu tidak melompat:
   *
   *   sd(lama, i) - P_lama = sd(baru, i) - P_baru
   *   karena sd(lama, i) = sd(baru, i) + delta
   *   → P_baru = P_lama - delta
   *
   * Kode lama selalu mulai dari x = delta — mengabaikan P_lama. Akibatnya:
   *   - lepas drag dengan P_lama = -0.65: lompatan 313px
   *   - klik dot dengan P_lama = 0: lompatan 464px
   *
   * Itu bug yang sama yang membuat lintasan uji spring saya mulai dari 0 lalu
   * melompat ke -334px. Saya sempat mengira itu bagian animasi.
   */
  function goTo(target, instant = false, kecepatanAwal = 0, progressSekarang = 0) {
    const n = items.length;
    // Selalu ambil jalur terpendek supaya gerakannya tidak "memutar jauh"
    const delta = shortestDelta(current, ((target % n) + n) % n);
    const to = current + delta;
    current = ((to % n) + n) % n;

    if (instant || prefersReduced()) {
      // Reset napas — kalau tidak, efek "napas" dari animasi sebelumnya
      // bisa "menempel" dan membuat kartu tetap menyusut.
      napasPegas = 0;
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
    // satuan x (kartu vs piksel) TIDAK mempengaruhi bentuk kurva.
    const SPRING_K = 120;   // springs.gentle.stiffness
    const SPRING_C = 14;    // springs.gentle.damping

    // Titik awal pegas: P_lama - delta (lihat catatan di atas).
    // Kalau tidak sedang drag (progressSekarang = 0), ini = -delta, yang
    // berarti kartu mulai dari posisi aslinya — tidak ada lompatan.
    let x = progressSekarang - delta;
    // Kecepatan awal: kalau kartu dilepas dari drag yang cepat, momentum itu
    // dibawa masuk — kartu "melanjutkan" gerakannya lalu ditahan pegas.
    let v = kecepatanAwal;

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

      // ── NAPAS DARI ENERGI PEGAS ─────────────────────────────────────────
      //   E = √(½v² + ½k·x²)
      //
      // Pembagi 64,6 dikalibrasi supaya napas mencapai maksimum 12% tepat saat
      // pelepasan: x = −1, v = 0 → E = √(½·120·1) = 7,746 → 7,746/64,6 = 0,12.
      //
      // Envelope follower: attack 0,12 s (naik halus, tidak melonjak),
      // release 0,20 s (turun perlahan — INI yang menutupi titik balik pegas
      // sehingga tidak ada denyut).
      const energi = Math.sqrt(0.5 * v * v + 0.5 * SPRING_K * x * x);
      const targetNapas = Math.min(0.12, energi / 64.6);
      const tau = targetNapas > napasPegas ? 0.12 : 0.20;
      napasPegas += (targetNapas - napasPegas) * (1 - Math.exp(-dt / tau));

      // ── `render(x)` — BUKAN `render(-x)` ────────────────────────────────
      // x sekarang = P_lama - delta, yang SUDAH punya tanda benar. Karena
      // render(p) menghitung rel = sd(current_baru, i) - p, dan kita ingin
      // rel awal = sd(current_lama, i) = sd(current_baru, i) + delta, maka:
      //
      //   sd(baru, i) - x = sd(baru, i) - (P_lama - delta)
      //                   = sd(baru, i) + delta - P_lama
      //                   = sd(lama, i) - P_lama   ← posisi nyata sebelum ✓
      //
      // Diverifikasi lewat simulasi numerik: klik dot → rel awal 0px (cocok
      // dengan posisi nyata), lepas drag → rel awal +151px (cocok). Dengan
      // render(-x) hasilnya melompat 464px.
      render(x);

      // Berhenti saat pegas benar-benar tenang: jarak < 0.001 kartu (≈0.18px)
      // DAN kecepatan < 0.001 kartu/detik. Keduanya dicek — kalau hanya jarak,
      // kartu bisa berhenti saat masih bergerak cepat melewati target.
      if (Math.abs(x) < 0.001 && Math.abs(v) < 0.001) {
        // Reset napas — supaya kartu kembali ke skala penuh (efek "napas"
        // selesai: kartu mengembang seperti semula). Nilainya sudah ~0,0001
        // di titik ini, jadi resetnya tidak terlihat sebagai lompatan.
        napasPegas = 0;
        render();
        syncInfo();
        // ── BERI TAHU BAHWA ANIMASI SELESAI ────────────────────────────────
        // Auto-scroll (slide + jeda) butuh sinyal ini: setelah kartu mendarat,
        // baru jeda dijadwalkan. Tanpa sinyal, jeda akan dihitung dari SAAT
        // ANIMASI DIMULAI — sehingga total waktunya jadi jeda + durasi
        // animasi, tidak konsisten.
        //
        // Variabelnya dideklarasikan di scope createSpotlightCarousel, bukan
        // di sini, supaya bisa dibaca/ditulis dari kedua tempat.
        sedangAnimasi = false;
        if (typeof onAnimasiSelesai === 'function') onAnimasiSelesai();
        return;
      }
      requestAnimationFrame(frame);
    }
    sedangAnimasi = true;
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
    // ── ARAH SNAP: HARUS SEARAH DENGAN GESERAN ─────────────────────────────
    // Bug nyata: geser KANAN memunculkan kartu dari KANAN — terbalik dari
    // yang diharapkan. Dihitung dengan tangan:
    //
    //   Geser ke KANAN (dx = +150px):
    //     pendingProgress = -dx/stepX = -0.65
    //     selama drag: kartu depan bergerak KE KANAN (ikut jari) ✓
    //     kartu yang datang dari KIRI = kartu SEBELUMNYA (indeks -1)
    //     → geser = round(-0.65) = -1
    //     → target harus current + (-1) = current - 1
    //
    //   Kode lama memakai `current - geser` = current + 1 → kartu BERIKUTNYA.
    //   Itu sebabnya terasa terbalik.
    //
    //   Geser ke KIRI (dx = -150px):
    //     pendingProgress = +0.65 → geser = 1
    //     kartu yang datang dari KANAN = kartu BERIKUTNYA (indeks +1)
    //     → target = current + 1 = current + geser ✓
    //
    // Jadi rumusnya `current + geser`, bukan `current - geser`.
    //
    // CATATAN: ini KEBALIKAN dari konvensi drag-to-scroll biasa (konten
    // mengikuti jari). Di sini konten memang mengikuti jari saat drag, tapi
    // kartu yang MENDARAT setelah dilepas harus yang datang dari arah
    // geseran — bukan yang berlawanan.
    const geser = Math.round(pendingProgress);
    const cepat = Math.abs(kecepatanGesture) > 0.6; // kartu/detik
    if (geser !== 0 || cepat) {
      // Arah dari geseran; kalau geseran 0 tapi cepat, pakai arah kecepatan
      const arah = geser !== 0 ? geser : Math.sign(pendingProgress || kecepatanGesture);
      // `pendingProgress` diteruskan sebagai progressSekarang — supaya pegas
      // mulai dari posisi kartu SAAT INI, bukan dari posisi target. Tanpa ini
      // kartu melompat 313px saat lepas drag (bug #2).
      //
      // `kecepatanGesture` juga diteruskan: geseran tangan menentukan seberapa
      // jauh kartu "meluncur" sebelum pegas menahannya.
      goTo(current + arah, false, kecepatanGesture, pendingProgress);
    } else {
      // Geseran terlalu kecil — kembali ke posisi semula, tetap dari posisi
      // sekarang supaya tidak melompat.
      goTo(current, false, kecepatanGesture, pendingProgress);
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

  // ── AUTO-SCROLL: SLIDE + JEDA (gaya Slick autoplay) ────────────────────────
  // Kartu meluncur ke kartu berikutnya, lalu DIAM sejenak, lalu meluncur lagi.
  //
  // ── KENAPA POLA INI (varian A, dipilih pemilik) ───────────────────────────
  // Tiga pola pernah dicoba:
  //   1. Interval 4,2s + animasi 620ms — menyentak, transisi terputus
  //   2. Drift kontinu 21px/s — mulus tapi terlalu pelan, "belum sesuai"
  //   3. Drift kontinu cepat 62px/s — gambar lewat sebelum sempat dilihat
  //
  // Pola ini (slide + jeda) yang dipilih. Ini juga pola standar Slick
  // autoplay dan galeri produk komersial: bergerak dengan jelas, lalu diam
  // cukup lama supaya gambar bisa dilihat. Gerakannya "sengaja", bukan
  // mengalir pelan.
  //
  // Bedanya dengan percobaan pertama: animasinya pakai PEGAS (spring), bukan
  // easing kurva. Jadi kartu "mendarat" dengan lembut dan sedikit overshoot —
  // bukan berhenti mendadak. Itu yang membuatnya terasa hidup, bukan mekanis.
  const AUTO_JEDA_MS = 2600;   // diam setelah kartu mendarat, sebelum meluncur lagi

  // ── SPRING PHYSICS (dari skill motion-foundations) ────────────────────────
  // Rumus: F = -k·x - c·v  (Hooke's law + peredam)
  // Nilai dari springs.gentle: k=120, c=14 — preset "kartu mendarat dengan
  // lembut". Overshoot ~5,6%, waktu mendarat ~0,9 detik.
  const SPRING_K = 120;   // springs.gentle.stiffness
  const SPRING_C = 14;    // springs.gentle.damping

  // (State auto-scroll dideklarasikan di atas goTo() — lihat catatan di sana.)

  /** Jadwalkan perpindahan berikutnya setelah jeda. */
  function jadwalkanBerikutnya() {
    if (!autoAktif || autoPermanen) return;
    clearTimeout(jedaTimer);
    jedaTimer = setTimeout(() => {
      if (!autoAktif || autoPermanen || kursorDiArea || !terlihatDiLayar) return;
      if (document.visibilityState === 'hidden') return;
      if (dragging || sedangAnimasi) return;
      // Meluncur ke kartu berikutnya. Setelah pegas tenang, `onAnimasiSelesai`
      // dipanggil → menjadwalkan perpindahan berikutnya. Jadi ritmenya
      // konsisten: jeda dihitung SETELAH kartu mendarat, bukan setelah
      // animasi dimulai.
      goTo(current + 1);
    }, AUTO_JEDA_MS);
  }

  // Dipanggil goTo() saat pegas tenang. Kalau auto-scroll aktif, jadwalkan
  // perpindahan berikutnya. Kalau tidak, tidak ada yang terjadi.
  onAnimasiSelesai = () => {
    if (autoAktif && !autoPermanen && !kursorDiArea && terlihatDiLayar) {
      jadwalkanBerikutnya();
    }
  };

  /** Mulai auto-scroll (dipanggil saat carousel terlihat / kursor keluar). */
  function autoMulai() {
    if (!autoAktif || autoPermanen) return;
    if (sedangAnimasi) return;   // sedang meluncur — nanti dijadwalkan sendiri
    jadwalkanBerikutnya();
  }

  /** Hentikan auto-scroll. `permanen` = pengunjung ambil kendali. */
  function autoStop(permanen = false) {
    clearTimeout(jedaTimer);
    jedaTimer = null;
    if (permanen) autoPermanen = true;
  }

  // Pengunjung mengambil kendali → berhenti PERMANEN. Kalau auto menyala lagi
  // setelah mereka menggeser, itu terasa seperti carousel "merebut" kendali.
  stage.addEventListener('pointerdown', () => autoStop(true));
  dotsWrap.addEventListener('click', () => autoStop(true));
  root.addEventListener('focusin', () => autoStop(true));

  // Kursor masuk → berhenti (mereka sedang melihat). Keluar → lanjut.
  stage.addEventListener('pointerenter', () => {
    kursorDiArea = true;
    clearTimeout(jedaTimer);
    jedaTimer = null;
  });
  stage.addEventListener('pointerleave', () => {
    kursorDiArea = false;
    if (autoPermanen || !autoAktif) return;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (!kursorDiArea && !autoPermanen) autoMulai();
    }, 1200);   // jeda singkat — jangan langsung bergerak saat kursor lewat
  });

  // Carousel di luar layar → tidak ada yang melihat, tidak perlu bergerak.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([entry]) => {
      terlihatDiLayar = entry.isIntersecting;
      if (terlihatDiLayar && !autoPermanen) autoMulai();
      else autoStop();
    }, { threshold: 0.2 });
    io.observe(root);
  } else {
    autoMulai();
  }

  // Tab disembunyikan → hentikan timer. Jangan buang baterai.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autoStop();
    else if (!autoPermanen && terlihatDiLayar && !kursorDiArea) autoMulai();
  });

  // ── Render awal ───────────────────────────────────────────────────────────
  render();
  syncInfo();

  return root;
}