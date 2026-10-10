/**
 * Navigasi sadar-status login.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * MASALAH YANG DIPERBAIKI
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Header situs selalu menampilkan tautan "Sign in" — bahkan setelah pengguna
 * berhasil masuk. Pengguna yang sudah login melihat ajakan masuk di setiap
 * halaman, dan tidak ada cara menemukan profilnya sendiri:
 *
 *   • Header bilang "Sign in" padahal sudah masuk  → membingungkan
 *   • Tidak ada tautan ke /keamanan dari mana pun  → profil tak ditemukan
 *
 * Satu-satunya cara membuka profil adalah mengetik /keamanan di address bar.
 * Itu bukan cara yang bisa diharapkan dari pengguna biasa.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CARA KERJA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 1. Tanya /api/auth/profil (cookie sesi dikirim otomatis, same-origin).
 * 2. Kalau ada sesi  → ganti tautan "Sign in" jadi menu akun (nama + dropdown).
 * 3. Kalau tidak ada → biarkan "Sign in" seperti semula.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TIDAK MENYEMBUNYIKAN "SIGN IN" SAAT MENUNGGU JAWABAN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Permintaan ke /api/auth/profil butuh ~50–200ms. Selama itu, header sudah
 * tampil. Dua pilihan:
 *
 *   a) Sembunyikan tautan sampai jawaban datang → header "melompat"
 *   b) Tampilkan "Sign in" dulu, ganti kalau ternyata sudah masuk
 *
 * Dipilih (b): header yang melompat terasa rusak. Perubahan dari "Sign in"
 * jadi nama pengguna jauh lebih halus daripada ruang kosong yang tiba-tiba
 * terisi. Dan kalau permintaan gagal, "Sign in" tetap benar untuk pengunjung
 * anonim — kasus yang paling umum di halaman publik.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA DROPDOWN, BUKAN LANGSUNG KE /keamanan
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Klik nama → langsung pindah halaman berarti pengguna tidak bisa melihat
 * pilihan lain (keluar, misalnya). Dropdown memberi daftar tindakan yang
 * tersedia — pola yang dipakai GitHub, Google, dan hampir semua dashboard.
 */

