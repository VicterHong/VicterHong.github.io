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
  // `null` bukan true/false, jadi frontend akan menampilkannya sebagai teks
  // "null" di dalam sel tabel.
  for (const b of barisFitur) {
    for (let i = 0; i < b.nilai.length; i++) {
      const v = b.nilai[i];
      assert.ok(v === true || v === false,
        `${b.fitur} kolom ${kolom[i]?.nama}: nilai harus true/false, dapat ${JSON.stringify(v)}`);
    }
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

test('teks bonus star menyebut ANGKANYA, bukan kata samar', () => {
  // ── ATURAN BARU: 3 DARI LOGIN + 2 DARI STAR ───────────────────────────────
  // Versi sebelumnya memeriksa frasa "sekali per akun" — aturan LAMA, di mana
  // satu proyek per akun dan wajib star.
  //
  // Sekarang yang penting: teksnya menyebut ANGKA yang benar. "Buka beberapa
  // proyek lagi" tidak memberi tahu apa pun; "tambah 2 proyek" bisa diperiksa.
  //
  // Angkanya diambil dari KUOTA_METRIK_GRATIS — jadi kalau jatahnya diubah di
  // langganan.mjs tanpa memperbarui teks, tes ini gagal.
  const teksStar = [];

  for (const p of data.paket) {
    for (const f of p.fitur) {
      if (/star/i.test(f.teks)) teksStar.push(f.teks);
    }
  }
  for (const h of data.bonusStar.hasil) {
    if (/proyek lagi/i.test(h.dapat)) teksStar.push(h.dapat);
  }

  assert.ok(teksStar.length >= 2, `harus ada minimal 2 teks bonus star, ada ${teksStar.length}`);

  const tanpaAngka = teksStar.filter((t) => !/\d/.test(t));
  assert.deepEqual(tanpaAngka, [],
    `teks bonus star harus menyebut angkanya:\n  ${tanpaAngka.join('\n  ')}`);

  // Dan angkanya harus cocok dengan aturan sistem
  const angkaBenar = teksStar.filter((t) => t.includes(String(KUOTA_METRIK_GRATIS.star)));
  assert.ok(angkaBenar.length >= 2,
    `teks bonus star harus menyebut angka ${KUOTA_METRIK_GRATIS.star}`);
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
  // Paket berbayar mendapat TOKEN dari star; paket gratis mendapat PROYEK
  // METRIK tambahan. Dua hal berbeda, dan itu sebabnya baris tabelnya ditandai
  // `hakTerpisah` — paket berbayar tidak "mencakup" hak ini, karena dia sudah
  // membuka seluruh proyek.
  assert.ok(BONUS_STAR >= 1, 'bonus star untuk paket berbayar minimal 1 token');

  const iG = kolom.findIndex((k) => k.id === 'gratis');
  const barisStar = barisFitur.find((b) => /memberi star/i.test(b.fitur));
  assert.ok(barisStar, 'harus ada baris tabel tentang tambahan proyek dari star');
  assert.equal(barisStar.hakTerpisah, true,
    'baris bonus star harus ditandai hakTerpisah — paket berbayar sudah membuka semua proyek');
  assert.equal(barisStar.nilai[iG], true, 'Gratis harus dicentang di baris bonus star');

  // Dan tidak ada paket berbayar yang dicentang di baris itu
  for (let i = 1; i < kolom.length; i++) {
    assert.equal(barisStar.nilai[i], false,
      `${kolom[i].nama} tidak boleh dicentang di baris bonus star — dia sudah membuka semua proyek`);
  }
});
