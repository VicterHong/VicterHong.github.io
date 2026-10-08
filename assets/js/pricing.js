/**
 * Halaman harga — memuat data dari server dan menggambar tampilannya.
 *
 * ── KENAPA DATA DARI SERVER, BUKAN DI HTML ─────────────────────────────────
 * Harga yang ditulis langsung di HTML berarti:
 *   • Mengubah harga = mengedit HTML, dan mudah terlewat di satu tempat
 *   • Angka di halaman dan angka di sistem pembayaran bisa berbeda
 *   • Tidak ada satu sumber kebenaran
 *
 * Sekarang server mengirim datanya (src/pricing.mjs), dan berkas ini
 * menggambarnya. Mengubah harga cukup di satu tempat.
 *
 * ── KENAPA SKELETON, BUKAN KOSONG LALU MUNCUL ──────────────────────────────
 * Tanpa skeleton, halaman terlihat kosong lalu isinya "melompat" masuk —
 * dan itu menggeser apa pun yang sudah dibaca pengguna.
 *
 * Skeleton menggambar BENTUK isinya lebih dulu, jadi tidak ada yang bergeser
 * saat data tiba. Ini juga menghilangkan Cumulative Layout Shift (CLS).
 *
 * ── KENAPA `<template>`, BUKAN INNERHTML ───────────────────────────────────
 * Data dari server adalah data, bukan HTML. Menyisipkannya lewat innerHTML
 * berarti memperlakukannya sebagai markup — dan kalau suatu saat isinya
 * memuat karakter seperti `<`, tampilannya rusak.
 *
 * `<template>` + `textContent` memperlakukan semuanya sebagai teks. Aman
 * secara default, tanpa perlu escaping manual.
 */

const JALUR_API = '/api/pricing';

/** Batas waktu — jangan biarkan pengguna menatap skeleton selamanya. */
const TIMEOUT_MS = 8000;

/**
 * Ambil data harga dari server.
 *
 * `cache: 'default'` (bukan `no-store`) supaya Cache-Control dari server
 * dihormati — server mengirim max-age=60, jadi membuka halaman berulang
 * dalam satu menit tidak memanggil server lagi.
 */
