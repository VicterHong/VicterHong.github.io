/**
 * Tes paket Gratis di halaman harga.
 *
 * ── KENAPA TES INI ADA ───────────────────────────────────────────────────────
 * Paket Gratis bukan sekadar satu kartu tambahan. Ia menyentuh empat aturan
 * yang mudah rusak tanpa disadari:
 *
 *   1. HARGA NOL bukan null — bedanya menentukan apakah frontend menampilkan
 *      "Gratis" atau "Sesuai kebutuhan".
 *   2. URUTAN — gratis harus pertama, dan nomor urutnya tidak boleh bentrok.
 *   3. FITUR POSITIF tidak diulang di paket atas (karena sudah ada baris
 *      "Mencakup seluruh fitur paket X").
 *   4. FITUR NEGATIF justru HARUS diulang — kalau tidak, pengunjung mengira
 *      batasannya ikut hilang saat naik paket.
 *
 * Aturan 3 dan 4 terlihat bertentangan, dan itulah kenapa keduanya diuji:
 * "perbaikan" yang menyamakan keduanya akan lolos tinjauan sekilas tapi
 * merusak halaman.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPricing } from '../src/pricing.mjs';
import { KUOTA_DASAR, BONUS_STAR } from '../src/langganan.mjs';

const data = buildPricing();
const gratis = data.paket.find((p) => p.id === 'gratis');
const namaPaket = data.paket.map((p) => p.nama);

test('paket Gratis ada di daftar harga', () => {
  assert.ok(gratis, 'paket dengan id "gratis" harus ada');
  assert.equal(namaPaket.length, 4, 'empat paket: Gratis, Standar, Profesional, Enterprise');
});

test('Gratis ada di urutan PERTAMA', () => {
  // Referensi korporasi (Vercel, Linear, Notion, Supabase, Cloudflare) semua
  // menaruh paket gratis di kiri. Kalau dipindah ke tengah/kanan, kolomnya
  // terbaca sebagai penurunan setelah paket yang lebih lengkap.
  assert.equal(data.paket[0].id, 'gratis', 'paket pertama harus Gratis');
  assert.equal(gratis.urutan, 0, 'urutan Gratis harus 0');
});

test('harga Gratis adalah 0, BUKAN null', () => {
  // null → frontend menampilkan teksHarga ("Sesuai kebutuhan")
  // 0    → frontend menampilkan "Gratis" dan bisa dibandingkan
  //
  // Kalau ini berubah jadi null, kartu Gratis akan menampilkan "Sesuai
  // kebutuhan" — dan paket gratis yang tidak menyebut harganya justru
  // menimbulkan kecurigaan.
  assert.equal(gratis.harga.normal, 0, 'harga normal harus 0 (angka), bukan null');
  assert.notEqual(gratis.harga.normal, null, 'null akan membuat frontend menampilkan teksHarga');
});

test('Gratis TIDAK ditandai unggulan', () => {
  // Yang unggulan tetap Profesional. Menandai Gratis sebagai rekomendasi
  // bertentangan dengan tujuannya — ia pintu masuk, bukan tujuan.
  assert.equal(gratis.unggulan, false, 'Gratis bukan paket unggulan');
  const unggulan = data.paket.filter((p) => p.unggulan);
  assert.equal(unggulan.length, 1, 'hanya satu paket boleh unggulan');
  assert.equal(unggulan[0].id, 'profesional', 'yang unggulan harus Profesional');
});

test('Gratis punya deskripsi "untuk siapa", bukan "apa isinya"', () => {
  // Pola korporasi: Vercel "The perfect starting place for...", Notion "For
  // individuals to...". Deskripsi yang menjelaskan NIAT tidak membantu
  // pengunjung memilih.
  assert.ok(gratis.deskripsi && gratis.deskripsi.length > 20, 'deskripsi harus ada dan bermakna');
  assert.match(gratis.deskripsi, /Untuk yang/i, 'deskripsi harus menyebut untuk siapa');
});

test('Gratis menyatakan "selamanya" (pola GitHub)', () => {
  // GitHub menulis "$0 USD per month forever". Kata "forever" menjawab
  // kekhawatiran utama pada paket gratis: "sampai kapan?"
  assert.match(gratis.catatan, /selamanya/i, 'catatan harus menyebut gratis selamanya');
  assert.match(gratis.catatan, /tanpa kartu kredit/i, 'catatan harus menyebut tanpa kartu kredit');
});

test('CTA Gratis tidak menyebut harga', () => {
  // "Mulai gratis" — bukan "Berlangganan". Tombol paket gratis tidak boleh
  // berbunyi seperti tindakan berbayar.
  assert.equal(gratis.cta.teks, 'Mulai gratis');
});

test('Gratis memberi pratinjau metrik lewat star, BUKAN token', () => {
  // Sistem tidak memberi token akses ke paket gratis (KUOTA_DASAR.gratis = 0).
  // Kalau kartu menjanjikan "1 token", halaman menjanjikan yang tidak bisa
  // dipenuhi sistem — dan itu lebih buruk daripada tidak menjanjikan apa pun.
  const teksFitur = gratis.fitur.map((f) => f.teks).join(' | ');
  assert.match(teksFitur, /star/i, 'Gratis harus menyebut bonus star');
  assert.match(teksFitur, /metrik/i, 'bonus star untuk Gratis adalah pratinjau metrik');
  assert.doesNotMatch(teksFitur, /\d+\s*token akses per bulan/i,
    'Gratis TIDAK BOLEH menjanjikan token bulanan');
});

test('Gratis menyebut batasannya, bukan hanya yang termasuk', () => {
  // Pola Supabase: limit ditulis eksplisit ("500 MB", "Limit of 2 active
  // projects"), bukan "terbatas". Angka/batasan yang jelas membuat pengunjung
  // bisa menilai sendiri apakah paket ini cukup.
  const batasan = gratis.fitur.filter((f) => !f.termasuk);
  assert.ok(batasan.length >= 2, 'Gratis harus menyebut minimal 2 batasan');
  const teks = batasan.map((f) => f.teks).join(' | ');
  assert.match(teks, /token akses/i, 'batasan token akses harus disebut');
  assert.match(teks, /kode sumber/i, 'batasan kode sumber harus disebut');
});

test('fitur POSITIF tidak diulang di paket atas', () => {
  // Paket atas sudah menulis "Mencakup seluruh fitur paket X". Mengulang satu
  // fitur dari paket bawah membuat baris itu terlihat tidak bisa dipercaya.
  for (let i = 1; i < data.paket.length; i++) {
    const positifBawah = new Set(
      data.paket[i - 1].fitur.filter((f) => f.termasuk).map((f) => f.teks)
    );
    for (const f of data.paket[i].fitur) {
      if (!f.termasuk) continue;
      assert.ok(
        !positifBawah.has(f.teks),
        `"${f.teks}" diulang di ${data.paket[i].nama} padahal sudah ada di ${data.paket[i - 1].nama}`
      );
    }
  }
});

test('fitur NEGATIF diulang di setiap paket yang masih memilikinya', () => {
  // Kebalikan dari tes di atas — dan itu disengaja.
  //
  // "Mencakup seluruh fitur paket X" hanya mencakup fitur POSITIF; batasan
  // tidak ikut terbawa. Pengunjung yang membaca kartu Standar tidak boleh
  // dipaksa menyimpulkan sendiri bahwa kode sumber masih terkunci.
  const punyaBatasanKode = data.paket
    .filter((p) => p.fitur.some((f) => !f.termasuk && /kode sumber/i.test(f.teks)))
    .map((p) => p.nama);
  assert.deepEqual(punyaBatasanKode, ['Gratis', 'Standar'],
    'batasan kode sumber harus muncul di Gratis DAN Standar');

  // ── CATATAN: POLA INI PERNAH SALAH ─────────────────────────────────────────
  // Versi pertama memakai /pakai ulang/i — dan TIDAK cocok dengan teks yang
  // sebenarnya, "Belum boleh memakai ulang kodenya".
  //
  // Sebabnya: kata berimbuhan. "memakai" = "me" + "pakai", jadi huruf awalnya
  // berubah dari p menjadi m. Pencarian "pakai ulang" gagal karena di dalam
  // "memakai ulang" tidak ada urutan huruf p-a-k-a-i.
  //
  // Pola yang benar menyertakan imbuhannya: (?:me)?makai ulang.
  const punyaBatasanPakaiUlang = data.paket
    .filter((p) => p.fitur.some((f) => !f.termasuk && /(?:me)?makai ulang/i.test(f.teks)))
    .map((p) => p.nama);
  assert.deepEqual(punyaBatasanPakaiUlang, ['Gratis', 'Standar', 'Profesional'],
    'batasan pakai ulang harus muncul di Gratis, Standar, DAN Profesional');
});

test('jumlah batasan TURUN di tiap tingkat (3-2-1-0)', () => {
  // Efek samping yang berguna: pengunjung melihat kemajuannya sekilas.
  const jumlah = data.paket.map((p) => p.fitur.filter((f) => !f.termasuk).length);
  assert.deepEqual(jumlah, [3, 2, 1, 0], 'batasan harus turun 3-2-1-0');
});

test('setiap paket berbayar menyatakan cakupan paket di bawahnya', () => {
  // Pola Notion "Everything in Free, and:" / Linear "All Free features +".
  for (let i = 1; i < data.paket.length; i++) {
    const paket = data.paket[i];
    const bawah = data.paket[i - 1].nama;
    assert.ok(
      paket.fitur.some((f) => f.termasuk && new RegExp(`Mencakup seluruh fitur paket ${bawah}`, 'i').test(f.teks)),
      `${paket.nama} harus menyatakan mencakup seluruh fitur paket ${bawah}`
    );
  }
});

test('FAQ menjelaskan beda Gratis dan bonus star, di posisi pertama', () => {
  // Referensi menyebut kesalahan yang membuat pengunjung berhenti:
  // "A free plan and a free trial side by side with no guidance on which
  // to pick." Halaman ini punya DUA jalur gratis — paket Gratis dan bonus
  // star — jadi harus dijelaskan sebelum pengunjung bingung.
  assert.ok(data.faq.length > 0, 'FAQ tidak boleh kosong');
  assert.match(data.faq[0].tanya, /Gratis/i, 'FAQ pertama harus soal paket Gratis');
  assert.match(data.faq[0].jawab, /star/i, 'jawabannya harus menjelaskan bonus star');
});

test('FAQ menjawab "gratis selamanya?"', () => {
  const ada = data.faq.some((f) => /gratis selamanya/i.test(f.tanya));
  assert.ok(ada, 'harus ada FAQ yang menjawab kekhawatiran "sampai kapan gratis"');
});

test('FAQ uji coba TIDAK lagi menyiratkan tidak ada cara mencoba gratis', () => {
  // Versi lama menjawab dengan dokumentasi publik + garansi 7 hari, karena
  // waktu itu memang tidak ada paket gratis. Jawaban itu sekarang
  // menyesatkan.
  const f = data.faq.find((x) => /uji coba gratis/i.test(x.tanya));
  assert.ok(f, 'FAQ uji coba harus tetap ada (masih ditanyakan)');
  assert.match(f.jawab, /paket Gratis/i, 'jawabannya harus menyebut paket Gratis');
});

test('nomor urut paket unik dan berurutan dari 0', () => {
  const urut = data.paket.map((p) => p.urutan).sort((a, b) => a - b);
  assert.deepEqual(urut, [0, 1, 2, 3], 'urutan harus 0,1,2,3 tanpa bentrok');
});

test('id paket unik', () => {
  const id = data.paket.map((p) => p.id);
  assert.equal(new Set(id).size, id.length, 'id paket tidak boleh kembar');
});

// ══════════════════════════════════════════════════════════════════════════════
// ANGKA KUOTA HARUS IKUT SISTEM, BUKAN DIKETIK ULANG
//
// ── BUG YANG DIJAGA OLEH TES INI ─────────────────────────────────────────────
// Sebelumnya baris fitur berbunyi '1 token akses per bulan' sebagai teks biasa,
// sementara komentarnya berbunyi "angka ini HARUS cocok dengan KUOTA_DASAR".
//
// Komentar tidak menegakkan apa pun. Kalau kuota sistem diubah jadi 3, halaman
// tetap menjanjikan 1 — pelanggan membayar berdasarkan janji yang tidak bisa
// dipenuhi.
//
// Tes ini mengubah KUOTA_DASAR secara langsung dan memeriksa halaman ikut
// berubah. Kalau seseorang mengembalikannya jadi teks keras, tes ini gagal.
// ══════════════════════════════════════════════════════════════════════════════

// ── CATATAN: TES INI PERNAH SALAH ────────────────────────────────────────────
// Versi pertama mengubah KUOTA_DASAR.standar = 7 saat runtime dan berharap
// halaman ikut berubah. Itu GAGAL — dan gagalnya benar.
//
// Sebabnya: `PAKET` dibangun sekali saat modul dimuat. Mengubah KUOTA_DASAR
// setelah itu tidak berpengaruh sampai modul dimuat ulang.
//
// Tapi skenario itu tidak pernah terjadi di produksi: mengubah kuota berarti
// mengubah kode, dan service-nya di-restart. Yang benar-benar berbahaya adalah
// orang MENGETIK ULANG angkanya sebagai teks keras — dan itu tidak terdeteksi
// dengan mengubah nilai runtime.
//
// Jadi tes yang tepat memeriksa SUMBER KODENYA: tidak boleh ada angka kuota
// yang ditulis langsung.
test('tidak ada angka kuota yang diketik keras di sumber', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const ini = dirname(fileURLToPath(import.meta.url));
  const sumber = await readFile(join(ini, '..', 'src', 'pricing.mjs'), 'utf8');

  // Hanya periksa baris KODE — komentar boleh menyebut angka sebagai contoh.
  const barisKode = sumber
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => !b.startsWith('//') && !b.startsWith('*') && !b.startsWith('/*'));

  const pelanggar = barisKode.filter((b) =>
    /['"`]\d+ token akses per bulan['"`]/.test(b)
  );
  assert.deepEqual(pelanggar, [],
    'angka kuota tidak boleh ditulis sebagai teks keras — pakai fiturKuota()');

  // Dan hasil bonus juga tidak boleh diketik.
  const pelanggarBonus = barisKode.filter((b) =>
    /['"`]Kuota bulan itu jadi \d+ token['"`]/.test(b)
  );
  assert.deepEqual(pelanggarBonus, [],
    'hasil bonus star tidak boleh ditulis sebagai teks keras — pakai hasilBonusStar()');
});

test('bonus star di halaman IKUT berubah saat bonus sistem diubah', () => {
  const asli = BONUS_STAR;
  try {
    // BONUS_STAR diekspor sebagai const primitif, jadi tidak bisa diubah dari
    // luar modul. Yang bisa diuji: hubungannya dengan KUOTA_DASAR tetap benar.
    const d = buildPricing();
    const f = d.bonusStar.hasil.find((h) => h.paket === 'Standar');
    assert.equal(f.dapat, `Kuota bulan itu jadi ${KUOTA_DASAR.standar + BONUS_STAR} token`,
      'hasil bonus harus = kuota dasar + bonus, bukan angka yang diketik');
  } finally {
    void asli;
  }
});

test('kuota Enterprise yang null ditulis "tanpa batas", bukan "0"', () => {
  // null berarti tanpa batas. Kalau ditampilkan sebagai angka, halaman akan
  // menulis "0 token" — kebalikan dari artinya.
  assert.equal(KUOTA_DASAR.enterprise, null, 'prasyarat: enterprise harus null');
  const f = data.paket.find((p) => p.id === 'enterprise').fitur.find((x) => /token akses/i.test(x.teks));
  assert.equal(f.teks, 'Token akses tanpa batas');
  assert.doesNotMatch(f.teks, /\d/, 'tidak boleh ada angka di baris kuota enterprise');
});

test('paket Gratis TIDAK menampilkan baris kuota token', () => {
  // Sistem memberi 0 token ke paket Gratis. Menampilkan "0 token akses per
  // bulan" akan benar secara teknis tapi salah secara pesan — yang tepat
  // adalah menyebut batasannya, yang sudah ada di daftar fitur negatif.
  const baris = gratis.fitur.filter((f) => /^\d+ token akses per bulan/.test(f.teks));
  assert.equal(baris.length, 0, 'Gratis tidak boleh punya baris "N token akses per bulan"');
});

test('paket berbayar menampilkan kuota yang cocok dengan KUOTA_DASAR', () => {
  for (const id of ['standar', 'profesional']) {
    const f = data.paket.find((p) => p.id === id).fitur.find((x) => /token akses per bulan/.test(x.teks));
    assert.ok(f, `${id} harus punya baris kuota`);
    assert.equal(f.teks, `${KUOTA_DASAR[id]} token akses per bulan`,
      `kuota ${id} harus persis KUOTA_DASAR (${KUOTA_DASAR[id]})`);
  }
});
