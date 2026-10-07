/* ══ Halaman Masuk — logika ════════════════════════════════════════════════
 *
 * PRINSIP (dari skill motion-advanced, diadaptasi ke vanilla JS):
 *
 *   1. INTERRUPT-SAFE — setiap animasi bisa dibatalkan di tengah jalan dan
 *      digantikan yang baru tanpa lompatan. Di sini: kartu 3D memakai lerp
 *      (interpolasi bertahap), jadi target bisa berubah kapan saja.
 *
 *   2. HEMAT SAAT TIDAK TERLIHAT — animasi tanpa henti berhenti saat tab
 *      disembunyikan. Partikel berhenti total; blob dijeda lewat CSS.
 *
 *   3. HANYA TRANSFORM + OPACITY — partikel menggambar di <canvas> dengan
 *      requestAnimationFrame, tapi hanya mengubah posisi x/y. Tidak ada
 *      pembacaan layout (offsetWidth dll) di dalam loop — itu memicu
 *      "layout thrashing" yang membuat frame drop.
 *
 *   4. HORMATI prefers-reduced-motion — partikel tidak digambar sama sekali
 *      kalau pengguna memilih mengurangi gerak.
 *
 *   5. CLEANUP — semua listener dilepas, RAF dibatalkan saat halaman
 *      ditinggalkan. Tanpa ini, memori bocor di navigasi SPA-style.
 */

