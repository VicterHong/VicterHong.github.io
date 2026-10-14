/**
 * Teks marketing di halaman harga: aturan bahasa yang tidak boleh rusak.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA TES INI ADA
 * ══════════════════════════════════════════════════════════════════════════════
 * Preflight memeriksa em-dash di BERANDA saja. Teks halaman harga dikirim dari
 * API (pricing.mjs), jadi pemeriksaan itu tidak pernah melihatnya — dan
 * sempat ada EMPAT em-dash di jawaban FAQ yang terlihat pengguna.
 *
 * Selain em-dash, teks marketing punya aturan lain yang mudah rusak saat
 * seseorang menambah fitur baru dengan cepat:
 *
 *   · Kata pengisi yang membuat tulisan terdengar seperti iklan palsu
 *     ("Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize")
 *   · Batasan yang ditulis "belum bisa" — menyiratkan KETIDAKMAMPUAN, padahal
 *     yang benar "belum termasuk" — menyiratkan bisa ditambahkan
 *   · Klaim tanpa angka ("kuota terbatas") padahal angkanya diketahui
 *
 * Semua ini lolos tinjauan sekilas. Yang menangkapnya hanya tes yang membaca
 * teksnya sebagai data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPricing } from '../src/pricing.mjs';

const data = buildPricing();

/**
 * Kumpulkan SEMUA teks yang dilihat pengunjung.
 *
 * ── KENAPA SEMUA, BUKAN SATU-SATU ────────────────────────────────────────────
 * Teks halaman harga tersebar di lima tempat: deskripsi paket, daftar fitur,
 * label tabel perbandingan, jawaban FAQ, dan bagian cara pakai token. Aturan
 * bahasa harus berlaku di semuanya.
 *
 * Tes yang hanya memeriksa satu tempat akan lolos saat em-dash masuk lewat
 * tempat lain — dan itu persis yang terjadi sebelumnya.
 */
