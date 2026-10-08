/**
 * Cloudflare Worker — Portfolio Edge Router
 *
 * Empat tanggung jawab, dalam urutan prioritas:
 *   1. /media/*   → sajikan gambar galeri dari R2 (cache 1 tahun)
 *   2. /avatar/*  → buat avatar pengguna dari nama (SVG, tanpa penyimpanan)
 *   3. /api/*     → teruskan ke backend Node lewat tunnel
 *   4. sisanya    → redirect ke Cloudflare Pages
 *
 * ── KENAPA GAMBAR LEWAT WORKER, BUKAN R2 PUBLIC URL ─────────────────────────
 * R2 public bucket URL (pub-xxxx.r2.dev) itu:
 *   - Domain terpisah → DNS lookup + TLS handshake tambahan per gambar
 *   - Tidak ada kontrol header (cache, CORS, Content-Type)
 *   - Terlihat "murahan" di URL — bukan citra korporat
 *
 * Lewat Worker, semua gambar datang dari domain yang SAMA dengan situs:
 *   - Tidak ada koneksi baru (koneksi sudah terbuka)
 *   - Header cache bisa diatur sendiri (immutable 1 tahun)
 *   - URL-nya rapi: /media/spotlight/mina-terminal.webp
 *
 * ── KENAPA CACHE 1 TAHUN AMAN ──────────────────────────────────────────────
 * Karena nama berkas mengandung hash isi (dibuat backend saat unggah).
 * Kalau admin mengganti gambar, hash berubah → nama berkas berubah → URL
 * berubah. Jadi cache lama tidak pernah menyajikan gambar yang salah.
 * Ini pola "content-addressed asset" yang dipakai semua CDN besar.
 */

/**
 * Avatar pengguna — dibuat di edge, tanpa backend dan tanpa penyimpanan.
 *
 * ── KENAPA DIBUAT, BUKAN DISIMPAN ────────────────────────────────────────────
 * Menyimpan avatar berarti: satu berkas per pengguna, satu unggahan, satu
 * pembersihan saat akun dihapus. Untuk pengguna yang TIDAK punya foto dari
 * provider OAuth, semua itu tidak perlu — avatarnya bisa DIHITUNG dari nama.
 *
 * Hasilnya: nol byte penyimpanan, nol operasi tulis, nol berkas yatim.
 * Satu-satunya biaya adalah CPU saat pertama diminta — dan itu di-cache
 * selamanya oleh browser dan Cloudflare.
 *
 * ── GAYA: SAMA DENGAN LOGO ───────────────────────────────────────────────────
 * Logo VIVASTIC adalah huruf emas (#f5c542) di atas latar gelap (#0e1116).
 * Avatar memakai bahasa yang sama — inisial emas di kotak gelap — sehingga
 * foto profil terlihat seperti bagian dari produk, bukan gambar tempelan.
 *
 * ── KENAPA WARNA LATAR DIPILIH DARI NAMA ─────────────────────────────────────
 * Dua pengguna bernama "Budi" dan "Budi Santoso" harus terlihat BERBEDA.
 * Warna diturunkan dari hash nama, jadi:
 *   - nama sama → warna sama (stabil, tidak berubah tiap muat)
 *   - nama beda → kemungkinan besar warna beda
 *
 * Hue dibatasi 20-60 (emas sampai kuning-hijau) supaya SELALU selaras dengan
 * identitas emas situs. Hue acak penuh akan menghasilkan avatar biru dan ungu
 * yang terlihat seperti dari aplikasi lain.
 *
 * ── SVG, BUKAN PNG ───────────────────────────────────────────────────────────
 * SVG tajam di semua ukuran (16px di daftar sampai 256px di halaman profil)
 * dengan ukuran berkas ~1 KB. PNG butuh beberapa ukuran berbeda, dan masing-
 * masing harus dibuat dan disimpan.
 */

