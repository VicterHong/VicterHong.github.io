/**
 * Media loader — gambar galeri dari backend, dengan degradasi berlapis.
 *
 * ── MASALAH YANG DIPECAHKAN ─────────────────────────────────────────────────
 * Sebelumnya gambar di-hardcode di app.js (`VISUAL` map). Konsekuensinya:
 *   - Admin tidak bisa mengganti gambar tanpa mengubah kode
 *   - Proyek tanpa gambar tampil sebagai kotak kosong
 *   - Gambar dimuat tanpa placeholder → kartu berkedip abu-abu lalu muncul
 *
 * Sekarang gambar datang dari manifest di R2 (diunggah admin), dan modul ini
 * mengurus tiga hal: memuat daftarnya, memilih gambar, dan menandai status
 * supaya CSS bisa menampilkan skeleton yang tepat.
 *
 * ── TIGA LAPIS DEGRADASI ────────────────────────────────────────────────────
 * Situs ini TIDAK BOLEH rusak kalau backend mati. Jadi:
 *
 *   Lapis 1 — manifest tersedia:
 *             pakai gambar dari R2. Proyek yang punya gambar khusus memakai
 *             itu; yang belum punya dipilih ACAK dari kumpulan.
 *
 *   Lapis 2 — manifest gagal/kosong:
 *             pakai gambar bawaan di assets/spotlight/*.jpg (masih ada di
 *             repo). Galeri tetap tampil utuh.
 *
 *   Lapis 3 — tidak ada gambar sama sekali:
 *             kartu menampilkan placeholder "holding" — pola gradien halus
 *             dengan monogram. Bukan kotak hitam kosong.
 *
 * ── KENAPA "ACAK" TAPI DETERMINISTIK ────────────────────────────────────────
 * Pemilik minta gambar acak untuk proyek yang belum punya gambar sendiri.
 * Tapi kalau benar-benar acak tiap render, kartu akan BERGANTI GAMBAR saat
 * pengunjung menggeser — dan itu terlihat seperti bug, bukan variasi.
 *
 * Jadi: acak sekali per kunjungan (di-seed dari waktu muat), lalu STABIL
 * selama halaman terbuka. Hasilnya terasa bervariasi antar kunjungan tanpa
 * mengganggu selama satu kunjungan.
 */

/**
 * Alamat API.
 *
 * ── KENAPA ABSOLUT, BUKAN RELATIF ───────────────────────────────────────────
 * Situs disajikan dari Cloudflare Pages (portfolio-victer.pages.dev),
 * sementara endpoint /api hanya ada di Worker (portfolio-victer.victerphanjaya
 * .workers.dev). Pages TIDAK mem-proxy /api — jadi permintaan relatif
 * menghasilkan 404. Terukur: `GET /api/media/manifest` di pages.dev → 404,
 * di workers.dev → 200.
 *
 * Solusi jangka panjang: pasang Worker Route di domain sendiri supaya
 * endpoint relatif bekerja. Itu butuh zona DNS yang dikelola Cloudflare,
 * dan domain saat ini (victer.is-a.dev) belum aktif — PR-nya masih menunggu
 * maintainer. Sementara itu, endpoint absolut adalah satu-satunya cara yang
 * bekerja tanpa mengubah infrastruktur.
 *
 * ── KENAPA DIBUAT OVERRIDE-ABLE ─────────────────────────────────────────────
 * `window.__API_BASE__` diperiksa lebih dulu supaya preview deployment
 * (yang punya URL Worker berbeda) bisa menunjuk ke backend yang benar tanpa
 * mengubah berkas ini.
 */
const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__)
  ? String(window.__API_BASE__).replace(/\/$/, '')
  : 'https://portfolio-victer.victerphanjaya.workers.dev';

/** Gambar bawaan — dipakai kalau manifest tidak tersedia (Lapis 2). */
const BAWAAN = {
  MINA: 'assets/spotlight/mina-terminal.jpg',
  'Spareparts Inventory System': 'assets/spotlight/spareparts-shelf.jpg',
  'WhatsApp Family Assistant': 'assets/spotlight/portal-door.jpg',
  Monitoring: 'assets/spotlight/monitoring.jpg',
  'EFMS Fintech': 'assets/spotlight/efms.jpg',
  'Daftar Hadir': 'assets/spotlight/daftar.jpg',
  jsloop: 'assets/spotlight/jsloop.jpg',
  strktrdata: 'assets/spotlight/strktrdata.jpg',
};

