/**
 * Media loader — gambar galeri dari backend, dengan holding state & live update.
 *
 * ── PERUBAHAN BESAR DARI VERSI SEBELUMNYA ───────────────────────────────────
 *
 * 1. GAMBAR BAWAAN DIHAPUS
 *    Versi lama punya map BAWAAN berisi 8 JPG lokal sebagai cadangan. Itu
 *    dihapus atas permintaan pemilik: kartu yang belum punya gambar harus
 *    tampil sebagai HOLDING STATE yang disengaja — bukan gambar contoh yang
 *    tidak berhubungan dengan proyeknya.
 *
 *    Alasannya kuat: gambar contoh di kartu proyek itu menyesatkan. Pengunjung
 *    melihat gambar yang tidak mewakili apa pun, dan pemilik tidak punya
 *    dorongan untuk mengunggah gambar sungguhan. Holding state yang rapi
 *    justru jujur: "gambar menyusul".
 *
 * 2. LIVE UPDATE
 *    Admin bisa mengunggah gambar kapan saja. Halaman yang sedang terbuka
 *    TIDAK perlu di-reload — modul ini memeriksa manifest secara berkala dan
 *    memasang gambar baru ke kartu yang cocok.
 *
 *    Pemeriksaan hanya jalan saat tab terlihat, dan berhenti setelah beberapa
 *    menit tanpa perubahan. Alasannya: galeri statis tidak perlu polling
 *    selamanya — itu memboroskan baterai tanpa manfaat.
 *
 * 3. HOLDING STATE
 *    Kartu tanpa gambar menampilkan: gradien aksen halus + monogram proyek +
 *    indikator "menunggu gambar". Bukan kotak hitam, bukan ikon rusak.
 */

/**
 * Alamat API.
 *
 * ── KENAPA ABSOLUT, BUKAN RELATIF ───────────────────────────────────────────
 * Situs disajikan dari Cloudflare Pages, sementara /api hanya ada di Worker.
 * Pages Function (functions/[[path]].js) mem-proxy /api/* dan /media/* ke
 * Worker, jadi permintaan RELATIF sebenarnya sudah bekerja.
 *
 * Tetap dipakai absolut sebagai lapis pertama karena: saat halaman dibuka dari
 * preview deployment atau file lokal (uji), proxy itu belum tentu ada. Kalau
 * relatif gagal, absolut dicoba — dua jalur, satu hasil.
 *
 * `window.__API_BASE__` diperiksa lebih dulu supaya preview bisa menunjuk
 * backend berbeda tanpa mengubah berkas ini.
 */
const API_ABSOLUT = (typeof window !== 'undefined' && window.__API_BASE__)
  ? String(window.__API_BASE__).replace(/\/$/, '')
  : 'https://portfolio-victer.victerphanjaya.workers.dev';

/**
 * Pemilih acak deterministik — xorshift32.
 *
 * Kenapa bukan Math.random(): kita butuh urutan yang SAMA setiap kali dipanggil
 * dengan seed yang sama, supaya gambar tidak berganti di tengah sesi.
 * Math.random() tidak bisa di-seed, jadi tidak bisa dijamin stabil.
 */
function buatAcak(seed) {
  let x = seed | 0;
  if (x === 0) x = 0x9e3779b9;   // seed 0 akan macet; ganti dengan konstanta
  return () => {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    return (x >>> 0) / 4294967296;
  };
}

/**
 * Ambil manifest dari backend.
 *
 * Timeout 4 detik: lebih baik lanjut dengan holding state daripada membuat
 * pengunjung menunggu galeri kosong. Galeri adalah bagian visual utama.
 *
 * Tidak pernah melempar. Kegagalan apa pun → null.
 */
