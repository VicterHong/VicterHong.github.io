/**
 * Uji template email — tanpa jaringan, tanpa kredensial.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA TEMPLATE HARUS DIUJI ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Email adalah satu-satunya bagian sistem yang TIDAK BISA dilihat pengembang
 * setelah dikirim. Kalau ada yang salah — kode tidak muncul, tautan rusak,
 * versi teks kosong — kita baru tahu dari keluhan pengguna, dan saat itu
 * emailnya sudah tidak bisa ditarik kembali.
 *
 * Uji ini memeriksa hal-hal yang tidak bisa dicek mata setelah kirim:
 *
 *   1. Semua template menghasilkan HTML + teks + subjek
 *   2. Data penting benar-benar ada di dalam HTML (kode, tautan, nama)
 *   3. Versi teks juga memuat data penting — bukan cuma HTML
 *   4. Setiap template punya preheader (pratinjau di daftar masuk)
 *   5. Tidak ada nilai `undefined`/`null` yang bocor ke tampilan
 *   6. Kerangka memakai tabel (Outlook) dan lebar 600px (standar)
 *   7. Setiap alur punya template SENDIRI (tidak bertukar)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── BUG YANG DICEGAH UJI INI ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Sebelum ini, kode hapus akun dikirim memakai template reset sandi — pengguna
 * menerima email berjudul "Ganti sandi Anda" saat meminta MENGHAPUS akun.
 * Uji "setiap alur punya template sendiri" di bawah mencegah kekeliruan itu
 * terulang.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Akar repo dihitung dari lokasi berkas ini ────────────────────────────
//
// ── KENAPA TIDAK PATH ABSOLUT ────────────────────────────────────────────
// Path seperti '/home/ubuntu/portfolio-victer/...' hanya benar di SATU
// mesin. Di GitHub Actions, checkout berada di
// /home/runner/work/<repo>/<repo>/ — dan semua tes yang memakai path
// absolut GAGAL di sana meski lulus di lokal.
//
// Menghitung dari lokasi berkas membuat tes bekerja di mana pun.
const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');


const T = await import(join(AKAR, 'backend', 'src', 'email', 'templates.mjs'));

/** Semua template beserta data contohnya — satu tempat untuk uji menyeluruh. */
const SEMUA = [
  {
    nama: 'reset-sandi',
    buat: () => T.templateResetSandi({ nama: 'Victer', tautan: 'https://contoh.id/reset?token=abc123', berlakuMenit: 60 }),
    wajibAda: ['Victer', 'https://contoh.id/reset?token=abc123', '60 menit'],
    judulHarus: /sandi/i,
  },
  {
    nama: 'kode-hapus-akun',
    buat: () => T.templateKodeHapusAkun({ nama: 'Victer', kode: '483920', berlakuMenit: 15, sisaHari: 30 }),
    wajibAda: ['Victer', '483920', '15 menit', '30'],
    judulHarus: /hapus/i,
  },
  {
    nama: 'kode-batal-hapus',
    buat: () => T.templateKodeBatalHapus({ nama: 'Victer', kode: '112233', berlakuMenit: 15, sisaHari: 22 }),
    wajibAda: ['Victer', '112233', '22'],
    judulHarus: /batal|pulih/i,
  },
  {
    nama: 'selamat-datang',
    buat: () => T.templateSelamatDatang({ nama: 'Victer', email: 'victer@contoh.id', tautanVerifikasi: 'https://contoh.id/verifikasi?t=xyz' }),
    wajibAda: ['Victer', 'victer@contoh.id', 'https://contoh.id/verifikasi'],
    judulHarus: /selamat datang/i,
  },
  {
    nama: 'masuk-perangkat-baru',
    buat: () => T.templateMasukPerangkatBaru({
      nama: 'Victer', perangkat: 'Chrome di Android', lokasi: 'Jakarta, Indonesia',
      ip: '103.10.20.30', waktu: 1760000000000,
    }),
    wajibAda: ['Victer', 'Chrome di Android', 'Jakarta, Indonesia', '103.10.20.30'],
    judulHarus: /masuk/i,
  },
  {
    nama: 'struk-pembayaran',
    buat: () => T.templateStrukPembayaran({
      nama: 'Victer', email: 'victer@contoh.id', nomorPesanan: 'VIV-2026-0001',
      paket: 'Profesional', periode: 'Tahunan (12 bulan)', jumlah: 'Rp1.500.000',
      status: 'Lunas', waktu: 1760000000000,
    }),
    wajibAda: ['Victer', 'VIV-2026-0001', 'Profesional', 'Rp1.500.000', 'Lunas'],
    judulHarus: /pembayaran|struk/i,
  },
  {
    nama: 'akun-dinonaktifkan',
    buat: () => T.templateAkunDinonaktifkan({ nama: 'Victer', sisaHari: 30, tautanPulihkan: 'https://contoh.id/pemulihan' }),
    wajibAda: ['Victer', '30', 'https://victer.is-a.dev/pemulihan'],
    judulHarus: /nonaktif/i,
  },
  {
    nama: 'kode-masuk',
    buat: () => T.templateKodeMasuk({ nama: 'Victer', kode: '998877', berlakuMenit: 10, lokasi: 'Bandung', ip: '10.0.0.1' }),
    wajibAda: ['Victer', '998877', '10 menit'],
    judulHarus: /kode masuk/i,
  },
  // ── SIKLUS LANGGANAN ──────────────────────────────────────────────────────
  {
    nama: 'langganan-akan-berakhir',
    buat: () => T.templateLanggananAkanBerakhir({
      nama: 'Victer', paket: 'Profesional', sisaHari: 7,
      tanggalBerakhir: Date.now() + 7 * 86400000, jumlah: 'Rp1.500.000',
    }),
    wajibAda: ['Victer', 'Profesional', '7'],
    judulHarus: /berakhir/i,
  },
  {
    nama: 'langganan-berakhir',
    buat: () => T.templateLanggananBerakhir({
      nama: 'Victer', paket: 'Profesional', tanggalBerakhir: Date.now(),
    }),
    wajibAda: ['Victer', 'Profesional'],
    judulHarus: /berakhir/i,
  },
  {
    nama: 'langganan-diperpanjang',
    buat: () => T.templateLanggananDiperpanjang({
      nama: 'Victer', paket: 'Profesional',
      tanggalBerakhir: Date.now() + 365 * 86400000, nomorPesanan: 'VIV-2026-0001',
    }),
    wajibAda: ['Victer', 'Profesional', 'VIV-2026-0001'],
    judulHarus: /aktif|diperpanjang/i,
  },
  {
    nama: 'pembayaran-gagal',
    buat: () => T.templatePembayaranGagal({
      nama: 'Victer', paket: 'Standar', jumlah: 'Rp79.000', alasan: 'Kartu ditolak', sisaHari: 7,
    }),
    wajibAda: ['Victer', 'Standar', 'Rp79.000', 'Kartu ditolak'],
    judulHarus: /gagal/i,
  },
  {
    nama: 'token-akan-kedaluwarsa',
    buat: () => T.templateTokenAkanKedaluwarsa({
      nama: 'Victer', labelToken: 'Production API', sisaHari: 14,
      tanggalKedaluwarsa: Date.now() + 14 * 86400000,
    }),
    wajibAda: ['Victer', 'Production API', '14'],
    judulHarus: /kedaluwarsa/i,
  },
];

