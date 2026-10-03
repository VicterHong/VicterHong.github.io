/**
 * Cloudflare Worker — Portfolio Static Site (tanpa R2)
 * Serve dari KV atau inline assets. R2 ditambahkan nanti setelah diaktifkan.
 */

export interface Env {
  ENVIRONMENT: string;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.trycloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "portfolio-victer",
        environment: env.ENVIRONMENT || "unknown",
        time: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
      });
    }
    
    // Redirect ke GitHub Pages untuk sekarang
    return Response.redirect("https://victerhong.github.io" + url.pathname + url.search, 302);
  },
};
