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
  const blok2fa = $('blok2fa');
  const catatan2fa = $('catatan2fa');

  // ── Keadaan 2FA ────────────────────────────────────────────────────────────
  // `perlu2fa` diisi dari server (GET /api/auth/reset-sandi/konteks). Selama
  // masih false, form berperilaku seperti sebelumnya — akun tanpa 2FA tidak
  // melihat perubahan apa pun.
  let perlu2fa = false;

  /** Nilai kode 2FA dari enam kotak, atau '' kalau belum lengkap. */
  function nilaiKode2fa() {
    const sel = document.querySelectorAll('[data-otp-reset]');
    if (!sel.length) return '';
    const nilai = Array.from(sel).map((s) => s.value).join('');
    return /^\d{6}$/.test(nilai) ? nilai : '';
  }

  /** Kosongkan keenam kotak dan fokuskan yang pertama. */
  function resetKode2fa() {
    document.querySelectorAll('[data-otp-reset]').forEach((s) => {
      s.value = '';
      s.classList.remove('is-terisi');
    });
    document.querySelector('[data-otp-reset="0"]')?.focus();
  }

  /**
   * Pasang perilaku enam kotak: maju otomatis, mundur saat hapus, dan tempel.
   *
   * ── KENAPA DITULIS DI SINI, BUKAN DIIMPOR ─────────────────────────────────
   * `auth.js` punya versi yang sama, tapi ia hanya dimuat di halaman masuk dan
   * daftar. Mengimpornya ke halaman ini berarti memuat seluruh logika autentikasi
   * (SSO, passkey, pemulihan) hanya untuk enam kotak — puluhan kilobyte untuk
   * satu komponen. Versi di sini ~25 baris dan tidak bergantung pada apa pun.
   */
  function pasangOtpReset() {
    const sel = Array.from(document.querySelectorAll('[data-otp-reset]'));
    if (!sel.length) return;

    sel.forEach((input, i) => {
      input.addEventListener('input', () => {
        // Hanya angka — kolom lain (spasi, huruf) diabaikan, bukan ditolak
        // dengan pesan: pengguna yang menempel kode dari email sering
        // membawa spasi, dan itu bukan kesalahan.
        input.value = input.value.replace(/\D/g, '').slice(0, 1);
        input.classList.toggle('is-terisi', Boolean(input.value));
        if (input.value && i < sel.length - 1) sel[i + 1].focus();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) {
          e.preventDefault();
          sel[i - 1].value = '';
          sel[i - 1].classList.remove('is-terisi');
          sel[i - 1].focus();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const teks = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6);
        if (!teks) return;
        // Isi mulai dari kotak yang sedang difokuskan.
        for (let k = 0; k < teks.length && i + k < sel.length; k++) {
          sel[i + k].value = teks[k];
          sel[i + k].classList.add('is-terisi');
        }
        sel[Math.min(i + teks.length, sel.length - 1)].focus();
      });
    });
  }

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
  // ── METER KEKUATAN + PENGUMUMAN PEMBACA LAYAR ─────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ── SKOR: 0–4, BUKAN 0–100 ──────────────────────────────────────────────────
  //
  // Meter punya empat segmen, jadi skornya juga 0–4. Menghitung skor 0–100
  // lalu membaginya ke empat akan menciptakan ilusi presisi yang tidak
  // berguna: pengguna tidak bisa membedakan "62" dari "64", dan tidak ada
  // tindakan berbeda untuk keduanya.
  //
  // Yang bisa mereka lakukan: menambah panjang, menambah variasi. Empat
  // tingkat itu cukup untuk menyampaikan "masih kurang" vs "sudah cukup".
  //
  // ── KENAPA PANJANG DIHITUNG DUA KALI (8 dan 12) ─────────────────────────────
  // Delapan karakter adalah syarat MINIMUM — melewatinya tidak otomatis
  // membuat sandi kuat. Dua belas karakter adalah ambang di mana panjang
  // mulai memberi keamanan nyata (NIST SP 800-63B menekankan panjang di atas
  // kompleksitas).
  //
  // Karena itu "Minimal 8 karakter" memenuhi satu syarat, tapi baru memberi
  // poin kedua saat mencapai 12. Meter yang naik penuh di 8 karakter akan
  // berbohong tentang kekuatan sandi.
  const AMBANG = {
    panjang: 8,
    panjangKuat: 12,
  };

  const LABEL = ['', 'Lemah', 'Cukup', 'Baik', 'Kuat'];

  function hitungSkor(sandi) {
    if (!sandi) return 0;
    let skor = 0;
    if (sandi.length >= AMBANG.panjang) skor += 1;
    if (/[a-z]/.test(sandi) && /[A-Z]/.test(sandi)) skor += 1;
    if (/[0-9]/.test(sandi)) skor += 1;
    if (sandi.length >= AMBANG.panjangKuat) skor += 1;
    return skor;
  }

  // ── PENGUMUMAN PEMBACA LAYAR: DEBOUNCED ─────────────────────────────────────
  //
  // ── KENAPA HARUS DEBOUNCED ──────────────────────────────────────────────────
  // Tanpa jeda, setiap huruf yang diketik memicu pengumuman. Pengguna pembaca
  // layar akan mendengar "Lemah… Lemah… Lemah…" puluhan kali, dan itu membuat
  // halaman tidak terpakai — pengumuman saling menimpa sebelum selesai.
  //
  // GSAP Vault menyebutnya "strength announced politely once typing pauses".
  // Jeda 600ms: cukup lama untuk menandakan pengguna berhenti, cukup pendek
  // agar umpan balik tidak terasa tertunda.
  let timerSr = null;

  function umumkanKekuatan(skor) {
    const el = $('kekuatanSr');
    if (!el) return;

    clearTimeout(timerSr);
    timerSr = setTimeout(() => {
      // Kosong: tidak ada yang perlu diumumkan.
      if (skor === 0) { el.textContent = ''; return; }

      const label = LABEL[skor];
      const kurang = 4 - skor;
      el.textContent = kurang === 0
        ? `Kekuatan sandi: ${label}. Semua syarat terpenuhi.`
        : `Kekuatan sandi: ${label}. ${kurang} syarat lagi untuk kuat.`;
    }, 600);
  }

  /** Perbarui meter + label visual. */
  function perbaruiMeter(skor) {
    const meter = $('meterSandi');
    if (meter) {
      // Setiap segmen diberi `data-isi` 1 atau 0. CSS yang mengurus animasi
      // sapuan (arah masuk dari kiri, arah keluar dari kanan) — JS hanya
      // menyatakan KEADAAN, bukan gerakannya.
      [...meter.querySelectorAll('.auth-meter-segmen')].forEach((seg, i) => {
        seg.dataset.isi = i < skor ? '1' : '0';
      });
    }

    const label = $('labelKekuatan');
    if (label) {
      label.textContent = skor > 0 ? LABEL[skor] : '';
      // Menyala hanya saat semua syarat terpenuhi — satu warna status,
      // bukan gradien merah-kuning-hijau.
      label.dataset.kuat = skor >= 4 ? '1' : '0';
    }
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
    const nilai = inpSandi.value;

    // 1. Tanda centang — digambar/dibatalkan lewat CSS stroke-dashoffset.
    periksaSyarat(nilai);

    // 2. Meter kekuatan + label.
    const skor = hitungSkor(nilai);
    perbaruiMeter(skor);

    // 3. Pengumuman pembaca layar — debounced, tidak setiap huruf.
    umumkanKekuatan(skor);

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

    // ── KODE 2FA WAJIB KALAU AKUN MEMAKAINYA ────────────────────────────────
    // Diperiksa di klien hanya untuk umpan balik cepat; server memeriksa ulang
    // dan itulah yang menentukan. Kalau kolomnya kosong, server menjawab
    // `perlu_2fa` — tapi menunggu perjalanan jaringan untuk kesalahan yang
    // jelas terlihat tidak berguna.
    const kode2fa = perlu2fa ? nilaiKode2fa() : '';

    if (perlu2fa && !kode2fa) {
      msgReset.textContent = 'Masukkan 6 digit kode dari aplikasi authenticator Anda.';
      document.querySelector('[data-otp-reset="0"]')?.focus();
      return;
    }

    sibuk(true);

    try {
      const res = await fetch('/api/auth/reset-sandi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sandi, ...(kode2fa ? { kode: kode2fa } : {}) }),
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

      // ── SERVER MINTA KODE 2FA ─────────────────────────────────────────────
      // Terjadi kalau akun memakai 2FA tapi kolomnya belum terisi — misalnya
      // karena pemeriksaan konteks saat halaman dibuka gagal (jaringan putus
      // sesaat), sehingga blok 2FA tidak sempat muncul. Server tetap memeriksa
      // sendiri, jadi jawabannya otoritatif: tampilkan bloknya sekarang.
      if (isi?.error === 'perlu_2fa') {
        perlu2fa = true;
        if (blok2fa) blok2fa.hidden = false;
        if (isi.email_samar && catatan2fa) {
          catatan2fa.textContent =
            `Akun ${isi.email_samar} memakai verifikasi dua langkah. `
            + 'Masukkan 6 digit kode dari aplikasi authenticator Anda.';
        }
        msgReset.textContent = pesan;
        resetKode2fa();
        return;
      }

      // ── KODE 2FA SALAH ────────────────────────────────────────────────────
      // Pesannya sudah spesifik dari server ("Sisa 4 percobaan"). Form tetap
      // terbuka supaya pengguna bisa mencoba kode berikutnya — menutupnya
      // berarti memaksa mereka meminta tautan email baru hanya karena salah
      // ketik satu digit.
      if (isi?.error === 'kode_salah' || isi?.error === 'kode_dipakai_ulang'
          || isi?.error === 'diblokir_sementara' || isi?.error === 'kode_pemulihan_salah') {
        msgReset.textContent = pesan;
        resetKode2fa();
        return;
      }

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

  // ── KONTEKS: apakah akun ini memakai 2FA? ─────────────────────────────────
  //
  // ── KENAPA DITANYAKAN SAAT HALAMAN DIBUKA ─────────────────────────────────
  // Kalau akun memakai 2FA, reset sandi butuh DUA bukti: tautan dari email dan
  // kode authenticator. Menampilkan kolom kode hanya SETELAH pengguna menekan
  // simpan berarti form yang menolak di akhir — terasa seperti kegagalan,
  // padahal itu langkah yang memang diharapkan.
  //
  // Dengan bertanya lebih dulu, kolomnya sudah ada saat pengguna mulai
  // mengetik, dan seluruh syarat terlihat sejak awal.
  //
  // ── KENAPA KEGAGALANNYA DIAM ──────────────────────────────────────────────
  // Kalau permintaan ini gagal (jaringan putus), form tetap bisa dipakai:
  // server memeriksa 2FA sendiri saat submit dan menjawab `perlu_2fa` —
  // yang ditangani di atas dengan menampilkan bloknya. Tidak ada gunanya
  // menampilkan galat untuk sesuatu yang masih bisa diselesaikan.
  (async () => {
    try {
      const res = await fetch(
        `/api/auth/reset-sandi/konteks?token=${encodeURIComponent(token)}`,
        { credentials: 'same-origin', headers: { Accept: 'application/json' } },
      );
      const d = await res.json().catch(() => null);
      if (!d?.ok) return;

      // Token tidak sah (kedaluwarsa/sudah dipakai/akun nonaktif) — tampilkan
      // panel gagal sekarang, jangan biarkan pengguna mengetik sandi baru
      // untuk tautan yang tidak akan pernah bekerja.
      if (!d.token_sah) {
        $('judulGagal').textContent = 'Tautan tidak berlaku lagi';
        $('pesanGagal').textContent = d.pesan
          || 'Tautan ini tidak berlaku lagi. Minta tautan baru dari halaman lupa sandi.';
        tampilkanPanel('gagal');
        return;
      }

      if (d.perlu_2fa) {
        perlu2fa = true;
        if (blok2fa) blok2fa.hidden = false;
        if (d.email_samar && catatan2fa) {
          catatan2fa.textContent =
            `Akun ${d.email_samar} memakai verifikasi dua langkah. `
            + 'Masukkan 6 digit kode dari aplikasi authenticator Anda.';
        }
      }
    } catch { /* biarkan form apa adanya — server tetap memeriksa saat submit */ }
  })();

  // Perilaku enam kotak (maju otomatis, hapus mundur, tempel) dipasang SEKALI
  // saat halaman dimuat — listener bekerja pada elemen `hidden`; hanya fokus
  // yang butuh elemen terlihat.
  pasangOtpReset();

  // Fokuskan kolom sandi — pengguna datang ke halaman ini dengan satu tugas.
  // Menunda fokus sampai panel terlihat supaya tidak menggulir halaman.
  requestAnimationFrame(() => inpSandi.focus());
})();
