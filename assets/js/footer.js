/**
 * Footer 4 kolom — versi VIVASTIC.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ASAL USUL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Struktur ini diadaptasi dari komponen React/shadcn `footer-column.tsx`
 * (Footer4Col dari mvpblocks). Yang diambil adalah IDENYA:
 *
 *   • Empat kolom: Tentang, Layanan, Bantuan, Kontak
 *   • Ikon sosial sebagai baris tersendiri
 *   • Baris bawah: copyright + legal
 *   • Kolom kiri lebih lebar (nama + deskripsi), tiga kolom kanan sejajar
 *
 * Yang TIDAK diambil:
 *   • Kode React/Tailwind — proyek ini HTML statis + CSS vanilla
 *   • Datanya — data contoh memakai nama perusahaan, email, nomor telepon,
 *     dan alamat orang lain (Mvpblocks, India). Memasangnya berarti memasang
 *     iklan untuk perusahaan lain di footer VIVASTIC.
 *   • Halaman yang tidak ada — /careers, /faqs, /support, /live-chat,
 *     /web-development tidak ada di situs ini. Menautkannya akan menghasilkan
 *     404, dan tautan mati di footer merusak kepercayaan lebih dari sekadar
 *     tidak adanya tautan.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA JAVASCRIPT, BUKAN HTML LANGSUNG DI SETIAP HALAMAN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Footer muncul di 6 halaman. Menulisnya langsung di setiap berkas berarti
 * enam salinan yang harus dijaga sinkron — dan itu sumber bug yang pasti:
 * mengubah satu tautan berarti mengingat lima tempat lain.
 *
 * Satu berkas JS + satu tag <script> per halaman = satu sumber kebenaran.
 * Kalau ada yang perlu diubah, diubah sekali.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KENAPA TIDAK ADA NOMOR TELEPON DAN ALAMAT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Komponen aslinya menampilkan telepon dan alamat kantor. VIVASTIC tidak
 * punya keduanya di data — dan MENGARANG nomor atau alamat lebih buruk
 * daripada tidak menampilkannya. Pengunjung yang menelepon nomor palsu akan
 * kehilangan kepercayaan seketika.
 *
 * Yang ditampilkan hanya kontak yang BENAR-BENAR ada: GitHub, Ko-fi, Saweria.
 */