async function ambilData() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(JALUR_API, {
      signal: ctl.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Server menjawab ${res.status}`);
    }

    const data = await res.json();

    if (!data?.ok || !Array.isArray(data.paket)) {
      throw new Error('Bentuk data tidak dikenali');
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Pembuat elemen ─────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';

/** Buat elemen dengan kelas & teks. */
function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = teks;
  return node;
}

/** Buat ikon SVG. Jalur `d` dari Lucide (lisensi ISC). */
function ikon(jalur, ukuran = 10, tebal = 4, bulat = true) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(ukuran));
  svg.setAttribute('height', String(ukuran));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(tebal));
  svg.setAttribute('stroke-linecap', 'round');
  if (bulat) svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', jalur);
  svg.appendChild(path);
  return svg;
}

const JALUR_CEK = 'M20 6 9 17l-5-5';
const JALUR_STRIP = 'M5 12h14';
const JALUR_PANAH_LUAR = 'M7 7h10v10 M7 17 17 7';

/** Tombol dengan panah keluar. */
function tombol(teks, gaya, href) {
  const a = el('a', `tombol tombol--${gaya}`);
  a.href = href;

  // Panah digambar sebagai dua elemen supaya bisa digabung dalam satu path
  // tanpa `M` ganda — beberapa renderer memperlakukannya berbeda.
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p1 = document.createElementNS(NS, 'path');
  p1.setAttribute('d', 'M7 7h10v10');
  const p2 = document.createElementNS(NS, 'path');
  p2.setAttribute('d', 'M7 17 17 7');
  svg.append(p1, p2);

  a.append(teks, ' ', svg);
  return a;
}

/* ── Penggambar ─────────────────────────────────────────────────────────── */

/** Format harga: 149 → "Rp 149". null → teks pengganti. */
/**
 * Format harga untuk periode yang dipilih.
 *
 * ── KENAPA HARGA DIHITUNG DI SERVER ────────────────────────────────────────
 * Server mengirim `paket.harga` yang sudah berisi: normal, bulanan, tahunan,
 * dan persen diskonnya. Frontend hanya MEMILIH mana yang ditampilkan.
 *
 * Kalau frontend yang menghitung, rumusnya ada di dua tempat — dan begitu
 * salah satu diubah, keduanya berbeda tanpa ada yang tahu.
 *
 * ── KENAPA HARGA NORMAL SELALU DITAMPILKAN DICORET ─────────────────────────
 * Karena diskonnya nyata: harga normal adalah harga yang benar-benar
 * berlaku tanpa komitmen. Menampilkannya membuat potongannya bisa dinilai —
 * bukan sekadar klaim "hemat" tanpa pembanding.
 */
function formatHarga(paket, periode) {
  const rupiah = new Intl.NumberFormat('id-ID');

  // Paket tanpa angka (Enterprise)
  if (paket.harga?.normal == null) {
    return {
      angka: paket.teksHarga ?? 'Sesuai kebutuhan',
      teks: true,
      satuan: null,
      coret: null,
      diskon: null,
      total: null,
      catatanKaki: paket.catatan,
    };
  }

  const tahunan = periode === 'tahunan';
  const angka = tahunan ? paket.harga.tahunan : paket.harga.bulanan;
  const persen = tahunan
    ? paket.harga.diskonTahunanPersen
    : paket.harga.diskonBulananPersen;

  // ── Total setahun ────────────────────────────────────────────────────────
  // Hanya untuk periode tahunan: pembeli perlu tahu angka yang benar-benar
  // ditagih, bukan hanya harga per bulan.
  const total = tahunan ? angka * 12 : null;

  return {
    angka: `Rp ${rupiah.format(angka)}`,
    teks: false,
    satuan: '/bulan',
    // Harga normal dicoret — hanya kalau memang ada diskon
    coret: persen ? `Rp ${rupiah.format(paket.harga.normal)}` : null,
    diskon: persen ? `Hemat ${persen}%` : null,
    total: total ? `Rp ${rupiah.format(total)}` : null,
    rupiah,
    catatanKaki: paket.catatan,
  };
}

function gambarKartu(paket, hrefKontak, periode) {
  const kartu = el('div', `harga-kartu${paket.unggulan ? ' harga-kartu--unggulan' : ''}`);
  kartu.dataset.paket = paket.id;

  // ── Cincin glow ─────────────────────────────────────────────────────────
  // Elemen khusus, bukan ::before.
  //
  // ── KENAPA BUKAN ::before ───────────────────────────────────────────────
  // Versi sebelumnya menganimasikan `--sudut` di dalam conic-gradient.
  // Itu jalan, tapi TIDAK MULUS: Chromium harus menghitung ulang gradient-nya
  // di setiap frame (repaint), bukan menyerahkannya ke GPU.
  //
  // Cara yang benar: gradient-nya DIAM, elemennya yang berputar. `transform:
  // rotate()` dikerjakan GPU tanpa repaint — hasilnya mulus di semua
  // perangkat, termasuk ponsel kelas bawah.
  //
  // Butuh dua lapis: wadah ber-mask (untuk memotong jadi tepi 1px) dan anak
  // yang berputar di dalamnya. `::before` hanya bisa satu, jadi elemennya
  // dibuat di sini.
  const glow = el('span', 'harga-glow');
  glow.setAttribute('aria-hidden', 'true');
  kartu.appendChild(glow);

  if (paket.lencana) {
    kartu.appendChild(el('span', 'harga-lencana', paket.lencana));
  }

  const kepala = el('div', 'harga-kepala');
  kepala.appendChild(el('h2', 'harga-nama', paket.nama));
  kepala.appendChild(el('p', 'harga-desc', paket.deskripsi));

  const f = formatHarga(paket, periode);

  // ── Harga normal (dicoret) + lencana diskon ─────────────────────────────
  // Ditaruh DI ATAS harga bayar, bukan di sampingnya.
  //
  // Kalau sejajar, mata membaca dua angka sekaligus dan harus memutuskan
  // mana yang berlaku. Dengan bertumpuk, urutannya jelas: harga normal
  // → hemat berapa → harga yang dibayar.
  if (f.coret) {
    const barisCoret = el('div', 'harga-coret-wrap');

    const spanCoret = el('span', 'harga-coret', f.coret);
    // Pembaca layar tidak bisa "melihat" coretan — beri tahu lewat teks.
    spanCoret.setAttribute('aria-label', `Harga normal ${f.coret}`);
    barisCoret.appendChild(spanCoret);

    if (f.diskon) {
      barisCoret.appendChild(el('span', 'harga-diskon', f.diskon));
    }

    kepala.appendChild(barisCoret);
  }

  // ── Penyeimbang: baris harga coret yang kosong ──────────────────────────
  // Kartu berbayar punya baris harga coret (25px) DI ATAS harganya. Kartu
  // Enterprise tidak — jadi harganya naik 44px, dan posisinya tidak sejajar
  // dengan dua kartu lain.
  //
  // Elemen kosong ini harus ditaruh DI SINI — sebelum harga, bukan sesudah.
  // Menaruhnya di akhir blok membuat harganya tetap naik, dan hanya
  // daftar fiturnya yang sejajar. Itu kesalahan yang sudah pernah terjadi.
  if (f.teks) {
    const kosongCoret = el('div', 'harga-coret-wrap');
    kosongCoret.setAttribute('aria-hidden', 'true');
    kepala.appendChild(kosongCoret);
  }

  const wrap = el('div', 'harga-angka-wrap');
  const spanAngka = el('span', `harga-angka${f.teks ? ' harga-angka--teks' : ''}`, f.angka);
  wrap.appendChild(spanAngka);
  if (f.satuan) wrap.appendChild(el('span', 'harga-periode', f.satuan));
  kepala.appendChild(wrap);

  // ── Keterangan di bawah harga ────────────────────────────────────────────
  const barisKaki = [];

  // ── Urutan baris: total SELALU dulu, catatan kemudian ───────────────────
  //
  // Enterprise tidak punya baris total. Kalau barisnya dihilangkan begitu
  // saja, catatannya naik ke posisi yang di kartu lain ditempati total —
  // dan keterangan ketiga kartu tidak sejajar.
  //
  // Jadi barisnya tetap dibuat, hanya diisi spasi setinggi satu baris.
  // Urutannya harus benar: kalau penyeimbangnya ditambahkan SETELAH
  // catatan, hasilnya terbalik — catatan di atas, total di bawah.
  if (f.total) {
    barisKaki.push(el('p', 'harga-total', `Ditagih ${f.total} per tahun`));
  } else if (f.teks && periode === 'tahunan') {
    // Enterprise di periode tahunan: penyeimbang di posisi yang sama
    const kosong = el('p', 'harga-total');
    kosong.setAttribute('aria-hidden', 'true');
    kosong.textContent = '\u00A0';
    barisKaki.push(kosong);
  }

  if (f.catatanKaki) {
    barisKaki.push(el('p', 'harga-catatan', f.catatanKaki));
  }

  for (const baris of barisKaki) kepala.appendChild(baris);

  // ── Penyeimbang tinggi ──────────────────────────────────────────────────
  // Kartu Enterprise tidak punya harga angka, jadi baris-baris yang ada di
  // kartu berbayar tidak ada di sini. Jumlahnya BERGANTUNG PERIODE:
  //
  //   Tahunan  : harga coret (25px) + "Ditagih … per tahun" (20px)
  //   Bulanan  : harga coret (25px) saja — tidak ada tagihan tahunan
  //
  // Penyeimbangnya harus mengikuti jumlah yang sama, kalau tidak justru
  // jadi sumber ketidaksejajaran baru. Ini sudah pernah terjadi: penyeimbang
  // ditulis untuk periode tahunan saja, dan di mode bulanan kartu Enterprise
  // jadi 34px lebih tinggi dari yang lain.
  //
  // `aria-hidden` karena tidak ada isinya — pembaca layar tidak perlu tahu
  // ada ruang kosong.

  kartu.appendChild(kepala);

  // Daftar fitur
  const ul = el('ul', 'harga-fitur');
  for (const f of paket.fitur ?? []) {
    const li = el('li', f.termasuk ? null : 'tidak-dapat');

    const ikonWrap = el('span', `harga-ikon harga-ikon--${f.termasuk ? 'cek' : 'strip'}`);
    ikonWrap.setAttribute('aria-hidden', 'true');
    ikonWrap.appendChild(
      f.termasuk
        ? ikon(JALUR_CEK, 10, 4)
        : ikon(JALUR_STRIP, 9, 4, false),
    );

    li.appendChild(ikonWrap);

    if (f.tebal) {
      const kuat = el('strong', null, f.teks);
      li.appendChild(kuat);
    } else {
      li.appendChild(document.createTextNode(f.teks));
    }

    ul.appendChild(li);
  }
  kartu.appendChild(ul);

  kartu.appendChild(tombol(paket.cta?.teks ?? 'Mulai', paket.cta?.gaya ?? 'sekunder', hrefKontak));

  return kartu;
}


function gambarFaq(data, hrefKontak) {
  const list = el('div', 'faq-list');

  for (const item of data.faq ?? []) {
    const details = el('details', 'faq-item');

    const summary = el('summary', 'faq-tanya');
    summary.appendChild(document.createTextNode(item.tanya));

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'faq-penanda');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'm6 9 6 6 6-6');
    svg.appendChild(p);
    summary.appendChild(svg);

    details.appendChild(summary);

    const jawab = el('p', 'faq-jawab');

    // Kalau jawabannya menyebut "Hubungi saya", ubah bagian itu menjadi
    // tautan yang bisa diklik.
    //
    // Teksnya DIPECAH pada penandanya, bukan disisipkan sebagai HTML —
    // supaya isi dari server tetap diperlakukan sebagai teks. Kalau nanti
    // jawabannya memuat karakter seperti `<`, tampilannya tidak rusak.
    const penanda = 'Hubungi saya';
    const pos = item.jawab.indexOf(penanda);

    if (pos === -1) {
      jawab.textContent = item.jawab;
    } else {
      jawab.append(document.createTextNode(item.jawab.slice(0, pos)));

      const a = el('a', null, 'Bicara dulu');
      a.href = hrefKontak;
      jawab.append(a, document.createTextNode(' — tidak ada kewajiban setelahnya.'));
    }

    details.appendChild(jawab);
    list.appendChild(details);
  }

  return list;
}

