/**
 * Tes badge CI — penentuan keadaan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA LOGIKA INI DIUJI TERPISAH
 * ══════════════════════════════════════════════════════════════════════════════
 * Yang paling mudah salah bukan pengambilan datanya, tapi PENENTUAN KEADAAN.
 *
 * Kasus nyata: saat workflow sedang berjalan, GitHub mengirim
 * `status: 'in_progress'` dan `conclusion: null`. Kode yang memeriksa
 * `kesimpulan === 'success'` akan jatuh ke cabang "gagal" — dan badge-nya
 * menampilkan "Pipeline gagal" untuk build yang sedang bekerja.
 *
 * Kesalahan itu terlihat di halaman publik, dan efeknya: pengunjung mengira
 * proyeknya rusak padahal sedang di-deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── DARI BERKAS LOGIKA MURNI, BUKAN ci-badge.js ─────────────────────────────
// `ci-badge.js` menyentuh `document` saat diimpor — mengimpornya di Node
// melempar "document is not defined". Logikanya sengaja dipisah supaya bisa
// diuji tanpa browser.
import {
  keadaanBadge,
  sejak,
  durasi,
  bagianRincian,
} from '../../assets/js/ci-badge-keadaan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ══ 1. JALUR SUKSES ═══════════════════════════════════════════════════════ */

test('build lulus → keadaan "lulus"', () => {
  const k = keadaanBadge({
    ok: true,
    status: 'completed',
    kesimpulan: 'success',
    nomor: 310,
  });

  assert.equal(k.jenis, 'lulus');
  assert.match(k.label, /lulus/i);
});

/* ══ 2. MASIH BERJALAN — BUKAN GAGAL ══════════════════════════════════════ */

test('build MASIH BERJALAN → "berjalan", BUKAN "gagal"', () => {
  // ── KENAPA INI TES PALING PENTING DI BERKAS INI ───────────────────────────
  // `conclusion: null` saat in_progress. Kalau null diperlakukan sebagai
  // kegagalan, badge menampilkan "gagal" untuk build yang sedang bekerja.
  const k = keadaanBadge({
    ok: true,
    status: 'in_progress',
    kesimpulan: null,
    nomor: 311,
  });

  assert.equal(k.jenis, 'berjalan', `dapat '${k.jenis}' — build yang jalan dilaporkan gagal`);
  assert.notEqual(k.jenis, 'gagal');
  assert.match(k.label, /berjalan/i);
});

test('status queued juga dianggap berjalan', () => {
  const k = keadaanBadge({ ok: true, status: 'queued', kesimpulan: null });
  assert.equal(k.jenis, 'berjalan');
});

/* ══ 3. KEGAGALAN NYATA ════════════════════════════════════════════════════ */

test('build gagal → keadaan "gagal"', () => {
  const k = keadaanBadge({
    ok: true,
    status: 'completed',
    kesimpulan: 'failure',
    nomor: 312,
  });

  assert.equal(k.jenis, 'gagal');
  assert.match(k.label, /gagal/i);
});

test('build dibatalkan DIBEDAKAN dari gagal', () => {
  // ── KENAPA DIBEDAKAN ──────────────────────────────────────────────────────
  // Run yang dibatalkan bukan kegagalan tes — seseorang menghentikannya, atau
  // ada run baru menggantikannya. Menampilkannya sebagai "gagal" memberi kesan
  // ada masalah padahal tidak ada.
  const k = keadaanBadge({
    ok: true,
    status: 'completed',
    kesimpulan: 'cancelled',
    nomor: 313,
  });

  assert.equal(k.jenis, 'dibatalkan');
  assert.notEqual(k.jenis, 'gagal');
});

/* ══ 4. DATA TIDAK TERSEDIA ════════════════════════════════════════════════ */

test('GitHub tidak bisa dihubungi → "tidak-tersedia", bukan crash', () => {
  const k = keadaanBadge({ ok: false, alasan: 'github_timeout', pesan: 'GitHub tidak menjawab.' });

  assert.equal(k.jenis, 'tidak-tersedia');
  assert.ok(k.keterangan, 'harus ada keterangan kenapa');
});

