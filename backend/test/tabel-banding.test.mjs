/**
 * Tabel perbandingan paket: panjang baris + paket atas mencakup paket bawah.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BUG YANG DIJAGA OLEH TES INI
 * ══════════════════════════════════════════════════════════════════════════════
 * Setiap baris tabel hanya punya TIGA nilai, padahal paketnya sudah EMPAT sejak
 * paket Gratis ditambahkan. Tidak ada yang error — tabelnya cuma bergeser satu
 * kolom:
 *
 *   yang dibaca pengunjung          seharusnya
 *   ──────────────────────────      ─────────────────────
 *   Gratis      ← data Standar      Gratis      ← data Gratis
 *   Standar     ← data Profesional  Standar     ← data Standar
 *   Profesional ← data Enterprise   Profesional ← data Profesional
 *   Enterprise  ← KOSONG ("—")      Enterprise  ← data Enterprise
 *
 * Jadi laporan pengguna "Enterprise tidak centang semua" sebenarnya tabel yang
 * salah baca satu kolom penuh — dan kolom Gratis pun salah, tapi tidak ada yang
 * menyadarinya karena datanya kebetulan mirip.
 *
 * ── KENAPA TIDAK KETAHUAN LEBIH AWAL ─────────────────────────────────────────
 * Frontend membaca `nilai[i]` per kolom dan menampilkan "—" kalau tidak ada.
 * Jadi nilai yang hilang terlihat seperti SEL YANG MEMANG KOSONG, bukan seperti
 * kesalahan. Tidak ada error di log, tidak ada halaman rusak.
 *
 * Satu-satunya cara menangkapnya: membandingkan PANJANG array dengan JUMLAH
 * KOLOM. Itu yang dilakukan tes ini.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPricing } from '../src/pricing.mjs';
import { KUOTA_METRIK_GRATIS, TOTAL_METRIK_GRATIS, BONUS_STAR, KUOTA_DASAR } from '../src/langganan.mjs';

const data = buildPricing();
const kolom = data.kolom;

// ── BARIS HAK TERPISAH DIKECUALIKAN DARI ATURAN "PAKET ATAS MENCAPAI BAWAH" ──
//
// Aturan itu berlaku untuk FITUR BERTINGKAT: kalau Standar punya dokumentasi
// publik, Profesional juga punya.
//
// Tapi ada baris yang menyatakan HAK YANG SALING MENGGANTIKAN, bukan fitur
// bertingkat. Contohnya akses metrik lewat star:
//
//   Gratis   : 1 proyek, sekali per akun, harus memberi star
//   Berbayar : seluruh proyek, selama berlangganan, tanpa star
//
// Paket berbayar tidak "mencakup" hak gratis itu — hak mereka berbeda jenis.
// Kalau barisnya ikut dicentang untuk berbayar, tabelnya menjanjikan dua hal
// yang saling meniadakan.
//
// Baris seperti itu ditandai `hakTerpisah: true` di data, dan dikecualikan
// dari pemeriksaan pencakupan.
const barisFitur = data.tabel.filter((b) => !b.bagian);
const barisBertingkat = barisFitur.filter((b) => !b.hakTerpisah);

// ══════════════════════════════════════════════════════════════════════════════
// 1. PANJANG BARIS HARUS SAMA DENGAN JUMLAH KOLOM
// ══════════════════════════════════════════════════════════════════════════════

test('setiap baris tabel punya satu nilai per paket', () => {
  // Ini tes yang menangkap bug aslinya. Kalau paket ditambahkan tapi array
  // nilainya tidak diperbarui, tes ini gagal.
  const salah = [];
  for (const b of barisFitur) {
    const n = b.nilai?.length ?? 0;
    if (n !== kolom.length) salah.push(`${b.fitur}: ${n} nilai, butuh ${kolom.length}`);
  }
  assert.deepEqual(salah, [],
    `panjang nilai tidak cocok dengan jumlah kolom (${kolom.length}):\n  ${salah.join('\n  ')}`);
});

test('tidak ada baris dengan nilai kosong atau null', () => {
  // ── TIGA NILAI YANG SAH: true, false, dan TEKS ────────────────────────────
  // Sebagian besar baris memang ya/tidak. Tapi ada baris yang jawabannya
  // BERBEDA di tiap kolom — misalnya jumlah proyek: 5 untuk Gratis, "Semua
  // proyek" untuk yang berbayar. Itu bukan pertanyaan ya/tidak, jadi
  // jawabannya juga bukan centang.
  //
  // Yang dilarang: null dan string kosong — frontend akan menampilkannya
  // sebagai teks "null" atau sel kosong di dalam tabel.
  for (const b of barisFitur) {
    for (let i = 0; i < b.nilai.length; i++) {
      const v = b.nilai[i];
      const sah = v === true || v === false
        || (typeof v === 'string' && v.trim().length > 0);
      assert.ok(sah,
        `${b.fitur} kolom ${kolom[i]?.nama}: nilai harus true/false/teks, dapat ${JSON.stringify(v)}`);
    }
  }
});

test('baris bernilai teks tidak dicampur dengan centang di baris yang sama', () => {
  // Mencampur teks dan centang dalam satu baris membuat tabelnya sulit dibaca:
  // kolom pertama menampilkan "5 proyek", kolom kedua menampilkan centang —
  // dan pembaca tidak bisa membandingkannya.
  //
  // Aturannya: satu baris memakai SATU bentuk jawaban.
  for (const b of barisFitur) {
    const adaTeks = b.nilai.some((v) => typeof v === 'string');
    const adaBool = b.nilai.some((v) => typeof v === 'boolean');
    assert.ok(!(adaTeks && adaBool),
      `baris "${b.fitur}" mencampur teks dan centang: ${JSON.stringify(b.nilai)}`);
  }
});

test('urutan kolom sesuai urutan paket', () => {
  // Nilai tabel dibaca posisional. Kalau urutan paket berubah tanpa tabelnya
  // ikut berubah, semua centangnya bergeser — persis bug yang baru diperbaiki.
  assert.deepEqual(kolom.map((k) => k.id),
    ['gratis', 'standar', 'profesional', 'enterprise'],
    'urutan kolom harus mengikuti urutan paket: gratis, standar, profesional, enterprise');
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PAKET ATAS MENCAPAI SEMUA YANG PAKET BAWAH PUNYA
// ══════════════════════════════════════════════════════════════════════════════

test('Enterprise mencakup SEMUA yang Profesional punya', () => {
  // Permintaan pengguna langsung: "benerin yang enterprise centang semua yg
  // profesional". Ini aturan yang harus selalu benar — paket lebih mahal tidak
  // boleh mengurangi apa pun.
  const iPro = kolom.findIndex((k) => k.id === 'profesional');
  const iEnt = kolom.findIndex((k) => k.id === 'enterprise');

  const kurang = [];
  for (const b of barisBertingkat) {
    if (b.nilai[iPro] === true && b.nilai[iEnt] !== true) {
      kurang.push(b.fitur);
    }
  }
  assert.deepEqual(kurang, [],
    `Enterprise belum centang padahal Profesional centang:\n  ${kurang.join('\n  ')}`);
});

test('setiap paket atas mencakup semua yang paket bawahnya punya', () => {
  // Aturan yang sama untuk SEMUA tingkat, bukan hanya Enterprise. Ini yang
  // mencegah masalah serupa muncul lagi saat paket ditambahkan.
  const kurang = [];
  for (let i = 1; i < kolom.length; i++) {
    for (const b of barisBertingkat) {
      if (b.nilai[i - 1] === true && b.nilai[i] !== true) {
        kurang.push(`${kolom[i].nama} kurang "${b.fitur}" (dimiliki ${kolom[i - 1].nama})`);
      }
    }
  }
  assert.deepEqual(kurang, [],
    `paket atas tidak mencakup paket bawah:\n  ${kurang.join('\n  ')}`);
});

test('paket berbayar mencakup seluruh fitur paket Gratis', () => {
  // Konsistensi dengan kartu harga, yang menulis "Mencakup seluruh fitur paket
  // Gratis". Kalau tabelnya berbeda, dua halaman saling bertentangan.
  const iG = kolom.findIndex((k) => k.id === 'gratis');
  const kurang = [];
  for (const b of barisBertingkat) {
    if (b.nilai[iG] !== true) continue;
    for (let i = 1; i < kolom.length; i++) {
      if (b.nilai[i] !== true) kurang.push(`${kolom[i].nama} kurang "${b.fitur}"`);
    }
  }
  assert.deepEqual(kurang, []);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TABEL TIDAK BOLEH MENJANJIKAN YANG TIDAK DIMILIKI PAKET
// ══════════════════════════════════════════════════════════════════════════════

test('paket Gratis tidak dicentang untuk dukungan dan hasil uji semua proyek', () => {
  // ── KENAPA INI DIPERIKSA KHUSUS ────────────────────────────────────────────
  // Saat memperbaiki bug panjang array, mudah sekali mencentang SEMUA baris
  // untuk Gratis "supaya aman". Itu menjanjikan yang tidak bisa dipenuhi:
  //
  //   · Paket Gratis tidak punya jalur dukungan sama sekali.
  //   · "Hasil uji dan metrik SELURUH proyek" bukan milik Gratis — dia hanya
  //     dapat SATU proyek, dan itu pun lewat bonus star.
  //
  // Paket gratis yang menjanjikan terlalu banyak lebih merugikan daripada
  // paket gratis yang jujur soal batasnya.
  const iG = kolom.findIndex((k) => k.id === 'gratis');
  const harusKosong = ['Hasil uji dan metrik seluruh proyek', 'Dukungan email langsung'];

  for (const nama of harusKosong) {
    const b = barisFitur.find((x) => x.fitur === nama);
    assert.ok(b, `baris "${nama}" harus ada di tabel`);
    assert.equal(b.nilai[iG], false,
      `Gratis tidak boleh dicentang untuk "${nama}" — paket itu tidak memilikinya`);
  }
});

test('baris yang menjanjikan SELURUH PROYEK tidak dicentang di Gratis', () => {
  // ── CATATAN: TES INI PERNAH TERLALU LUAS ───────────────────────────────────
  // Versi pertama menolak SEMUA baris yang menyebut "seluruh" atau "tanpa
  // batas" — dan gagal pada "Dokumentasi publik tanpa batas", yang MEMANG
  // berlaku untuk Gratis: dokumentasi publik tidak dibatasi untuk siapa pun.
  //
  // Yang benar-benar tidak boleh dijanjikan ke Gratis adalah cakupan SELURUH
  // PROYEK. Paket Gratis hanya membuka SATU proyek, dan itu pun lewat bonus
  // star.
  //
  // Pola yang tepat: "seluruh proyek" atau "semua proyek", bukan "seluruh"
  // sendirian.
  const iG = kolom.findIndex((k) => k.id === 'gratis');
  const pelanggar = barisFitur
    .filter((b) => /(seluruh|semua)\s+proyek/i.test(b.fitur) && b.nilai[iG] === true)
    .map((b) => b.fitur);
  assert.deepEqual(pelanggar, [],
    `Gratis tidak boleh dicentang untuk baris yang menjanjikan seluruh proyek:\n  ${pelanggar.join('\n  ')}`);
});

test('Gratis dicentang hanya untuk fitur yang benar-benar dimilikinya', () => {
  // Paket Gratis punya tepat tiga hal: daftar proyek, dokumentasi publik, dan
  // pratinjau metrik satu proyek lewat star. Tabel boleh mencentang LEBIH
  // SEDIKIT (tidak semua fitur perlu jadi baris), tapi tidak boleh lebih.
  //
  // Daftar ini sengaja ditulis eksplisit: kalau seseorang mencentang baris
  // baru untuk Gratis, dia harus memutuskan dulu apakah paket itu benar-benar
  // memberikannya — dan keputusan itu terlihat di sini.
  const iG = kolom.findIndex((k) => k.id === 'gratis');
  // Daftar ini mengikuti aturan 3+2: paket Gratis membuka 3 proyek langsung
  // dan 2 lagi setelah star. Keduanya fitur nyata paket Gratis.
  const boleh = [
    'Dokumentasi publik tanpa batas',
    `${KUOTA_METRIK_GRATIS.login} proyek pertama, langsung setelah masuk`,
    `Tambah ${KUOTA_METRIK_GRATIS.star} proyek dengan memberi star`,
  ];
  const dicentang = barisFitur.filter((b) => b.nilai[iG] === true).map((b) => b.fitur);

  const takTerduga = dicentang.filter((f) => !boleh.includes(f));
  assert.deepEqual(takTerduga, [],
    `Gratis dicentang untuk baris yang belum dikonfirmasi:\n  ${takTerduga.join('\n  ')}\n` +
    'Kalau paket Gratis memang memberi fitur itu, tambahkan ke daftar "boleh" di tes ini.');
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. TABEL TIDAK KOSONG DAN PUNYA BAGIAN
// ══════════════════════════════════════════════════════════════════════════════

test('tabel punya baris yang cukup dan dikelompokkan', () => {
  assert.ok(barisFitur.length >= 10, `tabel hanya punya ${barisFitur.length} baris fitur`);
  const bagian = data.tabel.filter((b) => b.bagian).map((b) => b.bagian);
  assert.ok(bagian.length >= 2, `tabel harus punya minimal 2 bagian, ada ${bagian.length}`);
});

test('setiap baris punya label fitur', () => {
  for (const b of data.tabel) {
    if (b.bagian) continue;
    assert.ok(typeof b.fitur === 'string' && b.fitur.trim().length > 0,
      'setiap baris fitur harus punya label');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. KLAIM "SEKALI PER AKUN" HARUS COCOK DENGAN ATURAN SISTEM
// ══════════════════════════════════════════════════════════════════════════════

test('teks bonus star menyebut HASIL AKHIRNYA, bukan mekanismenya', () => {
  // ── KENAPA HASIL, BUKAN TAMBAHAN ──────────────────────────────────────────
  // Versi sebelumnya menulis "Tambah 2 proyek lagi (jadi 5)" — mekanisme plus
  // hasilnya. Pembaca harus menghitung sendiri untuk tahu apa yang dia dapat.
  //
  // Di kotak bonus, yang dicari pembaca adalah HASILNYA — sama seperti baris
  // paket berbayar di bawahnya yang berbunyi "Kuota bulan itu jadi 2 token",
  // bukan "tambah 1 token".
  //
  // Sekarang semuanya sejajar bentuknya: menyebut hasil akhir.
  const teksGratis = [];

  for (const p of data.paket) {
    for (const f of p.fitur) {
      if (/star/i.test(f.teks)) teksGratis.push(f.teks);
    }
  }
  const bonusGratis = data.bonusStar.hasil.find((h) => h.paket === 'Free' || h.paket === 'Gratis');
  assert.ok(bonusGratis, 'harus ada baris bonus untuk paket Free');
  teksGratis.push(bonusGratis.dapat);

  // ── MINIMAL SATU, BUKAN DUA ───────────────────────────────────────────────
  // Versi sebelumnya mengharapkan dua: satu di kartu, satu di kotak bonus.
  // Sekarang kartunya tidak lagi menyebut star — barisnya digabung jadi
  // "Dokumentasi publik tanpa batas, 5 proyek terbuka penuh".
  //
  // Jadi yang tersisa satu: kotak bonus. Itu memang tempatnya.
  assert.ok(teksGratis.length >= 1, `harus ada minimal 1 teks bonus star, ada ${teksGratis.length}`);

  // Angka 5 (total proyek) harus disebut — itu hasil akhirnya
  const angkaBenar = teksGratis.filter((t) => t.includes(String(TOTAL_METRIK_GRATIS)));
  assert.ok(angkaBenar.length >= 1,
    `teks bonus harus menyebut hasil akhirnya (${TOTAL_METRIK_GRATIS} proyek):\n  ${teksGratis.join('\n  ')}`);

  // Dan TIDAK boleh ada yang menuliskan mekanisme "3 + 2" di kartu
  const mekanisme = teksGratis.filter((t) => /3 proyek|tambah 2|jadi 5/i.test(t));
  assert.deepEqual(mekanisme, [],
    `kartu dan kotak bonus tidak boleh menuliskan mekanisme 3+2:\n  ${mekanisme.join('\n  ')}`);
});

test('tidak ada teks yang MENGKLAIM star bisa diklaim per proyek', () => {
  // ── CATATAN: TES INI PERNAH TERLALU KAKU ──────────────────────────────────
  // Versi pertama menolak frasa "sekali per proyek" di mana pun — dan gagal
  // pada kalimat yang justru MENEGASKAN kebalikannya:
  //
  //   "jatah itu sekali per akun, BUKAN sekali per proyek"
  //
  // Kalimat itu benar dan berguna: ia menjawab kekeliruan yang paling mungkin
  // terjadi. Yang berbahaya adalah frasa itu dipakai sebagai KLAIM, bukan
  // sebagai pembanding.
  //
  // Yang diperiksa sekarang: "sekali per proyek" boleh muncul HANYA kalau
  // didahului kata penyangkalan ("bukan", "tidak") dalam kalimat yang sama.
  const semua = [];
  for (const p of data.paket) for (const f of p.fitur) semua.push(f.teks);
  for (const q of data.faq) semua.push(q.jawab);
  for (const h of data.bonusStar.hasil) semua.push(h.dapat);
  semua.push(data.bonusStar.teks);

  const pelanggar = [];
  for (const t of semua) {
    // Cari setiap kemunculan, lalu periksa 40 karakter sebelumnya
    let idx = t.toLowerCase().indexOf('sekali per proyek');
    while (idx !== -1) {
      const sebelum = t.slice(Math.max(0, idx - 40), idx).toLowerCase();
      const disangkal = /bukan\s*$|tidak\s*$|bukanlah\s*$/.test(sebelum);
      if (!disangkal) pelanggar.push(t.slice(Math.max(0, idx - 50), idx + 30));
      idx = t.toLowerCase().indexOf('sekali per proyek', idx + 1);
    }
  }

  assert.deepEqual(pelanggar, [],
    `"sekali per proyek" hanya boleh muncul sebagai penyangkalan:\n  ${pelanggar.join('\n  ')}`);
});

test('aturan sistem: paket Gratis dapat 5 proyek (3 login + 2 star)', () => {
  // ── TES INI MENJAGA ASUMSI YANG DIPAKAI SEMUA TEKS DI HALAMAN HARGA ────────
  // Kalau angkanya berubah, tes ini gagal LEBIH DULU — sebelum teksnya jadi
  // salah dan menjanjikan angka yang tidak bisa dipenuhi sistem.
  assert.equal(KUOTA_METRIK_GRATIS.login, 3, 'login memberi 3 proyek');
  assert.equal(KUOTA_METRIK_GRATIS.star, 2, 'star menambah 2 proyek');
  assert.equal(TOTAL_METRIK_GRATIS, 5, 'totalnya 5 proyek');

  assert.equal(KUOTA_DASAR.gratis, 0,
    'paket gratis tidak punya kuota TOKEN; yang dia punya jatah metrik proyek');
});

test('bonus star untuk paket berbayar berbeda dari hak paket gratis', () => {
  // ── BARIS TABEL BONUS STAR SUDAH DIHAPUS ──────────────────────────────────
  // Versi sebelumnya punya baris terpisah "Tambah 2 proyek dengan memberi
  // star", ditandai `hakTerpisah` karena hanya Gratis yang dicentang.
  //
  // Baris itu dihapus: di tabel perbandingan, baris yang cuma dicentang di
  // satu kolom membuat tabelnya terlihat tidak konsisten — dan pembaca yang
  // membandingkan paket tidak sedang mempelajari mekanisme.
  //
  // Yang tersisa: baris "Akses data metrik" dengan nilai TEKS — "5 proyek"
  // untuk Gratis, "Semua proyek" untuk yang berbayar.
  //
  // Jadi yang diuji sekarang: perbedaan haknya memang tercermin di baris itu.
  assert.ok(BONUS_STAR >= 1, 'bonus star untuk paket berbayar minimal 1 token');

  const iG = kolom.findIndex((k) => k.id === 'gratis');
  const barisAkses = barisFitur.find((b) => /akses data metrik/i.test(b.fitur));
  assert.ok(barisAkses, 'harus ada baris "Akses data metrik" di tabel');

  // Nilainya harus TEKS, bukan centang — karena jawabannya berbeda per kolom
  assert.equal(typeof barisAkses.nilai[iG], 'string',
    'kolom Gratis harus berisi teks ("5 proyek"), bukan centang');
  assert.ok(barisAkses.nilai[iG].includes(String(TOTAL_METRIK_GRATIS)),
    `kolom Gratis harus menyebut ${TOTAL_METRIK_GRATIS} proyek`);

  // Paket berbayar: seluruh proyek, bukan angka
  for (let i = 1; i < kolom.length; i++) {
    assert.equal(typeof barisAkses.nilai[i], 'string',
      `${kolom[i].nama} harus berisi teks, bukan centang`);
    assert.match(barisAkses.nilai[i], /semua proyek/i,
      `${kolom[i].nama} harus menyebut "Semua proyek"`);
  }
});
