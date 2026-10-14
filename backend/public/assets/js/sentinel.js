/**
 * SENTINEL — INSPECTOR WEBHOOK (frontend)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA KUNCI DISIMPAN DI sessionStorage, BUKAN localStorage
 * ══════════════════════════════════════════════════════════════════════════════
 *   sessionStorage → hilang saat tab ditutup. Kunci tidak tertinggal di
 *                   perangkat yang dipakai bersama.
 *   localStorage  → tersimpan sampai dihapus manual. Di komputer bersama,
 *                   orang berikutnya membuka inspector tanpa perlu tahu
 *                   kuncinya.
 *
 * Kenyamanannya sedikit berkurang (harus memasukkan kunci lagi setelah menutup
 * tab), dan itu memang harga yang pantas untuk kunci admin.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KENAPA SEMUA TEKS DIBUAT DENGAN createElement, BUKAN innerHTML
 * ══════════════════════════════════════════════════════════════════════════════
 * Inspector ini menampilkan BODY WEBHOOK — data yang datang dari luar dan tidak
 * kita kendalikan. Kalau isinya dimasukkan lewat innerHTML, satu payload yang
 * memuat `<script>` akan dijalankan di halaman ini.
 *
 * Dengan createElement + textContent, isinya jadi TEKS, bukan markup. Tidak ada
 * cara payload itu menjadi kode.
 */

const KUNCI_SIMPAN = 'sentinel-kunci';

/* ── Keadaan ────────────────────────────────────────────────────────────── */

let kunci = '';
let saringStatus = '';
let sedangMemuat = false;

/* ── Pembantu DOM ───────────────────────────────────────────────────────── */

function el(tag, kelas, teks) {
  const node = document.createElement(tag);
  if (kelas) node.className = kelas;
  if (teks != null) node.textContent = String(teks);
  return node;
}

function $(sel) {
  return document.querySelector(sel);
}

/* ── Format ─────────────────────────────────────────────────────────────── */

