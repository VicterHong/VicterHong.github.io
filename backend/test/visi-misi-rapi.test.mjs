import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../home.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../assets/css/main.css', import.meta.url), 'utf8');
const badge = readFileSync(new URL('../../assets/js/ci-badge.js', import.meta.url), 'utf8');

// Count-up menulis prefix + angka + suffix. Teks HTML yang tidak tertampung
// di prefix/suffix hilang saat animasi, jadi kalimatnya rusak.
test('count-up visi-misi tidak menghapus kata dari kalimat', () => {
  const spans = [...html.matchAll(/<span class="angka" data-count([^>]*)>([^<]+)<\/span>/g)];
  assert.ok(spans.length >= 5);
  for (const [, attrs, text] of spans) {
    const get = (k) => (attrs.match(new RegExp(`data-${k}="([^"]*)"`)) || [, ''])[1];
    const n = Number(get('target'));
    const rendered = `${get('prefix')}${n.toLocaleString('id-ID')}${get('suffix')}`;
    const plain = text.trim();
    assert.equal(rendered, plain.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.'), `"${plain}" dirender sebagai "${rendered}"`);
  }
});

// Kalimat penjelas bukan angka; gaya .angka (nowrap) membuatnya keluar kartu.
test('kalimat panjang tidak memakai gaya angka nowrap', () => {
  assert.doesNotMatch(html, /<span class="angka">Hasil uji tersedia/);
});

// Rincian CI dipecah per bagian; tiap bagian tidak boleh terpotong di tengah.
test('rincian CI pecah di antara bagian, bukan di tengah frasa', () => {
  assert.match(badge, /ci-badge-bagian/);
  assert.match(css, /\.ci-badge-bagian\s*{[^}]*white-space:\s*nowrap/);
});

test('kata ulang di judul tidak terpecah di tanda hubung', () => {
  assert.match(html, /<span class="utuh">benar-benar<\/span>/);
  const vm = readFileSync(new URL('../../assets/css/visi-misi.css', import.meta.url), 'utf8');
  assert.match(vm, /\.vm-judul \.utuh\s*{\s*white-space:\s*nowrap/);
});

test('kartu miring tidak membuat halaman bisa digeser ke samping', () => {
  const vm = readFileSync(new URL('../../assets/css/visi-misi.css', import.meta.url), 'utf8');
  assert.match(vm, /\.section-visi\s*{[^}]*overflow-x:\s*clip/);
});
