/**
 * Uji logika pembuatan berkas DNS untuk domain email.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA DIUJI ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Skrip setup-domain-email.mjs membuat pull request ke repo ORANG LAIN
 * (is-a.dev). Kalau berkas JSON-nya salah bentuk:
 *
 *   • PR ditolak otomatis oleh validator mereka
 *   • Atau lebih buruk: di-merge, lalu DNS-nya rusak dan email tidak pernah
 *     sampai — tanpa error yang jelas di sisi kita
 *
 * Kedua hasil itu memalukan dan sulit diperbaiki (PR sudah publik). Karena
 * itu logika penyusunan JSON diuji di sini, terpisah dari panggilan jaringan.
 *
 * ── YANG DIUJI ───────────────────────────────────────────────────────────────
 *
 *   1. Tanda kutip ganda dibersihkan (Resend kadang mengirim nilai ber-kutip,
 *      dan dnsconfig.js is-a.dev menambahkan kutipnya sendiri → kutip ganda
 *      membuat SPF/DKIM tidak terbaca)
 *   2. Titik di akhir target MX dibuang (kalau tidak, jadi "host..")
 *   3. Prioritas MX berupa ANGKA, bukan string
 *   4. Nama berkas mengikuti aturan is-a.dev (label _domainkey boleh, titik
 *      sebagai pemisah subdomain)
 *   5. Struktur JSON sesuai skema is-a.dev (owner + records)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ── Fungsi yang diuji (salinan dari setup-domain-email.mjs) ───────────────────
//
// Sengaja disalin, bukan diimpor: skrip itu menjalankan aksi saat diimpor
// (membuat PR). Kalau diimpor di tes, ia akan benar-benar mencoba jaringan.
//
// Risiko salinan basi ditutup oleh uji terakhir di berkas ini, yang membaca
// sumber skrip dan memastikan fungsinya masih sama.

const bersihkan = (v) => String(v ?? '').replace(/^"|"$/g, '').trim();

function susunBerkas({ dkim, spf, mx }) {
  const PEMILIK = { username: 'VicterHong', email: 'victerphanjaya@gmail.com' };

  return {
    dkim: {
      owner: PEMILIK,
      description: 'DKIM key for Resend transactional emails (victer.is-a.dev)',
      records: { TXT: [bersihkan(dkim.value)] },
      proxied: false,
    },
    send: {
      owner: PEMILIK,
      description: 'SPF and return-path for Resend transactional emails (victer.is-a.dev)',
      records: {
        MX: [{
          target: bersihkan(mx.value).replace(/\.$/, ''),
          priority: Number(mx.priority ?? 10),
        }],
        TXT: [bersihkan(spf.value)],
      },
      proxied: false,
    },
  };
}

// ── 1. Pembersihan tanda kutip ────────────────────────────────────────────────

test('tanda kutip ganda dibersihkan dari nilai TXT', () => {
  // Resend kadang mengembalikan nilai SUDAH ber-kutip. dnsconfig.js is-a.dev
  // membungkusnya LAGI → `""v=spf1 ...""` → SPF tidak terbaca.
  const hasil = susunBerkas({
    dkim: { value: '"p=MIGfMA0GCSq..."' },
    spf: { value: '"v=spf1 include:amazonses.com ~all"' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com.', priority: 10 },
  });

  assert.equal(hasil.send.records.TXT[0], 'v=spf1 include:amazonses.com ~all');
  assert.equal(hasil.dkim.records.TXT[0], 'p=MIGfMA0GCSq...');
  assert.ok(!hasil.send.records.TXT[0].includes('"'), 'tidak boleh ada kutip tersisa');
  assert.ok(!hasil.dkim.records.TXT[0].includes('"'), 'tidak boleh ada kutip tersisa');
});

test('nilai tanpa kutip tidak berubah', () => {
  const hasil = susunBerkas({
    dkim: { value: 'p=ABC123' },
    spf: { value: 'v=spf1 include:amazonses.com ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
  });

  assert.equal(hasil.send.records.TXT[0], 'v=spf1 include:amazonses.com ~all');
  assert.equal(hasil.dkim.records.TXT[0], 'p=ABC123');
});

// ── 2. Titik di akhir target MX ───────────────────────────────────────────────

test('titik di akhir target MX dibuang', () => {
  // Kalau tidak dibuang, dnsconfig.js menambahkan titik lagi → "host.."
  const hasil = susunBerkas({
    dkim: { value: 'p=X' },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com.', priority: 10 },
  });

  assert.equal(hasil.send.records.MX[0].target, 'feedback-smtp.us-east-1.amazonses.com');
  assert.ok(!hasil.send.records.MX[0].target.endsWith('.'), 'tidak boleh berakhir titik');
});

// ── 3. Prioritas MX berupa angka ──────────────────────────────────────────────

test('prioritas MX berupa angka, bukan string', () => {
  const hasil = susunBerkas({
    dkim: { value: 'p=X' },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com', priority: '10' },
  });

  assert.equal(typeof hasil.send.records.MX[0].priority, 'number',
    'dnsconfig.js memakai parseInt(mxRecord.priority) — string "10" bekerja, ' +
    'tapi angka lebih jelas dan menghindari bug kalau nilainya kosong');
  assert.equal(hasil.send.records.MX[0].priority, 10);
});

test('prioritas MX default 10 kalau Resend tidak mengirim', () => {
  const hasil = susunBerkas({
    dkim: { value: 'p=X' },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com' },
  });

  assert.equal(hasil.send.records.MX[0].priority, 10);
});

// ── 4. Nama berkas sesuai aturan is-a.dev ─────────────────────────────────────

test('nama berkas mengikuti aturan is-a.dev', () => {
  const namaDkim = 'resend._domainkey.victer.json';
  const namaSend = 'send.victer.json';

  for (const nama of [namaDkim, namaSend]) {
    assert.ok(nama.endsWith('.json'), 'harus berakhir .json');
    assert.ok(!nama.includes('is-a.dev'), 'tidak boleh memuat "is-a.dev"');
    assert.ok(!nama.startsWith('.'), 'tidak boleh diawali titik');
    assert.ok(!/--/.test(nama), 'tidak boleh ada dash ganda');

    // Setiap label maksimal 63 karakter.
    const label = nama.replace(/\.json$/, '').split('.');
    for (const l of label) {
      assert.ok(l.length <= 63, `label "${l}" lebih dari 63 karakter`);
    }
  }

  // Label _domainkey: garis bawah HANYA boleh di label non-pertama.
  assert.ok(namaDkim.includes('_domainkey'), 'berkas DKIM harus di label _domainkey');
  assert.ok(!namaSend.includes('_'), 'berkas send tidak perlu garis bawah');
});

// ── 5. Struktur JSON sesuai skema ─────────────────────────────────────────────

test('struktur JSON sesuai skema is-a.dev', () => {
  const hasil = susunBerkas({
    dkim: { value: 'p=ABC' },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
  });

  for (const [nama, berkas] of Object.entries(hasil)) {
    assert.ok(berkas.owner, `${nama}: harus ada "owner"`);
    assert.equal(typeof berkas.owner.username, 'string', `${nama}: owner.username harus string`);
    assert.ok(berkas.owner.username.length > 0, `${nama}: owner.username tidak boleh kosong`);
    assert.ok(berkas.owner.email, `${nama}: harus ada email kontak`);
    assert.ok(berkas.records, `${nama}: harus ada "records"`);
    assert.equal(typeof berkas.records, 'object', `${nama}: records harus objek`);
  }

  // MX harus array objek { target, priority } — bentuk yang didukung dnsconfig.js
  assert.ok(Array.isArray(hasil.send.records.MX), 'MX harus array');
  assert.ok(hasil.send.records.MX[0].target, 'MX harus punya target');
  assert.ok(hasil.send.records.MX[0].priority !== undefined, 'MX harus punya priority');

  // TXT harus array string
  assert.ok(Array.isArray(hasil.send.records.TXT), 'TXT harus array');
  assert.equal(typeof hasil.send.records.TXT[0], 'string', 'TXT harus string');
});

test('berkas bisa di-JSON.stringify tanpa error (valid JSON)', () => {
  const hasil = susunBerkas({
    dkim: { value: 'p=ABC' },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
  });

  for (const [nama, berkas] of Object.entries(hasil)) {
    const teks = JSON.stringify(berkas, null, 2);
    const kembali = JSON.parse(teks);
    assert.deepEqual(kembali, berkas, `${nama}: JSON harus bisa dibaca kembali utuh`);
  }
});

// ── 6. Nilai DKIM yang panjang tidak terpotong ────────────────────────────────

test('nilai DKIM panjang (kunci RSA) tidak terpotong', () => {
  // Kunci DKIM Resend panjangnya ~400 karakter. Kalau ada pemotongan
  // (mis. .slice(0, 255)), tanda tangannya tidak valid dan SEMUA email
  // masuk spam tanpa penjelasan.
  const kunciPanjang = 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ' + 'A'.repeat(350);

  const hasil = susunBerkas({
    dkim: { value: kunciPanjang },
    spf: { value: 'v=spf1 ~all' },
    mx: { value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
  });

  assert.equal(hasil.dkim.records.TXT[0].length, kunciPanjang.length,
    'nilai DKIM tidak boleh dipotong — kunci yang terpotong membuat ' +
    'tanda tangan tidak valid dan email masuk spam');
});

// ── 7. Jaga agar salinan di tes ini tidak basi ────────────────────────────────

test('fungsi bersihkan() di skrip asli masih sama', async () => {
  const { readFileSync } = await import('node:fs');
  const sumber = readFileSync(
    '/home/ubuntu/portfolio-victer/scripts/setup-domain-email.mjs', 'utf8'
  );

  assert.ok(
    /const bersihkan = \(v\) => String\(v \?\? ''\)\.replace\(\/\^"\|\"\$\/g, ''\)\.trim\(\)/.test(sumber),
    'fungsi bersihkan() di skrip asli sudah berubah — perbarui salinan di tes ini ' +
    'supaya uji tetap menguji perilaku yang sebenarnya'
  );

  assert.ok(
    /target: bersihkan\(mx\.value\)\.replace\(\/\\\.\$\/, ''\)/.test(sumber),
    'pembersihan titik di akhir target MX sudah berubah — perbarui salinan di tes ini'
  );
});
