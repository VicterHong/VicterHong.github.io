/**
 * Halaman reset sandi — ambil token dari URL, validasi sandi, kirim ke backend.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA HALAMAN INI ADA ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Backend sudah lama mengirim email berisi tautan
 * `https://…/reset-sandi?token=…`, tapi halaman tujuan tautan itu TIDAK PERNAH
 * DIBUAT. Setiap pengguna yang lupa sandi mendapat 404 — dan itu baru ketahuan
 * setelah ada yang melaporkannya.
 *
 * Pelajarannya: tautan yang dikirim ke pengguna harus diuji seperti halaman
 * lain. "Kode pengirimnya sudah ada" bukan bukti halamannya ada.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── YANG DILAKUKAN HALAMAN INI ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Ambil token dari query string. Tidak ada token → tampilkan panel gagal.
 *   2. Periksa kekuatan sandi saat pengguna mengetik (tiga syarat, umpan balik
 *      spesifik — bukan skor abstrak).
 *   3. Periksa kecocokan kedua kolom saat pengguna selesai mengetik.
 *   4. Kirim ke POST /api/auth/reset-sandi, tampilkan hasilnya.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA TOKEN TIDAK DIPERIKSA DULU KE SERVER ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Godaan pertama: panggil endpoint "cek token" saat halaman dimuat, baru
 * tampilkan form kalau token sah.
 *
 * Itu SALAH untuk halaman ini karena:
 *   • Tidak ada endpoint cek-token, dan menambahkannya berarti menambah
 *     permukaan serangan: endpoint itu bisa dipakai menebak token.
 *   • Token di URL adalah satu-satunya bukti. Kalau token salah, backend
 *     menolaknya saat submit — pesannya sama jelasnya.
 *   • Menambah satu perjalanan jaringan sebelum form muncul membuat halaman
 *     terasa lambat tanpa manfaat.
 *
 * Jadi: form langsung tampil, dan kesalahan token muncul saat submit.
 * Untuk kasus yang jelas (tidak ada token di URL), panel gagal langsung
 * ditampilkan tanpa menunggu submit.
 */

