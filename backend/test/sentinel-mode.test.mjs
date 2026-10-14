/**
 * Tes mode keamanan Sentinel.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG PALING PENTING DIUJI DI SINI
 * ══════════════════════════════════════════════════════════════════════════════
 * Bukan "mode bisa diubah" — itu bagian yang mudah. Yang menentukan apakah
 * fitur ini layak dipakai:
 *
 *   1. Nilai PRO masih menerima webhook SAH (tidak terlalu ketat)
 *   2. Mode bisa DIKEMBALIKAN — tanpa ini, orang enggan mencobanya
 *   3. Mode tidak dikenal TIDAK mengunci layanan
 *   4. Perubahan mode langsung berlaku (cache tidak menahannya)
 *
 * Kalau nomor 1 gagal, mode PRO akan ditolak pemakaiannya dan orang mematikan
 * verifikasi sepenuhnya — hasilnya lebih buruk daripada tidak ada mode sama
 * sekali.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, getDb } from '../src/db.mjs';

let mode;

before(async () => {
  openDb(':memory:');
  mode = await import('../src/sentinel/mode.mjs');
  mode.siapkanTabelPengaturan();
});

beforeEach(() => {
  getDb().exec('DELETE FROM sentinel_pengaturan');
  mode.lupakanCache();
});

/* ══ 1. DEFAULT ════════════════════════════════════════════════════════════ */

test('tanpa pengaturan apa pun → mode normal', () => {
  assert.equal(mode.modeSekarang(), 'normal');
});

test('mode normal punya semua nilai yang dibutuhkan', () => {
  const n = mode.PROFIL.normal;

  for (const kunci of [
    'toleransiTandaTanganDetik',
    'ambangGagalSirkuit',
    'jendelaDuplikatMs',
    'batasBodyByte',
    'batasLajuPerMenit',
  ]) {
    assert.ok(kunci in n, `mode normal tidak punya nilai '${kunci}'`);
    assert.ok(n[kunci] > 0, `nilai '${kunci}' harus lebih dari 0`);
  }
});

test('mode pro punya kunci yang SAMA dengan mode normal', () => {
  // ── KENAPA INI PENTING ───────────────────────────────────────────────────
  // Kalau mode pro kurang satu kunci, `nilai()` mengembalikan undefined untuk
  // kunci itu — dan pemanggil yang memakai `?? default` diam-diam kembali ke
  // nilai longgar. Hasilnya: sebagian pengaturan diperketat, sebagian tidak,
  // tanpa ada yang tahu.
  const kunciNormal = Object.keys(mode.PROFIL.normal).sort();
  const kunciPro = Object.keys(mode.PROFIL.pro).sort();

  assert.deepEqual(kunciPro, kunciNormal, 'kunci mode pro berbeda dari mode normal');
});

/* ══ 2. MODE PRO BENAR-BENAR LEBIH KETAT ═══════════════════════════════════ */

test('mode pro lebih ketat di SETIAP nilai', () => {
  const n = mode.PROFIL.normal;
  const p = mode.PROFIL.pro;

  // Yang harus LEBIH KECIL di mode pro (jendela serangan dipersempit).
  const lebihKecil = [
    'toleransiTandaTanganDetik',
    'batasBodyByte',
    'batasLajuPerMenit',
    'ambangGagalSirkuit',
  ];

  for (const kunci of lebihKecil) {
    assert.ok(
      p[kunci] < n[kunci],
      `'${kunci}' di mode pro harus lebih kecil: ${p[kunci]} vs ${n[kunci]}`,
    );
  }

  // Yang harus LEBIH BESAR (kiriman ulang ditangkap lebih lama).
  assert.ok(
    p.jendelaDuplikatMs > n.jendelaDuplikatMs,
    `jendela duplikat mode pro harus lebih lama: ${p.jendelaDuplikatMs} vs ${n.jendelaDuplikatMs}`,
  );
});

/* ══ 3. TIDAK TERLALU KETAT ════════════════════════════════════════════════ */

