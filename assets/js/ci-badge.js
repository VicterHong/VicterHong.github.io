/**
 * BADGE CI — status pipeline dari data nyata.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * APA YANG DITAMPILKAN
 * ══════════════════════════════════════════════════════════════════════════════
 * Status workflow TERAKHIR dari GitHub: lulus atau gagal, commit mana yang
 * diuji, berapa lama build-nya, dan kapan terakhir jalan.
 *
 * Angka "1.428 tes otomatis" di halaman ini tidak bisa diperiksa pengunjung.
 * Badge ini membuatnya bisa diperiksa: ia menunjukkan bahwa tesnya BENAR-BENAR
 * dijalankan, bukan hanya dihitung sekali lalu ditulis.
 *
 * ── KENAPA KEGAGALAN TETAP DITAMPILKAN, BUKAN DISEMBUNYIKAN ──────────────────
 * Ini bagian yang menentukan apakah badge-nya layak dipercaya.
 *
 * Badge yang hanya muncul saat CI lulus adalah badge yang TIDAK BISA GAGAL —
 * dan badge yang tidak bisa gagal tidak membuktikan apa pun. Ia hanya hiasan
 * yang bentuknya menyerupai bukti.
 *
 * Jadi kalau build terakhir gagal, itu yang ditampilkan. Kalau GitHub tidak
 * bisa dihubungi, itu juga yang ditampilkan.
 *
 * ── LOGIKA DI ci-badge-keadaan.js ───────────────────────────────────────────
 * Berkas ini hanya mengurus DOM. Penentuan keadaan dan format waktu ada di
 * berkas terpisah supaya bisa diuji di Node tanpa browser.
 */

import { keadaanBadge, bagianRincian } from './ci-badge-keadaan.js';

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

/* ── Render ─────────────────────────────────────────────────────────────── */

function gambar(data) {
  const host = document.getElementById('ciBadge');
  if (!host) return;

  const keadaan = keadaanBadge(data);
  host.replaceChildren();
  host.className = `ci-badge ci-badge--${keadaan.jenis}`;

  // ── BARIS UTAMA: TITIK + LABEL ─────────────────────────────────────────────
  const utama = el('div', 'ci-badge-utama');

  const titik = el('span', 'ci-badge-titik');
  titik.setAttribute('aria-hidden', 'true');
  utama.append(titik);

  utama.append(el('span', 'ci-badge-label', keadaan.label));

  // ── TAUTAN KE RUN — SELALU ADA KALAU DATANYA ADA ───────────────────────────
  // Ini yang membuat badge bisa diperiksa: pengunjung bisa membuka Actions dan
  // melihat sendiri bahwa tesnya benar-benar jalan.
  if (data?.tautan) {
    const a = el('a', 'ci-badge-tautan', 'lihat di GitHub');
    a.href = data.tautan;
    a.target = '_blank';
    a.rel = 'noopener';
    utama.append(a);
  }

  host.append(utama);

  // ── BARIS RINCIAN ─────────────────────────────────────────────────────────
  if (data?.ok) {
    const bagian = bagianRincian(data);
    if (bagian.length) {
      host.append(el('div', 'ci-badge-rincian', bagian.join(' · ')));
    }

    // ── JUDUL COMMIT — DIKURUNG HANYA KALAU ADA ─────────────────────────────
    // Judul commit memuat pesan yang menjelaskan APA yang diuji. Itu bukti
    // tambahan bahwa pipeline ini nyata, bukan badge statis.
    if (data.judulCommit) {
      host.append(el('div', 'ci-badge-commit', data.judulCommit));
    }
  } else if (keadaan.keterangan) {
    host.append(el('div', 'ci-badge-rincian', keadaan.keterangan));
  }
}

/* ── Mulai ──────────────────────────────────────────────────────────────── */

async function mulai() {
  const host = document.getElementById('ciBadge');
  if (!host) return;

  // Keadaan awal: supaya tidak ada ruang kosong yang tiba-tiba terisi.
  host.className = 'ci-badge ci-badge--memuat';
  host.append(el('span', 'ci-badge-label', 'Memeriksa pipeline…'));

  try {
    const res = await fetch('/api/ci/status', { headers: { accept: 'application/json' } });
    const data = await res.json();
    gambar(data);
  } catch {
    // ── KEGAGALAN JARINGAN KE SERVER KITA SENDIRI ────────────────────────────
    // Ini berbeda dari "GitHub tidak bisa dihubungi" — yang gagal adalah
    // permintaan dari browser ke server kita. Penyebabnya bisa jaringan
    // pengunjung, atau server kita sedang mati.
    gambar({
      ok: false,
      pesan: 'Tidak bisa menghubungi server. Coba muat ulang halaman.',
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mulai, { once: true });
  } else {
    mulai();
  }
}
