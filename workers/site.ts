/**
 * Cloudflare Worker — Portfolio Static Site
 * Edge deployment dengan caching, security headers, analytics
 */

export interface Env {
  ASSETS: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.trycloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const CACHE_TTL = 3600;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    // Analytics
    env.ANALYTICS?.writeDataPoint({
      blobs: [pathname, request.headers.get("user-agent") || "", request.cf?.country || ""],
      doubles: [1],
      indexes: [pathname],
    });
    
    // Serve dari R2
    const key = pathname === "/" ? "index.html" : pathname.slice(1);
    const object = await env.ASSETS.get(key);
    
    if (!object) {
      const fallback = await env.ASSETS.get("index.html");
      if (!fallback) return new Response("Not Found", { status: 404 });
      return serveAsset(fallback, "text/html", request);
    }
    
    return serveAsset(object, getContentType(key), request);
  },
};

function serveAsset(object: R2ObjectBody, contentType: string, request: Request): Response {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${CACHE_TTL}`,
    ...SECURITY_HEADERS,
  });
  return new Response(object.body, { headers });
}

function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html", css: "text/css", js: "application/javascript",
    json: "application/json", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon",
    woff2: "font/woff2",
  };
  return types[ext || ""] || "application/octet-stream";
}