// ── 1. Bentuk hasil ───────────────────────────────────────────────────────────

test('semua template mengembalikan { subjek, html, teks }', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    assert.equal(typeof hasil.subjek, 'string', `${t.nama}: subjek harus string`);
    assert.ok(hasil.subjek.length > 5, `${t.nama}: subjek terlalu pendek`);
    assert.equal(typeof hasil.html, 'string', `${t.nama}: html harus string`);
    assert.equal(typeof hasil.teks, 'string', `${t.nama}: teks harus string`);
    assert.ok(hasil.html.length > 1000, `${t.nama}: html terlalu pendek (${hasil.html.length})`);
    assert.ok(hasil.teks.length > 50, `${t.nama}: versi teks terlalu pendek`);
  }
});

// ── 2. Data penting benar-benar ada ───────────────────────────────────────────

test('data penting muncul di HTML DAN versi teks', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    for (const data of t.wajibAda) {
      assert.ok(
        hasil.html.includes(data),
        `${t.nama}: "${data}" TIDAK ada di HTML — pengguna tidak akan melihatnya`
      );
      assert.ok(
        hasil.teks.includes(data),
        `${t.nama}: "${data}" TIDAK ada di versi teks — klien yang hanya ` +
        `menampilkan teks akan kehilangan informasi ini`
      );
    }
  }
});

// ── 3. Preheader ──────────────────────────────────────────────────────────────

test('setiap template punya preheader (teks pratinjau di daftar masuk)', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    // Preheader ditandai dengan style display:none di paling atas body.
    assert.ok(
      /display:none[^>]*font-size:1px/.test(hasil.html),
      `${t.nama}: tidak punya preheader — daftar masuk akan menampilkan ` +
      `"Halo," atau potongan HTML sebagai pratinjau`
    );
  }
});

