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
      <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14" aria-hidden="true" focusable="false" class="nav-akun-panah"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>
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

    // Kepala menu: email lengkap + baris badge. Nama di tombol mungkin
    // terpotong; email memberi konfirmasi pasti profil mana yang sedang aktif.
    //
    // ── KENAPA BADGE ADA DI DALAM KEPALA, BUKAN DI BAWAHNYA ────────────────
    // Badge paket dan sisa masa berlaku menerangkan AKUN, bukan navigasi. Di
    // bawah pemisah ia duduk di antara item menu dan ikut terbaca sebagai
    // salah satu tujuan — padahal ia tidak bisa diklik. Di dalam kepala ia
    // menempel pada identitas yang diterangkannya: email, lalu keadaannya.
    const kepala = document.createElement('div');
    kepala.className = 'nav-akun-kepala';

    const kepalaEmail = document.createElement('div');
    kepalaEmail.className = 'nav-akun-email';
    kepalaEmail.textContent = email;
    kepala.appendChild(kepalaEmail);

    // Baris badge: item NON-klik (bukan tautan) — ia menampilkan keadaan,
    // bukan mengajak ke mana pun. Membuatnya bisa diklik berarti pengguna
    // menebak-nebak apa yang terjadi.
    const barisBadge = document.createElement('div');
    barisBadge.className = 'nav-akun-badge-baris';
    barisBadge.id = 'navAkunBadge';
    barisBadge.hidden = true;
    kepala.appendChild(barisBadge);

    menu.appendChild(kepala);

    // ── IKON MENU ──────────────────────────────────────────────────────────
    //
    // ── POLA DARI ProfileDropdown (shadcn/21st.dev) ────────────────────────
    // Setiap item menu punya ikon di kiri. Ikon membuat daftar bisa dipindai
    // dengan bentuk sebelum teksnya dibaca — mata menemukan "yang ada
    // kuncinya" lebih cepat daripada membaca empat label.
    //
    // SVG inline, bukan pustaka ikon: satu ikon tidak sebanding dengan
    // memuat berkas eksternal yang menambah satu permintaan jaringan.
    // Semua memakai viewBox 24 dan stroke 1.7 supaya bobotnya seragam.
    const IKON = {
      orang: '<svg viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>',
      perisai: '<svg viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false"><path d="M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z"/></svg>',
      keluar: '<svg viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false"><path d="M120,216a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H56V208h56A8,8,0,0,1,120,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L204.69,120H112a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,229.66,122.34Z"/></svg>',
    };

    /**
     * Buat satu baris menu.
     *
     * ── KENAPA SATU FUNGSI, BUKAN DUA LOOP TERPISAH ────────────────────────
     * Item menu punya dua bentuk (tautan dan tombol) tapi anatomi isinya
     * sama: ikon, label, dan badge opsional di kanan. Menulis dua kali
     * berarti perubahan pada satu bentuk (mis. jarak ikon) harus diingat di
     * bentuk yang lain — dan itu jenis kelalaian yang tidak terlihat sampai
     * keduanya berdampingan.
     */
    function buatItem({ teks, ikon, badge, badgeKelas = '' }) {
      const el = document.createElement('span');
      el.className = 'nav-akun-isi';

      const kiri = document.createElement('span');
      kiri.className = 'nav-akun-ikon';
      kiri.setAttribute('aria-hidden', 'true');
      kiri.innerHTML = IKON[ikon] || '';

      const label = document.createElement('span');
      label.className = 'nav-akun-label';
      label.textContent = teks;

      el.append(kiri, label);

      if (badge) {
        const b = document.createElement('span');
        b.className = 'nav-akun-badge' + (badgeKelas ? ' ' + badgeKelas : '');
        b.textContent = badge;
        el.appendChild(b);
      }
      return el;
    }

    // ── ITEM MENU ──────────────────────────────────────────────────────────
    // "Profil saya" menuju halaman yang sudah ada (/keamanan), yang
    // menampilkan profil + cara masuk dalam satu tempat.
    //
    // ── KENAPA #panelMasuk, BUKAN #cara-masuk ──────────────────────────────
    // Halaman /keamanan menyimpan tab yang sedang dibuka di location.hash,
    // dan nilainya adalah ID PANEL (mis. `panelMasuk`), bukan ID bagian lama.
    // Tautan lama `/keamanan#cara-masuk` tidak cocok dengan elemen mana pun,
    // jadi halaman jatuh ke tab PERTAMA (Profil) — pengguna mengklik
    // "Cara masuk" tapi mendarat di tab yang salah, tanpa pesan apa pun.
    const item = [
      { teks: 'Profil saya', href: '/keamanan', ikon: 'orang' },
      { teks: 'Cara masuk', href: '/keamanan#panelMasuk', ikon: 'perisai' },
    ];

    // ── BADGE DARI DATA NYATA ──────────────────────────────────────────────
    //
    // ── KENAPA TIDAK MENIRU "PRO" DAN "Gemini 2.0 Flash" ───────────────────
    // Contoh aslinya menampilkan paket langganan dan nama model AI. Keduanya
    // TIDAK ADA di backend ini — menampilkannya berarti mengarang data di
    // menu yang muncul di SETIAP halaman. Kalau angkanya salah, pengguna
    // salah paham tentang masa berlaku aksesnya.
    //
    // Yang ADA dan berguna: paket token dan tanggal kedaluwarsanya. Keduanya
    // diambil dari /api/auth/token-saya — endpoint yang sudah dipakai tab
    // "Token akses". Dimuat SETELAH menu dibuka pertama kali, supaya halaman
    // tidak menunggu permintaan yang sebagian besar kunjungan tidak butuh.
    let badgeSudahDimuat = false;

    async function muatBadge() {
      if (badgeSudahDimuat) return;
      badgeSudahDimuat = true;

      let t = null;
      try {
        const r = await fetch('/api/auth/token-saya', { credentials: 'same-origin' });
        if (r.ok) t = (await r.json())?.token || null;
      } catch { /* gagal → menu tetap tampil tanpa badge */ }

      if (!t) return;

      const tempat = document.querySelector('#navAkunBadge');
      if (!tempat) return;

      // Paket: apa adanya dari backend (mis. "standard", "pro").
      // Ditampilkan hanya kalau terisi — label kosong lebih buruk daripada
      // tidak ada label.
      const paket = String(t.tier || '').trim();

      // Kedaluwarsa: hanya kalau tanggalnya ADA dan masih berlaku.
      // Token yang sudah lewat tidak ditampilkan sebagai badge hijau.
      let sisa = '';
      if (t.kedaluwarsa_pada) {
        const hari = Math.ceil((t.kedaluwarsa_pada - Date.now()) / 86400000);
        if (hari > 0) sisa = hari > 30 ? `${Math.round(hari / 30)} bln` : `${hari} hr`;
      }

      tempat.innerHTML = '';
      if (paket) {
        const b = document.createElement('span');
        b.className = 'nav-akun-badge is-paket';
        b.textContent = paket;
        tempat.appendChild(b);
      }
      if (sisa) {
        const b = document.createElement('span');
        b.className = 'nav-akun-badge is-sisa';
        b.textContent = sisa;
        b.title = 'Sisa masa berlaku token';
        tempat.appendChild(b);
      }

      // Tidak ada data → sembunyikan barisnya. Baris kosong dengan tinggi
      // tetap akan terlihat sebagai celah aneh di antara item menu.
      if (tempat.children.length) tempat.hidden = false;
      else tempat.remove();
    }

    for (const x of item) {
      const a = document.createElement('a');
      a.className = 'nav-akun-tautan';
      a.href = x.href;
      a.setAttribute('role', 'menuitem');
      a.appendChild(buatItem(x));
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
    keluar.setAttribute('role', 'menuitem');
    keluar.appendChild(buatItem({ teks: 'Keluar', ikon: 'keluar' }));
    keluar.addEventListener('click', async () => {
      keluar.disabled = true;
      // ── KENAPA MENYUNTING LABEL, BUKAN SELURUH TOMBOL ────────────────────
      // Sebelumnya baris ini `keluar.textContent = 'Keluar…'` — dan itu
      // MENGHAPUS seluruh isi tombol, termasuk ikonnya. Ikonnya hilang
      // tepat saat tombolnya sedang sibuk, jadi terlihat seperti berkedip.
      //
      // Sekarang hanya teks labelnya yang diganti; ikonnya tetap di tempat.
      const labelKeluar = keluar.querySelector('.nav-akun-label');
      if (labelKeluar) labelKeluar.textContent = 'Keluar…';
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

      // ── BADGE DIMUAT SAAT MENU DIBUKA, BUKAN SAAT HALAMAN DIMUAT ──────────
      // Ini satu permintaan jaringan tambahan, dan sebagian besar kunjungan
      // tidak pernah membuka menu akun. Memuatnya di awal berarti setiap
      // pengunjung membayar untuk sesuatu yang jarang dipakai.
      //
      // Setelah dimuat sekali, hasilnya disimpan — membuka-tutup menu tidak
      // memicu permintaan baru.
      if (akanBuka) muatBadge();
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
