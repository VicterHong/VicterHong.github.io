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
    // ── KOMENTAR HARUS DIBUANG DULU ─────────────────────────────────────────
    // Kode yang diperbaiki mendokumentasikan bug lama di komentar:
    //
    //   //   kirimEmailResetSandi({...}).catch(() => {});
    //
    // Kalau komentar tidak dibuang, tes ini gagal karena dokumentasi —
    // padahal dokumentasi justru hal yang benar. Yang diperiksa adalah
    // KODE yang berjalan, bukan penjelasannya.
    const buangKomentar = (s) => s
      .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
      .replace(/\/\/[^\n]*/g, '');        // // ...

    for (const berkas of ['src/routes.mjs', 'src/auth-routes.mjs', 'src/checkout.mjs']) {
      const isi = buangKomentar(baca(berkas));

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

    // ── AMBIL HANYA BLOK HANDLER, BUKAN SELURUH BERKAS ──────────────────────
    // Versi pertama tes ini mengambil dari `pattern: '/api/auth/lupa-sandi'`
    // sampai AKHIR BERKAS — sehingga ikut membaca 14 endpoint berikutnya
    // dan menemukan 14 pesan berbeda. Itu bug di tes, bukan di produk.
    //
    // Batas blok yang benar: dari pattern ini sampai pattern berikutnya.
    const mulai = isi.indexOf("pattern: '/api/auth/lupa-sandi'");
    assert.ok(mulai !== -1, 'endpoint lupa-sandi harus ada');

    const sesudahMulai = isi.slice(mulai + 10);           // lewati pattern ini sendiri
    const patternBerikut = sesudahMulai.indexOf("pattern: '/api/");
    const blok = patternBerikut === -1
      ? isi.slice(mulai)
      : isi.slice(mulai, mulai + 10 + patternBerikut);

    // ── YANG DIPERIKSA: PESAN SUKSES SAJA ───────────────────────────────────
    // Blok berisi DUA pesan:
    //   1. "Email tidak valid."        → respons 400, validasi input
    //   2. "Kalau email itu terdaftar…" → respons 200, pesan sukses
    //
    // Pesan validasi (400) TIDAK membocorkan apa pun — ia menolak input yang
    // memang salah sebelum akun diperiksa. Yang harus seragam adalah pesan
    // SUKSES: ia tidak boleh berbeda antara "akun ada" dan "akun tidak ada".
    const pesanSukses = blok.match(/sendJson\(res,\s*200,\s*\{[^}]*message:\s*'([^']+)'/g) ?? [];
    const unik = new Set(
      pesanSukses.map((m) => m.match(/message:\s*'([^']+)'/)?.[1] ?? ''),
    );

    assert.ok(unik.size > 0, 'handler harus punya pesan sukses (200)');
    assert.equal(
      unik.size, 1,
      `pesan SUKSES harus seragam, ditemukan ${unik.size} variasi: ${[...unik].join(' | ')}`,
    );

    // Pesan itu harus pesan netral yang tidak mengonfirmasi keberadaan akun.
    const satu = [...unik][0] ?? '';
    assert.match(
      satu, /Kalau email itu terdaftar/,
      `pesan sukses harus netral ("Kalau email itu terdaftar..."), dapat: ${satu}`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── C. CONFIG: PERINGATAN DOMAIN YANG TIDAK BISA DIVERIFIKASI ───────────────
// ══════════════════════════════════════════════════════════════════════════════

describe('config memperingatkan domain pihak lain', () => {
  test('ada daftar domain pihak lain (untuk peringatan, bukan blokir)', () => {
    const isi = baca('src/config.mjs');

    // Nama variabel berubah dari `domainTidakBisaDiverifikasi` menjadi
    // `domainPihakLain` — karena domain seperti ini MEMANG BISA dipakai
    // kalau sudah diverifikasi di penyedia. Nama lama menyiratkan
    // "tidak mungkin", yang terbukti salah.
    assert.match(
      isi, /domainPihakLain/,
      'config harus punya daftar domain pihak lain',
    );
    for (const d of ['is-a.dev', 'github.io', 'pages.dev']) {
      assert.ok(isi.includes(`'${d}'`), `daftar harus memuat ${d}`);
    }
  });

  test('peringatan TIDAK masuk ke problems (layanan tetap jalan)', () => {
    const isi = baca('src/config.mjs');

    // Ini regresi fatal yang dicegah: dulu domain is-a.dev masuk ke
    // `problems`, dan server.mjs memanggil process.exit(1) — layanan mati
    // justru SETELAH domainnya berhasil diverifikasi.
    const blokEmail = isi.slice(isi.indexOf('domainPihakLain'));
    const dalamBlok = blokEmail.slice(0, 600);

    assert.match(
      dalamBlok, /warnings\.push/,
      'domain pihak lain harus masuk `warnings`, bukan `problems`',
    );
    assert.doesNotMatch(
      dalamBlok, /problems\.push/,
      'domain pihak lain TIDAK BOLEH masuk `problems` — itu mematikan layanan',
    );
  });

  test('validateWarnings() diekspor', () => {
    const isi = baca('src/config.mjs');
    assert.match(isi, /export function validateWarnings/);
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
