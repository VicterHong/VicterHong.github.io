/**
 * Tes: setiap direktori di `s/` harus kode akses yang SAH.
 *
 * ── MASALAH YANG DITUTUP ────────────────────────────────────────────────────
 * URL proyek memakai kode acak (`/s/e7kz4swubfvg/`) supaya nama proyek tidak
 * terbaca dari alamat. Tapi pernah ada folder `s/whatsapp-bot/` — sisa lama
 * yang tidak terdaftar di `access_codes` dan TIDAK punya satu pun tautan dari
 * situs.
 *
 * Dampaknya bukan sekadar folder tak terpakai: halaman itu berisi bagian
 * "Keputusan desain", "Batas dan kegagalan", dan "Metrik operasional" —
 * isi teknis yang seharusnya berada di balik gerbang token — TERBUKA PENUH.
 * Siapa pun yang menebak `/s/whatsapp-bot/` membacanya tanpa token.
 *
 * ── ATURAN YANG DIJAGA ──────────────────────────────────────────────────────
 *   1. Setiap direktori di `s/` harus terdaftar di `access_codes` proyek.
 *   2. Halaman proyek ber-gerbang tidak boleh memuat isi teknis NYATA di HTML;
 *      yang boleh ada hanya pratinjau placeholder.
 *
 * Tes ini membaca `projects.js` sebagai sumber kebenaran — bukan daftar yang
 * ditulis ulang di sini, supaya menambah proyek tidak perlu menyunting tes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const proyekJs = readFileSync(ROOT + 'assets/js/data/projects.js', 'utf8');

/** Ambil semua kode dari `access_codes: [...]` di projects.js. */
function kodeSah() {
  const kode = new Set();
  for (const m of proyekJs.matchAll(/access_codes:\s*\[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/'([a-z0-9]+)'/g)) kode.add(k[1]);
  }
  return kode;
}

function direktoriS() {
  const dir = ROOT + 's';
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

test('setiap direktori di s/ adalah kode akses yang sah', () => {
  const sah = kodeSah();
  assert.ok(sah.size > 0, 'projects.js harus punya minimal satu access_codes');

  const yatim = direktoriS().filter((d) => !sah.has(d));
  assert.deepEqual(
    yatim,
    [],
    `direktori tanpa kode sah: ${yatim.join(', ')} — `
    + 'hapus, atau daftarkan kodenya di access_codes proyek terkait',
  );
});

test('setiap kode sah punya halaman', () => {
  const hilang = [...kodeSah()].filter((k) => !existsSync(`${ROOT}s/${k}/index.html`));
  assert.deepEqual(hilang, [], `kode tanpa halaman: ${hilang.join(', ')}`);
});

test('halaman proyek ber-gerbang tidak membocorkan isi teknis nyata', () => {
  // Halaman yang punya gerbang token boleh memuat JUDUL bagian (supaya
  // pengunjung tahu apa yang akan didapat), tapi tidak boleh memuat isi
  // paragrafnya. Placeholder yang dipakai saat ini berbunyi "Alasan di balik
  // setiap pilihan teknologi..." — kalimat pengantar, bukan penjelasan nyata.
  const PENANDA_ISI_NYATA = [
    /14 kelas kontrol terpisah/i,       // detail implementasi nyata
    /JSONL, bukan basis data/i,          // keputusan teknis nyata
    /faster-whisper/i,                   // nama komponen internal
  ];

  for (const d of direktoriS()) {
    const isi = readFileSync(`${ROOT}s/${d}/index.html`, 'utf8');
    const punyaGerbang = /lockedBody|locked-section/.test(isi);
    if (!punyaGerbang) continue;

    for (const pola of PENANDA_ISI_NYATA) {
      assert.doesNotMatch(
        isi,
        pola,
        `s/${d}/ membocorkan isi teknis nyata (${pola}) padahal punya gerbang`,
      );
    }
  }
});

test('halaman ber-gerbang menyembunyikan isi dari pembaca layar', () => {
  // aria-hidden pada wadah terkunci: isi pratinjau tidak dibacakan sebelum
  // token dibuka. Tanpa ini, pembaca layar membacakan seluruh placeholder
  // sebagai konten nyata.
  for (const d of direktoriS()) {
    const isi = readFileSync(`${ROOT}s/${d}/index.html`, 'utf8');
    if (!/lockedBody/.test(isi)) continue;
    const blok = isi.slice(isi.indexOf('id="lockedBody"'), isi.indexOf('id="lockedBody"') + 200);
    assert.match(blok, /aria-hidden="true"/, `s/${d}/: #lockedBody harus aria-hidden`);
  }
});
