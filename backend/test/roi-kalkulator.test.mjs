/**
 * Tes kalkulator ROI.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA PERHITUNGAN KEUANGAN HARUS DIUJI
 * ══════════════════════════════════════════════════════════════════════════════
 * Tampilan yang salah terlihat. Perhitungan yang salah TIDAK terlihat — ia
 * menghasilkan angka yang masuk akal tapi keliru, dan pengunjung memakainya
 * untuk mengambil keputusan.
 *
 * Yang paling berbahaya: angka yang terlalu bagus. Kalau kalkulatornya
 * melebih-lebihkan penghematan, pengunjung merasa ditipu saat menemukan biaya
 * nyatanya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hitungHemat,
  bersihkanMasukan,
  jepit,
  rupiah,
  rupiahRingkas,
  jam,
  persenUntukPemeliharaan,
  TARIF_DEFAULT,
  SAAS_DEFAULT,
} from '../../assets/js/roi-hitung.js';

/* ══ 1. PERHITUNGAN DASAR ══════════════════════════════════════════════════ */

test('menghitung hemat waktu dari jam × tarif', () => {
  const h = hitungHemat({
    jamPerMinggu: 10,
    jumlahOrang: 1,
    tarifPerJam: 50_000,
    biayaSaas: 0,
    jumlahPenggunaSaas: 0,
    biayaPemeliharaanBulanan: 0,
  });

  // 10 jam/minggu × 52 minggu × Rp50.000 = Rp26.000.000
  assert.equal(h.jamPerTahun, 520);
  assert.equal(h.hematWaktuPerTahun, 26_000_000);
  assert.equal(h.hematBersihPerTahun, 26_000_000);
});

test('jumlah orang mengalikan hemat waktu', () => {
  const h = hitungHemat({
    jamPerMinggu: 5,
    jumlahOrang: 4,
    tarifPerJam: 50_000,
    biayaSaas: 0,
    jumlahPenggunaSaas: 0,
  });

  // 5 jam × 4 orang = 20 jam/minggu
  assert.equal(h.jamPerMinggu, 20);
  assert.equal(h.jamPerTahun, 1040);
});

test('menghitung biaya SaaS yang dihilangkan', () => {
  const h = hitungHemat({
    jamPerMinggu: 0,
    jumlahOrang: 1,
    biayaSaas: 150_000,
    jumlahPenggunaSaas: 5,
    biayaPemeliharaanBulanan: 0,
  });

  assert.equal(h.biayaSaasPerBulan, 750_000);
  assert.equal(h.biayaSaasPerTahun, 9_000_000);
});

/* ══ 2. BIAYA PEMELIHARAAN DIKURANGI ═══════════════════════════════════════ */

test('biaya pemeliharaan DIKURANGI dari penghematan', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Sistem self-hosted tidak gratis: ada server, ada waktu pemeliharaan.
  // Kalkulator yang menyembunyikan biaya itu memberi hasil yang terlalu bagus,
  // dan pengunjung yang menemukan biaya nyatanya merasa ditipu.
  const h = hitungHemat({
    jamPerMinggu: 10,
    jumlahOrang: 1,
    tarifPerJam: 50_000,
    biayaSaas: 0,
    jumlahPenggunaSaas: 0,
    biayaPemeliharaanBulanan: 200_000,
  });

  assert.equal(h.biayaPemeliharaanPerTahun, 2_400_000);
  assert.equal(h.hematBersihPerTahun, 26_000_000 - 2_400_000);
  assert.ok(h.hematBersihPerTahun < h.hematKotorPerTahun);
});

test('biaya pemeliharaan besar → hasilnya NEGATIF dan ditandai', () => {
  // ── KENAPA HARUS BISA NEGATIF ─────────────────────────────────────────────
  // Kalau pemeliharaan lebih mahal dari penghematannya, self-hosted BUKAN
  // pilihan yang tepat. Kalkulator yang selalu menampilkan hasil positif tidak
  // berguna untuk mengambil keputusan.
  const h = hitungHemat({
    jamPerMinggu: 1,
    jumlahOrang: 1,
    tarifPerJam: 50_000,
    biayaSaas: 0,
    jumlahPenggunaSaas: 0,
    biayaPemeliharaanBulanan: 5_000_000,
  });

  assert.ok(h.hematBersihPerTahun < 0, 'harus bisa negatif');
  assert.equal(h.menguntungkan, false);
});

/* ══ 3. MASUKAN TIDAK WAJAR ════════════════════════════════════════════════ */

