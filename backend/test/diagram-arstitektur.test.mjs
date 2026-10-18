/**
 * Tes diagram arsitektur.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG DIJAGA TES INI
 * ══════════════════════════════════════════════════════════════════════════════
 * Diagram arsitektur adalah klaim tentang cara sistem bekerja. Kalau isinya
 * tidak cocok dengan kode, pengunjung teknis akan menemukannya — dan itu lebih
 * merusak daripada tidak punya diagram sama sekali.
 *
 * Yang dijaga:
 *   1. Setiap langkah punya penjelasan — tidak ada kotak kosong
 *   2. Jenis langkah hanya yang dikenal — tidak ada warna yang tidak ada
 *   3. Setiap alur punya langkah keamanan — diagram tanpa keamanan
 *      menyesatkan untuk proyek yang mengklaim aman
 *   4. Tidak ada langkah yatim (id duplikat dalam satu alur)
 *   5. Kelas CSS yang dibuat JS punya gayanya
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');

// ── SUMBER KONTEN PRIVAT, BUKAN ASET PUBLIK ─────────────────────────────────
// Dulu tes ini mengimpor `assets/js/data/alur.js`. Isinya kini dipindahkan ke
// direktori konten privat supaya diagram teknis tidak ikut ke repo publik.
// Tes tetap memeriksa konten yang SAMA, dari sumber sebenarnya.
const evidence = await import('../src/evidence.mjs');
// Fungsi, bukan objek — dipanggil sekali di sini supaya seluruh tes di bawah
// memakai bentuk data yang sama seperti kode produksi.
const alurProyek = evidence.alurProyek();
const JENIS_LANGKAH = evidence.jenisLangkah();

// Checkout CI tidak punya konten privat. Lewati tes berbasis konten dengan
// alasan tertulis, bukan gagal karena berkas yang memang tidak boleh ada.
const adaKonten = Object.keys(alurProyek).length > 0;
const butuhKonten = adaKonten ? {} : { skip: 'konten privat tidak tersedia di checkout ini' };
if (!adaKonten) {
  // Terlihat di log CI: kalau ini muncul di mesin pengembang, berarti
  // CONTENT_DIR sedang dialihkan tes lain, bukan kontennya yang hilang.
  console.log(`[diagram] konten alur kosong (contentDir=${config.contentDir})`);
}

const jsDiagram = readFileSync(join(AKAR, 'assets', 'js', 'diagram-view.js'), 'utf8');
const cssDiagram = readFileSync(join(AKAR, 'assets', 'css', 'diagram.css'), 'utf8');
const html = readFileSync(join(AKAR, 'home.html'), 'utf8');

/* ══ 1. SETIAP LANGKAH LENGKAP ═════════════════════════════════════════════ */

test('setiap langkah punya label, ringkas, dan detail', butuhKonten, () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Langkah tanpa `detail` akan menampilkan kotak yang bisa diklik tapi kosong
  // saat dibuka. Itu lebih buruk daripada tidak bisa diklik.
  for (const [slug, alur] of Object.entries(alurProyek)) {
    for (const l of alur.langkah) {
      assert.ok(l.id, `${slug}: ada langkah tanpa id`);
      assert.ok(l.label && l.label.length > 2, `${slug} → ${l.id}: label terlalu pendek`);
      assert.ok(
        l.ringkas && l.ringkas.length >= 15,
        `${slug} → ${l.id}: ringkasannya terlalu pendek (${l.ringkas})`,
      );
      assert.ok(
        l.detail && l.detail.length >= 40,
        `${slug} → ${l.id}: detailnya terlalu pendek — kotaknya kosong saat diklik`,
      );
    }
  }
});

/* ══ 2. JENIS LANGKAH DIKENAL ══════════════════════════════════════════════ */

test('setiap langkah punya jenis yang dikenal', butuhKonten, () => {
  for (const [slug, alur] of Object.entries(alurProyek)) {
    for (const l of alur.langkah) {
      assert.ok(
        JENIS_LANGKAH[l.jenis],
        `${slug} → ${l.id}: jenis '${l.jenis}' tidak dikenal (akan tanpa warna)`,
      );
    }
  }
});

test('setiap jenis langkah punya gaya CSS', () => {
  for (const [id, j] of Object.entries(JENIS_LANGKAH)) {
    assert.ok(
      cssDiagram.includes(`.alur-langkah--${j.kelas}`),
      `jenis '${id}' (kelas .alur-langkah--${j.kelas}) tidak punya gaya di diagram.css`,
    );
  }
});

/* ══ 3. SETIAP ALUR PUNYA LANGKAH KEAMANAN ═════════════════════════════════ */

test('SETIAP alur punya minimal satu langkah keamanan', butuhKonten, () => {
  // ── KENAPA DIJAGA KETAT ───────────────────────────────────────────────────
  // Halaman ini mengklaim sistemnya aman. Diagram yang tidak menunjukkan
  // lapisan keamanannya membuat klaim itu tidak punya dukungan visual — dan
  // untuk pengunjung teknis, itu justru menimbulkan pertanyaan.
  for (const [slug, alur] of Object.entries(alurProyek)) {
    const adaAman = alur.langkah.some((l) => l.jenis === 'aman');
    assert.ok(adaAman, `${slug}: tidak punya langkah keamanan sama sekali`);
  }
});