/**
 * Latar avatar — SATU keluarga warna.
 *
 * ── DUA KALI SALAH ──
 * Versi pertama: empat hex yang "terlihat mirip di layar gelap"
 *   #0e1116  #131316  #0f1418  #141118
 *   → ada yang kebiruan, ada yang keunguan. Terlihat seperti dari aplikasi
 *     berbeda saat berdampingan.
 *
 * Versi kedua: dua hex, tapi tetap beda keluarga
 *   #0e1116 (R14 G17 B22 — biru dominan)
 *   #12100e (R18 G16 B14 — merah dominan)
 *   → perbedaan R 14→18 dan B 22→14 masih terlihat di layar gelap besar.
 *
 * ── YANG BENAR ──
 * Dua warna, KEDUANYA dari keluarga biru-gelap yang sama. Yang berubah hanya
 * tingkat kecerahan (hue dipertahankan), bukan hue-nya.
 *
 *   #0e1116  R14 G17 B22  → selisih B-R = 8
 *   #11151b  R17 G21 B27  → selisih B-R = 10  (hue sama, +3 tingkat terang)
 *
 * Bedanya cukup untuk membedakan dua avatar berdampingan, tapi tidak cukup
 * untuk terlihat seperti dua keluarga warna.
 *
 * ── KENAPA TIDAK SATU WARNA SAJA ──
 * Bisa, tapi dua avatar berdampingan dengan latar identik terlihat seperti
 * satu blok, bukan dua entitas. Variasi tipis ini memisahkannya secara visual
 * tanpa menarik perhatian.
 */
const AVATAR_LATAR = ["#0e1116", "#11151b"];

/** Warna aksen diturunkan dari nama — stabil dan selalu dalam keluarga emas. */
function warnaDari(nama: string): string {
  let h = 0;
  for (let i = 0; i < nama.length; i += 1) {
    h = (h * 31 + nama.charCodeAt(i)) >>> 0;
  }
  // Hue 38-52 = emas. Dibatasi sempit supaya semua avatar terlihat satu
  // keluarga, bukan warna acak.
  const hue = 38 + (h % 15);
  // Saturasi dan lightness sedikit bervariasi supaya dua avatar berbeda
  // tetap terbedakan meski hue-nya berdekatan.
  const sat = 62 + ((h >> 4) % 20);
  const lig = 52 + ((h >> 8) % 12);
  return `hsl(${hue} ${sat}% ${lig}%)`;
}

/** Inisial dari nama. Maksimal 2 huruf — lebih dari itu tidak terbaca. */
function inisialDari(nama: string): string {
  const bersih = String(nama || "").trim();
  if (!bersih) return "?";

  // Pisahkan pada spasi, tanda hubung, titik, dan garis bawah — supaya
  // "budi-santoso" dan "budi.santoso" juga menghasilkan "BS".
  const bagian = bersih.split(/[\s._-]+/).filter(Boolean);

  if (bagian.length === 0) return "?";
  if (bagian.length === 1) {
    // Satu kata: ambil satu huruf, atau dua kalau katanya panjang.
    // "Victer" → "V" lebih bersih daripada "VI".
    return bagian[0].slice(0, 1).toUpperCase();
  }

  return (bagian[0][0] + bagian[bagian.length - 1][0]).toUpperCase();
}

/**
 * Escape XML. WAJIB — nama pengguna bisa berisi `<`, `&`, `"`.
 *
 * Tanpa ini, pengguna bernama `<script>` menghasilkan SVG rusak — dan kalau
 * disajikan sebagai image/svg+xml, itu bisa menjadi jalur XSS di beberapa
 * browser lama. Escaping menutupnya di sumbernya.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buatAvatarSvg(nama: string, ukuran: number): string {
  const inisial = escapeXml(inisialDari(nama));
  const warna = warnaDari(nama || "?");

  // Latar dipilih dari hash juga, supaya dua pengguna dengan warna aksen
  // mirip tetap punya latar berbeda.
  let h = 0;
  for (let i = 0; i < (nama || "?").length; i += 1) {
    h = (h * 31 + (nama || "?").charCodeAt(i)) >>> 0;
  }
  const latar = AVATAR_LATAR[h % AVATAR_LATAR.length];

  // Ukuran font relatif terhadap kanvas: 42% memberi ruang napas yang cukup
  // dan tetap terbaca di 16px.
  const font = Math.round(ukuran * 0.42);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ukuran}" height="${ukuran}" viewBox="0 0 ${ukuran} ${ukuran}" role="img" aria-label="${inisial}">
<rect width="${ukuran}" height="${ukuran}" rx="${Math.round(ukuran * 0.18)}" fill="${latar}"/>
<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Satoshi,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="${font}" font-weight="600" fill="${warna}">${inisial}</text>
</svg>`;
}

export interface Env {
  ENVIRONMENT: string;
  ASSETS: R2Bucket;
}

const PAGES_URL = "https://portfolio-victer.pages.dev";
const BACKEND_URL = "https://translation-davidson-searches-prescription.trycloudflare.com";

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Content-Type dari ekstensi. R2 tidak menyimpannya untuk semua objek. */
const TIPE_BERKAS: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  json: "application/json; charset=utf-8",
};

