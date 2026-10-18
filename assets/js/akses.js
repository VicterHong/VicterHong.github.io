/**
 * Gerbang akses — satu sumber kebenaran untuk "apa yang boleh dilihat".
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA MODUL TERPISAH
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Ada empat tempat di halaman yang perlu tahu status akses: kartu proyek,
 * seksi metrik, sandbox demo, dan diagram arsitektur. Kalau masing-masing
 * memanggil /api/akses sendiri, halaman mengirim empat permintaan identik dan
 * bisa berakhir dengan empat jawaban berbeda (satu sudah login, tiga belum,
 * karena balapan). Satu permintaan, satu hasil, dibagikan.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA GAGAL-TERTUTUP
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Kalau /api/akses gagal (backend mati, jaringan putus, timeout), modul ini
 * mengembalikan status "belum masuk". Artinya: pengunjung melihat versi
 * terkunci, BUKAN versi penuh. Arah kegagalannya sengaja dipilih — backend
 * mati tidak boleh berubah menjadi kebocoran data.
 *
 * Sebaliknya untuk pengguna yang SUDAH login: kegagalan jaringan membuat
 * mereka melihat versi terkunci sampai refresh berhasil. Itu mengganggu,
 * tapi jauh lebih baik daripada membuka data berbayar karena satu timeout.
 */

const CACHE_KEY = 'akses_cache';
const CACHE_TTL_MS = 60_000;

/** Status default: terkunci penuh. Dipakai saat fetch gagal. */
function statusTerkunci(alasan = 'belum_masuk') {
  return {
    masuk: false,
    paket: null,
    berbayar: false,
    total: null,
    terpakai: 0,
    sisa: null,
    sudahStar: false,
    bonusStarTersedia: 0,
    proyekTerbuka: [],
    alasan,
  };
}

let _cache = null;
let _cacheAt = 0;
let _janji = null;

/**
 * Ambil status akses. Aman dipanggil berkali-kali — hasil pertama dibagikan.
 * @returns {Promise<object>}
 */
export function ambilAkses({ paksa = false } = {}) {
  // Cache pendek: satu kunjungan hanya perlu satu permintaan. 60 detik cukup
  // singkat sehingga login/logout langsung terasa setelah refresh.
  if (!paksa && _cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return Promise.resolve(_cache);
  }
  if (_janji) return _janji;

  _janji = (async () => {
    try {
      const res = await fetch('/api/akses', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return statusTerkunci('gagal');
      const data = await res.json();
      if (!data?.ok) return statusTerkunci('gagal');

      _cache = { ...statusTerkunci(), ...data };
      _cacheAt = Date.now();
      return _cache;
    } catch {
      return statusTerkunci('gagal');
    } finally {
      _janji = null;
    }
  })();

  return _janji;
}

/** Buang cache — dipakai setelah login/logout tanpa memuat ulang halaman. */
export function lupakanAkses() {
  _cache = null;
  _cacheAt = 0;
  try { sessionStorage.removeItem(CACHE_KEY); } catch { /* mode privasi */ }
}

/**
 * Apakah pengguna boleh melihat ANGKA metrik proyek ini?
 * @param {object} akses hasil ambilAkses()
 * @param {string} slug
 */
export function bolehLihatAngka(akses, slug) {
  if (!akses?.masuk) return false;
  if (akses.berbayar) return true;
  return Array.isArray(akses.proyekTerbuka) && akses.proyekTerbuka.includes(slug);
}

/**
 * Apakah pengguna boleh melihat DEMO (sandbox) dan DIAGRAM?
 *
 * ── KENAPA LEBIH KETAT DARIPADA ANGKA ──────────────────────────────────────
 * Angka adalah ringkasan; demo dan diagram membuka cara kerjanya. Yang kedua
 * lebih berharga, jadi ia diberikan ke SEMUA yang sudah masuk (bukan per
 * proyek), tapi tidak pernah ke pengunjung anonim.
 */
export function bolehLihatDemo(akses) {
  return Boolean(akses?.masuk);
}

/**
 * Label ajakan yang tepat untuk keadaan pengguna.
 * Mengembalikan null kalau tidak perlu ajakan (sudah bisa lihat semua).
 */
export function ajakanUntuk(akses) {
  if (!akses) return null;
  if (!akses.masuk) {
    return {
      judul: 'Masuk untuk melihat data lengkap',
      teks: 'Angka terverifikasi, demo interaktif, dan diagram arsitektur tersedia setelah Anda masuk. Akun Free langsung mendapat akses ke 3 proyek.',
      aksi: 'Masuk',
      href: '/sign-in',
      aksiSekunder: 'Buat akun',
      hrefSekunder: '/sign-up',
    };
  }
  if (akses.berbayar) return null;

  if (akses.sisa > 0) {
    return {
      judul: `Anda punya ${akses.sisa} proyek tersisa`,
      teks: 'Buka proyek mana pun di bawah untuk melihat angka dan detailnya. Jatah ini tidak berkurang kalau Anda membuka proyek yang sama lagi.',
      aksi: null,
    };
  }
  if (akses.bonusStarTersedia > 0) {
    return {
      judul: 'Jatah Free sudah terpakai',
      teks: `Beri star di GitHub untuk membuka ${akses.bonusStarTersedia} proyek lagi, atau berlangganan untuk akses tanpa batas.`,
      aksi: 'Tingkatkan paket',
      href: '/pricing',
      aksiSekunder: 'Beri star di GitHub',
      hrefSekunder: 'https://github.com/VicterHong',
    };
  }
  return {
    judul: 'Semua jatah Free sudah terpakai',
    teks: 'Berlangganan untuk membuka seluruh proyek tanpa batas, atau minta akses langsung lewat halaman kontak.',
    aksi: 'Lihat paket',
    href: '/pricing',
    aksiSekunder: 'Hubungi saya',
    hrefSekunder: '#89fk39',
  };
}