(function () {
  'use strict';

  /** Cari tautan "Sign in" di navigasi. Kalau tidak ada, halaman ini tidak
   *  punya navigasi situs (mis. halaman masuk) — tidak ada yang perlu diubah. */
  const tautanMasuk = document.querySelector('.nav-signin');
  if (!tautanMasuk) return;

  /**
   * Bangun menu akun menggantikan tautan "Sign in".
   *
   * Strukturnya:
   *   <div class="nav-akun">
   *     <button class="nav-akun-tombol">[inisial] Nama ▾</button>
   *     <div class="nav-akun-menu" hidden>
   *       <div class="nav-akun-kepala">email</div>
   *       <a href="/keamanan">Profil saya</a>
   *       <a href="/keamanan#panelMasuk">Cara masuk</a>
   *       <button>Keluar</button>
   *     </div>
   *   </div>
   */
  function bangunMenuAkun(profil) {
    const nama = String(profil.nama || '').trim();
    const email = String(profil.email || '').trim();

    // Label yang ditampilkan: nama kalau ada, kalau tidak bagian depan email.
    // Pengguna yang mendaftar lewat Google biasanya punya nama; yang lewat
    // email saja mungkin belum mengisinya.
    const label = nama || email.split('@')[0] || 'Profil';

    // Inisial untuk avatar: satu atau dua huruf dari nama/email.
    const inisial = (nama || email)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((k) => k[0].toUpperCase())
      .join('');

    // ── AVATAR: FOTO KALAU ADA, INISIAL KALAU TIDAK ────────────────────────
    //
    // ── MASALAH YANG DIPERBAIKI ────────────────────────────────────────────
    // Header hanya pernah menampilkan INISIAL, bahkan setelah pengguna
    // mengunggah foto di halaman profil. Fotonya tersimpan, halaman profil
    // menampilkannya, tapi di setiap halaman lain header tetap menunjukkan
    // dua huruf — dan pengguna wajar menyimpulkan unggahannya gagal.
    //
    // Penyebabnya: fungsi ini membangun tombolnya dari `nama` dan `email`
    // saja, sementara `avatar_url` yang dikirim server tidak pernah dibaca.
    //
    // ── KENAPA INISIAL TETAP DITULIS DI HTML ──────────────────────────────
    // Foto perlu waktu untuk diunduh. Kalau elemennya kosong selama itu,
    // header terlihat bolong. Inisial ditulis lebih dulu sebagai lapisan
    // dasar, lalu foto ditumpuk di atasnya setelah berhasil dimuat.
    //
    // Kalau fotonya gagal (jaringan, berkas sudah dihapus), inisialnya
    // sudah ada di sana — tidak perlu ada penanganan khusus, dan header
    // tidak pernah terlihat rusak.
    const urlFoto = String(profil.avatar_url || '').trim();

    const bungkus = document.createElement('div');
    // ── NAMA KELAS: nav-akun-dropdown, BUKAN nav-akun ────────────────────────
    // 'nav-akun' sekarang dipakai GRUP HEADER (wadah di kanan navigasi).
    // Memakai nama yang sama untuk dua elemen berbeda berarti aturan CSS
    // grup (margin-left: auto) ikut berlaku pada dropdown — dan dropdown
    // akan terdorong ke kanan menjauhi tombolnya.
    bungkus.className = 'nav-akun-dropdown';

    const tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'nav-akun-tombol';
    tombol.setAttribute('aria-expanded', 'false');
    tombol.setAttribute('aria-haspopup', 'true');
    tombol.setAttribute('aria-label', `Menu profil ${label}`);

    // Avatar + nama + panah. SVG panah ditulis inline supaya tidak perlu
    // memuat ikon tambahan hanya untuk satu tanda.
    //
    // ── KENAPA FOTO DITUMPUK, BUKAN MENGGANTIKAN INISIAL ────────────────────
    // Inisial ada di HTML sejak awal, jadi header TIDAK PERNAH kosong —
    // bahkan selama foto masih diunduh. Kalau fotonya gagal dimuat, elemen
    // <img> yang dilepas sendiri, dan inisialnya sudah ada di bawahnya.
    //
    // `alt=""` karena avatar ini dekoratif: nama pengguna ada tepat di
    // sebelahnya, jadi membacakannya dua kali hanya menambah kebisingan.
    tombol.innerHTML = `
      <span class="nav-akun-avatar" aria-hidden="true">${inisial || '·'}</span>
      <span class="nav-akun-nama">${label}</span>
      <svg class="nav-akun-panah" viewBox="0 0 24 24" width="14" height="14"
           fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    `;

    // Foto dipasang SETELAH tombol ada di DOM, supaya kegagalan memuatnya
    // bisa ditangani dengan melepas elemennya saja.
    if (urlFoto) {
      const kotakAvatar = tombol.querySelector('.nav-akun-avatar');
      const img = document.createElement('img');
      img.className = 'nav-akun-avatar-gambar';
      img.alt = '';
      img.decoding = 'async';
      img.src = urlFoto;
      img.addEventListener('error', () => { img.remove(); });
      kotakAvatar?.appendChild(img);
    }

    const menu = document.createElement('div');
    menu.className = 'nav-akun-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    // Kepala menu: email lengkap. Nama di tombol mungkin terpotong; email
    // memberi konfirmasi pasti profil mana yang sedang aktif.
    const kepala = document.createElement('div');
    kepala.className = 'nav-akun-kepala';
    kepala.textContent = email;
    menu.appendChild(kepala);

    // Tautan menu. "Profil saya" menuju halaman yang sudah ada (/keamanan),
    // yang menampilkan profil + cara masuk dalam satu tempat.
    //
    // ── KENAPA #panelMasuk, BUKAN #cara-masuk ──────────────────────────────
    // Halaman /keamanan menyimpan tab yang sedang dibuka di location.hash,
    // dan nilainya adalah ID PANEL (mis. `panelMasuk`), bukan ID bagian lama.
    // Tautan lama `/keamanan#cara-masuk` tidak cocok dengan elemen mana pun,
    // jadi halaman jatuh ke tab PERTAMA (Profil) — pengguna mengklik
    // "Cara masuk" tapi mendarat di tab yang salah, tanpa pesan apa pun.
    for (const [teks, href] of [
      ['Profil saya', '/keamanan'],
      ['Cara masuk', '/keamanan#panelMasuk'],
    ]) {
      const a = document.createElement('a');
      a.className = 'nav-akun-tautan';
      a.href = href;
      a.textContent = teks;
      a.setAttribute('role', 'menuitem');
      menu.appendChild(a);
    }

    // Pemisah sebelum "Keluar" — memisahkan tindakan navigasi dari tindakan
    // yang mengakhiri sesi.
    const garis = document.createElement('div');
    garis.className = 'nav-akun-garis';
    garis.setAttribute('aria-hidden', 'true');
    menu.appendChild(garis);

    const keluar = document.createElement('button');
    keluar.type = 'button';
    keluar.className = 'nav-akun-keluar';
    keluar.textContent = 'Keluar';
    keluar.setAttribute('role', 'menuitem');
    keluar.addEventListener('click', async () => {
      keluar.disabled = true;
      keluar.textContent = 'Keluar…';
      try {
        // Endpoint keluar menghapus sesi di server + cookie-nya. Tanpa
        // panggilan ini, cookie tetap ada dan pengguna "masih masuk" setelah
        // halaman dimuat ulang.
        //
        // Memakai /api/token/logout — endpoint yang SUDAH ADA dan dipakai
        // halaman profil. Sempat dibuat endpoint baru (/api/auth/keluar)
        // sebelum menyadari yang ini ada; duplikatnya sudah dihapus.
        await fetch('/api/token/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch {
        // Gagal menghubungi server — tetap lanjutkan. Cookie mungkin masih
        // ada, tapi setidaknya halaman dimuat ulang dan statusnya diperiksa
        // ulang. Lebih baik daripada tombol yang tidak melakukan apa-apa.
      }
      window.location.href = '/';
    });
    menu.appendChild(keluar);

    bungkus.appendChild(tombol);
    bungkus.appendChild(menu);

    // ── Buka/tutup menu ────────────────────────────────────────────────────
    function tutupMenu() {
      menu.hidden = true;
      tombol.setAttribute('aria-expanded', 'false');
    }

    tombol.addEventListener('click', (e) => {
      e.stopPropagation();
      const akanBuka = menu.hidden;
      menu.hidden = !akanBuka;
      tombol.setAttribute('aria-expanded', akanBuka ? 'true' : 'false');
    });

    // Klik di luar menutup menu. `stopPropagation` di tombol mencegah
    // handler ini ikut terpicu saat tombolnya sendiri diklik.
    document.addEventListener('click', tutupMenu);

    // Escape menutup menu — kebiasaan yang diharapkan pengguna keyboard.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        tutupMenu();
        tombol.focus();
      }
    });

    // Ganti tautan "Sign in" dengan menu akun.
    tautanMasuk.replaceWith(bungkus);
  }

  /** Ganti tautan jadi teks biasa kalau permintaan gagal — jangan biarkan
   *  tautan yang mungkin salah tetap terlihat seperti bisa diklik. */
  function biarkanSebagaiTautan() {
    // Tidak ada yang perlu dilakukan: "Sign in" sudah benar untuk pengunjung
    // anonim, dan itu kasus paling umum di halaman publik.
  }

  // ── Jalankan ───────────────────────────────────────────────────────────────
  //
  // `credentials: 'same-origin'` wajib: cookie sesi hanya dikirim kalau
  // permintaan dianggap same-origin. Tanpa itu, server selalu menjawab 401
  // dan header tidak pernah menampilkan menu akun.
  fetch('/api/auth/profil', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && d.ok && (d.email || d.nama)) {
        bangunMenuAkun(d);
      } else {
        biarkanSebagaiTautan();
      }
    })
    .catch(() => {
      // Server tidak terjangkau → biarkan "Sign in". Jangan tampilkan menu
      // profil berdasarkan tebakan; lebih baik pengguna melihat tautan masuk
      // yang mungkin tidak perlu, daripada menu akun yang salah.
      biarkanSebagaiTautan();
    });
})();
