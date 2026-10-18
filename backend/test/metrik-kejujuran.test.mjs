/**
 * Tes metrik terverifikasi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA METRIK PERLU TESNYA SENDIRI
 * ══════════════════════════════════════════════════════════════════════════════
 * Preflight sudah menjaga angka di halaman Visi & Misi. Tapi bagian metrik ini
 * menampilkan angka yang LEBIH BANYAK dan LEBIH SPESIFIK — dan setiap satunya
 * bisa menjadi klaim palsu tanpa ada yang menyadarinya.
 *
 * Yang dijaga tes ini:
 *
 *   1. SETIAP metrik punya `sumber` — cara pengunjung memeriksanya
 *   2. Jenis metrik hanya 'terukur' atau 'klaim-repo' — tidak ada yang
 *      mengaku "saya ukur" padahal angkanya dari README
 *   3. Tidak ada metrik dampak bisnis (jam dihemat, persen pengurangan biaya)
 *      yang tidak bisa dibuktikan
 *   4. Tidak ada angka yang dibulatkan ke atas
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');

// ── SUMBER KONTEN PRIVAT, BUKAN ASET PUBLIK ─────────────────────────────────
// `assets/js/data/metrik.js` kini kosong: angkanya dipindahkan ke direktori
// konten privat agar tidak bisa dibaca dari repo publik tanpa login.
const evidence = await import('../src/evidence.mjs');
const metrikProyek = evidence.metrikProyek();
const catatanMetrik = evidence.catatanMetrik();

const adaKonten = Object.keys(metrikProyek).length > 0;
const butuhKonten = adaKonten ? {} : { skip: 'konten privat tidak tersedia di checkout ini' };

/* ══ 1. SETIAP METRIK PUNYA SUMBER ═════════════════════════════════════════ */

test('SETIAP metrik punya sumber cara memeriksanya', butuhKonten, () => {
  // ── KENAPA INI TES PALING PENTING DI BERKAS INI ───────────────────────────
  // Angka tanpa cara memeriksa sama saja dengan klaim. Seluruh alasan bagian
  // ini ada adalah supaya pengunjung bisa membuktikan sendiri — dan satu
  // metrik tanpa sumber merusak janji itu.
  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik) {
      assert.ok(
        typeof m.sumber === 'string' && m.sumber.length >= 15,
        `${slug} → "${m.label}" tidak punya sumber yang memadai: ${m.sumber}`,
      );
    }
  }
});

test('setiap metrik punya label dan nilai', butuhKonten, () => {
  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik) {
      assert.ok(m.label, `${slug}: ada metrik tanpa label`);
      assert.ok(m.nilai != null && m.nilai !== '', `${slug} → "${m.label}" tanpa nilai`);
    }
  }
});

/* ══ 2. JENIS METRIK JUJUR ═════════════════════════════════════════════════ */

test('setiap metrik punya jenis yang sah', butuhKonten, () => {
  const sah = new Set(['terukur', 'klaim-repo']);

  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik) {
      assert.ok(
        sah.has(m.jenis),
        `${slug} → "${m.label}" punya jenis tidak dikenal: ${m.jenis}`,
      );
    }
  }
});

test('metrik "terukur" punya sumber berupa perintah atau lokasi', butuhKonten, () => {
  // ── KENAPA DIBEDAKAN DARI "klaim-repo" ────────────────────────────────────
  // "saya ukur" berarti saya menjalankan perintahnya sendiri. Sumbernya harus
  // berupa perintah yang bisa dijalankan ulang, atau lokasi yang bisa dibuka —
  // bukan penjelasan naratif.
  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik.filter((x) => x.jenis === 'terukur')) {
      const sumber = m.sumber.toLowerCase();
      // ── POLA PERINTAH ATAU LOKASI BERKAS ──────────────────────────────────
      // "terukur" berarti saya menjalankan sendiri. Sumbernya harus bisa
      // dijalankan ulang atau dibuka — bukan penjelasan naratif.
      const adaPerintah = sumber.includes('grep') || sumber.includes('find')
        || sumber.includes('ls ') || sumber.includes('wc -l')
        || sumber.includes('ps ') || sumber.includes('npm test')
        || sumber.includes('sqlite') || sumber.includes('package.json')
        || sumber.includes('__tablename__') || sumber.includes('tidak ada tes')
        // Lokasi berkas yang bisa dibuka pengunjung.
        || /\.(mjs|py|json|db|sql)\b/.test(sumber)
        || sumber.includes('backend/');

      assert.ok(
        adaPerintah,
        `${slug} → "${m.label}" ditandai 'terukur' tapi sumbernya bukan perintah: ${m.sumber}`,
      );
    }
  }
});

/* ══ 3. TIDAK ADA KLAIM DAMPAK BISNIS ══════════════════════════════════════ */

