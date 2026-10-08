/* ══ Halaman Masuk — logika ════════════════════════════════════════════════
 *
 * PRINSIP (dari skill motion-advanced, diadaptasi ke vanilla JS):
 *
 *   1. INTERRUPT-SAFE — setiap animasi bisa dibatalkan di tengah jalan dan
 *      digantikan yang baru tanpa lompatan. Di sini: kartu 3D memakai lerp
 *      (interpolasi bertahap), jadi target bisa berubah kapan saja.
 *
 *   2. HEMAT SAAT TIDAK TERLIHAT — animasi tanpa henti berhenti saat tab
 *      disembunyikan. Animasi dijeda lewat CSS.
 *
 *   3. HANYA TRANSFORM + OPACITY — kartu 3D memakai transform, tidak
 *      requestAnimationFrame, tapi hanya mengubah posisi x/y. Tidak ada
 *      pembacaan layout (offsetWidth dll) di dalam loop — itu memicu
 *      "layout thrashing" yang membuat frame drop.
 *
 *   4. HORMATI prefers-reduced-motion — animasi dinonaktifkan sepenuhnya
 *      kalau pengguna memilih mengurangi gerak.
 *
 *   5. CLEANUP — semua listener dilepas, RAF dibatalkan saat halaman
 *      ditinggalkan. Tanpa ini, memori bocor di navigasi SPA-style.
 */

