/**
 * Halaman pesanan — menampilkan status pembayaran setelah kembali dari Midtrans.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DARI MANA NOMOR PESANAN DIAMBIL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Midtrans mengembalikan pembeli ke halaman ini (callbacks.finish =
 * CHECKOUT_SUKSES_URL) dan menambahkan parameter transaksinya sendiri ke URL.
 * Bentuknya bisa berbeda antar kanal pembayaran — karena itu nomornya dicari
 * dengan urutan:
 *
 *   1. `order_id`  — bentuk yang paling umum
 *   2. `orderId`   — sebagian kanal memakai camelCase
 *   3. sessionStorage `pesanan_terakhir` — disimpan halaman harga SEBELUM
 *      pembeli dikirim ke Midtrans. Ini jaring pengaman kalau URL kembali
 *      tidak memuat nomor sama sekali (mis. pembeli menekan tombol kembali
 *      di browser alih-alih tombol "selesai" di halaman Midtrans).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA STATUS DIAMBIL DARI SERVER, BUKAN DARI URL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Parameter `status=sukses` di URL adalah PETUNJUK, bukan bukti — siapa pun
 * bisa mengetiknya. Yang menentukan adalah `status` dari
 * GET /api/pesanan/:id, yang dibaca dari database yang sudah diperbarui
 * webhook Midtrans. Halaman ini menampilkan apa yang dikatakan server.
 *
 * Webhook kadang tiba sedikit SETELAH pembeli kembali. Karena itu status
 * `pending` diperiksa ulang beberapa kali dengan jeda — bukan langsung
 * ditampilkan sebagai "belum dibayar".
 */

const JALUR_API = '/api/pesanan';
const TIMEOUT_MS = 8000;
const PERCOBAAN_ULANG = 4;      // total percobaan saat masih pending
const JEDA_MS = 2500;           // jeda antar percobaan

/* ── Nomor pesanan ──────────────────────────────────────────────────────── */

function nomorPesanan() {
  const p = new URLSearchParams(location.search);
  const dariUrl = p.get('order_id') || p.get('orderId');
  if (dariUrl) return dariUrl.trim();

  try {
    const tersimpan = sessionStorage.getItem('pesanan_terakhir');
    if (tersimpan) return tersimpan.trim();
  } catch { /* storage diblokir — tidak ada cadangan */ }

  return '';
}

/* ── Ambil status ───────────────────────────────────────────────────────── */