test('masukan kosong → hasil nol, tidak NaN', () => {
  const h = hitungHemat({});

  assert.equal(h.hematBersihPerTahun, 0);
  assert.ok(Number.isFinite(h.hematBersihPerTahun));
  assert.equal(h.adaIsian, false, 'harus tahu bahwa belum ada yang diisi');
});

test('angka negatif dijepit ke nol', () => {
  const h = hitungHemat({ jamPerMinggu: -10, tarifPerJam: -5000 });

  assert.equal(h.masukan.jamPerMinggu, 0);
  assert.equal(h.masukan.tarifPerJam, 0);
  assert.equal(h.hematBersihPerTahun, 0);
});

test('nilai ekstrem dijepit ke batas masuk akal', () => {
  // 999999 jam/minggu tidak berarti apa-apa — ada 168 jam dalam seminggu.
  const h = hitungHemat({ jamPerMinggu: 999_999 });

  assert.equal(h.masukan.jamPerMinggu, 168);
});

test('teks dan NaN diperlakukan sebagai nol, bukan crash', () => {
  for (const nilaiAneh of ['abc', NaN, null, undefined, {}, []]) {
    const h = hitungHemat({ jamPerMinggu: nilaiAneh, tarifPerJam: nilaiAneh });
    assert.ok(Number.isFinite(h.hematBersihPerTahun),
      `hasil bukan angka untuk masukan ${JSON.stringify(nilaiAneh)}`);
  }
});

test('jepit() bekerja untuk rentang apa pun', () => {
  assert.equal(jepit(5, { min: 0, max: 10 }), 5);
  assert.equal(jepit(-5, { min: 0, max: 10 }), 0);
  assert.equal(jepit(50, { min: 0, max: 10 }), 10);
  assert.equal(jepit('abc', { min: 0, max: 10 }), 0);
});

/* ══ 4. KONVERSI WAKTU ═════════════════════════════════════════════════════ */

test('konversi bulan memakai 52/12 minggu, bukan 4', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // Satu tahun = 52 minggu = 12 bulan, jadi satu bulan = 52/12 = 4,33 minggu.
  // Memakai 4 membuang 3 minggu per tahun, dan pada angka besar selisihnya
  // terlihat jelas.
  const h = hitungHemat({
    jamPerMinggu: 12,
    jumlahOrang: 1,
    tarifPerJam: 100_000,
    biayaSaas: 0,
    jumlahPenggunaSaas: 0,
  });

  // 12 × 4,33 = 52 jam/bulan (bukan 48)
  assert.equal(h.jamPerBulan, 52);
  assert.equal(h.jamPerTahun, 624);
});

/* ══ 5. FORMAT RUPIAH ══════════════════════════════════════════════════════ */

test('rupiah() memakai pemisah ribuan Indonesia', () => {
  assert.equal(rupiah(1_234_567), 'Rp1.234.567');
  assert.equal(rupiah(0), 'Rp0');
  assert.equal(rupiah(999), 'Rp999');
});

test('rupiah() menangani negatif dengan benar', () => {
  // Minus harus DI DEPAN "Rp", bukan di dalam angkanya.
  assert.equal(rupiah(-2_400_000), '-Rp2.400.000');
});

test('rupiahRingkas() menyingkat angka besar', () => {
  assert.match(rupiahRingkas(1_500_000_000), /1,5 miliar/);
  assert.match(rupiahRingkas(54_000_000), /54,0 juta/);
  assert.match(rupiahRingkas(500_000), /500 ribu/);
  assert.match(rupiahRingkas(-54_000_000), /^-Rp/);
});

test('jam() menulis jumlah jam dengan benar', () => {
  assert.equal(jam(0), '0 jam');
  assert.equal(jam(520), '520 jam');
  assert.match(jam(520.5), /520,5 jam/);
});

/* ══ 6. PERSENTASE BIAYA PEMELIHARAAN ══════════════════════════════════════ */

test('persenUntukPemeliharaan() menghitung bagian yang habis', () => {
  // ── KENAPA INI, BUKAN "TITIK IMPAS" ───────────────────────────────────────
  // Versi pertama memakai rumus titik impas yang SALAH — hasilnya selalu
  // "1 bulan" untuk hampir semua kasus, karena self-hosted tidak punya biaya
  // awal yang perlu dibalik.
  //
  // Yang berguna: berapa persen penghematan kotor yang habis untuk
  // pemeliharaan. "Hemat Rp44 juta, tapi 60% habis untuk pemeliharaan"
  // menjelaskan keadaan yang sama dengan lebih jujur.
  const h = hitungHemat({
    jamPerMinggu: 10,
    tarifPerJam: 50_000,
    biayaPemeliharaanBulanan: 500_000,
  });

  // Hemat kotor 26 juta/tahun, pemeliharaan 6 juta/tahun → 23%
  const persen = persenUntukPemeliharaan(h);
  assert.equal(persen, 23);
});

