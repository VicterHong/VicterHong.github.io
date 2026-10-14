/**
 * Tes circuit breaker per endpoint tujuan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA DATABASE SUNGGUHAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Circuit breaker bergantung pada transisi keadaan yang ditegakkan database:
 * `catatUjiMulai` memakai syarat `WHERE keadaan = 'terbuka'` supaya hanya SATU
 * pekerja yang berhasil memindahkan sirkuit ke setengah terbuka.
 *
 * Mock yang "selalu berhasil UPDATE" akan meloloskan tes yang seharusnya
 * gagal — dan yang lolos itu adalah 50 pesan membanjiri endpoint yang masih
 * mati.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * YANG DIUJI: TRANSISI KEADAAN, BUKAN HANYA PENGHITUNGAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Circuit breaker yang benar-benar berguna bukan yang menghitung kegagalan —
 * tapi yang berpindah keadaan dengan tepat:
 *
 *   tertutup → terbuka        saat gagal beruntun melewati ambang
 *   terbuka  → setengah       saat jendela tunggu lewat
 *   setengah → tertutup       saat percobaan uji BERHASIL
 *   setengah → terbuka        saat percobaan uji GAGAL (tanpa menunggu ambang)
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, getDb } from '../src/db.mjs';

openDb(':memory:');
const sirkuit = await import('../src/sentinel/sirkuit.mjs');

const URL_A = 'https://api-a.contoh.id/webhook';
const URL_A_LAIN = 'https://api-a.contoh.id/webhook-lain';
const URL_B = 'https://api-b.contoh.id/webhook';

function bersihkan() {
  sirkuit.siapkanTabelSirkuit();
  getDb().exec('DELETE FROM sentinel_sirkuit');
}

/** Buat sirkuit gagal sampai ambang, lalu kembalikan waktunya. */
function bukaSirkuit(url, sekarang = Date.now()) {
  let hasil;
  for (let i = 0; i < sirkuit.AMBANG_GAGAL; i++) {
    hasil = sirkuit.catatGagal(url, { pesanGalat: 'Server mati', sekarang });
  }
  return hasil;
}

sirkuit.siapkanTabelSirkuit();
beforeEach(bersihkan);
after(() => closeDb());

/* ══════════════════════════════════════════════════════════════════════════════
   1. KUNCI SIRKUIT — per HOST, bukan per URL lengkap
   ══════════════════════════════════════════════════════════════════════════════ */

test('hostDari mengambil host tanpa jalur', () => {
  assert.equal(sirkuit.hostDari('https://api.contoh.id/webhook/a'), 'api.contoh.id');
  assert.equal(sirkuit.hostDari('https://api.contoh.id'), 'api.contoh.id');
});

test('hostDari MEMBEDAKAN port', () => {
  // ── KENAPA PORT HARUS DIBEDAKAN ───────────────────────────────────────────
  // `api.contoh.id:8080` dan `api.contoh.id:9090` bisa jadi layanan yang
  // berbeda sama sekali. Menggabungkannya akan memutus layanan sehat karena
  // layanan lain di host yang sama sedang mati.
  assert.equal(sirkuit.hostDari('https://api.contoh.id:8080/x'), 'api.contoh.id:8080');
  assert.notEqual(
    sirkuit.hostDari('https://api.contoh.id:8080/x'),
    sirkuit.hostDari('https://api.contoh.id:9090/x'),
  );
});

test('hostDari tahan terhadap URL yang tidak sah', () => {
  // Lebih baik memakai kunci yang aneh daripada crash di jalur pengiriman.
  assert.doesNotThrow(() => sirkuit.hostDari('bukan-url'));
  assert.doesNotThrow(() => sirkuit.hostDari(''));
  assert.doesNotThrow(() => sirkuit.hostDari(null));
  assert.doesNotThrow(() => sirkuit.hostDari(undefined));
});

test('DUA JALUR di host yang sama MEMAKAI sirkuit yang sama', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Kalau sirkuitnya per URL lengkap, endpoint dengan 5 jalur webhook butuh 5×
  // lebih banyak kegagalan sebelum sirkuitnya terbuka. Padahal kalau
  // layanannya mati, SEMUA jalurnya mati.
  bukaSirkuit(URL_A);

  assert.equal(sirkuit.bolehKirim(URL_A_LAIN), false,
    'jalur lain di host yang sama harus ikut diputus');
});

