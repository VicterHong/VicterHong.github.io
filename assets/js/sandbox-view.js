/**
 * SANDBOX — antarmuka demo yang bisa diklik.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA SANDBOX INI TIDAK MENYENTUH SERVER SAMA SEKALI
 * ══════════════════════════════════════════════════════════════════════════════
 * Ini keputusan keamanan, bukan keputusan teknis.
 *
 * Kalau sandbox mengirim permintaan ke backend, siapa pun bisa mengisi database
 * produksi kita dengan data sampah — dan itu terjadi dari halaman publik yang
 * bisa diakses tanpa login.
 *
 * Jadi seluruh sandbox berjalan di browser: pencarian, pengurutan, dan panel
 * detail semuanya bekerja pada data yang sudah ada di berkas ini. Tidak ada
 * `fetch`, tidak ada `POST`, tidak ada apa pun yang keluar dari halaman.
 *
 * Konsekuensinya: sandbox ini menunjukkan BENTUK antarmukanya, bukan kemampuan
 * sistem sebenarnya. Dan itu dikatakan terus terang ke pengunjung.
 *
 * ── KENAPA TOMBOL YANG TIDAK BEKERJA DIBERI LABEL ───────────────────────────
 * Tombol yang diam tanpa penjelasan membuat pengunjung mengira sistemnya rusak.
 * Yang diberi label "contoh" membuatnya tahu itu batas demo — bukan bug.
 */

import {
  contohParts,
  contohMovements,
  ringkasDemo,
  PEMBERITAHUAN_SANDBOX,
  aksiBekerja,
} from './data/sandbox.js';

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