async function ambilPesanan(id) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${JALUR_API}/${encodeURIComponent(id)}`, {
      signal: ctl.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return { tidakAda: true };

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || `Server menjawab ${res.status}.`);
    }
    return data.pembayaran;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Pembuat elemen ─────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = teks;
  return node;
}

function rupiah(n) {
  const angka = Number(n);
  if (!Number.isFinite(angka)) return '-';
  return `Rp ${new Intl.NumberFormat('id-ID').format(angka)}`;
}

function tanggal(ms) {
  if (!ms) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'long', timeStyle: 'short',
    }).format(new Date(Number(ms)));
  } catch {
    return '-';
  }
}

/* ── Status ─────────────────────────────────────────────────────────────── */

/**
 * Terjemahan status database → yang ditampilkan.
 *
 * ── KENAPA SETIAP STATUS PUNYA KALIMAT SENDIRI ─────────────────────────────
 * "Gagal" saja tidak memberi tahu apa yang harus dilakukan. Setiap keadaan
 * di sini menjawab dua hal: apa yang terjadi, dan langkah berikutnya.
 */
const STATUS_TAMPILAN = {
  dibayar: {
    kelas: 'is-dibayar',
    lencana: 'Lunas',
    judul: 'Pembayaran diterima',
    teks: (p) => p.token_terbit
      ? 'Token akses sudah diterbitkan dan dikirim ke email Anda. Simpan email itu — token hanya ditampilkan sekali.'
      : 'Pembayaran sudah tercatat. Token akses sedang diterbitkan dan akan dikirim ke email Anda.',
  },
  pending: {
    kelas: 'is-pending',
    lencana: 'Menunggu pembayaran',
    judul: 'Pembayaran belum selesai',
    teks: () => 'Selesaikan pembayaran di halaman Midtrans. Kalau Anda kembali ke sini tanpa menyelesaikannya, transaksi masih bisa dilanjutkan sampai batas waktunya.',
  },
  gagal: {
    kelas: 'is-gagal',
    lencana: 'Gagal',
    judul: 'Pembayaran tidak berhasil',
    teks: () => 'Transaksi ditolak atau dibatalkan. Anda bisa mencoba lagi dari halaman harga — tidak ada biaya yang terpotong.',
  },
  kedaluwarsa: {
    kelas: 'is-kedaluwarsa',
    lencana: 'Kedaluwarsa',
    judul: 'Batas waktu pembayaran lewat',
    teks: () => 'Transaksi ini sudah tidak bisa dibayar. Mulai pesanan baru dari halaman harga — harga yang berlaku saat itu yang dipakai.',
  },
  dikembalikan: {
    kelas: 'is-gagal',
    lencana: 'Dikembalikan',
    judul: 'Pembayaran dikembalikan',
    teks: () => 'Dana sudah dikembalikan. Kalau ada pertanyaan, hubungi saya lewat halaman kontak.',
  },
};

function lencanaStatus(status) {
  const t = STATUS_TAMPILAN[status] ?? {
    kelas: '', lencana: 'Tidak diketahui', judul: 'Status tidak dikenali',
    teks: () => 'Hubungi saya lewat halaman kontak supaya bisa diperiksa.',
  };
  const l = el('span', `pesanan-lencana ${t.kelas}`.trim(), t.lencana);
  return { tampilan: t, node: l };
}

/* ── Penggambar ─────────────────────────────────────────────────────────── */

function gambarPesanan(root, p) {
  const { tampilan } = lencanaStatus(p.status);

  const kartu = el('div', 'pesanan-kartu');

  const { node: lencana } = lencanaStatus(p.status);
  kartu.appendChild(lencana);

  kartu.appendChild(el('h2', 'pesanan-status-judul', tampilan.judul));
  kartu.appendChild(el('p', 'pesanan-status-teks', tampilan.teks(p)));

  // ── Rincian ──────────────────────────────────────────────────────────────
  const rincian = el('dl', 'pesanan-rincian');

  const baris = [
    ['Nomor pesanan', el('span', 'mono', p.id)],
    ['Paket', p.tier === 'profesional' ? 'Profesional' : (p.tier === 'enterprise' ? 'Enterprise' : 'Standar')],
    ['Periode', p.periode === 'tahunan' ? 'Tahunan (12 bulan)' : 'Bulanan'],
    ['Jumlah', rupiah(p.jumlah)],
    ['Email', p.email],
    ['Dibuat', tanggal(p.dibuat_pada)],
  ];
  if (p.dibayar_pada) baris.push(['Dibayar', tanggal(p.dibayar_pada)]);

  for (const [label, nilai] of baris) {
    rincian.appendChild(el('dt', null, label));
    const dd = el('dd');
    if (nilai instanceof Node) dd.appendChild(nilai);
    else dd.textContent = String(nilai ?? '-');
    rincian.appendChild(dd);
  }
  kartu.appendChild(rincian);

  // ── Tindakan ─────────────────────────────────────────────────────────────
  const aksi = el('div', 'pesanan-aksi');

  if (p.status === 'dibayar') {
    const ke = el('a', 'tombol tombol--utama', 'Buka halaman profil');
    ke.href = '/keamanan';
    aksi.appendChild(ke);
  } else if (p.status === 'pending') {
    const lagi = el('button', 'tombol tombol--utama', 'Cek status lagi');
    lagi.type = 'button';
    lagi.addEventListener('click', () => location.reload());
    aksi.appendChild(lagi);
  } else {
    const ulang = el('a', 'tombol tombol--utama', 'Coba lagi dari halaman harga');
    ulang.href = '/pricing';
    aksi.appendChild(ulang);
  }

  const kontak = el('a', 'tombol tombol--sekunder', 'Hubungi saya');
  kontak.href = '/home#89fk39';
  aksi.appendChild(kontak);

  kartu.appendChild(aksi);
  root.replaceChildren(kartu);
}

function gambarKosong(root) {
  const kotak = el('div', 'pesanan-kosong');
  kotak.appendChild(el('h2', 'pesanan-kosong-judul', 'Nomor pesanan tidak ditemukan'));
  kotak.appendChild(el('p', 'pesanan-kosong-teks',
    'Halaman ini menampilkan status pesanan setelah pembayaran. Kalau Anda baru menyelesaikan pembayaran, buka tautan dari email struk — nomor pesanannya ada di sana.'));

  const aksi = el('div', 'pesanan-aksi');
  const ke = el('a', 'tombol tombol--utama', 'Lihat paket & harga');
  ke.href = '/pricing';
  aksi.appendChild(ke);
  const kontak = el('a', 'tombol tombol--sekunder', 'Hubungi saya');
  kontak.href = '/home#89fk39';
  aksi.appendChild(kontak);
  kotak.appendChild(aksi);

  root.replaceChildren(kotak);
}

function gambarTidakAda(root) {
  const kotak = el('div', 'pesanan-kosong');
  kotak.appendChild(el('h2', 'pesanan-kosong-judul', 'Pesanan tidak ditemukan'));
  kotak.appendChild(el('p', 'pesanan-kosong-teks',
    'Nomor pesanan tidak ada di sistem. Periksa kembali tautan dari email struk, atau hubungi saya kalau pembayaran sudah terpotong.'));

  const aksi = el('div', 'pesanan-aksi');
  const ke = el('a', 'tombol tombol--utama', 'Lihat paket & harga');
  ke.href = '/pricing';
  aksi.appendChild(ke);
  const kontak = el('a', 'tombol tombol--sekunder', 'Hubungi saya');
  kontak.href = '/home#89fk39';
  aksi.appendChild(kontak);
  kotak.appendChild(aksi);

  root.replaceChildren(kotak);
}

function gambarGalat(root, pesan) {
  const kotak = el('div', 'pesanan-kosong');
  kotak.appendChild(el('h2', 'pesanan-kosong-judul', 'Status tidak bisa dimuat'));
  kotak.appendChild(el('p', 'pesanan-kosong-teks',
    `${pesan} Halaman ini butuh koneksi ke server untuk membaca status terbaru.`));

  const aksi = el('div', 'pesanan-aksi');
  const coba = el('button', 'tombol tombol--utama', 'Coba lagi');
  coba.type = 'button';
  coba.addEventListener('click', () => location.reload());
  aksi.appendChild(coba);
  const kontak = el('a', 'tombol tombol--sekunder', 'Hubungi saya');
  kontak.href = '/home#89fk39';
  aksi.appendChild(kontak);
  kotak.appendChild(aksi);

  root.replaceChildren(kotak);
}

function gambarSkeleton(root) {
  const kartu = el('div', 'pesanan-kartu pesanan-skeleton');
  kartu.setAttribute('aria-hidden', 'true');
  kartu.appendChild(el('div', 'pesanan-skeleton-baris sk-lebar-40'));
  kartu.appendChild(el('div', 'pesanan-skeleton-baris sk-lebar-70'));
  kartu.appendChild(el('div', 'pesanan-skeleton-baris sk-lebar-90'));
  kartu.appendChild(el('div', 'pesanan-skeleton-baris sk-lebar-70'));
  root.replaceChildren(kartu);
}

/* ── Masuk ──────────────────────────────────────────────────────────────── */

async function mulai() {
  const root = document.querySelector('.pesanan-page');
  if (!root) return;

  const wadah = root.querySelector('#wadahPesanan');
  if (!wadah) return;

  const id = nomorPesanan();
  if (!id) {
    gambarKosong(wadah);
    return;
  }

  gambarSkeleton(wadah);

  // ── Status `pending` diperiksa ulang ─────────────────────────────────────
  // Webhook Midtrans kadang tiba setelah pembeli kembali. Menampilkan
  // "belum dibayar" untuk pembayaran yang sebenarnya sudah lunas adalah
  // kebohongan yang mahal — jadi beri waktu beberapa detik.
  for (let i = 0; i < PERCOBAAN_ULANG; i++) {
    let hasil;
    try {
      hasil = await ambilPesanan(id);
    } catch (err) {
      gambarGalat(wadah, err?.message ?? 'Terjadi kesalahan.');
      return;
    }

    if (hasil?.tidakAda) { gambarTidakAda(wadah); return; }

    if (hasil?.status === 'pending' && i < PERCOBAAN_ULANG - 1) {
      await new Promise((r) => setTimeout(r, JEDA_MS));
      continue;
    }

    gambarPesanan(wadah, hasil);
    return;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