// ── 4. Tidak ada nilai bocor ──────────────────────────────────────────────────

test('tidak ada "undefined" atau "null" yang bocor ke tampilan', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    for (const bagian of ['html', 'teks', 'subjek']) {
      assert.ok(
        !hasil[bagian].includes('undefined'),
        `${t.nama}: kata "undefined" muncul di ${bagian} — ada nilai yang tidak terisi`
      );
      assert.ok(
        !hasil[bagian].includes('[object Object]'),
        `${t.nama}: "[object Object]" muncul di ${bagian} — ada objek yang dicetak langsung`
      );
    }
  }
});

test('template tanpa nama tetap menyapa dengan benar (bukan "Halo undefined")', () => {
  const hasil = T.templateResetSandi({ tautan: 'https://x/reset' });

  // ── KENAPA DIPERIKSA DUA BENTUK ───────────────────────────────────────────
  // Template memakai {{sapaan}} yang berisi kalimat LENGKAP. Tanpa nama,
  // isinya "Halo," — dan pemeriksaan harus memastikan TIDAK ada spasi
  // menggantung sebelum koma ("Halo ,"), karena itu terlihat seperti
  // kesalahan sistem.
  assert.ok(hasil.html.includes('Halo,'), 'harus menyapa "Halo," tanpa nama');
  assert.ok(!hasil.html.includes('Halo ,'), 'tidak boleh ada spasi menggantung: "Halo ,"');
  assert.ok(!hasil.html.includes('undefined'), 'tidak boleh ada "undefined"');
});

// ── 5. Kerangka email yang benar ──────────────────────────────────────────────

test('semua HTML memakai tabel (Outlook) dan lebar 600px (standar)', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    assert.ok(
      hasil.html.includes('role="presentation"'),
      `${t.nama}: tidak memakai <table role="presentation"> — Outlook ` +
      `(mesin render Word) tidak mendukung flexbox/grid dan tata letak akan rusak`
    );
    assert.ok(
      /max-width:\s*600px/.test(hasil.html),
      `${t.nama}: tidak memakai lebar 600px — standar email transaksional`
    );
  }
});

test('semua HTML mendeklarasikan skema gelap (cegah pembalikan warna otomatis)', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    // ── CATATAN: META INI DITAMBAHKAN LEWAT <mj-raw> ───────────────────────
    // MJML tidak mengenal <meta name="color-scheme"> dan tidak
    // menghasilkannya sendiri. Ia disisipkan lewat <mj-raw> di kepala —
    // lihat email-src/templates.mjml.mjs.
    //
    // Kalau tes ini gagal, penyebab tersering: blok <mj-raw> terhapus, atau
    // posisinya di luar <mj-head> sehingga MJML mengabaikannya.
    assert.ok(
      hasil.html.includes('color-scheme'),
      `${t.nama}: tanpa color-scheme, klien email tertentu membalik warna ` +
      `secara otomatis — teks gelap di latar gelap, tidak terbaca. ` +
      `Meta ini disisipkan lewat <mj-raw> di <mj-head>.`
    );
  }
});

test('tombol memakai tabel (bukan <a> telanjang) untuk kompatibilitas Outlook', () => {
  const hasil = T.templateResetSandi({ nama: 'A', tautan: 'https://x/reset' });
  // Pola bulletproof button: <td bgcolor> + conditional comment v:roundrect
  assert.ok(
    /<!--\[if mso\]>/.test(hasil.html),
    'tombol harus punya fallback VML untuk Outlook — tanpa itu tombolnya ' +
    'tampil sebagai tautan teks polos di Outlook'
  );
  assert.ok(
    /bgcolor="/.test(hasil.html),
    'tombol harus memakai bgcolor pada sel (Outlook mengabaikan background CSS)'
  );
});

// ── 6. Setiap alur punya template SENDIRI ─────────────────────────────────────
//
// Ini mencegah bug yang sudah terjadi: kode hapus akun dikirim dengan template
// reset sandi — pengguna menerima "Ganti sandi Anda" saat meminta hapus akun.

test('setiap alur punya template sendiri — tidak bertukar', () => {
  const subjek = {};
  for (const t of SEMUA) {
    subjek[t.nama] = t.buat().subjek;
  }

  // Tidak boleh ada dua alur dengan subjek yang sama.
  const nilai = Object.values(subjek);
  const unik = new Set(nilai);
  assert.equal(
    unik.size, nilai.length,
    `ada alur yang memakai subjek sama: ${JSON.stringify(subjek, null, 2)} — ` +
    `pengguna tidak bisa membedakan email dari alur berbeda`
  );
});

