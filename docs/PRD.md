# PRD — Portofolio Pribadi Victer

**Status:** v1.0 — situs sudah live, video hero belum
**Pemilik:** Victer (VicterHong)
**Live:** https://victerhong.github.io
**Repo:** https://github.com/VicterHong/VicterHong.github.io
**Terakhir diperbarui:** 1 Oktober 2026

---

## 1. Ringkasan

Portofolio pribadi satu halaman yang menampilkan proyek otomasi dan alat self-hosted.
Situs statis tanpa build step, disajikan GitHub Pages.

**Masalah yang diselesaikan:** portofolio developer biasanya berupa template seragam —
grid kartu identik, "passionate developer", gradien ungu-biru, tanpa bukti. Hasilnya tidak
membedakan pemiliknya dari ribuan portofolio lain, dan pembaca tidak punya alasan
mempercayainya.

**Pendekatan:** satu proyek unggulan mendapat ruang terbesar, setiap angka bisa
diverifikasi dengan membuka repositori, dan seluruh isi berasal dari satu berkas data
sehingga bisa disunting tanpa menyentuh HTML.

---

## 2. Tujuan

| # | Tujuan | Ukuran keberhasilan |
|---|--------|---------------------|
| G1 | Menampilkan karya nyata, bukan template | Setiap klaim angka punya tautan repo yang membuktikannya |
| G2 | Membedakan diri dari portofolio "AI slop" | Tanpa gradien ungu-biru, tanpa grid kartu seragam, tanpa kata "passionate" |
| G3 | Bisa diperbarui tanpa risiko | Menambah proyek = sunting 1 berkas, tanpa build step |
| G4 | Terasa hidup, tidak mengganggu | Ada gerakan halus; mati total saat `prefers-reduced-motion` |
| G5 | Cepat di jaringan lambat | Halaman < 100 KB sebelum video; tidak ada framework |

## 3. Bukan Tujuan (Non-Goals)

- **Bukan blog.** Tulisan panjang punya tempatnya sendiri.
- **Bukan CMS.** Tidak ada panel admin; isi disunting langsung di berkas data.
- **Bukan resume PDF.** Riwayat kerja formal tidak ditampilkan di sini.
- **Bukan showcase desain.** Situs ini tentang rekayasa, bukan pameran visual.
- **Tanpa pelacakan.** Tidak ada analytics, tidak ada cookie, tidak ada pihak ketiga selain font.

---

## 4. Pengguna

| Persona | Yang dicari | Yang harus dia dapat |
|---------|-------------|----------------------|
| **Perekrut teknis** | Bukti kemampuan nyata | Angka + tautan repo yang bisa dibuka 10 detik |
| **Sesama developer** | Cara kerja & keputusan desain | Bagian "Cara saya bekerja" + detail arsitektur per proyek |
| **Calon kolaborator** | Cara menghubungi | Tautan kontak yang jelas di bagian bawah |
| **Pengunjung dari HP** | Cepat, tidak berat | Halaman ringan, tata letak satu kolom, tidak ada horizontal scroll |

---

## 5. Persyaratan Fungsional

### 5.1 Sudah Terpenuhi (v1.0)

| ID | Persyaratan | Status |
|----|-------------|--------|
| F1 | Halaman tunggal dengan bagian: pembuka, proyek, cara kerja, kontak | ✅ |
| F2 | Satu proyek unggulan (MINA) dengan ruang lebih besar + penanda visual | ✅ |
| F3 | Setiap proyek menampilkan: masalah, sorotan, metrik, teknologi, tautan repo | ✅ |
| F4 | Angka ringkas (jumlah proyek, tes, teknologi) **dihitung** dari data, bukan diketik manual | ✅ |
| F5 | Proyek pendukung dalam daftar ringkas terpisah | ✅ |
| F6 | Seluruh isi berasal dari `src/data/projects.js` | ✅ |
| F7 | Muncul perlahan saat digulir (`IntersectionObserver`) | ✅ |
| F8 | `prefers-reduced-motion` mematikan animasi & video, konten tetap penuh | ✅ |
| F9 | Video latar opsional — gagal-diam, jatuh ke gradien | ✅ |
| F10 | Responsif 320px ke atas, tanpa horizontal scroll | ✅ |
| F11 | Kepala lengket dengan garis saat digulir | ✅ |
| F12 | `aria-labelledby` di setiap bagian; video `aria-hidden` | ✅ |

