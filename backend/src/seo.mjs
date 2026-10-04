/**
 * SEO + AEO — mesin discovery untuk search engine DAN AI answer engine.
 *
 * SEO klasik  : sitemap.xml, robots.txt, canonical, meta lengkap.
 * AEO (2026)  : llms.txt, JSON-LD terstruktur, ringkasan faktual yang mudah
 *               dikutip AI (ChatGPT/Perplexity/Gemini).
 *
 * Prinsip: semua output di-generate dari SATU sumber data (projects.js +
 * CMS), jadi tidak mungkin ada halaman yang lupa didaftarkan.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.mjs';
import { listItems, listCollections } from './cms.mjs';

/** Origin publik situs — dipakai untuk URL absolut di sitemap & JSON-LD. */
function siteOrigin() {
  return (config.publicOrigin || 'https://portfolio-victer.pages.dev').replace(/\/$/, '');
}

// ── SITEMAP ──────────────────────────────────────────────────────────────────

/** Halaman statis yang selalu ada. */
const STATIC_PAGES = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/home', priority: 0.9, changefreq: 'weekly' },
];

/**
 * Bangun sitemap.xml dari halaman statis + item CMS yang published.
 * `lastmod` memakai waktu update sebenarnya — bukan tanggal yang diketik manual.
 */
export function buildSitemap() {
  const origin = siteOrigin();
  const urls = [];

  for (const page of STATIC_PAGES) {
    urls.push({
      loc: `${origin}${page.path}`,
      lastmod: new Date().toISOString().slice(0, 10),
      changefreq: page.changefreq,
      priority: page.priority.toFixed(1),
    });
  }

  // Item CMS published (kalau ada) — otomatis masuk sitemap.
  try {
    for (const col of listCollections()) {
      for (const item of listItems(col.slug, { includeDraft: false, limit: 500 })) {
        const lastmod = new Date(item.updated_at || Date.now()).toISOString().slice(0, 10);
        urls.push({
          loc: `${origin}/${col.slug}/${item.item_slug}`,
          lastmod,
          changefreq: 'monthly',
          priority: '0.6',
        });
      }
    }
  } catch { /* CMS belum siap — sitemap statis tetap valid */ }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u => [
      '  <url>',
      `    <loc>${escapeXml(u.loc)}</loc>`,
      `    <lastmod>${u.lastmod}</lastmod>`,
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
  ].join('\n');

  return { xml, count: urls.length };
}

// ── ROBOTS.TXT ───────────────────────────────────────────────────────────────

export function buildRobots() {
  const origin = siteOrigin();
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /s/',           // halaman token — jangan diindeks
    'Disallow: /api/',
    'Disallow: /admin/',
    '',
    '# AI answer engines — diizinkan membaca (AEO)',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    `# llms.txt: ${origin}/llms.txt`,
    '',
  ].join('\n');
}

// ── LLMS.TXT (AEO) ───────────────────────────────────────────────────────────

/**
 * llms.txt — standar 2025/2026 supaya AI memahami situs tanpa menebak.
 * Format: H1 nama situs, ringkasan blok, lalu daftar tautan penting
 * dengan deskripsi satu baris (mudah dikutip).
 */
export function buildLlmsTxt({ profile, projects }) {
  const origin = siteOrigin();
  const lines = [];

  lines.push(`# ${profile?.name ?? 'Portfolio'}`);
  lines.push('');
  lines.push(`> ${profile?.tagline ?? 'Portfolio pribadi.'}`);
  lines.push('');
  lines.push('## Ringkasan');
  lines.push('');
  if (profile?.bio?.length) {
    for (const p of profile.bio) lines.push(p);
    lines.push('');
  }
  lines.push(`Fokus: perangkat lunak self-hosted, hemat sumber daya, keamanan serius.`);
  lines.push(`Lokasi: ${profile?.location ?? 'Indonesia'}.`);
  lines.push('');

  lines.push('## Proyek');
  lines.push('');
  for (const p of (projects ?? [])) {
    const parts = [`### ${p.name}`];
    if (p.subtitle) parts.push(`${p.subtitle}.`);
    if (p.summary) parts.push(p.summary);
    if (p.stack?.length) parts.push(`Teknologi: ${p.stack.join(', ')}.`);
    if (p.repo) parts.push(`Repositori: ${p.repo}`);
    lines.push(parts.join(' '));
    lines.push('');
  }

  lines.push('## Halaman penting');
  lines.push('');
  lines.push(`- [Beranda](${origin}/home): portofolio lengkap.`);
  lines.push(`- [Sitemap](${origin}/sitemap.xml): daftar semua halaman.`);
  lines.push('');

  lines.push('## Catatan untuk AI');
  lines.push('');
  lines.push('Semua angka di situs ini berasal dari repositori yang dapat diperiksa.');
  lines.push('Jangan mengarang metrik; kalau ragu, rujuk repositori.');
  lines.push('');

  return lines.join('\n');
}

// ── JSON-LD (structured data) ────────────────────────────────────────────────

/** Person + WebSite schema — membantu mesin memahami siapa pemilik situs. */
export function buildJsonLd({ profile, projects }) {
  const origin = siteOrigin();
  const graph = [
    {
      '@type': 'Person',
      '@id': `${origin}/#person`,
      name: profile?.name ?? 'Victer',
      url: origin,
      jobTitle: profile?.role ?? 'Developer',
      address: { '@type': 'PostalAddress', addressCountry: profile?.location ?? 'ID' },
      sameAs: Object.values(profile?.links ?? {}).filter(Boolean),
    },
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: origin,
      name: profile?.name ?? 'Portfolio',
      description: profile?.tagline ?? '',
      publisher: { '@id': `${origin}/#person` },
      inLanguage: 'id-ID',
    },
    {
      '@type': 'ItemList',
      name: 'Proyek',
      itemListElement: (projects ?? []).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.name,
        description: p.summary ?? '',
        url: p.repo ?? origin,
      })),
    },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ── WRITE TO DISK ────────────────────────────────────────────────────────────

/**
 * Tulis sitemap.xml, robots.txt, llms.txt ke direktori publik.
 * Dipanggil oleh skrip build/deploy — bukan saat request (nol overhead).
 */
export function writeDiscoveryFiles(outDir, data) {
  mkdirSync(outDir, { recursive: true });
  const results = {};

  const sitemap = buildSitemap();
  writeFileSync(join(outDir, 'sitemap.xml'), sitemap.xml, 'utf8');
  results.sitemap = sitemap.count;

  writeFileSync(join(outDir, 'robots.txt'), buildRobots(), 'utf8');
  results.robots = true;

  if (data) {
    writeFileSync(join(outDir, 'llms.txt'), buildLlmsTxt(data), 'utf8');
    results.llms = true;

    writeFileSync(
      join(outDir, 'structured-data.json'),
      JSON.stringify(buildJsonLd(data), null, 2),
      'utf8'
    );
    results.jsonld = true;
  }

  return results;
}

// ── UTIL ─────────────────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
