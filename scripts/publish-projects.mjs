#!/usr/bin/env node
/**
 * Terbitkan proyek dari folder: projects/<nama>/project.md (+ cover + video).
 *
 * Cara pakai (cukup taruh folder di server, lalu jalankan atau biarkan watcher):
 *
 *   projects/
 *     kasir-toko/
 *       project.md      ← wajib: frontmatter + ringkasan
 *       cover.jpg       ← opsional: gambar sampul (jpg/png/webp)
 *       loop.mp4        ← opsional: video senyap pendek (proyek unggulan)
 *
 * Contoh project.md:
 *
 *   ---
 *   name: Kasir Toko
 *   subtitle: Kasir offline untuk toko kelontong
 *   stack: Python, SQLite, Telegram
 *   repo: https://github.com/VicterHong/kasir-toko
 *   featured: false
 *   order: 4
 *   ---
 *   Ringkasan satu paragraf. Paragraf kedua (opsional) menjadi "masalah".
 *
 * Hasilnya:
 *   - assets/js/data/projects.generated.js   (diimpor projects.js)
 *   - assets/projects/<slug>/cover.jpg, loop.mp4   (salinan aset)
 *
 * Aturan yang ditegakkan (proyek yang melanggar DITOLAK, bukan diperbaiki diam-diam):
 *   - slug hanya huruf kecil, angka, tanda hubung (dari nama folder)
 *   - name dan ringkasan wajib; ringkasan maks 600 karakter
 *   - repo harus https://
 *   - cover maks 600 KB, video maks 2 MB (anggaran halaman 2048 KB)
 *   - slug tidak boleh bentrok dengan proyek bawaan di projects.js
 *
 * Konten TERKUNCI (arsitektur, metrik) tidak pernah ditulis dari sini: itu
 * tetap di server token (~/.portfolio-token/content/<slug>.json).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BATAS = Object.freeze({ cover: 600 * 1024, loop: 2 * 1024 * 1024, ringkasan: 600 });
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const GAMBAR = ['.jpg', '.jpeg', '.png', '.webp'];

/** Frontmatter sederhana `kunci: nilai` — cukup untuk berkas tangan, tanpa dependensi. */
export function parseProjectMd(teks) {
  const s = String(teks ?? '').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(s);
  if (!m) return { meta: {}, body: s.trim() };
  const meta = {};
  for (const baris of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(baris.trim());
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, '');
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (/^-?\d+$/.test(v)) v = Number(v);
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: m[2].trim() };
}

/** Ubah satu folder menjadi entri proyek, atau lempar alasan penolakan. */
export function bacaProyek(dir, slug) {
  if (!SLUG_RE.test(slug)) throw new Error(`nama folder "${slug}" tidak sah (huruf kecil, angka, tanda hubung)`);
  const mdPath = join(dir, 'project.md');
  if (!existsSync(mdPath)) throw new Error('project.md tidak ada');
  const { meta, body } = parseProjectMd(readFileSync(mdPath, 'utf8'));
  const paragraf = body.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const name = String(meta.name ?? '').trim();
  if (!name) throw new Error('name wajib di frontmatter');
  if (!paragraf[0]) throw new Error('ringkasan wajib (paragraf setelah frontmatter)');
  if (paragraf[0].length > BATAS.ringkasan) throw new Error(`ringkasan ${paragraf[0].length} karakter, maks ${BATAS.ringkasan}`);
  if (meta.repo && !/^https:\/\//.test(String(meta.repo))) throw new Error('repo harus diawali https://');

  const berkas = readdirSync(dir);
  const cover = berkas.find((f) => /^cover\./i.test(f) && GAMBAR.includes(extname(f).toLowerCase()));
  const loop = berkas.find((f) => /^loop\.mp4$/i.test(f));
  if (cover && statSync(join(dir, cover)).size > BATAS.cover) throw new Error(`${cover} lebih dari ${BATAS.cover / 1024} KB`);
  if (loop && statSync(join(dir, loop)).size > BATAS.loop) throw new Error(`${loop} lebih dari ${BATAS.loop / 1024 / 1024} MB`);

  const stack = String(meta.stack ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return {
    entry: {
      slug,
      name,
      subtitle: String(meta.subtitle ?? '').trim(),
      summary: paragraf[0],
      problem: paragraf[1] ?? '',
      highlights: [],
      metrics: [],
      stack,
      ...(meta.repo ? { repo: String(meta.repo) } : {}),
      featured: meta.featured === true,
      variant: 'default',
      artLabel: String(meta.label ?? meta.subtitle ?? 'Proyek').trim(),
      ...(cover ? { cover: `assets/projects/${slug}/cover${extname(cover).toLowerCase()}`, coverAlt: String(meta.alt ?? `Tampilan ${name}`) } : {}),
      ...(loop ? { loop: `assets/projects/${slug}/loop.mp4` } : {}),
      order: Number.isFinite(meta.order) ? meta.order : 100,
      source: 'folder',
    },
    aset: [cover && [join(dir, cover), `cover${extname(cover).toLowerCase()}`], loop && [join(dir, loop), 'loop.mp4']].filter(Boolean),
  };
}

/** Slug proyek bawaan di projects.js (sumber tangan), supaya tidak bentrok. */
function slugBawaan(root) {
  const src = readFileSync(join(root, 'assets/js/data/projects.js'), 'utf8');
  const blok = /export const projects\s*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? '';
  return new Set([...blok.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
}

export function terbitkan({ root = ROOT, sumber = join(root, 'projects'), log = console.log } = {}) {
  const hasil = { diterbitkan: [], ditolak: [] };
  const bawaan = slugBawaan(root);
  const entri = [];
  const tujuanAset = join(root, 'assets', 'projects');
  if (existsSync(tujuanAset)) rmSync(tujuanAset, { recursive: true, force: true });

  if (existsSync(sumber)) {
    for (const d of readdirSync(sumber, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_')) continue;
      try {
        if (bawaan.has(d.name)) throw new Error('slug sudah dipakai proyek bawaan di projects.js');
        const { entry, aset } = bacaProyek(join(sumber, d.name), d.name);
        const ke = join(tujuanAset, d.name);
        mkdirSync(ke, { recursive: true });
        for (const [dari, nama] of aset) copyFileSync(dari, join(ke, nama));
        entri.push(entry);
        hasil.diterbitkan.push(d.name);
      } catch (error) {
        hasil.ditolak.push({ slug: d.name, alasan: error.message });
      }
    }
  }
  entri.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const isi = `// BERKAS HASIL: jangan disunting tangan. Sumbernya projects/<nama>/project.md,\n` +
    `// dibangun oleh scripts/publish-projects.mjs.\n` +
    `export const folderProjects = ${JSON.stringify(entri, null, 2)};\n`;
  const out = join(root, 'assets/js/data/projects.generated.js');
  const lama = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (lama !== isi) writeFileSync(out, isi);
  hasil.berubah = lama !== isi;

  log(`proyek dari folder: ${hasil.diterbitkan.length} terbit, ${hasil.ditolak.length} ditolak${hasil.berubah ? '' : ' (tidak ada perubahan)'}`);
  for (const t of hasil.ditolak) log(`  ✗ ${t.slug}: ${t.alasan}`);
  return hasil;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = terbitkan();
  process.exitCode = r.ditolak.length && process.argv.includes('--ketat') ? 1 : 0;
}