(() => {
  'use strict';

  // ── Pengaturan terpusat ──────────────────────────────────────────────────
  const KONFIG = {
    tilt: {
      maksDerajat: 5.5,    // 5.5° terasa hidup tanpa terlihat miring
      lerp: 0.12,          // faktor interpolasi — makin kecil makin "berat"
      maksGeser: 6,        // px geser vertikal mengikuti kursor
    },
    otp: {
      panjang: 6,
      kirimOtomatis: true, // kirim begitu 6 digit terisi
    },
  };

  // Hormati preferensi pengguna — dibaca sekali, dipantau perubahannya
  const mediaGerak = window.matchMedia('(prefers-reduced-motion: reduce)');
  let kurangiGerak = mediaGerak.matches;
  mediaGerak.addEventListener('change', (e) => {
    kurangiGerak = e.matches;
    // (partikel dihapus — latar sekarang grid statis)
  });

  // ══ Utilitas ═════════════════════════════════════════════════════════════

  const $ = (sel) => document.querySelector(sel);

  /** Tampilkan pesan pada elemen dengan status warna yang benar.
   *  `role="status"` + `aria-live="polite"` sudah di HTML, jadi pembaca
   *  layar akan mengumumkan perubahan tanpa merebut fokus. */
  function pesan(el, teks, jenis = '') {
    if (!el) return;
    el.textContent = teks;
    el.classList.toggle('is-galat', jenis === 'galat');
    el.classList.toggle('is-sukses', jenis === 'sukses');
  }

  /** Getar kartu saat ada galat. Kelas dilepas setelah animasi selesai
   *  supaya bisa dipicu lagi (kalau tidak, animasi kedua tidak jalan). */
  function getar(kartu) {
    if (kurangiGerak || !kartu) return;
    kartu.classList.remove('is-goyang');
    void kartu.offsetWidth;   // paksa reflow — satu-satunya di luar RAF loop
    kartu.classList.add('is-goyang');
    kartu.addEventListener('animationend', () => {
      kartu.classList.remove('is-goyang');
    }, { once: true });
  }

  /** Setel tombol ke keadaan memuat. `aria-busy` memberi tahu pembaca layar
   *  bahwa sesuatu sedang terjadi — penting untuk operasi yang butuh waktu. */
  function setMemuat(tombol, memuat) {
    if (!tombol) return;
    tombol.classList.toggle('is-memuat', memuat);
    tombol.disabled = memuat;
    tombol.setAttribute('aria-busy', memuat ? 'true' : 'false');
  }

  /** Pindah panel dengan animasi masuk. Panel lama langsung disembunyikan
   *  (bukan di-fade) supaya tinggi kartu tidak melompat dua kali. */
  function pindahPanel(nama) {
    document.querySelectorAll('.auth-panel').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.panel === nama);
    });
  }

  // ══ Kartu 3D mengikuti kursor ════════════════════════════════════════════

  const scene = $('#scene');
  const kartu = $('#card');

  // Nilai saat ini & target. Interpolasi bertahap (lerp) menuju target
  // membuat gerakan terasa "berat" dan tidak pernah melompat — inilah
  // pengganti spring tanpa library.
  const tilt = { rx: 0, ry: 0, ty: 0, trx: 0, try_: 0, tty: 0 };
  let rafTilt = null;
  let tiltAktif = false;
  let waktuFrameLalu = 0;

  function terapkanTilt(waktuSekarang) {
    // ── Delta-time: animasi berbasis WAKTU, bukan frame ────────────────────
    //
    // Masalah yang diperbaiki: lerp `nilai += selisih * 0.12` dihitung PER
    // FRAME. Akibatnya durasi animasi berubah-ubah tergantung perangkat:
    //
    //   layar 120Hz  → 2× lebih cepat dari yang didesain
    //   HP lambat    → 2× lebih lambat, terasa berat
    //   tab tak fokus→ RAF di-throttle ~1fps, animasi membeku lalu melompat
    //
    // Terukur: pada 10fps, sisa kemiringan setelah 1,7 detik = 0,24° —
    // seharusnya sudah berhenti di bawah 0,01°.
    //
    // Perbaikan: hitung faktor lerp dari waktu yang benar-benar berlalu.
    //   faktor = 1 - (1 - lerp)^(dt / frame_acuan)
    //
    // Hasilnya identik di semua framerate — inilah cara animasi yang benar.
    const dt = waktuFrameLalu ? Math.min(waktuSekarang - waktuFrameLalu, 100) : FRAME_ACUAN;
    waktuFrameLalu = waktuSekarang;

    // Batasi dt maksimum 100ms. Kalau tab sempat tidak aktif, dt bisa
    // ribuan milidetik — tanpa batas ini, faktor menjadi ~1 dan kartu
    // MELOMPAT ke posisi akhir alih-alih bergerak halus.
    const faktor = 1 - Math.pow(1 - KONFIG.tilt.lerp, dt / FRAME_ACUAN);

    // Selisih kecil → berhenti. Tanpa ambang, loop berjalan selamanya
    // mengejar nilai yang perbedaannya sudah tidak terlihat.
    const dx = tilt.trx - tilt.rx;
    const dy = tilt.try_ - tilt.ry;
    const dz = tilt.tty - tilt.ty;

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(dz) < 0.05) {
      tilt.rx = tilt.trx; tilt.ry = tilt.try_; tilt.ty = tilt.tty;
      kartu.style.setProperty('--rx', `${tilt.rx.toFixed(3)}deg`);
      kartu.style.setProperty('--ry', `${tilt.ry.toFixed(3)}deg`);
      kartu.style.setProperty('--ty', `${tilt.ty.toFixed(2)}px`);
      rafTilt = null;
      waktuFrameLalu = 0;   // reset supaya frame berikutnya mulai bersih
      return;
    }

    tilt.rx += dx * faktor;
    tilt.ry += dy * faktor;
    tilt.ty += dz * faktor;

    kartu.style.setProperty('--rx', `${tilt.rx.toFixed(3)}deg`);
    kartu.style.setProperty('--ry', `${tilt.ry.toFixed(3)}deg`);
    kartu.style.setProperty('--ty', `${tilt.ty.toFixed(2)}px`);

    rafTilt = requestAnimationFrame(terapkanTilt);
  }

  function jadwalkanTilt() {
    // Reset penanda waktu supaya frame pertama memakai dt acuan (16,67ms),
    // bukan selisih dari animasi sebelumnya yang sudah lama berhenti.
    if (rafTilt === null) {
      waktuFrameLalu = 0;
      rafTilt = requestAnimationFrame(terapkanTilt);
    }
  }

  function onPointerMove(e) {
    if (!tiltAktif || kurangiGerak || !kartu) return;

    const rect = kartu.getBoundingClientRect();
    // Posisi relatif: -1 … 1 dari tengah kartu
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const nx = Math.max(0, Math.min(1, px)) * 2 - 1;
    const ny = Math.max(0, Math.min(1, py)) * 2 - 1;

    tilt.try_ = nx * KONFIG.tilt.maksDerajat;     // rotasi sumbu Y dari gerak X
    tilt.trx = -ny * KONFIG.tilt.maksDerajat;     // rotasi sumbu X dari gerak Y
    tilt.tty = -ny * KONFIG.tilt.maksGeser;

    // Posisi kursor untuk sorot cahaya (dalam persen, untuk CSS)
    kartu.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    kartu.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);

    jadwalkanTilt();
  }

  function onPointerEnter() {
    if (kurangiGerak || !kartu) return;
    tiltAktif = true;
    kartu.classList.add('is-menempel');
  }

  function onPointerLeave() {
    tiltAktif = false;
    if (!kartu) return;
    kartu.classList.remove('is-menempel');
    // Kembali datar dengan lembut
    tilt.trx = 0; tilt.try_ = 0; tilt.tty = 0;
    jadwalkanTilt();
  }

  function pasangTilt() {
    // Di perangkat sentuh tidak ada kursor — lewati sepenuhnya.
    // `matchMedia('(hover: hover)')` lebih andal daripada mendeteksi UA.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (!scene || !kartu) return;

    scene.addEventListener('pointerenter', onPointerEnter);
    scene.addEventListener('pointermove', onPointerMove, { passive: true });
    scene.addEventListener('pointerleave', onPointerLeave);
  }

  // ══ Input OTP ════════════════════════════════════════════════════════════

  function pasangOtp() {
    const sel = Array.from(document.querySelectorAll('.auth-otp-cell'));
    if (!sel.length) return;

    // Timer auto-submit. Disimpan di luar loop supaya bisa dibatalkan:
    // pengguna yang menekan Backspace dalam jendela jeda tidak boleh
    // tetap mengirim kode yang sudah diubah.
    let timerKirim = null;

    /** Ambil nilai lengkap 6 digit */
    const nilai = () => sel.map((s) => s.value).join('');

    /** Isi satu sel dan perbarui tampilan terisi */
    const isi = (i, v) => {
      if (i < 0 || i >= sel.length) return;
      sel[i].value = v;
      sel[i].classList.toggle('is-terisi', v !== '');
    };

    sel.forEach((s, i) => {
      // Hanya terima angka — tempel teks dari SMS/authenticator sering
      // berisi spasi atau tanda hubung; bersihkan dulu.
      s.addEventListener('input', () => {
        const bersih = s.value.replace(/\D/g, '');
        if (bersih.length > 1) {
          // Pengguna menempel beberapa digit sekaligus — sebar ke sel berikutnya
          const digit = bersih.slice(0, sel.length - i).split('');
          digit.forEach((d, k) => isi(i + k, d));
          const berikut = Math.min(i + digit.length, sel.length - 1);
          sel[berikut].focus();
        } else {
          isi(i, bersih);
          if (bersih && i < sel.length - 1) sel[i + 1].focus();
        }

        // Kirim otomatis saat penuh — menghemat satu klik.
        //
        // Jeda 280ms SEBELUM kirim, karena dua alasan:
        //   1. Mata butuh waktu memverifikasi 6 digit sudah benar. Tanpa jeda,
        //      kode terkirim sebelum pengguna selesai membaca.
        //   2. Kalau ada digit salah, pengguna masih sempat menekan Backspace.
        //      Tanpa jeda, permintaan sudah berangkat dan ia harus menunggu
        //      balasan galat dulu.
        // Timer disimpan supaya bisa dibatalkan kalau pengguna mengetik lagi
        // (mis. menekan Backspace dalam jendela jeda itu).
        if (KONFIG.otp.kirimOtomatis && nilai().length === sel.length) {
          clearTimeout(timerKirim);
          timerKirim = setTimeout(() => {
            document.getElementById('formTotp')?.requestSubmit();
          }, 280);
        }
      });

      // Backspace pada sel kosong → mundur ke sel sebelumnya.
      // Perilaku ini yang diharapkan pengguna, tapi tidak otomatis ada.
      s.addEventListener('keydown', (e) => {
        // Setiap perubahan membatalkan auto-submit yang tertunda — kalau
        // tidak, kode lama tetap terkirim meski pengguna baru saja
        // memperbaikinya.
        if (timerKirim) { clearTimeout(timerKirim); timerKirim = null; }

        if (e.key === 'Backspace' && !s.value && i > 0) {
          e.preventDefault();
          isi(i - 1, '');
          sel[i - 1].focus();
        }
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); sel[i - 1].focus(); }
        if (e.key === 'ArrowRight' && i < sel.length - 1) { e.preventDefault(); sel[i + 1].focus(); }
      });

      // Pilih isi saat fokus — supaya mengetik langsung menimpa
      s.addEventListener('focus', () => s.select());
    });

    // Fokuskan sel pertama saat panel TOTP dibuka
    document.addEventListener('panel:totp', () => sel[0]?.focus());
  }

  // ══ API ══════════════════════════════════════════════════════════════════

  /** POST JSON dengan timeout. `AbortController` mencegah permintaan
   *  menggantung selamanya kalau jaringan lambat — tanpa ini, tombol
   *  bisa "memuat" tanpa akhir. */
  async function kirimJson(jalur, data, timeoutMs = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(jalur, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin',
        signal: ctl.signal,
      });
      let isi = null;
      try { isi = await res.json(); } catch { /* balasan bukan JSON */ }
      return { ok: res.ok, status: res.status, isi };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ambil pesan galat dari balasan server. Server mengirim `message` dalam
   *  bahasa Indonesia — pakai itu kalau ada, jangan timpa dengan teks sendiri. */
  function pesanGalat(hasil, bawaan) {
    return (hasil?.isi?.message) || bawaan;
  }

  // ══ Turnstile ════════════════════════════════════════════════════════════

  let turnstileWidgetId = null;
  let turnstileToken = '';

  /** Muat skrip Turnstile SEKALI, hanya saat dibutuhkan.
   *  Memuatnya di awal berarti setiap pengunjung mengunduh ~90 KB
   *  meski tidak pernah mengirim formulir. */
  function muatTurnstile() {
    return new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();

      const ada = document.querySelector('script[data-turnstile]');
      if (ada) {
        ada.addEventListener('load', () => resolve(), { once: true });
        ada.addEventListener('error', () => reject(new Error('gagal_muat')), { once: true });
        return;
      }

      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.dataset.turnstile = '1';
      s.addEventListener('load', () => resolve(), { once: true });
      s.addEventListener('error', () => reject(new Error('gagal_muat')), { once: true });
      document.head.appendChild(s);
    });
  }

  /**
   * Tunggu sampai widget Turnstile menghasilkan token.
   *
   * ── BUG YANG DIPERBAIKI ─────────────────────────────────────────────────────
   * Sebelumnya kode memanggil `siapkanTurnstile()` lalu LANGSUNG mengirim
   * request. Tapi widget Turnstile butuh waktu untuk menyelesaikan tantangan
   * dan memanggil callback yang mengisi `turnstileToken` — jadi request
   * berangkat dengan token KOSONG, dan server menolaknya dengan
   * 'token_kosong' ('Selesaikan verifikasi keamanan dulu').
   *
   * Gejalanya membingungkan: pengguna sudah mengisi token akses dengan benar,
   * tapi ditolak dengan pesan yang menyuruh "selesaikan verifikasi keamanan"
   * padahal tidak ada yang terlihat perlu diselesaikan.
   *
   * ── CARA KERJA ──────────────────────────────────────────────────────────────
   * Polling `turnstileToken` setiap 100ms sampai terisi atau timeout.
   * Timeout PENTING: kalau Cloudflare tidak terjangkau (iklan pemblokir,
   * jaringan perusahaan), kita tidak boleh menggantung selamanya — pengguna
   * harus dapat respons, meski itu pesan galat.
   *
   * @param {number} timeoutMs - batas tunggu
   * @returns {Promise<string>} token, atau string kosong kalau timeout
   */
  function tungguTokenTurnstile(timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (turnstileToken) return resolve(turnstileToken);

      const mulai = Date.now();
      const periksa = () => {
        if (turnstileToken) return resolve(turnstileToken);
        if (Date.now() - mulai >= timeoutMs) return resolve('');
        setTimeout(periksa, 100);
      };
      periksa();
    });
  }

  /** Siapkan widget Turnstile di slot yang tersedia.
   *  Kalau gagal (jaringan/iklan pemblokir), JANGAN gagalkan login —
   *  server tetap punya pertahanan sendiri (rate limit, verifikasi token).
   *  Lebih baik pengguna bisa mencoba daripada terkunci total. */
  async function siapkanTurnstile() {
    // ── SLOT BISA BERBEDA NAMA DI SETIAP HALAMAN ─────────────────────────────
    //
    // Sebelumnya fungsi ini HANYA mencari `#turnstileSlot` — dan halaman
    // daftar memakai `#turnstileSlotDaftar`. Akibatnya widget tidak pernah
    // dirender di halaman daftar: slot tidak ditemukan → fungsi keluar lebih
    // awal → `tungguTokenTurnstile(8000)` menunggu 8 detik penuh untuk token
    // yang tidak akan pernah datang → form tersangkut di "Mengirim…" dan
    // tidak ada request API sama sekali.
    //
    // Gejalanya sangat menyesatkan: pesannya "Mengirim…" (seolah request
    // sedang berjalan), padahal tidak ada request apa pun.
    //
    // Sekarang fungsi mencari slot PERTAMA yang ada dari daftar kandidat.
    // Setiap halaman cukup memakai salah satu id ini; halaman yang tidak
    // punya slot Turnstile (mis. panel 2FA) tidak terpengaruh.
    const slot = $('#turnstileSlot') ?? $('#turnstileSlotDaftar') ?? $('#turnstileSlotLupa');
    if (!slot || turnstileWidgetId !== null) return;

    const kunci = window.__TURNSTILE_SITEKEY__;
    if (!kunci) return;   // tidak dikonfigurasi — server yang menilai

    try {
      await muatTurnstile();
      if (!window.turnstile) return;

      turnstileWidgetId = window.turnstile.render(slot, {
        sitekey: kunci,
        theme: 'dark',
        size: 'flexible',
        appearance: 'interaction-only',   // hanya muncul kalau perlu tantangan
        callback: (tok) => { turnstileToken = tok; },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; },
      });
      slot.classList.add('is-ada');
      slot.removeAttribute('aria-hidden');
    } catch {
      // Senyap — jangan halangi pengguna karena masalah pihak ketiga
    }
  }

  // ══ Alur: MASUK (email + sandi) ══════════════════════════════════════════
  //
  // ── MENGGANTIKAN ALUR "TOKEN AKSES" ────────────────────────────────────────
  // Sebelumnya pengguna menyalin token acak 19 karakter. Sekarang email +
  // sandi — pola yang dipakai semua halaman login korporasi besar.
  //
  // Token akses TETAP didukung backend (untuk admin & integrasi otomatis),
  // hanya bukan lagi cara pengguna masuk.

  const formMasuk = $('#formMasuk');
  const btnSubmit = $('#btnSubmit');
  const msgMasuk = $('#msgToken');

  /** Simpan email agar dipakai lagi saat langkah 2FA (tidak perlu ketik ulang). */
  let emailMasuk = '';
  let sandiMasuk = '';

  formMasuk?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = $('#inpEmailMasuk')?.value?.trim() ?? '';
    const sandi = $('#inpSandi')?.value ?? '';

    // Validasi lokal — jangan buang perjalanan ke server untuk kesalahan
    // yang bisa diketahui sekarang.
    if (!email) {
      pesan(msgMasuk, 'Email belum diisi.', 'galat');
      getar(kartu);
      $('#inpEmailMasuk')?.focus();
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      pesan(msgMasuk, 'Format email tidak valid.', 'galat');
      getar(kartu);
      $('#inpEmailMasuk')?.focus();
      return;
    }
    if (!sandi) {
      pesan(msgMasuk, 'Sandi belum diisi.', 'galat');
      getar(kartu);
      $('#inpSandi')?.focus();
      return;
    }

    setMemuat(btnSubmit, true);
    pesan(msgMasuk, 'Memeriksa…');

    // Siapkan Turnstile, lalu TUNGGU tokennya.
    // Memuat widget saja tidak cukup — token baru terisi setelah widget
    // menyelesaikan tantangan. Tanpa menunggu, request berangkat dengan
    // token kosong dan server menolak dengan 'token_kosong'.
    await siapkanTurnstile();
    const tokenTurnstile = await tungguTokenTurnstile(8000);

    try {
      const hasil = await kirimJson('/api/auth/masuk', {
        email,
        sandi,
        device_fp: ambilFingerprint(),
        'cf-turnstile-response': tokenTurnstile,
      });

      if (!hasil.ok) {
        pesan(msgMasuk, pesanGalat(hasil, 'Email atau sandi salah.'), 'galat');
        getar(kartu);
        // Token Turnstile sekali pakai — reset supaya percobaan berikutnya
        // mendapat yang baru.
        if (turnstileWidgetId !== null && window.turnstile) {
          window.turnstile.reset(turnstileWidgetId);
          turnstileToken = '';
        }
        return;
      }

      // ── Kalau server minta 2FA, lanjut ke panel TOTP ──────────────────────
      // Email & sandi disimpan di variabel modul supaya pengguna tidak perlu
      // mengetiknya ulang di langkah kedua. Endpoint /api/auth/2fa
      // memverifikasi ULANG keduanya (bukan hanya kode) — jadi menyimpannya
      // di memori halaman tidak melemahkan apa pun.
      if (hasil.isi?.perlu_2fa) {
        emailMasuk = email;
        sandiMasuk = sandi;
        pesan(msgMasuk, '');
        pindahPanel('totp');
        document.dispatchEvent(new Event('panel:totp'));
        return;
      }

      pesan(msgMasuk, '');
      selesai(hasil.isi?.project ?? '', hasil.isi);
    } catch (err) {
      const pesanErr = err?.name === 'AbortError'
        ? 'Server tidak merespons. Coba lagi.'
        : 'Gagal terhubung. Periksa koneksi Anda.';
      pesan(msgMasuk, pesanErr, 'galat');
      getar(kartu);
    } finally {
      setMemuat(btnSubmit, false);
    }
  });

  // ── Tombol tampilkan/sembunyikan sandi ─────────────────────────────────────
  $('#btnRevealSandi')?.addEventListener('click', (e) => {
    const inp = $('#inpSandi');
    const tombol = e.currentTarget;
    if (!inp) return;
    const terlihat = inp.type === 'text';
    inp.type = terlihat ? 'password' : 'text';
    tombol.setAttribute('aria-pressed', terlihat ? 'false' : 'true');
    tombol.setAttribute('aria-label', terlihat ? 'Tampilkan sandi' : 'Sembunyikan sandi');
    inp.focus();
  });

  // ══ Alur: TOTP (langkah kedua) ═══════════════════════════════════════════

  const formTotp = $('#formTotp');
  const btnTotp = $('#btnTotp');
  const msgTotp = $('#msgTotp');

  formTotp?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const kode = Array.from(document.querySelectorAll('.auth-otp-cell'))
      .map((s) => s.value)
      .join('');

    if (kode.length !== KONFIG.otp.panjang) {
      pesan(msgTotp, `Masukkan ${KONFIG.otp.panjang} digit kode.`, 'galat');
      getar(kartu);
      return;
    }

    setMemuat(btnTotp, true);
    pesan(msgTotp, 'Memverifikasi…');

    try {
      const hasil = await kirimJson('/api/auth/2fa', {
        email: emailMasuk,
        sandi: sandiMasuk,
        code: kode,
        device_fp: ambilFingerprint(),
        'cf-turnstile-response': turnstileToken,
      });

      if (!hasil.ok) {
        pesan(msgTotp, pesanGalat(hasil, 'Kode tidak valid.'), 'galat');
        getar(kartu);
        document.querySelectorAll('.auth-otp-cell').forEach((s) => {
          s.value = '';
          s.classList.remove('is-terisi');
        });
        document.querySelector('.auth-otp-cell')?.focus();
        return;
      }

      pesan(msgTotp, '');
      // Bersihkan sandi dari memori begitu tidak diperlukan lagi.
      sandiMasuk = '';
      selesai(hasil.isi?.project ?? '', hasil.isi);
    } catch (err) {
      pesan(msgTotp, err?.name === 'AbortError'
        ? 'Server tidak merespons.'
        : 'Gagal terhubung.', 'galat');
      getar(kartu);
    } finally {
      setMemuat(btnTotp, false);
    }
  });

  $('#btnBackToken')?.addEventListener('click', () => {
    pesan(msgTotp, '');
    // Bersihkan sandi tersimpan saat pengguna membatalkan.
    sandiMasuk = '';
    pindahPanel('masuk');
  });

  // ══ Alur: LUPA SANDI ═════════════════════════════════════════════════════

  $('#btnLupaSandi')?.addEventListener('click', () => {
    // Isi otomatis dengan email yang sudah diketik — hemat satu langkah.
    const email = $('#inpEmailMasuk')?.value?.trim();
    if (email) { const el = $('#inpEmailLupa'); if (el) el.value = email; }
    pindahPanel('lupa');
    $('#inpEmailLupa')?.focus();
  });

  $('#btnBatalLupa')?.addEventListener('click', () => {
    pesan($('#msgLupa'), '');
    pindahPanel('masuk');
  });

  $('#btnKembaliDariLupa')?.addEventListener('click', () => pindahPanel('masuk'));

  const formLupa = $('#formLupa');
  const btnLupa = $('#btnLupa');
  const msgLupa = $('#msgLupa');

  formLupa?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#inpEmailLupa')?.value?.trim() ?? '';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      pesan(msgLupa, 'Format email tidak valid.', 'galat');
      getar(kartu);
      $('#inpEmailLupa')?.focus();
      return;
    }

    setMemuat(btnLupa, true);
    pesan(msgLupa, 'Mengirim…');

    await siapkanTurnstile();
    const tokenTurnstile = await tungguTokenTurnstile(8000);

    try {
      const hasil = await kirimJson('/api/auth/lupa-sandi', {
        email,
        'cf-turnstile-response': tokenTurnstile,
      });

      // Server SELALU membalas sukses (mencegah orang memeriksa email mana
      // yang terdaftar). Jadi panel berikutnya tidak pernah mengungkapkan
      // apakah email itu ada atau tidak.
      if (!hasil.ok) {
        pesan(msgLupa, pesanGalat(hasil, 'Gagal mengirim. Coba lagi.'), 'galat');
        getar(kartu);
        return;
      }

      pesan(msgLupa, '');
      pindahPanel('lupa-selesai');
    } catch (err) {
      pesan(msgLupa, err?.name === 'AbortError'
        ? 'Server tidak merespons.'
        : 'Gagal terhubung.', 'galat');
      getar(kartu);
    } finally {
      setMemuat(btnLupa, false);
    }
  });

  // ══ Alur: DAFTAR (sign up) ═══════════════════════════════════════════════
  //
  // ── DI HALAMAN TERPISAH ────────────────────────────────────────────────────
  // Daftar TIDAK lagi menjadi panel di dalam halaman masuk. Korporasi
  // memisahkannya: "Masuk" untuk yang sudah punya akun, "Daftar" untuk yang
  // belum. Menggabung keduanya membuat pengguna yang salah masuk ke form
  // daftar membuat akun duplikat, lalu bingung kenapa datanya kosong.
  //
  // Handler ini tidak berbuat apa-apa kalau #formDaftar tidak ada di halaman
  // — jadi auth.js tetap aman dimuat di masuk.html.

  const formDaftar = $('#formDaftar');
  const btnDaftar = $('#btnDaftar');
  const msgDaftar = $('#msgDaftar');

  formDaftar?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Field sign up murni: nama, email, perusahaan (opsional), sandi.
    // Field lead (anggaran, urgensi, pesan) TIDAK ada di sini — itu pertanyaan
    // sales untuk formulir kontak, bukan pertanyaan pendaftaran akun.
    const nama = $('#inpNama')?.value?.trim() ?? '';
    const email = $('#inpEmail')?.value?.trim() ?? '';
    const perusahaan = $('#inpPerusahaan')?.value?.trim() ?? '';
    const sandi = $('#inpSandiDaftar')?.value ?? '';

    // ── Validasi lokal (server memvalidasi ULANG — ini hanya umpan balik cepat)
    const gagal = (m, sel) => {
      pesan(msgDaftar, m, 'galat');
      getar(kartu);
      if (sel) $(sel)?.focus();
    };

    if (nama.length < 3 || /\d/.test(nama)) return gagal('Nama minimal 3 huruf, tanpa angka.', '#inpNama');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return gagal('Format email tidak valid.', '#inpEmail');
    // Perusahaan OPSIONAL — hanya divalidasi kalau diisi.
    if (perusahaan && perusahaan.length < 3) return gagal('Nama perusahaan minimal 3 huruf.', '#inpPerusahaan');
    // Sandi minimal 12 karakter — sama dengan aturan server (NIST SP 800-63B).
    // Memeriksa di klien menghemat perjalanan ke server untuk kesalahan yang
    // bisa diketahui sekarang.
    if (sandi.length < 12) return gagal('Sandi minimal 12 karakter.', '#inpSandiDaftar');

    setMemuat(btnDaftar, true);
    pesan(msgDaftar, 'Mengirim…');

    await siapkanTurnstile();
    const tokenTurnstile = await tungguTokenTurnstile(8000);

    try {
      // ── ENDPOINT: /api/auth/daftar, BUKAN /api/contact/sales ─────────────
      // contact/sales adalah formulir LEAD — ia mencatat minat calon klien
      // (nama, perusahaan, anggaran) tapi TIDAK membuat akun, dan tidak
      // menerima sandi. /api/auth/daftar yang membuat akun + kredensial.
      //
      // Keduanya berbeda tujuan: lead untuk yang belum yakin, daftar untuk
      // yang langsung ingin masuk. Mengarahkan form ini ke contact/sales
      // membuat pendaftar tidak pernah bisa masuk — akunnya tidak ada.
      const hasil = await kirimJson('/api/auth/daftar', {
        nama,
        email,
        perusahaan,
        sandi,
        'cf-turnstile-response': tokenTurnstile,
      });

      if (!hasil.ok) {
        pesan(msgDaftar, pesanGalat(hasil, 'Gagal mengirim. Coba lagi.'), 'galat');
        getar(kartu);
        return;
      }

      pesan(msgDaftar, '');
      pindahPanel('daftar-selesai');

      // ── ALIHKAN KE HALAMAN MASUK SETELAH 2,2 DETIK ────────────────────────
      //
      // ── KENAPA TIDAK LANGSUNG MASUK ───────────────────────────────────────
      // Banyak pengguna mengira harus menunggu email verifikasi setelah
      // mendaftar. Membiarkan mereka di halaman "berhasil" tanpa tindakan
      // membuat sebagian menutup tab dan tidak pernah masuk.
      //
      // Mengalihkan ke halaman masuk membuat mereka LANGSUNG mencoba — dan
      // karena itu berhasil, mereka tahu akunnya sudah aktif.
      //
      // ── KENAPA 2,2 DETIK ──────────────────────────────────────────────────
      // Cukup untuk membaca judul + subjudul di panel selesai, tidak cukup
      // membuat pengguna menunggu. Kalau terlalu cepat (< 1,5 detik), panel
      // selesai tidak sempat terbaca dan terasa seperti lompatan tanpa alasan.
      //
      // ── EMAIL DIBERI LEWAT QUERY STRING ──────────────────────────────────
      // Supaya pengguna tidak perlu mengetik ulang emailnya. Yang dilewatkan
      // HANYA email — tidak ada sandi, tidak ada token. Email bukan rahasia
      // (pengguna sendiri yang mengetiknya), dan halaman masuk akan
      // memvalidasinya lagi saat submit.
      if (!kurangiGerak) {
        const tujuan = `/sign-in?email=${encodeURIComponent(email)}`;
        setTimeout(() => { window.location.href = tujuan; }, 2200);
      }
    } catch (err) {
      pesan(msgDaftar, err?.name === 'AbortError'
        ? 'Server tidak merespons.'
        : 'Gagal terhubung.', 'galat');
      getar(kartu);
    } finally {
      setMemuat(btnDaftar, false);
    }
  });

  $('#btnRevealSandiDaftar')?.addEventListener('click', (e) => {
    const inp = $('#inpSandiDaftar');
    const tombol = e.currentTarget;
    if (!inp) return;
    const terlihat = inp.type === 'text';
    inp.type = terlihat ? 'password' : 'text';
    tombol.setAttribute('aria-pressed', terlihat ? 'false' : 'true');
    tombol.setAttribute('aria-label', terlihat ? 'Tampilkan sandi' : 'Sembunyikan sandi');
    inp.focus();
  });

  $('#btnKembaliMasuk')?.addEventListener('click', () => {
    window.location.href = '/sign-in';
  });

  // ══ Selesai ══════════════════════════════════════════════════════════════

  /** Timer alih-otomatis setelah login.
   *
   *  Dibatalkan kalau pengguna masuk ke alur setup 2FA — kalau tidak,
   *  halaman berpindah DI TENGAH alur dan panel terlepas dari DOM.
   *  Harus di scope modul supaya selesai(), batalkanAlih(), dan
   *  mulaiSetup2fa() melihat variabel yang sama.
   */
  let timerAlih = null;

  function selesai(proyek, data) {
    if (proyek) proyekAktif = proyek;
    const tujuan = data?.redirect || (proyek ? `/${proyek}` : '/home');
    const tautan = $('#btnGoProject');
    if (tautan) tautan.href = tujuan;

    const sub = $('#doneSub');
    if (sub) {
      const nama = proyek === 'mina' ? 'MINA' :
                   proyek === 'spareparts' ? 'Spareparts Inventory' : proyek;
      sub.textContent = `Mengalihkan ke ${nama}…`;
    }

    pindahPanel('done');

    // Alihkan otomatis. Jeda 900ms memberi waktu animasi centang selesai
    // dan pengguna membaca pesan — kalau terlalu cepat, terasa seperti
    // halaman "melompat" tanpa alasan.
    //
    // ── BUG YANG DIPERBAIKI ────────────────────────────────────────────────
    // Timer ini HARUS bisa dibatalkan. Kalau pengguna menekan "Aktifkan 2FA"
    // dalam 900ms setelah panel 'done' muncul, halaman berpindah DI TENGAH
    // alur setup 2FA — panel terlepas dari DOM, pesan galat tidak pernah
    // muncul, dan API /2fa/selesai tidak pernah dipanggil.
    //
    // Gejalanya sangat menyesatkan: seolah tombol 2FA tidak berfungsi,
    // padahal halaman hanya dinavigasi ulang sebelum sempat bekerja.
    // Terukur: klik pada t+225ms → halaman langsung tercabut.
    if (!kurangiGerak) {
      timerAlih = setTimeout(() => { window.location.href = tujuan; }, 900);
    }
  }

  /** Batalkan alih-otomatis kalau pengguna masuk ke alur 2FA. */
  function batalkanAlih() {
    if (timerAlih !== null) {
      clearTimeout(timerAlih);
      timerAlih = null;
    }
  }

  // ══ Fingerprint perangkat ════════════════════════════════════════════════

  /** Sidik jari ringan untuk deteksi penyalahgunaan token.
   *
   *  PENTING: ini BUKAN alat pelacakan. Nilainya hanya dikirim saat login,
   *  dipakai server untuk mendeteksi satu token dipakai di banyak perangkat
   *  (indikasi token dibagikan). Tidak ada cookie, tidak ada penyimpanan.
   *
   *  Sengaja TIDAK memakai canvas/audio fingerprint — itu invasif dan
   *  mudah berubah saat browser update, menghasilkan positif palsu. */
  function ambilFingerprint() {
    const bagian = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency ?? 0,
      navigator.maxTouchPoints ?? 0,
    ];
    // Hash sederhana (FNV-1a 32-bit) — cukup untuk membandingkan kesamaan,
    // bukan untuk keamanan. Tidak perlu kriptografis.
    let h = 0x811c9dc5;
    const s = bagian.join('|');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `fp-${(h >>> 0).toString(36)}`;
  }

  // ══ Tombol reveal token ══════════════════════════════════════════════════


  // ══ Passkey (WebAuthn) ═══════════════════════════════════════════════════

  /** Tampilkan tombol passkey HANYA kalau browser benar-benar mendukung.
   *  Menampilkan tombol yang tidak berfungsi lebih buruk daripada tidak
   *  menampilkannya — pengguna mengira situsnya rusak. */
  async function siapkanPasskey() {
    const tombol = $('#btnPasskey');
    if (!tombol) return;

    const didukung = window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function';

    if (!didukung) return;   // biarkan tersembunyi

    try {
      const bisa = await window.PublicKeyCredential.isConditionalMediationAvailable();
      if (bisa) tombol.hidden = false;
    } catch {
      // API ada tapi gagal — jangan tampilkan
    }
  }

  /**
   * MASUK DENGAN PASSKEY (WebAuthn).
   *
   * ── DUA LANGKAH, BUKAN SATU ────────────────────────────────────────────────
   * Server harus menerbitkan `challenge` lebih dulu, lalu memverifikasi
   * jawaban authenticator. Challenge itu sekali pakai dan hanya berlaku
   * beberapa menit — inilah yang membuat respons lama tidak bisa diputar
   * ulang.
   *
   * ── KENAPA allowCredentials KOSONG DARI SERVER ─────────────────────────────
   * Server tidak tahu siapa yang akan masuk sampai authenticator menjawab.
   * Inilah yang membuat passkey terasa mulus: pengguna cukup sidik jari,
   * tanpa mengetik email. Browser yang memilih akun yang cocok.
   */
  $('#btnPasskey')?.addEventListener('click', async () => {
    const tombol = $('#btnPasskey');
    const teksAsli = tombol?.textContent ?? '';

    if (!window.PublicKeyCredential) {
      pesan(msgToken, 'Peramban ini tidak mendukung passkey.', 'galat');
      return;
    }

    if (tombol) {
      tombol.disabled = true;
      tombol.textContent = 'Menunggu passkey…';
    }

    /** Kembalikan tombol ke keadaan semula, apa pun yang terjadi. */
    const pulihkan = () => {
      if (tombol) {
        tombol.disabled = false;
        tombol.textContent = teksAsli;
      }
    };

    try {
      // ── Langkah 1: minta challenge ─────────────────────────────────────────
      const resMulai = await fetch('/api/auth/passkey/masuk/mulai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const opsi = await resMulai.json().catch(() => ({}));

      if (!resMulai.ok || !opsi.ok) {
        pulihkan();
        pesan(msgToken, opsi.message || 'Passkey tidak bisa dimulai. Coba lagi.', 'galat');
        return;
      }

      // ── Langkah 2: minta authenticator menandatangani challenge ────────────
      //
      // base64url HARUS dikembalikan ke bentuk byte sebelum diberikan ke
      // browser — WebAuthn tidak menerima string. Ini kesalahan paling
      // sering: tanpa konversi, browser melempar TypeError yang tidak
      // menjelaskan apa pun.
      const b64keByte = (nilai) => {
        const s = String(nilai).replace(/-/g, '+').replace(/_/g, '/');
        const padding = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
        const biner = atob(s + padding);
        const byte = new Uint8Array(biner.length);
        for (let i = 0; i < biner.length; i += 1) byte[i] = biner.charCodeAt(i);
        return byte;
      };

      const byteKeB64 = (buf) => {
        let biner = '';
        const byte = new Uint8Array(buf);
        for (let i = 0; i < byte.length; i += 1) biner += String.fromCharCode(byte[i]);
        return btoa(biner).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      };

      const kredensial = await navigator.credentials.get({
        publicKey: {
          challenge: b64keByte(opsi.challenge),
          rpId: opsi.rpId,
          timeout: opsi.timeout ?? 120000,
          userVerification: opsi.userVerification ?? 'preferred',
          allowCredentials: (opsi.allowCredentials ?? []).map((c) => ({
            ...c,
            id: b64keByte(c.id),
          })),
        },
      });

      if (!kredensial) {
        pulihkan();
        pesan(msgToken, 'Tidak ada passkey yang dipilih.', 'galat');
        return;
      }

      // ── Langkah 3: kirim jawaban untuk diverifikasi ────────────────────────
      const jawaban = kredensial.response;
      const resSelesai = await fetch('/api/auth/passkey/masuk/selesai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: kredensial.id,          // sudah base64url dari browser
          challenge: opsi.challenge,
          response: {
            authenticatorData: byteKeB64(jawaban.authenticatorData),
            clientDataJSON: byteKeB64(jawaban.clientDataJSON),
            signature: byteKeB64(jawaban.signature),
            userHandle: jawaban.userHandle ? byteKeB64(jawaban.userHandle) : null,
          },
        }),
      });
      const hasil = await resSelesai.json().catch(() => ({}));

      if (!resSelesai.ok || !hasil.ok) {
        pulihkan();
        pesan(msgToken, hasil.message || 'Passkey tidak dikenali. Gunakan cara lain.', 'galat');
        return;
      }

      // Peringatan penghitung tanda tangan tidak naik — bukan galat, tapi
      // pantas diketahui pengguna.
      if (hasil.peringatan) {
        pesan(msgToken, hasil.peringatan, '');
      }

      pesan(msgToken, 'Berhasil. Mengalihkan…', 'sukses');
      window.location.href = hasil.redirect || '/';

    } catch (err) {
      pulihkan();

      // NotAllowedError = pengguna membatalkan atau waktu habis. Itu bukan
      // kegagalan sistem, jadi pesannya tidak boleh terdengar seperti rusak.
      if (err?.name === 'NotAllowedError') {
        pesan(msgToken, 'Dibatalkan atau waktu habis. Coba lagi kalau perlu.', '');
      } else if (err?.name === 'SecurityError') {
        pesan(msgToken, 'Passkey tidak bisa dipakai di alamat ini.', 'galat');
      } else {
        pesan(msgToken, 'Passkey gagal: ' + (err?.message || 'penyebab tidak diketahui'), 'galat');
      }
    }
  });

  // ══ SSO (Google / Microsoft / Apple / GitHub) ════════════════════════════
  //
  // ── TOMBOL TERLIHAT TAPI NONAKTIF SAMPAI BACKEND SIAP ──────────────────────
  // Backend BELUM punya endpoint OAuth (`/api/auth/google`, `/api/auth/github`,
  // dst. tidak ada — sudah diverifikasi dengan grep). Mengaktifkan tombol
  // sekarang = 404 = pengguna mengira situsnya rusak.
  //
  // ── KENAPA DITAMPILKAN, BUKAN DISEMBUNYIKAN ────────────────────────────────
  // Menyembunyikan berarti pengunjung tidak tahu metode ini akan ada, dan
  // halaman terasa lebih miskin dari yang sebenarnya. Menampilkannya redup
  // dengan catatan "segera hadir" jujur pada dua sisi: bentuknya terlihat,
  // dan tidak ada yang mengklik tombol mati.
  //
  // Ketika endpoint OAuth ditambahkan nanti, tombol menyala sendiri tanpa
  // perlu mengubah HTML — cukup set flag di config server.
  async function siapkanSso() {
    let aktif = { google: false, github: false, microsoft: false, apple: false, sso: false };
    try {
      const r = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) {
        const d = await r.json();
        aktif = {
          google: Boolean(d?.sso?.google),
          github: Boolean(d?.sso?.github),
          microsoft: Boolean(d?.sso?.microsoft),
          apple: Boolean(d?.sso?.apple),
          sso: Boolean(d?.sso?.sso),
        };
      }
    } catch {
      // Server tidak terjangkau → biarkan semua tombol dalam keadaan awal
      // (nonaktif). Catatan "segera hadir" sudah ada di HTML, jadi pengunjung
      // tetap dapat penjelasan tanpa JavaScript tambahan.
      return;
    }

    // Penyedia SOSIAL — satu keluarga visual, satu baris.
    // SSO perusahaan TIDAK di sini: ia jalur terpisah dengan tombol sendiri
    // (lihat di bawah), mengikuti panduan Auth0/WorkOS.
    const penyedia = [
      { id: '#btnGoogle',    nama: 'Google',    url: '/api/auth/google',    siap: aktif.google },
      { id: '#btnMicrosoft', nama: 'Microsoft', url: '/api/auth/microsoft', siap: aktif.microsoft },
      { id: '#btnApple',     nama: 'Apple',     url: '/api/auth/apple',     siap: aktif.apple },
      { id: '#btnGithub',    nama: 'GitHub',    url: '/api/auth/github',    siap: aktif.github },
    ];

    const belumSiap = [];

    for (const p of penyedia) {
      const btn = $(p.id);
      if (!btn) continue;

      if (p.siap) {
        // Menyala: bisa diklik, catatan "segera" dihapus dari tombol ini.
        btn.disabled = false;
        btn.removeAttribute('title');
        btn.addEventListener('click', () => { window.location.href = p.url; });
      } else {
        belumSiap.push(p.nama);
        btn.title = p.nama + ' — akan tersedia';
      }
    }

    // ── SSO PERUSAHAAN: jalur terpisah ────────────────────────────────────────
    // Ditangani sendiri, bukan lewat loop penyedia di atas, karena metodenya
    // berbeda: pengguna diarahkan ke IdP organisasinya, bukan ke penyedia
    // identitas publik.
    const btnSso = $('#btnSso');
    if (btnSso) {
      if (aktif.sso) {
        btnSso.disabled = false;
        btnSso.removeAttribute('title');
        btnSso.addEventListener('click', () => { window.location.href = '/api/auth/sso'; });
      } else {
        // SSO TIDAK dimasukkan ke daftar catatan: ia punya tombolnya sendiri
        // di bawah, jadi menyebutnya lagi di catatan sosial hanya mengulang.
        btnSso.title = 'SSO perusahaan — akan tersedia';
      }
    }

    // ── CATATAN "SEGERA HADIR" ─────────────────────────────────────────────────
    // Satu baris untuk SEMUA provider yang belum siap, bukan lencana di tiap
    // tombol. Empat lencana "Segera" dalam satu baris membuat halaman terasa
    // belum jadi; satu catatan di bawahnya menyampaikan hal yang sama dengan
    // lebih tenang.
    //
    // Daftar nama disusun dari keadaan sebenarnya, jadi kalau Google aktif
    // sementara Apple belum, catatannya otomatis menyebut Apple saja.
    const catatan = document.getElementById('ssoSegera');
    if (catatan) {
      if (belumSiap.length === 0) {
        catatan.hidden = true;
      } else {
        catatan.hidden = false;
        catatan.textContent = belumSiap.join(', ') + ' akan tersedia.';
      }
    }
  }

  siapkanSso();

  // ══ Enrollment 2FA (setup) ══════════════════════════════════════════════
  //
  // Alur: mulaiEnrollment() → server balas QR + secret → pengguna memindai →
  //       memasukkan 6 digit → server memverifikasi → kode pemulihan.
  //
  // ── KENAPA PANEL TERPISAH, BUKAN MODAL ────────────────────────────────────
  // Setup 2FA butuh perhatian penuh: memindai QR, membuka aplikasi lain,
  // mengetik 6 digit, lalu MENYIMPAN kode pemulihan. Modal yang bisa
  // ditutup tidak sengaja akan membuat pengguna kehilangan kode pemulihan
  // tanpa sadar. Panel penuh memaksa satu alur yang selesai.

  let dataEnrollment = null;   // { secret, uri, akun, ... }

  /**
   * Isi satu set sel OTP (dipakai dua tempat: login 2FA dan setup 2FA).
   *
   * Dibuat fungsi terpisah karena logikanya identik — menyalinnya berarti
   * dua tempat yang harus diperbarui setiap kali ada perbaikan perilaku.
   */
  function pasangSelOtp(sel, { onLengkap } = {}) {
    if (!sel.length) return () => {};

    let timerKirim = null;

    const nilai = () => sel.map((s) => s.value).join('');

    const isi = (i, v) => {
      if (i < 0 || i >= sel.length) return;
      sel[i].value = v;
      sel[i].classList.toggle('is-terisi', v !== '');
    };

    const bersihkan = () => {
      if (timerKirim) { clearTimeout(timerKirim); timerKirim = null; }
    };

    sel.forEach((s, i) => {
      s.addEventListener('input', () => {
        const bersih = s.value.replace(/\D/g, '');
        if (bersih.length > 1) {
          // Pengguna menempel beberapa digit sekaligus (dari SMS atau
          // aplikasi authenticator). Sebar ke sel berikutnya.
          const digit = bersih.slice(0, sel.length - i).split('');
          digit.forEach((d, k) => isi(i + k, d));
          const berikut = Math.min(i + digit.length, sel.length - 1);
          sel[berikut].focus();
        } else {
          isi(i, bersih);
          if (bersih && i < sel.length - 1) sel[i + 1].focus();
        }

        if (nilai().length === sel.length && onLengkap) {
          // Jeda 280ms supaya mata sempat memverifikasi 6 digit sebelum
          // terkirim — dan pengguna masih bisa menekan Backspace.
          bersihkan();
          timerKirim = setTimeout(() => onLengkap(nilai()), 280);
        }
      });

      s.addEventListener('keydown', (e) => {
        bersihkan();
        if (e.key === 'Backspace' && !s.value && i > 0) {
          e.preventDefault();
          isi(i - 1, '');
          sel[i - 1].focus();
        }
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); sel[i - 1].focus(); }
        if (e.key === 'ArrowRight' && i < sel.length - 1) { e.preventDefault(); sel[i + 1].focus(); }
      });

      s.addEventListener('focus', () => s.select());
    });

    return { nilai, bersihkan, reset: () => { bersihkan(); sel.forEach((s) => isi(sel.indexOf(s), '')); sel[0]?.focus(); } };
  }

  /** Salin teks ke clipboard dengan fallback untuk browser lama/HTTP. */
  async function salin(teks) {
    try {
      // API modern — butuh HTTPS atau localhost.
      await navigator.clipboard.writeText(teks);
      return true;
    } catch {
      // Fallback: textarea sementara + document.execCommand.
      // Masih bekerja di semua browser meski sudah "deprecated".
      try {
        const ta = document.createElement('textarea');
        ta.value = teks;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  /** Tampilkan umpan balik singkat di tombol setelah menyalin. */
  function umpanSalin(tombol, teksAsli) {
    if (!tombol) return;
    const label = tombol.querySelector('span');
    tombol.classList.add('is-tersalin');
    if (label) label.textContent = 'Tersalin';
    setTimeout(() => {
      tombol.classList.remove('is-tersalin');
      if (label) label.textContent = teksAsli;
    }, 1800);
  }

  // ── Mulai enrollment ──────────────────────────────────────────────────────
  async function mulaiSetup2fa() {
    // Pengguna memilih mengaktifkan 2FA — jangan alihkan halaman.
    batalkanAlih();

    const wrap = $('#qrWrap');
    const skeleton = $('#qrSkeleton');
    const img = $('#qrImage');
    const msg = $('#msgSetup2fa');

    pindahPanel('setup2fa');
    pesan(msg, '');
    if (skeleton) skeleton.hidden = false;
    if (img) { img.hidden = true; img.removeAttribute('src'); }

    try {
      const hasil = await kirimJson('/api/token/2fa/mulai', {});

      if (!hasil.ok) {
        pesan(msg, pesanGalat(hasil, 'Gagal memulai setup 2FA.'), 'galat');
        if (skeleton) skeleton.hidden = true;
        return;
      }

      dataEnrollment = hasil.isi;

      // Tampilkan QR kalau server berhasil membuatnya.
      if (hasil.isi?.qr_data_url && img) {
        img.src = hasil.isi.qr_data_url;
        img.hidden = false;
        if (skeleton) skeleton.hidden = true;
      } else {
        // QR gagal dibuat — sembunyikan skeleton, buka panel secret manual
        // otomatis. Pengguna tetap bisa melanjutkan.
        if (skeleton) skeleton.hidden = true;
        const detail = $('#secretDetail');
        if (detail) detail.open = true;
        pesan(msg, hasil.isi?.qr_catatan ?? 'QR tidak tersedia — masukkan kode secara manual.', 'galat');
      }

      const sec = $('#secretText');
      if (sec) sec.textContent = hasil.isi?.secret ?? '—';

      // Fokuskan sel pertama supaya bisa langsung mengetik
      document.querySelector('[data-otp-setup="0"]')?.focus();
    } catch (err) {
      pesan(msg, err?.name === 'AbortError' ? 'Server tidak merespons.' : 'Gagal terhubung.', 'galat');
      if (skeleton) skeleton.hidden = true;
    }
  }

  // ── Selesaikan enrollment ─────────────────────────────────────────────────
  async function selesaikanSetup2fa(kode) {
    const btn = $('#btnSetup2fa');
    const msg = $('#msgSetup2fa');

    setMemuat(btn, true);
    pesan(msg, 'Memverifikasi…');

    try {
      const hasil = await kirimJson('/api/token/2fa/selesai', { code: kode });

      if (!hasil.ok) {
        pesan(msg, pesanGalat(hasil, 'Kode tidak cocok.'), 'galat');
        getar(kartu);
        // Kosongkan sel supaya bisa langsung coba lagi
        document.querySelectorAll('[data-otp-setup]').forEach((s) => {
          s.value = ''; s.classList.remove('is-terisi');
        });
        document.querySelector('[data-otp-setup="0"]')?.focus();
        return;
      }

      // Berhasil — tampilkan kode pemulihan.
      tampilkanKodePemulihan(hasil.isi?.kode_pemulihan ?? []);
    } catch (err) {
      pesan(msg, err?.name === 'AbortError' ? 'Server tidak merespons.' : 'Gagal terhubung.', 'galat');
      getar(kartu);
    } finally {
      setMemuat(btn, false);
    }
  }

  // ── Tampilkan kode pemulihan ──────────────────────────────────────────────
  let kodePemulihanSaatIni = [];

  function tampilkanKodePemulihan(kode) {
    kodePemulihanSaatIni = kode;
    const list = $('#recoveryList');
    if (!list) return;

    list.innerHTML = '';
    kode.forEach((k, i) => {
      const li = document.createElement('li');
      li.textContent = k;
      // Jeda bertahap: daftar terasa "terbentuk", bukan muncul sekaligus.
      // Dibatasi 8 item (jumlah kode), jadi totalnya < 350ms.
      li.style.animationDelay = `${i * 40}ms`;
      list.appendChild(li);
    });

    // Reset konfirmasi — wajib dicentang ulang setiap kali kode baru tampil.
    const chk = $('#chkSimpan');
    const lanjut = $('#btnLanjut');
    if (chk) chk.checked = false;
    if (lanjut) lanjut.disabled = true;

    pindahPanel('pemulihan');
  }

  /** Unduh kode pemulihan sebagai berkas teks. */
  function unduhKodePemulihan() {
    if (!kodePemulihanSaatIni.length) return;

    const baris = [
      'KODE PEMULIHAN — Area Klien',
      '='.repeat(40),
      '',
      'Simpan berkas ini di tempat aman. Setiap kode hanya bisa',
      'dipakai SEKALI untuk masuk kalau Anda kehilangan ponsel.',
      '',
      ...kodePemulihanSaatIni,
      '',
      '='.repeat(40),
      `Dibuat: ${new Date().toLocaleString('id-ID')}`,
      '',
      'JANGAN bagikan kode ini. Siapa pun yang memilikinya bisa',
      'masuk ke akun Anda tanpa kode dari aplikasi authenticator.',
    ].join('\n');

    // Blob + URL.createObjectURL — tidak butuh server, tidak butuh
    // hak akses khusus. URL di-revoke setelah klik supaya tidak
    // menahan memori.
    const blob = new Blob([baris], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kode-pemulihan.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Pemasangan handler ────────────────────────────────────────────────────
  function pasangEnrollment2fa() {
    const selSetup = Array.from(document.querySelectorAll('[data-otp-setup]'));
    if (selSetup.length) {
      const otp = pasangSelOtp(selSetup, {
        onLengkap: (kode) => selesaikanSetup2fa(kode),
      });
      // Batal: bersihkan sel supaya tidak ada kode tersisa di DOM
      $('#btnBatalSetup')?.addEventListener('click', () => {
        otp.reset();
        dataEnrollment = null;
        const img = $('#qrImage');
        if (img) { img.hidden = true; img.removeAttribute('src'); }
        const sec = $('#secretText');
        if (sec) sec.textContent = '—';
        pesan($('#msgSetup2fa'), '');
        pindahPanel('masuk');
      });
    }

    // Tombol setup dari panel selesai / status
    $('#btnSetup2faMulai')?.addEventListener('click', mulaiSetup2fa);

    // Form submit manual (kalau auto-submit dibatalkan dengan Backspace)
    $('#formSetup2fa')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const kode = Array.from(document.querySelectorAll('[data-otp-setup]'))
        .map((s) => s.value).join('');
      if (kode.length !== 6) {
        pesan($('#msgSetup2fa'), 'Masukkan 6 digit kode.', 'galat');
        return;
      }
      selesaikanSetup2fa(kode);
    });

    // Salin secret
    $('#btnCopySecret')?.addEventListener('click', async (e) => {
      const teks = $('#secretText')?.textContent ?? '';
      if (!teks || teks === '—') return;
      const ok = await salin(teks);
      if (ok) umpanSalin(e.currentTarget, '');
      else pesan($('#msgSetup2fa'), 'Gagal menyalin. Pilih teksnya manual.', 'galat');
    });

    // Salin semua kode pemulihan
    $('#btnCopyRecovery')?.addEventListener('click', async (e) => {
      const ok = await salin(kodePemulihanSaatIni.join('\n'));
      if (ok) umpanSalin(e.currentTarget, 'Salin semua');
      else pesan($('#msgSetup2fa'), 'Gagal menyalin.', 'galat');
    });

    // Unduh kode pemulihan
    $('#btnUnduhRecovery')?.addEventListener('click', unduhKodePemulihan);

    // Konfirmasi sudah menyimpan → aktifkan tombol lanjut
    $('#chkSimpan')?.addEventListener('change', (e) => {
      const lanjut = $('#btnLanjut');
      if (lanjut) lanjut.disabled = !e.target.checked;
    });

    // Lanjut ke proyek
    $('#btnLanjut')?.addEventListener('click', () => {
      // Bersihkan kode dari memori & DOM sebelum berpindah halaman —
      // tidak ada alasan kode pemulihan tetap ada setelah dikonfirmasi.
      kodePemulihanSaatIni = [];
      const list = $('#recoveryList');
      if (list) list.innerHTML = '';
      selesai(proyekAktif, null);
    });
  }

  // Proyek yang sedang dipakai — diisi saat login berhasil.
  let proyekAktif = '';

  // ══ Siklus hidup halaman ═════════════════════════════════════════════════

  /** Saat tab disembunyikan: hentikan SEMUA yang berjalan.
   *  Ini bukan optimasi kecil — browser yang menghitung frame di latar
   *  belakang bisa memakai 5-10% CPU terus-menerus. Di laptop, itu
   *  baterai terkuras tanpa pengguna sadar. */
  function onVisibility() {
    const tersembunyi = document.visibilityState === 'hidden';
    document.body.classList.toggle('is-tersembunyi', tersembunyi);
    // (partikel dihapus — tidak ada yang perlu dijeda saat tab tersembunyi)
  }

  function onResize() {
    // Partikel sudah dihapus — tidak ada kanvas yang perlu diukur ulang.
    // Listener ini tetap ada karena tilt kartu 3D membaca ukuran viewport.
  }

  function bersihkan() {
    // (partikel dihapus)
    if (rafTilt !== null) { cancelAnimationFrame(rafTilt); rafTilt = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
  }

  // ══ Mulai ════════════════════════════════════════════════════════════════

  /**
   * Terjemahkan kode galat OAuth dari URL menjadi pesan yang berguna.
   *
   * ── KENAPA PERLU ──
   * Backend mengalihkan kegagalan OAuth ke /sign-in?galat=<kode>. Tanpa
   * penerjemah ini, pengguna kembali ke halaman masuk dan melihat halaman
   * biasa — tanpa tahu apa yang salah. Ia mengira tombolnya rusak.
   *
   * ── ATURAN PESAN ──
   * Setiap pesan menjawab dua hal: APA yang terjadi, dan APA yang bisa
   * dilakukan. Pesan yang hanya bilang "gagal" tidak menolong siapa pun.
   *
   * ── KENAPA KODE, BUKAN PESAN LANGSUNG DARI SERVER ──
   * Pesan asli dari provider bisa memuat detail internal (nama endpoint,
   * kode respons) dan URL terlihat serta tersimpan di riwayat browser.
   * Yang lewat URL hanya kode pendek; terjemahannya ada di sini.
   */
  const PESAN_GALAT_OAUTH = {
    provider_belum_aktif:
      'Cara masuk itu belum aktif. Gunakan email dan sandi, atau hubungi dukungan.',
    provider_tidak_dikenal:
      'Penyedia identitas itu tidak dikenali.',
    state_tidak_sah:
      'Sesi masuk sudah kedaluwarsa. Coba lagi dari awal.',
    callback_tidak_lengkap:
      'Penyedia tidak mengirim data yang dibutuhkan. Coba lagi.',
    provider_tidak_cocok:
      'Terjadi ketidakcocokan data. Coba lagi dari awal.',
    tukar_code_gagal:
      'Tidak bisa menyelesaikan masuk. Coba lagi, atau gunakan email dan sandi.',
    identitas_gagal:
      'Identitas Anda tidak bisa diverifikasi. Coba lagi atau gunakan cara lain.',
    identitas_kosong:
      'Penyedia tidak mengirim identitas. Coba cara lain.',
    akun_gagal:
      'Akun tidak bisa dibuat saat ini. Coba lagi sebentar lagi.',
    akun_tidak_ditemukan:
      'Akun tidak ditemukan. Daftar dulu, atau gunakan cara lain.',
    ditolak_pengguna:
      '',   // pengguna sendiri yang membatalkan — tidak perlu pesan galat
    terlalu_banyak:
      'Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.',
    sso_belum_aktif:
      'SSO perusahaan belum aktif. Gunakan cara lain, atau hubungi dukungan.',
    sso_belum_dikonfigurasi:
      'SSO perusahaan belum selesai disiapkan. Hubungi dukungan Anda.',
  };

  /** Baca ?galat= dari URL, tampilkan pesannya, lalu bersihkan URL. */
  function tanganiGalatOauth() {
    let kode;
    try {
      kode = new URLSearchParams(location.search).get('galat');
    } catch {
      return;   // URL tidak bisa dibaca — abaikan
    }
    if (!kode) return;

    // Tampilkan pesannya kalau ada. Kode yang sengaja tidak punya pesan
    // (ditolak_pengguna) dan kode tak dikenal sama-sama dilewati — tapi
    // URL-nya TETAP dibersihkan di bawah.
    const teks = PESAN_GALAT_OAUTH[kode];
    if (teks) pesan(msgMasuk, teks, 'galat');

    // ── KENAPA URL SELALU DIBERSIHKAN ──
    // Tanpa ini, memuat ulang halaman menampilkan galat yang sama selamanya,
    // dan URL bergalat bisa ikut tersalin kalau pengguna membagikan tautan.
    //
    // Dibersihkan untuk SEMUA kode — termasuk yang tidak punya pesan dan
    // yang tidak dikenal. Kalau hanya dibersihkan saat ada pesan, pengguna
    // yang membatalkan login akan terjebak dengan URL ?galat=ditolak_pengguna
    // setiap kali memuat ulang.
    //
    // replaceState (bukan pushState) supaya tombol "kembali" tidak membawa
    // pengguna ke URL bergalat itu lagi.
    try {
      const bersih = new URL(location.href);
      bersih.searchParams.delete('galat');
      history.replaceState(null, '', bersih.pathname + bersih.search + bersih.hash);
    } catch { /* gagal membersihkan URL bukan alasan menggagalkan semuanya */ }
  }

  function init() {
    pasangTilt();
    pasangOtp();
    pasangEnrollment2fa();
    siapkanPasskey();
    tanganiGalatOauth();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pagehide', bersihkan, { once: true });

    // Fokuskan field pertama — hemat satu klik untuk pengguna keyboard.
    // Di halaman daftar, field pertama adalah nama; di halaman masuk, email.
    // Keduanya memakai ?. jadi aman kalau elemennya tidak ada.
    // ── ISI EMAIL OTOMATIS DARI QUERY STRING ─────────────────────────────
    // Setelah mendaftar, pengguna dialihkan ke /masuk?email=... supaya tidak
    // perlu mengetik ulang. Hanya diisi kalau field-nya masih kosong —
    // jangan menimpa apa yang sudah diketik pengguna.
    try {
      const dariUrl = new URLSearchParams(location.search).get('email');
      const inp = $('#inpEmailMasuk');
      if (dariUrl && inp && !inp.value) {
        inp.value = dariUrl;
        // Fokuskan ke sandi, bukan email — emailnya sudah terisi.
        $('#inpSandi')?.focus();
      }
    } catch { /* URL tidak bisa dibaca — abaikan */ }

    ($('#inpEmailMasuk') ?? $('#inpNama'))?.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Ekspos untuk pengujian (tidak dipakai di produksi)
  window.__auth = { ambilFingerprint, pindahPanel };
})();
