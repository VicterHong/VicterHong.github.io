/**
 * Deteksi perangkat — memakai Client Hints, bukan User-Agent saja.
 *
 * ══ MASALAH YANG DIPECAHKAN ══════════════════════════════════════════════════
 *
 * User-Agent TIDAK BISA DIPERCAYA untuk menentukan perangkat. Tiga kasus nyata:
 *
 *   1. CHROME ANDROID MODE "DESKTOP SITE"
 *      Chrome sengaja MENGUBAH User-Agent-nya jadi UA desktop:
 *        normal  : (Linux; Android 14; Pixel 8) ... Mobile Safari
 *        desktop : (X11; Linux x86_64) ... Safari          <-- Android hilang
 *
 *      Pengguna yang mengaktifkan mode ini terlihat memakai "Linux desktop"
 *      padahal sedang di ponsel. Ini yang terjadi pada sesi produksi.
 *
 *   2. UA DI-OPREK
 *      Ekstensi dan alat privasi mengganti User-Agent sesuka hati. UA yang
 *      menyamar jadi Windows tidak berarti perangkatnya Windows.
 *
 *   3. UA DIBEKUKAN
 *      Chrome membekukan bagian UA (versi minor, model) untuk mengurangi
 *      fingerprinting. Informasi yang dulu ada, sekarang tidak.
 *
 * ══ SOLUSI: CLIENT HINTS + SINYAL LAYAR ══════════════════════════════════════
 *
 * `navigator.userAgentData` (Client Hints) memberi data terstruktur yang:
 *   • TIDAK berubah saat mode desktop aktif — `platform` tetap "Android"
 *   • Tidak perlu regex
 *   • Standar (RFC 8942, didukung Chrome 89+)
 *
 * Untuk browser yang belum mendukungnya (Firefox, Safari), dipakai sinyal
 * LAYAR yang tidak bisa dipalsukan oleh UA:
 *   • `screen.width` kecil  → kemungkinan ponsel
 *   • `maxTouchPoints > 0`  → layar sentuh
 *   • `devicePixelRatio`    → kepadatan piksel
 *
 * Hasilnya digabung: Client Hints dulu (paling akurat), sinyal layar sebagai
 * pelengkap, UA sebagai cadangan terakhir.
 *
 * ══ KENAPA TIDAK DI BACKEND SAJA ═════════════════════════════════════════════
 * Backend hanya menerima header. Client Hints tingkat tinggi (model, versi
 * platform) butuh `Accept-CH` di respons SEBELUMNYA — dan itu berarti request
 * pertama tidak punya datanya.
 *
 * Lebih penting: `screen.width` dan `maxTouchPoints` TIDAK ADA di header HTTP
 * sama sekali. Keduanya hanya bisa dibaca dari JavaScript. Dan keduanya adalah
 * sinyal yang paling sulit dipalsukan.
 *
 * Jadi deteksi dilakukan di klien, lalu hasilnya dikirim ke server sebagai
 * bagian dari request masuk. Server tetap memvalidasi dan menyimpannya.
 */

/** Nama platform dari Client Hints → label yang bisa dibaca. */
const LABEL_PLATFORM = {
  Android: 'Android',
  iOS: 'iOS',
  'Chrome OS': 'ChromeOS',
  Windows: 'Windows',
  macOS: 'macOS',
  Linux: 'Linux',
};

/**
 * Baca Client Hints kalau tersedia.
 * @returns {{platform: string, mobile: boolean, model: string}|null}
 */
async function dariClientHints() {
  const ch = navigator.userAgentData;
  if (!ch) return null;

  const hasil = {
    platform: ch.platform || '',
    mobile: ch.mobile === true,
    model: '',
  };

  // `model` (mis. "Pixel 8") adalah hint entropy tinggi — hanya tersedia
  // lewat getHighEntropyValues(), dan browser boleh menolak.
  try {
    const hi = await ch.getHighEntropyValues(['model']);
    hasil.model = hi.model || '';
  } catch {
    // Ditolak atau tidak didukung — bukan kegagalan, lanjut tanpa model.
  }

  return hasil;
}

/**
 * Tebak jenis perangkat dari sinyal yang tidak bisa dipalsukan UA.
 *
 * ── AMBANG YANG DIPAKAI ─────────────────────────────────────────────────────
 *   < 768px  dan layar sentuh  → ponsel
 *   < 1200px dan layar sentuh  → tablet
 *   sisanya                    → komputer
 *
 * 768px adalah breakpoint yang sama dengan CSS `md:` — jadi kesimpulan di sini
 * konsisten dengan tata letak yang benar-benar dilihat pengguna.
 *
 * `maxTouchPoints` penting karena laptop layar sentuh juga punya layar lebar —
 * tanpa cek itu, laptop sentuh akan salah dikira tablet.
 */
function dariLayar() {
  const lebar = Math.min(screen.width || 9999, window.innerWidth || 9999);
  const sentuh = (navigator.maxTouchPoints || 0) > 0;

  if (lebar < 768 && sentuh) return 'ponsel';
  if (lebar < 1200 && sentuh) return 'tablet';
  return 'komputer';
}

/**
 * Hasil deteksi perangkat, siap dikirim ke server.
 *
 * @returns {Promise<{jenis: string, platform: string, model: string, sumber: string}>}
 */
export async function deteksiPerangkat() {
  const ch = await dariClientHints();
  const dariLayarHasil = dariLayar();

  // ── CLIENT HINTS MENANG KALAU ADA ─────────────────────────────────────────
  // Ia satu-satunya sumber yang TAHU perangkat sebenarnya meski UA diubah.
  if (ch && ch.platform) {
    let jenis;
    if (ch.mobile) {
      // `mobile: true` dari browser = pasti perangkat genggam.
      // Bedakan ponsel vs tablet dari lebar layar.
      jenis = dariLayarHasil === 'komputer' ? 'tablet' : dariLayarHasil;
    } else {
      // Platform desktop, TAPI layar kecil + sentuh = kemungkinan besar
      // Android dalam mode "Desktop site" — justru kasus yang dilaporkan.
      jenis = (dariLayarHasil === 'ponsel' && ch.platform === 'Android')
        ? 'ponsel'
        : dariLayarHasil;
    }

    return {
      jenis,
      platform: LABEL_PLATFORM[ch.platform] || ch.platform,
      model: ch.model,
      sumber: 'client-hints',
    };
  }

  // ── CADANGAN: SINYAL LAYAR SAJA ───────────────────────────────────────────
  return {
    jenis: dariLayarHasil,
    platform: '',
    model: '',
    sumber: 'layar',
  };
}
