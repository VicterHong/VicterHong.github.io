/**
 * Tes sandbox.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG DIJAGA TES INI — DAN KENAPA KETAT
 * ══════════════════════════════════════════════════════════════════════════════
 * Sandbox yang salah rancang lebih berbahaya daripada tidak punya sandbox.
 *
 *   1. TIDAK MENYENTUH SERVER. Kalau sandbox mengirim permintaan ke backend,
 *      siapa pun bisa mengisi database produksi dengan data sampah — dari
 *      halaman publik yang tidak butuh login. Ini yang paling penting.
 *
 *   2. TIDAK ADA DATA NYATA. Memakai data pelanggan sungguhan di halaman
 *      publik adalah kebocoran, bukan demo.
 *
 *   3. DIKATAKAN SEBAGAI DEMO. Pengunjung harus tahu ia melihat contoh.
 *      Kebingungan tentang itu membuatnya merasa ditipu saat menyadarinya.
 *
 *   4. TOMBOL YANG TIDAK BEKERJA DIBERI LABEL. Tombol yang diam tanpa
 *      penjelasan membuat pengunjung mengira sistemnya rusak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAR = join(__dirname, '..', '..');

const sandboxSrc = readFileSync(join(AKAR, 'assets', 'js', 'sandbox-view.js'), 'utf8');
const dataSrc = readFileSync(join(AKAR, 'assets', 'js', 'data', 'sandbox.js'), 'utf8');
const css = readFileSync(join(AKAR, 'assets', 'css', 'sandbox.css'), 'utf8');
const html = readFileSync(join(AKAR, 'home.html'), 'utf8');

const {
  contohParts,
  contohMovements,
  ringkasDemo,
  partsMenipis,
  nilaiStok,
  PEMBERITAHUAN_SANDBOX,
  aksiBekerja,
} = await import(join(AKAR, 'assets', 'js', 'data', 'sandbox.js'));

/* ══ 1. TIDAK MENYENTUH SERVER ═════════════════════════════════════════════ */

