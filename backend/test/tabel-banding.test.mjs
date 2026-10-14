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

const data = buildPricing();
const kolom = data.kolom;
const barisFitur = data.tabel.filter((b) => !b.bagian);

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
  for (const b of barisFitur) {
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
    for (const b of barisFitur) {
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
  for (const b of barisFitur) {
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
  const boleh = [
    'Dokumentasi publik tanpa batas',
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