test('mode pro TIDAK terlalu ketat — webhook sah tetap diterima', () => {
  const p = mode.PROFIL.pro;

  // ── TOLERANSI JAM ─────────────────────────────────────────────────────────
  // Stripe menandatangani dengan jam SERVERNYA. Kalau jam VPS meleset 45 detik
  // (NTP belum sinkron, baru boot), toleransi di bawah 60 detik menolak SEMUA
  // webhook Stripe — dan penyebabnya tidak terlihat dari sisi kita.
  assert.ok(
    p.toleransiTandaTanganDetik >= 60,
    `toleransi ${p.toleransiTandaTanganDetik}s terlalu ketat — jam yang meleset 45 detik `
    + 'akan menolak semua webhook Stripe',
  );

  // ── BATAS BODY ────────────────────────────────────────────────────────────
  // Webhook wajar (payload JSON dengan beberapa objek) jarang di atas 16 KB.
  // Batas di bawah itu akan menolak webhook sah yang memuat banyak item.
  assert.ok(
    p.batasBodyByte >= 16 * 1024,
    `batas body ${p.batasBodyByte} byte terlalu ketat untuk webhook wajar`,
  );

  // ── AMBANG SIRKUIT ────────────────────────────────────────────────────────
  // 1 berarti satu kegagalan (endpoint sempat sibuk) langsung memutus sirkuit.
  // Itu membuat gangguan sesaat menjadi pemadaman.
  assert.ok(
    p.ambangGagalSirkuit >= 2,
    `ambang ${p.ambangGagalSirkuit} terlalu ketat — satu kegagalan sesaat langsung memutus sirkuit`,
  );

  // ── BATAS LAJU ────────────────────────────────────────────────────────────
  // Provider sah bisa mengirim puluhan webhook sekaligus (mis. batch deploy).
  assert.ok(
    p.batasLajuPerMenit >= 30,
    `batas laju ${p.batasLajuPerMenit}/menit terlalu ketat — batch webhook sah akan ditolak`,
  );
});

/* ══ 4. UBAH & KEMBALIKAN ══════════════════════════════════════════════════ */

test('mode bisa diubah ke pro', () => {
  const r = mode.setMode('pro');

  assert.equal(r.ok, true);
  assert.equal(mode.modeSekarang(), 'pro');
});

test('mode bisa DIKEMBALIKAN ke normal', () => {
  // ── KENAPA INI DIUJI KHUSUS ───────────────────────────────────────────────
  // Mode ketat dipakai saat ada indikasi gangguan. Kalau tidak bisa
  // dikembalikan, orang enggan mencobanya — dan fitur yang tidak pernah
  // dicoba sama dengan fitur yang tidak ada.
  mode.setMode('pro');
  assert.equal(mode.modeSekarang(), 'pro');

  const r = mode.setMode('normal');
  assert.equal(r.ok, true, 'mode tidak bisa dikembalikan');
  assert.equal(mode.modeSekarang(), 'normal');
});

test('mode bertahan setelah cache dilupakan (tersimpan di database)', () => {
  mode.setMode('pro');
  mode.lupakanCache();

  assert.equal(mode.modeSekarang(), 'pro', 'mode tidak tersimpan permanen');
});

test('perubahan mode langsung berlaku — cache tidak menahannya', () => {
  // ── KENAPA INI DIUJI ──────────────────────────────────────────────────────
  // Tanpa melupakan cache saat menulis, perubahan baru berlaku setelah TTL
  // habis. Operator yang baru menekan tombol akan mengira tombolnya rusak.
  assert.equal(mode.modeSekarang(), 'normal');

  mode.setMode('pro');

  // Dibaca LANGSUNG setelah diubah, tanpa menunggu TTL.
  assert.equal(mode.modeSekarang(), 'pro', 'cache menahan perubahan mode');
});

/* ══ 5. MODE TIDAK DIKENAL ═════════════════════════════════════════════════ */

