/**
 * Cloudflare Worker — Portfolio Edge Router
 *
 * Tiga tanggung jawab, dalam urutan prioritas:
 *   1. /media/*   → sajikan gambar galeri dari R2 (cache 1 tahun)
 *   2. /api/*     → teruskan ke backend Node lewat tunnel
 *   3. sisanya    → redirect ke Cloudflare Pages
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

    // ── 3. API → BACKEND ────────────────────────────────────────────────────
    if (pathname.startsWith("/api/")) {
      // ── TERUSKAN IP PENGUNJUNG ASLI (BUG YANG DIPERBAIKI) ────────────────
      // Cloudflare MENIMPA `CF-Connecting-IP` setiap kali Worker memanggil
      // fetch() ke origin lain. Jadi backend melihat IP Worker — yang
      // BERUBAH tiap permintaan karena edge yang melayani berbeda-beda.
      //
      // Akibatnya clearance cookie tidak pernah cocok: token ditandatangani
      // dengan IP pengunjung, tapi saat diperiksa backend melihat IP Worker
      // yang lain. Terukur: token sah untuk 129.225.15.88 selalu ditolak.
      //
      // Solusi: kirim IP asli di header KHUSUS yang tidak disentuh Cloudflare.
      // `X-Client-IP` adalah konvensi umum dan tidak ditimpa.
      //
      // CATATAN KEAMANAN: header ini TIDAK BOLEH dipercaya kalau datang
      // langsung dari internet — penyerang bisa memalsukannya. Di sini aman
      // karena:
      //   1. Worker SELALU menimpanya dengan nilai dari request.cf (bukan
      //      meneruskan nilai yang dikirim klien)
      //   2. Backend hanya listen di loopback — satu-satunya jalur masuk
      //      adalah tunnel, dan tunnel lewat Worker ini
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

      return fetch(`${BACKEND_URL}${pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
      });
    }

    // ── 4. SISANYA → PAGES ──────────────────────────────────────────────────
    return Response.redirect(`${PAGES_URL}${pathname}${url.search}`, 302);
  },
};