test('data kosong → tidak melempar', () => {
  for (const masukan of [null, undefined, {}, { ok: false }]) {
    const k = keadaanBadge(masukan);
    assert.ok(k.jenis, `gagal untuk masukan ${JSON.stringify(masukan)}`);
    assert.ok(k.label, 'harus ada label');
  }
});

/* ══ 5. SETIAP KEADAAN PUNYA LABEL YANG JELAS ══════════════════════════════ */

test('setiap keadaan punya label yang bisa dibaca', () => {
  const semua = [
    { ok: true, status: 'completed', kesimpulan: 'success' },
    { ok: true, status: 'completed', kesimpulan: 'failure' },
    { ok: true, status: 'completed', kesimpulan: 'cancelled' },
    { ok: true, status: 'in_progress', kesimpulan: null },
    { ok: false, alasan: 'github_timeout' },
  ];

  for (const masukan of semua) {
    const k = keadaanBadge(masukan);
    assert.ok(
      typeof k.label === 'string' && k.label.length >= 5,
      `label terlalu pendek: '${k.label}' untuk ${JSON.stringify(masukan)}`,
    );
  }
});

test('setiap jenis keadaan punya gaya CSS-nya', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kelas `.ci-badge--<jenis>` dibuat di JS, dan gayanya ada di CSS. Kelas
  // yang tidak punya gaya TIDAK melempar error — badge-nya hanya diam-diam
  // tanpa warna, dan itu tidak terlihat sampai ada yang memperhatikannya.
  const css = readFileSync(join(__dirname, '..', '..', 'assets', 'css', 'main.css'), 'utf8');

  const jenis = ['lulus', 'gagal', 'berjalan', 'dibatalkan', 'tidak-tersedia', 'memuat'];

  for (const j of jenis) {
    assert.ok(
      css.includes(`.ci-badge--${j}`),
      `kelas .ci-badge--${j} tidak punya gaya di main.css`,
    );
  }
});

/* ══ 6. FORMAT WAKTU ═══════════════════════════════════════════════════════ */

test('sejak() menulis waktu relatif', () => {
  const sekarang = Date.parse('2026-10-14T12:00:00Z');

  assert.equal(sejak('2026-10-14T11:59:30Z', sekarang), 'baru saja');
  assert.match(sejak('2026-10-14T11:45:00Z', sekarang), /15 menit lalu/);
  assert.match(sejak('2026-10-14T09:00:00Z', sekarang), /3 jam lalu/);
  assert.match(sejak('2026-10-12T12:00:00Z', sekarang), /2 hari lalu/);
});

test('sejak() untuk waktu kosong/rusak → null, bukan "NaN"', () => {
  for (const masukan of [null, undefined, '', 'bukan-tanggal']) {
    assert.equal(sejak(masukan), null, `gagal untuk ${JSON.stringify(masukan)}`);
  }
});

test('durasi() menulis waktu yang enak dibaca', () => {
  assert.equal(durasi(56), '56 detik');
  assert.equal(durasi(60), '1 menit');
  assert.equal(durasi(125), '2 menit 5 detik');
  assert.equal(durasi(null), null);
});

test('bagianRincian menyusun bagian yang ada saja', () => {
  const bagian = bagianRincian({
    ok: true,
    nomor: 310,
    commit: '0b5a076',
    durasiDetik: 56,
    selesaiAt: new Date().toISOString(),
  });

  assert.ok(bagian.includes('run #310'));
  assert.ok(bagian.includes('0b5a076'));
  assert.ok(bagian.includes('56 detik'));
});

test('bagianRincian tidak menyisipkan "undefined"', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Data dari GitHub bisa kurang lengkap. Kalau bagian yang kosong tetap
  // didorong ke array, rinciannya berbunyi "run #undefined · undefined".
  const bagian = bagianRincian({ ok: true, nomor: 310 });

  assert.ok(!bagian.join(' ').includes('undefined'));
  assert.ok(!bagian.join(' ').includes('null'));
});
