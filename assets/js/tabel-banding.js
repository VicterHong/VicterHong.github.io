/**
 * Tabel perbandingan paket — memuat data dan menggambarnya.
 *
 * ── KENAPA MODUL TERPISAH ──────────────────────────────────────────────────
 * Tabel ini dipakai di halaman PANDUAN. Halaman Harga hanya menampilkan
 * info paket (kartu + FAQ) tanpa tabel perbandingan.
 *
 * Dua halaman, satu sumber data: /api/pricing. Kalau harga berubah di
 * backend, tabel di panduan ikut berubah — tanpa ada angka yang perlu
 * disunting di dua tempat.
 *
 * ── CARA PAKAI ─────────────────────────────────────────────────────────────
 *   1. Muat CSS:  <link rel="stylesheet" href="assets/css/tabel-banding.css">
 *   2. Sediakan wadah: <div id="wadahTabel" aria-busy="true"></div>
 *   3. Muat skrip: <script type="module" src="assets/js/tabel-banding.js"></script>
 *
 * Skrip mencari wadahnya sendiri lewat id — tidak perlu dipanggil manual.
 * Kalau wadahnya tidak ada, skripnya diam (aman dimuat di halaman mana pun).
 */

const JALUR_API = '/api/pricing';
const TIMEOUT_MS = 8000;

/** Halaman kontak — tujuan semua tautan ajakan. */
const HREF_KONTAK = '/#89fk39';

const NS = 'http://www.w3.org/2000/svg';
const JALUR_CEK = 'M20 6 9 17l-5-5';
const JALUR_STRIP = 'M5 12h14';

/* ── Pembuat elemen ─────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = teks;
  return node;
}

function ikon(jalur, ukuran = 11, tebal = 4, bulat = true) {
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

/** Panah keluar — dua elemen, bukan satu path dengan dua `M`. */
function panahKeluar() {
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
  return svg;
}

function tombol(teks, gaya, href) {
  const a = el('a', `tombol tombol--${gaya}`);
  a.href = href;
  a.append(teks, ' ', panahKeluar());
  return a;
}

/* ── Ambil data ─────────────────────────────────────────────────────────── */