function tipeDari(nama: string): string {
  const titik = nama.lastIndexOf(".");
  if (titik < 0) return "application/octet-stream";
  return TIPE_BERKAS[nama.slice(titik + 1).toLowerCase()] ?? "application/octet-stream";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── 1. MEDIA DARI R2 ────────────────────────────────────────────────────
    if (pathname.startsWith("/media/")) {
      // Hanya GET dan HEAD. Menolak metode lain di sini mencegah orang
      // mencoba menulis lewat Worker — penulisan hanya lewat backend
      // dengan X-Admin-Key, tidak pernah lewat jalur publik ini.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Metode tidak diizinkan", {
          status: 405,
          headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS },
        });
      }

      // Ambil key dari path. Didekode per segmen supaya nama berkas dengan
      // spasi atau karakter khusus tetap benar, TAPI '/' tetap '/' supaya
      // struktur folder terjaga.
      const key = pathname
        .slice("/media/".length)
        .split("/")
        .map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        })
        .join("/");

      // Tolak percobaan keluar dari folder spotlight/.
      //
      // Tanpa pemeriksaan ini, `/media/../backups/tokens.db.enc` bisa membaca
      // cadangan database dari bucket yang sama. R2 sendiri tidak menormalkan
      // '..' seperti filesystem, tapi tetap: tolak di pintu masuk, jangan
      // bergantung pada perilaku penyimpanan.
      if (!key || key.includes("..") || key.startsWith("/")) {
        return new Response("Kunci tidak valid", { status: 400, headers: SECURITY_HEADERS });
      }

      const obj = await env.ASSETS.get(key);
      if (!obj) {
        // 404 dengan cache pendek: kalau admin baru mengunggah gambar dengan
        // nama ini, browser tidak menyimpan 404 itu lama.
        return new Response("Tidak ditemukan", {
          status: 404,
          headers: { "Cache-Control": "public, max-age=60", ...SECURITY_HEADERS },
        });
      }

      const headers = new Headers(SECURITY_HEADERS);
      // Content-Type dari objek kalau ada, kalau tidak dari ekstensi.
      headers.set("Content-Type", obj.httpMetadata?.contentType ?? tipeDari(key));
      // immutable: browser tidak perlu bertanya lagi selama setahun.
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("ETag", obj.httpEtag);
      // Gambar galeri dipakai lintas origin (preview Pages, domain utama).
      headers.set("Access-Control-Allow-Origin", "*");

      // Dukungan 304: browser yang sudah punya berkasnya tidak perlu
      // mengunduh ulang — cukup dapat "belum berubah".
      const ifNoneMatch = request.headers.get("If-None-Match");
      if (ifNoneMatch && ifNoneMatch === obj.httpEtag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(request.method === "HEAD" ? null : obj.body, { headers });
    }

    // ── 2. HEALTH CHECK ─────────────────────────────────────────────────────
    if (pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "portfolio-victer",
        environment: env.ENVIRONMENT || "production",
        edge: (request as Request & { cf?: { colo?: string } }).cf?.colo || "unknown",
        media: Boolean(env.ASSETS),
        pages_url: PAGES_URL,
        time: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
      });
    }

    // ── 2. AVATAR PENGGUNA ──────────────────────────────────────────────────
    //
    // Dibuat di edge, bukan disimpan. Lihat buatAvatarSvg() untuk alasannya.
    //
    // Ditaruh SEBELUM /api/ supaya tidak pernah menyentuh backend: membuat
    // gambar 1 KB tidak perlu membangunkan layanan Node, dan itu berarti
    // avatar tetap tampil meski backend sedang mati.
    //
    // Bentuk URL:  /avatar/<nama>?s=<ukuran>
    //   /avatar/Victer          → 128px (bawaan)
    //   /avatar/Victer? s=32    → 32px
    if (pathname.startsWith("/avatar")) {
      // Hanya GET dan HEAD — endpoint ini murni baca.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Metode tidak diizinkan", {
          status: 405,
          headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS },
        });
      }

      // Nama diambil dari path, didekode supaya nama dengan spasi/aksen benar.
      // Dibatasi 100 karakter: nama panjang tidak berguna (hanya 1-2 huruf
      // yang dipakai) dan mencegah pembuatan SVG raksasa.
      let nama = "";
      try {
        nama = decodeURIComponent(pathname.slice("/avatar".length).replace(/^\//, "")).slice(0, 100);
      } catch {
        nama = "";
      }

      // Ukuran dibatasi 16-512. Tanpa batas, ?s=99999 menghasilkan SVG
      // besar yang bisa dipakai menghabiskan CPU dan bandwidth.
      const ukuranMinta = Number(url.searchParams.get("s") || 128);
      const ukuran = Number.isFinite(ukuranMinta)
        ? Math.min(512, Math.max(16, Math.round(ukuranMinta)))
        : 128;

      const svg = buatAvatarSvg(nama, ukuran);

      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          // Cache 1 tahun. Aman karena avatar murni fungsi dari nama —
          // nama berubah berarti URL berubah, jadi cache lama tidak pernah
          // menyajikan avatar yang salah.
          "Cache-Control": "public, max-age=31536000, immutable",
          // CSP ketat untuk SVG: tidak ada script, tidak ada resource luar.
          // Ini lapisan kedua setelah escapeXml — kalau ada jalur lolos yang
          // belum terpikirkan, CSP menutupnya.
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          ...SECURITY_HEADERS,
        },
      });
    }

    // ── 3. API → BACKEND ────────────────────────────────────────────────────
    if (pathname.startsWith("/api/")) {
      // ── TERUSKAN IP DI X-Client-IP (UNTUK RATE LIMIT & AUDIT) ────────────
      // Cloudflare MENIMPA `CF-Connecting-IP` di setiap hop fetch() antar
      // domain. Header `X-Client-IP` tidak disentuh, jadi nilai hop-pertama
      // bisa bertahan sampai backend.
      //
      // ── BATAS KEMAMPUANNYA — SUDAH DIUJI ────────────────────────────────
      // Meski Pages Function dan Worker sama-sama meneruskan, terukur backend
      // TETAP menerima IP Cloudflare (`2a06:98c0:3600::103`). Rantai empat
      // hop terlalu panjang untuk header ini bertahan utuh.
      //
      // Nilainya tetap berguna untuk rate limit dan audit log — lebih baik
      // daripada tidak ada. TAPI JANGAN dipakai untuk apa pun yang butuh
      // akurasi per-pengunjung (seperti mengikat cookie ke mesin). Clearance
      // gate memakai nonce acak karena alasan ini.
      const headers = new Headers(request.headers);

      // ── JANGAN BACA `CF-Connecting-IP` DI SINI ────────────────────────────
      // Di hop ini (workers.dev), header itu SUDAH DITIMPA Cloudflare dengan
      // IP Cloudflare sendiri — bukan IP pengunjung. Membacanya di sini
      // berarti menyimpan nilai yang salah.
      //
      // Yang benar: teruskan `X-Client-IP` yang sudah diisi Pages Function
      // di hop pertama (pages.dev) — di sana header masih berisi IP
      // pengunjung asli.
      //
      // Kalau Worker diakses LANGSUNG (bukan lewat Pages Function), tidak ada
      // X-Client-IP. Dalam hal itu kita isi dari CF-Connecting-IP — nilai itu
      // IP pengunjung karena ini hop pertama.
      if (!headers.has("X-Client-IP")) {
        const langsung = request.headers.get("CF-Connecting-IP") ?? "";
        if (langsung) headers.set("X-Client-IP", langsung);
      }

      // ── redirect: 'manual' — WAJIB, JANGAN DIHAPUS ───────────────────────
      //
      // `fetch()` mengikuti redirect secara BAWAAN. Tanpa 'manual', Worker
      // menelan 302 dari backend lalu mengambil halaman tujuan itu sendiri.
      //
      // Untuk OAuth itu FATAL: backend mengalihkan ke
      // github.com/login/oauth/authorize, dan Worker malah mengambil halaman
      // login GitHub lalu menyajikannya ke browser dengan status 200.
      // Browser tidak pernah dialihkan — URL-nya tetap domain kita, dan
      // pengguna melihat halaman GitHub yang "tersangkut" di dalam situs.
      //
      // Gejalanya tidak kentara: respons 200 dengan header milik GitHub
      // (x-github-request-id, set-cookie _gh_sess). Endpoint kita sendiri
      // tidak pernah mengirim header itu.
      //
      // 'manual' membuat 302 diteruskan APA ADANYA ke browser — browser
      // yang mengikutinya, dan itu memang yang diinginkan.
      return fetch(`${BACKEND_URL}${pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
    }

    // ── 4. SISANYA → PAGES ──────────────────────────────────────────────────
    return Response.redirect(`${PAGES_URL}${pathname}${url.search}`, 302);
  },
};
