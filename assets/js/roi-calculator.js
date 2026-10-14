/**
 * KALKULATOR ROI — tampilan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA MODUL TERPISAH, BUKAN BAGIAN DARI pricing.js
 * ══════════════════════════════════════════════════════════════════════════════
 * pricing.js sudah 1.347 baris dan mengurus hal lain: memuat harga dari server,
 * kartu paket, dialog pembayaran, verifikasi kode, FAQ.
 *
 * Kalkulator ini berdiri sendiri — ia tidak butuh data harga, dan harga tidak
 * butuh ia. Menumpuknya di berkas yang sama berarti setiap perubahan pada salah
 * satunya berisiko menyentuh yang lain.
 *
 * ── YANG DIMINTA KALKULATOR INI ─────────────────────────────────────────────
 * Bukan "percayai angka saya", tapi "hitung dengan angka Anda sendiri".
 *
 * Halaman ini tidak bisa mengklaim "menghemat 12 jam per minggu" — tidak ada
 * data klien yang mendukungnya. Tapi pengunjung PUNYA datanya sendiri. Jadi
 * kalkulator ini menghitung dari yang ia ketik, dan hasilnya bisa ia periksa
 * dengan kalkulator biasa.
 *
 * ── KENAPA BIAYA PEMELIHARAAN DITAMPILKAN, BUKAN DISEMBUNYIKAN ───────────────
 * Self-hosted tidak gratis: ada server, ada waktu pemeliharaan. Kalkulator yang
 * menyembunyikannya memberi hasil terlalu bagus — dan pengunjung yang kemudian
 * menemukan biaya nyatanya merasa ditipu.
 *
 * Hasilnya bahkan bisa NEGATIF, dan itu ditampilkan apa adanya. Kalkulator yang
 * selalu menampilkan hasil positif tidak berguna untuk mengambil keputusan.
 */

import {
  hitungHemat,
  rupiah,
  rupiahRingkas,
  jam,
  persenUntukPemeliharaan,
  TARIF_DEFAULT,
  SAAS_DEFAULT,
} from './roi-hitung.js';

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

/* ── Definisi field ─────────────────────────────────────────────────────── */

/**
 * Field masukan.
 *
 * ── KENAPA DITULIS SEBAGAI DATA, BUKAN HTML ─────────────────────────────────
 * Tiga field pertama punya bentuk yang sama persis: label, satuan, nilai awal.
 * Menulisnya sebagai HTML berarti tiga blok yang harus dijaga tetap konsisten —
 * dan satu yang terlewat akan terlihat berbeda dari yang lain.
 *
 * Sebagai data, bentuknya dijamin sama karena dirender oleh fungsi yang sama.
 */
const FIELD = [
  {
    kunci: 'jamPerMinggu',
    label: 'Jam kerja manual per minggu',
    satuan: 'jam',
    nilai: 8,
    bantuan: 'Waktu yang dipakai mencatat, merekap, atau mencari data secara manual.',
  },
  {
    kunci: 'jumlahOrang',
    label: 'Berapa orang yang mengerjakannya',
    satuan: 'orang',
    nilai: 1,
    bantuan: null,
  },
  {
    kunci: 'tarifPerJam',
    label: 'Nilai waktu kerja per jam',
    satuan: 'Rp',
    nilai: TARIF_DEFAULT,
    bantuan: 'Ganti sesuai tarif Anda. Angka ini titik awal, bukan patokan.',
  },
  {
    kunci: 'biayaSaas',
    label: 'Langganan SaaS per pengguna, per bulan',
    satuan: 'Rp',
    nilai: SAAS_DEFAULT,
    bantuan: 'Yang dibayar sekarang untuk alat pencatatan. Isi 0 kalau tidak ada.',
  },
  {
    kunci: 'jumlahPenggunaSaas',
    label: 'Berapa pengguna SaaS',
    satuan: 'akun',
    nilai: 1,
    bantuan: null,
  },
  {
    kunci: 'biayaPemeliharaanBulanan',
    label: 'Biaya server & pemeliharaan per bulan',
    satuan: 'Rp',
    nilai: 0,
    bantuan: 'Biaya self-hosted yang akan muncul. Isi 0 kalau server sudah ada.',
  },
];

/* ── Render field ───────────────────────────────────────────────────────── */