test('host BERBEDA punya sirkuit TERPISAH', () => {
  // ── INI YANG MEMBUATNYA BERGUNA ───────────────────────────────────────────
  // Kalau sirkuitnya global, satu endpoint yang mati akan menghentikan
  // pengiriman ke SEMUA endpoint — termasuk yang sehat.
  bukaSirkuit(URL_A);

  assert.equal(sirkuit.bolehKirim(URL_A), false, 'A harus diputus');
  assert.equal(sirkuit.bolehKirim(URL_B), true, 'B TIDAK boleh ikut diputus');
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. KEADAAN AWAL
   ══════════════════════════════════════════════════════════════════════════════ */

test('sirkuit baru → tertutup, boleh kirim', () => {
  const k = sirkuit.keadaanSirkuit('https://baru.contoh.id/x');
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERTUTUP);
  assert.equal(k.bolehKirim, true);
  assert.equal(k.gagalBeruntun, 0);
});

test('bolehKirim pada host yang belum pernah dicatat → true', () => {
  assert.equal(sirkuit.bolehKirim('https://belum-pernah.contoh.id/x'), true);
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. TERTUTUP → TERBUKA
   ══════════════════════════════════════════════════════════════════════════════ */

test('gagal di bawah ambang → sirkuit tetap tertutup', () => {
  for (let i = 1; i < sirkuit.AMBANG_GAGAL; i++) {
    const h = sirkuit.catatGagal(URL_A, { sekarang: 1000 });
    assert.equal(h.keadaan, sirkuit.KEADAAN.TERTUTUP, `gagal ke-${i} belum boleh memutus`);
  }
  assert.equal(sirkuit.bolehKirim(URL_A, 1000), true);
});

test('gagal mencapai ambang → sirkuit TERBUKA', () => {
  const h = bukaSirkuit(URL_A, 1000);
  assert.equal(h.keadaan, sirkuit.KEADAAN.TERBUKA);
  assert.ok(h.bukaSampai > 1000, 'harus menetapkan kapan boleh diuji lagi');
});

test('sirkuit terbuka → pengiriman DILEWATI', () => {
  bukaSirkuit(URL_A, 1000);

  const k = sirkuit.keadaanSirkuit(URL_A, 1000);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERBUKA);
  assert.equal(k.bolehKirim, false, 'pengiriman harus dilewati');
});

test('keberhasilan di tengah kegagalan MERESET penghitung', () => {
  // ── KENAPA DI RESET, BUKAN DIKURANGI ──────────────────────────────────────
  // Circuit breaker bukan penghitung rasio kegagalan — ia penjaga "apakah
  // endpointnya hidup SEKARANG". Satu keberhasilan membuktikan endpointnya
  // hidup.
  for (let i = 0; i < sirkuit.AMBANG_GAGAL - 1; i++) sirkuit.catatGagal(URL_A, { sekarang: 1000 });
  sirkuit.catatSukses(URL_A, { sekarang: 2000 });

  const k = sirkuit.keadaanSirkuit(URL_A, 2000);
  assert.equal(k.gagalBeruntun, 0, 'penghitung harus direset');
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERTUTUP);
});

test('kegagalan yang TERPISAH oleh keberhasilan tidak menumpuk', () => {
  // 4 gagal + 1 sukses + 4 gagal → TIDAK boleh memutus (belum 5 beruntun)
  for (let i = 0; i < 4; i++) sirkuit.catatGagal(URL_A, { sekarang: 1000 });
  sirkuit.catatSukses(URL_A, { sekarang: 1000 });
  for (let i = 0; i < 4; i++) sirkuit.catatGagal(URL_A, { sekarang: 1000 });

  assert.equal(sirkuit.bolehKirim(URL_A, 1000), true,
    'kegagalan tidak boleh menumpuk melewati keberhasilan');
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. TERBUKA → SETENGAH TERBUKA
   ══════════════════════════════════════════════════════════════════════════════ */

test('jendela tunggu BELUM lewat → tetap tertutup untuk pengiriman', () => {
  const h = bukaSirkuit(URL_A, 1000);

  const k = sirkuit.keadaanSirkuit(URL_A, 1000 + h.tungguMs - 1);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERBUKA);
  assert.equal(k.bolehKirim, false);
});

test('jendela tunggu lewat → keadaan SETENGAH TERBUKA, boleh uji', () => {
  const h = bukaSirkuit(URL_A, 1000);

  const k = sirkuit.keadaanSirkuit(URL_A, 1000 + h.tungguMs + 1);
  assert.equal(k.keadaan, sirkuit.KEADAAN.SETENGAH);
  assert.equal(k.bolehKirim, true, 'percobaan uji harus boleh lewat');
});

test('jendela tunggu NAIK setiap kali sirkuit dibuka lagi', () => {
  // ── KENAPA HARUS NAIK ─────────────────────────────────────────────────────
  // Endpoint yang mati 5 detik berbeda dari yang mati 2 jam. Kalau jendelanya
  // tetap, endpoint yang mati lama akan diuji setiap 30 detik — selamanya.
  const h1 = bukaSirkuit(URL_A, 1000);
  const tunggu1 = h1.tungguMs;

  // Lewati jendela, uji, gagal lagi
  const waktu2 = 1000 + tunggu1 + 1;
  sirkuit.catatUjiMulai(URL_A, waktu2);
  const h2 = sirkuit.catatGagal(URL_A, { sekarang: waktu2 });

  assert.ok(h2.tungguMs > tunggu1,
    `jendela kedua (${h2.tungguMs}ms) harus lebih lama dari yang pertama (${tunggu1}ms)`);
});

test('jendela tunggu berhenti di nilai terakhir, tidak tumbuh tanpa batas', () => {
  const terakhir = sirkuit.JENDELA_TUNGGU_MS[sirkuit.JENDELA_TUNGGU_MS.length - 1];

  let sekarang = 1000;
  let h;
  for (let i = 0; i < 20; i++) {
    h = bukaSirkuit(URL_A, sekarang);
    sekarang = sekarang + h.tungguMs + 1;
    sirkuit.catatUjiMulai(URL_A, sekarang);
    // gagal lagi di iterasi berikutnya
  }

  assert.equal(h.tungguMs, terakhir, 'harus memakai jendela terakhir');
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. HANYA SATU PERCOBAAN UJI — ini yang paling penting
   ══════════════════════════════════════════════════════════════════════════════ */

test('catatUjiMulai hanya berhasil SEKALI', () => {
  // ── INI PERLINDUNGAN TERHADAP BANJIR PERMINTAAN ───────────────────────────
  // Di keadaan setengah terbuka, HANYA SATU percobaan yang boleh lewat. Tanpa
  // penandaan ini, 50 pesan yang menunggu akan semuanya lolos saat jendela
  // tunggunya lewat — dan endpoint yang masih mati langsung dibanjiri.
  const h = bukaSirkuit(URL_A, 1000);
  const waktu = 1000 + h.tungguMs + 1;

  const pertama = sirkuit.catatUjiMulai(URL_A, waktu);
  const kedua = sirkuit.catatUjiMulai(URL_A, waktu);

  assert.equal(pertama.ok, true, 'yang pertama harus berhasil');
  assert.equal(kedua.ok, false, 'yang kedua harus ditolak');
});

test('setelah uji dimulai, pengiriman berikutnya DITOLAK', () => {
  const h = bukaSirkuit(URL_A, 1000);
  const waktu = 1000 + h.tungguMs + 1;

  sirkuit.catatUjiMulai(URL_A, waktu);

  const k = sirkuit.keadaanSirkuit(URL_A, waktu);
  assert.equal(k.keadaan, sirkuit.KEADAAN.SETENGAH);
  assert.equal(k.bolehKirim, false,
    'setelah percobaan uji dikirim, yang berikutnya harus menunggu hasilnya');
});

test('catatUjiMulai ditolak kalau jendela tunggu belum lewat', () => {
  const h = bukaSirkuit(URL_A, 1000);

  const hasil = sirkuit.catatUjiMulai(URL_A, 1000 + h.tungguMs - 1);
  assert.equal(hasil.ok, false, 'belum waktunya');
});

test('catatUjiMulai ditolak kalau sirkuit TIDAK sedang terbuka', () => {
  // Sirkuit tertutup → tidak ada yang perlu diuji.
  const hasil = sirkuit.catatUjiMulai(URL_A, 1000);
  assert.equal(hasil.ok, false);
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. SETENGAH TERBUKA → hasilnya menentukan
   ══════════════════════════════════════════════════════════════════════════════ */

test('percobaan uji BERHASIL → sirkuit TERTUTUP penuh', () => {
  const h = bukaSirkuit(URL_A, 1000);
  const waktu = 1000 + h.tungguMs + 1;

  sirkuit.catatUjiMulai(URL_A, waktu);
  sirkuit.catatSukses(URL_A, { sekarang: waktu });

  const k = sirkuit.keadaanSirkuit(URL_A, waktu);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERTUTUP);
  assert.equal(k.bolehKirim, true);
  assert.equal(k.gagalBeruntun, 0);
  assert.equal(k.sudahDibuka, 0, 'riwayat pembukaan harus direset');
});

test('percobaan uji GAGAL → sirkuit TERBUKA LAGI, tanpa menunggu ambang', () => {
  // ── KENAPA LANGSUNG, BUKAN MENGHITUNG SAMPAI 5 ────────────────────────────
  // Percobaan uji itu jawabannya: endpointnya masih mati. Tidak perlu
  // membuktikannya lima kali lagi — dan lima percobaan itu berarti lima kali
  // timeout yang terbuang.
  const h = bukaSirkuit(URL_A, 1000);
  const waktu = 1000 + h.tungguMs + 1;

  sirkuit.catatUjiMulai(URL_A, waktu);
  const hasil = sirkuit.catatGagal(URL_A, { pesanGalat: 'masih mati', sekarang: waktu });

  assert.equal(hasil.keadaan, sirkuit.KEADAAN.TERBUKA);
  assert.ok(hasil.tungguMs > h.tungguMs, 'jendela tunggu harus lebih lama dari sebelumnya');
});

test('percobaan uji gagal → pengiriman dilewati lagi', () => {
  const h = bukaSirkuit(URL_A, 1000);
  const waktu = 1000 + h.tungguMs + 1;

  sirkuit.catatUjiMulai(URL_A, waktu);
  sirkuit.catatGagal(URL_A, { sekarang: waktu });

  assert.equal(sirkuit.bolehKirim(URL_A, waktu), false);
});

/* ══════════════════════════════════════════════════════════════════════════════
   7. TUTUP PAKSA
   ══════════════════════════════════════════════════════════════════════════════ */

test('tutupPaksa menutup sirkuit yang sedang terbuka', () => {
  // ── KENAPA PERLU ──────────────────────────────────────────────────────────
  // Kadang endpointnya sudah diperbaiki sebelum jendela tunggunya habis.
  // Tanpa cara menutup paksa, pengiriman harus menunggu sampai 30 menit — dan
  // pengguna mengira perbaikannya tidak berhasil.
  bukaSirkuit(URL_A, 1000);
  assert.equal(sirkuit.bolehKirim(URL_A, 1000), false, 'prasyarat: harus terbuka');

  sirkuit.tutupPaksa(URL_A, { sekarang: 1000 });

  const k = sirkuit.keadaanSirkuit(URL_A, 1000);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERTUTUP);
  assert.equal(k.bolehKirim, true);
  assert.equal(k.sudahDibuka, 0, 'riwayat pembukaan direset supaya jendelanya mulai dari awal lagi');
});

test('tutupPaksa pada sirkuit yang belum ada → tidak error', () => {
  assert.doesNotThrow(() => sirkuit.tutupPaksa('https://belum.contoh.id/x'));
});

/* ══════════════════════════════════════════════════════════════════════════════
   8. DAFTAR UNTUK UI
   ══════════════════════════════════════════════════════════════════════════════ */

test('daftarSirkuit menampilkan yang TERBUKA lebih dulu', () => {
  // Yang perlu perhatian manusia ditampilkan di atas.
  sirkuit.catatSukses(URL_B, { sekarang: 1000 });
  bukaSirkuit(URL_A, 1000);

  const daftar = sirkuit.daftarSirkuit(1000);
  assert.equal(daftar.length, 2);
  assert.equal(daftar[0].host, sirkuit.hostDari(URL_A), 'yang terbuka harus di atas');
  assert.equal(daftar[0].keadaan, sirkuit.KEADAAN.TERBUKA);
});

test('daftarSirkuit menyertakan sisa waktu tunggu', () => {
  // Berguna ditampilkan sebagai hitung mundur.
  const h = bukaSirkuit(URL_A, 1000);

  const daftar = sirkuit.daftarSirkuit(1000 + 5000);
  assert.equal(daftar[0].sisaTungguMs, h.tungguMs - 5000);
});

test('daftarSirkuit pada keadaan kosong → array kosong, tidak error', () => {
  assert.deepEqual(sirkuit.daftarSirkuit(), []);
});

test('daftarSirkuit mencatat statistik total', () => {
  sirkuit.catatGagal(URL_A, { sekarang: 1000 });
  sirkuit.catatGagal(URL_A, { sekarang: 1000 });
  sirkuit.catatSukses(URL_A, { sekarang: 1000 });

  const daftar = sirkuit.daftarSirkuit(1000);
  assert.equal(daftar[0].totalGagal, 2);
  assert.equal(daftar[0].totalSukses, 1);
  assert.equal(daftar[0].gagalBeruntun, 0, 'beruntun direset, total tetap');
});

/* ══════════════════════════════════════════════════════════════════════════════
   9. PEMBERSIHAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('bersihkanSirkuit menghapus yang sudah lama dan tertutup', () => {
  const lama = Date.now() - 60 * 24 * 60 * 60 * 1000;
  sirkuit.catatSukses(URL_A, { sekarang: lama });

  const hasil = sirkuit.bersihkanSirkuit();
  assert.equal(hasil.dihapus, 1);
});

test('bersihkanSirkuit TIDAK menghapus yang sedang TERBUKA', () => {
  // ── KENAPA INI PENTING ────────────────────────────────────────────────────
  // Sirkuit yang terbuka adalah keadaan yang perlu diperhatikan manusia.
  // Menghapusnya berarti melupakan bahwa ada endpoint yang bermasalah — dan
  // saat endpointnya dicoba lagi, kegagalannya mulai dihitung dari nol.
  const lama = Date.now() - 60 * 24 * 60 * 60 * 1000;
  bukaSirkuit(URL_A, lama);

  const hasil = sirkuit.bersihkanSirkuit();
  assert.equal(hasil.dihapus, 0, 'sirkuit terbuka tidak boleh dihapus');

  const daftar = sirkuit.daftarSirkuit(lama);
  assert.equal(daftar.length, 1, 'catatannya harus tetap ada');
});

/* ══════════════════════════════════════════════════════════════════════════════
   10. KETAHANAN
   ══════════════════════════════════════════════════════════════════════════════ */

test('siapkanTabelSirkuit idempoten', () => {
  assert.doesNotThrow(() => {
    sirkuit.siapkanTabelSirkuit();
    sirkuit.siapkanTabelSirkuit();
  });
});

test('semua fungsi tahan terhadap input kosong', () => {
  assert.doesNotThrow(() => sirkuit.keadaanSirkuit(''));
  assert.doesNotThrow(() => sirkuit.keadaanSirkuit(null));
  assert.doesNotThrow(() => sirkuit.bolehKirim(undefined));
  assert.doesNotThrow(() => sirkuit.catatSukses(''));
  assert.doesNotThrow(() => sirkuit.catatGagal(null));
  assert.doesNotThrow(() => sirkuit.catatUjiMulai(''));
  assert.doesNotThrow(() => sirkuit.tutupPaksa(null));
  assert.doesNotThrow(() => sirkuit.bersihkanSirkuit({}));
});

test('pesan galat yang panjang dipotong', () => {
  sirkuit.catatGagal(URL_A, { pesanGalat: 'x'.repeat(5000), sekarang: 1000 });

  const daftar = sirkuit.daftarSirkuit(1000);
  assert.ok(daftar[0].terakhirGalat.length <= 300);
});

test('kegagalan beruntun tetap benar walau dipanggil banyak kali', () => {
  for (let i = 0; i < 100; i++) sirkuit.catatGagal(URL_B, { sekarang: 1000 });

  const k = sirkuit.keadaanSirkuit(URL_B, 1000);
  assert.equal(k.keadaan, sirkuit.KEADAAN.TERBUKA);
  assert.ok(k.gagalBeruntun >= sirkuit.AMBANG_GAGAL);
});
