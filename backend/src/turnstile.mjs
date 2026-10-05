/**
 * Verifikasi Cloudflare Turnstile — CAPTCHA tanpa gesekan.
 *
 * KENAPA TURNSTILE (bukan reCAPTCHA):
 *   1. Tidak ada puzzle gambar — pengunjung biasanya lolos tanpa interaksi.
 *      Titik konversi terpenting (form permintaan akses) tetap mulus.
 *   2. Cloudflare tidak menjual data pengunjung untuk iklan, dan tidak
 *      memasang cookie pelacak lintas situs. reCAPTCHA (Google) melakukan
 *      keduanya — bertentangan dengan prinsip privasi di PRD §8.
 *   3. Sudah satu ekosistem dengan tunnel Cloudflare yang dipakai backend ini.
 *
 * HUBUNGAN DENGAN PENAPIS LAIN:
 *   Turnstile adalah lapis TERKUAT, bukan pengganti. Lapisan honeypot, waktu
 *   isi, batas laju, dan heuristik isi tetap jalan (backend/src/spam-guard.mjs).
 *   Alasannya: Turnstile memverifikasi MANUSIA, bukan NIAT. Manusia yang
 *   mengirim spam tetap lolos Turnstile — heuristik isi yang menangkapnya.
 *
 * MODE GAGAL — DUA PERILAKU YANG BERBEDA, dan pilihannya disengaja:
 *
 *   failOpen: true (bawaan) — untuk FORM SALES.
 *     Kalau Cloudflare tidak terjangkau, pengunjung tetap bisa mengirim
 *     permintaan akses. Lapisan spam-guard (honeypot, waktu isi, heuristik
 *     isi) tetap melindungi. Mengorbankan lead bisnis karena gangguan
 *     pihak ketiga adalah pertukaran yang buruk.
 *
 *   failOpen: false — untuk GERBANG TOKEN.
 *     Di sini Turnstile adalah satu-satunya penghalang antara bot dan
 *     percobaan token. Kalau Cloudflare tidak terjangkau dan kita gagal-
 *     terbuka, bot bisa mencoba token tanpa hambatan sama sekali. Lebih
 *     baik menolak sementara (pengunjung muat ulang) daripada membuka
 *     gerbang tanpa proteksi.
 *
 * VALIDASI HOSTNAME & ACTION:
 *   Cloudflare mengembalikan hostname tempat token diselesaikan. Tanpa
 *   memeriksanya, token yang diselesaikan di domain lain (preview
 *   deployment, staging, atau domain penyerang) tetap diterima.
 *   Action juga diperiksa supaya token dari form sales tidak bisa dipakai
 *   untuk membuka gerbang token.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Key uji resmi Cloudflare — selalu lolos, untuk pengembangan.
 * Hanya berlaku di domain apa pun; produksi harus pakai key sungguhan.
 * @see https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TEST_SECRET_ALWAYS_PASS = '1x0000000000000000000000000000000AA';
export const TEST_SECRET_ALWAYS_FAIL = '2x0000000000000000000000000000000AA';

/**
 * Verifikasi token Turnstile dari klien.
 *
 * @param {object} input
 * @param {string} input.token       nilai cf-turnstile-response dari form
 * @param {string} input.secret      secret key dari dashboard Cloudflare
 * @param {string} [input.remoteip]  IP pengunjung (opsional, untuk skor risiko)
 * @param {number} [input.timeoutMs] batas waktu panggilan ke Cloudflare
 * @param {boolean} [input.failOpen=true]  perilaku saat Cloudflare tak terjangkau
 * @param {string[]} [input.expectedHostnames=[]] hostname yang boleh; kosong = lewati
 * @param {string} [input.expectedAction]  action yang diharapkan; kosong = lewati
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string, codes?: string[], hostname?: string}>}
 */
