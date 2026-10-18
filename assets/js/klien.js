/**
 * AREA KLIEN — daftar proyek + token akses.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA VANILLA, BUKAN REACT + MOTION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Komponen asalnya (animated-collection, 21st.dev) memakai React, motion, dan
 * Tailwind. Versi minified dari ketiganya = 363 KB (117 KB gzip) — untuk
 * animasi yang di sini ditulis dalam ~150 baris CSS.
 *
 * Situs ini nol dependency, dan presedennya sudah ada: How It Works dan kartu
 * zigzag Visi & Misi juga dari 21st.dev dan sudah di-port dengan cara sama.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * YANG DIPERTAHANKAN DARI SUMBER ASLINYA
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   · Tiga tampilan: list, card, pack
 *   · Susunan "pack": kartu bertumpuk dengan rotasi berlawanan arah
 *   · Nomor urut di tiap item (#209 di sumber, di sini 01, 02, …)
 *   · Lencana di tiap item
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TAMPILAN "PACK" CUMA MENAMPILKAN SATU KARTU
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Di sumber aslinya, "pack" adalah tumpukan kartu yang saling menimpa dengan
 * rotasi — cocok untuk galeri dua item. Di sini isinya proyek teknis yang
 * tiap-tiapnya punya nama dan status akses yang perlu dibaca.
 *
 * Kalau ditumpuk seperti aslinya, kartu paling atas menutupi yang lain, dan
 * pengguna tidak bisa membaca status proyek kedua. Jadi "pack" di sini
 * menampilkan SATU kartu pada satu waktu dengan tombol sebelumnya/berikutnya
 * — tumpukan yang bisa dibuka, bukan tumpukan yang menutupi.
 */

const $ = (sel, akar = document) => akar.querySelector(sel);

const API = {
  ringkasan: '/api/klien/ringkasan',
  proyek: '/api/klien/proyek',
  // `token: '/api/klien/token'` DIHAPUS: halaman ini tidak lagi menampilkan
  // atau membuat token akses. Endpoint-nya tetap ada di backend untuk admin
  // dan integrasi, tapi tidak dipanggil dari UI pengguna.
  star: '/api/klien/star',
};

/** Ikon status — dari assets/js/icons.js, bukan pustaka ikon baru. */
const IKON = {
  terbuka: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  terkunci: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  bintang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/></svg>',
};

// ── STATUS BARU: LIMA, BUKAN EMPAT ───────────────────────────────────────────
// Aturan lama: satu proyek per akun, wajib star. Statusnya cuma "terbuka" dan
// "terkunci".
//
// Aturan baru: tiga proyek langsung dari login, dua lagi dari star. Sekarang
// ada lima status, dan yang penting bagi pengguna bukan "terbuka atau
// terkunci", tapi APA YANG HARUS DILAKUKAN untuk membukanya:
//
//   terbuka              → paket berbayar, semua proyek terbuka
//   sudah-dibuka         → proyek ini termasuk yang sudah dia buka
//   terkunci-bisa-buka   → masih ada jatah, tinggal tekan
//   terkunci-perlu-star  → jatah login habis, star menambah 2
//   terkunci-jatah-habis → tidak ada jalan gratis lagi
const LABEL_STATUS = {
  terbuka: 'Terbuka',
  'sudah-dibuka': 'Sudah dibuka',
  'terkunci-bisa-buka': 'Bisa dibuka',
  'terkunci-perlu-star': 'Perlu star',
  'terkunci-jatah-habis': 'Perlu langganan',
};

