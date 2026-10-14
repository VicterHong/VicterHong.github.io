/**
 * Tes: URL webhook Midtrans di dokumentasi harus cocok dengan rute sungguhan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * Dokumentasi menyebut satu URL, kode melayani URL lain. Akibatnya:
 *
 *   - Yang mengikuti dokumentasi mendaftarkan URL yang tidak ada di Midtrans
 *   - Midtrans mengirim notifikasi ke sana, dapat 404
 *   - Midtrans menganggap pengiriman GAGAL dan mencoba ulang beberapa kali
 *   - Pembeli sudah membayar, tapi langganannya TIDAK PERNAH aktif otomatis
 *
 * Tidak ada error yang muncul di log kita — permintaannya tidak pernah sampai.
 * Kegagalannya diam, dan baru ketahuan setelah ada pembeli yang mengeluh.
 *
 * Dokumentasi yang salah lebih berbahaya daripada tidak ada dokumentasi,
 * karena ia diikuti dengan percaya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');

/* ── Ambil rute webhook dari KODE, bukan dari dokumentasi ───────────────── */

test('rute webhook Midtrans terdaftar di routes.mjs', () => {
  const kode = readFileSync(join(AKAR, 'backend', 'src', 'routes.mjs'), 'utf8');

  const cocok = kode.match(/pattern:\s*'(\/api\/[^']*midtrans[^']*webhook[^']*)'/);
  assert.ok(cocok, 'rute webhook Midtrans tidak ditemukan di routes.mjs');

  // Simpan untuk tes berikutnya lewat properti statis — node:test menjalankan
  // tes secara berurutan dalam satu berkas, jadi ini aman.
  globalThis.__RUTE_WEBHOOK = cocok[1];
});

/* ── Dokumentasi harus menyebut rute yang sama ──────────────────────────── */

test('dokumentasi Midtrans menyebut rute yang benar', () => {
  const rute = globalThis.__RUTE_WEBHOOK;
  assert.ok(rute, 'rute belum terbaca dari tes sebelumnya');

  const dok = readFileSync(join(AKAR, 'docs', 'PEMBAYARAN-MIDTRANS.md'), 'utf8');

  assert.ok(
    dok.includes(rute),
    `dokumentasi tidak menyebut rute sungguhan (${rute}). `
    + 'Yang mengikuti dokumentasi akan mendaftarkan URL yang tidak ada.',
  );
});

test('dokumentasi tidak menyebut rute webhook yang tidak ada', () => {
  const dok = readFileSync(join(AKAR, 'docs', 'PEMBAYARAN-MIDTRANS.md'), 'utf8');
  const kode = readFileSync(join(AKAR, 'backend', 'src', 'routes.mjs'), 'utf8');

  // ── CARI SEMUA URL WEBHOOK YANG DISEBUT DOKUMENTASI ──────────────────────
  // Pola: https://host/api/...webhook... — lalu pastikan setiap rutenya
  // benar-benar terdaftar di kode.
  const disebut = [...dok.matchAll(/https:\/\/[^\s`)]*\/api\/[^\s`)]*webhook[^\s`)]*/g)]
    .map((m) => m[0])
    .filter((u) => !u.includes('localhost') && !u.includes('127.0.0.1'));

  assert.ok(disebut.length > 0, 'dokumentasi tidak menyebut URL webhook sama sekali');

  for (const url of disebut) {
    const jalur = new URL(url).pathname;
    assert.ok(
      kode.includes(`'${jalur}'`),
      `dokumentasi menyebut ${jalur} tapi rute itu tidak ada di routes.mjs`,
    );
  }
});

/* ── Menu dashboard yang disebut dokumentasi harus ada di dashboard ─────── */

test('dokumentasi menyebut menu Settings → Payment (bukan Configuration)', () => {
  const dok = readFileSync(join(AKAR, 'docs', 'PEMBAYARAN-MIDTRANS.md'), 'utf8');

  // ── KENAPA DIPERIKSA ─────────────────────────────────────────────────────
  // Dokumentasi lama Midtrans menyebut "Settings → Configuration". Dashboard
  // sekarang TIDAK punya menu itu — menunya bernama "Payment". Instruksi yang
  // menyuruh mencari menu yang tidak ada membuat orang menyerah di tengah.
  const adaMenuPayment = /Settings\s*→\s*Payment/.test(dok);
  assert.ok(adaMenuPayment, 'dokumentasi tidak menyebut Settings → Payment');

  // Kalau "Configuration" disebut, harus sebagai catatan penjelas — bukan
  // sebagai instruksi. Diterima hanya kalau ada penjelasan bahwa menu itu tidak
  // ada lagi.
  if (dok.includes('Configuration')) {
    assert.match(
      dok,
      /Configuration[\s\S]{0,200}(tidak punya|tidak ada|versi lama|dokumentasi lama)/i,
      'dokumentasi menyebut "Configuration" tanpa menjelaskan bahwa menu itu sudah tidak ada',
    );
  }
});