### 5.2 Belum Terpenuhi (v1.1+)

| ID | Persyaratan | Prioritas | Catatan |
|----|-------------|-----------|---------|
| F13 | Video latar hero (3–5 detik, loop, halus) | **Tinggi** | Menunggu login Higgsfield MCP |
| F14 | Halaman detail per proyek | Sedang | Sekarang semua di satu halaman |
| F15 | Versi bahasa Inggris | Sedang | Sekarang hanya Bahasa Indonesia |
| F16 | Diagram arsitektur per proyek | Rendah | Bisa berupa SVG statis |
| F17 | Bagian "sekarang mengerjakan" (now page) | Rendah | Butuh pembaruan rutin |
| F18 | Domain kustom | Rendah | Menunggu keputusan |

---

## 6. Persyaratan Non-Fungsional

| Aspek | Persyaratan | Alasan |
|-------|-------------|--------|
| **Ukuran** | < 100 KB sebelum video | Jaringan seluler Indonesia; pengunjung dari HP |
| **Tanpa build** | Berkas disajikan apa adanya | Tidak ada dependensi yang bisa kedaluwarsa atau rusak |
| **Tanpa framework** | DOM murni | React/Vue menambah ratusan KB untuk pekerjaan puluhan baris |
| **Aksesibilitas** | Kontras teks ≥ 4.5:1, navigasi keyboard, `aria` benar | Situs harus bisa dibaca semua orang |
| **Ketahanan** | Video gagal → gradien; font gagal → fallback sistem | Tidak ada kotak rusak, apa pun yang terjadi |
| **Privasi** | Tanpa analytics, tanpa cookie, tanpa pelacakan | Situs pribadi tidak perlu mengawasi pengunjung |
| **Perawatan** | Tambah proyek = sunting 1 berkas | Portofolio yang sulit diperbarui akan ditinggalkan |

---

## 7. Arsitektur Teknis

### 7.1 Struktur

```
index.html              halaman tunggal (struktur saja, tanpa isi)
styles.css              seluruh tampilan
src/app.js              logika render (DOM murni, ES module)
src/data/projects.js    SATU sumber kebenaran untuk semua isi
assets/hero.mp4         video latar (opsional)
.nojekyll               cegah Jekyll mengabaikan berkas berawalan garis bawah
```

### 7.2 Keputusan Desain

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Framework | **Tidak ada** | Situs ini teks + satu video; framework tidak memberi nilai |
| Build step | **Tidak ada** | GitHub Pages menyajikan berkas statis; build = titik gagal tambahan |
| Sumber data | **Satu berkas JS** | Isi terpisah dari tampilan; bisa disunting tanpa sentuh HTML |
| Angka ringkas | **Dihitung** (`stats()`) | Tidak bisa basi saat proyek baru ditambahkan |
| Video | **Gagal-diam** | HEAD request dulu; tidak ada video = gradien, bukan kotak hitam |
| Palet | **Gelap + 1 aksen oranye** | Menghindari gradien ungu-biru khas template AI |
| Proyek unggulan | **Ruang lebih besar + garis aksen** | Tidak semua proyek sama penting; grid seragam menyembunyikan itu |

### 7.3 Alur Data

```
projects.js  →  app.js (render)  →  DOM
     ↑
  stats() dihitung dari data yang sama
```

Tidak ada lapisan antara. Menambah proyek = tambah objek di larik `projects`.

---

## 8. Isi & Nada