/** Panggil API. Melempar dengan pesan yang bisa ditampilkan kalau gagal. */
async function panggilApi(url, opsi = {}) {
  // ── MENERUSKAN PARAMETER UJI ──────────────────────────────────────────────
  // Server uji memakai `?mode=gratis|standar|profesional|enterprise` untuk
  // meniru paket yang berbeda. Halaman perlu meneruskannya ke API, kalau
  // tidak, semua mode menampilkan jawaban yang sama.
  //
  // Di produksi parameter ini TIDAK ADA di URL, jadi blok ini tidak
  // melakukan apa-apa — dan server produksi mengabaikannya.
  const mode = new URLSearchParams(location.search).get('mode');
  const urlAkhir = mode ? `${url}${url.includes('?') ? '&' : '?'}mode=${encodeURIComponent(mode)}` : url;

  const res = await fetch(urlAkhir, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...opsi,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Server menjawab bukan-JSON (mis. halaman error HTML). Pesan di bawah
    // yang dipakai, bukan error parse yang membingungkan.
  }

  if (res.status === 401) {
    // Sesi habis. Kirim ke halaman masuk, dan simpan tujuan supaya pengguna
    // kembali ke sini setelah masuk — bukan ke beranda.
    const tujuan = encodeURIComponent(location.pathname);
    location.href = `/sign-in?lanjut=${tujuan}`;
    throw new Error('Sesi berakhir. Mengalihkan ke halaman masuk…');
  }

  if (!res.ok || data.ok === false) {
    // ── BUG YANG DIPERBAIKI: KODE MENTAH DITAMPILKAN KE PENGGUNA ────────────
    // Versi pertama memakai `data.error` sebagai pesan kalau `data.pesan`
    // tidak ada. Akibatnya pengguna melihat "tidak_ditemukan" — kode internal
    // dengan garis bawah, yang tidak menjelaskan apa pun.
    //
    // Aturannya: yang ditampilkan ke pengguna hanya `pesan` (kalimat lengkap
    // dari server). Kalau tidak ada, pakai kalimat umum yang menjelaskan APA
    // yang gagal dan APA yang bisa dilakukan — bukan kode mentahnya.
    //
    // Kode aslinya tetap disimpan di `err.kode` untuk log, tidak untuk layar.
    const pesan = data.pesan
      || (res.status === 404
        ? 'Fitur ini belum tersedia. Coba lagi nanti.'
        : res.status === 403
          ? 'Anda belum punya akses ke bagian ini.'
          : res.status >= 500
            ? 'Server sedang bermasalah. Coba beberapa saat lagi.'
            : 'Tidak bisa memuat data. Coba muat ulang halaman.');
    const err = new Error(pesan);
    err.status = res.status;
    err.kode = data.error || null;
    throw err;
  }

  return data;
}

// ── FORMAT ───────────────────────────────────────────────────────────────────

/**
 * Nomor urut item, tiga digit. Mengikuti pola #209 / #808 di sumber aslinya.
 *
 * ── KENAPA TIGA DIGIT, BUKAN SATU ──────────────────────────────────────────
 * "01" dan "1" sama-sama jelas, tapi nomor berpadding membuat lebarnya sama
 * untuk semua item — jadi daftarnya rata saat dipindai. Angka yang lebarnya
 * berbeda-beda membuat mata tersandung di setiap baris.
 */
const nomorItem = (i) => String(i + 1).padStart(3, '0');

