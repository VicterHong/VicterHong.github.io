# Perbaikan portofolio VIVASTIC

## Lingkup

Memperbaiki audit portofolio tanpa mengganti desain hitam–emas, mematikan guard, membuka konten berbayar, atau mengaktifkan pembayaran aplikasi 3D.

## Perubahan

- Kontak bisnis langsung melalui alamat email yang sebelumnya sudah dipublikasikan pada halaman legal.
- Penyusun brief lokal: hanya menyiapkan draft `mailto:`, tidak mengirim email, menyimpan lead, atau mengklaim pesan sudah terkirim. Data tetap di perangkat sampai pengguna memilih mengirim melalui aplikasi email.
- Tiga ringkasan studi kasus publik dari ringkasan yang sudah ada; tidak menyalin payload evidence, metrik, kode, aset 3D, atau detail arsitektur privat.
- Proses kerja sama, FAQ jasa, dan pemisahan paket akses kode dari biaya pembangunan/operasional.
- Kualifikasi klaim biaya dan pemrosesan data pihak ketiga; panduan token mandiri dibanding permintaan khusus.
- Anchor Changelog dan navigasi dua halaman proyek menuju `/home#<id>` yang benar.
- Sitemap hanya URL canonical indexable; gate, autentikasi, proyek privat, pricing dalam penilaian, dan aplikasi 3D tidak ditambahkan.
- Preview Open Graph subhalaman memakai poster publik yang sudah ada.
- Reveal tidak menyembunyikan teks: konten terlihat secara default, gerak ringan ditambahkan tanpa mengurangi opacity atau memotong isi.
- Akses 3D memakai poster publik yang sudah tersedia, satu root React, dan status transaksi “Belum dibuka” alih-alih tombol “Memuat” palsu. Pembayaran tetap disabled.
- Satu zona tindakan sensitif pada tab Keamanan; dialog konfirmasi dan proteksi backend tetap utuh.
- Badge CI memilih workflow `ci.yml`, branch `main`, event `push`, bukan workflow terbaru apa pun.

## Koreksi hasil audit awal

Rasio kontras rendah pada audit awal terlihat dalam browser otomatis yang ternyata memiliki `document.visibilityState === 'hidden'` dan waktu transisi CSS berhenti pada 0. Temuan itu tidak boleh dianggap pengukuran final browser foreground. Pemeriksaan ulang mengaktifkan focus emulation/bring-to-front sebelum membaca gaya dan menjalankan axe. Perubahan reveal tetap memberi jaring pengaman: konten inti tidak bergantung pada keberhasilan observer, rAF, atau timeline animasi agar terbaca.

## Akar kegagalan CI sebelumnya

Log CI pada commit `337d1a9` memuat `ERR_MODULE_NOT_FOUND` untuk `backend/src/akses-halaman.mjs`. Modul itu dan dependency transitifnya `akses-aset.mjs` serta `akses-kunci.mjs` sudah ada secara lokal dan diimpor entrypoint server, tetapi belum di-track git. Akibatnya server uji tidak boot di checkout GitHub; 29 tes dibatalkan oleh hook setup, bukan gagal assertion.

Ketiga modul lama disertakan tanpa mengubah perilaku aksesnya. Tes `repo-runtime-complete.test.mjs` menelusuri dependency lokal entrypoint dan memastikan semuanya tersedia dalam git. Dokumen 3D dan evidence untracked lainnya tidak ikut dimasukkan.

## Verifikasi lokal

- RED→GREEN: kontak/draft, klaim, navigasi, studi kasus, proses, docs, sitemap/preview, root/ID unik, keterbacaan, pemilihan workflow, dan kelengkapan dependency server.
- Suite 93 file `*.test.mjs`: 1.048 tes, 1.033 lulus, 15 skip, 0 gagal, 0 cancelled pada Node v26.12.1; `HOME`, DB, direktori sementara, dan konfigurasi email/pembayaran terisolasi.
- Dua uji tambahan: alur jatah metrik 46 pemeriksaan dan login paket gratis 19 pemeriksaan lulus.
- Build, 26 pemeriksaan preflight, verifikasi dist, cek sintaks backend, dan TypeScript aplikasi akses lulus.
- Browser sumber dan dist: draft benar dan tidak dikirim; tiga studi kasus; anchor proses; menu mobile terbuka/tertutup; root tunggal; zona sensitif tersembunyi bagi anonim; tidak ada resource 404 pada halaman yang diperiksa.
- Sampel axe desktop/mobile beranda: tidak ada pelanggaran otomatis yang terdeteksi; node `incomplete` tetap memerlukan penilaian manual. Ini bukan sertifikasi WCAG atau jaminan seluruh alur aksesibilitas.
- Reduced motion: bagian inti tetap opacity 1, animasi section tidak aktif.

CI GitHub pada Node 22 dan produksi diperiksa sesudah push/deploy. Tidak ada klaim Core Web Vitals lapangan, peningkatan conversion rate, pengujian perangkat fisik, atau transaksi pembayaran nyata dalam pekerjaan ini.
