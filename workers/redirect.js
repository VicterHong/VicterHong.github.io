/**
 * Short URL redirect worker
 * 
 * /s/:code → redirect ke Pages
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Short URL redirect
    const shortMatch = path.match(/^\/s\/([a-z0-9]+)$/);
    if (shortMatch) {
      const code = shortMatch[1];
      return Response.redirect(
        `https://portfolio-victer.pages.dev/s/${code}/`,
        301
      );
    }
    
    // Root redirect
    if (path === '/' || path === '') {
      return Response.redirect(
        'https://portfolio-victer.pages.dev/',
        301
      );
    }
    
    // Default: proxy ke Pages
    return fetch(`https://portfolio-victer.pages.dev${path}${url.search}`, request);
  }
};
