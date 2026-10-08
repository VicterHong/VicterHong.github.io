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
function formatHarga(paket) {
  if (paket.harga == null) {
    return { angka: paket.teksHarga ?? 'Sesuai kebutuhan', teks: true };
  }
  return { angka: `Rp ${paket.harga}`, teks: false };
}

function gambarKartu(paket, hrefKontak) {
  const kartu = el('div', `harga-kartu${paket.unggulan ? ' harga-kartu--unggulan' : ''}`);

  if (paket.lencana) {
    kartu.appendChild(el('span', 'harga-lencana', paket.lencana));
  }

  const kepala = el('div', 'harga-kepala');
  kepala.appendChild(el('h2', 'harga-nama', paket.nama));
  kepala.appendChild(el('p', 'harga-desc', paket.deskripsi));

  const { angka, teks } = formatHarga(paket);
  const wrap = el('div', 'harga-angka-wrap');
  const spanAngka = el('span', `harga-angka${teks ? ' harga-angka--teks' : ''}`, angka);
  wrap.appendChild(spanAngka);
  if (paket.satuan) wrap.appendChild(el('span', 'harga-periode', paket.satuan));
  kepala.appendChild(wrap);

  if (paket.catatan) kepala.appendChild(el('p', 'harga-catatan', paket.catatan));
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

function gambarTabel(data) {
  const wrap = el('div', 'tabel-wrap');
  const table = el('table', 'tabel-banding');

  // ── PETUNJUK GULIR ────────────────────────────────────────────────────────
  // Di ponsel, tabel 4 kolom tidak muat — pengguna hanya melihat kolom
  // pertama dan satu kolom paket. Tanpa petunjuk, mereka mengira datanya
  // memang cuma itu, dan tidak pernah mencoba menggeser.
  //
  // Petunjuknya hanya muncul kalau tabel MEMANG bisa digulir. Di desktop,
  // tabelnya muat penuh — dan petunjuk "geser" di sana hanya membingungkan.
  //
  // `aria-hidden` karena ini petunjuk visual. Pembaca layar sudah bisa
  // menelusuri seluruh sel tabel tanpa perlu digulir.
  const petunjuk = el('p', 'tabel-petunjuk');
  petunjuk.setAttribute('aria-hidden', 'true');

  const svgPetunjuk = document.createElementNS(NS, 'svg');
  svgPetunjuk.setAttribute('width', '14');
  svgPetunjuk.setAttribute('height', '14');
  svgPetunjuk.setAttribute('viewBox', '0 0 24 24');
  svgPetunjuk.setAttribute('fill', 'none');
  svgPetunjuk.setAttribute('stroke', 'currentColor');
  svgPetunjuk.setAttribute('stroke-width', '2');
  svgPetunjuk.setAttribute('stroke-linecap', 'round');
  svgPetunjuk.setAttribute('stroke-linejoin', 'round');
  const pp1 = document.createElementNS(NS, 'path');
  pp1.setAttribute('d', 'M5 12h14');
  const pp2 = document.createElementNS(NS, 'path');
  pp2.setAttribute('d', 'm13 6 6 6-6 6');
  svgPetunjuk.append(pp1, pp2);

  petunjuk.append(svgPetunjuk, document.createTextNode(' Geser tabel untuk melihat paket lain'));

  const caption = el('caption', null, `Perbandingan fitur paket ${data.kolom.map((k) => k.nama).join(', ')}`);
  table.appendChild(caption);

  // Kepala
  const thead = el('thead');
  const trHead = el('tr');
  trHead.appendChild(el('th', null, 'Fitur')).setAttribute('scope', 'col');

  for (const k of data.kolom) {
    const th = el('th', k.unggulan ? 'kolom-unggulan' : null, k.nama);
    th.setAttribute('scope', 'col');
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  table.appendChild(thead);

  // Isi
  const tbody = el('tbody');
  for (const baris of data.tabel ?? []) {
    // Baris pemisah bagian
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
        span.appendChild(nilai ? ikon(JALUR_CEK, 11, 4) : ikon(JALUR_STRIP, 11, 4, false));

        // Pembaca layar tidak bisa membaca ikon — beri teksnya.
        // Bukan `display:none`, itu akan menghilangkannya dari
        // accessibility tree — kebalikan dari yang dibutuhkan.
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

  wrap.appendChild(petunjuk);
  wrap.appendChild(table);
  return wrap;
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
  const tabel = root.querySelector('#wadahTabel');
  const faq = root.querySelector('#wadahFaq');

  if (grid) {
    grid.className = 'harga-grid';
    grid.replaceChildren(skeletonKartu(), skeletonKartu(), skeletonKartu());
  }
  if (tabel) tabel.replaceChildren(skeletonTabel());
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

  const tabel = root.querySelector('#wadahTabel');
  if (tabel) tabel.replaceChildren();
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

    setTeks('#judulEyebrow', j.eyebrow);
    setTeks('#judulUtama', j.title);
    setTeks('#judulSub', j.sub);
    setTeks('#judulTabel', j.judulTabel);
    setTeks('#subTabel', j.subTabel);
    setTeks('#judulFaq', j.judulFaq);
    setTeks('#subFaq', j.subFaq);
    setTeks('#judulCta', j.ctaJudul);
    setTeks('#subCta', j.ctaSub);

    // ── Kartu ────────────────────────────────────────────────────────────
    const grid = root.querySelector('#wadahKartu');
    if (grid) {
      grid.className = 'harga-grid';
      grid.replaceChildren(...data.paket.map((p) => gambarKartu(p, hrefKontak)));
    }

    // ── Tabel ────────────────────────────────────────────────────────────
    const wadahTabel = root.querySelector('#wadahTabel');
    if (wadahTabel) wadahTabel.replaceChildren(gambarTabel(data));

    // ── FAQ ──────────────────────────────────────────────────────────────
    const wadahFaq = root.querySelector('#wadahFaq');
    if (wadahFaq) wadahFaq.replaceChildren(gambarFaq(data, hrefKontak));

    // Tandai selesai.
    //
    // `aria-busy="false"` penting: pembaca layar memakai atribut ini untuk
    // tahu kapan berhenti menunggu. Tanpa ini, mereka bisa terus mengumumkan
    // "sedang memuat" walaupun isinya sudah tampil.
    root.dataset.siap = 'true';
    for (const sel of ['#wadahKartu', '#wadahTabel', '#wadahFaq']) {
      root.querySelector(sel)?.setAttribute('aria-busy', 'false');
    }
  } catch (err) {
    const pesan = err?.name === 'AbortError'
      ? 'Server tidak menjawab dalam 8 detik.'
      : (err?.message ?? 'Terjadi kesalahan yang tidak diketahui.');
    tampilkanError(root, pesan);
    root.dataset.gagal = 'true';
    for (const sel of ['#wadahKartu', '#wadahTabel', '#wadahFaq']) {
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
