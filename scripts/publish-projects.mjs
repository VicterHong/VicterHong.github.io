import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const MEDIA = Object.freeze({ '.jpg': 600 * 1024, '.jpeg': 600 * 1024, '.png': 600 * 1024, '.webp': 600 * 1024, '.mp4': 2 * 1024 * 1024 });
const ALLOWED_FIELDS = new Set(['name', 'subtitle', 'stack', 'repo', 'cover_alt', 'featured', 'order']);

function metadata(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  if (!m) throw new Error('project.md harus memakai frontmatter --- dan ringkasan');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error('format frontmatter harus key: value');
    const [, key, value] = pair;
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`field ${key} tidak diizinkan di katalog publik`);
    if (Object.hasOwn(meta, key)) throw new Error(`field ${key} duplikat`);
    meta[key] = value.trim();
  }
  const summary = m[2].split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ').trim();
  if (!meta.name || meta.name.length > 100) throw new Error('name wajib (maks 100 karakter)');
  if (!summary || summary.length > 600) throw new Error('ringkasan wajib (maks 600 karakter)');
  if (meta.subtitle?.length > 160) throw new Error('subtitle maks 160 karakter');
  if (meta.repo) {
    let u;
    try { u = new URL(meta.repo); } catch { throw new Error('repo URL tidak sah'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('repo wajib HTTPS tanpa kredensial');
  }
  if (meta.featured && !['true', 'false'].includes(meta.featured)) throw new Error('featured harus true/false');
  if (meta.order && !/^\d{1,4}$/.test(meta.order)) throw new Error('order harus angka 0–9999');
  return { meta, summary };
}

function validMedia(file, bytes) {
  const ext = extname(file).toLowerCase();
  if (bytes.length > MEDIA[ext]) throw new Error(`${file} melebihi batas ukuran`);
  if (ext === '.jpg' || ext === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === '.png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (ext === '.webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (ext === '.mp4') return bytes.toString('ascii', 4, 8) === 'ftyp';
  return false;
}

function readProject(folder, slug, builtins) {
  if (!SLUG.test(slug)) throw new Error(`slug ${slug} tidak sah`);
  if (builtins.has(slug)) throw new Error(`slug ${slug} sudah dipakai proyek bawaan`);
  const entries = readdirSync(folder, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isSymbolicLink() || !e.isFile()) throw new Error(`symlink/direktori dilarang: ${e.name}`);
    if (e.name !== 'project.md' && !/^cover\.(jpe?g|png|webp)$/.test(e.name) && e.name !== 'loop.mp4') {
      throw new Error(`berkas tidak diizinkan: ${e.name}`);
    }
    files.push(e.name);
  }
  if (!files.includes('project.md')) throw new Error('project.md tidak ada');
  const path = join(folder, 'project.md');
  if (lstatSync(path).size > 16_384) throw new Error('project.md melebihi 16 KB');
  const { meta, summary } = metadata(readFileSync(path, 'utf8'));
  const cover = files.find((x) => x.startsWith('cover.'));
  if (files.filter((x) => x.startsWith('cover.')).length > 1) throw new Error('hanya satu cover yang boleh diunggah');
  const media = [];
  for (const file of [cover, files.includes('loop.mp4') && 'loop.mp4'].filter(Boolean)) {
    const bytes = readFileSync(join(folder, file));
    if (!validMedia(file, bytes)) throw new Error(`${file} bukan media sah atau terlalu besar`);
    media.push({ file, bytes });
  }
  const entry = {
    slug,
    name: meta.name,
    subtitle: meta.subtitle || '',
    summary,
    problem: '',
    highlights: [],
    metrics: [],
    stack: (meta.stack || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8),
    featured: meta.featured === 'true',
    gated: false,
    variant: 'default',
    artLabel: meta.subtitle || 'Proyek',
    ...(meta.repo ? { repo: meta.repo } : {}),
    ...(cover ? { cover: `assets/projects/${slug}/${cover}`, coverAlt: meta.cover_alt || `Sampul ${meta.name}` } : {}),
    ...(files.includes('loop.mp4') ? { loop: `assets/projects/${slug}/loop.mp4` } : {}),
  };
  const digest = createHash('sha256');
  digest.update(JSON.stringify(entry));
  for (const item of media) digest.update(item.bytes);
  return { entry, media, order: Number(meta.order || 100), digest: digest.digest('hex') };
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.new-${process.pid}`;
  try { writeFileSync(tmp, content, { mode: 0o644 }); renameSync(tmp, path); }
  finally { if (existsSync(tmp)) rmSync(tmp); }
}

/**
 * Compile public-only metadata from server folder. Never publish raw project.md.
 * A failed validation changes NOTHING, so an incomplete upload cannot go live.
 * In CI (no projects/ folder), leave generated catalog intact.
 */
export function publishProjects({ root = DEFAULT_ROOT } = {}) {
  const source = join(root, 'projects');
  if (!existsSync(source)) return { changed: false, published: [], skipped: true };
  const own = readFileSync(join(root, 'assets/js/data/projects.js'), 'utf8');
  const builtinBlock = /export const projects\s*=\s*\[([\s\S]*?)\n\];/.exec(own)?.[1] || '';
  const builtins = new Set([...builtinBlock.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]));
  const rows = [];
  for (const dir of readdirSync(source, { withFileTypes: true })) {
    if (dir.name.startsWith('_') || dir.name.startsWith('.')) continue;
    if (dir.isSymbolicLink() || !dir.isDirectory()) throw new Error(`entri projects/${dir.name} bukan folder biasa`);
    rows.push(readProject(join(source, dir.name), dir.name, builtins));
  }
  rows.sort((a, b) => a.order - b.order || a.entry.name.localeCompare(b.entry.name));
  const generatedPath = join(root, 'assets/js/data/projects.generated.js');
  const mediaRoot = join(root, 'assets/projects');
  if (existsSync(mediaRoot)) {
    const state = lstatSync(mediaRoot);
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error('target aset bukan direktori aman (symlink)');
  }
  // Validasi semua tujuan sebelum menyentuh berkas apa pun. Satu symlink di
  // assets/projects/<slug> tidak boleh membuat salinan keluar dari repo.
  for (const row of rows) {
    const path = join(mediaRoot, row.entry.slug);
    if (existsSync(path)) {
      const state = lstatSync(path);
      if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`target aset ${row.entry.slug} symlink/tidak aman`);
    }
  }
  const manifestPath = join(mediaRoot, 'index.json');
  let oldManifest = {};
  try { oldManifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* first run */ }
  const manifest = Object.fromEntries(rows.map((row) => [row.entry.slug, row.digest]));
  const output = `// Hasil publish-projects.mjs. Katalog PUBLIK saja; jangan taruh detail terkunci.\nexport const uploadedProjects = ${JSON.stringify(rows.map((row) => row.entry), null, 2)};\n`;
  const oldOutput = existsSync(generatedPath) ? readFileSync(generatedPath, 'utf8') : '';
  const changed = output !== oldOutput || JSON.stringify(manifest) !== JSON.stringify(oldManifest);
  if (!changed) return { changed: false, published: rows.map((r) => r.entry.slug) };
  for (const row of rows) {
    const destination = join(mediaRoot, row.entry.slug);
    mkdirSync(destination, { recursive: true });
    const keep = new Set(row.media.map((x) => x.file));
    for (const old of readdirSync(destination, { withFileTypes: true })) {
      if (!keep.has(old.name) && (/^cover\.(?:jpe?g|png|webp)$/.test(old.name) || old.name === 'loop.mp4')) {
        const stale = join(destination, old.name);
        if (old.isSymbolicLink()) throw new Error(`target aset ${row.entry.slug}/${old.name} symlink/tidak aman`);
        rmSync(stale);
      }
    }
    for (const item of row.media) atomicWrite(join(destination, item.file), item.bytes);
  }
  for (const old of Object.keys(oldManifest)) {
    if (!Object.hasOwn(manifest, old) && SLUG.test(old)) rmSync(join(mediaRoot, old), { recursive: true, force: true });
  }
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  atomicWrite(generatedPath, output);
  return { changed: true, published: rows.map((r) => r.entry.slug) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = publishProjects();
    console.log(`folder proyek: ${result.published.length} ditampilkan${result.skipped ? ' (CI tanpa folder sumber: katalog dipertahankan)' : ''}`);
  } catch (error) {
    console.error(`folder proyek DITOLAK: ${error.message}`);
    process.exitCode = 1;
  }
}