(() => {
  'use strict';

  // ── Pengaturan terpusat ──────────────────────────────────────────────────
  const KONFIG = {
    partikel: {
      jumlah: 34,          // cukup untuk tekstur, tidak sampai memenuhi CPU
      kecepatan: 0.16,     // px per frame — sangat lambat, sengaja
      radiusMin: 0.6,
      radiusMaks: 1.5,
      warna: 'rgba(245, 197, 66, 0.5)',
    },
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
    if (kurangiGerak) hentikanPartikel();
    else mulaiPartikel();
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

  // ══ Partikel latar ═══════════════════════════════════════════════════════

  const kanvas = $('#particles');
  let ctx = null;
  let titik = [];
  let rafId = null;
  let lebarKanvas = 0;
  let tinggiKanvas = 0;
  let waktuPartikelLalu = 0;

  // Durasi frame acuan (60fps) dalam milidetik. Semua gerakan berbasis
  // waktu memakai ini sebagai satuan, supaya kecepatan sama di layar
  // 60Hz, 120Hz, maupun perangkat lambat.
  const FRAME_ACUAN = 1000 / 60;

  function ukurKanvas() {
    if (!kanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);  // batasi 2 — DPR 3 boros
    lebarKanvas = kanvas.clientWidth;
    tinggiKanvas = kanvas.clientHeight;
    kanvas.width = Math.round(lebarKanvas * dpr);
    kanvas.height = Math.round(tinggiKanvas * dpr);
    ctx = kanvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buatTitik() {
    const n = kurangiGerak ? 0 : KONFIG.partikel.jumlah;
    titik = Array.from({ length: n }, () => ({
      x: Math.random() * lebarKanvas,
      y: Math.random() * tinggiKanvas,
      // Kecepatan kecil & bisa negatif — arah acak, gerakan mengambang
      vx: (Math.random() - 0.5) * KONFIG.partikel.kecepatan * 2,
      vy: (Math.random() - 0.5) * KONFIG.partikel.kecepatan * 2,
      r: KONFIG.partikel.radiusMin +
         Math.random() * (KONFIG.partikel.radiusMaks - KONFIG.partikel.radiusMin),
      // Fase untuk denyut opacity — membuat partikel tidak "berkedip serempak"
      fase: Math.random() * Math.PI * 2,
    }));
  }

  function gambarPartikel(waktu, dt = 1) {
    if (!ctx) return;
    ctx.clearRect(0, 0, lebarKanvas, tinggiKanvas);

    for (const t of titik) {
      // Gerak: posisi berubah sesuai waktu yang berlalu (dt), lalu membalik
      // di tepi (bukan menghilang dan muncul di sisi lain — itu terlihat
      // seperti kedipan).
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      if (t.x < 0 || t.x > lebarKanvas) t.vx *= -1;
      if (t.y < 0 || t.y > tinggiKanvas) t.vy *= -1;

      // Denyut opacity: 0.35–1.0, periode ~4 detik per partikel
      const denyut = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(waktu * 0.00042 + t.fase));

      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = KONFIG.partikel.warna;
      ctx.globalAlpha = denyut;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loopPartikel(waktu) {
    // ── Delta-time untuk partikel ──────────────────────────────────────────
    // Masalah yang sama seperti kartu: `t.x += t.vx` adalah gerakan PER FRAME.
    // Di layar 120Hz partikel bergerak 2× lebih cepat; di HP lambat 2× lebih
    // lambat. Dengan faktor waktu, kecepatannya sama di semua perangkat.
    const dt = waktuPartikelLalu
      ? Math.min(waktu - waktuPartikelLalu, 100) / FRAME_ACUAN
      : 1;
    waktuPartikelLalu = waktu;

    gambarPartikel(waktu, dt);
    rafId = requestAnimationFrame(loopPartikel);
  }

  function mulaiPartikel() {
    if (kurangiGerak || !kanvas) return;
    if (rafId !== null) return;          // sudah jalan
    if (document.visibilityState === 'hidden') return;  // jangan mulai saat tersembunyi
    ukurKanvas();
    if (!titik.length) buatTitik();
    rafId = requestAnimationFrame(loopPartikel);
  }

  function hentikanPartikel() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
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

  /** Siapkan widget Turnstile di slot yang tersedia.
   *  Kalau gagal (jaringan/iklan pemblokir), JANGAN gagalkan login —
   *  server tetap punya pertahanan sendiri (rate limit, verifikasi token).
   *  Lebih baik pengguna bisa mencoba daripada terkunci total. */
  async function siapkanTurnstile() {
    const slot = $('#turnstileSlot');
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

  // ══ Alur: token ══════════════════════════════════════════════════════════

  const formToken = $('#formToken');
  const btnSubmit = $('#btnSubmit');
  const msgToken = $('#msgToken');

  formToken?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const proyek = $('#inpProject')?.value?.trim() ?? '';
    const token = $('#inpToken')?.value?.trim() ?? '';

    // Validasi lokal dulu — jangan buang perjalanan ke server untuk
    // kesalahan yang bisa diketahui sekarang.
    if (!proyek) {
      pesan(msgToken, 'Pilih proyek terlebih dahulu.', 'galat');
      getar(kartu);
      $('#inpProject')?.focus();
      return;
    }
    if (!token) {
      pesan(msgToken, 'Token akses belum diisi.', 'galat');
      getar(kartu);
      $('#inpToken')?.focus();
      return;
    }

    setMemuat(btnSubmit, true);
    pesan(msgToken, 'Memeriksa…');

    // Siapkan Turnstile sekarang — pengguna sudah menunjukkan niat.
    await siapkanTurnstile();

    try {
      const hasil = await kirimJson('/api/token/session', {
        project: proyek,
        token,
        device_fp: ambilFingerprint(),
        ...(turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {}),
      });

      if (!hasil.ok) {
        pesan(msgToken, pesanGalat(hasil, 'Token tidak diterima.'), 'galat');
        getar(kartu);
        // Token Turnstile sekali pakai — reset supaya percobaan berikutnya
        // mendapat yang baru.
        if (turnstileWidgetId !== null && window.turnstile) {
          window.turnstile.reset(turnstileWidgetId);
          turnstileToken = '';
        }
        return;
      }

      // Kalau server minta 2FA, lanjut ke panel TOTP
      if (hasil.isi?.perlu_totp) {
        pesan(msgToken, '');
        pindahPanel('totp');
        document.dispatchEvent(new Event('panel:totp'));
        return;
      }

      // Berhasil
      pesan(msgToken, '');
      selesai(proyek, hasil.isi);
    } catch (err) {
      const pesanErr = err?.name === 'AbortError'
        ? 'Server tidak merespons. Coba lagi.'
        : 'Gagal terhubung. Periksa koneksi Anda.';
      pesan(msgToken, pesanErr, 'galat');
      getar(kartu);
    } finally {
      setMemuat(btnSubmit, false);
    }
  });

  // ══ Alur: TOTP ═══════════════════════════════════════════════════════════

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
      const hasil = await kirimJson('/api/token/totp', {
        project: $('#inpProject')?.value?.trim() ?? '',
        code: kode,
      });

      if (!hasil.ok) {
        pesan(msgTotp, pesanGalat(hasil, 'Kode tidak valid.'), 'galat');
        getar(kartu);
        // Kosongkan & fokus ulang supaya pengguna bisa langsung coba lagi
        document.querySelectorAll('.auth-otp-cell').forEach((s) => {
          s.value = '';
          s.classList.remove('is-terisi');
        });
        document.querySelector('.auth-otp-cell')?.focus();
        return;
      }

      pesan(msgTotp, '');
      selesai($('#inpProject')?.value?.trim() ?? '', hasil.isi);
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
    pindahPanel('token');
  });

  // ══ Selesai ══════════════════════════════════════════════════════════════

  function selesai(proyek, data) {
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
    if (!kurangiGerak) {
      setTimeout(() => { window.location.href = tujuan; }, 900);
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

  $('#btnReveal')?.addEventListener('click', (e) => {
    const inp = $('#inpToken');
    const tombol = e.currentTarget;
    if (!inp) return;
    const terlihat = inp.type === 'text';
    inp.type = terlihat ? 'password' : 'text';
    tombol.setAttribute('aria-pressed', terlihat ? 'false' : 'true');
    tombol.setAttribute('aria-label', terlihat ? 'Tampilkan token' : 'Sembunyikan token');
    inp.focus();
  });

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

  $('#btnPasskey')?.addEventListener('click', () => {
    // Backend endpoint belum dibangun. Tampilkan pesan jujur, bukan
    // tombol yang diam-diam tidak melakukan apa-apa.
    pesan(msgToken, 'Passkey belum aktif. Gunakan token akses.', 'galat');
  });

  // ══ OAuth — tombol belum aktif ═══════════════════════════════════════════
  // Tombol sudah `disabled` di HTML. Kalau nanti Client ID tersedia,
  // cukup hapus `disabled` dan isi handler di bawah.

  $('#btnGoogle')?.addEventListener('click', () => {
    if ($('#btnGoogle').disabled) return;
    window.location.href = '/api/auth/google';
  });

  $('#btnGithub')?.addEventListener('click', () => {
    if ($('#btnGithub').disabled) return;
    window.location.href = '/api/auth/github';
  });

  // ══ Siklus hidup halaman ═════════════════════════════════════════════════

  /** Saat tab disembunyikan: hentikan SEMUA yang berjalan.
   *  Ini bukan optimasi kecil — browser yang menghitung frame di latar
   *  belakang bisa memakai 5-10% CPU terus-menerus. Di laptop, itu
   *  baterai terkuras tanpa pengguna sadar. */
  function onVisibility() {
    const tersembunyi = document.visibilityState === 'hidden';
    document.body.classList.toggle('is-tersembunyi', tersembunyi);
    if (tersembunyi) hentikanPartikel();
    else mulaiPartikel();
  }

  function onResize() {
    ukurKanvas();
    buatTitik();   // sebar ulang supaya tidak menumpuk di satu sudut
  }

  function bersihkan() {
    hentikanPartikel();
    if (rafTilt !== null) { cancelAnimationFrame(rafTilt); rafTilt = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
  }

  // ══ Mulai ════════════════════════════════════════════════════════════════

  function init() {
    ukurKanvas();
    buatTitik();
    mulaiPartikel();
    pasangTilt();
    pasangOtp();
    siapkanPasskey();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pagehide', bersihkan, { once: true });

    // Fokuskan field pertama — hemat satu klik untuk pengguna keyboard
    $('#inpProject')?.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Ekspos untuk pengujian (tidak dipakai di produksi)
  window.__auth = { ambilFingerprint, pindahPanel };
})();