test('sandbox TIDAK memanggil jaringan sama sekali', () => {
  // ── KENAPA INI TES PALING PENTING DI BERKAS INI ───────────────────────────
  // Kalau sandbox mengirim permintaan ke backend, siapa pun bisa mengisi
  // database produksi dengan data sampah. Halaman ini publik dan tidak butuh
  // login — jadi tidak ada yang menahannya.
  const terlarang = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\baxios\b/,
    /\.post\s*\(/,
    /\.put\s*\(/,
    /\.delete\s*\(/,
    /navigator\.sendBeacon/,
    /EventSource/,
    /WebSocket/,
  ];

  for (const pola of terlarang) {
    assert.ok(
      !pola.test(sandboxSrc),
      `sandbox memakai ${pola} — sandbox harus berjalan sepenuhnya di browser`,
    );
  }
});

test('sandbox tidak mengimpor modul API', () => {
  // ── KENAPA DIUJI TERPISAH ─────────────────────────────────────────────────
  // Memanggil API bisa terjadi lewat pembungkus (api.js), bukan fetch langsung.
  // Impor ke modul API akan lolos dari pemeriksaan pola di atas.
  const impor = [...sandboxSrc.matchAll(/import\s+[^'"]*from\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1]);

  for (const jalur of impor) {
    assert.ok(
      !jalur.includes('api') && !jalur.includes('auth') && !jalur.includes('klien'),
      `sandbox mengimpor '${jalur}' — modul itu bisa memanggil server`,
    );
  }
});

/* ══ 2. TIDAK ADA DATA NYATA ═══════════════════════════════════════════════ */

test('data contoh tidak memuat alamat email atau nama domain nyata', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Memakai data pelanggan sungguhan di halaman publik adalah kebocoran,
  // bukan demo. Ini pemeriksaan cepat untuk menangkapnya kalau ada yang
  // menyalin data dari database.
  const pola = [
    /@[a-z0-9-]+\.(com|id|net|org|co)/i, // email atau domain
    /\b\d{10,}\b/, // nomor telepon atau ID panjang
    /\b\d{16}\b/, // nomor kartu
  ];

  for (const p of pola) {
    assert.ok(!p.test(dataSrc), `data sandbox memuat pola data nyata: ${p}`);
  }
});

test('data contoh ditandai jelas sebagai buatan', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Kode yang membaca berkas ini nanti harus tahu bahwa datanya contoh.
  // Komentar yang menyatakannya mencegah seseorang menggantinya dengan data
  // sungguhan tanpa sadar.
  assert.match(dataSrc, /dibuat|contoh|fiktif|demo/i,
    'berkas data tidak menyatakan bahwa isinya contoh');
});

/* ══ 3. DIKATAKAN SEBAGAI DEMO ═════════════════════════════════════════════ */

test('pemberitahuan demo ada dan menyebut poin pentingnya', () => {
  assert.ok(PEMBERITAHUAN_SANDBOX.judul, 'pemberitahuan tanpa judul');
  assert.ok(PEMBERITAHUAN_SANDBOX.poin.length >= 3, 'pemberitahuan terlalu sedikit');

  const semua = PEMBERITAHUAN_SANDBOX.poin.join(' ').toLowerCase();

  assert.ok(
    semua.includes('tidak tersimpan') || semua.includes('tidak ada perubahan'),
    'pemberitahuan tidak menyebut bahwa tidak ada yang tersimpan',
  );
  assert.ok(
    semua.includes('contoh') || semua.includes('dibuat'),
    'pemberitahuan tidak menyebut bahwa datanya contoh',
  );
});

test('sandbox menampilkan label DEMO di antarmukanya', () => {
  assert.ok(sandboxSrc.includes('DEMO'), 'tidak ada label DEMO di antarmuka');
});

/* ══ 4. TOMBOL YANG TIDAK BEKERJA DIBERI LABEL ═════════════════════════════ */

test('tombol yang tidak bekerja diberi label contoh', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Tombol yang diam tanpa penjelasan membuat pengunjung mengira sistemnya
  // rusak. Yang diberi label membuatnya tahu itu batas demo.
  assert.ok(
    sandboxSrc.includes('sandbox-lencana-contoh'),
    'tidak ada lencana "contoh" pada tombol yang tidak bekerja',
  );

  assert.ok(
    sandboxSrc.includes('disabled'),
    'tombol contoh tidak dinonaktifkan — pengunjung akan mengira ia rusak saat diklik',
  );

  assert.ok(
    css.includes('.sandbox-lencana-contoh'),
    'lencana "contoh" tidak punya gaya',
  );
});

test('daftar aksi yang bekerja hanya berisi aksi sisi-browser', () => {
  // ── KENAPA DIJAGA ─────────────────────────────────────────────────────────
  // Kalau ada yang menambahkan aksi yang butuh server ke daftar ini, tombolnya
  // akan tampak bisa diklik lalu gagal diam-diam.
  for (const aksi of ['cari', 'urutkan', 'lihat-detail']) {
    assert.equal(aksiBekerja(aksi), true, `aksi '${aksi}' harus bekerja di sandbox`);
  }

  for (const aksi of ['tambah-stok', 'hapus', 'simpan', 'kirim']) {
    assert.equal(
      aksiBekerja(aksi),
      false,
      `aksi '${aksi}' butuh server — tidak boleh ditandai bekerja`,
    );
  }
});

/* ══ 5. PERHITUNGAN BENAR ══════════════════════════════════════════════════ */

test('partsMenipis() hanya mengembalikan yang di bawah minimum', () => {
  const menipis = partsMenipis();

  for (const p of menipis) {
    assert.ok(p.stok < p.min, `${p.kode}: stok ${p.stok} tidak di bawah minimum ${p.min}`);
  }

  // Dan sebaliknya: yang di bawah minimum harus ikut.
  const harusnya = contohParts.filter((p) => p.stok < p.min);
  assert.equal(menipis.length, harusnya.length);
});

test('nilaiStok() menjumlahkan stok × harga', () => {
  const hitung = contohParts.reduce((t, p) => t + p.stok * p.harga, 0);
  assert.equal(nilaiStok(), hitung);
});

test('ringkasDemo() konsisten dengan datanya', () => {
  const r = ringkasDemo();

  assert.equal(r.jumlahJenis, contohParts.length);
  assert.equal(r.menipis, partsMenipis().length);
  assert.equal(r.totalNilai, nilaiStok());
  assert.equal(r.kategori, new Set(contohParts.map((p) => p.kategori)).size);
});

test('ringkasDemo() tidak mengembalikan NaN', () => {
  const r = ringkasDemo();

  for (const k of ['jumlahJenis', 'totalNilai', 'menipis', 'kategori']) {
    assert.ok(Number.isFinite(r[k]), `${k} = ${r[k]}`);
  }
});

/* ══ 6. DATA PERGERAKAN KONSISTEN ══════════════════════════════════════════ */

test('setiap pergerakan menunjuk kode barang yang ada', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Pergerakan yang menunjuk barang tidak ada akan hilang tanpa error — dan
  // riwayatnya jadi tidak lengkap tanpa ada yang tahu.
  const kode = new Set(contohParts.map((p) => p.kode));

  for (const m of contohMovements) {
    assert.ok(kode.has(m.kode), `pergerakan menunjuk kode '${m.kode}' yang tidak ada`);
  }
});

test('setiap pergerakan punya jenis yang sah', () => {
  for (const m of contohMovements) {
    assert.ok(
      m.jenis === 'masuk' || m.jenis === 'keluar',
      `pergerakan '${m.kode}' punya jenis tidak dikenal: ${m.jenis}`,
    );
  }
});

/* ══ 7. KELAS CSS PUNYA GAYA ═══════════════════════════════════════════════ */

test('setiap kelas yang dibuat JS punya gaya di CSS', () => {
  const kelas = [...new Set(
    [...sandboxSrc.matchAll(/el\(\s*'[a-z]+'\s*,\s*'([^']+)'/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean),
  )];

  const tanpaGaya = kelas.filter((k) => !css.includes(`.${k}`));

  assert.deepEqual(tanpaGaya, [], `kelas tanpa gaya: ${tanpaGaya.join(', ')}`);
});

/* ══ 8. KONTRAS TOMBOL CONTOH ══════════════════════════════════════════════ */

test('tombol contoh tetap terbaca (kontras WCAG AA)', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Tombol yang teksnya terlalu redup membuat pengunjung mengira halamannya
  // rusak — bukan mengira tombolnya sengaja dimatikan.
  //
  // #a1a1aa di atas latar #0a0a0b ≈ 6:1 — lolos AA (butuh 4.5:1).
  assert.ok(
    css.includes('#a1a1aa'),
    'tombol contoh tidak memakai warna teks berkontras cukup',
  );
});

/* ══ 9. HTML MEMUAT SEMUANYA ═══════════════════════════════════════════════ */

test('HTML punya host dan memuat berkas sandbox', () => {
  assert.ok(html.includes('id="sandboxHost"'), 'HTML tidak punya #sandboxHost');
  assert.ok(html.includes('id="judulSandbox"'), 'HTML tidak punya #judulSandbox');
  assert.ok(html.includes('assets/css/sandbox.css'), 'HTML tidak memuat sandbox.css');
  assert.ok(html.includes('pasangSandbox'), 'HTML tidak memanggil pasangSandbox');
});
