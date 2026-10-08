/**
 * Pages Function — proxy /api/* dan /media/* ke Worker.
 *
 * ── KENAPA FUNGSI INI ADA ───────────────────────────────────────────────────
 * Situs disajikan dari Cloudflare Pages (portfolio-victer.pages.dev), sementara
 * /api dan /media hanya ada di Worker (portfolio-victer.victerphanjaya.workers.dev).
 *
 * Percobaan pertama memakai `_redirects` dengan status 200 (proxy). Itu GAGAL,
 * dan dokumentasi Cloudflare menjelaskan kenapa:
 *
 *   "Proxying will only support relative URLs on your site.
 *    You cannot proxy external domains."
 *
 * Jadi `_redirects` memang tidak bisa dipakai untuk kasus ini. Pages Function
 * bisa — ia berjalan di edge dan boleh `fetch()` ke mana saja.
 *
 * ── KENAPA PROXY, BUKAN FETCH LANGSUNG KE WORKER DARI JAVASCRIPT ────────────
 * Mengarahkan fetch dari halaman pages.dev langsung ke workers.dev berarti
 * permintaan LINTAS ORIGIN. Itu butuh CORS benar di setiap respons, cookie
 * SameSite=None, dan dua kali DNS + TLS. Dengan proxy, semuanya SAMA ORIGIN
 * dari sudut browser — tidak ada preflight, tidak ada koneksi tambahan.
 *
 * ── KENAPA SATU FUNGSI UNTUK DUA PREFIX ─────────────────────────────────────
 * `[[path]].js` menangkap SEMUA path. Kita periksa sendiri prefix mana yang
 * cocok, lalu teruskan. Satu berkas, satu tempat logika — dan tidak perlu
 * `_routes.json` karena pola catch-all sudah menangani semuanya.
 *
 * ── BIAYA ───────────────────────────────────────────────────────────────────
 * Setiap permintaan yang lewat fungsi ini dihitung sebagai satu invokasi
 * Workers. Untuk galeri dengan 8 gambar + 1 manifest per kunjungan, itu 9
 * invokasi — jauh di bawah batas gratis 100.000/hari.
 *
 * ── CATATAN UNTUK MASA DEPAN ────────────────────────────────────────────────
 * Saat domain sendiri (victer.is-a.dev) sudah aktif dan Worker Route dipasang
 * di zona itu, fungsi ini bisa dihapus — Worker akan menangani /api dan /media
 * langsung tanpa perantara.
 */

const WORKER = 'https://portfolio-victer.victerphanjaya.workers.dev';

/**
 * Prefix yang diteruskan ke Worker. Selain ini, dilayani sebagai aset statis.
 *
 * /avatar TIDAK memakai garis miring di akhir karena endpoint-nya menerima
 * dua bentuk: '/avatar/Victer' (dengan nama) dan '/avatar' (tanpa nama,
 * menghasilkan inisial '?'). Memakai '/avatar/' akan membuat bentuk kedua
 * jatuh ke aset statis dan menghasilkan 404.
 */
const PREFIX = ['/api/', '/media/', '/avatar'];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const { pathname } = url;

  // Bukan jalur yang perlu diproxy → biarkan Pages melayani berkas statisnya.
  // Mengembalikan context.next() penting: tanpa itu, SEMUA permintaan
  // (termasuk HTML, CSS, gambar lokal) akan kita tangani dan situs rusak.
  if (!PREFIX.some((p) => pathname.startsWith(p))) {
    return context.next();
  }

  // Teruskan ke Worker dengan method, header, dan body APA ADANYA.
  //
  // Body harus diteruskan mentah (bukan dibaca dulu) supaya unggahan gambar
  // beberapa MB tidak perlu ditampung di memori dua kali. `request.body`
  // adalah stream — makin cepat diteruskan, makin sedikit memori terpakai.
  const target = `${WORKER}${pathname}${url.search}`;

  // ── TERUSKAN IP DI X-Client-IP (UNTUK RATE LIMIT & AUDIT) ────────────────
  // Di hop INI (pages.dev), `CF-Connecting-IP` berisi IP pengunjung yang
  // sungguhan. Cloudflare baru menimpanya di hop BERIKUTNYA. Jadi di sini
  // adalah tempat TERBAIK untuk membacanya.
  //
  // ── BATAS KEMAMPUANNYA — SUDAH DIUJI ────────────────────────────────────
  // Meski fungsi ini meneruskan IP dengan benar, terukur backend TETAP
  // menerima IP Cloudflare (`2a06:98c0:3600::103`). Rantai empat hop
  // (pages.dev → workers.dev → tunnel → backend) terlalu panjang — Cloudflare
  // menimpa header di salah satu hop setelah ini.
  //
  // Nilainya tetap berguna untuk rate limit dan audit log. TAPI JANGAN
  // dipakai untuk mengikat cookie ke mesin — itu sebabnya clearance gate
  // memakai nonce acak, bukan IP.
  const headers = new Headers(context.request.headers);

  // JANGAN pakai `context.request.cf.clientIp` — nilainya bisa sudah
  // tertimpa tergantung bagaimana permintaan masuk. Header lebih andal.
  const ipAsli = context.request.headers.get('CF-Connecting-IP') || '';
  if (ipAsli) headers.set('X-Client-IP', ipAsli);

  const init = {
    method: context.request.method,
    headers,
    // Redirect tidak diikuti: kalau Worker menjawab 302, kita ingin
    // pengunjung melihat 302 itu — bukan mengikutinya diam-diam.
    redirect: 'manual',
  };

  // GET/HEAD tidak boleh punya body — mengirimnya membuat fetch melempar.
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body;
  }

  try {
    return await fetch(target, init);
  } catch (err) {
    // Worker tidak terjangkau (jarang, tapi mungkin saat deploy).
    // Jawab JSON supaya frontend bisa menangani dengan rapi — bukan
    // halaman error HTML yang tidak bisa di-parse.
    return new Response(JSON.stringify({
      ok: false,
      error: 'backend_tidak_terjangkau',
      message: 'Layanan gambar sedang tidak bisa dihubungi.',
    }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