export async function ambilManifest({ timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Coba jalur relatif dulu (proxy Pages Function). Kalau gagal — mis. saat
    // halaman dibuka dari file:// atau preview tanpa proxy — coba absolut.
    const jalur = ['/api/media/manifest', `${API_ABSOLUT}/api/media/manifest`];
    for (const url of jalur) {
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        // `aktif: false` berarti penyimpanan belum dikonfigurasi — itu bukan
        // kegagalan jaringan, tapi juga tidak ada gambar. Perlakukan sama:
        // kembalikan null supaya pemanggil memakai holding state.
        if (!data || !data.ok || !data.aktif) return null;
        if (!Array.isArray(data.images) || data.images.length === 0) return null;
        return data;
      } catch {
        // Coba jalur berikutnya. AbortError juga tertangkap di sini —
        // kalau timeout, kedua jalur gagal dan kita kembalikan null.
        if (ctrl.signal.aborted) break;
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Susun peta gambar untuk sekumpulan proyek.
 *
 * Aturan pemilihan:
 *   1. Proyek punya gambar sendiri di manifest (slug/label cocok) → pakai itu
 *   2. Belum punya → pilih ACAK dari gambar yang ada di manifest
 *   3. Manifest kosong/tidak ada → TIDAK ADA entri (kartu jadi holding state)
 *
 * Poin 3 adalah perubahan perilaku: versi lama memakai gambar bawaan lokal.
 * Sekarang tidak ada cadangan — kartu yang belum punya gambar tampil sebagai
 * holding state yang disengaja.
 *
 * @param {Array<{name: string}>} proyek
 * @param {object|null} manifest  hasil ambilManifest(), boleh null
 * @returns {Map<string, {url: string, lqip: string|null}>}
 */
export function susunGambar(proyek, manifest) {
  const peta = new Map();
  if (!manifest || !manifest.images?.length) return peta;

  // Indeks berdasarkan slug yang dinormalkan, supaya "MINA Terminal" di
  // manifest tetap cocok dengan "MINA" di data proyek — pencocokan longgar
  // lebih berguna di sini daripada pencocokan persis.
  const normal = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const perSlug = new Map();
  for (const img of manifest.images) {
    perSlug.set(normal(img.slug), img);
    // Daftarkan juga versi label-nya — admin mungkin menamai gambar dengan
    // label yang lebih deskriptif daripada slug proyeknya.
    if (img.label) perSlug.set(normal(img.label), img);
  }

  const acak = buatAcak(Date.now() & 0x7fffffff);
  const kumpulan = manifest.images;

  for (const p of proyek) {
    const cocok = perSlug.get(normal(p.name));
    if (cocok) {
      peta.set(p.name, {
        url: cocok.url, lqip: cocok.lqip ?? null,
        lebar: cocok.lebar, tinggi: cocok.tinggi,
        slug: cocok.slug,
      });
      continue;
    }
    // Belum punya gambar sendiri → ambil acak dari kumpulan.
    const pilihan = kumpulan[Math.floor(acak() * kumpulan.length)];
    if (pilihan) {
      peta.set(p.name, {
        url: pilihan.url, lqip: pilihan.lqip ?? null,
        lebar: pilihan.lebar, tinggi: pilihan.tinggi,
        slug: pilihan.slug,
      });
    }
    // Kalau kumpulan kosong, tidak ada entri → kartu jadi holding state.
  }

  return peta;
}

/**
 * Pasang gambar ke elemen <img> dengan skeleton dan LQIP.
 *
 * Urutan yang terjadi saat gambar dimuat:
 *   1. Skeleton shimmer tampil (kelas .is-memuat)
 *   2. LQIP dipasang sebagai background — warna & bentuk kasar langsung terlihat
 *   3. Gambar asli diunduh; saat selesai, skeleton dilepas dan LQIP memudar
 *
 * Kalau gambar GAGAL dimuat, kelas .is-gagal dipasang — CSS menampilkan
 * holding state, bukan ikon gambar rusak.
 */
export function pasangGambar(img, { url, lqip }) {
  const media = img.closest('.spotlight-card-media');
  if (!media) return;

  // Kalau URL-nya sama dengan yang sedang tampil, tidak ada yang perlu
  // dilakukan. Ini penting untuk live update: pemeriksaan berkala tidak boleh
  // memicu kedipan pada kartu yang gambarnya tidak berubah.
  if (media.dataset.url === url && media.classList.contains('is-siap')) return;
  media.dataset.url = url;

  if (lqip) {
    // background-size: cover — LQIP 28px diperbesar mengisi seluruh kartu.
    // Karena sudah diburamkan saat dibuat, diperbesar tidak terlihat pecah.
    media.style.backgroundImage = `url("${lqip}")`;
    media.style.backgroundSize = 'cover';
    media.style.backgroundPosition = 'center';
    media.classList.add('punya-lqip');
  } else {
    media.style.backgroundImage = '';
    media.classList.remove('punya-lqip');
  }

  // Lepas status lama — gambar baru dimulai dari nol.
  media.classList.remove('is-siap', 'is-gagal');
  media.classList.add('is-memuat');

  img.addEventListener('load', () => {
    media.classList.remove('is-memuat');
    media.classList.add('is-siap');
  }, { once: true });

  img.addEventListener('error', () => {
    media.classList.remove('is-memuat');
    media.classList.add('is-gagal');
  }, { once: true });

  img.src = url;
}

/**
 * Siapkan kartu untuk HOLDING STATE — belum ada gambar sama sekali.
 *
 * Dipanggil untuk kartu yang tidak dapat entri dari susunGambar(). Menyiapkan
 * monogram dan menandai kartu supaya CSS menampilkan holding yang rapi.
 *
 * Kartu TIDAK dihapus atau disembunyikan: ia tetap bagian dari deretan, tetap
 * bisa digeser, tetap punya judul. Yang belum ada hanya gambarnya.
 */
export function pasangHolding(media, { monogram }) {
  if (!media) return;
  media.classList.add('is-holding');
  media.dataset.monogram = monogram ?? '·';
  // Hapus <img> kalau ada — holding state murni CSS, tidak butuh elemen gambar
  // yang menunggu src yang tidak akan datang.
  const img = media.querySelector('img');
  if (img) img.remove();
}

/**
 * Pemeriksa perubahan manifest — untuk LIVE UPDATE.
 *
 * ── CARA KERJA ──────────────────────────────────────────────────────────────
 * Memeriksa manifest secara berkala (default 20 detik). Kalau `updatedAt`
 * berubah, panggil callback supaya galeri memasang gambar baru.
 *
 * ── KENAPA BERKALA, BUKAN WEBSOCKET ─────────────────────────────────────────
 * WebSocket berarti koneksi terbuka terus-menerus + server harus mengelola
 * daftar klien. Untuk kasus ini (admin mengunggah gambar beberapa kali sehari),
 * itu infrastruktur berlebihan.
 *
 * Pemeriksaan 20 detik dengan respons ~1 KB jauh lebih murah: ~3 KB/menit
 * hanya saat tab terlihat, dan nol saat tab disembunyikan.
 *
 * ── KAPAN BERHENTI ──────────────────────────────────────────────────────────
 *   1. Tab disembunyikan → dijeda (tidak memboroskan baterai)
 *   2. Setelah `maksPemeriksaan` kali tanpa perubahan → berhenti total
 *   3. Pemanggil memanggil fungsi berhenti yang dikembalikan
 *
 * Pemeriksaan hanya mengunduh HEAD-like JSON kecil, bukan gambar. Gambar baru
 * hanya diunduh kalau memang ada.
 *
 * @returns {() => void} fungsi untuk menghentikan pemeriksaan
 */
export function pantauPerubahan(onBerubah, {
  intervalMs = 20000,
  maksPemeriksaan = 15,   // 15 × 20s = 5 menit tanpa perubahan → berhenti
} = {}) {
  let terakhir = null;      // updatedAt terakhir yang diketahui
  let jalan = 0;
  let timer = null;
  let berhenti = false;

  async function periksa() {
    if (berhenti) return;
    // Tab disembunyikan → lewati pemeriksaan ini, jadwalkan berikutnya.
    // Tidak dihentikan total: pengunjung mungkin kembali ke tab ini.
    if (document.visibilityState === 'hidden') return jadwalkan();

    try {
      const man = await ambilManifest({ timeoutMs: 6000 });
      const cap = man?.updatedAt ?? null;

      if (terakhir === null) {
        // Pemeriksaan pertama hanya mencatat keadaan — tidak memicu perubahan,
        // karena gambar yang ada sekarang sudah dipasang saat render awal.
        terakhir = cap;
      } else if (cap && cap !== terakhir) {
        terakhir = cap;
        jalan = 0;                     // ada perubahan → reset penghitung
        try { onBerubah(man); } catch { /* callback gagal tidak boleh menghentikan pemantauan */ }
      } else {
        jalan++;
        if (jalan >= maksPemeriksaan) {
          berhenti = true;
          return;
        }
      }
    } catch { /* jaringan gagal — coba lagi di jadwal berikutnya */ }

    jadwalkan();
  }

  function jadwalkan() {
    if (berhenti) return;
    clearTimeout(timer);
    timer = setTimeout(periksa, intervalMs);
  }

  // Mulai setelah jeda pertama, bukan langsung — render awal baru saja
  // memanggil manifest, tidak perlu memanggilnya dua kali.
  jadwalkan();

  return () => { berhenti = true; clearTimeout(timer); };
}
