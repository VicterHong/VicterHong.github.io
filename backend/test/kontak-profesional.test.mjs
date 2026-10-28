import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = () => readFileSync(new URL('../../home.html', import.meta.url), 'utf8');

test('kontak bisnis memiliki email langsung tanpa menunggu API atau login', () => {
  const section = home().match(/<section[^>]+id="89fk39"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(section, /href="mailto:vivastic\.id@gmail\.com/);
  assert.match(section, /id="briefForm"/);
  assert.match(section, /Siapkan email/);
  assert.match(section, /belum terkirim/);
  assert.match(section, /name="kebutuhan"/);
});

test('penyusunan brief menghasilkan draft, bukan klaim pesan sudah dikirim', async () => {
  const { susunEmailBrief } = await import('../../assets/js/kontak.js');
  const url = new URL(susunEmailBrief({ nama: 'Victer & tim', kebutuhan: 'Stok <baru>\nDua lokasi', tujuan: 'spareparts' }));
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, 'vivastic.id@gmail.com');
  assert.ok(!url.href.includes('+'), 'mailto memakai persen-encoding spasi, bukan form-encoding plus');
  assert.match(url.searchParams.get('body'), /Stok <baru>\nDua lokasi/);
  assert.match(url.searchParams.get('subject'), /spareparts/);
  assert.doesNotMatch(url.href, /[<>\r\n]/);
});