async function ambilData() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(JALUR_API, {
      signal: ctl.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`Server menjawab ${res.status}`);

    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.paket)) {
      throw new Error('Bentuk data tidak dikenali');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Gambar tabel ───────────────────────────────────────────────────────── */

function gambarTabel(data) {
  const wrap = el('div', 'tabel-wrap');
  const table = el('table', 'tabel-banding');

  // Judul tabel — untuk pembaca layar. Pengguna yang melihat sudah punya
  // judul bagian di atasnya, jadi tidak perlu diulang.
  const caption = el('caption', null,
    `Perbandingan fitur paket ${data.kolom.map((k) => k.nama).join(', ')}`);
  table.appendChild(caption);

  // ── Kepala ──
  const thead = el('thead');
  const trHead = el('tr');

  const thFitur = el('th', null, 'Fitur');
  thFitur.setAttribute('scope', 'col');
  trHead.appendChild(thFitur);

  for (const k of data.kolom) {
    const th = el('th', k.unggulan ? 'kolom-unggulan' : null, k.nama);
    th.setAttribute('scope', 'col');
    trHead.appendChild(th);
  }

  thead.appendChild(trHead);
  table.appendChild(thead);

  // ── Isi ──
  const tbody = el('tbody');

  for (const baris of data.tabel ?? []) {
    // Baris pemisah bagian — bukan fitur, hanya judul pengelompokan.
    if (baris.bagian) {
      const tr = el('tr', 'baris-bagian');
      const td = el('td', null, baris.bagian);
      td.colSpan = data.kolom.length + 1;
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }

    const tr = el('tr');
    tr.appendChild(el('td', null, baris.fitur));

    for (let i = 0; i < data.kolom.length; i++) {
      const k = data.kolom[i];
      const nilai = baris.nilai?.[i];
      const td = el('td', k.unggulan ? 'kolom-unggulan' : null);

      if (nilai === true || nilai === false) {
        const span = el('span', nilai ? 'tabel-cek' : 'tabel-strip');
        span.setAttribute('aria-hidden', 'true');
        span.appendChild(nilai ? ikon(JALUR_CEK) : ikon(JALUR_STRIP, 11, 4, false));

        // Pembaca layar tidak bisa membaca ikon — beri teksnya.
        const sr = el('span', 'sr-only', nilai ? 'Termasuk' : 'Tidak termasuk');

        td.append(span, sr);
      } else {
        td.appendChild(el('span', 'tabel-teks', String(nilai ?? '—')));
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);

  // ── Petunjuk gulir ──
  // Di ponsel, tabel 4 kolom tidak muat — pengguna hanya melihat kolom
  // pertama dan satu kolom paket. Tanpa petunjuk, mereka mengira datanya
  // memang cuma itu, dan tidak pernah mencoba menggeser.
  //
  // `aria-hidden` karena ini petunjuk visual. Pembaca layar sudah bisa
  // menelusuri seluruh sel tanpa perlu digulir.
  const petunjuk = el('p', 'tabel-petunjuk');
  petunjuk.setAttribute('aria-hidden', 'true');
  petunjuk.appendChild(ikon('M5 12h14 M13 6l6 6-6 6', 14, 2, true));
  petunjuk.appendChild(document.createTextNode(' Geser tabel untuk melihat paket lain'));

  wrap.append(petunjuk, table);
  return wrap;
}

/** Catatan + ajakan di bawah tabel. */
function gambarAksi(data) {
  const frag = document.createDocumentFragment();

  // Cari paket unggulan — ajakannya mengarah ke sana.
  const unggulan = data.paket.find((p) => p.unggulan) ?? data.paket[0];

  const aksi = el('div', 'tabel-aksi');
  aksi.appendChild(tombol(
    unggulan ? `Mulai dengan ${unggulan.nama}` : 'Mulai dari sini',
    'utama',
    HREF_KONTAK,
  ));
  aksi.appendChild(tombol('Lihat halaman harga', 'sekunder', '/pricing'));

  const catatan = el('p', 'tabel-catatan');
  catatan.textContent = 'Bisa berhenti kapan saja. Tidak ada biaya tersembunyi.';

  frag.append(aksi, catatan);
  return frag;
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

function skeletonTabel() {
  const wrap = el('div', 'tabel-wrap');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'padding:0.5rem 0;';

  for (let i = 0; i < 8; i++) {
    const baris = el('div', 'sk-tabel-baris');
    for (let j = 0; j < 4; j++) {
      const d = el('div', `skeleton ${j === 0 ? 'sk-teks' : 'sk-teks-sm'}`);
      d.style.width = j === 0 ? '80%' : '40%';
      if (j > 0) d.style.marginInline = 'auto';
      baris.appendChild(d);
    }
    wrap.appendChild(baris);
  }
  return wrap;
}

/* ── Masuk ──────────────────────────────────────────────────────────────── */

async function mulai() {
  const wadah = document.getElementById('wadahTabel');
  if (!wadah) return;  // halaman ini tidak memakai tabel

  wadah.replaceChildren(skeletonTabel());

  try {
    const data = await ambilData();
    wadah.replaceChildren(gambarTabel(data), gambarAksi(data));
    wadah.setAttribute('aria-busy', 'false');
    wadah.dataset.siap = 'true';
  } catch (err) {
    // Jangan tampilkan tabel kosong — beri tahu apa yang terjadi, dan
    // sediakan jalan keluar.
    const pesan = err?.name === 'AbortError'
      ? 'Server tidak menjawab dalam 8 detik.'
      : (err?.message ?? 'Terjadi kesalahan yang tidak diketahui.');

    const gagal = el('div', 'tabel-gagal');
    gagal.setAttribute('role', 'alert');
    gagal.append(
      document.createTextNode('Tabel perbandingan sedang tidak bisa dimuat. '),
      document.createTextNode(pesan + ' '),
    );

    const tautan = el('a', null, 'Lihat halaman harga');
    tautan.href = '/pricing';
    gagal.append(tautan, document.createTextNode(' untuk informasi paket.'));

    wadah.replaceChildren(gagal);
    wadah.setAttribute('aria-busy', 'false');
    wadah.dataset.gagal = 'true';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
