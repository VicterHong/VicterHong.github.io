/* ══ Halaman Keamanan Akun — logika ═══════════════════════════════════════════
 *
 * Tiga tugas:
 *   1. Tampilkan cara masuk yang tersambung ke akun
 *   2. Tambah passkey baru (WebAuthn)
 *   3. Hapus cara masuk, dengan konfirmasi
 *
 * ── KENAPA KONVERSI BASE64URL DITULIS DI SINI JUGA ───────────────────────────
 * auth.js punya fungsinya sendiri, tapi keduanya di dalam IIFE terpisah —
 * tidak bisa saling memanggil tanpa mengekspos ke window. Menaruh util di
 * window untuk dipakai dua halaman berbeda menciptakan ketergantungan
 * tersembunyi: mengubah auth.js bisa mematahkan halaman ini tanpa peringatan.
 *
 * Duplikasi 12 baris lebih aman daripada kopel tersembunyi.
 *
 * ── ATURAN PENGHAPUSAN ───────────────────────────────────────────────────────
 * Server MENOLAK menghapus cara masuk terakhir kalau akun tidak punya sandi.
 * Tanpa penjagaan itu, pengguna bisa mengunci dirinya sendiri di luar akun.
 * Halaman ini juga menonaktifkan tombolnya lebih dulu supaya pengguna tidak
 * perlu mencoba untuk tahu — tapi keputusan akhir tetap di server, karena
 * penjagaan yang hanya ada di klien bukan penjagaan.
 */

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ── Nama tampilan per provider ─────────────────────────────────────────────
  //
  // Server mengirim nama teknis ('google', 'passkey'). Yang dilihat pengguna
  // harus nama yang mereka kenal. Peta ini juga tempat menambahkan provider
  // baru tanpa mengubah logika di bawah.
  const LABEL = {
    google:    { nama: 'Google',    ket: 'Masuk dengan akun Google Anda' },
    microsoft: { nama: 'Microsoft', ket: 'Masuk dengan akun Microsoft Anda' },
    apple:     { nama: 'Apple',     ket: 'Masuk dengan Apple ID' },
    github:    { nama: 'GitHub',    ket: 'Masuk dengan akun GitHub' },
    passkey:   { nama: 'Passkey',   ket: 'Sidik jari, wajah, atau PIN perangkat' },
    sso:       { nama: 'SSO perusahaan', ket: 'Lewat identitas organisasi Anda' },
    sandi:     { nama: 'Sandi',     ket: 'Email dan sandi' },
  };

  // ── Ikon per jenis ─────────────────────────────────────────────────────────
  //
  // SVG inline, bukan pustaka ikon: satu ikon tidak sebanding dengan memuat
  // berkas eksternal yang menambah satu permintaan jaringan.
  const IKON = {
    kunci: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 .51.19.97.5 1.32V16a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2.68c.31-.35.5-.81.5-1.32a2 2 0 0 0-2-2Z"/><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9Z"/></svg>',
    kunciSandi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 7.5 19 4M18 6l2 2M9.5 14.5 12 17l-2 2-2.5-2.5M8 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>',
    perisai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    orang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
  };

  function ikonUntuk(identitas) {
    if (identitas.jenis === 'passkey') return IKON.kunci;
    if (identitas.provider === 'sso') return IKON.orang;
    return IKON.perisai;
  }

  // ── Konversi base64url ↔ byte ──────────────────────────────────────────────
  //
  // WebAuthn tidak menerima string base64 — ia butuh ArrayBuffer. Ini
  // kesalahan paling sering dan pesan galatnya (TypeError) tidak menjelaskan
  // apa pun.

  function b64keByte(nilai) {
    const s = String(nilai).replace(/-/g, '+').replace(/_/g, '/');
    const padding = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const biner = atob(s + padding);
    const byte = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i += 1) byte[i] = biner.charCodeAt(i);
    return byte;
  }

  function byteKeB64(buf) {
    let biner = '';
    const byte = new Uint8Array(buf);
    for (let i = 0; i < byte.length; i += 1) biner += String.fromCharCode(byte[i]);
    return btoa(biner).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ── Pesan status ───────────────────────────────────────────────────────────

  let timerPesan = null;

  /** Pesan khusus form profil — elemennya terpisah dari #kamPesan supaya
   *  pesan form tidak bertabrakan dengan pesan halaman (mis. saat menghapus
   *  cara masuk). Dua alur berbeda, dua tempat berbeda. */
  function pesanProfil(teks, jenis = '') {
    const el = $('#kamPesanProfil');
    if (!el) return;
    el.textContent = teks;
    el.classList.toggle('is-galat', jenis === 'galat');
    el.classList.toggle('is-sukses', jenis === 'sukses');
  }

  function pesan(teks, jenis = '') {
    const el = $('#kamPesan');
    if (!el) return;

    el.textContent = teks;
    el.classList.toggle('is-galat', jenis === 'galat');
    el.classList.toggle('is-sukses', jenis === 'sukses');

    // Pesan sukses hilang sendiri: pengguna tidak perlu membersihkannya, dan
    // pesan yang menetap lama-lama terlihat seperti bagian dari halaman.
    // Pesan galat TIDAK hilang sendiri — pengguna harus sempat membacanya.
    if (timerPesan) clearTimeout(timerPesan);
    if (jenis === 'sukses') {
      timerPesan = setTimeout(() => {
        el.textContent = '';
        el.classList.remove('is-sukses');
      }, 5000);
    }
  }

  // ── Muat data ──────────────────────────────────────────────────────────────

  let identitasCache = [];
  let punyaSandi = false;

  /** Data profil terakhir — dipakai mode edit untuk mengisi form dan
   *  mengembalikannya kalau pengguna menekan Batal. */
  let profilCache = { email: '', nama: '', perusahaan: '' };

  async function muat() {
    const memuat = $('#kamMemuat');
    const belumMasuk = $('#kamBelumMasuk');
    const isi = $('#kamIsi');
    const kaki = $('#kamKaki');

    try {
      const [resProfil, resIdentitas] = await Promise.all([
        fetch('/api/auth/profil', { credentials: 'same-origin' }),
        fetch('/api/auth/identitas', { credentials: 'same-origin' }),
      ]);

      // 401 = belum masuk. Itu bukan galat sistem — tampilkan ajakan masuk,
      // bukan pesan merah.
      if (resProfil.status === 401 || resIdentitas.status === 401) {
        memuat.hidden = true;
        belumMasuk.hidden = false;
        return;
      }

      if (!resProfil.ok || !resIdentitas.ok) {
        throw new Error('Server tidak bisa membalas data akun.');
      }

      const profil = await resProfil.json();
      const data = await resIdentitas.json();

      if (!profil.ok || !data.ok) throw new Error('Data akun tidak lengkap.');

      // ── Identitas akun ────────────────────────────────────────────────────
      $('#kamEmail').textContent = profil.email || '—';

      if (profil.nama) {
        $('#kamNama').textContent = profil.nama;
        $('#kamBarisNama').hidden = false;
      }
      if (profil.perusahaan) {
        $('#kamPerusahaan').textContent = profil.perusahaan;
        $('#kamBarisPerusahaan').hidden = false;
      }

      punyaSandi = Boolean(profil.punya_sandi);
      identitasCache = Array.isArray(data.identitas) ? data.identitas : [];

      // Simpan untuk mode edit — email ditampilkan tapi tidak bisa diubah.
      profilCache = {
        email: profil.email || '',
        nama: profil.nama || '',
        perusahaan: profil.perusahaan || '',
      };

      gambarSenarai();

      memuat.hidden = true;
      isi.hidden = false;
      kaki.hidden = false;

    } catch (err) {
      memuat.hidden = true;
      belumMasuk.hidden = false;
      const teks = $('#kamBelumMasuk .kam-kosong-teks');
      if (teks) {
        teks.textContent = 'Tidak bisa memuat data akun: ' + (err.message || 'penyebab tidak diketahui');
      }
    }
  }

  // ── Gambar senarai cara masuk ──────────────────────────────────────────────

  function gambarSenarai() {
    const senarai = $('#kamSenarai');
    const hitung = $('#kamHitung');
    senarai.innerHTML = '';

    // Sandi ditampilkan sebagai salah satu cara masuk kalau akun punya sandi.
    // Kalau tidak ditampilkan, pengguna melihat "2 cara masuk" padahal bisa
    // masuk dengan tiga cara — dan bingung kenapa jumlahnya tidak cocok.
    const item = [];

    if (punyaSandi) {
      item.push({
        id: null, // sandi tidak bisa dihapus dari sini (butuh alur ubah sandi)
        jenis: 'sandi',
        provider: 'sandi',
        hapus: false,
      });
    }

    for (const idn of identitasCache) {
      item.push({
        id: idn.id,
        jenis: idn.jenis,
        provider: idn.provider,
        email: idn.email,
        nama_perangkat: idn.nama_perangkat,
        dibuat_at: idn.dibuat_at,
        dipakai_terakhir: idn.dipakai_terakhir,
        hapus: true,
      });
    }

    // ── Lencana "Utama" ───────────────────────────────────────────────────────
    //
    // ── KESALAHAN SEBELUMNYA ──
    // Logikanya `utama: !punyaSandi && item.length === 0`, yang hanya benar
    // untuk akun TANPA sandi dengan identitas PERTAMA. Untuk akun dengan sandi
    // (kasus paling umum) tidak ada satu pun yang ditandai — lencananya tidak
    // pernah muncul.
    //
    // ── ATURAN YANG BENAR ──
    // Tandai cara masuk yang paling sering dipakai. Kalau tidak ada riwayat
    // pemakaian, tandai yang paling lama terdaftar — itu yang paling mungkin
    // jadi cara utama pengguna.
    //
    // HANYA SATU yang ditandai. Kalau semua ditandai, tidak ada yang istimewa.
    if (item.length > 0) {
      let utama = null;
      let waktuTerbaru = -1;

      for (const it of item) {
        const pakai = it.dipakai_terakhir || 0;
        if (pakai > waktuTerbaru) {
          waktuTerbaru = pakai;
          utama = it;
        }
      }

      // Tidak ada riwayat pemakaian sama sekali → pakai yang paling lama
      // terdaftar (urutan pertama di daftar, karena server mengurutkan ASC).
      if (utama && waktuTerbaru === 0) utama = item[0];

      if (utama) utama.utama = true;
    }

    const total = item.length;
    hitung.textContent = `${total} cara masuk`;

    // Server menolak menghapus cara masuk terakhir kalau tidak ada sandi.
    // Tombolnya dinonaktifkan lebih dulu supaya pengguna tidak perlu mencoba
    // untuk tahu alasannya.
    const bolehHapus = total > 1 || punyaSandi;

    for (const it of item) {
      const label = LABEL[it.provider] || { nama: it.provider, ket: '' };

      const li = document.createElement('li');
      li.className = 'kam-item';

      const ikon = document.createElement('span');
      ikon.className = 'kam-ikon';
      ikon.setAttribute('aria-hidden', 'true');
      ikon.innerHTML = ikonUntuk(it);

      const isi = document.createElement('div');
      isi.className = 'kam-item-isi';

      const judul = document.createElement('p');
      judul.className = 'kam-item-judul';
      judul.textContent = label.nama;

      if (it.utama) {
        const lencana = document.createElement('span');
        lencana.className = 'kam-lencana';
        lencana.textContent = 'Utama';
        judul.appendChild(lencana);
      }

      const ket = document.createElement('p');
      ket.className = 'kam-item-ket';
      // Keterangan: pakai nama perangkat kalau ada (passkey), email kalau ada,
      // kalau tidak pakai keterangan umum provider.
      ket.textContent = it.nama_perangkat
        || it.email
        || label.ket;

      isi.append(judul, ket);
      li.append(ikon, isi);

      if (it.hapus) {
        const tombol = document.createElement('button');
        tombol.type = 'button';
        tombol.className = 'kam-hapus';
        tombol.textContent = 'Hapus';
        tombol.disabled = !bolehHapus;

        if (!bolehHapus) {
          tombol.title = 'Ini satu-satunya cara masuk Anda. Buat sandi dulu supaya akun tidak terkunci.';
        } else {
          tombol.addEventListener('click', () => konfirmasiHapus(it, label.nama));
        }

        li.appendChild(tombol);
      }

      senarai.appendChild(li);
    }

    // Kalau tidak ada apa-apa (seharusnya tidak terjadi — minimal sandi atau
    // satu identitas), tampilkan keterangan supaya kartu tidak kosong.
    if (total === 0) {
      const li = document.createElement('li');
      li.className = 'kam-item';
      li.innerHTML = '<div class="kam-item-isi"><p class="kam-item-judul">Belum ada cara masuk</p><p class="kam-item-ket">Hubungi dukungan.</p></div>';
      senarai.appendChild(li);
    }
  }

  // ── Dialog konfirmasi ──────────────────────────────────────────────────────

  let aksiDialog = null;

  function bukaDialog(teks, saatHapus) {
    $('#kamDialogTeks').textContent = teks;
    $('#kamDialog').hidden = false;
    aksiDialog = saatHapus;
    $('#kamDialogBatal').focus();
  }

  function tutupDialog() {
    $('#kamDialog').hidden = true;
    aksiDialog = null;
  }

  function konfirmasiHapus(it, nama) {
    bukaDialog(
      `Cara masuk lewat ${nama} akan dihapus dari akun ini. Akun Anda tetap ada, `
      + 'tapi Anda tidak bisa lagi masuk lewat cara itu. Tindakan ini tidak bisa dibatalkan.',
      async () => {
        const tombol = $('#kamDialogHapus');
        tombol.disabled = true;
        tombol.textContent = 'Menghapus…';

        try {
          const res = await fetch('/api/auth/identitas/hapus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ id: it.id }),
          });
          const hasil = await res.json().catch(() => ({}));

          if (!res.ok || !hasil.ok) {
            pesan(hasil.message || 'Tidak bisa menghapus. Coba lagi.', 'galat');
          } else {
            pesan(hasil.message || 'Cara masuk dihapus.', 'sukses');
            // Muat ulang supaya jumlah dan tombolnya ikut menyesuaikan —
            // menghapus dari array lokal berarti menggandakan logika
            // penghitungan yang sudah ada di gambarSenarai().
            await muatUlangIdentitas();
          }
        } catch (err) {
          pesan('Gagal menghubungi server: ' + (err.message || 'penyebab tidak diketahui'), 'galat');
        } finally {
          tombol.disabled = false;
          tombol.textContent = 'Hapus';
          tutupDialog();
        }
      },
    );
  }

  async function muatUlangIdentitas() {
    const res = await fetch('/api/auth/identitas', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      identitasCache = Array.isArray(data.identitas) ? data.identitas : [];
      gambarSenarai();
    }
  }

  // ── Tambah passkey ─────────────────────────────────────────────────────────

  async function tambahPasskey() {
    const tombol = $('#btnTambahPasskey');
    const teksAsli = tombol.textContent;

    if (!window.PublicKeyCredential) {
      pesan('Peramban ini tidak mendukung passkey.', 'galat');
      return;
    }

    tombol.disabled = true;
    tombol.textContent = 'Menunggu perangkat…';

    const pulihkan = () => {
      tombol.disabled = false;
      tombol.textContent = teksAsli;
    };

    try {
      // ── Langkah 1: minta challenge ─────────────────────────────────────────
      const resMulai = await fetch('/api/auth/passkey/registrasi/mulai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      const opsi = await resMulai.json().catch(() => ({}));

      if (!resMulai.ok || !opsi.ok) {
        pulihkan();
        pesan(opsi.message || 'Tidak bisa memulai pendaftaran passkey.', 'galat');
        return;
      }

      // ── Langkah 2: minta perangkat membuat kredensial ──────────────────────
      const kredensial = await navigator.credentials.create({
        publicKey: {
          challenge: b64keByte(opsi.challenge),
          rp: opsi.rp,
          user: {
            id: b64keByte(opsi.user.id),
            name: opsi.user.name,
            displayName: opsi.user.displayName,
          },
          pubKeyCredParams: opsi.pubKeyCredParams,
          excludeCredentials: (opsi.excludeCredentials ?? []).map((c) => ({
            ...c,
            id: b64keByte(c.id),
          })),
          authenticatorSelection: opsi.authenticatorSelection,
          timeout: opsi.timeout ?? 120000,
          attestation: opsi.attestation ?? 'none',
        },
      });

      if (!kredensial) {
        pulihkan();
        pesan('Pendaftaran passkey dibatalkan.', '');
        return;
      }

      // ── Langkah 3: kirim untuk diverifikasi ────────────────────────────────
      //
      // Nama perangkat ditebak dari platform. Ini hanya label yang dilihat
      // pengguna di daftar — bukan bagian dari verifikasi. Kalau salah,
      // akibatnya hanya label yang kurang tepat.
      const namaPerangkat = tebakPerangkat();

      const resSelesai = await fetch('/api/auth/passkey/registrasi/selesai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: kredensial.id,
          challenge: opsi.challenge,
          nama_perangkat: namaPerangkat,
          response: {
            attestationObject: byteKeB64(kredensial.response.attestationObject),
            clientDataJSON: byteKeB64(kredensial.response.clientDataJSON),
          },
        }),
      });
      const hasil = await resSelesai.json().catch(() => ({}));

      if (!resSelesai.ok || !hasil.ok) {
        pulihkan();
        pesan(hasil.message || 'Passkey tidak bisa diverifikasi.', 'galat');
        return;
      }

      pesan(hasil.message || 'Passkey ditambahkan.', 'sukses');
      // WAJIB: tanpa ini tombol tetap "Menunggu perangkat…" selamanya, dan
      // pengguna tidak bisa menambah passkey kedua tanpa memuat ulang halaman.
      pulihkan();
      await muatUlangIdentitas();

    } catch (err) {
      pulihkan();

      if (err?.name === 'NotAllowedError') {
        pesan('Dibatalkan atau waktu habis.', '');
      } else if (err?.name === 'InvalidStateError') {
        pesan('Perangkat ini sudah terdaftar sebagai passkey untuk akun Anda.', 'galat');
      } else {
        pesan('Passkey gagal: ' + (err?.message || 'penyebab tidak diketahui'), 'galat');
      }
    }
  }

  /** Tebak nama perangkat dari platform — hanya untuk label di daftar. */
  function tebakPerangkat() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return 'Perangkat Apple';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Android/.test(ua)) return 'Perangkat Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Perangkat ini';
  }

  // ── Ikat ───────────────────────────────────────────────────────────────────

  function init() {
    $('#btnTambahPasskey')?.addEventListener('click', tambahPasskey);
    $('#kamDialogBatal')?.addEventListener('click', tutupDialog);
    $('#kamDialogHapus')?.addEventListener('click', () => aksiDialog?.());

    // Klik latar = batal. Klik di dalam kotak tidak boleh menutup.
    $('#kamDialog')?.addEventListener('click', (e) => {
      if (e.target?.dataset?.tutup === '1') tutupDialog();
    });

    // Escape menutup dialog — perilaku yang diharapkan dari dialog modal.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#kamDialog')?.hidden) tutupDialog();
    });

    // ══ MODE LIHAT / EDIT PROFIL ═══════════════════════════════════════════════
  //
  // ── KENAPA DUA MODE ────────────────────────────────────────────────────────
  // Form yang selalu terbuka membuat halaman terasa seperti sedang diisi,
  // bukan halaman informasi. Pengguna yang hanya ingin MEMERIKSA datanya
  // harus melihat input di mana-mana.
  //
  // Mode lihat = jawaban cepat untuk "data saya apa?".
  // Mode edit  = hanya muncul saat memang ingin mengubah.
  //
  // Pola ini sama dengan Stripe: informasi ditampilkan sebagai daftar, dan
  // tombol "Update" mengubahnya jadi form.

  function masukModeEdit() {
    const lihat = $('#kamProfilLihat');
    const edit = $('#kamProfilEdit');
    const tombolUbah = $('#kamUbahProfil');
    if (!lihat || !edit) return;

    // Isi form dengan data yang sedang tampil — pengguna mengedit dari
    // keadaan sekarang, bukan dari form kosong.
    const inpNama = $('#kamInputNama');
    const inpPerusahaan = $('#kamInputPerusahaan');
    const inpEmail = $('#kamInputEmail');
    if (inpNama) inpNama.value = profilCache.nama;
    if (inpPerusahaan) inpPerusahaan.value = profilCache.perusahaan;
    if (inpEmail) inpEmail.value = profilCache.email;

    lihat.hidden = true;
    edit.hidden = false;
    if (tombolUbah) tombolUbah.hidden = true;

    // Bersihkan pesan lama dari percobaan sebelumnya.
    pesanProfil('');

    // Fokuskan field pertama — hemat satu klik untuk pengguna keyboard.
    inpNama?.focus();
  }

  function keluarModeEdit() {
    const lihat = $('#kamProfilLihat');
    const edit = $('#kamProfilEdit');
    const tombolUbah = $('#kamUbahProfil');
    if (!lihat || !edit) return;

    lihat.hidden = false;
    edit.hidden = true;
    if (tombolUbah) tombolUbah.hidden = false;
    pesanProfil('');
  }

  async function simpanProfil(e) {
    e.preventDefault();

    const inpNama = $('#kamInputNama');
    const inpPerusahaan = $('#kamInputPerusahaan');
    const tombol = $('#kamSimpanProfil');

    const nama = (inpNama?.value || '').trim();
    const perusahaan = (inpPerusahaan?.value || '').trim();

    // ── Validasi klien: umpan balik cepat ─────────────────────────────────
    // Server memvalidasi ULANG — ini hanya supaya pengguna tidak menunggu
    // perjalanan bolak-balik untuk kesalahan yang jelas.
    if (nama.length < 3 || /\d/.test(nama)) {
      pesanProfil('Nama minimal 3 huruf, tanpa angka.', 'galat');
      inpNama?.focus();
      return;
    }

    if (tombol) { tombol.disabled = true; tombol.classList.add('is-memuat'); }
    pesanProfil('Menyimpan…');

    try {
      const res = await fetch('/api/auth/profil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nama, perusahaan }),
      });
      const hasil = await res.json().catch(() => ({}));

      if (!res.ok || !hasil.ok) {
        pesanProfil(hasil.message || 'Tidak bisa menyimpan. Coba lagi.', 'galat');
        return;
      }

      // Perbarui tampilan mode-lihat dengan nilai baru. Tanpa ini, pengguna
      // kembali ke mode lihat dan melihat data LAMA — dan mengira simpanannya
      // gagal, padahal berhasil.
      profilCache.nama = hasil.nama;
      profilCache.perusahaan = hasil.perusahaan;

      if (hasil.nama) {
        $('#kamNama').textContent = hasil.nama;
        $('#kamBarisNama').hidden = false;
      }
      if (hasil.perusahaan) {
        $('#kamPerusahaan').textContent = hasil.perusahaan;
        $('#kamBarisPerusahaan').hidden = false;
      } else {
        // Dikosongkan pengguna → sembunyikan barisnya.
        $('#kamBarisPerusahaan').hidden = true;
      }

      pesanProfil('Profil diperbarui.', 'sukses');

      // Kembali ke mode lihat setelah jeda singkat, supaya pesan "berhasil"
      // sempat terbaca. Langsung menutup form membuat pengguna tidak yakin
      // simpanannya jadi.
      setTimeout(keluarModeEdit, 900);

    } catch {
      pesanProfil('Tidak bisa menghubungi server. Coba lagi.', 'galat');
    } finally {
      if (tombol) { tombol.disabled = false; tombol.classList.remove('is-memuat'); }
    }
  }

  // ── Pasang handler ─────────────────────────────────────────────────────────
  $('#kamUbahProfil')?.addEventListener('click', masukModeEdit);
  $('#kamBatalProfil')?.addEventListener('click', keluarModeEdit);
  $('#kamProfilEdit')?.addEventListener('submit', simpanProfil);

  // ?keluar=1 → keluar dari akun, lalu ke halaman masuk.
    //
    // Path-nya /api/token/logout (sudah ada sejak dulu, dipakai panel admin).
    // Saya sempat menulis '/api/keluar' dari ingatan — path itu tidak ada,
    // dan membuatnya berarti menduplikasi logika destroySession + clearCookie
    // yang sudah berjalan.
    //
    // Sesi dihapus di server lebih dulu supaya benar-benar berakhir — bukan
    // hanya berpindah halaman dengan sesi yang masih hidup.
    const params = new URLSearchParams(location.search);
    if (params.get('keluar') === '1') {
      fetch('/api/token/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(() => {})
        .finally(() => { location.replace('/sign-in'); });
      return;
    }

    muat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