function gambarField(host) {
  const grid = el('div', 'roi-field-grid');

  for (const f of FIELD) {
    const bungkus = el('div', 'roi-field');

    const label = el('label', 'roi-label', f.label);
    label.htmlFor = `roi-${f.kunci}`;
    bungkus.append(label);

    const baris = el('div', 'roi-input-baris');

    const input = el('input', 'roi-input');
    input.type = 'number';
    input.id = `roi-${f.kunci}`;
    input.name = f.kunci;
    input.value = String(f.nilai);
    input.min = '0';
    // ── step="any" UNTUK RUPIAH ─────────────────────────────────────────────
    // Dengan step default (1), nilai seperti 12500 tetap bisa diketik — tapi
    // panah naik/turun di beberapa browser melompati angka yang tidak bulat.
    // `any` membuat keduanya bekerja untuk nilai apa pun.
    input.step = 'any';
    input.inputMode = 'decimal';
    baris.append(input);

    baris.append(el('span', 'roi-satuan', f.satuan));
    bungkus.append(baris);

    if (f.bantuan) {
      bungkus.append(el('p', 'roi-bantuan', f.bantuan));
    }

    grid.append(bungkus);
  }

  host.append(grid);
  return grid;
}

/* ── Render hasil ───────────────────────────────────────────────────────── */

function gambarHasil(host) {
  const wadah = el('div', 'roi-hasil');
  wadah.id = 'roiHasil';
  // ── aria-live: PEMBACA LAYAR IKUT TAHU HASILNYA BERUBAH ───────────────────
  // Tanpa ini, pengguna pembaca layar yang mengubah angka tidak tahu bahwa
  // hasilnya sudah diperbarui — ia harus keluar dari kolom input dan mencari
  // sendiri.
  wadah.setAttribute('aria-live', 'polite');
  host.append(wadah);
  return wadah;
}

/**
 * Tampilkan hasil perhitungan.
 *
 * @param {HTMLElement} wadah
 * @param {object} h  hasil dari hitungHemat()
 */