/* ── Toggle periode ─────────────────────────────────────────────────────── */

/**
 * Gambar tombol pilihan periode.
 *
 * ── KENAPA RADIO, BUKAN TOMBOL BIASA ──────────────────────────────────────
 * Ini pilihan tunggal (satu dari dua), dan radio memang untuk itu. Dengan
 * radio, navigasi panah keyboard bekerja sendiri dan pembaca layar
 * mengumumkan "1 dari 2" — tanpa JavaScript tambahan.
 *
 * Tombol biasa akan terlihat sama, tapi kehilangan semuanya itu.
 */
function gambarToggle(periode, paket, saatGanti) {
  const wrap = el('div', 'periode-toggle');
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Periode pembayaran');

  // ── Persen diskon diambil dari PAKET, bukan ditulis di label ──────────────
  //
  // Kalau labelnya berisi teks tetap ("Hemat 20%"), ia bisa berbeda dari
  // diskon yang sebenarnya berlaku — dan itu sudah pernah terjadi: label
  // bilang 20% padahal tahunannya 25%.
  //
  // Dengan membaca dari data paket, angkanya tidak mungkin tidak sinkron.
  // Diambil dari paket PERTAMA yang punya diskon — semua paket berbayar
  // memakai persen yang sama per periode.
  const persenUntuk = (id) => {
    const p = paket.find((x) => x.harga?.normal != null);
    if (!p) return null;
    return id === 'tahunan'
      ? p.harga.diskonTahunanPersen
      : p.harga.diskonBulananPersen;
  };

  for (const opsi of periode.opsi) {
    const label = el('label', 'periode-opsi');

    const input = el('input', 'periode-input');
    input.type = 'radio';
    input.name = 'periode';
    input.value = opsi.id;
    input.checked = opsi.id === periode.default;

    const teks = el('span', 'periode-teks');
    teks.appendChild(document.createTextNode(opsi.label));

    // Lencana hanya muncul kalau memang ada diskon untuk periode itu
    const persen = persenUntuk(opsi.id);
    if (persen) {
      teks.appendChild(el('span', 'periode-catatan', `Hemat ${persen}%`));
    }

    input.addEventListener('change', () => {
      if (input.checked) saatGanti(opsi.id);
    });

    label.append(input, teks);
    wrap.appendChild(label);
  }

  return wrap;
}