function rupiah(n) {
  return `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
}

/* ── Keadaan ────────────────────────────────────────────────────────────── */

let cari = '';
let urutKolom = 'kode';
let urutNaik = true;

/* ── Pemberitahuan sandbox ──────────────────────────────────────────────── */

function blokPemberitahuan() {
  const kotak = el('div', 'sandbox-notis');

  const kepala = el('div', 'sandbox-notis-kepala');
  kepala.append(el('span', 'sandbox-notis-lencana', 'DEMO'));
  kepala.append(el('strong', 'sandbox-notis-judul', PEMBERITAHUAN_SANDBOX.judul));
  kotak.append(kepala);

  const ul = el('ul', 'sandbox-notis-daftar');
  for (const p of PEMBERITAHUAN_SANDBOX.poin) {
    ul.append(el('li', null, p));
  }
  kotak.append(ul);

  return kotak;
}

/* ── Kartu ringkasan ────────────────────────────────────────────────────── */

function kartuRingkasan(r) {
  const baris = el('div', 'sandbox-kartu-baris');

  const kartu = [
    { label: 'Jenis barang', nilai: String(r.jumlahJenis), kelas: '' },
    { label: 'Kategori', nilai: String(r.kategori), kelas: '' },
    { label: 'Nilai stok', nilai: rupiah(r.totalNilai), kelas: '' },
    {
      label: 'Perlu restock',
      nilai: String(r.menipis),
      // ── KENAPA INI DISOROT ────────────────────────────────────────────────
      // Ini fitur yang paling terasa manfaatnya, dan yang tidak bisa dilakukan
      // spreadsheet dengan baik: memberi tahu saat ada yang perlu ditindak.
      kelas: r.menipis > 0 ? 'sandbox-angka--peringatan' : 'sandbox-angka--aman',
    },
  ];

  for (const k of kartu) {
    const kotak = el('div', 'sandbox-kartu');
    kotak.append(el('span', 'sandbox-kartu-label', k.label));
    kotak.append(el('strong', `sandbox-kartu-angka ${k.kelas}`, k.nilai));
    baris.append(kotak);
  }

  return baris;
}

/* ── Tabel barang ───────────────────────────────────────────────────────── */

function saringDanUrutkan() {
  let daftar = [...contohParts];

  // Pencarian — nama, kode, atau kategori.
  if (cari.trim()) {
    const q = cari.trim().toLowerCase();
    daftar = daftar.filter((p) => (
      p.nama.toLowerCase().includes(q)
      || p.kode.toLowerCase().includes(q)
      || p.kategori.toLowerCase().includes(q)
    ));
  }

  // Pengurutan.
  daftar.sort((a, b) => {
    const va = a[urutKolom];
    const vb = b[urutKolom];

    let hasil;
    if (typeof va === 'number' && typeof vb === 'number') hasil = va - vb;
    else hasil = String(va).localeCompare(String(vb), 'id');

    return urutNaik ? hasil : -hasil;
  });

  return daftar;
}

function tabelBarang(onDetail) {
  const wrap = el('div', 'sandbox-tabel-wrap');
  const tabel = el('table', 'sandbox-tabel');

  const thead = el('thead');
  const trh = el('tr');

  const kolom = [
    { id: 'kode', label: 'Kode' },
    { id: 'nama', label: 'Nama barang' },
    { id: 'kategori', label: 'Kategori' },
    { id: 'stok', label: 'Stok' },
    { id: 'min', label: 'Minimum' },
    { id: 'harga', label: 'Harga satuan' },
  ];

  for (const k of kolom) {
    const th = el('th');
    const tombol = el('button', 'sandbox-urut', k.label);
    tombol.type = 'button';

    // Penanda kolom yang sedang jadi urutan.
    if (urutKolom === k.id) {
      tombol.append(el('span', 'sandbox-urut-panah', urutNaik ? '↑' : '↓'));
    }

    tombol.addEventListener('click', () => {
      if (urutKolom === k.id) urutNaik = !urutNaik;
      else { urutKolom = k.id; urutNaik = true; }
      onDetail(null, true); // gambar ulang
    });

    th.append(tombol);
    trh.append(th);
  }

  thead.append(trh);
  tabel.append(thead);

  const tbody = el('tbody');
  const daftar = saringDanUrutkan();

  if (!daftar.length) {
    const tr = el('tr');
    const td = el('td', 'sandbox-kosong');
    td.colSpan = 6;
    td.textContent = `Tidak ada barang yang cocok dengan "${cari}".`;
    tr.append(td);
    tbody.append(tr);
  }

  for (const p of daftar) {
    const tr = el('tr');
    if (p.stok < p.min) tr.className = 'sandbox-baris--menipis';

    tr.append(el('td', 'sandbox-mono', p.kode));
    tr.append(el('td', null, p.nama));
    tr.append(el('td', null, p.kategori));

    const tdStok = el('td', 'sandbox-mono');
    tdStok.textContent = `${p.stok} ${p.satuan}`;
    if (p.stok < p.min) tdStok.className = 'sandbox-mono sandbox-stok--menipis';
    tr.append(tdStok);

    tr.append(el('td', 'sandbox-mono', String(p.min)));
    tr.append(el('td', 'sandbox-mono', rupiah(p.harga)));

    // ── BARIS BISA DIKLIK ────────────────────────────────────────────────────
    // Ini aksi yang benar-benar bekerja, jadi barisnya dibuat bisa diklik.
    //
    // aria-label SENGAJA tidak dipakai di sini. axe-core menandainya sebagai
    // `label-content-name-mismatch`: label "Lihat detail Bearing 6204" tidak
    // memuat seluruh teks yang terlihat di baris (kode, kategori, stok, harga),
    // dan pembaca layar mengucapkan dua nama berbeda untuk elemen yang sama.
    // Nama aksesibel kini diambil dari isi baris itu sendiri — sudah deskriptif,
    // dan hint tindakan dipindah ke `title` (tidak menimpa nama).
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.title = `Lihat detail ${p.nama}`;
    tr.addEventListener('click', () => onDetail(p));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onDetail(p);
      }
    });

    tbody.append(tr);
  }

  tabel.append(tbody);
  wrap.append(tabel);
  return wrap;
}

/* ── Panel detail ───────────────────────────────────────────────────────── */

function panelDetail(p) {
  const kotak = el('div', 'sandbox-detail');

  const kepala = el('div', 'sandbox-detail-kepala');
  kepala.append(el('strong', 'sandbox-detail-nama', p.nama));
  kepala.append(el('span', 'sandbox-mono', p.kode));
  kotak.append(kepala);

  const dl = el('dl', 'sandbox-detail-daftar');
  const baris = [
    ['Kategori', p.kategori],
    ['Stok sekarang', `${p.stok} ${p.satuan}`],
    ['Stok minimum', `${p.min} ${p.satuan}`],
    ['Harga satuan', rupiah(p.harga)],
    ['Nilai stok', rupiah(p.stok * p.harga)],
  ];

  for (const [label, nilai] of baris) {
    const d = el('div', 'sandbox-detail-baris');
    d.append(el('dt', 'sandbox-detail-label', label));
    d.append(el('dd', 'sandbox-detail-nilai', nilai));
    dl.append(d);
  }
  kotak.append(dl);

  // ── RIWAYAT PERGERAKAN ────────────────────────────────────────────────────
  // Bagian ini menjelaskan KENAPA stoknya sekarang segini — dan itu yang
  // membedakannya dari sekadar angka di spreadsheet.
  const gerak = contohMovements.filter((m) => m.kode === p.kode);
  kotak.append(el('p', 'sandbox-detail-subjudul', 'Pergerakan terakhir'));

  if (!gerak.length) {
    kotak.append(el('p', 'sandbox-detail-kosong', 'Belum ada pergerakan tercatat untuk barang ini.'));
  } else {
    const ul = el('ul', 'sandbox-gerak');
    for (const m of gerak) {
      const li = el('li', `sandbox-gerak-item sandbox-gerak-item--${m.jenis}`);
      li.append(el('span', 'sandbox-gerak-jenis', m.jenis === 'masuk' ? '+' : '−'));
      li.append(el('span', 'sandbox-gerak-jumlah', `${m.jumlah} ${p.satuan}`));
      li.append(el('span', 'sandbox-gerak-catatan', `${m.catatan} · ${m.oleh} · ${m.tanggal}`));
      ul.append(li);
    }
    kotak.append(ul);
  }

  // ── AKSI YANG TIDAK BEKERJA ───────────────────────────────────────────────
  // Diberi label "contoh" supaya jelas ini batas demo, bukan tombol rusak.
  const aksi = el('div', 'sandbox-detail-aksi');

  for (const label of ['Tambah stok', 'Kurangi stok', 'Ubah data']) {
    const b = el('button', 'sandbox-tombol sandbox-tombol--contoh');
    b.type = 'button';
    b.disabled = true;
    b.append(label, ' ', el('span', 'sandbox-lencana-contoh', 'contoh'));
    b.title = 'Aksi ini tidak bekerja di demo — di sistem sungguhan, ia menulis ke database.';
    aksi.append(b);
  }

  kotak.append(aksi);

  return kotak;
}

/* ── Pemasangan ─────────────────────────────────────────────────────────── */

/**
 * Pasang sandbox.
 *
 * @param {string} idHost  id elemen tempat sandbox dipasang
 */
export function pasangSandbox(idHost = 'sandboxHost') {
  const host = document.getElementById(idHost);
  if (!host) return;

  host.replaceChildren();

  host.append(blokPemberitahuan());

  const r = ringkasDemo();
  host.append(kartuRingkasan(r));

  // ── KOLOM PENCARIAN ───────────────────────────────────────────────────────
  const alat = el('div', 'sandbox-alat');

  const input = el('input', 'sandbox-cari');
  input.type = 'search';
  input.placeholder = 'Cari nama, kode, atau kategori…';
  input.setAttribute('aria-label', 'Cari barang');
  alat.append(input);

  host.append(alat);

  // ── WADAH TABEL & DETAIL ──────────────────────────────────────────────────
  const wadahTabel = el('div', 'sandbox-wadah-tabel');
  const wadahDetail = el('div', 'sandbox-wadah-detail');
  host.append(wadahTabel);
  host.append(wadahDetail);

  let barangTerpilih = null;

  function gambar() {
    wadahTabel.replaceChildren(
      tabelBarang((p, ulangSaja) => {
        if (ulangSaja) { gambar(); return; }
        barangTerpilih = barangTerpilih?.kode === p.kode ? null : p;
        gambar();
      }),
    );

    wadahDetail.replaceChildren();

    if (barangTerpilih) {
      wadahDetail.append(panelDetail(barangTerpilih));
    } else {
      wadahDetail.append(el(
        'p',
        'sandbox-detail-petunjuk',
        'Klik baris mana pun untuk melihat detail dan riwayat pergerakannya.',
      ));
    }
  }

  input.addEventListener('input', () => {
    cari = input.value;
    gambar();
  });

  gambar();
}