test('TIDAK ADA metrik dampak bisnis yang tidak bisa dibuktikan', butuhKonten, () => {
  // ── KENAPA INI DIJAGA KETAT ───────────────────────────────────────────────
  // "Menghemat 12 jam per minggu" mengandaikan kita tahu berapa jam yang dipakai
  // SEBELUM sistemnya — dan kita tidak tahu: tidak ada klien, tidak ada
  // pengukuran sebelum/sesudah.
  //
  // Menulisnya berarti mengarang. Dan satu angka karangan merusak seluruh
  // halaman: pengunjung yang menemukan satu klaim palsu akan meragukan 231 tes
  // yang asli juga.
  const terlarang = [
    /jam.*(dihemat|hemat|menghemat)/i,
    /menghemat.*jam/i,
    /pengurangan biaya/i,
    /mengurangi biaya.*%/i,
    /efisiensi.*%/i,
    /meningkatkan.*%/i,
    /produktivitas.*%/i,
  ];

  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik) {
      const teks = `${m.label} ${m.nilai} ${m.sumber}`;
      for (const pola of terlarang) {
        assert.ok(
          !pola.test(teks),
          `${slug} → "${m.label}" mengandung klaim dampak bisnis yang tidak bisa `
          + `dibuktikan. Untuk hitungan penghematan, pakai kalkulator di halaman harga.`,
        );
      }
    }
  }
});

/* ══ 4. CATATAN KEJUJURAN ADA ══════════════════════════════════════════════ */

test('catatan kejujuran ada dan menyebut yang TIDAK ada', butuhKonten, () => {
  // ── KENAPA CATATAN INI WAJIB ──────────────────────────────────────────────
  // Daftar angka tanpa keterangan terlihat seperti pameran. Yang membuatnya
  // berguna adalah penjelasan APA yang TIDAK ada di sana — dan itu yang jarang
  // ditulis orang.
  assert.ok(catatanMetrik.judul, 'catatan tanpa judul');
  assert.ok(Array.isArray(catatanMetrik.poin));
  assert.ok(catatanMetrik.poin.length >= 2, 'catatan terlalu sedikit');

  const semua = catatanMetrik.poin.join(' ').toLowerCase();
  assert.ok(
    semua.includes('dampak bisnis') || semua.includes('tidak ada metrik'),
    'catatan tidak menyebut bahwa metrik dampak bisnis sengaja tidak ada',
  );
});

/* ══ 5. TAUTAN REPO VALID ══════════════════════════════════════════════════ */

test('setiap proyek punya tautan repo GitHub yang sah', () => {
  for (const [slug, data] of Object.entries(metrikProyek)) {
    assert.ok(data.repo, `${slug} tidak punya tautan repo`);
    assert.match(
      data.repo,
      /^https:\/\/github\.com\//,
      `${slug} punya tautan repo yang bukan GitHub: ${data.repo}`,
    );
  }
});

test('setiap proyek punya ringkasan dan commit', () => {
  for (const [slug, data] of Object.entries(metrikProyek)) {
    assert.ok(data.ringkas && data.ringkas.length > 20, `${slug} ringkasannya terlalu pendek`);
    assert.ok(data.commit, `${slug} tidak punya commit — pengunjung tidak tahu versi mana yang diukur`);
  }
});

/* ══ 6. KONSISTENSI DENGAN projects.js ═════════════════════════════════════ */

test('slug proyek cocok dengan yang ada di projects.js', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kalau slug di sini tidak cocok dengan projects.js, metriknya menunjuk
  // proyek yang tidak ada di halaman — dan tidak ada yang menyadarinya karena
  // keduanya tetap tampil tanpa error.
  const projectsSrc = readFileSync(join(AKAR, 'assets', 'js', 'data', 'projects.js'), 'utf8');

  for (const slug of Object.keys(metrikProyek)) {
    if (slug === 'sentinel') continue; // portofolio ini sendiri, bukan di projects.js
    assert.ok(
      projectsSrc.includes(`slug: '${slug}'`),
      `slug '${slug}' ada di metrik.js tapi tidak di projects.js`,
    );
  }
});

/* ══ 7. ANGKA TIDAK DIBULATKAN KE ATAS ════════════════════════════════════ */

test('angka metrik tidak dibulatkan ke atas', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // "~25 MB" jujur karena ada tanda perkiraan. "30 MB" untuk pemakaian 25 MB
  // adalah pembulatan ke atas yang membuat klaimnya lebih bagus dari kenyataan.
  for (const [slug, data] of Object.entries(metrikProyek)) {
    for (const m of data.metrik) {
      const nilai = String(m.nilai);

      // Angka bulat tanpa tanda "~" harus berupa bilangan yang wajar.
      // Yang mencurigakan: angka besar yang berakhiran 0 atau 00 padahal
      // sumbernya menyebut angka spesifik.
      if (nilai.includes('~')) continue; // perkiraan, sudah jujur

      const angka = Number(nilai.replace(/\./g, ''));
      if (!Number.isFinite(angka)) continue;

      // Kalau sumbernya memuat angka spesifik, nilai harus cocok.
      const cocokDiSumber = m.sumber.match(/\b(\d{2,})\b/);
      if (cocokDiSumber) {
        const diSumber = Number(cocokDiSumber[1]);
        assert.ok(
          angka === diSumber || angka === diSumber * 1,
          `${slug} → "${m.label}": nilai ${nilai} tidak cocok dengan angka di sumbernya (${diSumber})`,
        );
      }
    }
  }
});