test('persenUntukPemeliharaan() null kalau tidak ada penghematan', () => {
  const h = hitungHemat({ jamPerMinggu: 0, biayaSaas: 0 });
  assert.equal(persenUntukPemeliharaan(h), null);
});

test('persenUntukPemeliharaan() dibatasi 100', () => {
  // Pemeliharaan lebih besar dari penghematan → 100%, bukan 250%.
  const h = hitungHemat({
    jamPerMinggu: 1,
    tarifPerJam: 50_000,
    biayaPemeliharaanBulanan: 10_000_000,
  });

  const persen = persenUntukPemeliharaan(h);
  assert.ok(persen <= 100, `dapat ${persen} — harus maksimal 100`);
});

/* ══ 7. HASIL TIDAK PERNAH NaN ATAU INFINITY ═══════════════════════════════ */

test('tidak ada hasil yang NaN atau Infinity untuk masukan apa pun', () => {
  // ── KENAPA DIUJI ──────────────────────────────────────────────────────────
  // "RpNaN" di halaman publik merusak kepercayaan lebih dari sekadar bug
  // tampilan — ia membuat seluruh perhitungannya terlihat tidak dirawat.
  const kasus = [
    {},
    { jamPerMinggu: 0 },
    { jamPerMinggu: 168, jumlahOrang: 1000, tarifPerJam: 10_000_000 },
    { biayaSaas: 50_000_000, jumlahPenggunaSaas: 10_000 },
    { biayaPemeliharaanBulanan: 100_000_000 },
    { jamPerMinggu: NaN, tarifPerJam: Infinity },
    { jamPerMinggu: '10', tarifPerJam: '50000' },
  ];

  const kunciAngka = [
    'jamPerMinggu', 'jamPerBulan', 'jamPerTahun',
    'hematWaktuPerBulan', 'hematWaktuPerTahun',
    'biayaSaasPerBulan', 'biayaSaasPerTahun', 'biayaPemeliharaanPerTahun',
    'hematKotorPerTahun', 'hematBersihPerTahun', 'hematBersihPerBulan',
  ];

  for (const masukan of kasus) {
    const h = hitungHemat(masukan);
    for (const kunci of kunciAngka) {
      assert.ok(
        Number.isFinite(h[kunci]),
        `${kunci} = ${h[kunci]} untuk masukan ${JSON.stringify(masukan)}`,
      );
    }
  }
});

test('masukan berupa teks angka tetap dihitung', () => {
  // Input dari form HTML selalu string. Kalau tidak dikonversi, hasilnya nol.
  const h = hitungHemat({ jamPerMinggu: '10', jumlahOrang: '2', tarifPerJam: '50000' });

  assert.equal(h.jamPerMinggu, 20);
  assert.equal(h.hematWaktuPerTahun, 52_000_000);
});

/* ══ 8. NILAI DEFAULT ══════════════════════════════════════════════════════ */

test('nilai default masuk akal dan bisa diubah', () => {
  assert.ok(TARIF_DEFAULT > 0, 'tarif default harus lebih dari nol');
  assert.ok(SAAS_DEFAULT > 0, 'biaya SaaS default harus lebih dari nol');

  // Pengunjung HARUS bisa mengubahnya — kalau tidak, hasilnya memakai asumsi
  // kita dan tidak berguna untuk keadaannya.
  const h = hitungHemat({ tarifPerJam: 999_999 });
  assert.equal(h.masukan.tarifPerJam, 999_999);
});

test('bersihkanMasukan mengembalikan semua kunci yang dibutuhkan', () => {
  const m = bersihkanMasukan({});

  for (const kunci of [
    'jamPerMinggu', 'jumlahOrang', 'tarifPerJam',
    'biayaSaas', 'jumlahPenggunaSaas', 'biayaPemeliharaanBulanan',
  ]) {
    assert.ok(kunci in m, `kunci '${kunci}' hilang`);
    assert.ok(Number.isFinite(m[kunci]), `${kunci} bukan angka`);
  }
});
