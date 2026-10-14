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

/** Panah keluar — dipakai tombol tautan maupun tombol aksi. */
function panahKeluar() {
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
  return svg;
}

/** Tombol TAUTAN dengan panah keluar — untuk berpindah halaman. */
function tombol(teks, gaya, href) {
  const a = el('a', `tombol tombol--${gaya}`);
  a.href = href;
  a.append(teks, ' ', panahKeluar());
  return a;
}

/**
 * Tombol paket: <button> untuk paket berbayar, <a> untuk yang tanpa harga.
 *
 * ── KENAPA DIBEDAKAN, PADAHAL TAMPILANNYA SAMA ─────────────────────────────
 * Paket berbayar MEMULAI PEMBAYARAN — itu tindakan di halaman ini, bukan
 * pindah halaman. Bug yang pernah terjadi: tombol beli dirender sebagai
 * tautan ke anchor kontak `/#89fk39`, dan karena `/` dilayani index.html
 * (gerbang) yang tidak punya anchor itu, pengguna terlempar ke atas beranda
 * — pembayaran tidak pernah mulai.
 *
 * Paket tanpa harga (Enterprise) memang mengajak bicara; untuk itu <a> ke
 * bagian kontak sudah benar.
 */
function tombolPaket(paket, periode, hrefKontak, paketAktif) {
  // ══ 1. PAKET YANG SEDANG DIPAKAI ═════════════════════════════════════════
  //
  // ── KENAPA TOMBOLNYA DINONAKTIFKAN, BUKAN DISEMBUNYI ──────────────────────
  // Menyembunyikan tombolnya membuat kartunya terlihat rusak: pengunjung yang
  // sadar paket itu ada akan mengira halamannya salah muat. Menonaktifkan
  // dengan label "Sedang digunakan" menjawab pertanyaannya di tempat:
  // "kenapa saya tidak bisa menekan ini?" → "karena sudah aktif".
  //
  // ── KENAPA DISABLED, BUKAN DIHILANGKAN DARI TAB ORDER ────────────────────
  // Tombol yang dinonaktifkan tetap bisa dibaca pembaca layar, dan alasannya
  // disampaikan lewat aria-describedby. Kalau elemennya dihilangkan, pengguna
  // pembaca layar tidak tahu paket itu ada sama sekali.
  if (paketAktif && paket.id === paketAktif) {
    const b = el('button', 'tombol tombol--seragam tombol--aktif');
    b.type = 'button';
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');

    // Alasan yang bisa dibaca pembaca layar — bukan cuma labelnya.
    const alasan = el('span', 'sr-only',
      `Paket ${paket.nama} sedang aktif di akun Anda. Tidak perlu berlangganan lagi.`);
    alasan.id = `alasan-paket-${paket.id}`;
    b.setAttribute('aria-describedby', alasan.id);

    // ── TITIK PENANDA SEBAGAI ELEMEN ANAK, BUKAN ::before ────────────────────
    // ── BUG YANG DIPERBAIKI ──────────────────────────────────────────────────
    // Versi pertama memakai ::before dengan display: inline-block. Titik 6px
    // itu menambah tinggi LINE BOX tombol, dan karena tombol normal memakai
    // `display: flex` sedangkan versi itu `inline-flex`, keduanya tidak
    // sejajar: tombol mati jadi 62px sementara tombol lain 44px. Terukur.
    //
    // Sebagai elemen anak, titiknya jadi flex item — ikut di tengah secara
    // vertikal tanpa menambah tinggi apa pun. display: flex-nya sama persis
    // dengan tombol paket lain, jadi tingginya pasti sama.
    const titik = el('span', 'tombol-aktif-titik');
    titik.setAttribute('aria-hidden', 'true');

    // ── LABEL DIPENDEKKAN: "Paket aktif", BUKAN "Sedang digunakan" ────────────
    // ── KENAPA ────────────────────────────────────────────────────────────────
    // "Sedang digunakan" butuh 128px. Lebar isi tombol di desktop hanya 140px
    // (lebar kartu 188px dikurangi padding 24px kiri-kanan). Sisa 12px itu
    // tidak cukup untuk titik penanda (6px) plus jaraknya (8px) — jadi
    // titiknya harus diposisikan absolut, dan hasilnya terlihat tidak
    // seimbang: teks di tengah, titik menggantung di kiri.
    //
    // "Paket aktif" butuh sekitar 80px. Dengan titik sebagai flex item biasa,
    // keduanya bisa di tengah BERSAMA — tidak ada yang menggantung.
    //
    // Artinya sama jelasnya, dan justru lebih tegas: "aktif" menyatakan
    // keadaan, "sedang digunakan" menyatakan proses.
    // ── LABEL: "Sedang digunakan" ─────────────────────────────────────────────
    // Versi sebelumnya "Paket aktif". Diganti karena "Sedang digunakan"
    // menyatakan KEADAAN YANG BERLANGSUNG, bukan sekadar status.
    //
    // ── KENAPA TIDAK "Paket aktif" LAGI ───────────────────────────────────────
    // "Aktif" bisa berarti "tersedia" atau "menyala" — pembaca harus menebak.
    // "Sedang digunakan" tidak punya arti lain: paket ini yang sedang Anda
    // pakai sekarang.
    //
    // Panjangnya 128px, dan ruang isi tombol 140px — masih muat satu baris.
    // Dijaga `white-space: nowrap` di CSS sebagai pengaman.
    b.append(titik, 'Sedang digunakan');

    const wadah = el('span', 'tombol-aktif-wadah');
    wadah.append(b, alasan);
    return wadah;
  }

  // ══ 2. PAKET GRATIS: TIDAK PERNAH MASUK ALUR PEMBAYARAN ══════════════════
  //
  // ── BUG YANG DIPERBAIKI ──────────────────────────────────────────────────
  // Pemeriksaannya dulu `paket.harga?.normal != null`. Untuk paket Gratis
  // hargaNormal-nya 0, dan `0 != null` bernilai TRUE — jadi tombol Gratis
  // dirender sebagai tombol PEMBAYARAN.
  //
  // Akibatnya: menekan "Mulai gratis" membuka dialog berjudul "Langganan
  // Gratis" dengan total "Gratis", lalu server menolaknya karena cariHarga()
  // memang menolak harga 0. Pengunjung melihat dialog pembayaran untuk paket
  // yang tidak perlu dibayar.
  //
  // Yang benar: harga 0 bukan paket berbayar. Tombolnya mengarahkan ke
  // pendaftaran, bukan ke pembayaran.
  const gratis = paket.harga?.normal === 0;
  if (gratis) {
    const tujuan = `/sign-up?lanjut=${encodeURIComponent('/pricing')}`;
    const a = el('a', `tombol tombol--${paket.cta?.gaya ?? 'seragam'}`);
    a.href = tujuan;
    a.append(paket.cta?.teks ?? 'Mulai Free', ' ', panahKeluar());
    return a;
  }

  const berbayar = paket.harga?.normal != null;

  if (!berbayar) {
    return tombol(paket.cta?.teks ?? 'Hubungi saya', paket.cta?.gaya ?? 'sekunder', hrefKontak);
  }

  const b = el('button', `tombol tombol--${paket.cta?.gaya ?? 'seragam'}`);
  b.type = 'button';
  b.append(paket.cta?.teks ?? 'Mulai', ' ', panahKeluar());
  b.addEventListener('click', () => bukaDialogBayar(paket, periode));
  return b;
}

