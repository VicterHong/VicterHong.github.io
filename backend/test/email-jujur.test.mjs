/**
 * Tes: pengiriman email harus JUJUR — kegagalan tidak boleh hilang.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BUG YANG DICEGAH ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Pengguna melaporkan "email reset tidak masuk". Penelusuran menemukan:
 *
 *   1. Endpoint /api/auth/lupa-sandi memakai `.catch(() => {})` — padahal
 *      `email.mjs` TIDAK PERNAH melempar (ia mengembalikan `{ok:false}`).
 *      Jadi catch itu tidak menangkap apa pun, dan kegagalan hilang total.
 *
 *   2. `recordEvent({ outcome: 'dikirim' })` dicatat berdasarkan "apakah user
 *      ada", bukan "apakah email terkirim". Log SELALU bilang sukses.
 *
 *   3. Akar masalah sebenarnya: EMAIL_FROM memakai `noreply@victer.is-a.dev`,
 *      dan domain `is-a.dev` TIDAK BISA diverifikasi (dikelola pihak lain).
 *      Brevo menolak 7 email berturut-turut, dan tidak ada satu pun catatan.
 *
 * Tes ini mengunci tiga hal:
 *   A. `email.mjs` mengembalikan {ok:false} — tidak melempar (kontrak)
 *   B. config memperingatkan domain yang tidak bisa diverifikasi
 *   C. endpoint lupa-sandi menunggu hasil & mencatat outcome jujur
 *
 * Jalankan: node --test backend/test/email-jujur.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const baca = (p) => readFileSync(join(ROOT, p), 'utf8');

// ══════════════════════════════════════════════════════════════════════════════
// ── A. KONTRAK email.mjs: MENGEMBALIKAN, BUKAN MELEMPAR ─────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Inilah yang membuat `.catch(() => {})` sia-sia. Kalau kontrak ini berubah
// (email.mjs mulai melempar), semua pemanggil harus ditinjau ulang.
describe('kontrak email.mjs', () => {
  test('fungsi kirim mengembalikan {ok:false}, bukan melempar', () => {
    const isi = baca('src/email.mjs');

    // Ada `return { ok: false, error: ... }` — jalur kegagalan mengembalikan.
    assert.match(
      isi, /return \{ ok: false, error: 'belum_dikonfigur' \}/,
      'email.mjs harus mengembalikan {ok:false} saat belum dikonfigurasi',
    );

    // Ada catch yang mengembalikan (bukan melempar ulang).
    assert.match(
      isi, /catch \(e\) \{[\s\S]{0,200}return \{ ok: false, error:/,
      'catch di email.mjs harus mengembalikan {ok:false}, bukan melempar ulang',
    );
  });

  test('tidak ada pemanggil yang memakai .catch(() => {}) untuk email', () => {
    for (const berkas of ['src/routes.mjs', 'src/auth-routes.mjs', 'src/checkout.mjs']) {
      const isi = baca(berkas);

      // Cari pola kirimEmail*/kirimKode* yang diikuti .catch kosong.
      const polaBahaya = /kirim[A-Z][A-Za-z]*\([^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/;
      assert.doesNotMatch(
        isi, polaBahaya,
        `${berkas}: pemanggilan email dengan .catch(() => {}) menelan kegagalan — `
        + 'email.mjs tidak pernah melempar, jadi catch itu tidak berguna',
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── B. ENDPOINT LUPA-SANDI: MENUNGGU HASIL & MENCATAT JUJUR ─────────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('endpoint lupa-sandi mencatat outcome sebenarnya', () => {
  test('menunggu hasil pengiriman (await)', () => {
    const isi = baca('src/routes.mjs');
    const blok = isi.slice(isi.indexOf("pattern: '/api/auth/lupa-sandi'"));

    assert.match(
      blok, /await kirimEmailResetSandi\(/,
      'pengiriman harus di-await supaya hasilnya bisa diperiksa',
    );
  });

  test('mencatat email_gagal saat pengiriman gagal', () => {
    const isi = baca('src/routes.mjs');
    const blok = isi.slice(isi.indexOf("pattern: '/api/auth/lupa-sandi'"));

    assert.match(
      blok, /'email_gagal'/,
      "outcome 'email_gagal' harus ada — kalau tidak, kegagalan tidak terlihat",
    );
    assert.match(
      blok, /'akun_tidak_aktif'/,
      "outcome 'akun_tidak_aktif' harus dibedakan dari 'email_tidak_ada'",
    );
  });

  test('mencatat alasan kegagalan ke log server', () => {
    const isi = baca('src/routes.mjs');
    const blok = isi.slice(isi.indexOf("pattern: '/api/auth/lupa-sandi'"));

    assert.match(
      blok, /console\.warn\([^)]*lupa-sandi[^)]*gagal/,
      'kegagalan harus dicatat ke log dengan alasan dari penyedia',
    );
  });

  test('respons tetap SERAGAM (tidak membocorkan keberadaan akun)', () => {
    const isi = baca('src/routes.mjs');
    const blok = isi.slice(isi.indexOf("pattern: '/api/auth/lupa-sandi'"));

    // Pesan sukses harus sama untuk semua kasus — tidak boleh ada cabang
    // yang mengubah pesan berdasarkan hasil pengiriman.
    const pesan = blok.match(/message: '([^']+)'/g) ?? [];
    const pesanUnik = new Set(pesan);
    assert.equal(
      pesanUnik.size, 1,
      `pesan respons harus seragam, ditemukan ${pesanUnik.size} variasi: ${[...pesanUnik].join(' | ')}`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── C. CONFIG: PERINGATAN DOMAIN YANG TIDAK BISA DIVERIFIKASI ───────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('config memperingatkan domain tidak bisa diverifikasi', () => {
  test('ada daftar domain yang tidak bisa diverifikasi', () => {
    const isi = baca('src/config.mjs');

    assert.match(
      isi, /domainTidakBisaDiverifikasi/,
      'config harus punya daftar domain yang tidak bisa ditambahi DNS record',
    );
    for (const d of ['is-a.dev', 'github.io', 'pages.dev']) {
      assert.ok(isi.includes(`'${d}'`), `daftar harus memuat ${d}`);
    }
  });

  test('memeriksa bentuk alamat email', () => {
    const isi = baca('src/config.mjs');

    // Regex bentuk email dasar harus ada di pemeriksaan.
    assert.match(
      isi, /\[\^@\\s\]\+@\[\^@\\s\]\+/,
      'config harus memeriksa bentuk alamat email (bukan hanya kosong/tidak)',
    );
  });

  test('mengekstrak alamat dari format "Nama <alamat>"', () => {
    const isi = baca('src/config.mjs');

    assert.match(
      isi, /match\(\/<\(\[\^>\]\+\)>\/\)/,
      'config harus bisa mengambil alamat dari format "Nama <alamat>"',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── D. UJI PERILAKU: DOMAIN is-a.dev TERDETEKSI ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Fungsi pemeriksaannya ada di dalam config.mjs (tidak diekspor), jadi
// logikanya diuji ulang di sini dengan daftar yang sama. Kalau daftar di
// config berubah, tes ini harus ikut berubah — itu memang tujuannya.
describe('logika deteksi domain', () => {
  const daftar = ['is-a.dev', 'github.io', 'pages.dev', 'workers.dev'];

  const terdeteksi = (surel) => {
    const domain = surel.split('@')[1] ?? '';
    return daftar.some((d) => domain === d || domain.endsWith('.' + d));
  };

  test('domain is-a.dev terdeteksi', () => {
    assert.ok(terdeteksi('noreply@victer.is-a.dev'), 'victer.is-a.dev harus terdeteksi');
    assert.ok(terdeteksi('a@is-a.dev'), 'is-a.dev langsung juga harus terdeteksi');
  });

  test('subdomain github.io terdeteksi', () => {
    assert.ok(terdeteksi('a@victerhong.github.io'));
  });

  test('domain sendiri TIDAK terdeteksi (tidak ada peringatan palsu)', () => {
    assert.ok(!terdeteksi('noreply@vivastic.id'), 'vivastic.id bukan domain pihak lain');
    assert.ok(!terdeteksi('noreply@domain.com'), 'domain.com bukan domain pihak lain');
    // Penting: gmail.com bukan domain pihak lain — sender tunggal Brevo
    // memang memakai alamat Gmail, dan itu SAH.
    assert.ok(!terdeteksi('victerphanjaya@gmail.com'), 'gmail.com harus diizinkan');
  });

  test('domain yang hanya MIRIP tidak terdeteksi', () => {
    // "notis-a.dev" tidak boleh cocok dengan "is-a.dev"
    assert.ok(!terdeteksi('a@notis-a.dev'), 'notis-a.dev bukan subdomain is-a.dev');
    // "is-a.dev.evil.com" tidak boleh cocok
    assert.ok(!terdeteksi('a@is-a.dev.evil.com'), 'domain penyerang tidak boleh cocok');
  });
});