/* ── Kartu aktif — glow berputar ────────────────────────────────────────── */

/**
 * Tandai kartu yang sedang dipilih, dan lepaskan dari yang lain.
 *
 * ── KENAPA KLIK, BUKAN HANYA HOVER ─────────────────────────────────────────
 * Hover tidak ada di perangkat sentuh. Kalau efeknya hanya muncul saat
 * hover, pengguna ponsel — yang justru mayoritas — tidak akan pernah
 * melihatnya sama sekali.
 *
 * Klik berfungsi di keduanya, dan lebih disengaja: pengguna memilih untuk
 * melihat kartu itu, bukan sekadar kebetulan melintasinya dengan kursor.
 *
 * ── KENAPA HANYA SATU YANG AKTIF ───────────────────────────────────────────
 * Kalau ketiganya bisa menyala bersamaan, tidak ada yang menonjol — dan
 * glow-nya jadi bising. Satu aktif pada satu waktu membuatnya bermakna.
 */
function pasangKartuAktif(grid) {
  if (!grid) return;

  // Delegasi ke grid — kartu digambar ulang saat periode berganti, jadi
  // memasang listener di setiap kartu berarti harus dipasang ulang terus.
  grid.addEventListener('click', (e) => {
    const kartu = e.target.closest('.harga-kartu');
    if (!kartu) return;

    // Klik pada tautan/tombol tidak boleh mengubah pilihan — pengguna
    // sedang menuju ke sana, bukan memilih kartunya.
    if (e.target.closest('a, button')) return;

    for (const k of grid.querySelectorAll('.harga-kartu')) {
      k.classList.toggle('is-aktif', k === kartu);
    }
  });
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

function skeletonKartu() {
  const kartu = el('div', 'sk-kartu');
  kartu.setAttribute('aria-hidden', 'true');

  const kepala = el('div');
  kepala.style.cssText = 'display:flex;flex-direction:column;gap:0.75rem;';

  const sk = (kelas) => {
    const d = el('div', `skeleton ${kelas}`);
    return d;
  };

  kepala.append(sk('sk-judul sk-w-45'), sk('sk-teks sk-w-90'), sk('sk-angka sk-w-60'));
  kartu.appendChild(kepala);

  const fitur = el('div');
  fitur.style.cssText = 'display:flex;flex-direction:column;gap:0.75rem;flex:1;';
  for (let i = 0; i < 5; i++) {
    const baris = el('div', 'sk-baris');
    baris.append(sk('sk-ikon'), sk(`sk-teks-sm ${i % 2 ? 'sk-w-75' : 'sk-w-90'}`));
    fitur.appendChild(baris);
  }
  kartu.appendChild(fitur);

  kartu.appendChild(sk('sk-teks sk-w-30'));
  return kartu;
}


function skeletonFaq() {
  const list = el('div', 'faq-list');
  list.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < 5; i++) {
    const item = el('div', 'sk-faq');
    const a = el('div', `skeleton sk-teks ${i % 2 ? 'sk-w-60' : 'sk-w-75'}`);
    const b = el('div', 'skeleton sk-ikon');
    item.append(a, b);
    list.appendChild(item);
  }
  return list;
}

