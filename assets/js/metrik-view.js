/**
 * METRIK TERVERIFIKASI — tampilan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA SETIAP ANGKA MENAMPILKAN CARA MEMERIKSA
 * ══════════════════════════════════════════════════════════════════════════════
 * Portofolio yang menyebut "231 tes" harus bisa dibuktikan. Kalau angkanya
 * hanya ditulis, pengunjung harus percaya — dan permintaan untuk percaya
 * adalah kebalikan dari bukti.
 *
 * Jadi setiap metrik menampilkan perintah atau lokasi yang bisa dibuka
 * pengunjung untuk memeriksanya sendiri.
 *
 * ── KENAPA TIDAK ADA "DAMPAK BISNIS" DI SINI ────────────────────────────────
 * "Menghemat 12 jam per minggu" mengandaikan kita tahu berapa jam yang dipakai
 * SEBELUM sistemnya — dan kita tidak tahu. Tidak ada klien, tidak ada
 * pengukuran sebelum/sesudah.
 *
 * Menulisnya berarti mengarang. Dan satu angka karangan merusak seluruh
 * halaman: pengunjung yang menemukan satu klaim palsu akan meragukan 231 tes
 * yang asli juga.
 *
 * Untuk hitungan penghematan, ada kalkulator di halaman harga — ia menghitung
 * dari angka yang diketik pengunjung sendiri, jadi tidak ada yang perlu
 * dipercaya.
 */

import { metrikProyek, catatanMetrik } from './data/metrik.js';

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

/* ── Lencana jenis metrik ───────────────────────────────────────────────── */

/**
 * Jenis metrik menentukan nada yang ditampilkan.
 *
 * ── KENAPA DIBEDAKAN ────────────────────────────────────────────────────────
 * Ada dua sumber angka di sini, dan keduanya tidak sama kuatnya:
 *
 *   terukur     → saya hitung sendiri dari kode yang ada
 *   klaim-repo  → tertulis di README repo, saya belum menghitungnya sendiri
 *
 * Membedakannya membuat pengunjung tahu mana yang bisa ia verifikasi langsung
 * dan mana yang perlu ia buka reponya. Menyamakan keduanya akan melebih-
 * lebihkan yang kedua.
 */
function lencanaJenis(jenis) {
  if (jenis === 'terukur') {
    return el('span', 'metrik-lencana metrik-lencana--terukur', 'saya ukur');
  }
  return el('span', 'metrik-lencana metrik-lencana--repo', 'dari repo');
}

/* ── Render satu proyek ─────────────────────────────────────────────────── */

function kartuProyek(slug, data) {
  const kartu = el('article', 'metrik-kartu');

  const kepala = el('div', 'metrik-kepala');
  kepala.append(el('h3', 'metrik-nama', slug === 'sentinel' ? 'Portofolio ini' : slug.toUpperCase()));
  kepala.append(el('span', 'metrik-commit', data.commit));
  kartu.append(kepala);

  kartu.append(el('p', 'metrik-ringkas', data.ringkas));

  // ── DAFTAR METRIK ─────────────────────────────────────────────────────────
  const daftar = el('div', 'metrik-daftar');

  for (const m of data.metrik) {
    const baris = el('div', 'metrik-baris');

    const kiri = el('div', 'metrik-baris-kiri');
    kiri.append(el('span', 'metrik-nilai', m.nilai));
    kiri.append(el('span', 'metrik-label', m.label));
    baris.append(kiri);

    baris.append(lencanaJenis(m.jenis));

    daftar.append(baris);

    // ── CARA MEMERIKSA — SELALU DITAMPILKAN ─────────────────────────────────
    // Ini inti dari bagian ini. Tanpa perintahnya, angkanya sama saja dengan
    // klaim yang tidak bisa diperiksa.
    daftar.append(el('p', 'metrik-sumber', m.sumber));
  }

  kartu.append(daftar);

  // ── TAUTAN REPO ───────────────────────────────────────────────────────────
  // ── KENAPA DIKURUNG KALAU TIDAK ADA ───────────────────────────────────────
  // Sebagian repo privat. Tautan ke repo privat mendarat di 404 — dan itu
  // pengalaman rusak yang hanya ketahuan saat tautannya benar-benar diklik.
  if (data.repo) {
    const a = el('a', 'metrik-repo', 'Buka repo');
    a.href = data.repo;
    a.target = '_blank';
    a.rel = 'noopener';
    kartu.append(a);
  }

  return kartu;
}

/* ── Catatan kejujuran ──────────────────────────────────────────────────── */

function blokCatatan() {
  const kotak = el('div', 'metrik-catatan');

  kotak.append(el('h3', 'metrik-catatan-judul', catatanMetrik.judul));

  const ul = el('ul', 'metrik-catatan-daftar');
  for (const p of catatanMetrik.poin) {
    ul.append(el('li', null, p));
  }
  kotak.append(ul);

  return kotak;
}

/* ── Pemasangan ─────────────────────────────────────────────────────────── */

/**
 * Pasang bagian metrik ke halaman.
 *
 * @param {string} idHost  id elemen tempat bagian ini dipasang
 */
export function pasangMetrik(idHost = 'metrikHost') {
  const host = document.getElementById(idHost);
  if (!host) return;

  host.replaceChildren();

  const grid = el('div', 'metrik-grid');
  for (const [slug, data] of Object.entries(metrikProyek)) {
    grid.append(kartuProyek(slug, data));
  }
  host.append(grid);

  host.append(blokCatatan());
}
