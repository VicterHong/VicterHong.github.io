/**
 * Tes: atribut `hidden` harus benar-benar menyembunyikan elemen.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BUG YANG DICEGAH TES INI
 * ══════════════════════════════════════════════════════════════════════════════
 * Atribut `hidden` bawaan HTML hanya berarti `display: none` di stylesheet
 * bawaan browser. Begitu CSS KITA menyetel `display` pada elemen yang sama,
 * aturan kita MENANG dan `hidden` berhenti bekerja.
 *
 * Yang terjadi di inspector:
 *
 *   .sentinel-panel { display: grid; }   ← CSS kita
 *   <div class="sentinel-panel" hidden>  ← atribut HTML, DIKALAHKAN
 *
 * Akibatnya panel detail muncul sejak halaman dibuka — menutupi form login —
 * dan tombol "Tutup" tidak bisa menutupnya, karena `element.hidden = true`
 * tidak berpengaruh apa-apa lagi.
 *
 * ── KENAPA BUG INI MUDAH TERJADI ────────────────────────────────────────────
 * Tidak ada error di console. Tidak ada tes yang gagal. Halamannya "jalan",
 * hanya tampilannya salah dan tombolnya mati. Dan ia kembali setiap kali ada
 * elemen baru yang memakai `hidden`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', 'public');

const html = readFileSync(join(AKAR, 'sentinel.html'), 'utf8');
const css = readFileSync(join(AKAR, 'assets', 'css', 'sentinel.css'), 'utf8');
const js = readFileSync(join(AKAR, 'assets', 'js', 'sentinel.js'), 'utf8');

/* ── Aturan pengaman harus ada ──────────────────────────────────────────── */

test('CSS punya aturan [hidden] yang mengalahkan display', () => {
  // Pola: [hidden] { display: none !important; }
  const cocok = css.match(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);

  assert.ok(
    cocok,
    'CSS tidak punya aturan `[hidden] { display: none !important; }`. '
    + 'Setiap elemen yang memakai atribut `hidden` DAN punya `display` di CSS '
    + 'akan tetap terlihat — dan tombol yang menutupnya tidak akan bekerja.',
  );
});

/* ── Setiap elemen yang memakai `hidden` harus terjangkau aturan itu ────── */

test('setiap elemen dengan atribut hidden di HTML tercakup aturan [hidden]', () => {
  const denganHidden = [...html.matchAll(/<[a-z]+[^>]*\sid="([a-zA-Z]+)"[^>]*\shidden/g)]
    .map((m) => m[1]);

  assert.ok(
    denganHidden.length > 0,
    'tidak ada elemen ber-atribut hidden yang terbaca — pola pemeriksaan rusak?',
  );

  // Aturan `[hidden]` berlaku untuk SEMUA elemen, jadi tidak ada yang bisa
  // lolos. Tes ini memastikan daftarnya terbaca, supaya kalau polanya rusak
  // kita tahu — bukan diam-diam memeriksa nol elemen.
  for (const id of denganHidden) {
    assert.ok(
      css.includes('[hidden]'),
      `#${id} memakai atribut hidden tapi CSS tidak punya aturan [hidden]`,
    );
  }
});

test('setiap elemen yang JS toggle .hidden tercakup aturan [hidden]', () => {
  const diToggle = [...new Set(
    [...js.matchAll(/\$\(\s*['"]#([a-zA-Z]+)['"]\s*\)\.hidden/g)].map((m) => m[1]),
  )];

  assert.ok(diToggle.length > 0, 'tidak ada elemen yang di-toggle — pola pemeriksaan rusak?');

  // ── YANG PALING BERBAHAYA: ELEMEN YANG DI-TOGGLE ─────────────────────────
  // Elemen yang selalu `hidden` tidak masalah kalau aturannya hilang — ia
  // hanya akan terlihat terus dan itu langsung kelihatan. Yang berbahaya
  // adalah elemen yang di-TOGGLE: ia tampak benar saat dibuka, lalu tombol
  // penutupnya diam-diam tidak bekerja.
  for (const id of diToggle) {
    assert.ok(
      css.includes('[hidden]'),
      `#${id} di-toggle lewat .hidden tapi CSS tidak punya aturan [hidden] — `
      + 'tombol yang menutupnya tidak akan bekerja',
    );
  }
});

/* ── Panel detail khususnya: harus punya display di CSS ─────────────────── */

test('panel detail punya display di CSS — kalau tidak, aturan [hidden] tidak diuji', () => {
  // ── KENAPA INI DIPERIKSA ─────────────────────────────────────────────────
  // Tes di atas memastikan aturan [hidden] ada. Tapi kalau `.sentinel-panel`
  // TIDAK punya `display`, aturan itu tidak sedang menutup apa pun — dan
  // bug-nya bisa kembali lewat jalan lain tanpa tes ini sadar.
  //
  // Jadi keduanya diperiksa: aturannya ada, DAN ada sesuatu yang perlu
  // ditutup olehnya.
  const cocok = css.match(/\.sentinel-panel\s*\{[^}]*display:/s);
  assert.ok(cocok, '.sentinel-panel tidak menyetel display — periksa apakah aturan [hidden] masih relevan');

  // Dan pastikan panel memang punya atribut hidden di HTML.
  assert.match(
    html,
    /class="sentinel-panel"[^>]*hidden|id="panelDetail"[^>]*hidden/,
    'panel detail tidak punya atribut hidden — ia akan tampil sejak halaman dibuka',
  );
});