// ── SEMUA TOMBOL PAKET: JANGAN MEMBUNGKUS ─────────────────────────────────────
//
// ── BUG YANG DIPERBAIKI ──────────────────────────────────────────────────────
// Di 4 kolom (1200px ke atas), ruang isi tombol 140px sementara "Mulai
// Profesional" plus ikon panah butuh sekitar 145px. Kurang 5px, dan tombolnya
// membungkus jadi TIGA baris — tingginya 60px sementara tombol lain 44px.
//
// Terukur: 1024px (2 kolom) tombolnya 44px; 1200px ke atas (4 kolom) jadi 60px.
//
// ── KENAPA TIDAK DIPERBAIKI DENGAN MEMENDEKKAN LABEL ─────────────────────────
// Label "Mulai Profesional" sudah dipilih supaya pembeli tahu paket mana yang
// dia pilih. Memendekkannya jadi "Pilih" menghilangkan informasi itu.
//
// ── KENAPA nowrap AMAN DI SINI ───────────────────────────────────────────────
// Tombolnya lebar penuh kartu (width: 100%), jadi tidak ada risiko meluber ke
// luar kartu — yang terjadi hanya teksnya mendekati tepi. Dan kalau labelnya
// suatu saat benar-benar tidak muat, ia akan terlihat MELEBAR keluar tombol
// saat diperiksa, bukan tersembunyi sebagai tombol yang lebih tinggi.
//
// Ini pengaman yang sama dengan yang dipakai tombol "Paket aktif". */