(function () {
  'use strict';

  // ── Data ───────────────────────────────────────────────────────────────────
  //
  // Semua tautan di sini SUDAH DIPERIKSA ada. Yang tidak ada tidak ditulis —
  // lebih baik kolom terlihat lebih pendek daripada berisi tautan mati.

  const DATA = {
    nama: 'VIVASTIC',
    deskripsi:
      'Alat otomasi dan sistem self-hosted untuk perangkat yang sudah ada. ' +
      'Dibangun hemat sumber daya, tanpa langganan wajib.',

    // Ikon sosial. Memakai SVG inline, bukan pustaka ikon: footer butuh
    // 4 ikon, dan memuat pustaka penuh untuk itu tidak sepadan.
    sosial: [
      {
        label: 'GitHub',
        href: 'https://github.com/VicterHong',
        svg: '<path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" fill="currentColor"/>',
      },
      {
        label: 'Ko-fi',
        href: 'https://ko-fi.com/victer',
        svg: '<path d="M4 5h13a3 3 0 0 1 0 6h-1v1a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V5zm12 2v2h1a1 1 0 0 0 0-2h-1zM3 19h16v2H3v-2z" fill="currentColor"/>',
      },
      {
        label: 'Saweria',
        href: 'https://saweria.co/victer',
        svg: '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3zM5 9.6l6 3.3v6.8l-6-3.3V9.6zm8 10.1v-6.8l6-3.3v6.8l-6 3.3z" fill="currentColor"/>',
      },
    ],

    // Kolom tautan. Setiap href sudah dipastikan ada.
    kolom: [
      {
        judul: 'Layanan',
        tautan: [
          { teks: 'Otomasi alur kerja', href: '/home#cckxsk' },
          { teks: 'Bot & integrasi', href: '/home#cckxsk' },
          { teks: 'Sistem self-hosted', href: '/home#cckxsk' },
          { teks: 'Audit & perbaikan', href: '/home#cckxsk' },
        ],
      },
      {
        judul: 'Situs',
        tautan: [
          { teks: 'Tentang', href: '/home#s6ahns' },
          { teks: 'Proyek', href: '/home#utqvwf' },
          { teks: 'Cara kerja', href: '/home#5nfyzw' },
          { teks: 'Harga', href: '/pricing' },
        ],
      },
      {
        judul: 'Bantuan',
        tautan: [
          { teks: 'Panduan', href: '/docs' },
          { teks: 'Kontak', href: '/home#89fk39' },
          { teks: 'Masuk', href: '/sign-in' },
          { teks: 'Daftar', href: '/sign-up' },
        ],
      },
    ],

    legal: [
      { teks: 'Privasi', href: '/privasi' },
      { teks: 'Syarat', href: '/syarat' },
    ],
  };

  // ── Bangun footer ──────────────────────────────────────────────────────────

  function buat() {
    const footer = document.createElement('footer');
    footer.className = 'site-footer site-footer-4kolom';

    // Kolom kiri: nama + deskripsi + sosial.
    // Lebih lebar dari tiga kolom lainnya — memberi tempat untuk deskripsi
    // tanpa membuatnya sempit dan berbaris-baris pendek.
    const kiri = document.createElement('div');
    kiri.className = 'footer-kiri';

    const merek = document.createElement('a');
    merek.className = 'footer-merek';
    merek.href = '/home';
    merek.innerHTML = `
      <span class="footer-merek-mark" aria-hidden="true"></span>
      <span class="footer-merek-teks">${DATA.nama}</span>
    `;
    kiri.appendChild(merek);

    const desc = document.createElement('p');
    desc.className = 'footer-deskripsi';
    desc.textContent = DATA.deskripsi;
    kiri.appendChild(desc);

    // Ikon sosial. `rel="noopener"` wajib untuk tautan target="_blank":
    // tanpa itu, halaman tujuan bisa mengakses window.opener dan mengubah
    // halaman kita (tabnabbing).
    const sosial = document.createElement('ul');
    sosial.className = 'footer-sosial';
    for (const s of DATA.sosial) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = s.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', s.label);
      a.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${s.svg}</svg>`;
      li.appendChild(a);
      sosial.appendChild(li);
    }
    kiri.appendChild(sosial);

    footer.appendChild(kiri);

    // Tiga kolom tautan
    const kanan = document.createElement('div');
    kanan.className = 'footer-kolom-grup';

    for (const kolom of DATA.kolom) {
      const div = document.createElement('div');
      div.className = 'footer-kolom';

      const h = document.createElement('p');
      h.className = 'footer-kolom-judul';
      h.textContent = kolom.judul;
      div.appendChild(h);

      const ul = document.createElement('ul');
      for (const t of kolom.tautan) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = t.href;
        a.textContent = t.teks;
        li.appendChild(a);
        ul.appendChild(li);
      }
      div.appendChild(ul);
      kanan.appendChild(div);
    }
    footer.appendChild(kanan);

    // Baris bawah: copyright + legal
    const bawah = document.createElement('div');
    bawah.className = 'footer-bawah';

    const hak = document.createElement('p');
    hak.className = 'footer-hak';
    // ── ID "year" DIPERTAHANKAN — BUKAN DIPERINDAH KE "footerTahun" ──────────
    //
    // BUG YANG PERNAH TERJADI DI SINI: footer ini awalnya memakai id
    // `footerTahun`. Tapi `assets/js/app.js` (baris ~556) mencari `#year` —
    // elemen yang ada di footer LAMA. Karena footer.js MENGGANTI footer lama,
    // `#year` ikut hilang, dan app.js melempar:
    //
    //   TypeError: Cannot set properties of null (setting 'textContent')
    //
    // Galat itu terjadi di SETIAP halaman yang memuat app.js — dan efeknya
    // bukan sekadar pesan di konsol: baris setelahnya (`loadHeroVideo`,
    // `observeReveals`, `watchHeader`) TIDAK PERNAH JALAN. Animasi muncul dan
    // header yang mengecil saat digulir ikut mati.
    //
    // Pelajaran: mengganti elemen yang sudah ada berarti mewarisi SEMUA id
    // yang dicari kode lain di dalamnya. Id bukan sekadar penanda internal —
    // itu kontrak antar-berkas.
    hak.innerHTML = `&copy; <span id="year"></span> ${DATA.nama}. Seluruh hak cipta dilindungi.`;
    bawah.appendChild(hak);

    const legal = document.createElement('p');
    legal.className = 'footer-legal';
    DATA.legal.forEach((l, i) => {
      if (i > 0) {
        const pisah = document.createElement('span');
        pisah.className = 'footer-pisah';
        pisah.setAttribute('aria-hidden', 'true');
        pisah.textContent = '·';
        legal.appendChild(pisah);
      }
      const a = document.createElement('a');
      a.href = l.href;
      a.textContent = l.teks;
      legal.appendChild(a);
    });
    bawah.appendChild(legal);

    footer.appendChild(bawah);

    // Tahun diisi dari jam perangkat, bukan ditulis tetap. Footer dengan
    // tahun lama (apalagi tahun depan) langsung terlihat tidak dirawat.
    //
    // ── KENAPA FOOTER.JS MENGISI SENDIRI ────────────────────────────────────
    // `app.js` juga mengisi `#year` — tapi hanya di halaman yang memuatnya.
    // `docs.html` TIDAK memuat app.js, jadi kalau footer.js tidak mengisi
    // sendiri, tahun di sana akan kosong selamanya.
    //
    // Mengisi dua kali tidak berbahaya: keduanya menulis nilai yang sama dari
    // jam perangkat yang sama.
    const tahun = footer.querySelector('#year');
    if (tahun) tahun.textContent = String(new Date().getFullYear());

    return footer;
  }

  // ── Pasang ─────────────────────────────────────────────────────────────────
  //
  // Mengganti footer lama kalau ada. Halaman yang belum punya footer tetap
  // mendapatkannya — footer tidak perlu ditulis manual di setiap halaman.
  const lama = document.querySelector('footer.site-footer');
  const baru = buat();

  if (lama) {
    lama.replaceWith(baru);
  } else {
    // Tidak ada footer lama → tambahkan sebelum skrip terakhir, atau di
    // akhir body kalau tidak ada.
    document.body.appendChild(baru);
  }
})();