(function () {
  'use strict';

  // ── Elemen ─────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const formReset = $('formReset');
  const inpSandi = $('inpSandi');
  const inpUlangi = $('inpUlangi');
  const btnRevealSandi = $('btnRevealSandi');
  const btnRevealUlangi = $('btnRevealUlangi');
  const btnSimpan = $('btnSimpan');
  const msgCocok = $('msgCocok');
  const msgReset = $('msgReset');
  const daftarSyarat = $('daftarSyarat');

  // ── Token dari URL ─────────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const token = (params.get('token') ?? '').trim();

  // Email akun yang sandinya berubah — DIISI DARI RESPONS SERVER, bukan dari
  // input pengguna. Lihat penjelasan di isiDataSukses().
  let emailAkun = null;

  // ── Panel ──────────────────────────────────────────────────────────────────
  function tampilkanPanel(nama) {
    for (const p of document.querySelectorAll('.auth-panel')) {
      p.classList.toggle('is-active', p.dataset.panel === nama);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── SYARAT SANDI ──────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ── KENAPA TIGA SYARAT, BUKAN "MINIMAL 8 KARAKTER" SAJA ───────────────────
  //
  // NIST SP 800-63B (panduan sandi resmi) menganjurkan panjang sebagai faktor
  // utama, dan TIDAK mewajibkan campuran karakter. Tapi itu berlaku untuk
  // sistem yang sudah menerapkan pemeriksaan sandi bocor (breach check) —
  // dan sistem ini belum.
  //
  // Tanpa breach check, campuran karakter adalah pengaman yang murah: ia
  // menaikkan biaya serangan kamus tanpa membebani pengguna secara berarti.
  // Yang penting: syaratnya DIKATAKAN DI AWAL, bukan muncul sebagai error
  // setelah submit.
  //
  // Backend tetap memvalidasi ulang — pemeriksaan di sini hanya untuk umpan
  // balik, bukan pengamanan.

  const SYARAT = {
    panjang: (s) => s.length >= 8,
    huruf: (s) => /[a-z]/.test(s) && /[A-Z]/.test(s),
    angka: (s) => /[0-9]/.test(s),
  };

  function periksaSyarat(sandi) {
    for (const [nama, uji] of Object.entries(SYARAT)) {
      const item = daftarSyarat.querySelector(`[data-syarat="${nama}"]`);
      if (item) item.classList.toggle('terpenuhi', uji(sandi));
    }
  }

  function semuaSyaratTerpenuhi(sandi) {
    return Object.values(SYARAT).every((uji) => uji(sandi));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── TOMBOL LIHAT SANDI ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Satu handler untuk dua tombol — perilakunya identik, hanya kolomnya beda.
  function pasangReveal(tombol, kolom) {
    if (!tombol || !kolom) return;

    tombol.addEventListener('click', () => {
      const sedangTertutup = kolom.type === 'password';
      kolom.type = sedangTertutup ? 'text' : 'password';
      tombol.setAttribute('aria-pressed', String(sedangTertutup));
      tombol.setAttribute(
        'aria-label',
        sedangTertutup ? 'Sembunyikan sandi' : 'Tampilkan sandi',
      );
      // Kembalikan fokus ke kolom — pengguna biasanya lanjut mengetik.
      kolom.focus();
    });
  }

  pasangReveal(btnRevealSandi, inpSandi);
  pasangReveal(btnRevealUlangi, inpUlangi);

  // ══════════════════════════════════════════════════════════════════════════
  // ── UMPAN BALIK SAAT MENGETIK ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  inpSandi.addEventListener('input', () => {
    periksaSyarat(inpSandi.value);
    // Pesan kecocokan lama tidak lagi relevan setelah sandi pertama berubah.
    if (msgCocok.textContent) msgCocok.textContent = '';
  });

  inpUlangi.addEventListener('input', () => {
    // ── KENAPA PESAN MUNCUL SAAT MENGETIK, BUKAN SETELAH BLUR ───────────────
    // Pengguna yang mengetik ulang dengan salah perlu tahu SEKARANG, saat
    // mereka masih ingat apa yang baru diketik. Menunggu blur berarti mereka
    // sudah pindah perhatian.
    //
    // Tapi hanya muncul kalau kolom ulangi sudah cukup panjang — kalau muncul
    // sejak karakter pertama, ia berkedip "tidak cocok" sepanjang pengetikan
    // dan itu mengganggu, bukan membantu.
    if (inpUlangi.value.length >= inpSandi.value.length && inpUlangi.value.length > 0) {
      msgCocok.textContent = inpUlangi.value === inpSandi.value
        ? ''
        : 'Sandi belum sama.';
    } else {
      msgCocok.textContent = '';
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── ISI DATA SUKSES ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ── KENAPA MENAMPILKAN EMAIL DAN WAKTU ─────────────────────────────────────
  //
  // Layar sukses yang hanya bilang "berhasil" tidak menjawab pertanyaan yang
  // sebenarnya ada di kepala pengguna:
  //
  //   "Akun mana yang tadi saya reset?"        → email
  //   "Kapan itu terjadi?"                     → waktu
  //   "Ada yang perlu saya lakukan lagi?"      → catatan konsekuensi
  //
  // Menampilkan email juga mencegah kebingungan pada pengguna dengan beberapa
  // akun — mereka bisa memastikan akun yang benar yang berubah.
  //
  // Waktu adalah BUKTI. Kalau pengguna melihat waktu yang tidak dikenali,
  // itu sinyal ada akses tidak sah — dan mereka bisa segera bertindak.
  // Tanpa waktu, mereka tidak punya cara tahu.
  //
  // ── KENAPA EMAIL DIAMBIL DARI SERVER, BUKAN DARI INPUT ─────────────────────
  // Kolom email di form BISA diisi siapa saja. Kalau ditampilkan apa adanya,
  // penyerang yang membuka tautan orang lain akan melihat email korbannya —
  // dan itu membocorkan informasi. Server hanya mengirim email kalau tokennya
  // memang sah untuk akun itu.
  function isiDataSukses() {
    const elAkun = $('suksesAkun');
    const elWaktu = $('suksesWaktu');

    if (elAkun) {
      // `emailAkun` diisi dari respons server (lihat bawah). Kalau tidak ada,
      // tampilkan tanda pisah — jangan menebak dari input.
      elAkun.textContent = emailAkun ?? '—';
    }

    if (elWaktu) {
      // ── FORMAT WAKTU INDONESIA ──────────────────────────────────────────────
      // `toLocaleString` dengan locale 'id-ID' dan timeZone 'Asia/Jakarta'.
      //
      // ── KENAPA TIMEZONE DITULIS EKSPLISIT ───────────────────────────────────
      // Tanpa ini, waktu mengikuti zona perangkat. Pengguna yang sedang di
      // luar negeri akan melihat waktu lokal mereka — padahal yang penting
      // adalah kapan perubahan terjadi di akun, dalam zona yang mereka kenal
      // (WIB untuk pengguna Indonesia).
      //
      // `hour12: false` — format 24 jam, standar di Indonesia.
      try {
        elWaktu.textContent = new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date()) + ' WIB';
      } catch {
        // Peramban lama tanpa Intl lengkap — tampilkan apa adanya.
        elWaktu.textContent = new Date().toLocaleString('id-ID');
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── KIRIM ─────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  function sibuk(ya) {
    btnSimpan.disabled = ya;
    btnSimpan.classList.toggle('is-loading', ya);
    inpSandi.disabled = ya;
    inpUlangi.disabled = ya;
  }

  formReset.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btnSimpan.disabled) return;

    const sandi = inpSandi.value;
    const ulangi = inpUlangi.value;

    msgReset.textContent = '';
    msgCocok.textContent = '';

    // ── Validasi sisi klien — hanya untuk pesan cepat ───────────────────────
    // Backend memvalidasi ulang; ini semata supaya pengguna tidak menunggu
    // perjalanan jaringan untuk kesalahan yang jelas.
    if (!token) {
      tampilkanPanel('gagal');
      return;
    }

    if (!semuaSyaratTerpenuhi(sandi)) {
      msgReset.textContent = 'Sandi belum memenuhi semua syarat di atas.';
      inpSandi.focus();
      return;
    }

    if (sandi !== ulangi) {
      msgCocok.textContent = 'Sandi belum sama.';
      inpUlangi.focus();
      return;
    }

    sibuk(true);

    try {
      const res = await fetch('/api/auth/reset-sandi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sandi }),
        credentials: 'same-origin',
      });

      let isi = null;
      try { isi = await res.json(); } catch { /* balasan bukan JSON */ }

      if (res.ok && isi?.ok) {
        // Email diambil dari respons server — hanya ada kalau tokennya sah.
        emailAkun = isi.email ?? null;
        isiDataSukses();
        tampilkanPanel('sukses');
        return;
      }

      // ── PESAN DARI SERVER DIPAKAI APA ADANYA ──────────────────────────────
      // Server sudah mengirim pesan berbahasa Indonesia yang spesifik
      // ("Tautan tidak valid atau sudah dipakai", dst). Menimpanya dengan teks
      // sendiri berarti membuang informasi yang lebih berguna.
      const pesan = isi?.message ?? 'Tautan tidak bisa dipakai. Minta tautan baru.';

      // Token kedaluwarsa/salah adalah keadaan akhir — tampilkan panel gagal
      // daripada membiarkan pengguna mencoba berulang kali di form yang sama.
      if (isi?.error === 'reset_gagal' || isi?.error === 'token_kosong') {
        $('pesanGagal').textContent = pesan;
        tampilkanPanel('gagal');
        return;
      }

      msgReset.textContent = pesan;
    } catch {
      msgReset.textContent = 'Tidak bisa menghubungi server. Coba lagi sebentar lagi.';
    } finally {
      sibuk(false);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── AWAL ──────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  // Tidak ada token di URL = tautan tidak lengkap. Tampilkan panel gagal
  // langsung — tidak ada gunanya menampilkan form yang tidak akan berhasil.
  if (!token) {
    $('judulGagal').textContent = 'Tautan tidak lengkap';
    $('pesanGagal').textContent =
      'Tautan ini tidak memuat kode reset. Pastikan Anda membuka tautan '
      + 'lengkap dari email — atau minta tautan baru.';
    tampilkanPanel('gagal');
    return;
  }

  // Fokuskan kolom sandi — pengguna datang ke halaman ini dengan satu tugas.
  // Menunda fokus sampai panel terlihat supaya tidak menggulir halaman.
  requestAnimationFrame(() => inpSandi.focus());
})();
