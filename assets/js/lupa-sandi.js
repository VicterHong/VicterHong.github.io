/**
 * Halaman lupa sandi — minta tautan reset.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA HALAMAN INI ADA, BUKAN PANEL DI HALAMAN MASUK ───────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Sebelumnya "Lupa sandi?" hanya memindahkan panel di dalam kartu halaman
 * masuk. URL tidak berubah, dan ada tiga akibat nyata:
 *
 *   1. Tautan tidak bisa dikirim. "Buka /lupa-sandi" bisa di-Share ke teman
 *      atau ditaruh di dokumentasi. "Klik Lupa sandi di halaman masuk" tidak.
 *
 *   2. Tombol Back membawa pengguna KELUAR dari situs, bukan kembali ke
 *      halaman masuk — karena URL tidak pernah berubah.
 *
 *   3. Pengguna yang panik (lupa sandi) menghadapi kartu dengan banyak
 *      elemen: tombol sosial, kolom sandi, "ingat saya". Satu tugas per
 *      layar lebih baik untuk keadaan seperti itu.
 *
 * Stripe memakai pola yang sama: dashboard.stripe.com/reset adalah halaman
 * tersendiri, bukan panel.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── YANG DILAKUKAN HALAMAN INI ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Validasi format email di sisi klien (pesan cepat, tanpa perjalanan
 *      jaringan untuk kesalahan yang jelas).
 *   2. Ambil token Turnstile — endpoint ini rawan disalahgunakan untuk spam.
 *   3. Kirim ke /api/auth/lupa-sandi.
 *   4. Tampilkan panel "terkirim" — yang SELALU sama pesannya, baik email
 *      terdaftar maupun tidak.
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const formLupa = $('formLupa');
  const inpEmail = $('inpEmail');
  const btnKirim = $('btnKirim');
  const msgLupa = $('msgLupa');
  const emailTujuan = $('emailTujuan');
  const btnUlangi = $('btnUlangi');

  // ══════════════════════════════════════════════════════════════════════════
  // ── PANEL ─────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  function tampilkanPanel(nama) {
    for (const p of document.querySelectorAll('.auth-panel')) {
      p.classList.toggle('is-active', p.dataset.panel === nama);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── TURNSTILE ─────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ── KENAPA HALAMAN PEMULIHAN BUTUH TURNSTILE ────────────────────────────────
  //
  // Endpoint ini mengirim EMAIL. Tanpa verifikasi, siapa pun bisa memakainya
  // untuk membanjiri kotak masuk orang lain — atau menghabiskan kuota
  // pengiriman (Brevo gratis: 300/hari).
  //
  // ── KENAPA TIDAK MEMAKAI ULANG KODE DARI auth.js ────────────────────────────
  //
  // auth.js adalah berkas 2.600 baris yang menangani login, daftar, 2FA,
  // passkey, SSO, dan pemulihan akun. Memuatnya di halaman ini berarti
  // mengunduh ~24 KB kode yang 95%-nya tidak dipakai.
  //
  // Yang dibutuhkan dari sana hanya dua hal: render widget dan tunggu token.
  // Itu ~40 baris. Menyalinnya lebih murah daripada memuat seluruh berkas —
  // dan komentar ini mencatat bahwa salinannya disengaja, supaya tidak
  // dianggap duplikasi yang tidak disadari.

  let widgetId = null;
  let tokenTurnstile = null;

  function siapkanTurnstile() {
    const slot = $('turnstileSlot');
    if (!slot || widgetId !== null) return;

    const kunci = window.__TURNSTILE_SITEKEY__;
    if (!kunci) return;   // tidak dikonfigurasi — server yang menilai

    if (typeof window.turnstile === 'undefined') return;

    try {
      widgetId = window.turnstile.render(slot, {
        sitekey: kunci,
        // `size: 'flexible'` mengikuti lebar wadah. Widget ukuran tetap
        // (300px) akan terpotong di layar 320px.
        size: 'flexible',
        callback: (t) => { tokenTurnstile = t; },
        'expired-callback': () => { tokenTurnstile = null; },
        'error-callback': () => { tokenTurnstile = null; },
      });
    } catch {
      // Widget gagal dirender — biarkan. Server tetap memvalidasi, dan
      // menahan pengguna karena widget rusak lebih buruk daripada
      // mengirim permintaan tanpa token (server akan menolaknya kalau
      // Turnstile memang wajib).
      widgetId = null;
    }
  }

  /** Tunggu token Turnstile, maksimal `timeoutMs`. */
  function tungguToken(timeoutMs = 8000) {
    if (tokenTurnstile) return Promise.resolve(tokenTurnstile);

    const kunci = window.__TURNSTILE_SITEKEY__;
    // Tidak ada site key = Turnstile tidak dikonfigurasi. Jangan tunggu.
    if (!kunci) return Promise.resolve(null);

    return new Promise((selesai) => {
      const mulai = Date.now();
      const cek = () => {
        if (tokenTurnstile) return selesai(tokenTurnstile);
        if (Date.now() - mulai > timeoutMs) return selesai(null);
        setTimeout(cek, 120);
      };
      cek();
    });
  }

  /** Reset widget supaya token berikutnya dihitung ulang. */
  function resetTurnstile() {
    tokenTurnstile = null;
    if (widgetId !== null && typeof window.turnstile !== 'undefined') {
      try { window.turnstile.reset(widgetId); } catch { /* widget sudah hilang */ }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── KIRIM ─────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  function sibuk(ya) {
    btnKirim.disabled = ya;
    btnKirim.classList.toggle('is-loading', ya);
    inpEmail.disabled = ya;
  }

  function pesan(teks, jenis) {
    if (!msgLupa) return;
    msgLupa.textContent = teks ?? '';
    msgLupa.classList.toggle('auth-msg-galat', jenis === 'galat');
  }

  formLupa?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btnKirim.disabled) return;

    const email = (inpEmail?.value ?? '').trim();

    // ── VALIDASI SISI KLIEN ─────────────────────────────────────────────────
    // Hanya untuk pesan cepat. Server memvalidasi ulang — dan server adalah
    // yang menentukan.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      pesan('Format email tidak valid.', 'galat');
      inpEmail?.focus();
      return;
    }

    sibuk(true);
    pesan('Mengirim…');

    // Widget mungkin belum dirender (skrip Turnstile dimuat async).
    siapkanTurnstile();
    const token = await tungguToken(8000);

    try {
      const res = await fetch('/api/auth/lupa-sandi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          'cf-turnstile-response': token,
        }),
        credentials: 'same-origin',
      });

      let isi = null;
      try { isi = await res.json(); } catch { /* balasan bukan JSON */ }

      if (!res.ok || !isi?.ok) {
        pesan(isi?.message ?? 'Gagal mengirim. Coba lagi.', 'galat');
        resetTurnstile();   // token terpakai — ambil yang baru untuk percobaan berikutnya
        return;
      }

      // ── PANEL TERKIRIM ────────────────────────────────────────────────────
      // Email ditampilkan sebagai konfirmasi APA YANG DIKETIK pengguna —
      // bukan sebagai konfirmasi bahwa email itu terdaftar.
      //
      // Bedanya penting: menampilkan email yang diketik tidak membocorkan
      // apa pun (pengguna sudah tahu apa yang mereka ketik). Yang tidak
      // boleh dibocorkan adalah APAKAH email itu ada di sistem.
      if (emailTujuan) emailTujuan.textContent = email;

      pesan('');
      tampilkanPanel('terkirim');

      // Gulir ke atas — di ponsel, kartu bisa lebih tinggi dari layar dan
      // pengguna mungkin tidak melihat panel baru muncul.
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      pesan(
        err?.name === 'AbortError'
          ? 'Server tidak merespons. Coba lagi.'
          : 'Tidak bisa terhubung. Periksa koneksi Anda.',
        'galat',
      );
    } finally {
      sibuk(false);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── KEMBALI KE FORM ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Pengguna yang salah mengetik email butuh cara memperbaiki. Ini tautan
  // teks, bukan tombol — mengirim ulang terlalu cepat akan ditolak pembatasan
  // laju server (3 permintaan per jendela), dan tombol yang gagal terasa rusak.
  btnUlangi?.addEventListener('click', (e) => {
    e.preventDefault();
    tampilkanPanel('form');
    resetTurnstile();
    inpEmail?.focus();
    inpEmail?.select();   // email lama tersorot — langsung bisa diganti
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── AWAL ──────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  // ── PREFILL DARI QUERY STRING ───────────────────────────────────────────────
  // Halaman masuk mengarahkan ke sini dengan ?email=... supaya pengguna tidak
  // perlu mengetik ulang email yang sudah mereka isi di sana.
  //
  // Aman: nilainya hanya diisikan ke kolom, tidak dikirim ke mana pun, dan
  // tidak ditampilkan sebagai teks HTML (memakai .value, bukan innerHTML).
  const dariUrl = new URLSearchParams(location.search).get('email');
  if (dariUrl && inpEmail && !inpEmail.value) {
    inpEmail.value = dariUrl;
    // Fokuskan tombol kirim — pengguna tinggal menekan Enter.
    requestAnimationFrame(() => btnKirim?.focus());
  } else {
    requestAnimationFrame(() => inpEmail?.focus());
  }

  // ── SITE KEY TURNSTILE ──────────────────────────────────────────────────────
  //
  // ── MASALAH YANG DIPERBAIKI DI SINI ─────────────────────────────────────────
  // Versi pertama mengambil site key dari /api/config dengan nama field yang
  // SALAH:
  //
  //   if (d?.turnstile_site_key)          ← field ini TIDAK ADA
  //
  // Respons sebenarnya berbentuk:
  //
  //   { "turnstile": { "enabled": true, "site_key": "0x4AAA…" } }
  //
  // Karena field-nya salah, `window.__TURNSTILE_SITEKEY__` tidak pernah terisi,
  // widget tidak dirender, dan server menolak setiap permintaan dengan
  // "Selesaikan verifikasi keamanan dulu, lalu kirim ulang" — pesan yang
  // membingungkan karena tidak ada widget untuk diselesaikan.
  //
  // ── KENAPA TIDAK LAGI MENGAMBIL DARI API SAMA SEKALI ────────────────────────
  // Site key sekarang ditulis langsung di HTML (lihat lupa-sandi.html), sama
  // seperti halaman masuk dan daftar. Itu membuat widget bisa dirender SEGERA
  // tanpa menunggu perjalanan jaringan — dan tetap bekerja kalau /api/config
  // sedang tidak bisa diakses.
  //
  // Blok ini hanya menjadi jaring pengaman: kalau site key belum ada (mis.
  // HTML di-cache versi lama), coba ambil dari API dengan nama field yang BENAR.
  if (!window.__TURNSTILE_SITEKEY__) {
    (async () => {
      try {
        const r = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) return;
        const d = await r.json();
        // Nama field yang BENAR: `turnstile.site_key` (nested), bukan
        // `turnstile_site_key` (flat).
        const kunci = d?.turnstile?.site_key;
        if (kunci) {
          window.__TURNSTILE_SITEKEY__ = kunci;
          siapkanTurnstile();
        }
      } catch {
        // Tidak bisa ambil config — server akan menolak permintaan tanpa token
        // kalau Turnstile memang wajib. Menahan form karena ini lebih buruk.
      }
    })();
  } else {
    // Site key sudah ada dari HTML — render widget segera.
    // Tunggu satu frame supaya skrip Turnstile sempat dimuat (ia `async defer`).
    const coba = (sisa) => {
      if (typeof window.turnstile !== 'undefined') { siapkanTurnstile(); return; }
      if (sisa <= 0) return;
      setTimeout(() => coba(sisa - 1), 200);
    };
    coba(25);   // ~5 detik
  }
})();