test('mode tidak dikenal ditolak', () => {
  const r = mode.setMode('super-duper');

  assert.equal(r.ok, false);
  assert.equal(r.alasan, 'mode_tidak_dikenal');
  assert.equal(mode.modeSekarang(), 'normal', 'mode berubah padahal tidak valid');
});

test('mode tidak dikenal DI DATABASE tidak mengunci layanan', () => {
  // ── KENAPA INI DIUJI ──────────────────────────────────────────────────────
  // Kalau barisnya berisi nama mode yang tidak ada (mis. sisa dari versi
  // lama), `PROFIL[mode]` menghasilkan undefined dan SEMUA pembacaan nilai
  // melempar. Layanan mati karena satu baris pengaturan yang salah.
  getDb()
    .prepare('INSERT INTO sentinel_pengaturan (kunci, nilai, diperbarui_at) VALUES (?, ?, ?)')
    .run('mode', 'mode-yang-tidak-ada', Date.now());
  mode.lupakanCache();

  assert.equal(mode.modeSekarang(), 'normal', 'mode tidak dikenal tidak jatuh ke normal');
});

/* ══ 6. NILAI EFEKTIF ══════════════════════════════════════════════════════ */

test('nilai() mengembalikan nilai dari mode yang aktif', () => {
  assert.equal(mode.nilai('toleransiTandaTanganDetik'), mode.PROFIL.normal.toleransiTandaTanganDetik);

  mode.setMode('pro');
  assert.equal(mode.nilai('toleransiTandaTanganDetik'), mode.PROFIL.pro.toleransiTandaTanganDetik);
});

test('nilai() untuk kunci tidak dikenal → undefined, bukan 0', () => {
  // ── KENAPA HARUS undefined ────────────────────────────────────────────────
  // Pemanggil yang memakai `?? default` tetap bekerja dengan undefined.
  // Dengan 0, pemeriksaan seperti "selisih > 0" akan menolak SEMUA permintaan
  // — kesalahan ketik nama kunci menjadi penguncian total.
  const v = mode.nilai('kunci-yang-tidak-ada');

  assert.equal(v, undefined);
  assert.notEqual(v, 0, 'nilai 0 akan membuat pemeriksaan menolak semuanya');
});

/* ══ 7. RINGKASAN UNTUK INSPECTOR ══════════════════════════════════════════ */

test('ringkasMode melaporkan mode aktif dan semua pilihan', () => {
  const r = mode.ringkasMode();

  assert.equal(r.mode, 'normal');
  assert.equal(typeof r.label, 'string');
  assert.equal(typeof r.keterangan, 'string');
  assert.ok(r.nilai, 'nilai efektif tidak disertakan');
  assert.ok(Array.isArray(r.tersedia));
  assert.equal(r.tersedia.length, 2, 'harus ada dua pilihan mode');

  const aktif = r.tersedia.filter((t) => t.aktif);
  assert.equal(aktif.length, 1, 'harus tepat satu mode yang ditandai aktif');
  assert.equal(aktif[0].id, 'normal');
});

test('ringkasMode ikut berubah setelah mode diubah', () => {
  mode.setMode('pro');
  const r = mode.ringkasMode();

  assert.equal(r.mode, 'pro');
  assert.equal(r.tersedia.find((t) => t.aktif).id, 'pro');
  assert.equal(r.nilai.toleransiTandaTanganDetik, mode.PROFIL.pro.toleransiTandaTanganDetik);
});

/* ══ 8. LABEL TIDAK MEMBOCORKAN APA PUN ════════════════════════════════════ */

test('ringkasMode tidak memuat rahasia apa pun', () => {
  const teks = JSON.stringify(mode.ringkasMode());

  // Nama-nama ini tidak boleh muncul — kalau muncul, ada yang salah tempat.
  for (const terlarang of ['secret', 'password', 'token', 'key']) {
    assert.ok(
      !teks.toLowerCase().includes(terlarang),
      `ringkasMode memuat kata '${terlarang}' — periksa apakah ada yang bocor`,
    );
  }
});