/* ── Dialog pembayaran ──────────────────────────────────────────────────── */

/**
 * Dialog pembayaran — tiga keadaan, satu komponen.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KEADAAN YANG DITANGANI
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   1. BELUM MASUK  → ajakan masuk. Pembelian TIDAK bisa anonim: token akses
 *      dan riwayat pembelian terikat pada akun, jadi identitas harus ada
 *      sebelum uang bergerak.
 *
 *   2. PERLU 2FA    → kolom kode 6 digit. Ini "step-up": sesi sudah sah,
 *      tapi aksi yang mengeluarkan uang butuh pembuktian ulang faktor kedua
 *      pada perangkat ini. Pola yang sama dipakai GitHub (sudo mode) dan
 *      Stripe sebelum perubahan sensitif.
 *
 *   3. SIAP         → ringkasan akun + total, lalu tombol bayar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA EMAIL TIDAK LAGI DIMINTA DI SINI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Sebelumnya dialog meminta email, dan server memakainya apa adanya. Dua
 * masalah nyata dari situ:
 *
 *   • Pengguna bisa mengetik email ORANG LAIN yang sudah punya akun — dan
 *     token aksesnya terbit untuk akun itu, tanpa pemiliknya tahu.
 *   • Salah ketik satu huruf = token dikirim ke alamat yang salah, dan
 *     pembeli tidak pernah menerima aksesnya.
 *
 * Sekarang email diambil dari akun yang sedang masuk. Keduanya tidak mungkin
 * terjadi, dan pengguna tidak perlu mengetik apa pun.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA REDIRECT, BUKAN POPUP snap.pay()
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Server mengembalikan `url` halaman pembayaran Snap. Membukanya langsung
 * bekerja di semua perangkat, termasuk ponsel, tanpa memuat skrip pihak
 * ketiga di halaman harga dan tanpa mengekspos client key. Setelah selesai,
 * Midtrans mengembalikan pembeli ke /pesanan.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA KUNCI IDEMPOTENSI DIBUAT DI SINI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Yang tahu "ini percobaan ulang dari klik yang sama" adalah browser. Kunci
 * dibuat SEKALI saat dialog dibuka dan dipakai ulang selama dialog hidup —
 * server memakainya sebagai order_id Midtrans, jadi dobel-klik tidak
 * menghasilkan dobel tagih.
 */

let _dialog = null;

function elemenDialog() {
  if (!_dialog) _dialog = document.getElementById('dialogBayar');
  return _dialog;
}

function tampilkanGalatDialog(galat, pesan) {
  if (!galat) return;
  galat.textContent = pesan;
  galat.hidden = false;
}

function sembunyikanGalatDialog(galat) {
  if (!galat) return;
  galat.hidden = true;
  galat.textContent = '';
}