/** Tampilkan skeleton di semua wadah. */
function tampilkanSkeleton(root) {
  const grid = root.querySelector('#wadahKartu');
  const faq = root.querySelector('#wadahFaq');
  const toggle = root.querySelector('#wadahPeriode');

  // Toggle periode disembunyikan selama memuat — pilihan periode belum
  // bermakna sebelum harga tiba, dan menampilkannya kosong terlihat rusak.
  if (toggle) toggle.replaceChildren();

  if (grid) {
    grid.className = 'harga-grid';
    grid.replaceChildren(skeletonKartu(), skeletonKartu(), skeletonKartu());
  }
  if (faq) faq.replaceChildren(skeletonFaq());
}

/** Pesan error dengan jalan keluar — bukan halaman kosong. */
function tampilkanError(root, pesan) {
  const kotak = el('div', 'pricing-error');
  kotak.setAttribute('role', 'alert');

  kotak.appendChild(el('p', 'pricing-error-judul', 'Harga sedang tidak bisa dimuat'));

  const teks = el('p', 'pricing-error-teks',
    `${pesan} Halaman ini butuh koneksi ke server untuk menampilkan harga terbaru — supaya angkanya selalu sama dengan yang berlaku.`);
  kotak.appendChild(teks);

  const aksi = el('div', 'cta-tombol');
  const coba = el('button', 'tombol tombol--utama', 'Coba lagi');
  coba.type = 'button';
  coba.addEventListener('click', () => location.reload());
  aksi.appendChild(coba);

  const kontak = tombol('Hubungi saya', 'sekunder', '/#89fk39');
  aksi.appendChild(kontak);
  kotak.appendChild(aksi);

  const grid = root.querySelector('#wadahKartu');
  if (grid) {
    grid.className = '';
    grid.replaceChildren(kotak);
  }

  const faq = root.querySelector('#wadahFaq');
  if (faq) faq.replaceChildren();
}