test('alur Sentinel menunjukkan verifikasi SEBELUM penyimpanan', butuhKonten, () => {
  // ── KENAPA URUTANNYA DIUJI ────────────────────────────────────────────────
  // Ini klaim keamanan yang paling penting di seluruh proyek: payload palsu
  // ditolak SEBELUM tersimpan. Kalau diagramnya menampilkan urutan sebaliknya,
  // diagramnya berbohong tentang jaminan keamanannya.
  const alur = alurProyek.sentinel.langkah;
  const iTtd = alur.findIndex((l) => l.id === 'ttd');
  const iAntrean = alur.findIndex((l) => l.id === 'antrean');

  assert.ok(iTtd >= 0, 'langkah verifikasi tanda tangan tidak ada');
  assert.ok(iAntrean >= 0, 'langkah antrean tidak ada');
  assert.ok(
    iTtd < iAntrean,
    'diagram menampilkan antrean SEBELUM verifikasi — urutan yang berbahaya',
  );
});

/* ══ 4. TIDAK ADA ID DUPLIKAT ══════════════════════════════════════════════ */

test('tidak ada id langkah yang duplikat dalam satu alur', butuhKonten, () => {
  for (const [slug, alur] of Object.entries(alurProyek)) {
    const id = alur.langkah.map((l) => l.id);
    const unik = new Set(id);

    assert.equal(
      unik.size,
      id.length,
      `${slug}: ada id duplikat — ${id.filter((x, i) => id.indexOf(x) !== i).join(', ')}`,
    );
  }
});

/* ══ 5. SETIAP ALUR PUNYA JUDUL DAN RINGKASAN ══════════════════════════════ */

test('setiap alur punya judul dan ringkasan', butuhKonten, () => {
  for (const [slug, alur] of Object.entries(alurProyek)) {
    assert.ok(alur.judul && alur.judul.length > 5, `${slug}: judul terlalu pendek`);
    assert.ok(
      alur.ringkas && alur.ringkas.length >= 20,
      `${slug}: ringkasan terlalu pendek`,
    );
    assert.ok(alur.langkah.length >= 3, `${slug}: hanya ${alur.langkah.length} langkah`);
  }
});

/* ══ 6. KONSISTENSI DENGAN HTML ════════════════════════════════════════════ */

test('HTML punya elemen host dan memuat berkasnya', () => {
  assert.ok(html.includes('id="diagramHost"'), 'HTML tidak punya #diagramHost');
  assert.ok(html.includes('id="judulDiagram"'), 'HTML tidak punya #judulDiagram');
  assert.ok(html.includes('assets/css/diagram.css'), 'HTML tidak memuat diagram.css');
  assert.ok(html.includes('pasangDiagram'), 'HTML tidak memanggil pasangDiagram');
});

/* ══ 7. KELAS JS PUNYA GAYA ════════════════════════════════════════════════ */

test('setiap kelas yang dibuat JS punya gaya di CSS', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kelas tanpa gaya TIDAK melempar error — elemennya hanya tampil tanpa
  // warna atau jarak, dan itu tidak terlihat sampai ada yang memperhatikan.
  const kelas = [...new Set(
    [...jsDiagram.matchAll(/el\(\s*'[a-z]+'\s*,\s*'([^']+)'/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean),
  )];

  const tanpaGaya = kelas.filter((k) => !cssDiagram.includes(`.${k}`));

  assert.deepEqual(tanpaGaya, [], `kelas tanpa gaya: ${tanpaGaya.join(', ')}`);
});

/* ══ 8. AKSESIBILITAS TAB ══════════════════════════════════════════════════ */

test('tab memakai atribut ARIA yang benar', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Tanpa role="tab"/aria-selected, pembaca layar membacakan semua tab sebagai
  // pilihan yang sama — pengguna tidak tahu mana yang sedang aktif.
  assert.ok(jsDiagram.includes("setAttribute('role', 'tab')"), 'tab tanpa role="tab"');
  assert.ok(jsDiagram.includes("setAttribute('role', 'tablist')"), 'wadah tanpa role="tablist"');
  assert.ok(jsDiagram.includes('aria-selected'), 'tab tanpa aria-selected');
  assert.ok(jsDiagram.includes('aria-controls'), 'tab tanpa aria-controls');
  assert.ok(jsDiagram.includes('role'), 'panel tanpa role');
});

test('tab bisa dinavigasi dengan panah keyboard', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Konvensi tab: panah kiri/kanan berpindah tab. Tanpa itu, pengguna keyboard
  // harus menekan Tab melewati setiap tab untuk sampai ke kontennya.
  for (const tombol of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(
      jsDiagram.includes(tombol),
      `navigasi keyboard tidak menangani ${tombol}`,
    );
  }
});

test('panel memakai <details> untuk buka-tutup', () => {
  // ── KENAPA <details>, BUKAN AKORDEON BUATAN SENDIRI ───────────────────────
  // <details>/<summary> sudah menangani: buka-tutup keyboard, status terbuka
  // untuk pembaca layar, dan pencarian dalam halaman. Akordeon buatan sendiri
  // harus mengimplementasikan ketiganya — dan biasanya hanya satu dikerjakan.
  assert.ok(jsDiagram.includes("el('details'"), 'langkah tidak memakai <details>');
  assert.ok(jsDiagram.includes("el('summary'"), 'langkah tidak memakai <summary>');
});