/**
 * Pemilih acak deterministik — xorshift32.
 *
 * Kenapa bukan Math.random(): kita butuh urutan yang SAMA setiap kali
 * dipanggil dengan seed yang sama, supaya gambar tidak berganti di tengah
 * sesi. Math.random() tidak bisa di-seed, jadi tidak bisa dijamin stabil.
 *
 * xorshift32 dipilih karena: 4 operasi bitwise, tidak ada perkalian,
 * dan distribusinya cukup rata untuk memilih dari 8 item.
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
 * Timeout 4 detik: kalau backend lambat, lebih baik lanjut dengan gambar
 * bawaan daripada membuat pengunjung menunggu galeri kosong. Galeri adalah
 * bagian visual utama — menahannya demi daftar gambar adalah pertukaran
 * yang salah.
 *
 * Tidak pernah melempar. Kegagalan apa pun → null, dan pemanggil memakai
 * Lapis 2.
 */
export async function ambilManifest({ timeoutMs = 4000 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}/api/media/manifest`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.images) || data.images.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Susun daftar gambar untuk sekumpulan proyek.
 *
 * Aturan pemilihan:
 *   1. Proyek punya gambar sendiri di manifest (slug cocok) → pakai itu
 *   2. Belum punya → pilih ACAK dari gambar yang ada di manifest
 *   3. Manifest tidak ada → pakai gambar bawaan
 *   4. Tidak ada sama sekali → kosong (kartu jadi placeholder)
 *
 * @param {Array<{name: string}>} proyek
 * @param {object|null} manifest  hasil ambilManifest(), boleh null
 * @returns {Map<string, {url: string, lqip: string|null}>}
 */
export function susunGambar(proyek, manifest) {
  const peta = new Map();

  // ── LAPIS 2: tidak ada manifest → gambar bawaan ──────────────────────────
  if (!manifest) {
    for (const p of proyek) {
      const bawaan = BAWAAN[p.name];
      if (bawaan) peta.set(p.name, { url: bawaan, lqip: null });
    }
    return peta;
  }

  // ── LAPIS 1: ada manifest ────────────────────────────────────────────────
  // Indeks berdasarkan slug yang dinormalkan, supaya "MINA Terminal" di
  // manifest tetap cocok dengan "MINA" di data proyek — pencocokan longgar
  // lebih berguna di sini daripada pencocokan persis.
  const normal = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const perSlug = new Map();
  for (const img of manifest.images) {
    perSlug.set(normal(img.slug), img);
    // Daftarkan juga versi label-nya — admin mungkin menamai gambar dengan
    // label yang lebih deskriptif daripada slug proyeknya.
    perSlug.set(normal(img.label), img);
  }

  const acak = buatAcak(Date.now() & 0x7fffffff);
  const kumpulan = manifest.images;

  for (const p of proyek) {
    const cocok = perSlug.get(normal(p.name));
    if (cocok) {
      peta.set(p.name, { url: cocok.url, lqip: cocok.lqip ?? null });
      continue;
    }
    // Belum punya gambar sendiri → ambil acak dari kumpulan.
    const pilihan = kumpulan[Math.floor(acak() * kumpulan.length)];
    if (pilihan) {
      peta.set(p.name, { url: pilihan.url, lqip: pilihan.lqip ?? null });
    } else {
      const bawaan = BAWAAN[p.name];
      if (bawaan) peta.set(p.name, { url: bawaan, lqip: null });
    }
  }

  return peta;
}

/**
 * Pasang gambar ke elemen <img> dengan skeleton dan LQIP.
 *
 * Urutan yang terjadi saat gambar dimuat:
 *   1. Skeleton shimmer tampil (dari CSS, kelas .is-memuat)
 *   2. LQIP dipasang sebagai background — warna & bentuk kasar langsung terlihat
 *   3. Gambar asli diunduh; saat selesai, skeleton dilepas dan LQIP memudar
 *
 * Hasilnya: tidak pernah ada kotak abu-abu kosong. Yang pertama terlihat
 * selalu sesuatu yang menyerupai gambar akhirnya.
 *
 * Kalau gambar GAGAL dimuat, kelas .is-gagal dipasang — CSS menampilkan
 * placeholder "holding", bukan ikon gambar rusak.
 */
export function pasangGambar(img, { url, lqip }) {
  const media = img.closest('.spotlight-card-media');
  if (!media) return;

  if (lqip) {
    // background-size: cover — LQIP 28px diperbesar mengisi seluruh kartu.
    // Karena sudah diburamkan saat dibuat, diperbesar tidak terlihat pecah.
    media.style.backgroundImage = `url("${lqip}")`;
    media.style.backgroundSize = 'cover';
    media.style.backgroundPosition = 'center';
    media.classList.add('punya-lqip');
  }

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