/* ── Masuk ──────────────────────────────────────────────────────────────── */

async function mulai() {
  const root = document.querySelector('.pricing-page');
  if (!root) return;

  const hrefKontak = '/#89fk39';

  // Skeleton tampil lebih dulu — sebelum permintaan jaringan dikirim.
  // Kalau menunggu dulu, ada jeda kosong yang justru itulah masalahnya.
  tampilkanSkeleton(root);

  try {
    const data = await ambilData();

    // ── Judul ────────────────────────────────────────────────────────────
    // Ditulis dari data supaya judul dan isinya tidak bisa berbeda.
    const j = data.judul ?? {};
    const setTeks = (sel, teks) => {
      const node = root.querySelector(sel);
      if (node && teks) node.textContent = teks;
    };

    setTeks('#judulUtama', j.title);
    setTeks('#judulSub', j.sub);
    setTeks('#judulTabel', j.judulTabel);
    setTeks('#subTabel', j.subTabel);
    setTeks('#judulFaq', j.judulFaq);
    setTeks('#subFaq', j.subFaq);
    setTeks('#judulCta', j.ctaJudul);
    setTeks('#subCta', j.ctaSub);

    // ── Kartu + toggle periode ───────────────────────────────────────────
    //
    // Saat periode diganti, hanya KARTU yang digambar ulang — judul, FAQ,
    // dan bagian lain tidak disentuh. Menggambar ulang seluruh halaman akan
    // membuat fokus keyboard hilang dan pembaca layar kehilangan posisinya.
    const grid = root.querySelector('#wadahKartu');
    const wadahToggle = root.querySelector('#wadahPeriode');

    let periodeAktif = data.periode?.default ?? 'bulanan';

    const gambarKartuSemua = () => {
      if (!grid) return;
      grid.className = 'harga-grid';
      grid.replaceChildren(
        ...data.paket.map((p) => gambarKartu(p, hrefKontak, periodeAktif)),
      );
    };

    if (wadahToggle && data.periode?.opsi?.length) {
      wadahToggle.replaceChildren(
        gambarToggle(data.periode, data.paket, (id) => {
          periodeAktif = id;
          gambarKartuSemua();
        }),
      );
    }

    gambarKartuSemua();

    // ── Pasang penanganan klik ───────────────────────────────────────────────
    // Delegasi ke grid, jadi tetap bekerja setelah kartu digambar ulang saat
    // periode berganti — tidak perlu dipasang ulang setiap kali.
    pasangKartuAktif(grid);

    // ── FAQ ──────────────────────────────────────────────────────────────
    const wadahFaq = root.querySelector('#wadahFaq');
    if (wadahFaq) wadahFaq.replaceChildren(gambarFaq(data, hrefKontak));

    // Tandai selesai.
    //
    // `aria-busy="false"` penting: pembaca layar memakai atribut ini untuk
    // tahu kapan berhenti menunggu. Tanpa ini, mereka bisa terus mengumumkan
    // "sedang memuat" walaupun isinya sudah tampil.
    root.dataset.siap = 'true';
    for (const sel of ['#wadahKartu', '#wadahFaq']) {
      root.querySelector(sel)?.setAttribute('aria-busy', 'false');
    }
  } catch (err) {
    const pesan = err?.name === 'AbortError'
      ? 'Server tidak menjawab dalam 8 detik.'
      : (err?.message ?? 'Terjadi kesalahan yang tidak diketahui.');
    tampilkanError(root, pesan);
    root.dataset.gagal = 'true';
    for (const sel of ['#wadahKartu', '#wadahFaq']) {
      root.querySelector(sel)?.setAttribute('aria-busy', 'false');
    }
  }
}

// Jalankan setelah DOM siap. `defer` pada tag script sudah menjamin ini,
// tapi pemeriksaan ini membuat modulnya aman dipakai dengan cara lain juga.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
