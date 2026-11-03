import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishProjects } from '../../scripts/publish-projects.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-publisher-'));
  t.after(async () => { const { rmSync } = await import('node:fs'); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(root, 'projects'), { recursive: true });
  mkdirSync(join(root, 'assets/js/data'), { recursive: true });
  writeFileSync(join(root, 'assets/js/data/projects.generated.js'), 'export const uploadedProjects = [];\n');
  writeFileSync(join(root, 'assets/js/data/projects.js'), "export const projects = [\n  { slug: 'mina', name: 'MINA' },\n];\n");
  return root;
}
const jpg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
function add(root, slug, md, extra = {}) {
  const dir = join(root, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.md'), md);
  for (const [name, value] of Object.entries(extra)) writeFileSync(join(dir, name), value);
  return dir;
}
const md = `---\nname: Kasir Toko\nsubtitle: Kasir offline untuk toko\nstack: Python, SQLite\nrepo: https://github.com/VicterHong/kasir\n---\nKasir untuk pencatatan stok di toko kelontong.\n\nStok manual sulit dilacak.\n`;

test('beranda menghubungkan cover hasil upload tanpa mengubah kartu proyek bawaan', () => {
  const app = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /createProjectCover\(p\)/);
  assert.match(app, /petaGambar\.get\(p\.name\)\?\.url\s*\?\?\s*p\.cover/);
  const page = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');
  assert.match(page, /assets\/css\/uploaded-projects\.css/);
});

test('build memakai folder server tetapi tidak mempublikasikan project.md mentah', () => {
  const script = readFileSync(new URL('../../scripts/build-css.mjs', import.meta.url), 'utf8');
  assert.match(script, /publish-projects\.mjs/);
  assert.match(script, /LEWATI_SUMBER[\s\S]*'projects'/);
  const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\/projects\/$/m);
});

test('beranda membaca katalog folder tanpa mengubah tiga proyek bawaan', async (t) => {
  const root = fixture(t);
  const original = readFileSync(new URL('../../assets/js/data/projects.js', import.meta.url), 'utf8');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'assets/js/data/projects.js'), original);
  add(root, 'kasir-toko', md);
  publishProjects({ root });
  const { projects } = await import(new URL(`file://${join(root, 'assets/js/data/projects.js')}?v=${Date.now()}`));
  assert.equal(projects.length, 4);
  assert.deepEqual(projects.slice(0, 3).map(p => p.slug), ['mina', 'spareparts', 'whatsapp-bot']);
  assert.equal(projects[3].slug, 'kasir-toko');
  assert.equal(projects[3].gated, false);
});

test('folder project.md + cover muncul di katalog publik tanpa mengubah proyek bawaan', (t) => {
  const root = fixture(t);
  add(root, 'kasir-toko', md, { 'cover.jpg': jpg });
  const result = publishProjects({ root });
  assert.equal(result.changed, true);
  const generated = readFileSync(join(root, 'assets/js/data/projects.generated.js'), 'utf8');
  assert.match(generated, /kasir-toko/);
  assert.match(generated, /Kasir untuk pencatatan stok/);
  assert.match(generated, /assets\/projects\/kasir-toko\/cover\.jpg/);
  assert.ok(existsSync(join(root, 'assets/projects/kasir-toko/cover.jpg')));
  assert.doesNotMatch(generated, /Stok manual sulit dilacak/); // second paragraph isn't published
  assert.match(readFileSync(join(root, 'assets/js/data/projects.js'), 'utf8'), /mina/);
  assert.equal(result.published.length, 1);
});

test('menghapus cover menghapus salinan lama dari aset publik', (t) => {
  const root = fixture(t);
  const folder = add(root, 'kasir-toko', md, { 'cover.jpg': jpg });
  publishProjects({ root });
  rmSync(join(folder, 'cover.jpg'));
  const result = publishProjects({ root });
  assert.equal(result.changed, true);
  assert.equal(existsSync(join(root, 'assets/projects/kasir-toko/cover.jpg')), false);
});

test('symlink di target aset publik ditolak sebelum menulis ke luar repo', (t) => {
  const root = fixture(t);
  const external = mkdtempSync(join(tmpdir(), 'portfolio-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  add(root, 'kasir-toko', md, { 'cover.jpg': jpg });
  mkdirSync(join(root, 'assets/projects'), { recursive: true });
  symlinkSync(external, join(root, 'assets/projects/kasir-toko'));
  assert.throws(() => publishProjects({ root }), /symlink|target/);
  assert.equal(existsSync(join(external, 'cover.jpg')), false);
});

test('upload parsial atau nama bentrok ditolak tanpa mengubah katalog lama', (t) => {
  const root = fixture(t);
  add(root, 'kasir-toko', md, { 'cover.jpg': jpg });
  publishProjects({ root });
  const path = join(root, 'assets/js/data/projects.generated.js');
  const before = readFileSync(path, 'utf8');
  add(root, 'mina', md);
  assert.throws(() => publishProjects({ root }), /sudah dipakai/);
  assert.equal(readFileSync(path, 'utf8'), before);
  rmSync(join(root, 'projects/mina'), { recursive: true });
  add(root, 'rusak', md, { 'cover.jpg': Buffer.from('<script>alert(1)</script>') });
  assert.throws(() => publishProjects({ root }), /bukan media sah/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('mengedit metadata dan menghapus folder mengubah katalog secara deterministik', (t) => {
  const root = fixture(t);
  const folder = add(root, 'kasir-toko', md);
  assert.equal(publishProjects({ root }).changed, true);
  assert.equal(publishProjects({ root }).changed, false);
  writeFileSync(join(folder, 'project.md'), md.replace('Kasir Toko', 'Kasir Lapangan'));
  assert.equal(publishProjects({ root }).changed, true);
  assert.match(readFileSync(join(root, 'assets/js/data/projects.generated.js'), 'utf8'), /Kasir Lapangan/);
  rmSync(folder, { recursive: true });
  assert.equal(publishProjects({ root }).changed, true);
  assert.doesNotMatch(readFileSync(join(root, 'assets/js/data/projects.generated.js'), 'utf8'), /kasir-toko/);
});

test('tanpa folder server (CI) katalog committed tidak dikosongkan', (t) => {
  const root = fixture(t);
  const path = join(root, 'assets/js/data/projects.generated.js');
  writeFileSync(path, "export const uploadedProjects = [{slug:'kasir-toko'}];\n");
  rmSync(join(root, 'projects'), { recursive: true });
  assert.equal(publishProjects({ root }).skipped, true);
  assert.match(readFileSync(path, 'utf8'), /kasir-toko/);
});