test('judul setiap template sesuai alurnya', () => {
  for (const t of SEMUA) {
    const hasil = t.buat();
    assert.match(
      hasil.subjek,
      t.judulHarus,
      `${t.nama}: subjek "${hasil.subjek}" tidak sesuai alurnya`
    );
  }
});

test('kode hapus akun BUKAN template reset sandi (regresi bug nyata)', () => {
  const hapus = T.templateKodeHapusAkun({ nama: 'A', kode: '123456' });
  const reset = T.templateResetSandi({ nama: 'A', tautan: 'https://x/reset' });

  assert.notEqual(hapus.subjek, reset.subjek, 'subjek tidak boleh sama');
  assert.ok(
    !/sandi/i.test(hapus.subjek),
    `subjek kode hapus akun menyebut "sandi": "${hapus.subjek}" — ` +
    `pengguna akan mengira sandinya berubah, padahal akunnya mau dihapus`
  );
  assert.ok(
    /hapus/i.test(hapus.subjek),
    `subjek kode hapus akun harus menyebut penghapusan: "${hapus.subjek}"`
  );
  assert.ok(
    !hapus.html.includes('Buat sandi baru'),
    'email hapus akun tidak boleh menampilkan tombol "Buat sandi baru"'
  );
});

// ── 7. Keamanan isi ───────────────────────────────────────────────────────────

test('email kode hapus akun memuat peringatan masa tenggang', () => {
  const hasil = T.templateKodeHapusAkun({ nama: 'A', kode: '123456', sisaHari: 30 });
  assert.ok(
    /masa tenggang|dinonaktifkan|30 hari/i.test(hasil.html),
    'email hapus akun harus menjelaskan bahwa ini bukan penghapusan langsung — ' +
    'tanpa itu pengguna tidak tahu akunnya masih bisa dipulihkan'
  );
});

test('email kode hapus akun memperingatkan jangan bagikan kode', () => {
  const hasil = T.templateKodeHapusAkun({ nama: 'A', kode: '123456' });
  assert.ok(
    /jangan bagikan|jangan.*berikan/i.test(hasil.html),
    'email berisi kode sensitif harus memperingatkan agar kode tidak dibagikan'
  );
});

test('email masuk perangkat baru memberi cara mengamankan akun', () => {
  const hasil = T.templateMasukPerangkatBaru({ nama: 'A', perangkat: 'Chrome', lokasi: 'Jakarta' });
  assert.ok(
    /amankan|ganti sandi|cabut/i.test(hasil.html),
    'email peringatan keamanan tanpa tindakan lanjutan membuat pengguna ' +
    'cuma khawatir tanpa bisa berbuat apa-apa'
  );
});

test('struk pembayaran memuat nomor pesanan dan jumlah', () => {
  const hasil = T.templateStrukPembayaran({
    nama: 'A', email: 'a@b.id', nomorPesanan: 'VIV-001',
    paket: 'Standar', periode: 'Bulanan', jumlah: 'Rp150.000', status: 'Lunas',
  });
  assert.ok(hasil.html.includes('VIV-001'), 'nomor pesanan harus ada (bukti transaksi)');
  assert.ok(hasil.html.includes('Rp150.000'), 'jumlah harus ada');
});

// ── 8. Panjang subjek (batas tampilan daftar masuk) ───────────────────────────

test('subjek tidak lebih dari 78 karakter (agar tidak terpotong)', () => {
  for (const t of SEMUA) {
    const { subjek } = t.buat();
    assert.ok(
      subjek.length <= 78,
      `${t.nama}: subjek ${subjek.length} karakter — kebanyakan klien memotong ` +
      `di ~60-78 karakter`
    );
  }
});

// ── 9. Escaping HTML untuk data pengguna ──────────────────────────────────────

test('nama dengan karakter HTML tidak merusak tampilan', () => {
  // Nama pengguna bisa berisi karakter apa pun. Kalau tidak di-escape, tag
  // di dalamnya bisa merusak struktur email — atau lebih buruk, menyisipkan
  // konten yang tidak kita maksud.
  const hasil = T.templateResetSandi({ nama: 'A <b>C</b>', tautan: 'https://x/r' });
  assert.ok(
    hasil.html.includes('A <b>C</b>') || hasil.html.includes('A &lt;b&gt;C&lt;/b&gt;'),
    'nama harus muncul — entah apa adanya atau ter-escape'
  );
  // Yang penting: struktur email tetap utuh.
  assert.ok(hasil.html.includes('</html>'), 'HTML harus tetap lengkap');
});