**Prinsip isi:**
- Setiap angka harus bisa diverifikasi dengan membuka repo. "231 tes" harus benar-benar 231.
- Tulis apa yang **dikerjakan**, bukan kata sifat tentang diri sendiri.
- Bahasa Indonesia, kalimat pendek, tanpa jargon pemasaran.
- Sebutkan keterbatasan bila relevan — kejujuran lebih meyakinkan daripada pujian diri.

**Yang dilarang:**
- "Passionate developer", "berpengalaman", "profesional" tanpa bukti
- Angka yang dibulatkan ke atas atau tidak bisa diperiksa
- Emoji berlebihan, tanda seru, huruf kapital semua

**Proyek saat ini:**

| Proyek | Peran | Metrik |
|--------|-------|--------|
| MINA | Unggulan | 231 tes, ~25 MB RAM, MIT |
| Spareparts Inventory | Utama | — |
| WhatsApp Family Assistant | Utama | 1045 tes, 14 kelas anti-ban |
| Monitoring, EFMS, Daftar Hadir, jsloop, strktrdata | Pendukung | — |

---

## 9. Rencana Rilis

| Versi | Isi | Prasyarat |
|-------|-----|-----------|
| **v1.0** ✅ | Situs live, konten dari repo nyata | Selesai |
| **v1.1** | Video hero Higgsfield | Login OAuth Higgsfield MCP |
| **v1.2** | Versi bahasa Inggris | Keputusan: satu halaman dua bahasa atau dua berkas? |
| **v1.3** | Halaman detail per proyek | Keputusan: rute terpisah atau bagian yang diperluas? |
| **v2.0** | Domain kustom | Keputusan: beli domain atau tetap `victerhong.github.io`? |

---

## 10. Pertanyaan Terbuka

| # | Pertanyaan | Dampak | Perlu diputuskan oleh |
|---|-----------|--------|----------------------|
| Q1 | Bahasa Inggris: satu halaman dengan tombol ganti bahasa, atau dua berkas terpisah? | Struktur berkas | Victer |
| Q2 | Halaman detail proyek: rute terpisah (`/mina`) atau bagian yang diperluas di halaman yang sama? | Arsitektur | Victer |
| Q3 | Domain kustom — beli (mis. `victer.dev`) atau tetap GitHub Pages? | Biaya, kesan profesional | Victer |
| Q4 | Video hero: model Higgsfield mana? Seedance 2.0 (produk) atau Kling 3.0 (sinematik)? | Hasil visual, kredit | Victer |
| Q5 | Apakah proyek privat/klien boleh ditampilkan tanpa tautan repo? | Isi | Victer |

---

## 11. Risiko

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Video hero terlalu besar | Halaman lambat di jaringan seluler | Batasi < 2 MB, format WebM + MP4, `preload="none"` |
| Video terlalu mencolok | Teks sulit dibaca | Lapisan gelap + batas opasitas 0.42 (sudah diterapkan) |
| Kredit Higgsfield habis | Video tidak bisa dibuat ulang | Simpan berkas final di repo, jangan andalkan tautan eksternal |
| Isi basi | Portofolio kehilangan kredibilitas | `stats()` dihitung; tinjau metrik tiap 3 bulan |
| Ketergantungan font pihak ketiga | Font gagal dimuat = tampilan rusak | Fallback `system-ui` sudah ada di CSS |

---

## 12. Definisi Selesai (v1.1)

- [ ] Video hero ada di `assets/hero.mp4`, < 2 MB, 3–5 detik, loop mulus
- [ ] Video tampil di desktop, **tidak** di perangkat `prefers-reduced-motion`
- [ ] Teks tetap terbaca di atas video (kontras ≥ 4.5:1)
- [ ] Halaman tetap < 2.5 MB total setelah video
- [ ] Tidak ada error konsol di Chrome, Firefox, Safari
- [ ] Diuji di lebar 320px, 768px, 1280px
- [ ] Live di https://victerhong.github.io dan terverifikasi
