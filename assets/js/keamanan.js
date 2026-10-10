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
  // ── SUMBER: PHOSPHOR, BUKAN GAMBAR SENDIRI ─────────────────────────────────
  // Jalur SVG di bawah diambil apa adanya dari @phosphor-icons/core@2.1.1
  // (lisensi MIT). Sebelumnya ketiga ikon ini digambar manual — hasilnya
  // stroke-width dan proporsi yang berbeda dari ikon lain di halaman yang
  // sama, sehingga terbaca seperti berasal dari dua desainer berbeda.
  //
  // ── KENAPA INLINE, BUKAN MEMUAT BERKAS ═════════════════════════════════════
  // Berkas ini dimuat sebagai <script> biasa, bukan ES module — jadi ia tidak
  // bisa `import`. Menyalin jalurnya ke sini adalah satu-satunya cara memakai
  // Phosphor tanpa mengubah cara halaman memuat skripnya.
  //
  // Alternatifnya (memuat phosphor.js terpisah) berarti satu permintaan
  // jaringan tambahan hanya untuk tiga ikon. Tidak sebanding.
  const IKON = {
    kunci: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-104a40,40,0,1,0-65.94,30.44L88.68,172.77A8,8,0,0,0,96,184h64a8,8,0,0,0,7.32-11.23l-13.38-30.33A40.14,40.14,0,0,0,168,112ZM136.68,143l11,25.05H108.27l11-25.05A8,8,0,0,0,116,132.79a24,24,0,1,1,24,0A8,8,0,0,0,136.68,143Z"/></svg>',
    kunciSandi: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M48,56V200a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0Zm92,54.5L120,117V96a8,8,0,0,0-16,0v21L84,110.5a8,8,0,0,0-5,15.22l20,6.49-12.34,17a8,8,0,1,0,12.94,9.4l12.34-17,12.34,17a8,8,0,1,0,12.94-9.4l-12.34-17,20-6.49A8,8,0,0,0,140,110.5ZM246,115.64A8,8,0,0,0,236,110.5L216,117V96a8,8,0,0,0-16,0v21l-20-6.49a8,8,0,0,0-4.95,15.22l20,6.49-12.34,17a8,8,0,1,0,12.94,9.4l12.34-17,12.34,17a8,8,0,1,0,12.94-9.4l-12.34-17,20-6.49A8,8,0,0,0,246,115.64Z"/></svg>',
    perisai: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z"/></svg>',
    orang: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>',
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

  /** URL foto profil yang tersimpan di server ('' = belum ada unggahan). */
  let avatarTersimpan = '';

  /** Data profil terakhir — dipakai mode edit untuk mengisi form dan
   *  mengembalikannya kalau pengguna menekan Batal. */
  let profilCache = { email: '', nama: '', perusahaan: '' };

  // ══ AVATAR: DIBUAT DARI NAMA, TANPA UNGGAHAN ═══════════════════════════════
  //
  // ── POLA INI DARI GITHUB ───────────────────────────────────────────────────
  // GitHub memberi setiap pengguna "identicon" — gambar yang DIHITUNG dari
  // hash user ID, bukan diunggah. Setiap akun punya identicon sejak dibuat.
  //
  // Vercel melakukan hal yang sama: avatar default dibuat, bukan diminta.
  //
  // ── KENAPA TIDAK MINTA UNGGAH FOTO ─────────────────────────────────────────
  // Fitur unggah berarti: penyimpanan berkas, validasi tipe dan ukuran,
  // pembersihan berkas lama, satu titik kegagalan lagi. Untuk halaman yang
  // jarang dibuka, itu tidak sebanding.
  //
  // Endpoint /avatar/<nama> sudah ada di worker dan menghasilkan SVG dari
  // inisial + warna stabil dari hash. Tidak ada yang perlu disimpan.
  //
  // ── DUA LAPIS CADANGAN ─────────────────────────────────────────────────────
  //   1. <img> dari /avatar/<nama>
  //   2. Inisial huruf di dalam span (sudah ada di HTML)
  //
  // Kalau gambar gagal (jaringan mati, worker sedang deploy), `onerror`
  // menghapus <img> dan inisialnya tetap terlihat. Tidak pernah ada ikon
  // "gambar rusak" di halaman korporat.
  function gambarAvatar(nama, email) {
    const kotak = $('#kamAvatar');
    const inisial = $('#kamAvatarInisial');
    if (!kotak) return;

    // Sumber nama: pakai nama kalau ada, kalau tidak bagian depan email.
    // Pengguna yang mendaftar lewat OAuth kadang belum punya nama.
    const sumber = (nama || '').trim() || (email || '').split('@')[0] || '?';

    // Dua kata → dua huruf ("Ada Lovelace" → "AL"), satu kata → dua huruf awal.
    const kata = sumber.split(/[\s._-]+/).filter(Boolean);
    const huruf = kata.length >= 2
      ? (kata[0][0] + kata[1][0]).toUpperCase()
      : sumber.slice(0, 2).toUpperCase();

    if (inisial) {
      inisial.textContent = huruf;
      inisial.hidden = false;   // tampilkan lagi (mungkin disembunyikan sebelumnya)
    }

    // Ganti gambar lama — muat() bisa dipanggil berkali-kali (setelah simpan
    // profil), dan tanpa ini <img> lama menumpuk.
    kotak.querySelector('img')?.remove();

    const img = document.createElement('img');
    img.className = 'kam-avatar-gambar';
    img.alt = '';                 // dekoratif: nama sudah ada di sebelahnya
    img.decoding = 'async';
    img.src = '/avatar/' + encodeURIComponent(sumber);
    img.addEventListener('error', () => { img.remove(); });
    img.addEventListener('load', () => {
      if (inisial) inisial.hidden = true;   // gambar tampil → inisial sembunyikan
    });
    kotak.appendChild(img);
  }

  // ── FOTO PROFIL ────────────────────────────────────────────────────────────
  //
  // ── URUTAN SUMBER AVATAR (satu arah, tidak saling menggantikan) ────────────
  //   1. Foto yang DIUNGGAH pengguna   — paling mewakili pilihannya sendiri
  //   2. Foto dari penyedia OAuth      — lebih baik daripada inisial
  //   3. Inisial otomatis dari nama    — selalu tersedia, nol penyimpanan
  //
  // ── KENAPA UNGGAHAN DIMULAI OLEH TOMBOL "SIMPAN", BUKAN SAAT MEMILIH ──────
  // Memilih berkas lalu langsung mengunggah berarti pengguna tidak punya
  // kesempatan membatalkan setelah melihat pratinjaunya. Dengan tombol
  // Simpan, ada satu langkah sadar di antaranya — dan langkah itu juga
  // tempat pesan galat muncul, bukan di tempat yang berpindah-pindah.
  //
  // ── KENAPA PRATINJAU PAKAI URL.createObjectURL ────────────────────────────
  // Ia menampilkan gambar LOKAL seketika, tanpa menunggu jaringan. Inilah
  // "aturan tiga detik": pengguna memutuskan berdasarkan apa yang ia lihat,
  // dan menunggu unggahan selesai hanya untuk melihat fotonya sendiri adalah
  // waktu yang terbuang.
  //
  // Object URL WAJIB dilepas (revokeObjectURL) saat tidak dipakai lagi —
  // kalau tidak, blob-nya tertahan di memori selama halaman terbuka.
  let berkasFotoTerpilih = null;
  let urlPratinjau = null;

  /** Batas di klien. Server tetap memeriksa ulang — ini hanya agar cepat. */
  const FOTO_MAKS_BYTE = 4 * 1024 * 1024;
  const FOTO_MAKS_SISI_MIN = 200;

  function bersihkanPratinjau() {
    if (urlPratinjau) {
      URL.revokeObjectURL(urlPratinjau);
      urlPratinjau = null;
    }
  }

  function pesanFoto(teks, jenis = '') {
    const el = $('#kamPesanFoto');
    if (!el) return;
    el.textContent = teks;
    el.classList.toggle('is-galat', jenis === 'galat');
    el.classList.toggle('is-sukses', jenis === 'sukses');
  }

  /**
   * Pasang gambar pada kotak avatar.
   *
   * `sumber` boleh URL (dari server atau object URL) — dan `null` berarti
   * kembalikan ke inisial. Fungsi ini satu-satunya tempat yang menyentuh
   * isi kotak avatar, supaya tidak ada dua jalur yang bisa tidak sinkron.
   */
  function pasangGambarAvatar(sumber) {
    const kotak = $('#kamAvatar');
    const inisial = $('#kamAvatarInisial');
    if (!kotak) return;

    kotak.querySelector('img')?.remove();

    if (!sumber) {
      if (inisial) inisial.hidden = false;
      return;
    }

    const img = document.createElement('img');
    img.className = 'kam-avatar-gambar';
    img.alt = '';                 // dekoratif: nama sudah ada di sebelahnya
    img.decoding = 'async';
    img.src = sumber;
    // Gagal memuat → kembali ke inisial. Tanpa ini, kotak avatar kosong dan
    // halaman terlihat rusak padahal hanya gambarnya yang gagal.
    img.addEventListener('error', () => { img.remove(); if (inisial) inisial.hidden = false; });
    img.addEventListener('load', () => { if (inisial) inisial.hidden = true; });
    kotak.appendChild(img);
  }

  /** Terapkan foto dari server (kalau ada) atau jatuh ke inisial. */
  function terapkanFotoServer(urlFoto, nama, email) {
    if (urlFoto) {
      pasangGambarAvatar(urlFoto);
      return;
    }
    // Tidak ada foto unggahan → avatar inisial dari Worker (pola lama).
    const sumber = (nama || '').trim() || (email || '').split('@')[0] || '?';
    const img = document.createElement('img');
    img.className = 'kam-avatar-gambar';
    img.alt = '';
    img.decoding = 'async';
    img.src = '/avatar/' + encodeURIComponent(sumber);
    const kotak = $('#kamAvatar');
    const inisial = $('#kamAvatarInisial');
    kotak?.querySelector('img')?.remove();
    img.addEventListener('error', () => { img.remove(); if (inisial) inisial.hidden = false; });
    img.addEventListener('load', () => { if (inisial) inisial.hidden = true; });
    kotak?.appendChild(img);
  }

  /**
   * Baca dimensi gambar di klien untuk menolak yang terlalu kecil SEBELUM
   * dikirim. Server tetap memeriksa ulang — ini hanya menghemat perjalanan.
   */
  function ukuranGambar(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const hasil = { lebar: img.naturalWidth, tinggi: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(hasil);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function pilihFoto(file) {
    if (!file) return;

    // Validasi cepat di klien. Pesan yang sama persis dengan server, supaya
    // pengguna tidak melihat dua versi berbeda untuk masalah yang sama.
    if (file.size > FOTO_MAKS_BYTE) {
      pesanFoto(`Foto terlalu besar. Maksimum ${Math.round(FOTO_MAKS_BYTE / 1024 / 1024)} MB.`, 'galat');
      return;
    }
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) {
      pesanFoto('Format tidak didukung. Pakai JPG, PNG, WebP, atau AVIF.', 'galat');
      return;
    }

    const ukuran = await ukuranGambar(file);
    if (ukuran && Math.min(ukuran.lebar, ukuran.tinggi) < FOTO_MAKS_SISI_MIN) {
      pesanFoto(
        `Foto terlalu kecil. Sisi terpendek minimal ${FOTO_MAKS_SISI_MIN}px `
        + `(foto Anda ${Math.min(ukuran.lebar, ukuran.tinggi)}px).`,
        'galat',
      );
      return;
    }

    // Simpan berkasnya, tampilkan pratinjau lokal, dan ubah tombolnya jadi
    // "Simpan foto" — pengguna melihat persis apa yang akan tersimpan.
    berkasFotoTerpilih = file;
    bersihkanPratinjau();
    urlPratinjau = URL.createObjectURL(file);
    pasangGambarAvatar(urlPratinjau);

    const teks = $('#kamTeksFoto');
    if (teks) teks.textContent = 'Simpan foto';
    $('#kamLabelFoto')?.classList.add('is-ada-perubahan');
    pesanFoto('Pratinjau. Tekan "Simpan foto" untuk menyimpan.', '');
  }

  async function simpanFoto() {
    if (!berkasFotoTerpilih) return;

    const label = $('#kamLabelFoto');
    const teks = $('#kamTeksFoto');
    const teksAsli = teks?.textContent ?? 'Ganti foto';

    if (teks) teks.textContent = 'Mengunggah…';
    label?.classList.add('is-sibuk');
    pesanFoto('Mengunggah dan memproses foto…', '');

    try {
      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: { 'content-type': berkasFotoTerpilih.type },
        credentials: 'same-origin',
        body: berkasFotoTerpilih,
      });
      const d = await res.json().catch(() => ({}));

      if (!res.ok || !d.ok) {
        pesanFoto(d.message || 'Foto tidak bisa diunggah. Coba lagi.', 'galat');
        return;
      }

      // Server sudah memproses: dipotong persegi, dikonversi WebP, EXIF
      // dibuang. Yang ditampilkan sekarang adalah HASIL SUNGGUHAN — bukan
      // pratinjau lokal. Kalau keduanya berbeda, pengguna melihat yang benar.
      bersihkanPratinjau();
      berkasFotoTerpilih = null;
      pasangGambarAvatar(d.url ? d.url + '?v=' + Date.now() : null);
      if (d.url) { avatarTersimpan = d.url; }

      if (teks) teks.textContent = 'Ganti foto';
      label?.classList.remove('is-ada-perubahan');
      const tombolHapus = $('#kamHapusFoto');
      if (tombolHapus) tombolHapus.hidden = false;

      pesanFoto(d.message || 'Foto profil diperbarui.', 'sukses');
    } catch {
      pesanFoto('Tidak bisa menghubungi server.', 'galat');
    } finally {
      label?.classList.remove('is-sibuk');
      // Kalau gagal, labelnya kembali ke teks semula — tapi hanya kalau
      // memang tidak ada perubahan tertunda yang menunggu disimpan.
      if (teks && berkasFotoTerpilih) teks.textContent = 'Simpan foto';
      else if (teks && !berkasFotoTerpilih) teks.textContent = 'Ganti foto';
      else if (teks) teks.textContent = teksAsli;
    }
  }

  async function hapusFoto() {
    const tombol = $('#kamHapusFoto');
    if (tombol) tombol.disabled = true;
    pesanFoto('Menghapus…', '');
    try {
      const res = await fetch('/api/auth/avatar', { method: 'DELETE', credentials: 'same-origin' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        pesanFoto(d.message || 'Tidak bisa menghapus foto.', 'galat');
        return;
      }
      avatarTersimpan = '';
      bersihkanPratinjau();
      berkasFotoTerpilih = null;
      // Kembali ke avatar inisial dari Worker.
      terapkanFotoServer('', $('#kamIdentitasNama')?.textContent, $('#kamIdentitasEmail')?.textContent);
      if (tombol) tombol.hidden = true;
      const teks = $('#kamTeksFoto');
      if (teks) teks.textContent = 'Ganti foto';
      $('#kamLabelFoto')?.classList.remove('is-ada-perubahan');
      pesanFoto(d.message || 'Foto profil dihapus.', 'sukses');
    } catch {
      pesanFoto('Tidak bisa menghubungi server.', 'galat');
    } finally {
      if (tombol) tombol.disabled = false;
    }
  }

  /** Isi kartu identitas (avatar + nama + email) di panel Profil. */
  function isiIdentitas(nama, email) {
    const n = (nama || '').trim();
    const e = (email || '').trim();

    const elNama = $('#kamIdentitasNama');
    const elEmail = $('#kamIdentitasEmail');
    if (elNama) elNama.textContent = n || e || '—';
    if (elEmail) elEmail.textContent = e || '—';

    // Foto unggahan menang atas avatar inisial. `avatarTersimpan` diisi dari
    // respons /api/auth/profil — jadi urutan sumbernya ditentukan server,
    // bukan ditebak klien.
    terapkanFotoServer(avatarTersimpan, n, e);

    // Tombol "Hapus" hanya masuk akal kalau memang ada foto yang bisa dihapus.
    const tombolHapus = $('#kamHapusFoto');
    if (tombolHapus) tombolHapus.hidden = !avatarTersimpan;
  }

  // ══ RIWAYAT PEMBELIAN ═══════════════════════════════════════════════════════
  //
  // ── KENAPA DIMUAT TERPISAH, BUKAN BERSAMA PROFIL ──────────────────────────
  // Profil dipakai di SETIAP kunjungan halaman ini. Riwayat pembelian hanya
  // dilihat sesekali. Memuat keduanya bersamaan berarti setiap pengunjung
  // menunggu permintaan yang jawabannya jarang dibutuhkan.
  //
  // Dimuat saat tab Pembayaran DIBUKA pertama kali — pola "lazy load" yang
  // dipakai GitHub untuk tab kontribusi dan Stripe untuk riwayat invoice.
  //
  // ── KENAPA HANYA SEKALI ───────────────────────────────────────────────────
  // Setelah dimuat, hasilnya disimpan. Membuka-tutup tab tidak memicu
  // permintaan baru — data pembelian tidak berubah selama halaman terbuka.
  let pembelianDimuat = false;

  function rupiah(n) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  }

  /** Label status yang bisa dibaca manusia. */
  const STATUS_BAYAR = {
    pending:  { teks: 'Menunggu pembayaran', kelas: 'is-menunggu' },
    paid:     { teks: 'Dibayar',             kelas: 'is-sukses' },
    lunas:    { teks: 'Dibayar',             kelas: 'is-sukses' },
    settlement: { teks: 'Dibayar',           kelas: 'is-sukses' },
    expired:  { teks: 'Kedaluwarsa',         kelas: 'is-gagal' },
    gagal:    { teks: 'Gagal',               kelas: 'is-gagal' },
    deny:     { teks: 'Ditolak',             kelas: 'is-gagal' },
    cancel:   { teks: 'Dibatalkan',          kelas: 'is-gagal' },
    refund:   { teks: 'Dikembalikan',        kelas: 'is-gagal' },
  };

  async function muatPembelian() {
    const daftar = $('#kamPembelian');
    const kosong = $('#kamBayarKosong');
    if (!daftar) return;

    // Sudah pernah dimuat → tidak perlu minta lagi.
    if (pembelianDimuat) return;

    try {
      const res = await fetch('/api/auth/pembelian', { credentials: 'same-origin' });

      // 401 di sini tidak mungkin terjadi kalau halaman sudah menampilkan
      // profil — tapi kalau sesi kedaluwarsa di antara dua permintaan,
      // jangan tampilkan galat merah: cukup biarkan panel kosong.
      if (!res.ok) return;

      const data = await res.json().catch(() => ({}));
      const beli = Array.isArray(data.pembelian) ? data.pembelian : [];
      pembelianDimuat = true;

      daftar.innerHTML = '';

      if (!beli.length) {
        if (kosong) kosong.hidden = false;
        return;
      }

      if (kosong) kosong.hidden = true;

      for (const b of beli) {
        const li = document.createElement('li');
        li.className = 'kam-item';

        const st = STATUS_BAYAR[b.status] || { teks: b.status || '—', kelas: '' };

        const kiri = document.createElement('div');
        kiri.className = 'kam-item-teks';

        const judul = document.createElement('p');
        judul.className = 'kam-item-judul';
        judul.textContent = `${b.tier || 'Token'} · ${b.periode || ''}`.trim();

        const ket = document.createElement('p');
        ket.className = 'kam-item-ket';
        // Tanggal + jumlah: dua hal yang dicari orang di riwayat pembelian.
        ket.textContent = [
          waktuRingkas(b.dibayar_pada || b.dibuat_pada, { jam: false }),
          rupiah(b.jumlah),
        ].filter(Boolean).join(' · ');

        kiri.appendChild(judul);
        kiri.appendChild(ket);

        const lencana = document.createElement('span');
        lencana.className = 'kam-lencana ' + st.kelas;
        lencana.textContent = st.teks;

        li.appendChild(kiri);
        li.appendChild(lencana);
        daftar.appendChild(li);
      }
    } catch {
      // Gagal memuat bukan keadaan darurat — panel tetap menampilkan
      // penjelasan kosong. Tidak ada pesan galat yang perlu ditakuti.
    }
  }

  // ══ PEMUATAN MALAS ══════════════════════════════════════════════════════════
  // Satu peta fungsi pemuat per panel — bukan satu variabel per tab, yang
  // berarti tujuh baris harus dijaga sinkron dan mudah terlupa.
  //
  // Dimuat saat tab DIBUKA: profil dipakai setiap kunjungan, tab lain hanya
  // sesekali. Memuat semuanya bersamaan memperlambat halaman yang paling
  // sering dibuka.
  const pemuat = {};

  function daftarPemuat(panelId, fn) {
    let sudah = false;
    // ── KENAPA ADA PARAMETER `paksa` ────────────────────────────────────────
    // Pemuatan malas menyimpan penanda "sudah pernah dimuat" supaya berpindah
    // tab tidak memicu permintaan jaringan berulang. Tapi setelah aksi yang
    // MENGUBAH data di server — mis. mencabut semua sesi lain — memuat ulang
    // justru yang diinginkan: daftar di layar harus mencerminkan keadaan
    // server, bukan salinan lama.
    //
    // Tanpa `paksa`, satu-satunya cara menyegarkan adalah memuat ulang
    // halaman — dan pengguna yang baru merasa aman karena mencabut semua
    // perangkat lain tidak boleh dipaksa memuat ulang untuk melihat hasilnya.
    pemuat[panelId] = async (paksa = false) => {
      if (sudah && !paksa) return;
      sudah = true;
      try { await fn(); } catch { sudah = false; }   // gagal → boleh coba lagi
    };
  }

  /** Format tanggal + jam ringkas. */
  /**
   * Format waktu ringkas. `{ jam: false }` untuk tanggal saja.
   *
   * ── KENAPA SATU FUNGSI, BUKAN DUA ──────────────────────────────────────────
   * Sebelumnya ada `waktuRingkas()` dan `waktuRingkas()` — dua fungsi yang
   * berbeda HANYA pada apakah jam ditampilkan. Duplikasi seperti ini berbahaya
   * bukan karena ukurannya, tapi karena perbaikannya harus dilakukan dua kali:
   * ubah format bulan di satu tempat, yang lain tertinggal.
   */
  function waktuRingkas(ms, { jam = true } = {}) {
    if (!ms) return jam ? '—' : '';
    const opsi = { day: 'numeric', month: 'short', year: 'numeric' };
    if (jam) { opsi.hour = '2-digit'; opsi.minute = '2-digit'; }
    return new Date(ms).toLocaleString('id-ID', opsi);
  }

  // ── SESI AKTIF ─────────────────────────────────────────────────────────────
  //
  // ── POLA YANG DIIKUTI (GitHub / Google / Stripe "Active sessions") ─────────
  // Empat hal yang membuat daftar sesi terbaca cepat:
  //   1. IKON perangkat — mata menemukan "yang mana ponsel" sebelum membaca
  //   2. META DUA BARIS — lokasi/waktu di baris terpisah dari nama perangkat,
  //      bukan digabung jadi satu kalimat panjang yang harus diurai
  //   3. WAKTU RELATIF — "2 menit lalu" jauh lebih berguna daripada tanggal
  //      absolut saat pertanyaannya "apakah ini baru?"
  //   4. PERANGKAT INI ditandai NETRAL (abu), bukan kuning — kuning di palet
  //      ini berarti "perhatikan", padahal perangkat ini justru yang paling
  //      tidak perlu diperhatikan.
  const IKON_PERANGKAT = {
    ponsel: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z"/></svg>',
    tablet: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M192,24H64A24,24,0,0,0,40,48V208a24,24,0,0,0,24,24H192a24,24,0,0,0,24-24V48A24,24,0,0,0,192,24ZM56,72H200V184H56Zm8-32H192a8,8,0,0,1,8,8v8H56V48A8,8,0,0,1,64,40ZM192,216H64a8,8,0,0,1-8-8v-8H200v8A8,8,0,0,1,192,216Z"/></svg>',
    desktop: '<svg viewBox="0 0 256 256" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false"><path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24h72v16H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V200h72a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40ZM48,56H208a8,8,0,0,1,8,8v80H40V64A8,8,0,0,1,48,56ZM208,184H48a8,8,0,0,1-8-8V160H216v16A8,8,0,0,1,208,184Z"/></svg>',
  };

  /** Pilih ikon dari nama perangkat yang sudah diurai server. */
  function ikonPerangkat(nama) {
    const s = String(nama || '').toLowerCase();
    if (s.includes('ios') || s.includes('android')) return IKON_PERANGKAT.ponsel;
    if (s.includes('ipad') || s.includes('tablet')) return IKON_PERANGKAT.tablet;
    return IKON_PERANGKAT.desktop;
  }

  /**
   * Waktu relatif — "baru saja", "5 menit lalu", "3 hari lalu".
   *
   * ── KENAPA INI LEBIH BAIK DARIPADA TANGGAL ────────────────────────────────
   * Pertanyaan yang membawa pengguna ke daftar ini bukan "kapan tepatnya?"
   * melainkan "apakah ini baru?". "2 menit lalu" menjawabnya seketika;
   * "10 Okt 2026, 03.42" memaksa pengguna menghitung sendiri selisihnya.
   *
   * Tanggal lengkap tetap disimpan di `title` — kalau pengguna memang butuh
   * presisi, ia ada di sana tanpa membebani tampilan.
   */
  function waktuRelatif(ms) {
    if (!ms) return '';
    const detik = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (detik < 60) return 'baru saja';
    const menit = Math.round(detik / 60);
    if (menit < 60) return `${menit} menit lalu`;
    const jam = Math.round(menit / 60);
    if (jam < 24) return `${jam} jam lalu`;
    const hari = Math.round(jam / 24);
    if (hari < 30) return `${hari} hari lalu`;
    const bulan = Math.round(hari / 30);
    if (bulan < 12) return `${bulan} bulan lalu`;
    return `${Math.round(bulan / 12)} tahun lalu`;
  }

  daftarPemuat('panelSesi', async () => {
    const res = await fetch('/api/auth/sesi', { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json().catch(() => ({}));
    const sesi = Array.isArray(d.sesi) ? d.sesi : [];

    const daftar = $('#kamSesi');
    const kosong = $('#kamSesiKosong');
    const tombolSemua = $('#kamCabutSemua');
    if (!daftar) return;

    daftar.innerHTML = '';
    if (!sesi.length) {
      if (kosong) kosong.hidden = false;
      if (tombolSemua) tombolSemua.hidden = true;
      return;
    }
    if (kosong) kosong.hidden = true;

    /** Hitung sesi lain yang masih bisa dicabut (untuk tombol massal). */
    const lain = sesi.filter((x) => !x.sekarang && x.pengenal).length;
    if (tombolSemua) {
      tombolSemua.hidden = lain === 0;
      tombolSemua.textContent = `Cabut ${lain} perangkat lain`;
      tombolSemua.disabled = false;
    }

    for (const x of sesi) {
      const li = document.createElement('li');
      // Kelas tambahan menandai perangkat ini — dipakai CSS untuk latar samar
      // dan garis kiri, sehingga barisnya terbaca sebagai "kamu di sini"
      // tanpa perlu membaca lencananya.
      li.className = 'kam-item kam-item-sesi' + (x.sekarang ? ' is-sekarang' : '');

      // ── IKON ────────────────────────────────────────────────────────────────
      const ikon = document.createElement('span');
      ikon.className = 'kam-ikon kam-ikon-perangkat';
      ikon.setAttribute('aria-hidden', 'true');
      ikon.innerHTML = ikonPerangkat(x.perangkat);

      const isi = document.createElement('div');
      isi.className = 'kam-item-isi';

      const judul = document.createElement('p');
      judul.className = 'kam-item-judul';
      judul.textContent = x.perangkat || 'Perangkat tidak dikenal';

      // ── META BARIS 1: lokasi ────────────────────────────────────────────────
      // Negara dan IP dipisah dari waktu: keduanya menjawab "dari mana?", dan
      // pertanyaan itu berbeda dari "kapan?". Menggabungnya jadi satu baris
      // panjang membuat keduanya lebih lambat dibaca.
      const lokasi = document.createElement('p');
      lokasi.className = 'kam-item-ket';
      lokasi.textContent = [x.negara, x.ip].filter(Boolean).join(' · ') || 'Lokasi tidak diketahui';

      // ── META BARIS 2: waktu ─────────────────────────────────────────────────
      const waktu = document.createElement('p');
      waktu.className = 'kam-item-ket kam-item-ket-waktu';
      if (x.terakhir_aktif) {
        const relatif = waktuRelatif(x.terakhir_aktif);
        // ── KENAPA RELATIF *DAN* ABSOLUT ────────────────────────────────────
        // Relatif menjawab "apakah ini baru?" — pertanyaan yang membawa
        // pengguna ke sini. Absolut menjawab "tepatnya kapan?" — yang
        // dibutuhkan saat ia sudah memutuskan untuk menyelidiki. GitHub
        // menampilkan keduanya, dan keduanya memang menjawab pertanyaan
        // berbeda. Menyembunyikan yang absolut di tooltip saja berarti
        // pengguna ponsel tidak pernah bisa melihatnya.
        waktu.textContent = x.sekarang
          ? `Sedang dipakai sekarang · ${waktuRingkas(x.terakhir_aktif)}`
          : `Terakhir aktif ${relatif} · ${waktuRingkas(x.terakhir_aktif)}`;
      } else {
        waktu.textContent = 'Belum pernah dipakai';
      }

      isi.append(judul, lokasi, waktu);
      li.append(ikon, isi);

      if (x.sekarang) {
        // Lencana NETRAL, bukan kuning: perangkat ini tidak perlu perhatian.
        const l = document.createElement('span');
        l.className = 'kam-lencana is-netral';
        l.textContent = 'Perangkat ini';
        li.appendChild(l);
      } else if (x.pengenal) {
        // ── TOMBOL CABUT ────────────────────────────────────────────────────
        // Instruksi "cabut yang tidak Anda kenali" tidak ada artinya tanpa
        // tombolnya. Sesi sekarang TIDAK diberi tombol: mencabutnya berarti
        // pengguna langsung terlempar keluar — untuk itu sudah ada tombol
        // Keluar, dan jalurnya berbeda.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kam-hapus';
        btn.textContent = 'Cabut';
        btn.setAttribute('aria-label', `Cabut sesi ${x.perangkat || 'ini'}`);
        btn.addEventListener('click', () => konfirmasiCabutSesi(x, li, daftar, kosong));
        li.appendChild(btn);
      }
      daftar.appendChild(li);
    }
  });

  /**
   * Konfirmasi sebelum mencabut sesi.
   *
   * ── KENAPA PAKAI KONFIRMASI, PADAHAL SEBELUMNYA TIDAK ─────────────────────
   * Tombol "Cabut" berdiri tepat di samping teks yang bisa disalahbaca, dan
   * tindakannya tidak bisa dibatalkan — perangkat lain langsung terlempar
   * keluar. GitHub dan Google sama-sama memakai konfirmasi di sini. Yang
   * dihindari bukan klik yang salah, tapi klik yang BENAR pada perangkat
   * yang salah.
   */
  function konfirmasiCabutSesi(x, li, daftar, kosong) {
    const nama = x.perangkat || 'perangkat ini';
    const tempat = [x.negara, x.ip].filter(Boolean).join(' · ');
    bukaDialog(
      `Sesi di ${nama}${tempat ? ` (${tempat})` : ''} akan dicabut. `
      + 'Perangkat itu harus masuk ulang. Tindakan ini tidak bisa dibatalkan.',
      async () => {
        const tombol = $('#kamDialogHapus');
        tombol.disabled = true;
        tombol.textContent = 'Mencabut…';
        try {
          const r = await fetch('/api/auth/sesi/cabut', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ pengenal: x.pengenal }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) {
            pesanPanel('#kamPesanSesi', d.message || 'Sesi dicabut.', 'sukses');
            li.remove();
            if (!daftar.children.length && kosong) kosong.hidden = false;
            // Tombol massal ikut menyesuaikan jumlah — kalau tidak, ia
            // menawarkan "cabut 2 perangkat" padahal tinggal satu.
            segarkanTombolMassal();
          } else {
            pesanPanel('#kamPesanSesi', d.message || 'Gagal mencabut sesi.', 'galat');
          }
        } catch {
          pesanPanel('#kamPesanSesi', 'Tidak bisa menghubungi server.', 'galat');
        } finally {
          tombol.disabled = false;
          tombol.textContent = 'Hapus';   // kembali ke label bawaan dialog
          tutupDialog();
        }
      },
      { judul: 'Cabut sesi ini?', labelTombol: 'Cabut sesi' },
    );
  }

  /**
   * Segarkan label tombol massal dari jumlah baris yang tersisa di DOM.
   *
   * ── KENAPA MENGHITUNG DOM, BUKAN MENYIMPAN ANGKA ──────────────────────────
   * Angka yang disimpan di variabel harus dijaga sinkron di setiap jalur yang
   * menghapus baris — dan satu jalur yang terlewat membuat labelnya berbohong.
   * Menghitung ulang dari DOM selalu benar, dan biayanya nol pada daftar
   * sependek ini.
   */
  function segarkanTombolMassal() {
    const tombol = $('#kamCabutSemua');
    if (!tombol) return;
    const lain = document.querySelectorAll('#kamSesi .kam-item-sesi:not(.is-sekarang)').length;
    tombol.hidden = lain === 0;
    tombol.textContent = `Cabut ${lain} perangkat lain`;
  }

  /** Muat ulang daftar sesi dari server (dipakai setelah aksi massal). */
  async function muatUlangSesi() {
    if (pemuat.panelSesi) await pemuat.panelSesi(true);
  }

  // ── TOKEN AKSES ────────────────────────────────────────────────────────────
  daftarPemuat('panelToken', async () => {
    const res = await fetch('/api/auth/token-saya', { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json().catch(() => ({}));
    const t = d.token;

    const daftar = $('#kamTokenDaftar');
    const kosong = $('#kamTokenKosong');
    if (!daftar) return;

    if (!t) {
      daftar.hidden = true;
      if (kosong) kosong.hidden = false;
      return;
    }

    daftar.hidden = false;
    if (kosong) kosong.hidden = true;

    const LENCANA = { aktif: 'is-sukses', dicabut: 'is-gagal', kedaluwarsa: 'is-gagal' };

    const baris = [
      ['Paket', t.tier || '—'],
      ['Proyek', t.proyek || '—'],
      ['Cakupan', (t.scopes || []).join(', ') || '—'],
      ['Terbit', waktuRingkas(t.terbit_pada)],
      ['Kedaluwarsa', t.kedaluwarsa_pada ? waktuRingkas(t.kedaluwarsa_pada) : 'Tidak ada'],
    ];

    daftar.innerHTML = '';
    for (const [k, v] of baris) {
      const div = document.createElement('div');
      div.className = 'kam-baris';
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      div.appendChild(dt);
      div.appendChild(dd);
      daftar.appendChild(div);
    }

    // Status sebagai baris terakhir, dengan lencana — bukan teks polos.
    const div = document.createElement('div');
    div.className = 'kam-baris';
    const dt = document.createElement('dt');
    dt.textContent = 'Status';
    const dd = document.createElement('dd');
    const l = document.createElement('span');
    l.className = 'kam-lencana ' + (LENCANA[t.status] || '');
    l.textContent = t.status || '—';
    dd.appendChild(l);
    div.appendChild(dt);
    div.appendChild(dd);
    daftar.appendChild(div);
  });

  // ── AKTIVITAS ──────────────────────────────────────────────────────────────
  daftarPemuat('panelAktivitas', async () => {
    const res = await fetch('/api/auth/aktivitas', { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json().catch(() => ({}));
    const akt = Array.isArray(d.aktivitas) ? d.aktivitas : [];

    const daftar = $('#kamAktivitas');
    const kosong = $('#kamAktivitasKosong');
    if (!daftar) return;

    daftar.innerHTML = '';
    if (!akt.length) { if (kosong) kosong.hidden = false; return; }
    if (kosong) kosong.hidden = true;

    // Nama aksi teknis → kalimat yang bisa dibaca.
    const AKSI = {
      auth_masuk: 'Masuk', auth_daftar: 'Akun dibuat', auth_keluar: 'Keluar',
      auth_oauth_masuk: 'Masuk lewat penyedia', auth_sso_masuk: 'Masuk lewat SSO',
      auth_passkey_masuk: 'Masuk dengan passkey',
      token_validate: 'Token divalidasi', token_revoke: 'Token dicabut',
    };

    for (const a of akt) {
      const li = document.createElement('li');
      li.className = 'kam-item';

      const kiri = document.createElement('div');
      kiri.className = 'kam-item-teks';

      const judul = document.createElement('p');
      judul.className = 'kam-item-judul';
      judul.textContent = AKSI[a.aksi] || a.aksi || 'Aktivitas';

      const ket = document.createElement('p');
      ket.className = 'kam-item-ket';
      ket.textContent = [waktuRingkas(a.pada), a.ip, a.negara].filter(Boolean).join(' · ');

      kiri.appendChild(judul);
      kiri.appendChild(ket);
      li.appendChild(kiri);

      // Hasil: hanya tampilkan kalau BUKAN keberhasilan biasa — supaya
      // daftar tidak penuh lencana hijau yang tidak menambah informasi.
      if (a.hasil && a.hasil !== 'ok' && a.hasil !== 'sukses') {
        const l = document.createElement('span');
        l.className = 'kam-lencana is-gagal';
        l.textContent = a.hasil;
        li.appendChild(l);
      }
      daftar.appendChild(li);
    }
  });

  // ── 2FA ────────────────────────────────────────────────────────────────────
  daftarPemuat('panel2fa', async () => {
    const res = await fetch('/api/auth/2fa/status', { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json().catch(() => ({}));

    const lencana = $('#kamLencana2fa');
    const teks = $('#kamTeks2fa');
    const daftar = $('#kamDaftar2fa');

    if (lencana) {
      lencana.className = 'kam-lencana ' + (d.aktif ? 'is-sukses' : 'is-menunggu');
      lencana.textContent = d.aktif ? 'Aktif' : 'Belum aktif';
    }
    if (teks) {
      teks.textContent = d.aktif
        ? 'Akun Anda terlindungi kode 6 digit dari aplikasi authenticator.'
        : 'Aktifkan verifikasi dua langkah saat masuk berikutnya untuk keamanan tambahan.';
    }

    // Detail teknis hanya ditampilkan kalau 2FA memang aktif — kalau belum,
    // daftar kosong hanya menambah baris yang tidak berarti.
    if (daftar && d.aktif) {
      daftar.hidden = false;
      daftar.innerHTML = '';
      const baris = [
        ['Aktif sejak', waktuRingkas(d.dibuat_pada)],
        ['Terakhir dipakai', d.terakhir_dipakai ? waktuRingkas(d.terakhir_dipakai) : 'Belum pernah'],
      ];
      for (const [k, v] of baris) {
        const div = document.createElement('div');
        div.className = 'kam-baris';
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        div.appendChild(dt); div.appendChild(dd);
        daftar.appendChild(div);
      }
    } else if (daftar) {
      daftar.hidden = true;
    }
  });

  /**
   * Tulis pesan status ke elemen tertentu.
   *
   * ── KENAPA BUKAN pesan() YANG SUDAH ADA ────────────────────────────────────
   * `pesan()` selalu menulis ke #kamPesan — elemen milik panel Keamanan. Tab
   * lain punya elemen pesannya sendiri (#kamPesanSesi, #kamPesanToken, dst).
   *
   * Memakai `pesan()` dari tab lain berarti pesannya muncul di panel yang
   * TIDAK SEDANG DILIHAT — pengguna menekan "Cabut", tidak terjadi apa-apa di
   * layar, padahal server sudah mencabut sesinya. Itu jenis kebingungan yang
   * paling mudah dihindari: pesan harus muncul di panel tempat aksinya terjadi.
   */
  function pesanPanel(sel, teks, jenis = '') {
    const el = $(sel);
    if (!el) return;
    el.textContent = teks;
    el.classList.toggle('is-galat', jenis === 'galat');
    el.classList.toggle('is-sukses', jenis === 'sukses');
  }

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

      // Nama disimpan untuk mode edit, tapi TIDAK ditampilkan sebagai baris:
      // ia sudah ada di kartu identitas tepat di atasnya.
      if (profil.nama) $('#kamNama').textContent = profil.nama;

      // Kartu identitas di atas panel — avatar + nama + email.
      // `avatarTersimpan` diisi SEBELUM isiIdentitas() dipanggil, karena
      // fungsi itu memakainya untuk memutuskan foto mana yang ditampilkan.
      avatarTersimpan = profil.avatar_url || '';
      isiIdentitas(profil.nama, profil.email);

      // ── TANGGAL DIBUAT ────────────────────────────────────────────────────────
      // Satu-satunya data yang ditampilkan di mode lihat — karena nama dan email
      // sudah ada di kartu identitas tepat di atasnya. Mengulangnya di sini
      // membuat pengunjung melihat data yang sama dua kali dalam satu layar.
      //
      // Format tanggal Indonesia, bukan ISO. Pengguna yang membuka halaman
      // akun ingin tahu "sejak kapan akun ini ada" — bukan membaca timestamp.
      const elDibuat = $('#kamDibuat');
      if (elDibuat && profil.dibuat_at) {
        elDibuat.textContent = new Date(profil.dibuat_at).toLocaleDateString('id-ID', {
          day: 'numeric', month: 'long', year: 'numeric',
        });
      }

      // ── TERAKHIR MASUK ────────────────────────────────────────────────────────
      // Sudah dikirim backend sejak dulu (`masuk_terakhir`), belum pernah
      // ditampilkan. Berguna untuk pengguna yang ingin tahu apakah akunnya
      // dipakai di tempat lain — pertanyaan keamanan yang wajar.
      //
      // Tanggal + jam, bukan hanya tanggal: "terakhir masuk 3 hari lalu"
      // kurang berguna kalau yang dicari "apakah tadi malam ada yang masuk".
      const elMasuk = $('#kamMasukTerakhir');
      if (elMasuk && profil.masuk_terakhir) {
        elMasuk.textContent = new Date(profil.masuk_terakhir).toLocaleString('id-ID', {
          day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      }

      punyaSandi = Boolean(profil.punya_sandi);
      identitasCache = Array.isArray(data.identitas) ? data.identitas : [];

      // ── ORGANISASI DI MODE LIHAT ──────────────────────────────────────────
      // Ditampilkan hanya kalau terisi. Pengguna pribadi tidak perlu melihat
      // baris kosong berlabel "Organisasi —".
      const barisPerusahaan = $('#kamBarisPerusahaan');
      const elPerusahaan = $('#kamPerusahaan');
      if (barisPerusahaan && elPerusahaan) {
        const ada = Boolean((profil.perusahaan || '').trim());
        elPerusahaan.textContent = ada ? profil.perusahaan.trim() : '—';
        barisPerusahaan.hidden = !ada;
      }

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

      // Ringkasan keamanan dimuat SETELAH panel tampil — ia butuh tiga
      // permintaan tambahan, dan kegagalannya tidak boleh menahan profil.
      muatRingkasanKeamanan();

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

  /**
   * Isi ringkasan keamanan di tab Profil.
   *
   * ── KENAPA TIGA PERMINTAAN TERPISAH, BUKAN SATU ────────────────────────────
   * Ketiganya endpoint yang SUDAH ADA dan sudah dipakai tab masing-masing —
   * membuat endpoint gabungan berarti menambah kode server hanya untuk
   * menghemat dua permintaan pada satu panel. Yang lebih penting: kegagalan
   * satu baris tidak boleh mengosongkan dua baris lainnya, dan itu otomatis
   * didapat kalau tiap baris punya permintaannya sendiri.
   *
   * ── NILAI YANG DITAMPILKAN HARUS NYATA ────────────────────────────────────
   * Tidak ada angka yang dikarang. Kalau permintaan gagal, selnya tetap "—" —
   * lebih baik terlihat belum termuat daripada menampilkan angka yang salah di
   * halaman keamanan.
   */
  async function muatRingkasanKeamanan() {
    const kotak = $('#kamRingkasan');
    if (!kotak) return;
    kotak.hidden = false;

    // Setiap baris berdiri sendiri: satu gagal, yang lain tetap terisi.
    const aman = (p) => p.then((r) => r).catch(() => null);

    const [resIdentitas, resSesi, res2fa] = await Promise.all([
      aman(fetch('/api/auth/identitas', { credentials: 'same-origin' })),
      aman(fetch('/api/auth/sesi', { credentials: 'same-origin' })),
      aman(fetch('/api/auth/2fa/status', { credentials: 'same-origin' })),
    ]);

    // ── CARA MASUK ──────────────────────────────────────────────────────────
    const elMasuk = $('#kamRingkasanMasuk');
    if (elMasuk && resIdentitas?.ok) {
      try {
        const d = await resIdentitas.json();
        // Sandi dihitung sebagai cara masuk kalau akun punya sandi — sama
        // seperti di gambarSenarai(), supaya kedua angka tidak pernah beda.
        const jumlah = (Array.isArray(d.identitas) ? d.identitas.length : 0) + (punyaSandi ? 1 : 0);
        elMasuk.textContent = String(jumlah);
      } catch { /* biarkan "—" */ }
    }

    // ── 2FA ─────────────────────────────────────────────────────────────────
    const el2fa = $('#kamRingkasan2fa');
    if (el2fa && res2fa?.ok) {
      try {
        const d = await res2fa.json();
        el2fa.textContent = d.aktif ? 'Aktif' : 'Belum aktif';
        // Warna mengikuti status: kuning = aktif (perlindungan menyala),
        // redup = belum. Bukan merah — belum mengaktifkan 2FA bukan kesalahan.
        el2fa.classList.toggle('is-aktif', Boolean(d.aktif));
      } catch { /* biarkan "—" */ }
    }

    // ── PERANGKAT AKTIF ─────────────────────────────────────────────────────
    const elSesi = $('#kamRingkasanSesi');
    if (elSesi && resSesi?.ok) {
      try {
        const d = await resSesi.json();
        const n = Array.isArray(d.sesi) ? d.sesi.length : 0;
        elSesi.textContent = String(n);
      } catch { /* biarkan "—" */ }
    }
  }

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
    // Pill angka, bukan kalimat: "1 cara masuk" tidak muat di sidebar 172px
    // tanpa membungkus. Kalimat lengkapnya pindah ke title + aria-label —
    // pembaca layar tetap mendengar keterangan yang utuh.
    hitung.textContent = String(total);
    hitung.title = `${total} cara masuk`;
    hitung.setAttribute('aria-label', `${total} cara masuk`);

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

  /**
   * Buka dialog konfirmasi.
   *
   * ── KENAPA JUDUL DAN LABEL TOMBOL IKUT DIKIRIM ─────────────────────────────
   * Versi pertama hanya menerima teks isi, dan judulnya dipaku di HTML
   * ("Hapus cara masuk?"). Saat aksi kedua datang — mencabut sesi — dialog itu
   * akan berbunyi "Hapus cara masuk?" di atas teks tentang perangkat. Judul
   * yang tidak cocok dengan isinya membuat pengguna ragu apakah ia sedang
   * mengonfirmasi hal yang benar, dan itu kebingungan terakhir yang
   * diinginkan pada aksi yang tidak bisa dibatalkan.
   */
  function bukaDialog(teks, saatHapus, { judul, labelTombol } = {}) {
    const elJudul = $('#kamDialogJudul');
    const elTombol = $('#kamDialogHapus');
    if (elJudul) elJudul.textContent = judul || 'Hapus cara masuk?';
    if (elTombol) elTombol.textContent = labelTombol || 'Hapus';

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

    // ── FOTO PROFIL ─────────────────────────────────────────────────────────
    //
    // ── KENAPA SATU TOMBOL, DUA PERAN ───────────────────────────────────────
    // Label "Ganti foto" berubah jadi "Simpan foto" setelah berkas dipilih.
    // Klik pertama membuka pemilih berkas; klik berikutnya MENYIMPAN.
    //
    // Alternatifnya adalah dua tombol terpisah ("Pilih" lalu "Simpan"), tapi
    // itu menambah tombol yang harus dijelaskan di keadaan normal — padahal
    // hampir semua kunjungan tidak sedang mengganti foto.
    //
    // Karena <label> meneruskan kliknya ke <input file>, pemilih berkas
    // terbuka SENDIRI saat belum ada perubahan. Handler ini hanya mencegat
    // saat sudah ada berkas yang menunggu disimpan.
    $('#kamInputFoto')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      // Kosongkan nilainya supaya memilih berkas yang SAMA dua kali tetap
      // memicu 'change' — tanpa ini, percobaan kedua tidak terjadi apa-apa.
      e.target.value = '';
      if (file) pilihFoto(file);
    });

    $('#kamLabelFoto')?.addEventListener('click', (e) => {
      // Ada perubahan tertunda → jangan buka pemilih berkas, tapi simpan.
      if (berkasFotoTerpilih) {
        e.preventDefault();
        simpanFoto();
      }
      // Kalau tidak ada, biarkan perilaku bawaan <label> membuka pemilih.
    });

    $('#kamHapusFoto')?.addEventListener('click', hapusFoto);

    // ── CABUT SEMUA PERANGKAT LAIN ─────────────────────────────────────────
    // Satu aksi untuk situasi panik ("ada perangkat yang tidak saya kenali").
    // GitHub, Google, dan Stripe semuanya punya tombol ini; mencabut satu per
    // satu berarti pengguna harus menebak mana yang aman — tepat saat menebak
    // adalah hal terakhir yang ingin dilakukan.
    //
    // Konfirmasi memakai dialog yang sama, dengan judul dan label yang sesuai
    // aksinya (bukan "Hapus cara masuk?").
    $('#kamCabutSemua')?.addEventListener('click', () => {
      const tombol = $('#kamCabutSemua');
      const jumlah = document.querySelectorAll('#kamSesi .kam-item-sesi:not(.is-sekarang)').length;
      if (!jumlah) return;

      bukaDialog(
        `${jumlah} perangkat lain akan dicabut dan harus masuk ulang. `
        + 'Perangkat yang sedang Anda pakai TIDAK ikut dicabut. '
        + 'Tindakan ini tidak bisa dibatalkan.',
        async () => {
          const hapus = $('#kamDialogHapus');
          hapus.disabled = true;
          hapus.textContent = 'Mencabut…';
          if (tombol) tombol.disabled = true;
          try {
            const r = await fetch('/api/auth/sesi/cabut-semua', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'same-origin',
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
              pesanPanel('#kamPesanSesi', d.message || 'Perangkat lain dicabut.', 'sukses');
              // Muat ulang daftarnya dari server, bukan menghapus baris satu per
              // satu di klien: server adalah sumber kebenaran soal sesi mana
              // yang benar-benar masih ada. Menghapus di klien berarti
              // menampilkan tebakan.
              await muatUlangSesi();
            } else {
              pesanPanel('#kamPesanSesi', d.message || 'Gagal mencabut sesi lain.', 'galat');
            }
          } catch {
            pesanPanel('#kamPesanSesi', 'Tidak bisa menghubungi server.', 'galat');
          } finally {
            hapus.disabled = false;
            hapus.textContent = 'Hapus';
            if (tombol) tombol.disabled = false;
            tutupDialog();
          }
        },
        { judul: 'Cabut semua perangkat lain?', labelTombol: 'Cabut semua' },
      );
    });

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
    const inpEmail = $('#kamInputEmail');
    const inpPerusahaan = $('#kamInputPerusahaan');
    if (inpNama) inpNama.value = profilCache.nama;
    if (inpEmail) inpEmail.value = profilCache.email;
    if (inpPerusahaan) inpPerusahaan.value = profilCache.perusahaan;

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
        // `perusahaan` ikut dikirim — backend sudah menerimanya sejak dulu
        // (users.mjs: perbaruiProfil), lengkap dengan validasinya sendiri.
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
      profilCache.perusahaan = hasil.perusahaan ?? perusahaan;

      if (hasil.nama) $('#kamNama').textContent = hasil.nama;

      // Avatar dibangun dari NAMA — jadi ia harus diperbarui juga. Tanpa ini,
      // pengguna yang mengubah nama melihat inisial lama sampai halaman
      // dimuat ulang, dan itu terasa seperti simpanannya gagal.
      isiIdentitas(hasil.nama, profilCache.email);

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

  // ══ NAVIGASI SIDEBAR ══════════════════════════════════════════════════════
  // Pola tab ARIA, bukan <details> atau radio: <details> tidak bisa jadi tab,
  // radio membingungkan pembaca layar. ARIA memberi tahu bahwa tombol ini
  // MENGUBAH APA YANG TERLIHAT, bukan menavigasi.
  // Panel tidak aktif pakai `hidden` saja. Pilihan disimpan di location.hash
  // supaya refresh kembali ke panel yang sama.
  function initSisi() {
    const tab = Array.from(document.querySelectorAll('.kam-sisi-item[data-panel]'));
    if (!tab.length) return;

    const panelDari = (id) => document.getElementById(id);

    function pilih(id, { fokus = false } = {}) {
      for (const t of tab) {
        const aktif = t.dataset.panel === id;
        t.classList.toggle('is-aktif', aktif);
        t.setAttribute('aria-selected', aktif ? 'true' : 'false');
        // roving tabindex: hanya tab aktif yang bisa di-Tab masuk. Ini yang
        // membuat Tab berpindah KELUAR dari tablist, bukan berputar di dalamnya.
        t.tabIndex = aktif ? 0 : -1;
        if (aktif && fokus) t.focus();
      }
      for (const p of document.querySelectorAll('.kam-panel-isi')) {
        const aktif = p.id === id;
        p.hidden = !aktif;
        p.classList.toggle('is-aktif', aktif);
      }
      // ── PEMUATAN MALAS ───────────────────────────────────────────────────────
      // Isi tab dimuat saat tabnya DIBUKA, bukan saat halaman dimuat. Profil
      // dipakai setiap kunjungan; tab lain hanya sesekali. Memuat semuanya
      // bersamaan berarti setiap pengunjung menunggu permintaan yang jarang
      // dibutuhkan.
      if (pemuat[id]) pemuat[id]();
      else if (id === 'panelBayar') muatPembelian();

      if (history.replaceState) history.replaceState(null, '', '#' + id);
    }

    for (const t of tab) {
      t.addEventListener('click', () => pilih(t.dataset.panel));
    }

    // Panah kiri/kanan berpindah tab, Home/End ke ujung. Tanpa ini, tablist
    // hanya bisa dipakai mouse — pola ARIA-nya jadi tidak lengkap.
    document.querySelector('.kam-sisi')?.addEventListener('keydown', (e) => {
      const i = tab.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tab.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tab.length) % tab.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tab.length - 1;
      else return;
      e.preventDefault();
      pilih(tab[next].dataset.panel, { fokus: true });
    });

    // Panel awal: dari hash kalau ada, kalau tidak yang pertama.
    const dariHash = location.hash.slice(1);
    const awal = panelDari(dariHash) ? dariHash : tab[0].dataset.panel;
    pilih(awal);

    // ── PETAK RINGKASAN → PINDAH TAB ────────────────────────────────────────
    // Ringkasan di tab Profil menampilkan status (jumlah cara masuk, 2FA,
    // perangkat) dan setiap petaknya adalah PINTU ke tab tempat mengubahnya.
    // Tanpa ini, angkanya hanya memberi tahu ada masalah tanpa jalan ke sana —
    // dan pengguna harus mencari sendiri tab yang benar.
    //
    // Dipasang di dalam initSisi() karena `pilih()` hidup di sini; memanggilnya
    // dari luar berarti mengekspos state tab ke lingkup global.
    document.querySelectorAll('.kam-petak[data-panel-tujuan]').forEach((p) => {
      p.addEventListener('click', () => {
        const tujuan = p.dataset.panelTujuan;
        if (panelDari(tujuan)) pilih(tujuan, { fokus: true });
      });
    });
  }

  // Aman tanpa sesi: querySelector mengembalikan daftar kosong, fungsi
  // berhenti di baris pertama.
  initSisi();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