export async function verifyTurnstile({
  token,
  secret,
  remoteip = '',
  timeoutMs = 8000,
  failOpen = true,
  expectedHostnames = [],
  expectedAction = '',
}) {
  // Tanpa secret key: Turnstile tidak aktif.
  //
  // PERILAKU BERBEDA menurut mode:
  //   failOpen=true  → lewati (form sales tetap jalan; spam-guard melindungi)
  //   failOpen=false → TOLAK (gerbang token tidak boleh terbuka tanpa proteksi)
  //
  // Penolakan ini disertai error yang jelas supaya log menunjukkan masalah
  // konfigurasi, bukan sekadar "verifikasi gagal".
  if (!secret) {
    if (failOpen) return { ok: true, skipped: true, error: 'secret_kosong' };
    return { ok: false, error: 'secret_kosong', codes: ['missing-input-secret'] };
  }

  // Token kosong: pengunjung belum menyelesaikan widget, atau JS diblokir.
  // Ini tetap ditolak — kalau tidak, Turnstile bisa dilewati dengan menghapus
  // elemen widget dari DOM.
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'token_kosong', codes: ['missing-input-response'] };
  }

  if (token.length > 2048) {
    return { ok: false, error: 'token_terlalu_panjang', codes: ['invalid-input-response'] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /** Hasil saat Cloudflare tidak bisa dihubungi — tergantung mode. */
  const unreachable = (error) =>
    failOpen
      ? { ok: true, skipped: true, error }
      : { ok: false, error, codes: ['cloudflare_tidak_terjangkau'] };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', remoteip);

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Bedakan dua jenis kegagalan HTTP:
      //   - 5xx: Cloudflare bermasalah → tergantung mode (lewati atau tolak)
      //   - 4xx: permintaan kita yang salah (mis. secret tidak valid, token
      //     rusak). Ini penolakan sungguhan — jangan di-skip, karena kalau
      //     di-skip proteksinya mati diam-diam tanpa ada yang sadar.
      if (res.status >= 500) return unreachable(`cloudflare_http_${res.status}`);

      let data = {};
      try { data = await res.json(); } catch { /* body bukan JSON */ }
      const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
      return {
        ok: false,
        error: codes.includes('invalid-input-secret') ? 'secret_tidak_valid' : 'verifikasi_gagal',
        codes,
        hostname: data.hostname ?? '',
      };
    }

    const data = await res.json();

    if (data.success === true) {
      // Validasi hostname — token yang diselesaikan di domain lain tidak boleh
      // diterima. Daftar kosong = pemeriksaan dilewati (untuk pengembangan).
      const host = String(data.hostname ?? '');
      const allowed = expectedHostnames.filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(host)) {
        return {
          ok: false,
          error: 'hostname_tidak_cocok',
          codes: ['hostname-mismatch'],
          hostname: host,
        };
      }

      // Validasi action — mencegah token dari satu form dipakai di form lain
      // (mis. token form sales dipakai untuk membuka gerbang token).
      if (expectedAction && data.action !== expectedAction) {
        return {
          ok: false,
          error: 'action_tidak_cocok',
          codes: ['action-mismatch'],
          hostname: host,
        };
      }

      return { ok: true, hostname: host };
    }

    const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];

    // Token kedaluwarsa/duplikat = pengunjung terlalu lama mengisi form, atau
    // token dipakai ulang. Pesannya harus memandu, bukan menyalahkan.
    const expired = codes.includes('timeout-or-duplicate');
    return {
      ok: false,
      error: expired ? 'token_kedaluwarsa' : 'verifikasi_gagal',
      codes,
      hostname: data.hostname ?? '',
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    // Gangguan jaringan ke Cloudflare — perilakunya tergantung mode.
    return unreachable(aborted ? 'cloudflare_timeout' : 'cloudflare_tidak_terjangkau');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pesan siap-tampil untuk pengunjung saat verifikasi gagal.
 * Ditulis memandu — bukan "verifikasi gagal" yang membuat orang bingung.
 */
export function turnstileMessage(error) {
  switch (error) {
    case 'token_kosong':
      return 'Selesaikan verifikasi keamanan dulu, lalu kirim ulang.';
    case 'token_kedaluwarsa':
      return 'Verifikasi keamanan kedaluwarsa. Muat ulang halaman, lalu coba lagi.';
    case 'token_terlalu_panjang':
      return 'Verifikasi keamanan tidak valid. Muat ulang halaman, lalu coba lagi.';
    case 'verifikasi_gagal':
      return 'Verifikasi keamanan tidak lolos. Muat ulang halaman, lalu coba lagi.';
    case 'hostname_tidak_cocok':
    case 'action_tidak_cocok':
      // Token sah tapi dari konteks yang salah (domain/aksi berbeda).
      // Pengunjung tidak bisa memperbaikinya — pesannya memandu muat ulang.
      return 'Verifikasi keamanan tidak cocok dengan halaman ini. Muat ulang halaman, lalu coba lagi.';
    case 'secret_tidak_valid':
    case 'secret_kosong':
      // Masalah konfigurasi pemilik situs, bukan pengunjung. Pesannya
      // sengaja netral supaya pengunjung tidak bingung, tapi dicatat di log
      // supaya pemilik sadar key-nya salah/kosong.
      return 'Verifikasi keamanan sedang bermasalah. Coba lagi sebentar lagi.';
    case 'cloudflare_tidak_terjangkau':
    case 'cloudflare_timeout':
      // Cloudflare sedang tidak bisa dihubungi. Di gerbang token ini berarti
      // penolakan sementara; pengunjung perlu mencoba lagi nanti.
      return 'Layanan verifikasi sedang sibuk. Tunggu sebentar, lalu coba lagi.';
    default:
      return 'Verifikasi keamanan bermasalah. Coba lagi sebentar lagi.';
  }
}
