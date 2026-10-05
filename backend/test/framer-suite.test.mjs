/**
 * Test CMS, SEO/AEO, Performance, Collaborate, Grow, Publish.
 * Jalankan: node --test test/framer-suite.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Database sementara untuk seluruh berkas test.
const tmp = mkdtempSync(join(tmpdir(), 'framer-suite-'));
process.env.DB_PATH = join(tmp, 'test.db');

const { openDb, closeDb } = await import('../src/db.mjs');
const {
  createCollection, getCollection, listCollections,
  saveItem, getItem, listItems, setItemStatus, deleteItem,
  listVersions, rollback,
} = await import('../src/cms.mjs');
const { buildSitemap, buildRobots, buildLlmsTxt, buildJsonLd } = await import('../src/seo.mjs');
const { auditAssets, recordVital, vitalsSummary, BUDGETS } = await import('../src/performance.mjs');
const {
  createBranch, getBranch, listBranches, recordChange, discardBranch, mergeBranch,
  addComment, listComments, resolveComment, moderateComment, commentStats,
} = await import('../src/collaborate.mjs');
const {
  createExperiment, getExperiment, listExperiments, setStatus,
  pickVariant, recordEvent, results, twoProportionZ,
} = await import('../src/grow.mjs');
const { preflight, verify, recordRelease, listReleases } = await import('../src/publish.mjs');

openDb(process.env.DB_PATH);

test.after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

// ── CMS ──────────────────────────────────────────────────────────────────────

test('CMS: buat koleksi dan simpan item', () => {
  const col = createCollection({
    slug: 'catatan',
    title: 'Catatan',
    fields: [{ name: 'judul', type: 'text', required: true }],
  });
  assert.equal(col.slug, 'catatan');

  const item = saveItem({
    collection: 'catatan',
    itemSlug: 'rilis-pertama',
    data: { judul: 'Rilis pertama' },
    status: 'draft',
  });
  assert.equal(item.item_slug, 'rilis-pertama');
  assert.equal(item.status, 'draft');
  assert.equal(item.version, 1);
});

test('CMS: draft tidak terlihat publik, published terlihat', () => {
  saveItem({ collection: 'catatan', itemSlug: 'rahasia', data: { x: 1 }, status: 'draft' });

  const publicList = listItems('catatan', { includeDraft: false });
  assert.ok(!publicList.some(i => i.item_slug === 'rahasia'), 'draft tidak boleh muncul di publik');

  setItemStatus('catatan', 'rahasia', 'published');
  const afterPublish = listItems('catatan', { includeDraft: false });
  assert.ok(afterPublish.some(i => i.item_slug === 'rahasia'), 'published harus muncul');
});

test('CMS: setiap simpanan menambah versi (riwayat tidak hilang)', () => {
  saveItem({ collection: 'catatan', itemSlug: 'berversi', data: { v: 1 }, status: 'draft' });
  saveItem({ collection: 'catatan', itemSlug: 'berversi', data: { v: 2 }, status: 'draft' });
  saveItem({ collection: 'catatan', itemSlug: 'berversi', data: { v: 3 }, status: 'draft' });

  const versions = listVersions('catatan', 'berversi');
  assert.equal(versions.length, 3, 'tiga simpanan = tiga versi');
  assert.equal(versions[0].version, 3, 'versi terbaru di depan');
});

test('CMS: rollback mengembalikan data versi lama (dan mencatat versi baru)', () => {
  saveItem({ collection: 'catatan', itemSlug: 'rollback', data: { n: 'lama' }, status: 'draft' });
  saveItem({ collection: 'catatan', itemSlug: 'rollback', data: { n: 'baru' }, status: 'draft' });

  const restored = rollback('catatan', 'rollback', 1);
  assert.equal(restored.data.n, 'lama', 'data kembali ke versi 1');
  assert.equal(restored.version, 3, 'rollback membuat versi baru (v3) — riwayat tetap utuh');
});

test('CMS: slug jahat ditolak (anti path traversal)', () => {
  assert.throws(() => createCollection({ slug: '../etc', title: 'x' }), /tidak valid/);
  assert.throws(() => saveItem({ collection: 'catatan', itemSlug: 'a/b', data: {} }), /tidak valid/);
});

test('CMS: hapus item menghapus versinya juga', () => {
  saveItem({ collection: 'catatan', itemSlug: 'untuk-dihapus', data: {}, status: 'draft' });
  assert.equal(deleteItem('catatan', 'untuk-dihapus'), true);
  assert.equal(getItem('catatan', 'untuk-dihapus'), null);
  assert.equal(listVersions('catatan', 'untuk-dihapus').length, 0);
});

// ── SEO / AEO ────────────────────────────────────────────────────────────────

test('SEO: sitemap XML valid dan memuat halaman utama', () => {
  const { xml, count } = buildSitemap();
  assert.ok(xml.startsWith('<?xml'), 'harus XML');
  assert.ok(xml.includes('<urlset'), 'harus urlset');
  assert.ok(xml.includes('/home'), 'harus memuat /home');
  assert.ok(count >= 2, 'minimal 2 URL');
});

test('SEO: sitemap memuat item CMS yang published', () => {
  saveItem({ collection: 'catatan', itemSlug: 'di-sitemap', data: {}, status: 'published' });
  const { xml } = buildSitemap();
  assert.ok(xml.includes('di-sitemap'), 'item published masuk sitemap');
});

test('SEO: robots.txt mengizinkan AI bot (AEO) dan memblokir halaman token', () => {
  const robots = buildRobots();
  assert.ok(robots.includes('Disallow: /s/'), 'halaman token tidak boleh diindeks');
  assert.ok(robots.includes('GPTBot'), 'GPTBot diizinkan (AEO)');
  assert.ok(robots.includes('ClaudeBot'), 'ClaudeBot diizinkan (AEO)');
  assert.ok(robots.includes('PerplexityBot'), 'PerplexityBot diizinkan (AEO)');
  assert.ok(robots.includes('Sitemap:'), 'harus menunjuk sitemap');
});

test('AEO: llms.txt memuat ringkasan + proyek + catatan untuk AI', () => {
  const txt = buildLlmsTxt({
    profile: { name: 'Victer', tagline: 'Alat otomasi', bio: ['Bio satu.'], location: 'Indonesia' },
    projects: [{ name: 'MINA', summary: 'Remote control.', stack: ['Python'], repo: 'https://github.com/x/y' }],
  });
  assert.ok(txt.startsWith('# Victer'), 'harus mulai dengan H1 nama');
  assert.ok(txt.includes('> Alat otomasi'), 'ringkasan blok kutipan');
  assert.ok(txt.includes('### MINA'), 'proyek terdaftar');
  assert.ok(txt.includes('Catatan untuk AI'), 'panduan untuk AI');
});

test('AEO: JSON-LD punya Person, WebSite, ItemList', () => {
  const ld = buildJsonLd({
    profile: { name: 'Victer', links: { github: 'https://github.com/VicterHong' } },
    projects: [{ name: 'MINA', summary: 'x' }],
  });
  const types = ld['@graph'].map(g => g['@type']);
  assert.ok(types.includes('Person'));
  assert.ok(types.includes('WebSite'));
  assert.ok(types.includes('ItemList'));
});

// ── PERFORMANCE ──────────────────────────────────────────────────────────────

test('Performance: audit aset menghitung ukuran per jenis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  mkdirSync(join(dir, 'css'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<html>' + 'x'.repeat(500) + '</html>');
  writeFileSync(join(dir, 'css', 'a.css'), 'y'.repeat(1000));
  writeFileSync(join(dir, 'app.js'), 'z'.repeat(2000));
  writeFileSync(join(dir, 'video.mp4'), 'v'.repeat(99999)); // harus dikecualikan

  const audit = auditAssets(dir);
  assert.ok(audit.bytes.html > 0, 'html dihitung');
  assert.ok(audit.bytes.css >= 1000, 'css dihitung');
  assert.ok(audit.bytes.js >= 2000, 'js dihitung');
  assert.ok(!audit.heaviest.some(f => f.path.endsWith('.mp4')), 'video dikecualikan');
  rmSync(dir, { recursive: true, force: true });
});

test('Performance: pelanggaran anggaran dilaporkan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-big-'));
  // JS besar HARUS dirujuk halaman — anggaran dihitung per halaman
  // (yang benar-benar dimuat pengunjung), bukan total seluruh repo.
  // Berkas besar yang tidak dirujuk tidak membebani siapa pun.
  writeFileSync(join(dir, 'index.html'),
    `<html><script src="big.js"></script></html>`);
  writeFileSync(join(dir, 'big.js'), 'x'.repeat(BUDGETS.maxJsBytes + 1000));

  const audit = auditAssets(dir);
  assert.equal(audit.ok, false, 'harus melaporkan pelanggaran');
  assert.ok(audit.violations.some(v => v.rule === 'maxJsBytes'));
  rmSync(dir, { recursive: true, force: true });
});

test('Performance: vital tercatat dan ringkasan p75 benar', () => {
  for (let i = 1; i <= 10; i++) {
    recordVital({ name: 'lcp', value: i * 100, rating: 'good', path: '/home' });
  }
  const summary = vitalsSummary({ days: 1 });
  assert.equal(summary.metrics.lcp.samples, 10);
  // p75 dari 100..1000 → indeks ke-7 → 800
  assert.equal(summary.metrics.lcp.p75, 800);
});

test('Performance: nama metrik tak dikenal ditolak', () => {
  assert.equal(recordVital({ name: 'ngawur', value: 1 }), false);
  assert.equal(recordVital({ name: 'lcp', value: -5 }), false);
});

// ── COLLABORATE ──────────────────────────────────────────────────────────────

test('Collaborate: branch mencatat perubahan tanpa menyentuh produksi', () => {
  createBranch({ name: 'fitur-baru', message: 'coba ubah hero' });
  recordChange({
    branch: 'fitur-baru',
    collection: 'catatan',
    itemSlug: 'berversi',
    action: 'update',
    payload: { data: { v: 99 }, status: 'published' },
  });

  // Produksi belum berubah.
  const prod = getItem('catatan', 'berversi');
  assert.notEqual(prod.data.v, 99, 'branch tidak boleh mengubah produksi');

  const branch = getBranch('fitur-baru');
  assert.equal(branch.changes.length, 1);
});

test('Collaborate: merge menerapkan perubahan ke produksi', () => {
  const result = mergeBranch('fitur-baru', (change) => {
    saveItem({
      collection: change.collection,
      itemSlug: change.item_slug,
      data: change.payload.data,
      status: change.payload.status,
    });
    return true;
  });
  assert.equal(result.ok, true, 'merge harus berhasil');

  const prod = getItem('catatan', 'berversi');
  assert.equal(prod.data.v, 99, 'perubahan branch sudah masuk produksi');
  assert.equal(getBranch('fitur-baru').status, 'merged');
});

test('Collaborate: merge branch tertutup ditolak', () => {
  const result = mergeBranch('fitur-baru', () => true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'branch_tidak_terbuka');
});

test('Collaborate: discard menutup branch tanpa merge', () => {
  createBranch({ name: 'dibuang' });
  discardBranch('dibuang');
  assert.equal(getBranch('dibuang').status, 'discarded');
  assert.ok(listBranches({ status: 'discarded' }).some(b => b.name === 'dibuang'));
});

test('Collaborate: komentar bisa ditambah dan di-resolve', () => {
  const { id, status } = addComment({ target: '/home', anchor: 'hero-title', body: 'Perbesar judul?', author: 'reviewer' });
  assert.ok(id > 0);
  // A8: komentar publik masuk sebagai 'pending' — belum tampil sampai disetujui.
  assert.equal(status, 'pending', 'komentar publik harus menunggu moderasi');

  // Halaman publik TIDAK melihat komentar yang belum disetujui.
  let comments = listComments({ target: '/home', resolved: false });
  assert.equal(comments.length, 0, 'komentar pending tidak boleh tampil di publik');

  // Panel admin melihatnya (status eksplisit).
  comments = listComments({ target: '/home', resolved: false, status: 'pending' });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].anchor, 'hero-title');

  // Setelah disetujui, baru tampil di publik.
  moderateComment(id, 'approved');
  comments = listComments({ target: '/home', resolved: false });
  assert.equal(comments.length, 1, 'komentar approved tampil di publik');

  resolveComment(id, true);
  comments = listComments({ target: '/home', resolved: false });
  assert.equal(comments.length, 0, 'setelah resolve tidak muncul di daftar terbuka');
});

test('Collaborate: moderasi menyembunyikan komentar yang ditolak', () => {
  const { id } = addComment({ target: '/moderasi', body: 'SPAM beli obat murah', author: 'spammer' });

  // Sebelum moderasi: tidak tampil di publik, tampil di panel admin.
  assert.equal(listComments({ target: '/moderasi' }).length, 0, 'pending tidak tampil di publik');
  assert.equal(listComments({ target: '/moderasi', status: 'pending' }).length, 1);

  // Ditolak → tetap tidak tampil di publik, dan hilang dari daftar pending.
  moderateComment(id, 'rejected');
  assert.equal(listComments({ target: '/moderasi' }).length, 0, 'rejected tidak tampil di publik');
  assert.equal(listComments({ target: '/moderasi', status: 'pending' }).length, 0, 'sudah tidak pending');
  assert.equal(listComments({ target: '/moderasi', status: 'rejected' }).length, 1);

  // status: null = semua (dipakai panel admin).
  assert.equal(listComments({ target: '/moderasi', status: null }).length, 1);
});

test('Collaborate: status moderasi tidak dikenal ditolak', () => {
  const { id } = addComment({ target: '/moderasi2', body: 'tes validasi' });
  assert.throws(() => moderateComment(id, 'hapus'), /tidak dikenal/);
  assert.throws(() => moderateComment(id, ''), /tidak dikenal/);
  // Nilai yang sah tetap diterima.
  assert.equal(moderateComment(id, 'approved').changed, 1);
});

test('Collaborate: statistik moderasi menghitung tiap status', () => {
  const before = commentStats();
  addComment({ target: '/stat', body: 'satu' });
  addComment({ target: '/stat', body: 'dua' });
  const after = commentStats();
  assert.equal(after.pending, before.pending + 2, 'dua komentar baru masuk antrean pending');
  assert.equal(after.total, before.total + 2);
});

test('Collaborate: komentar admin tidak perlu moderasi sendiri', () => {
  const { status } = addComment({ target: '/admin-komentar', body: 'catatan internal', asAdmin: true });
  assert.equal(status, 'approved', 'komentar admin langsung tampil');
  assert.equal(listComments({ target: '/admin-komentar' }).length, 1);
});

test('Collaborate: komentar kosong ditolak', () => {
  assert.throws(() => addComment({ target: '/home', body: '   ' }), /kosong/);
});

// ── GROW ─────────────────────────────────────────────────────────────────────

test('Grow: varian deterministik per pengunjung', () => {
  createExperiment({ slug: 'hero-test', name: 'Hero test', variants: ['control', 'variant'] });
  setStatus('hero-test', 'running');

  const a1 = pickVariant('hero-test', 'visitor-1');
  const a2 = pickVariant('hero-test', 'visitor-1');
  assert.equal(a1, a2, 'pengunjung sama = varian sama (syarat eksperimen sah)');
});

test('Grow: eksperimen draft tidak memberi varian', () => {
  createExperiment({ slug: 'belum-jalan', name: 'x', variants: ['a', 'b'] });
  assert.equal(pickVariant('belum-jalan', 'v1'), null);
});

test('Grow: uji-z dua proporsi — beda besar = signifikan', () => {
  const test1 = twoProportionZ(
    { exposed: 1000, converted: 100 },  // 10%
    { exposed: 1000, converted: 200 },  // 20%
  );
  assert.ok(test1.p < 0.001, `p harus sangat kecil, dapat ${test1.p}`);
});

test('Grow: uji-z dua proporsi — beda kecil = tidak signifikan', () => {
  const test1 = twoProportionZ(
    { exposed: 100, converted: 10 },
    { exposed: 100, converted: 11 },
  );
  assert.ok(test1.p > 0.05, `p harus besar, dapat ${test1.p}`);
});

test('Grow: hasil eksperimen — sampel kecil diberi peringatan jujur', () => {
  recordEvent({ slug: 'hero-test', variant: 'control', event: 'exposure', visitor: 'v1' });
  recordEvent({ slug: 'hero-test', variant: 'control', event: 'conversion', visitor: 'v1' });
  recordEvent({ slug: 'hero-test', variant: 'variant', event: 'exposure', visitor: 'v2' });

  const r = results('hero-test');
  assert.equal(r.verdict.state, 'insufficient', 'sampel kecil harus jujur bilang belum cukup');
});

test('Grow: hasil eksperimen — sampel besar menentukan pemenang', () => {
  createExperiment({ slug: 'besar', name: 'Besar', variants: ['control', 'variant'] });
  setStatus('besar', 'running');
  for (let i = 0; i < 500; i++) {
    recordEvent({ slug: 'besar', variant: 'control', event: 'exposure', visitor: `c${i}` });
    if (i < 50) recordEvent({ slug: 'besar', variant: 'control', event: 'conversion', visitor: `c${i}` });
    recordEvent({ slug: 'besar', variant: 'variant', event: 'exposure', visitor: `v${i}` });
    if (i < 120) recordEvent({ slug: 'besar', variant: 'variant', event: 'conversion', visitor: `v${i}` });
  }

  const r = results('besar');
  assert.equal(r.verdict.state, 'winner');
  assert.equal(r.verdict.winner, 'variant');
  assert.ok(r.verdict.lift > 0, 'lift positif');
});

// ── PUBLISH ──────────────────────────────────────────────────────────────────

test('Publish: preflight memeriksa berkas wajib', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  writeFileSync(join(dir, 'home.html'), '<html></html>');
  // index.html, 404.html, robots.txt, sitemap.xml sengaja TIDAK dibuat

  const result = preflight(dir);
  assert.equal(result.ok, false, 'harus gagal karena berkas hilang');
  const missing = result.checks.filter(c => !c.ok && c.name.startsWith('file:'));
  assert.ok(missing.length >= 3, 'melaporkan berkas yang hilang');
  rmSync(dir, { recursive: true, force: true });
});

test('Publish: preflight mendeteksi kebocoran rahasia', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-secret-'));
  for (const f of ['home.html', 'index.html', '404.html', 'robots.txt', 'sitemap.xml']) {
    writeFileSync(join(dir, f), '<html></html>');
  }
  writeFileSync(join(dir, 'bocor.js'), 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";');

  const result = preflight(dir);
  const secretCheck = result.checks.find(c => c.name === 'no-secret-leak');
  assert.equal(secretCheck.ok, false, 'kebocoran harus terdeteksi');
  assert.ok(secretCheck.detail.includes('bocor.js'));
  rmSync(dir, { recursive: true, force: true });
});

test('Publish: verify menangkap URL mati tanpa melempar', async () => {
  const result = await verify('http://127.0.0.1:1/tidak-ada', { timeoutMs: 2000 });
  assert.equal(result.ok, false, 'URL mati harus dilaporkan gagal');
  assert.ok(result.checks.length > 0);
});

test('Publish: catatan rilis tersimpan dan terbaca', () => {
  const id = recordRelease({
    version: '1.0.0',
    commit: 'abc123',
    checks: [{ name: 'http-status', ok: true }],
    ok: true,
  });
  assert.ok(id);

  const releases = listReleases(10);
  assert.ok(releases.some(r => r.version === '1.0.0'));
  assert.equal(releases.find(r => r.version === '1.0.0').checks[0].name, 'http-status');
});
