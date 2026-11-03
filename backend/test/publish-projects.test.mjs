import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProjectMd, bacaProyek, terbitkan, BATAS } from '../../scripts/publish-projects.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;

function situsSementara() {
  const root = mkdtempSync(join(tmpdir(), 'porto-'));
  mkdirSync(join(root, 'assets/js/data'), { recursive: true });
  cpSync(join(ROOT, 'assets/js/data/projects.js'), join(root, 'assets/js/data/projects.js'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}
function proyek(root, slug, md, aset = {}) {
  const d = join(root, 'projects', slug);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'project.md'), md);
  for (const [n, isi] of Object.entries(aset)) writeFileSync(join(d, n), isi);
}
const MD = `---\nname: Kasir Toko\nsubtitle: Kasir offline\nstack: Python, SQLite\nrepo: https://github.com/VicterHong/kasir\norder: 4\n---\nKasir untuk toko kelontong tanpa internet.\n\nPencatatan manual sering salah hitung.\n`;
const diam = () => {};

test('frontmatter dibaca: string, angka, boolean', () => {
  const { meta, body } = parseProjectMd('---\nname: A\nfeatured: true\norder: 3\n---\nIsi');
  assert.deepEqual(meta, { name: 'A', featured: true, order: 3 });
  assert.equal(body, 'Isi');
});

test('folder yang benar menjadi entri proyek lengkap, aset disalin', () => {
  const root = situsSementara();
  proyek(root, 'kasir-toko', MD, { 'cover.jpg': 'JPG', 'loop.mp4': 'MP4' });
  const r = terbitkan({ root, log: diam });
  assert.deepEqual(r.diterbitkan, ['kasir-toko']);
  const gen = readFileSync(join(root, 'assets/js/data/projects.generated.js'), 'utf8');
  assert.match(gen, /"slug": "kasir-toko"/);
  assert.match(gen, /"summary": "Kasir untuk toko kelontong tanpa internet."/);
  assert.match(gen, /"problem": "Pencatatan manual sering salah hitung."/);
  assert.match(gen, /"cover": "assets\/projects\/kasir-toko\/cover.jpg"/);
  assert.ok(existsSync(join(root, 'assets/projects/kasir-toko/cover.jpg')));
  assert.ok(existsSync(join(root, 'assets/projects/kasir-toko/loop.mp4')));
});

test('folder yang melanggar ditolak dengan alasan, tidak diterbitkan diam-diam', () => {
  const root = situsSementara();
  proyek(root, 'Huruf-Besar', MD);
  proyek(root, 'tanpa-nama', '---\nsubtitle: x\n---\nIsi');
  proyek(root, 'repo-http', MD.replace('https://', 'http://'));
  proyek(root, 'mina', MD);
  proyek(root, 'cover-berat', MD, { 'cover.jpg': Buffer.alloc(BATAS.cover + 1) });
  const r = terbitkan({ root, log: diam });
  assert.deepEqual(r.diterbitkan, []);
  const alasan = Object.fromEntries(r.ditolak.map((t) => [t.slug, t.alasan]));
  assert.match(alasan['Huruf-Besar'], /tidak sah/);
  assert.match(alasan['tanpa-nama'], /name wajib/);
  assert.match(alasan['repo-http'], /https/);
  assert.match(alasan.mina, /proyek bawaan/);
  assert.match(alasan['cover-berat'], /KB/);
});

test('folder berawalan _ atau . dilewati (draf)', () => {
  const root = situsSementara();
  proyek(root, '_draf', MD);
  const r = terbitkan({ root, log: diam });
  assert.equal(r.diterbitkan.length + r.ditolak.length, 0);
});

test('berkas hasil tidak ditulis ulang kalau isinya sama (watcher tidak berulang)', () => {
  const root = situsSementara();
  proyek(root, 'kasir-toko', MD);
  assert.equal(terbitkan({ root, log: diam }).berubah, true);
  assert.equal(terbitkan({ root, log: diam }).berubah, false);
});

test('proyek folder bergabung ke daftar projects tanpa menimpa proyek bawaan', async () => {
  const root = situsSementara();
  proyek(root, 'kasir-toko', MD);
  terbitkan({ root, log: diam });
  const mod = await import(`file://${join(root, 'assets/js/data/projects.js')}?t=${Date.now()}`);
  const slugs = mod.projects.map((p) => p.slug);
  assert.deepEqual(slugs.slice(0, 3), ['mina', 'spareparts', 'whatsapp-bot']);
  assert.ok(slugs.includes('kasir-toko'));
});

test('ringkasan terlalu panjang ditolak', () => {
  const root = situsSementara();
  proyek(root, 'panjang', `---\nname: P\n---\n${'a'.repeat(BATAS.ringkasan + 1)}`);
  assert.throws(() => bacaProyek(join(root, 'projects/panjang'), 'panjang'), /maks/);
});
