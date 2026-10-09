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

    // ── TIDAK ADA LOGO/NAMA DI FOOTER ────────────────────────────────────────
    //
    // ── MASALAH YANG DIPERBAIKI ──────────────────────────────────────────────
    // Footer ini awalnya menampilkan logo + "VIVASTIC" — sama persis dengan
    // header di atasnya. Diukur: nama merek muncul 3× di satu halaman
    // (title, header, footer), dan ikon sosial muncul 2× (tombol di bagian
    // Kontak, ikon di footer).
    //
    // Pengulangan tanpa alasan membuat halaman terasa tidak disunting —
    // seperti template yang setiap bagiannya diisi tanpa dilihat keseluruhan.
    //
    // ── YANG DILAKUKAN KORPORASI ─────────────────────────────────────────────
    // Riset 258 footer SaaS: Linear, Vercel, dan Stripe TIDAK mengulang logo
    // di footer. Brand block cukup SATU KALI di header. Footer fokus pada
    // navigasi + legal — dua hal yang justru dicari orang di sana.
    //
    // Linear merumuskannya: "Setiap elemen harus berhak ada di sana."
    // Logo di footer tidak berhak — pengunjung sudah tahu situs apa ini.
    //
    // ── KONSEKUENSINYA: KOLOM KIRI DIPAKAI UNTUK HAL BERGUNA ────────────────
    // Ruang yang dulu dipakai logo sekarang menampung deskripsi singkat
    // tentang apa yang VIVASTIC kerjakan — informasi yang BELUM ada di
    // halaman lain, bukan pengulangan.

    const desc = document.createElement('p');
    desc.className = 'footer-deskripsi';
    desc.textContent = DATA.deskripsi;
    kiri.appendChild(desc);

    // ── TIDAK ADA TAUTAN SOSIAL DI FOOTER ───────────────────────────────────
    //
    // ── MASALAH YANG DIPERBAIKI ──────────────────────────────────────────────
    // Footer ini awalnya menampilkan ikon bulat GitHub/Ko-fi/Saweria, lalu
    // diganti tautan teks — tapi keduanya tetap SALAH, karena tiga tautan
    // yang sama sudah ada sebagai tombol di bagian "Mari bicara" tepat di
    // atasnya. Diukur: pengunjung melihat tautan yang sama DUA KALI dalam
    // satu layar.
    //
    // ── KENAPA BAGIAN KONTAK YANG DIPERTAHANKAN ─────────────────────────────
    // Bagian "Mari bicara" adalah tempat yang TEPAT untuk kontak: ia punya
    // judul, deskripsi, dan konteks ("terbuka untuk kerja sama..."). Footer
    // adalah tempat CADANGAN untuk yang tidak menemukan apa yang dicari.
    //
    // Menaruh tautan kontak di dua tempat berarti tidak ada satu pun yang
    // terasa definitif — pengunjung tidak tahu mana yang "resmi".
    //
    // ── YANG TETAP ADA DI FOOTER ────────────────────────────────────────────
    // Navigasi (3 kolom link) + legal (Privasi/Syarat) + copyright.
    // Itu yang dicari orang di footer: halaman yang tidak ketemu di header,
    // dan dokumen legal yang wajib ada.

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