function semuaTeks() {
  const t = [];

  for (const p of data.paket) {
    t.push(['paket.nama', p.nama]);
    t.push(['paket.deskripsi', p.deskripsi]);
    if (p.catatan) t.push(['paket.catatan', p.catatan]);
    t.push(['paket.cta', p.cta.teks]);
    for (const f of p.fitur) t.push([`fitur.${p.id}`, f.teks]);
  }

  for (const b of data.tabel) {
    if (b.bagian) t.push(['tabel.bagian', b.bagian]);
    if (b.fitur) t.push(['tabel.fitur', b.fitur]);
  }

  for (const f of data.faq) {
    t.push(['faq.tanya', f.tanya]);
    t.push(['faq.jawab', f.jawab]);
  }

  for (const l of data.langkahToken) {
    t.push(['langkah.judul', l.judul]);
    t.push(['langkah.teks', l.teks]);
  }

  t.push(['bonus.judul', data.bonusStar.judul]);
  t.push(['bonus.teks', data.bonusStar.teks]);
  for (const h of data.bonusStar.hasil) t.push(['bonus.hasil', h.dapat]);

  t.push(['judul', data.judul?.utama ?? '']);
  t.push(['judul', data.judul?.kecil ?? '']);

  return t.filter(([, teks]) => typeof teks === 'string' && teks.length > 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. EM-DASH: NOL, DI MANA PUN
// ══════════════════════════════════════════════════════════════════════════════

test('nol em-dash di seluruh teks halaman harga', () => {
  // Em-dash adalah penanda tulisan AI yang paling mudah dikenali, dan skill
  // design-taste-frontend melarangnya TOTAL. Preflight memeriksa beranda saja;
  // teks halaman harga dikirim dari API, jadi pemeriksaan itu tidak
  // menjangkaunya. Empat em-dash sempat lolos ke jawaban FAQ karena celah ini.
  const pelanggar = semuaTeks().filter(([, teks]) => /[\u2014\u2013]/.test(teks));
  assert.deepEqual(pelanggar, [],
    `em-dash ditemukan di: ${pelanggar.map(([di]) => di).join(', ')}`);
});

test('tidak ada em-dash di nilai tabel perbandingan', () => {
  // Nilai tabel bisa berupa string (bukan boolean) untuk kolom keterangan.
  const teks = [];
  for (const b of data.tabel) {
    for (const v of b.nilai ?? []) {
      if (typeof v === 'string') teks.push(v);
    }
  }
  const pelanggar = teks.filter((t) => /[\u2014\u2013]/.test(t));
  assert.deepEqual(pelanggar, []);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. KATA PENGISI: DILARANG
// ══════════════════════════════════════════════════════════════════════════════

test('tidak ada kata pengisi khas iklan palsu', () => {
  // Kata-kata ini tidak mengatakan apa pun yang bisa diperiksa. "Solusi
  // seamless" tidak memberi tahu pengunjung APA yang mulus. Skill
  // design-taste-frontend menyebutnya "filler verbs" dan melarangnya.
  const terlarang = [
    /\belevate\b/i, /\bseamless\b/i, /\bunleash\b/i, /\bnext-gen\b/i,
    /\brevolutionize\b/i, /\bgame.?chang/i, /\bcutting.edge\b/i,
    /\bleverage\b/i, /\bsynerg/i, /\bbest.in.class\b/i,
    /\bworld.class\b/i, /\bstate.of.the.art\b/i,
  ];
  const pelanggar = [];
  for (const [di, teks] of semuaTeks()) {
    for (const pola of terlarang) {
      if (pola.test(teks)) pelanggar.push(`${di}: ${teks.slice(0, 50)}`);
    }
  }
  assert.deepEqual(pelanggar, [], `kata pengisi: ${pelanggar.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. BATASAN: "BELUM TERMASUK", BUKAN "BELUM BISA"
// ══════════════════════════════════════════════════════════════════════════════

test('batasan ditulis "belum termasuk", bukan "belum bisa"', () => {
  // ── BEDANYA BUKAN GAYA BAHASA ──────────────────────────────────────────────
  // "Belum bisa membaca kode sumber" menyiratkan KETIDAKMAMPUAN sistem — seolah
  // ada sesuatu yang rusak.
  //
  // "Kode sumber belum termasuk" menyiratkan PILIHAN PAKET — sesuatu yang bisa
  // ditambahkan dengan naik paket.
  //
  // Yang pertama membuat pengunjung ragu pada produknya. Yang kedua membuat
  // dia mempertimbangkan paket berikutnya. Untuk halaman yang tujuannya
  // menjual, bedanya nyata.
  const pelanggar = [];
  for (const p of data.paket) {
    for (const f of p.fitur) {
      if (f.termasuk) continue;
      if (/belum bisa/i.test(f.teks)) pelanggar.push(`${p.nama}: ${f.teks}`);
    }
  }
  assert.deepEqual(pelanggar, [], `pakai "belum termasuk": ${pelanggar.join(' | ')}`);
});

test('setiap batasan memakai kata "belum termasuk"', () => {
  for (const p of data.paket) {
    for (const f of p.fitur) {
      if (f.termasuk) continue;
      assert.match(f.teks, /belum termasuk/i,
        `batasan "${f.teks}" di ${p.nama} harus memakai "belum termasuk"`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ANGKA KONKRET, BUKAN KATA SAMAR
// ══════════════════════════════════════════════════════════════════════════════

test('kuota token ditulis sebagai angka, bukan "terbatas"', () => {
  // Referensi korporasi (Supabase) menulis "500 MB database size", bukan
  // "penyimpanan terbatas". Angka yang jelas membuat pengunjung bisa menilai
  // sendiri apakah paketnya cukup.
  const samar = /kuota (terbatas|tertentu|secukupnya)|jumlah token terbatas/i;
  for (const p of data.paket) {
    for (const f of p.fitur) {
      assert.doesNotMatch(f.teks, samar,
        `${p.nama}: "${f.teks}" memakai kata samar padahal angkanya diketahui`);
    }
  }
});

test('batas proyek Enterprise ditulis eksplisit', () => {
  // "Proyek tanpa batas" lebih baik dari "proyek banyak". Kata "tanpa batas"
  // adalah klaim yang bisa diperiksa; "banyak" tidak berarti apa-apa.
  const ent = data.paket.find((p) => p.id === 'enterprise');
  const proyek = ent.fitur.find((f) => /proyek/i.test(f.teks) && f.termasuk);
  assert.ok(proyek, 'Enterprise harus menyebut batas proyek');
  assert.match(proyek.teks, /tanpa batas/i, `tulis "tanpa batas", bukan "${proyek.teks}"`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. HASIL DULU, BUKAN FITUR
// ══════════════════════════════════════════════════════════════════════════════

test('deskripsi paket menyebut UNTUK SIAPA, bukan daftar fitur', () => {
  // Pola korporasi: Vercel "The perfect starting place for your web app",
  // Notion "For individuals to organize personal projects". Deskripsi yang
  // menyebut ORANG membantu pengunjung memilih sendiri.
  for (const p of data.paket) {
    assert.match(p.deskripsi, /^Untuk /,
      `${p.nama}: deskripsi harus mulai dengan "Untuk ...", bukan "${p.deskripsi}"`);
  }
});

test('CTA tiap paket berbayar menyebut nama paketnya', () => {
  // "Mulai dari sini" di dua kartu berbeda membuat pengunjung harus melihat
  // ulang ke atas untuk tahu paket mana yang dia pilih. Menyebut nama paket
  // membuat tombolnya bisa dibaca sendiri.
  //
  // Gratis dan Enterprise dikecualikan: "Mulai gratis" dan "Bicara dulu"
  // adalah tindakan yang berbeda jenis, bukan pilihan paket.
  for (const id of ['standar', 'profesional']) {
    const p = data.paket.find((x) => x.id === id);
    assert.match(p.cta.teks, new RegExp(p.nama, 'i'),
      `CTA ${p.nama} harus menyebut nama paketnya, sekarang "${p.cta.teks}"`);
  }
});

test('tidak ada dua CTA berbayar dengan teks yang sama', () => {
  // "Mulai dari sini" muncul di dua kartu sekaligus sebelumnya. Dua tombol
  // dengan teks sama di halaman yang sama membingungkan: pengunjung tidak
  // bisa merujuk kembali tombol mana yang dia maksud.
  const teks = data.paket.filter((p) => p.berbayar !== false && p.harga?.normal !== 0)
    .map((p) => p.cta.teks);
  assert.equal(new Set(teks).size, teks.length,
    `CTA kembar: ${teks.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. JANGAN MENJELEKKAN YANG LAIN
// ══════════════════════════════════════════════════════════════════════════════

test('tidak ada frasa yang menyiratkan produk lain lebih buruk', () => {
  // ── KENAPA ATURAN INI ADA ──────────────────────────────────────────────────
  // Dua frasa lolos ke halaman dan baru ketahuan dari tinjauan visual:
  //
  //   "Diskusi teknis langsung dengan saya, TANPA PERANTARA"
  //     → menyiratkan produk lain memakai perantara
  //
  //   "Balasan prioritas, DIDAHULUKAN DARI ANTREAN"
  //     → menyiratkan pengguna paket lain menunggu lebih lama
  //
  // Keduanya menjual dengan cara menurunkan yang lain, bukan dengan
  // menjelaskan nilai sendiri. Pembaca yang teliti merasa tidak nyaman, dan
  // untuk pembeli korporat itu tanda produk yang belum matang.
  //
  // Yang benar: sebut apa yang DIDAPAT, bukan apa yang tidak ada di tempat lain.
  const membandingkan = [
    /tanpa perantara/i,
    /didahulukan dari antrean/i,
    /tidak seperti (produk|layanan|yang) lain/i,
    /lebih baik dari(pada)? (produk|layanan|kompetitor)/i,
    /beda(nya)? dengan yang lain/i,
  ];

  const pelanggar = [];
  for (const [di, teks] of semuaTeks()) {
    for (const pola of membandingkan) {
      if (pola.test(teks)) pelanggar.push(`${di}: ${teks}`);
    }
  }
  assert.deepEqual(pelanggar, [],
    `frasa yang menjelekkan yang lain: ${pelanggar.join(' | ')}`);
});

test('setiap baris fitur menyatakan apa yang DIDAPAT', () => {
  // Baris fitur positif tidak boleh dimulai dengan kata negatif. Kalau
  // dimulai dengan "tanpa", "bukan", atau "tidak", yang dibaca pengunjung
  // adalah KETIADAAN, bukan keuntungan.
  //
  // Dikecualikan: "tanpa batas" — itu menyatakan kelimpahan, bukan
  // ketiadaan. Dan "tanpa kartu kredit" di catatan paket Gratis, yang
  // menjawab kekhawatiran nyata.
  const pelanggar = [];
  for (const p of data.paket) {
    for (const f of p.fitur) {
      if (!f.termasuk) continue;
      const teksBersih = f.teks.replace(/tanpa batas/gi, '').replace(/tanpa kartu kredit/gi, '');
      if (/^(tanpa|bukan|tidak)\b/i.test(teksBersih.trim())) {
        pelanggar.push(`${p.nama}: ${f.teks}`);
      }
    }
  }
  assert.deepEqual(pelanggar, [], `mulai dengan kata negatif: ${pelanggar.join(' | ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. KONSISTENSI KARTU ↔ TABEL
// ══════════════════════════════════════════════════════════════════════════════

test('label tabel perbandingan cocok dengan nama fitur di kartu', () => {
  // ── KENAPA INI PENTING ─────────────────────────────────────────────────────
  // Kalau kartu menulis "Baca seluruh kode sumber" dan tabel menulis "Baca
  // kode sumber penuh", pengunjung mengira itu DUA FITUR BERBEDA — dan mulai
  // bertanya mana yang dia dapat.
  //
  // Tabel boleh memakai label lebih pendek (ruang kolom terbatas), tapi
  // kata-kata intinya harus sama.
  // ── KENAPA KATA KUNCI, BUKAN TEXTS PERSIS ──────────────────────────────────
  // Tabel boleh memakai label lebih pendek (ruang kolom terbatas), jadi tesnya
  // memeriksa KATA INTI, bukan kesamaan huruf per huruf.
  //
  // Yang dicegah: kartu menulis "Baca seluruh kode sumber" sementara tabel
  // menulis "Akses kode" — pengunjung mengira itu dua fitur berbeda.
  //
  // ── CATATAN: TES INI PERNAH GAGAL KARENA LABEL USANG ───────────────────────
  // Versi pertama memakai kunci 'Proyek tanpa batas jumlahnya' dan 'Jaminan
  // layanan tertulis (SLA)'. Setelah teksnya diperbaiki (karena "tanpa batas
  // jumlahnya" menimbulkan pertanyaan "apakah Profesional dibatasi?"), kedua
  // kunci itu tidak ada lagi — dan tesnya gagal meski halamannya BENAR.
  //
  // Pelajarannya: kunci tes harus mengikuti kata INTI yang stabil, bukan
  // frasa yang mungkin berubah saat teksnya diperbaiki.
  const kataKunci = {
    'Dokumentasi publik tanpa batas': /dokumentasi/i,
    'Hasil uji dan metrik seluruh proyek': /hasil uji/i,
    'Dukungan email langsung': /dukungan/i,
    'Pratinjau isi repositori': /pratinjau/i,
    'Baca seluruh kode sumber': /kode sumber/i,
    'Akses repositori privat penuh': /repositori privat/i,
    // Enterprise: inti pesannya "token tanpa batas" DAN "proyek terbuka"
    'Token tanpa batas': /token tanpa batas/i,
    'Hak pakai ulang kode': /pakai ulang/i,
    'Jaminan layanan disepakati': /jaminan layanan/i,
  };

  const semuaFitur = data.paket.flatMap((p) => p.fitur.map((f) => f.teks));
  for (const [label, pola] of Object.entries(kataKunci)) {
    assert.ok(semuaFitur.some((t) => pola.test(t)),
      `tabel menulis "${label}" tapi tidak ada fitur kartu yang cocok`);
  }
});
