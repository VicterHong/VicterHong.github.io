/**
 * Cloudflare Worker — Portfolio Edge Router
 * - Static assets → Cloudflare Pages (lebih cepat)
 * - API calls → Backend via Tunnel
 * - Health check → Worker itself
 */

export interface Env {
  ENVIRONMENT: string;
}

const PAGES_URL = "https://portfolio-victer.pages.dev";
const BACKEND_URL = "https://translation-davidson-searches-prescription.trycloudflare.com";

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Health check
    if (pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "portfolio-victer",
        environment: env.ENVIRONMENT || "production",
        edge: request.cf?.colo || "unknown",
        pages_url: PAGES_URL,
        time: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
      });
    }
    
    // API proxy ke backend
    if (pathname.startsWith("/api/")) {
      return fetch(`${BACKEND_URL}${pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }
    
    // Semua lainnya → redirect ke Pages (CDN global, lebih cepat)
    return Response.redirect(`${PAGES_URL}${pathname}${url.search}`, 302);
  },
};
