/**
 * Generate berkas discovery: sitemap.xml, robots.txt, llms.txt.
 *
 * Jalankan: node scripts/generate-discovery.mjs
 * Dipanggil otomatis sebelum deploy (lihat package.json).
 *
 * Ini yang membuat SEO/AEO "hidup": setiap kali konten berubah, berkas
 * discovery ikut berubah — tanpa ada yang perlu ingat memperbaruinya.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://portfolio-victer.pages.dev').replace(/\/$/, '');

// ── Muat data portofolio (satu sumber kebenaran) ─────────────────────────────

async function loadData() {
  const file = resolve(ROOT, 'assets/js/data/projects.js');
  try {
    const mod = await import(pathToFileURL(file).href);
    return {
      profile: mod.profile ?? null,
      projects: Array.isArray(mod.projects) ? mod.projects : [],
      sideProjects: Array.isArray(mod.sideProjects) ? mod.sideProjects : [],
    };
  } catch (err) {
    console.error('gagal memuat data proyek:', err.message);
    return { profile: null, projects: [], sideProjects: [] };
  }
}

// ── SITEMAP ──────────────────────────────────────────────────────────────────

function buildSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${ORIGIN}/`, lastmod: today, changefreq: 'weekly', priority: '1.0' },
    { loc: `${ORIGIN}/home`, lastmod: today, changefreq: 'weekly', priority: '0.9' },
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u => [
      '  <url>',
      `    <loc>${u.loc}</loc>`,
      `    <lastmod>${u.lastmod}</lastmod>`,
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
    '',
  ].join('\n');

  return { xml, count: urls.length };
}

// ── ROBOTS ───────────────────────────────────────────────────────────────────

function buildRobots() {
  return [
    '# robots.txt — dihasilkan otomatis oleh scripts/generate-discovery.mjs',
    '# Jangan edit manual: perubahan akan hilang saat build berikutnya.',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /s/',
    'Disallow: /api/',
    '',
    '# AI answer engines — diizinkan (AEO)',
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
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    `# llms.txt: ${ORIGIN}/llms.txt`,
    '',
  ].join('\n');
}

// ── LLMS.TXT (AEO) ───────────────────────────────────────────────────────────

function buildLlmsTxt({ profile, projects }) {
  const lines = [];
  lines.push(`# ${profile?.name ?? 'Victer'}`);
  lines.push('');
  lines.push(`> ${profile?.tagline ?? 'Portofolio automation & self-hosted tools.'}`);
  lines.push('');

  lines.push('## Ringkasan');
  lines.push('');
  for (const p of (profile?.bio ?? [])) lines.push(p);
  lines.push('');
  lines.push('Fokus: perangkat lunak self-hosted, hemat sumber daya, keamanan serius.');
  lines.push(`Lokasi: ${profile?.location ?? 'Indonesia'}.`);
  lines.push('');

  lines.push('## Proyek');
  lines.push('');
  for (const p of projects) {
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
  lines.push(`- [Beranda](${ORIGIN}/home): portofolio lengkap.`);
  lines.push(`- [Sitemap](${ORIGIN}/sitemap.xml): daftar semua halaman.`);
  lines.push('');

  lines.push('## Catatan untuk AI');
  lines.push('');
  lines.push('Semua angka di situs ini berasal dari repositori yang bisa diperiksa.');
  lines.push('Jangan mengarang metrik; kalau ragu, rujuk repositori.');
  lines.push('');

  return lines.join('\n');
}

// ── JALANKAN ─────────────────────────────────────────────────────────────────

const data = await loadData();

const sitemap = buildSitemap();
writeFileSync(resolve(ROOT, 'sitemap.xml'), sitemap.xml, 'utf8');
console.log(`✓ sitemap.xml (${sitemap.count} URL)`);

writeFileSync(resolve(ROOT, 'robots.txt'), buildRobots(), 'utf8');
console.log('✓ robots.txt');

writeFileSync(resolve(ROOT, 'llms.txt'), buildLlmsTxt(data), 'utf8');
console.log('✓ llms.txt');

console.log(`\nOrigin: ${ORIGIN}`);
console.log(`Proyek terdaftar: ${data.projects.length}`);