/** Tampilkan satu blok keadaan, sembunyikan yang lain. */
function tampilkanBlok(d, nama) {
  for (const id of ['bayarBlokMasuk', 'bayarBlok2fa', 'bayarBlokSiap']) {
    const el = d.querySelector(`#${id}`);
    if (el) el.hidden = id !== nama;
  }
}

function aturTombol(d, { verifikasi = false, lanjut = false }) {
  const bVerif = d.querySelector('#bayarVerifikasi');
  const bLanjut = d.querySelector('#bayarLanjut');
  if (bVerif) bVerif.hidden = !verifikasi;
  if (bLanjut) bLanjut.hidden = !lanjut;
}

/** Kunci idempotensi baru per dialog. */
function kunciBaru() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `k${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function bukaDialogBayar(paket, periode) {
  const d = elemenDialog();
  if (!d) return;

  const judul = d.querySelector('#dialogBayarJudul');
  const sub = d.querySelector('#dialogBayarSub');
  const status = d.querySelector('#bayarStatus');
  const galat = d.querySelector('#bayarGalat');
  if (!judul || !sub) return;

  // Konteks pembelian disimpan di dataset dialog — dibaca handler tombol.
  d.dataset.tier = paket.id;
  d.dataset.periode = periode;
  d.dataset.kunci = kunciBaru();

  const f = formatHarga(paket, periode);
  judul.textContent = `Langganan ${paket.nama}`;
  sub.textContent = `${f.angka}${f.satuan ?? ''}` +
    (f.total ? ` — ditagih ${f.total} per tahun.` : '.');

  const akun = d.querySelector('#bayarAkun');
  if (akun) akun.textContent = '—';
  const total = d.querySelector('#bayarTotal');
  if (total) total.textContent = `${f.angka}${f.satuan ?? ''}`;
  const infoSudo = d.querySelector('#bayarSudoInfo');
  if (infoSudo) infoSudo.hidden = true;

  sembunyikanGalatDialog(galat);
  tampilkanBlok(d, '');   // semua blok tersembunyi sampai konteks tiba
  aturTombol(d, {});
  if (status) status.textContent = 'Memeriksa akun…';

  if (!d.open) d.showModal();

  periksaKonteks(d, paket, periode);
}

/**
 * Tanya server siapa yang sedang masuk, lalu tampilkan langkah yang tepat.
 *
 * ── KENAPA SERVER, BUKAN COOKIE DI BROWSER ─────────────────────────────────
 * Cookie sesi httpOnly — JavaScript tidak bisa membacanya (dan memang tidak
 * boleh: itu yang membuatnya tidak bisa dicuri lewat XSS). Satu-satunya cara
 * tahu keadaan akun adalah bertanya ke server.
 */
async function periksaKonteks(d, paket, periode) {
  const status = d.querySelector('#bayarStatus');
  const galat = d.querySelector('#bayarGalat');

  let ctx = null;
  try {
    const res = await fetch('/api/checkout/konteks', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    ctx = await res.json().catch(() => null);
  } catch {
    if (status) status.textContent = '';
    tampilkanGalatDialog(galat, 'Tidak bisa memeriksa akun. Periksa koneksi Anda, lalu coba lagi.');
    aturTombol(d, {});
    return;
  }

  if (!ctx?.ok) {
    if (status) status.textContent = '';
    tampilkanGalatDialog(galat, 'Tidak bisa memeriksa akun. Coba lagi sebentar lagi.');
    return;
  }

  // ── Belum masuk ───────────────────────────────────────────────────────────
  if (!ctx.masuk) {
    if (status) status.textContent = '';
    tampilkanBlok(d, 'bayarBlokMasuk');
    const tautan = d.querySelector('#bayarKeMasuk');
    if (tautan) {
      // Bawa tujuan kembali + paket yang tadi dipilih, supaya setelah masuk
      // pengguna tidak perlu mencari paketnya lagi.
      const lanjut = `/pricing?paket=${encodeURIComponent(paket.id)}&periode=${encodeURIComponent(periode)}`;
      tautan.href = `/sign-in?lanjut=${encodeURIComponent(lanjut)}`;
    }
    const daftar = d.querySelector('#bayarKeDaftar');
    if (daftar) {
      const lanjut = `/pricing?paket=${encodeURIComponent(paket.id)}&periode=${encodeURIComponent(periode)}`;
      daftar.href = `/sign-up?lanjut=${encodeURIComponent(lanjut)}`;
    }
    aturTombol(d, {});
    return;
  }

  // ── Sudah masuk ───────────────────────────────────────────────────────────
  const akun = d.querySelector('#bayarAkun');
  if (akun) akun.textContent = ctx.email || '—';

  // Perlu step-up 2FA?
  if (ctx.perlu_verifikasi) {
    if (status) status.textContent = '';
    tampilkanBlok(d, 'bayarBlok2fa');
    aturTombol(d, { verifikasi: true });
    d.querySelector('#bayarKode')?.focus();
    return;
  }

  // Siap bayar.
  if (status) status.textContent = '';
  tampilkanBlok(d, 'bayarBlokSiap');
  aturTombol(d, { lanjut: true });
  const infoSudo = d.querySelector('#bayarSudoInfo');
  if (infoSudo && ctx.sudo) infoSudo.hidden = false;
  d.querySelector('#bayarLanjut')?.focus();
}

/** Kirim kode step-up ke server. */
async function kirimKodeStepUp(d) {
  const galat = d.querySelector('#bayarGalat');
  const tombol = d.querySelector('#bayarVerifikasi');
  const input = d.querySelector('#bayarKode');
  const kode = String(input?.value ?? '').trim();

  // Terima 6 digit TOTP ATAU kode pemulihan (XXXXX-XXXXX).
  if (!/^\d{6}$/.test(kode) && !/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(kode)) {
    tampilkanGalatDialog(galat, 'Masukkan 6 digit kode, atau kode pemulihan Anda.');
    input?.focus();
    return;
  }

  tombol.disabled = true;
  tombol.textContent = 'Memverifikasi…';
  sembunyikanGalatDialog(galat);

  try {
    const res = await fetch('/api/checkout/2fa', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: kode }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || `Server menjawab ${res.status}.`);
    }

    // Verifikasi lolos → langsung ke keadaan siap bayar.
    tampilkanBlok(d, 'bayarBlokSiap');
    aturTombol(d, { lanjut: true });
    const infoSudo = d.querySelector('#bayarSudoInfo');
    if (infoSudo) infoSudo.hidden = false;
    if (data.peringatan) tampilkanGalatDialog(galat, data.peringatan);
    d.querySelector('#bayarLanjut')?.focus();
  } catch (err) {
    tampilkanGalatDialog(galat, err?.message ?? 'Kode tidak bisa diverifikasi.');
    if (input) input.value = '';
    input?.focus();
  } finally {
    tombol.disabled = false;
    tombol.textContent = 'Verifikasi kode';
  }
}

/** Mulai pembayaran setelah semua gerbang lolos. */
async function mulaiPembayaranDariDialog(d) {
  const galat = d.querySelector('#bayarGalat');
  const tombol = d.querySelector('#bayarLanjut');

  tombol.disabled = true;
  tombol.textContent = 'Menyiapkan…';
  sembunyikanGalatDialog(galat);

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        tier: d.dataset.tier,
        periode: d.dataset.periode,
        idempotency_key: d.dataset.kunci,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      // ── Sesi kedaluwarsa / 2FA dicabut di tab lain ────────────────────────
      // Server memeriksa ulang setiap kali, jadi keadaan bisa berubah antara
      // dialog dibuka dan tombol ditekan. Kembalikan ke langkah yang benar
      // alih-alih menampilkan galat yang membingungkan.
      if (data?.error === 'belum_masuk') {
        tampilkanBlok(d, 'bayarBlokMasuk');
        aturTombol(d, {});
        throw new Error('Sesi Anda sudah berakhir. Masuk lagi untuk melanjutkan.');
      }
      if (data?.error === 'perlu_2fa') {
        tampilkanBlok(d, 'bayarBlok2fa');
        aturTombol(d, { verifikasi: true });
        throw new Error('Verifikasi 2FA diperlukan lagi untuk pembayaran ini.');
      }
      throw new Error([data?.message, data?.saran].filter(Boolean).join(' ') || `Server menjawab ${res.status}.`);
    }

    if (data.sudah_dibayar) {
      location.href = `/pesanan?order_id=${encodeURIComponent(data.pembayaran_id)}&status=sukses`;
      return;
    }

    if (!data.url) throw new Error('Server tidak mengembalikan tautan pembayaran.');

    try { sessionStorage.setItem('pesanan_terakhir', data.pembayaran_id); } catch { /* storage diblokir */ }
    location.href = data.url;
  } catch (err) {
    tampilkanGalatDialog(galat, err?.message ?? 'Pembayaran tidak bisa dimulai.');
    tombol.disabled = false;
    tombol.textContent = 'Lanjut ke pembayaran';
  }
}

function pasangDialogBayar() {
  const d = elemenDialog();
  if (!d) return;

  d.querySelector('#bayarBatal')?.addEventListener('click', () => d.close());
  d.querySelector('#bayarVerifikasi')?.addEventListener('click', () => kirimKodeStepUp(d));
  d.querySelector('#bayarLanjut')?.addEventListener('click', () => mulaiPembayaranDariDialog(d));

  // Enter di kolom kode = verifikasi. Tanpa ini, pengguna harus memindahkan
  // tangan ke tombol setelah mengetik 6 digit.
  d.querySelector('#bayarKode')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); kirimKodeStepUp(d); }
  });

  // Bersihkan kode dari DOM saat dialog ditutup — kode TOTP berumur pendek,
  // tapi tidak ada alasan meninggalkannya di halaman.
  d.addEventListener('close', () => {
    const input = d.querySelector('#bayarKode');
    if (input) input.value = '';
  });
}

/**
 * Setelah kembali dari halaman masuk, buka lagi dialog untuk paket yang tadi
 * dipilih — supaya pengguna tidak perlu mencari tombolnya lagi.
 *
 * Dipanggil dari mulai() saat URL membawa ?paket=...
 */
async function lanjutkanPembayaranDariUrl(data) {
  const p = new URLSearchParams(location.search);
  const idPaket = p.get('paket');
  if (!idPaket) return;

  const periode = p.get('periode') || data?.periode?.default || 'bulanan';
  const paket = (data?.paket ?? []).find((x) => x.id === idPaket);
  if (!paket || paket.harga?.normal == null) return;

  // Tunggu kartu selesai digambar supaya dialog tidak muncul di halaman kosong.
  await new Promise((r) => setTimeout(r, 250));
  bukaDialogBayar(paket, periode);

  // Bersihkan query supaya memuat ulang halaman tidak membuka dialog lagi.
  try {
    const bersih = new URL(location.href);
    bersih.searchParams.delete('paket');
    bersih.searchParams.delete('periode');
    history.replaceState(null, '', bersih.pathname + bersih.search + bersih.hash);
  } catch { /* gagal membersihkan bukan alasan menggagalkan semuanya */ }
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

  // ── PAKET GRATIS: TAMPILKAN "Gratis", BUKAN "Rp 0/bulan" ──────────────────
  //
  // ── KENAPA BUKAN "Rp 0/bulan" ─────────────────────────────────────────────
  // "/bulan" adalah satuan langganan. Menempelkannya pada harga nol membuat
  // paket gratis terlihat seperti langganan yang kebetulan berharga nol —
  // dan itu menimbulkan pertanyaan yang tidak perlu: "setelah sebulan,
  // bayar berapa?"
  //
  // "Free" tanpa satuan menjawab pertanyaan itu sebelum ditanyakan: tidak ada
  // periode, tidak ada tagihan.
  //
  // ── KENAPA "Free", BUKAN "Gratis" ─────────────────────────────────────────
  // Nama paketnya "Free", jadi harga besarnya harus sama — kalau tidak, satu
  // kartu menampilkan dua kata berbeda untuk hal yang sama, dan pembaca
  // bertanya-tanya apakah keduanya hal yang berbeda.
  //
  // ── KENAPA TANPA CORETAN DAN TANPA DISKON ─────────────────────────────────
  // Tidak ada harga normal untuk dicoret, dan "Hemat 0%" bukan informasi.
  // Yang ditampilkan justru catatannya: "Free selamanya, tanpa kartu kredit" —
  // itu yang menjawab keraguan pada paket gratis.
  if (angka === 0) {
    return {
      angka: 'Free',
      teks: true,      // tidak pakai format angka — sama seperti Enterprise
      satuan: null,
      coret: null,
      diskon: null,
      total: null,
      rupiah,
      catatanKaki: paket.catatan,
    };
  }

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

function gambarKartu(paket, hrefKontak, periode, paketAktif) {
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

  kartu.appendChild(tombolPaket(paket, periode, hrefKontak, paketAktif));

  return kartu;
}


/**
 * Tiga langkah cara memakai token akses.
 *
 * ── KENAPA DIJELASKAN BERLANGKAH, BUKAN SATU PARAGRAF ──────────────────────
 * "Token akses" adalah istilah yang belum tentu dipahami pengunjung. Paragraf
 * yang menjelaskannya harus dibaca utuh sebelum mengerti; tiga langkah bernomor
 * bisa dipindai dan langsung terbaca urutannya.
 */
function gambarLangkahToken(data) {
  const list = el('ol', 'langkah-list');

  for (const l of data.langkahToken ?? []) {
    const li = el('li', 'langkah-item');

    // Nomor sebagai elemen sendiri, bukan ::before. Alasannya: nomor ini
    // bagian dari informasi (urutan langkah), jadi ia harus ada di DOM —
    // pembaca layar ikut mendengarnya.
    const nomor = el('span', 'langkah-nomor', l.nomor);
    nomor.setAttribute('aria-hidden', 'true'); // urutannya sudah dibawa <ol>
    li.append(nomor);

    const isi = el('div', 'langkah-isi');
    isi.append(el('h3', 'langkah-judul', l.judul));
    isi.append(el('p', 'langkah-teks', l.teks));
    li.append(isi);

    list.append(li);
  }

  return list;
}

/**
 * Bagian bonus star — termasuk hasil yang berbeda per paket.
 *
 * ── KENAPA HASILNYA DIRINCI, BUKAN DITULIS SATU KALIMAT ────────────────────
 * "Beri star, dapat bonus" tanpa rincian menimbulkan salah paham: pengguna
 * gratis akan mengira dia juga dapat token, padahal bonusnya untuk dia adalah
 * pratinjau metrik. Rincian per paket menghilangkan tafsir ganda itu.
 */
function gambarBonusStar(data) {
  const b = data.bonusStar;
  if (!b) return null;

  const kotak = el('div', 'bonus-kotak');

  // Ikon bintang: dari ikon yang sudah ada di situs, bukan pustaka baru.
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'bonus-ikon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const jalur = document.createElementNS(NS, 'path');
  jalur.setAttribute('d', 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z');
  svg.append(jalur);

  const teks = el('div', 'bonus-teks');
  teks.append(el('h3', 'bonus-judul', b.judul));
  teks.append(el('p', 'bonus-deskripsi', b.teks));

  const kepala = el('div', 'bonus-kepala');
  kepala.append(svg, teks);
  kotak.append(kepala);

  // Rincian hasil per paket.
  if (Array.isArray(b.hasil) && b.hasil.length) {
    const daftar = el('dl', 'bonus-hasil');
    for (const h of b.hasil) {
      daftar.append(el('dt', 'bonus-paket', h.paket));
      daftar.append(el('dd', 'bonus-dapat', h.dapat));
    }
    kotak.append(daftar);
  }

  return kotak;
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
      jawab.append(a, document.createTextNode(', tidak ada kewajiban setelahnya.'));
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
    `${pesan} Halaman ini butuh koneksi ke server untuk menampilkan harga terbaru, supaya angkanya selalu sama dengan yang berlaku.`);
  kotak.appendChild(teks);

  const aksi = el('div', 'cta-tombol');
  const coba = el('button', 'tombol tombol--utama', 'Coba lagi');
  coba.type = 'button';
  coba.addEventListener('click', () => location.reload());
  aksi.appendChild(coba);

  const kontak = tombol('Hubungi saya', 'sekunder', '/home#89fk39');
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

  // Dialog pembayaran dipasang lebih dulu — elemennya statis di pricing.html,
  // jadi tidak perlu menunggu data harga tiba.
  pasangDialogBayar();

  const hrefKontak = '/home#89fk39';

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

    // ── PAKET YANG SEDANG DIPAKAI ────────────────────────────────────────────
    //
    // ── KENAPA DIMUAT SEBELUM KARTU DIGAMBAR ─────────────────────────────────
    // Kalau kartunya digambar dulu lalu tombolnya diperbarui belakangan,
    // pengunjung melihat tombol aktif berkedip berubah jadi "Sedang digunakan"
    // — dan kedipan itu justru menarik perhatian ke hal yang salah.
    //
    // Satu permintaan sebelum render: tidak ada kedipan, tidak ada kartu yang
    // sempat salah.
    //
    // ── KENAPA GAGALNYA DIAM-DIAM ────────────────────────────────────────────
    // Endpoint ini butuh sesi. Pengunjung yang belum masuk akan menerima 401
    // — dan itu keadaan NORMAL, bukan error. Kalau kegagalannya ditampilkan,
    // setiap pengunjung baru akan melihat pesan error di halaman harga.
    //
    // null berarti "tidak tahu paket siapa" → semua tombol tampil normal.
    // Itu keadaan yang benar untuk pengunjung yang belum masuk.
    let paketAktif = null;
    try {
      const res = await fetch('/api/checkout/konteks', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const ctx = await res.json().catch(() => null);
        if (ctx?.masuk && ctx.paket) paketAktif = ctx.paket;
      }
    } catch {
      // Tidak bisa memeriksa: tampilkan semua tombol normal. Lebih baik
      // pengunjung bisa menekan tombol yang ternyata sudah aktif (dan
      // servernya menolak dengan jelas) daripada semua tombol mati karena
      // satu permintaan gagal.
    }

    const gambarKartuSemua = () => {
      if (!grid) return;
      grid.className = 'harga-grid';
      grid.replaceChildren(
        ...data.paket.map((p) => gambarKartu(p, hrefKontak, periodeAktif, paketAktif)),
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

    // ── CARA KERJA TOKEN + BONUS STAR ────────────────────────────────────
    // Ditaruh setelah kartu harga, sebelum FAQ.
    const wadahLangkah = root.querySelector('#wadahLangkahToken');
    if (wadahLangkah) {
      wadahLangkah.replaceChildren(gambarLangkahToken(data));
      wadahLangkah.setAttribute('aria-busy', 'false');
    }

    const wadahBonus = root.querySelector('#wadahBonusStar');
    if (wadahBonus) {
      const bonus = gambarBonusStar(data);
      // `replaceChildren(null)` menghapus isi tanpa error — jadi aman kalau
      // data bonus tidak ada (mis. API versi lama).
      wadahBonus.replaceChildren(...(bonus ? [bonus] : []));
      wadahBonus.setAttribute('aria-busy', 'false');
    }

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

    // ── KEMBALI DARI HALAMAN MASUK ──────────────────────────────────────────
    // Pengguna yang menekan "Masuk untuk melanjutkan" kembali ke sini dengan
    // ?paket=... — dialognya dibuka lagi supaya ia tidak perlu mencari
    // tombol paket yang tadi dipilih.
    lanjutkanPembayaranDariUrl(data);
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