/** Inisial proyek untuk kotak gambar: "Spareparts Inventory" → "SI". */
function inisial(nama) {
  return String(nama || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((k) => k[0].toUpperCase())
    .join('');
}

// ── RENDER: KARTU PROYEK ─────────────────────────────────────────────────────

/**
 * Satu kartu proyek.
 *
 * ── KENAPA TIDAK MEMAKAI innerHTML DENGAN DATA DARI SERVER ─────────────────
 * Nama dan ringkasan proyek datang dari server. Kalau disisipkan lewat
 * innerHTML, karakter seperti `<` di dalamnya akan diurai sebagai HTML —
 * dan itu jalan masuk XSS. Semua teks di sini dipasang dengan textContent;
 * hanya markup yang SAYA tulis sendiri yang memakai innerHTML.
 */
function buatKartu(proyek, indeks) {
  const li = document.createElement('li');
  li.className = 'klien-kartu';

  // Kotak gambar: inisial + nomor urut.
  const gambar = document.createElement('div');
  gambar.className = 'klien-gambar';
  gambar.setAttribute('aria-hidden', 'true');
  gambar.textContent = inisial(proyek.nama);

  const nomor = document.createElement('span');
  nomor.className = 'klien-nomor';
  nomor.textContent = '#' + nomorItem(indeks);
  gambar.append(nomor);
  li.append(gambar);

  const isi = document.createElement('div');
  isi.className = 'klien-isi';

  const nama = document.createElement('h3');
  nama.className = 'klien-nama';
  nama.textContent = proyek.nama;
  isi.append(nama);

  if (proyek.subtitle) {
    const sub = document.createElement('p');
    sub.className = 'klien-sub';
    sub.textContent = proyek.subtitle;
    isi.append(sub);
  }

  // Lencana status — warna DAN ikon, bukan hanya teks. Pengguna yang memindai
  // cepat melihat warnanya, bukan membaca labelnya.
  const status = document.createElement('span');
  status.className = 'klien-status';
  status.dataset.status = proyek.status;
  status.innerHTML = proyek.status === 'terbuka' ? IKON.terbuka
    : proyek.status === 'sudah-dibuka' ? IKON.bintang
      : IKON.terkunci;
  const labelStatus = document.createElement('span');
  labelStatus.textContent = LABEL_STATUS[proyek.status] || proyek.status;
  status.append(labelStatus);
  isi.append(status);

  // Tombol: hanya muncul kalau ada yang bisa dilakukan.
  const aksi = document.createElement('div');
  aksi.className = 'klien-aksi';

  // Daftar status yang berarti "metriknya boleh dibaca" — sama dengan
  // STATUS_TERBUKA di backend.
  const terbuka = proyek.status === 'terbuka' || proyek.status === 'sudah-dibuka';

  if (terbuka || proyek.status === 'terkunci-bisa-buka') {
    const lihat = document.createElement('button');
    lihat.type = 'button';
    lihat.className = 'klien-btn';
    lihat.textContent = 'Buka proyek';
    lihat.addEventListener('click', async () => {
      lihat.disabled = true;
      try {
        const data = await panggilApi(`${API.proyek}/${encodeURIComponent(proyek.slug)}/metrik`, { method: 'POST', body: '{}' });
        let detail = isi.querySelector('.klien-detail-proyek');
        if (!detail) {
          detail = document.createElement('div');
          detail.className = 'klien-detail-proyek';
          isi.append(detail);
        }
        detail.replaceChildren();
        for (const m of data.metrik || []) {
          const row = document.createElement('p');
          row.textContent = `${m.label}: ${m.value}`;
          detail.append(row);
        }
        for (const h of data.highlights || []) {
          const row = document.createElement('p');
          row.textContent = `${h.title}: ${h.detail}`;
          detail.append(row);
        }
        labelStatus.textContent = 'Sudah dibuka';
        lihat.textContent = 'Muat ulang data proyek';
        renderPaket(await panggilApi(API.ringkasan));
      } catch (err) {
        lihat.textContent = err.message;
      } finally { lihat.disabled = false; }
    });
    aksi.append(lihat);
  } else {
    const kunci = document.createElement('span');
    kunci.className = 'klien-btn';
    kunci.style.cursor = 'default';
    // ── LABEL MENJELASKAN SYARATNYA, BUKAN CUMA AKSNYA ──────────────────────
    // Pengguna yang menekan tombol lalu menemukan proyek lain masih terkunci
    // akan mengira tombolnya rusak — padahal jatahnya memang terbatas.
    //
    // Tiga keadaan, tiga label berbeda: masih ada jatah, jatah habis tapi star
    // bisa menambah, dan tidak ada jalan gratis lagi.
    kunci.textContent = proyek.status === 'terkunci-bisa-buka'
      ? 'Buka proyek ini'
      : proyek.status === 'terkunci-perlu-star'
        ? 'Beri star, tambah 2 proyek'
        : 'Berlangganan untuk membuka';
    aksi.append(kunci);
  }

  if (aksi.children.length) isi.append(aksi);
  li.append(isi);

  return li;
}

// ── RENDER: TAMPILAN PACK ────────────────────────────────────────────────────

/**
 * Tampilan "tumpuk": satu kartu pada satu waktu, dengan tumpukan di belakang.
 *
 * Kartu di belakang ditampilkan dengan rotasi dan skala yang berbeda, jadi
 * terlihat seperti tumpukan — tapi tidak menutupi kartu depan.
 */
let indeksPack = 0;

function renderPack(daftar, host) {
  // ── BUG YANG DIPERBAIKI: KARTU LAMA TERTINGGAL ───────────────────────────
  // `host.innerHTML = ''` mengosongkan wadah PACK, tapi kartu list ada di
  // wadah BERBEDA (`#klienDaftar`). Saat berpindah ke pack, kartu list masih
  // ada di DOM — dan pemeriksaan `document.querySelectorAll('.klien-kartu')`
  // menghitung keduanya: 3 (list, tersembunyi) + 3 (pack) = 6.
  //
  // Yang salah bukan cuma angkanya: kartu list yang tersembunyi tetap
  // membebani layout dan tetap dibaca pembaca layar.
  //
  // Sekarang wadah yang tidak aktif DIKOSONGKAN, bukan hanya disembunyikan.
  host.innerHTML = '';
  if (!daftar.length) return;

  indeksPack = Math.max(0, Math.min(indeksPack, daftar.length - 1));

  const panggung = document.createElement('div');
  panggung.style.cssText = 'position:relative;min-height:260px;display:grid;place-items:center;padding:2rem 0;';

  // Kartu belakang: dua berikutnya, dengan rotasi berlawanan arah.
  for (let i = Math.min(daftar.length - 1, indeksPack + 2); i > indeksPack; i--) {
    const belakang = buatKartu(daftar[i], i);
    const jarak = i - indeksPack;
    belakang.style.cssText = `
      position:absolute;max-width:26rem;width:100%;
      transform: rotate(${jarak % 2 === 0 ? 4 : -4}deg) scale(${1 - jarak * 0.04});
      opacity:${0.45 - (jarak - 1) * 0.2};
      pointer-events:none;z-index:${10 - jarak};
    `;
    panggung.append(belakang);
  }

  // Kartu depan.
  const depan = buatKartu(daftar[indeksPack], indeksPack);
  depan.style.cssText = 'position:relative;max-width:26rem;width:100%;z-index:20;';
  panggung.append(depan);

  host.append(panggung);

  // Navigasi tumpukan.
  if (daftar.length > 1) {
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:1rem;margin-top:1rem;';

    const sebelum = document.createElement('button');
    sebelum.type = 'button';
    sebelum.className = 'klien-btn';
    sebelum.textContent = 'Sebelumnya';
    sebelum.disabled = indeksPack === 0;
    sebelum.addEventListener('click', () => {
      indeksPack -= 1;
      renderPack(daftar, host);
    });

    const hitung = document.createElement('span');
    hitung.className = 'klien-token-meta';
    hitung.textContent = `${indeksPack + 1} dari ${daftar.length}`;

    const sesudah = document.createElement('button');
    sesudah.type = 'button';
    sesudah.className = 'klien-btn';
    sesudah.textContent = 'Berikutnya';
    sesudah.disabled = indeksPack >= daftar.length - 1;
    sesudah.addEventListener('click', () => {
      indeksPack += 1;
      renderPack(daftar, host);
    });

    nav.append(sebelum, hitung, sesudah);
    host.append(nav);
  }
}

// ── STATUS PAKET ─────────────────────────────────────────────────────────────

function renderPaket(ringkas) {
  const nama = $('#klienPaketNama');
  const info = $('#klienPaketInfo');
  const halo = $('#klienHalo');

  halo.textContent = ringkas.nama ? `Halo, ${ringkas.nama}.` : 'Selamat datang.';
  nama.textContent = ringkas.paket;

  const k = ringkas.kuota;

  if (!ringkas.berbayar) {
    // Pengguna gratis: yang penting bukan "sisa token 0", tapi APA yang bisa
    // dilakukan untuk membukanya.
    // ── JATAH PROYEK DITAMPILKAN SEBAGAI ANGKA ──────────────────────────────
    // Pengguna gratis perlu tahu BERAPA proyek lagi yang bisa dia buka — itu
    // yang menentukan apakah dia perlu memberi star atau berlangganan.
    //
    // "Sisa 2 dari 5" jauh lebih berguna daripada "jatah habis" tanpa angka.
    //
    // ── PESANNYA BEDA TERGANTUNG MASIH ADA JALAN GRATIS ATAU TIDAK ──────────
    // Kalau masih ada jatah: beri tahu sisa dan cara memakainya.
    // Kalau habis tapi belum star: sebut star sebagai jalan keluar.
    // Kalau habis dan sudah star: baru sebut berlangganan.
    const m = ringkas.metrik ?? {};

    if (m.total != null && m.sisa > 0) {
      info.textContent = `Jatah gratis: ${m.sisa} dari ${m.total} proyek tersisa. `
        + 'Buka proyek mana pun untuk membaca data metriknya.';
    } else if (m.bonusStarTersedia > 0) {
      info.textContent = `Jatah ${m.total} proyek sudah terpakai. `
        + `Beri star untuk menambah ${m.bonusStarTersedia} proyek lagi.`;
    } else {
      info.textContent = 'Jatah gratis sudah terpakai semua. '
        + 'Berlangganan untuk membuka metrik seluruh proyek.';
    }
    return;
  }

  if (k.tanpaBatas) {
    info.textContent = 'Token akses tanpa batas. Data metrik semua proyek terbuka.';
    return;
  }

  const sisa = document.createElement('span');
  info.textContent = '';
  info.append('Sisa token bulan ini: ');
  const kuat = document.createElement('strong');
  kuat.textContent = `${k.sisa} dari ${k.total}`;
  sisa.append(kuat);
  info.append(sisa);
  info.append(` · jatah baru dalam ${k.hariSampaiReset} hari`);
}

// ── ALUR UTAMA ───────────────────────────────────────────────────────────────

let proyekCache = [];
let tampilanAktif = 'list';

function renderDaftar() {
  const daftar = $('#klienDaftar');
  const pack = $('#klienPack');

  if (tampilanAktif === 'pack') {
    daftar.hidden = true;
    // Wadah list DIKOSONGKAN, bukan hanya disembunyikan. Kartu yang tetap ada
    // di DOM ikut terhitung saat diuji, membebani layout, dan dibaca pembaca
    // layar — padahal pengguna sedang melihat tampilan pack.
    daftar.innerHTML = '';
    pack.hidden = false;
    renderPack(proyekCache, pack);
    return;
  }

  pack.hidden = true;
  // Kebalikannya: wadah pack dikosongkan saat pindah ke list/card.
  pack.innerHTML = '';
  daftar.hidden = false;
  daftar.dataset.tampilan = tampilanAktif;
  daftar.innerHTML = '';
  proyekCache.forEach((p, i) => daftar.append(buatKartu(p, i)));
}

function pasangTab() {
  // Tab tampilan.
  for (const tombol of document.querySelectorAll('#klienTab button')) {
    tombol.addEventListener('click', () => {
      tampilanAktif = tombol.dataset.tampilan;
      for (const t of document.querySelectorAll('#klienTab button')) {
        t.setAttribute('aria-selected', String(t === tombol));
      }
      renderDaftar();
    });
  }

  // ── TAB UTAMA: PROYEK / TOKEN → TOKEN DIHAPUS ─────────────────────────────
  //
  // Halaman ini dulu punya dua tab: Proyek dan Token akses. Tab Token
  // menampilkan paket, cakupan, masa berlaku, dan tombol "Buat token baru".
  //
  // Token akses adalah kredensial INTEGRASI untuk skrip/API — bukan identitas
  // akun. Pemilik akun tidak perlu melihat metadata itu, dan menampilkannya
  // membuat token terkesan milik pribadi akun tersebut.
  //
  // Sekarang halaman hanya berisi daftar proyek; panel proyek selalu terlihat.
  const panelProyek = $('#panelProyek');
  if (panelProyek) panelProyek.hidden = false;
}

async function mulai() {
  const kerangka = $('#klienKerangka');
  const galat = $('#klienGalat');

  try {
    // Ringkasan dan proyek diambil bersamaan — keduanya tidak saling
    // bergantung, jadi tidak ada alasan menunggu satu selesai dulu.
    const [ringkas, proyek] = await Promise.all([
      panggilApi(API.ringkasan),
      panggilApi(API.proyek),
    ]);

    renderPaket(ringkas);
    proyekCache = proyek.proyek || [];
    renderDaftar();
  } catch (err) {
    galat.hidden = false;
    galat.className = 'klien-galat';
    galat.textContent = err.message;
  } finally {
    kerangka.hidden = true;
  }
}

pasangTab();
mulai();