function tampilkanHasil(wadah, h) {
  wadah.replaceChildren();

  // ── BELUM ADA ISIAN ───────────────────────────────────────────────────────
  // Dibedakan dari "hasilnya nol". Pengunjung yang belum mengisi apa pun tidak
  // perlu melihat deretan Rp0 — itu terlihat seperti kalkulator rusak.
  if (!h.adaIsian) {
    wadah.append(el('p', 'roi-kosong',
      'Isi salah satu kolom di atas untuk melihat perkiraan penghematannya.'));
    return;
  }

  // ── HASIL UTAMA ───────────────────────────────────────────────────────────
  const utama = el('div', 'roi-utama');
  utama.append(el('span', 'roi-utama-label', 'Perkiraan penghematan per tahun'));

  const angka = el('strong', 'roi-utama-angka', rupiahRingkas(h.hematBersihPerTahun));
  // Nilai negatif diberi kelas sendiri supaya warnanya berbeda.
  if (!h.menguntungkan) angka.className = 'roi-utama-angka roi-utama-angka--rugi';
  utama.append(angka);

  utama.append(el('span', 'roi-utama-tepat', rupiah(h.hematBersihPerTahun)));
  wadah.append(utama);

  // ── KETERANGAN SAAT TIDAK MENGUNTUNGKAN ───────────────────────────────────
  // Ini bagian yang membuat kalkulatornya bisa dipercaya: ia TIDAK selalu
  // menyimpulkan hal yang menyenangkan penjual.
  if (!h.menguntungkan) {
    wadah.append(el('p', 'roi-catatan roi-catatan--rugi',
      'Dengan angka ini, biaya pemeliharaan self-hosted lebih besar dari '
      + 'penghematannya. Artinya self-hosted BUKAN pilihan yang tepat untuk '
      + 'keadaan Anda — dan itu lebih baik diketahui sekarang.'));
    return;
  }

  // ── PERSENTASE YANG HABIS UNTUK PEMELIHARAAN ──────────────────────────────
  // ── KENAPA INI, BUKAN "TITIK IMPAS" ────────────────────────────────────────
  // Self-hosted tidak dibeli di muka seperti mesin — tidak ada modal yang perlu
  // "dibalik". Yang berguna diketahui: berapa BAGIAN dari penghematan yang
  // habis untuk pemeliharaan.
  //
  // "Hemat Rp44 juta" dan "60% habis untuk pemeliharaan" menjelaskan keadaan
  // yang sama, tapi yang kedua lebih jujur — dan pengunjung yang akan membayar
  // pemeliharaannya perlu tahu itu.
  const persen = persenUntukPemeliharaan(h);
  if (persen != null && persen > 0) {
    wadah.append(el('p', 'roi-catatan',
      `Dari penghematan kotornya, ${persen}% habis untuk biaya pemeliharaan. `
      + `Sisanya ${rupiahRingkas(h.hematBersihPerTahun)} tetap di tangan Anda.`));
  }

  // ── RINCIAN PERHITUNGAN ───────────────────────────────────────────────────
  // Ditampilkan terbuka supaya bisa diperiksa dengan kalkulator biasa. Rincian
  // yang disembunyikan membuat hasilnya harus dipercaya begitu saja.
  const rincian = el('dl', 'roi-rincian');

  const baris = [
    ['Waktu yang dihemat', `${jam(h.jamPerTahun)} per tahun`],
    ['Nilai waktu itu', rupiah(h.hematWaktuPerTahun)],
  ];

  if (h.biayaSaasPerTahun > 0) {
    baris.push(['Langganan SaaS yang dihilangkan', rupiah(h.biayaSaasPerTahun)]);
  }

  baris.push(['Total penghematan', rupiah(h.hematKotorPerTahun)]);

  if (h.biayaPemeliharaanPerTahun > 0) {
    baris.push(['Dikurangi biaya pemeliharaan', `-${rupiah(h.biayaPemeliharaanPerTahun)}`]);
    baris.push(['Hasil bersih per tahun', rupiah(h.hematBersihPerTahun)]);
  }

  for (const [label, nilai] of baris) {
    const d = el('div', 'roi-rincian-baris');
    d.append(el('dt', 'roi-rincian-label', label));
    d.append(el('dd', 'roi-rincian-nilai', nilai));
    rincian.append(d);
  }

  wadah.append(rincian);

  // ── CATATAN KAKI: KENAPA HASILNYA PUNYA RENTANG ───────────────────────────
  // Angka ini perkiraan, bukan janji. Mengatakannya mencegah pengunjung
  // memakai hasilnya sebagai patokan pasti.
  wadah.append(el('p', 'roi-catatan roi-catatan--kecil',
    'Perkiraan ini dihitung dari angka yang Anda isi, bukan dari klaim saya. '
    + 'Ia mengandaikan sistem barunya menghabiskan waktu manual yang disebutkan '
    + '— dan pengandaian itu perlu Anda sesuaikan sendiri.'));
}

/* ── Pemasangan ─────────────────────────────────────────────────────────── */

/**
 * Pasang kalkulator ke halaman.
 *
 * @param {string} idHost  id elemen tempat kalkulator dipasang
 */
export function pasangKalkulator(idHost = 'kalkulatorRoi') {
  const host = document.getElementById(idHost);
  if (!host) return;

  // ── KENAPA FORM, BUKAN DIV ────────────────────────────────────────────────
  // Dengan <form>, menekan Enter di kolom mana pun tidak mengirim data ke mana
  // pun (tidak ada action), tapi browser tetap menandai kolomnya sebagai
  // bagian satu grup. Itu membantu navigasi keyboard.
  const form = el('form', 'roi-form');
  form.noValidate = true;

  // Cegah submit — tidak ada server yang menerima data ini.
  form.addEventListener('submit', (e) => e.preventDefault());

  const grid = gambarField(form);
  const wadahHasil = gambarHasil(form);

  host.append(form);

  const hitung = () => {
    const mentah = {};
    for (const f of FIELD) {
      const input = form.querySelector(`#roi-${f.kunci}`);
      mentah[f.kunci] = input?.value ?? 0;
    }
    tampilkanHasil(wadahHasil, hitungHemat(mentah));
  };

  // ── HITUNG SAAT DIKETIK, BUKAN SAAT TOMBOL DITEKAN ────────────────────────
  // Kalkulator yang butuh tombol "Hitung" menambah satu langkah yang tidak
  // memberi apa pun. Hasilnya murah dihitung, jadi tidak ada alasan menunda.
  grid.addEventListener('input', hitung);

  hitung();
}