/** Ubah milidetik jadi teks yang bisa dibaca sekilas. */
function durasi(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}j`;
}

/** Waktu relatif: "3 menit lalu" lebih berguna daripada jam persisnya. */
function sejak(waktuMs) {
  if (!waktuMs) return '—';
  const selisih = Date.now() - waktuMs;
  if (selisih < 5000) return 'baru saja';
  if (selisih < 60_000) return `${Math.floor(selisih / 1000)} detik lalu`;
  if (selisih < 3_600_000) return `${Math.floor(selisih / 60_000)} menit lalu`;
  if (selisih < 86_400_000) return `${Math.floor(selisih / 3_600_000)} jam lalu`;
  return `${Math.floor(selisih / 86_400_000)} hari lalu`;
}

/* ── Pemberitahuan ──────────────────────────────────────────────────────── */

let timerNotif = null;

function beritahu(pesan, jenis = '') {
  const n = $('#notif');
  n.textContent = pesan;
  n.className = 'sentinel-notif' + (jenis ? ` sentinel-notif--${jenis}` : '');
  n.hidden = false;

  // Notifikasi lama dibatalkan supaya tidak saling menimpa saat dua aksi
  // dijalankan berdekatan.
  if (timerNotif) clearTimeout(timerNotif);
  timerNotif = setTimeout(() => { n.hidden = true; }, 5000);
}

/* ── Panggilan API ──────────────────────────────────────────────────────── */

async function panggil(jalur, { metode = 'GET', body = null } = {}) {
  const headers = { Accept: 'application/json', 'x-admin-key': kunci };
  if (body) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(jalur, {
      method: metode,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Tidak bisa menghubungi server. Periksa koneksi Anda.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }

  if (res.status === 401) {
    // Kunci ditolak → kembali ke gerbang, jangan biarkan pengguna melihat
    // halaman yang isinya kosong tanpa penjelasan.
    bukaGerbang('Kunci admin ditolak. Masukkan lagi.');
    throw new Error('Kunci admin ditolak.');
  }

  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `Server menjawab ${res.status}`);
  }

  return data;
}

/* ── Gerbang ────────────────────────────────────────────────────────────── */

function bukaGerbang(pesanGalat = '') {
  $('#gerbang').hidden = false;
  $('#isi').hidden = true;
  kunci = '';
  sessionStorage.removeItem(KUNCI_SIMPAN);

  const g = $('#gerbangGalat');
  if (pesanGalat) {
    g.textContent = pesanGalat;
    g.hidden = false;
  } else {
    g.hidden = true;
  }

  $('#kunci')?.focus();
}

function bukaInspector(kunciBaru) {
  kunci = kunciBaru;
  sessionStorage.setItem(KUNCI_SIMPAN, kunci);
  $('#gerbang').hidden = true;
  $('#isi').hidden = false;
  muatSemua();
}

/* ── Kartu ringkasan ────────────────────────────────────────────────────── */

function gambarRingkasan(data) {
  const a = data.antrean ?? {};
  const s = data.sirkuit ?? {};

  $('#angkaMenunggu').textContent = a.menunggu ?? 0;
  $('#angkaTerkirim').textContent = a.dikirim ?? 0;
  $('#angkaDlq').textContent = a.dlq ?? 0;
  $('#angkaSirkuit').textContent = s.terbuka ?? 0;

  const lat = a.latensi ?? {};
  $('#angkaLatensi').textContent = lat.rataMs != null ? durasi(lat.rataMs) : '—';
  $('#sampelLatensi').textContent = lat.sampel
    ? `dari ${lat.sampel} pengiriman berhasil`
    : 'belum ada sampel';

  // ── KONFIGURASI DITAMPILKAN DI KAKI ──────────────────────────────────────
  // Angka-angka ini menentukan perilaku antrean (berapa kali dicoba, berapa
  // lama timeout). Menampilkannya membuat orang yang memeriksa tidak perlu
  // membuka kode untuk tahu kenapa sebuah pesan berperilaku tertentu.
  const k = data.konfigurasi ?? {};
  $('#infoKonfigurasi').textContent =
    `Timeout pengiriman ${durasi(k.timeoutMs)} · ` +
    `sirkuit diputus setelah ${k.ambangGagal} kegagalan beruntun · ` +
    `toleransi tanda tangan ${k.toleransiTandaTanganDetik} detik.`;

  $('#kartuRingkas').setAttribute('aria-busy', 'false');
}

/* ── Sirkuit ────────────────────────────────────────────────────────────── */

function lencanaSirkuit(keadaan) {
  const teks = {
    tertutup: 'Normal',
    terbuka: 'Diputus',
    setengah_terbuka: 'Menguji',
  }[keadaan] ?? keadaan;

  const kelas = {
    tertutup: 'tertutup',
    terbuka: 'terbuka',
    setengah_terbuka: 'setengah',
  }[keadaan] ?? '';

  return el('span', `sentinel-lencana sentinel-lencana--${kelas}`, teks);
}

function gambarSirkuit(daftar, sekarang = Date.now()) {
  const wadah = $('#wadahSirkuit');
  wadah.replaceChildren();

  if (!daftar.length) {
    wadah.appendChild(el('p', 'sentinel-kosong',
      'Belum ada catatan sirkuit. Sirkuit dibuat saat pengiriman pertama ke sebuah endpoint.'));
    wadah.setAttribute('aria-busy', 'false');
    return;
  }

  const wrap = el('div', 'sentinel-tabel-wrap');
  const tabel = el('table', 'sentinel-tabel');

  const thead = el('thead');
  const trh = el('tr');
  for (const judul of ['Tujuan', 'Keadaan', 'Gagal beruntun', 'Uji berikutnya', 'Terakhir gagal', 'Total']) {
    trh.appendChild(el('th', null, judul));
  }
  thead.appendChild(trh);
  tabel.appendChild(thead);

  const tbody = el('tbody');

  for (const s of daftar) {
    const tr = el('tr');

    tr.appendChild(el('td', 'sentinel-mono', s.host));

    const tdKeadaan = el('td');
    tdKeadaan.appendChild(lencanaSirkuit(s.keadaan));
    tr.appendChild(tdKeadaan);

    tr.appendChild(el('td', 'sentinel-mono', s.gagalBeruntun));

    // ── UJI BERIKUTNYA SEBAGAI HITUNG MUNDUR ─────────────────────────────
    // "30 menit" jauh lebih berguna daripada jam persisnya, karena yang
    // dibutuhkan pembaca adalah "berapa lama lagi".
    const tdTunggu = el('td', 'sentinel-mono');
    if (s.keadaan === 'terbuka' && s.sisaTungguMs > 0) {
      tdTunggu.textContent = durasi(s.sisaTungguMs);
    } else if (s.keadaan === 'setengah_terbuka') {
      tdTunggu.textContent = 'sedang diuji';
    } else {
      tdTunggu.textContent = '—';
    }
    tr.appendChild(tdTunggu);

    tr.appendChild(el('td', null, sejak(s.terakhirGagalAt)));

    const tdTotal = el('td', 'sentinel-mono');
    tdTotal.textContent = `${s.totalSukses ?? 0} / ${s.totalGagal ?? 0}`;
    tr.appendChild(tdTotal);

    // ── TOMBOL TUTUP PAKSA HANYA SAAT TERBUKA ────────────────────────────
    // Sirkuit yang normal tidak perlu tombol — menampilkannya di semua baris
    // akan mengundang orang menekannya tanpa alasan.
    if (s.keadaan === 'terbuka' || s.keadaan === 'setengah_terbuka') {
      const tdAksi = el('td');
      const b = el('button', 'sentinel-klik', 'Tutup paksa');
      b.type = 'button';
      b.addEventListener('click', () => tutupPaksa(s.host));
      tdAksi.appendChild(b);
      tr.appendChild(tdAksi);
    }

    tbody.appendChild(tr);
  }

  tabel.appendChild(tbody);
  wrap.appendChild(tabel);
  wadah.appendChild(wrap);
  wadah.setAttribute('aria-busy', 'false');
}

async function tutupPaksa(host) {
  try {
    await panggil('/api/sentinel/sirkuit/tutup', { metode: 'POST', body: { host } });
    beritahu(`Sirkuit ${host} ditutup. Pengiriman berikutnya akan dicoba.`, 'sukses');
    await muatSemua();
  } catch (err) {
    beritahu(err.message, 'galat');
  }
}

/* ══ MODE KEAMANAN ═══════════════════════════════════════════════════════════
 *
 * ── POLA YANG DIIKUTI: CLOUDFLARE "UNDER ATTACK MODE" ───────────────────────
 * Cloudflare menaruh mode daruratnya di Quick Actions dengan tiga sifat:
 *
 *   1. SATU TOMBOL, langsung bekerja — tanpa halaman pengaturan
 *   2. KEADAAN TERLIHAT — labelnya menyatakan mode mana yang aktif
 *   3. MUDAH DIMATIKAN — tidak ada konfirmasi berlapis
 *
 * Yang ketiga paling penting di sini. Kalau mengembalikan mode butuh usaha,
 * orang enggan mencobanya sama sekali — dan fitur yang tidak pernah dicoba
 * sama dengan fitur yang tidak ada.
 *
 * ── KENAPA TIDAK ADA DIALOG KONFIRMASI ──────────────────────────────────────
 * Mode ini tidak merusak apa pun: ia hanya mempersempit jendela. Mengubahnya
 * kembali sama mudahnya. Dialog konfirmasi pada aksi yang mudah dibatalkan
 * hanya melatih orang menekan "Ya" tanpa membaca.
 */

/** Satuan yang enak dibaca untuk tiap nilai. */
const SATUAN_NILAI = {
  toleransiTandaTanganDetik: (v) => `${v} detik`,
  ambangGagalSirkuit: (v) => `${v}× gagal`,
  jendelaDuplikatMs: (v) => (v >= 3_600_000 ? `${v / 3_600_000} jam` : `${v / 60_000} menit`),
  batasBodyByte: (v) => `${v / 1024} KB`,
  batasLajuPerMenit: (v) => `${v}/menit`,
};

/** Label yang menjelaskan APA yang diatur, bukan nama teknisnya. */
const LABEL_NILAI = {
  toleransiTandaTanganDetik: 'Toleransi selisih jam',
  ambangGagalSirkuit: 'Gagal sebelum sirkuit diputus',
  jendelaDuplikatMs: 'Jendela deteksi kiriman ulang',
  batasBodyByte: 'Batas ukuran body',
  batasLajuPerMenit: 'Batas permintaan per IP',
};

function gambarMode(data) {
  const kartu = $('#kartuMode');
  const tombol = $('#tombolMode');

  const pro = data.mode === 'pro';

  // Kelas penanda mode — dipakai CSS untuk mengubah tepi dan latar.
  kartu.className = 'sentinel-mode' + (pro ? ' sentinel-mode--pro' : '');

  $('#modeNama').textContent = data.label;
  $('#modeKeterangan').textContent = data.keterangan;

  // ── TOMBOL MENYATAKAN AKSI, BUKAN KEADAAN ─────────────────────────────────
  // Keadaan sudah dinyatakan oleh nama mode di atas. Tombol yang menulis
  // keadaan aktif ("Mode Pro aktif") membuat orang menebak apakah ia bisa
  // ditekan, dan apa yang terjadi kalau ditekan.
  tombol.textContent = pro ? 'Kembalikan ke Normal' : 'Perketat ke Pro';
  tombol.dataset.modeTujuan = pro ? 'normal' : 'pro';
  tombol.disabled = false;

  // ── TABEL PERBANDINGAN NILAI ──────────────────────────────────────────────
  // Kedua kolom ditampilkan sekaligus: operator bisa melihat apa yang
  // diperketat tanpa harus mencoba mode lain dulu.
  //
  // ── KENAPA ANGKANYA DARI SERVER ───────────────────────────────────────────
  // `data.semuaNilai` dikirim backend dan berisi nilai kedua mode. Angka yang
  // ditulis ulang di sini akan berbeda dari kenyataan begitu ada yang
  // mengubahnya di backend — dan tabelnya akan berbohong tanpa ada yang tahu.
  const wadah = $('#modeNilai');
  wadah.replaceChildren();

  const kepala = el('div', 'sentinel-nilai-kepala');
  kepala.appendChild(el('span', null, 'Pengaturan'));
  kepala.appendChild(el('span', null, 'Normal'));
  kepala.appendChild(el('span', null, 'Pro'));
  wadah.appendChild(kepala);

  const normal = data.semuaNilai?.normal ?? {};
  const pro2 = data.semuaNilai?.pro ?? {};

  for (const kunci of Object.keys(data.nilai)) {
    const baris = el('div', 'sentinel-nilai-baris');
    baris.appendChild(el('span', 'sentinel-nilai-label', LABEL_NILAI[kunci] ?? kunci));

    const format = SATUAN_NILAI[kunci] ?? ((v) => String(v));

    const vNormal = normal[kunci];
    const vPro = pro2[kunci];
    const beda = vNormal !== vPro;

    // ── YANG BERBEDA DIBERI PENANDA, YANG SAMA DIREDUP ──────────────────────
    // Mata langsung tertuju ke yang berubah. Tanpa penanda, tabel lima baris
    // harus dibaca satu per satu untuk menemukan bedanya.
    baris.appendChild(el(
      'span',
      `sentinel-nilai-angka sentinel-nilai-angka--normal ${beda ? '' : 'sentinel-nilai-angka--sama'}`,
      vNormal != null ? format(vNormal) : '—',
    ));
    baris.appendChild(el(
      'span',
      `sentinel-nilai-angka ${beda ? 'sentinel-nilai-angka--beda' : 'sentinel-nilai-angka--sama'}`,
      vPro != null ? format(vPro) : '—',
    ));

    wadah.appendChild(baris);
  }

  // Keterangan kaki: jelaskan cara membaca tabel.
  wadah.appendChild(el(
    'p',
    'sentinel-sumber-header',
    pro
      ? 'Nilai Pro berlaku sekarang. Kembalikan ke Normal untuk memakai nilai yang lebih longgar.'
      : 'Nilai Normal berlaku sekarang. Perketat ke Pro untuk mempersempit jendela serangan.',
  ));

  kartu.setAttribute('aria-busy', 'false');
}

async function ubahMode(tujuan) {
  const tombol = $('#tombolMode');
  tombol.disabled = true;
  tombol.textContent = 'Mengubah…';

  try {
    const data = await panggil('/api/sentinel/mode', {
      metode: 'POST',
      body: { mode: tujuan },
    });

    gambarMode(data);
    beritahu(
      tujuan === 'pro'
        ? 'Mode Pro aktif — pemeriksaan diperketat.'
        : 'Kembali ke mode Normal.',
      'sukses',
    );
  } catch (err) {
    beritahu(err.message, 'galat');
    tombol.disabled = false;
    // Muat ulang keadaan sebenarnya supaya tombolnya tidak tertinggal
    // menampilkan aksi yang sudah gagal.
    await muatMode();
  }
}

async function muatMode() {
  try {
    const data = await panggil('/api/sentinel/mode');
    gambarMode(data);
  } catch (err) {
    $('#kartuMode').replaceChildren(el('p', 'sentinel-galat', err.message));
  }
}

/* ── Sumber webhook ─────────────────────────────────────────────────────── */

/**
 * Gambar kartu tiap sumber webhook.
 *
 * ── KENAPA URL MASUK DITAMPILKAN ────────────────────────────────────────────
 * URL ini yang harus didaftarkan di dashboard penyedia (Stripe, GitHub).
 * Tanpa ditampilkan di sini, operator harus menebak bentuknya — dan URL yang
 * salah didaftarkan berarti webhook tidak pernah sampai, TANPA error apa pun
 * di sisi kita.
 *
 * ── KENAPA HANYA SUMBER AKTIF YANG URL-NYA DISOROT ──────────────────────────
 * Sumber nonaktif menolak semua permintaan. Menampilkan URL-nya seolah siap
 * dipakai akan menyesatkan.
 */
function gambarSumber(daftar, tujuan) {
  const wadah = $('#wadahSumber');
  wadah.replaceChildren();

  if (!daftar?.length) {
    wadah.appendChild(el('p', 'sentinel-kosong', 'Tidak ada sumber terdaftar.'));
    wadah.setAttribute('aria-busy', 'false');
    return;
  }

  const baris = el('div', 'sentinel-sumber-baris');
  const asal = window.location.origin;

  for (const s of daftar) {
    const kartu = el('div', `sentinel-sumber${s.aktif ? '' : ' sentinel-sumber--nonaktif'}`);

    const kepala = el('div', 'sentinel-sumber-kepala');
    kepala.appendChild(el('span', 'sentinel-sumber-nama', s.label));
    kepala.appendChild(el(
      'span',
      `sentinel-lencana sentinel-lencana--${s.aktif ? 'dikirim' : 'dlq'}`,
      s.aktif ? 'Aktif' : 'Nonaktif',
    ));
    kartu.appendChild(kepala);

    if (s.aktif) {
      const kode = el('code', 'sentinel-sumber-url');
      kode.textContent = `${asal}/api/sentinel/masuk/${s.id}`;
      kartu.appendChild(kode);

      kartu.appendChild(el('p', 'sentinel-sumber-header', `Header: ${s.header}`));
    } else {
      kartu.appendChild(el(
        'p',
        'sentinel-sumber-header',
        'Secret belum disetel — permintaan ditolak.',
      ));
    }

    baris.appendChild(kartu);
  }

  wadah.appendChild(baris);

  // ── TUJUAN DITAMPILKAN DI BAWAH ──────────────────────────────────────────
  // Ke mana webhook diteruskan menentukan apakah antrean akan bergerak.
  // Tanpa tujuan, pesan hanya dicatat dan tidak pernah terkirim.
  if (tujuan) {
    wadah.appendChild(el('p', 'sentinel-sumber-header', `Diteruskan ke: ${tujuan}`));
  } else {
    wadah.appendChild(el(
      'p',
      'sentinel-sumber-header',
      'Tanpa tujuan (SENTINEL_TUJUAN_URL kosong) — webhook dicatat tapi tidak diteruskan.',
    ));
  }

  wadah.setAttribute('aria-busy', 'false');
}

/* ── Antrean pesan ──────────────────────────────────────────────────────── */

function lencanaStatus(status) {
  const teks = {
    menunggu: 'Menunggu',
    dikirim: 'Terkirim',
    gagal: 'Gagal',
    dlq: 'DLQ',
  }[status] ?? status;

  return el('span', `sentinel-lencana sentinel-lencana--${status}`, teks);
}

function gambarPesan(daftar) {
  const wadah = $('#wadahPesan');
  wadah.replaceChildren();

  if (!daftar.length) {
    wadah.appendChild(el('p', 'sentinel-kosong',
      saringStatus
        ? `Tidak ada pesan dengan status "${saringStatus}".`
        : 'Antrean kosong. Webhook yang masuk akan muncul di sini.'));
    wadah.setAttribute('aria-busy', 'false');
    return;
  }

  const wrap = el('div', 'sentinel-tabel-wrap');
  const tabel = el('table', 'sentinel-tabel');

  const thead = el('thead');
  const trh = el('tr');
  for (const judul of ['Waktu', 'Sumber', 'Tujuan', 'Status', 'Percobaan', 'Latensi', 'Kode']) {
    trh.appendChild(el('th', null, judul));
  }
  thead.appendChild(trh);
  tabel.appendChild(thead);

  const tbody = el('tbody');

  for (const p of daftar) {
    const tr = el('tr');

    tr.appendChild(el('td', null, sejak(p.diterima_at)));

    tr.appendChild(el('td', null, p.sumber));

    const tdTujuan = el('td', 'sentinel-mono');
    tdTujuan.textContent = p.host;
    tr.appendChild(tdTujuan);

    const tdStatus = el('td');
    tdStatus.appendChild(lencanaStatus(p.status));
    // Kalau masih menunggu dan ada jadwal, sebutkan berapa lama lagi.
    if (p.status === 'menunggu' && p.berikutnyaDalamMs > 0) {
      const kaki = el('span', 'sentinel-kartu-kaki', `coba lagi ${durasi(p.berikutnyaDalamMs)}`);
      tdStatus.appendChild(kaki);
    }
    tr.appendChild(tdStatus);

    tr.appendChild(el('td', 'sentinel-mono', `${p.percobaan}`));

    tr.appendChild(el('td', 'sentinel-mono', p.latensi_ms != null ? durasi(p.latensi_ms) : '—'));

    tr.appendChild(el('td', 'sentinel-mono', p.kode_balasan ?? '—'));

    // ── JUDUL BARIS BISA DIKLIK ──────────────────────────────────────────
    // Body tidak ikut di daftar (bisa 256 KB per pesan), jadi detailnya dibuka
    // di panel terpisah saat benar-benar dibutuhkan.
    const tdAksi = el('td');
    const b = el('button', 'sentinel-klik', 'Lihat');
    b.type = 'button';
    b.addEventListener('click', () => bukaDetail(p.id));
    tdAksi.appendChild(b);
    tr.appendChild(tdAksi);

    tbody.appendChild(tr);
  }

  tabel.appendChild(tbody);
  wrap.appendChild(tabel);
  wadah.appendChild(wrap);
  wadah.setAttribute('aria-busy', 'false');
}

/* ── Panel detail ───────────────────────────────────────────────────────── */

function barisDetail(kunci2, nilai) {
  const b = el('div', 'sentinel-baris');
  b.appendChild(el('span', 'sentinel-baris-kunci', kunci2));
  b.appendChild(el('span', 'sentinel-baris-nilai', nilai ?? '—'));
  return b;
}

async function bukaDetail(id) {
  const panel = $('#panelDetail');
  const badan = $('#panelBadan');

  badan.replaceChildren(el('p', 'sentinel-kosong', 'Memuat…'));
  panel.hidden = false;
  $('#panelTutup').focus();

  let data;
  try {
    data = await panggil(`/api/sentinel/pesan/${encodeURIComponent(id)}`);
  } catch (err) {
    badan.replaceChildren(el('p', 'sentinel-galat', err.message));
    return;
  }

  const p = data.pesan;
  badan.replaceChildren();

  badan.appendChild(barisDetail('ID', p.id));
  badan.appendChild(barisDetail('Sumber', p.sumber));
  badan.appendChild(barisDetail('ID peristiwa', p.id_peristiwa ?? '(tidak ada)'));
  badan.appendChild(barisDetail('Tujuan', p.url));
  badan.appendChild(barisDetail('Status', p.status));
  badan.appendChild(barisDetail('Percobaan', `${p.percobaan} dari ${p.maksPercobaan}`));
  badan.appendChild(barisDetail('Kode balasan', p.kode_balasan ?? '—'));
  badan.appendChild(barisDetail('Latensi', p.latensi_ms != null ? durasi(p.latensi_ms) : '—'));
  badan.appendChild(barisDetail('Diterima', sejak(p.diterima_at)));
  badan.appendChild(barisDetail('Ukuran body', `${p.body?.length ?? 0} byte`));

  if (p.pesan_galat) {
    badan.appendChild(barisDetail('Pesan galat', p.pesan_galat));
  }

  // ── BODY DITAMPILKAN APA ADANYA ──────────────────────────────────────────
  // Ia teks, bukan markup. Kalau JSON-nya valid, dirapikan supaya bisa dibaca;
  // kalau tidak, ditampilkan mentah — karena yang perlu diperiksa justru
  // mungkin masalah formatnya.
  badan.appendChild(el('p', 'sentinel-baris-kunci', 'Body'));
  const kode = el('pre', 'sentinel-kode');
  try {
    kode.textContent = JSON.stringify(JSON.parse(p.body), null, 2);
  } catch {
    kode.textContent = p.body || '(kosong)';
  }
  badan.appendChild(kode);

  // Header
  const headerTeks = Object.entries(p.headers ?? {});
  if (headerTeks.length) {
    badan.appendChild(el('p', 'sentinel-baris-kunci', 'Header'));
    const h = el('pre', 'sentinel-kode');
    h.textContent = headerTeks.map(([k, v]) => `${k}: ${v}`).join('\n');
    badan.appendChild(h);
  }

  // ── AKSI ─────────────────────────────────────────────────────────────────
  const aksi = el('div', 'sentinel-panel-aksi');

  if (p.status !== 'dikirim') {
    const kirim = el('button', 'sentinel-tombol sentinel-tombol--kecil', 'Kirim ulang');
    kirim.type = 'button';
    kirim.addEventListener('click', () => kirimUlang(p.id, kirim));
    aksi.appendChild(kirim);
  }

  const tutup = el('button', 'sentinel-tombol sentinel-tombol--kecil', 'Tutup');
  tutup.type = 'button';
  tutup.addEventListener('click', tutupPanel);
  aksi.appendChild(tutup);

  badan.appendChild(aksi);
}

async function kirimUlang(id, tombol) {
  tombol.disabled = true;
  tombol.textContent = 'Mengirim…';

  try {
    const r = await panggil(`/api/sentinel/pesan/${encodeURIComponent(id)}/kirim-ulang`, { metode: 'POST' });

    // ── HASILNYA DITAMPILKAN, BUKAN HANYA "BERHASIL" ─────────────────────
    // Yang menekan tombol ini ingin tahu apakah perbaikannya berhasil. Hasil
    // pengirimannya disebutkan langsung: terkirim, atau gagal dengan pesannya.
    const h = r.hasil ?? {};
    if (h.hasil === 'terkirim') {
      beritahu(`Terkirim. Kode ${h.kode ?? '—'}, ${durasi(h.latensiMs)}.`, 'sukses');
    } else if (h.hasil === 'gagal' || h.hasil === 'dlq') {
      beritahu(`Masih gagal: ${h.galat ?? 'tidak ada keterangan'}`, 'galat');
    } else {
      beritahu(`Hasil: ${h.hasil ?? 'tidak diketahui'}`, '');
    }

    tutupPanel();
    await muatSemua();
  } catch (err) {
    beritahu(err.message, 'galat');
    tombol.disabled = false;
    tombol.textContent = 'Kirim ulang';
  }
}

function tutupPanel() {
  $('#panelDetail').hidden = true;
}

/* ── Muat data ──────────────────────────────────────────────────────────── */

async function muatSemua() {
  if (sedangMemuat) return;
  sedangMemuat = true;

  try {
    const ringkas = await panggil('/api/sentinel/ringkasan');
    gambarRingkasan(ringkas);
    gambarSirkuit(ringkas.sirkuit?.daftar ?? []);

    const jalur = '/api/sentinel/pesan' + (saringStatus ? `?status=${encodeURIComponent(saringStatus)}` : '');
    const daftar = await panggil(jalur);
    gambarPesan(daftar.pesan ?? []);

    // ── MODE KEAMANAN ───────────────────────────────────────────────────────
    // Dimuat bersama data lain: ia menentukan bagaimana angka-angka di
    // halaman ini harus dibaca (mis. toleransi 300s vs 60s).
    await muatMode();

    // ── SUMBER DIMUAT TERAKHIR ──────────────────────────────────────────────
    // Ia bukan data yang berubah cepat, dan kegagalannya tidak boleh
    // menggagalkan tampilan antrean yang lebih penting.
    try {
      const sumber = await panggil('/api/sentinel/sumber');
      gambarSumber(sumber.sumber, sumber.tujuan);
    } catch (err) {
      $('#wadahSumber').replaceChildren(el('p', 'sentinel-galat', err.message));
    }
  } catch (err) {
    // Kegagalan 401 sudah ditangani di `panggil` (kembali ke gerbang).
    // Sisanya ditampilkan di tempat datanya seharusnya muncul.
    const pesan = el('p', 'sentinel-galat', err.message);
    $('#wadahPesan').replaceChildren(pesan);
    $('#wadahSirkuit').replaceChildren(el('p', 'sentinel-galat', err.message));
  } finally {
    sedangMemuat = false;
  }
}

async function kirimSekarang() {
  const b = $('#kirimSekarang');
  b.disabled = true;
  b.textContent = 'Mengirim…';

  try {
    const r = await panggil('/api/sentinel/kirim-sekarang', { metode: 'POST', body: { batas: 20 } });

    // Ringkasannya disebut lengkap: berapa diambil, berapa berhasil, berapa
    // dilewati karena sirkuitnya terbuka. "Berhasil" saja tidak cukup — yang
    // perlu diketahui adalah APAKAH ada yang tertahan.
    const bagian = [
      `${r.terkirim ?? 0} terkirim`,
      `${r.gagal ?? 0} gagal`,
    ];
    if (r.dilewati) bagian.push(`${r.dilewati} dilewati (sirkuit)`);
    if (r.masukDlq) bagian.push(`${r.masukDlq} masuk DLQ`);

    beritahu(bagian.join(' · '), r.gagal ? '' : 'sukses');
    await muatSemua();
  } catch (err) {
    beritahu(err.message, 'galat');
  } finally {
    b.disabled = false;
    b.textContent = 'Kirim sekarang';
  }
}

/* ── Masuk ──────────────────────────────────────────────────────────────── */

function mulai() {
  // ── KUNCI DARI SESI SEBELUMNYA ───────────────────────────────────────────
  // Kalau tab ini belum ditutup, kuncinya masih ada dan pengguna tidak perlu
  // memasukkannya lagi.
  const tersimpan = sessionStorage.getItem(KUNCI_SIMPAN);
  if (tersimpan) {
    // Verifikasi dulu — kuncinya bisa saja sudah diubah di server.
    kunci = tersimpan;
    panggil('/api/sentinel/ringkasan')
      .then(() => bukaInspector(tersimpan))
      .catch(() => bukaGerbang());
  } else {
    bukaGerbang();
  }

  $('#formGerbang')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isi = $('#kunci').value.trim();
    if (!isi) return;

    const tombol = $('#gerbangMasuk');
    const galat = $('#gerbangGalat');
    tombol.disabled = true;
    tombol.textContent = 'Memeriksa…';
    galat.hidden = true;

    kunci = isi;
    try {
      await panggil('/api/sentinel/ringkasan');
      bukaInspector(isi);
    } catch (err) {
      kunci = '';
      galat.textContent = err.message;
      galat.hidden = false;
      tombol.disabled = false;
      tombol.textContent = 'Buka inspector';
    }
  });

  $('#muatUlang')?.addEventListener('click', () => muatSemua());
  $('#keluar')?.addEventListener('click', () => bukaGerbang());
  $('#kirimSekarang')?.addEventListener('click', kirimSekarang);

  // ── TOMBOL MODE: SATU KLIK, LANGSUNG BEKERJA ──────────────────────────────
  // Tanpa dialog konfirmasi — lihat catatan di atas.
  $('#tombolMode')?.addEventListener('click', (e) => {
    const tujuan = e.currentTarget.dataset.modeTujuan;
    if (tujuan) ubahMode(tujuan);
  });

  $('#saringStatus')?.addEventListener('change', (e) => {
    saringStatus = e.target.value;
    muatSemua();
  });

  $('#panelTutup')?.addEventListener('click', tutupPanel);
  $('#panelLatar')?.addEventListener('click', tutupPanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#panelDetail').hidden) tutupPanel();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mulai, { once: true });
} else {
  mulai();
}
