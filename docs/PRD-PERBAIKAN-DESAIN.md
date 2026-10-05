# PRD Perbaikan Desain Portofolio

**Status:** Siap dieksekusi
**Sumber analisis:** GPT-6 Luna (vision + reasoning desain), 5 screenshot
**Biaya audit:** ~$1,31 dari $4,90 saldo ExperientialLabs
**Tanggal:** 5 Oktober 2026

---

## Cara membaca dokumen ini

Audit ini dilakukan Luna dengan **melihat screenshot nyata** (home desktop/mobile,
docs desktop/mobile, halaman proyek). Setiap temuan kemudian **saya verifikasi
ke kode** — beberapa terbukti benar, satu terbukti salah, dan satu bug nyata
ditemukan yang tidak terlihat dari screenshot mana pun.

Tanda:
- **[TERVERIFIKASI]** — sudah dicek ke kode, penyebabnya ditemukan
- **[SEBAGIAN]** — benar sebagian, ada nuansa yang perlu diperhatikan
- **[SALAH]** — temuan Luna tidak terbukti di kode
- **[BARU]** — ditemukan saat verifikasi, tidak ada di analisis Luna

---

## 1. Penilaian jujur

**Skor visual: 7/10 · Skor UX: 5,5/10 · Keseluruhan: 6/10**

Luna menilai fondasi visualnya kuat — palet konsisten, tipografi jelas, aksen
oranye terkendali, dan tema gelap cocok dengan identitas proyek self-hosted.
Yang mengurangi kesan matang: banner cookie memakan ruang mobile, judul hero
pecah dengan canggung, dan header halaman proyek rusak.

**Catatan penting dari Luna:** transisi dan gerak **tidak bisa dinilai dari
screenshot statis.** Jumlah modul animasi (28 file JS) bukan bukti situs terasa
hidup. Ini jujur dan benar — audit gerak butuh interaksi nyata.

### Yang harus DIPERTAHANKAN

- **Palet gelap + oranye** — konsisten, mudah dikenali. Jangan tambah warna
  aksen kedua tanpa kebutuhan fungsional.
- **Inter + JetBrains Mono** — cocok untuk portofolio developer.
- **Copy hero** — proposisi nilai spesifik ("alat untuk perangkat lama")
  lebih kuat daripada slogan generik.
- **Terminal hero** — bukti visual karakter produk, bukan dekorasi.
- **Arsitektur performa** — satu `scroll-manager`, grain teroptimasi, batas
  CSS per halaman. Pertahankan.

---

## 2. Masalah berdasarkan prioritas

**Tidak ada P0.** P0 berarti fungsi inti rusak. Masalah terberat adalah P1.

### P1-1 · Header halaman proyek RUSAK — logo & nav jadi dua baris

**[TERVERIFIKASI — BUG NYATA]**

**Penyebabnya ditemukan:**

```
home.html      → <header class="site-header"><div class="site-header-inner">
docs.html      → <header class="site-header"><div class="site-header-inner">
s/*/index.html → <header class="site-header">          ← TANPA WRAPPER
```

`display: flex` ada di `.site-header-inner`, **bukan** di `.site-header`.
Kedua halaman proyek tidak punya wrapper itu, jadi logo dan nav menumpuk
vertikal alih-alih berdampingan.

**Dampak:** pengunjung yang membuka halaman proyek melihat header yang
berbeda dari halaman lain. Situs terasa tidak punya sistem desain.

**Perbaikan:** tambahkan `<div class="site-header-inner">` di
`s/e7kz4swubfvg/index.html` dan `s/zsvjp554dkt4/index.html`, bungkus brand + nav.

**Kriteria terima:** pada 1440px dan 390px, logo dan nav berada dalam satu
baris di KEDUA halaman proyek, sama seperti home dan docs.

---

### P1-2 · Banner cookie menutupi konten

**[TERVERIFIKASI]**

Diukur dari screenshot mobile: banner setinggi **237px dari 844px = 28% layar.**
Menutupi statistik beranda dan konten dokumentasi.

**Koreksi Luna yang benar:** tidak adanya tombol X **bukan** cacat. Banner
consent memang harus meminta pilihan. Menambahkan X yang membuang banner tanpa
mencatat pilihan akan melanggar maksud consent itu sendiri.

**Perbaikan:**
- Mobile: `padding: 16px 18px calc(16px + env(safe-area-inset-bottom))`
- Tombol tinggi minimum `44px` (target sentuh)
- `max-height: 40svh` — kalau konten lebih tinggi, banner bisa di-scroll
- Pertahankan kedua pilihan dengan ukuran & kontras **setara**
- "Atur pilihan" boleh lebih ringan sebagai tautan sekunder

**Yang TIDAK boleh:** menyamarkan "Tolak semua", menambah X yang membuang
banner tanpa mencatat pilihan.

---

### P1-3 · Judul hero desktop pecah canggung

**[TERVERIFIKASI]** — Luna menemukan ini, saya lewatkan.

Kata "alat" berdiri sendiri di satu baris. Membuang ruang vertikal dan membuat
headline terasa kurang terarah.

**Perbaikan:** uji `max-width: 12–14ch` pada headline desktop, sesuaikan
`font-size` supaya "alat" tidak berdiri sendiri. **Jangan** paksa line break
sebelum menguji lebar kolom.

---

### P1-4 · Jarak kosong sebelum label "DOKUMENTASI" di mobile

**[TERVERIFIKASI]** — ~100px dari header ke label. Diukur: `.docs-page`
memakai `padding: 6rem 1.25rem 4rem` (96px atas) di `max-width: 900px`.

**Perbaikan:** kurangi padding atas mobile jadi `40–56px` (≈`3rem`).

---

### P1-5 · Chip kategori dokumentasi terpotong di tepi

**[TERVERIFIKASI]** — `.toc` di mobile sudah `overflow-x: auto` +
`scrollbar-width: none`, **tapi tidak ada petunjuk visual** bahwa masih ada
chip di kanan. Chip ketiga terpotong di tepi.

**Perbaikan:**
- Gradient tepi kanan sebagai petunjuk, hilang saat mencapai ujung daftar
- Setiap chip target sentuh minimum `44px` tinggi
- Jangan paksa scroll horizontal dengan JS — scroll native sudah cukup

---

### P1-6 · Tidak ada indikator nav aktif

**[SEBAGIAN]** — Luna benar bahwa nav terlihat seragam. Tapi `scroll-manager.js`
sudah punya mekanisme status; indikator aktif belum dipakai di nav utama.

**Perbaikan:** nav aktif dapat indikator oranye tipis, perpindahan `160–200ms`.
**Wajib:** indikator harus tetap terlihat tanpa animasi (bukan bergantung pada
transisi). Gunakan mekanisme status yang ada, jangan buat listener scroll baru.

---

### P2-1 · Kontras tombol GitHub di mobile

**[SEBAGIAN]** — Luna benar soal hierarki lemah, tapi **tidak** boleh diubah
jadi CTA utama (aksi utama tetap "Lihat proyek").

**Perbaikan:** perjelas border ke `var(--line)` atau `var(--accent-line)` saat
hover/focus. Tambah `:focus-visible` konsisten.

---

### P2-2 · Placeholder pencarian terpotong

**[TERVERIFIKASI]** — `placeholder="Cari topik — mis. token, keamanan, akses…"`
terpotong jadi "…keamanan, ak" di mobile 390px.

**Perbaikan:** pendekkan jadi `Cari topik…` di mobile. Pakai `<label>` yang
dapat diakses — jangan andalkan placeholder sebagai label.

---

### P2-3 · Hint "Esc" tidak berguna di mobile

**[TERVERIFIKASI]** — `.docs-search-hint` (docs.css:112) **tidak** disembunyikan
di mobile.

**Koreksi Luna yang benar:** jangan deteksi perangkat dari user-agent.
Sembunyikan berdasarkan kemampuan pointer:

```css
@media (hover: none) {
  .docs-search-hint { display: none; }
}
```

---

### P2-4 · Ruang kosong besar di halaman proyek

**[BELUM TENTU SALAH]** — Luna jujur: "terlihat, tapi belum tentu salah."
Kalau memang layout editorial yang disengaja, pertahankan. Kalau tidak, isi
dengan diagram/screenshot/ringkasan teknis yang bernilai.

**Keputusan:** tunda sampai P1 selesai, lalu nilai ulang.

---

### Temuan BARU saat verifikasi

**[BARU] 13 dari 29 file JS belum memeriksa `prefers-reduced-motion`**

Luna menulis: "CSS saja belum cukup untuk video, marquee, atau transform yang
dikendalikan JavaScript."

Diverifikasi: **16 file sudah cek, 13 belum:**

```
api.js         cf-gate.js     cookies.js     docs.js
experiment.js  icons.js       masonry.js     orb-menu.js
project.js     scroll-manager.js  tech-logos.js
video-player.js  vitals.js
```

Yang paling perlu diperhatikan: **`scroll-manager.js`** (sumber semua gerak
berbasis scroll), **`masonry.js`**, dan **`video-player.js`**.

---

## 3. Perbaikan transisi & gerak

Prinsip Luna: gerak harus menjelaskan **apa yang berubah, apa yang merespons,
dan ke mana perhatian perlu pindah.** Jangan menambah gerak hanya agar halaman
tampak aktif.

### A. Tombol, tautan, nav

```
Hover   : 160–200ms, var(--ease)
Press   : 80–120ms, tanpa overshoot
Focus   : langsung terlihat — JANGAN menunggu animasi
Nav aktif: 180ms
```

**Alasan:** respons yang dekat dengan waktu interaksi terasa langsung.

```css
.button,
.nav-link {
  transition:
    color 180ms var(--ease),
    background-color 180ms var(--ease),
    border-color 180ms var(--ease),
    transform 180ms var(--ease);
}
.button:active { transform: translateY(1px); }
```

### B. Reveal saat masuk viewport

```
opacity 0 → 1, translateY(8px) → 0, sekali saja
Timing: 320–420ms
Stagger antar-elemen: maksimal 50ms, total rangkaian maksimal 250ms
```

**Alasan:** gerak pendek memberi kesinambungan. Stagger panjang membuat konten
terasa lambat dan menghambat akses informasi.

**Wajib:** konten tetap terlihat kalau JavaScript gagal — jangan
`opacity: 0` sebagai nilai awal di CSS.

### C. Banner cookie

```
Masuk dari bawah maksimal 8px + opacity 0 → 1
Timing: 200–240ms
JANGAN: bounce, scale, atau menggeser konten halaman
```

**Alasan:** banner adalah lapisan UI yang masuk, bukan konten yang membuat
layout meloncat.

### D. Terminal hero

Cursor boleh berkedip pelan: `1–1,2s`, **tanpa glow.**

**Jangan** tambah animasi latar baru sebelum menilai video dan grain yang ada.

### E. Hindari animasi berlebihan

- Jangan gabungkan tilt + glare + spotlight + magnetic + hover-lift pada
  **satu elemen**
- Hindari parallax besar, animasi terus-menerus, bounce
- Jangan menahan konten penting sampai animasi selesai
- Jangan animasikan `top`/`left`/`width`/`height` — pakai `transform` & `opacity`
- **Audit `variable-weight.js`** — Luna mencurigai perubahan weight saat scroll
  membuat teks tampak bergetar dan menambah kerja render. Pertahankan hanya
  kalau uji nyata menunjukkan manfaat jelas.

### F. Kapan gerak HARUS tidak ada

- `prefers-reduced-motion: reduce` → matikan reveal, parallax, tilt, marquee,
  scroll-linked motion. Indikator state statis tetap ada.
- Perangkat hemat data / jaringan lambat → jangan mulai video dekoratif
  sebelum dibutuhkan
- Tab tersembunyi → grain sudah pause; hentikan kerja animasi lain juga
- JavaScript gagal → semua konten & kontrol tetap bisa dipakai

---

## 4. Spesifikasi teknis

### 4.1 Motion tokens (tambahkan ke `:root` di `main.css`)

```css
--motion-fast: 120ms;
--motion-ui: 180ms;
--motion-enter: 380ms;
```

Gunakan token ini, bukan durasi baru per komponen tanpa alasan.

### 4.2 Header halaman proyek (P1-1)

**File:** `s/e7kz4swubfvg/index.html`, `s/zsvjp554dkt4/index.html`

Bungkus `<a class="brand">` + `<nav class="site-nav">` dalam
`<div class="site-header-inner">`.

### 4.3 Banner cookie (P1-2)

**File:** `assets/css/cookies.css`

```css
@media (max-width: 640px) {
  .cookie-banner {
    padding: 16px 18px calc(16px + env(safe-area-inset-bottom));
    max-height: 40svh;
    overflow-y: auto;
  }
  .cookie-banner button { min-height: 44px; }
}
```

### 4.4 Jarak docs mobile (P1-4)

**File:** `assets/css/docs.css` (baris ~481)

```css
@media (max-width: 900px) {
  .docs-page { padding: 3rem 1.25rem 4rem; }  /* dari 6rem */
}
```

### 4.5 Chip kategori (P1-5)

**File:** `assets/css/docs.css` (`.toc` di mobile)

- Gradient tepi kanan sebagai cue, hilang di ujung daftar
- `min-height: 44px` per chip
- Pertahankan `overflow-x: auto` + `scrollbar-width: none`

### 4.6 Pencarian docs (P2-2, P2-3)

**File:** `docs.html` + `assets/css/docs.css`

- Placeholder mobile: `Cari topik…`
- Tambah `<label>` (bisa visually-hidden) — jangan andalkan placeholder
- Sembunyikan hint Esc dengan `@media (hover: none)`

### 4.7 Hero & tombol GitHub (P1-3, P2-1)

**File:** `assets/css/main.css` (hero), `assets/css/interactions.css` (tombol)

- Uji `max-width: 12–14ch` pada headline desktop
- Border tombol GitHub lebih jelas saat hover/focus
- `:focus-visible` konsisten di semua tombol

### 4.8 Reduced motion menyeluruh (temuan BARU)

**File:** 13 file JS yang belum cek + CSS global

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Prioritas JS:** `scroll-manager.js`, `masonry.js`, `video-player.js`, `orb-menu.js`

Setiap modul harus: periksa `matchMedia('(prefers-reduced-motion: reduce)')`,
hentikan gerak, **tetap tampilkan state akhir**.

### 4.9 Kriteria penerimaan

- [ ] Pada 390px, banner cookie tidak menghilangkan akses ke pilihan consent
- [ ] Header halaman proyek satu baris di 1440px dan 390px
- [ ] Placeholder pencarian tidak terpotong mid-word
- [ ] Chip kategori punya petunjuk scroll, bisa dipakai touch + keyboard
- [ ] Semua tombol interaktif punya focus state terlihat
- [ ] `prefers-reduced-motion` menghentikan gerak non-esensial **termasuk yang dikendalikan JS**
- [ ] Tidak ada scroll listener / loop rAF tambahan di luar arsitektur yang ada
- [ ] CSS tetap di bawah **120 KB per halaman**
- [ ] Diuji cold load pada perangkat sederhana + koneksi lambat

---

## 5. Batasan

- Jangan tambah framework, library animasi, atau dependency
- Jangan kembalikan Three.js particles
- Jangan tambah listener scroll terpisah dari `scroll-manager.js`
- Jangan pasang magnetic effect pada kartu proyek
- Jangan pasang ripple pada `.orb-item`
- Jangan ganti grain yang sudah dioptimasi tanpa hasil profiling
- Jangan tambah video/animasi latar sebagai jalan pintas "terasa hidup"
- Jangan hapus pilihan penolakan consent atau membuatnya sulit ditemukan
- Jangan naikkan CSS melewati 120 KB per halaman
- **Jangan nilai kualitas gerak dari screenshot saja** — uji hover, press,
  scroll, keyboard, reduced motion, touch, dan perangkat lambat

---

## 6. Urutan eksekusi yang disarankan

**Batch 1 — perbaikan yang terlihat langsung (P1):**
1. Header halaman proyek (P1-1) — bug nyata, perbaikan satu baris
2. Jarak docs mobile (P1-4) — satu nilai CSS
3. Placeholder + hint Esc (P2-2, P2-3) — cepat
4. Judul hero (P1-3)
5. Banner cookie (P1-2)

**Batch 2 — sistem (P1 + temuan baru):**
6. Motion tokens
7. Reduced motion menyeluruh (13 file JS)
8. Nav aktif (P1-6)
9. Chip kategori (P1-5)
10. Tombol GitHub (P2-1)

**Batch 3 — audit gerak nyata (butuh interaksi, bukan screenshot):**
11. Uji hover/press/focus/scroll di browser sungguhan
12. Audit `variable-weight.js` — apakah benar terasa bergetar?
13. Nilai ulang halaman proyek (P2-4)

**Catatan:** Batch 3 tidak bisa dikerjakan dari screenshot. Perlu browser
nyata dengan input sungguhan — dan itu berarti mengukur, bukan menebak.

---

## Lampiran: koreksi silang

| Temuan | Luna | Verifikasi kode | Hasil |
|---|---|---|---|
| Header proyek dua baris | Benar (dari screenshot) | Penyebab ditemukan: wrapper hilang | **[BENAR — bug nyata]** |
| Banner cookie menutupi | Benar | 237px/844px terukur | **[BENAR]** |
| Tombol X harus ada | **Salah** | — | **[DITOLAK]** — X tanpa catat consent melanggar maksud consent |
| Tombol cookie bobot sama | Sebagian benar | — | **[SEBAGIAN]** — jangan samarkan Tolak |
| Hint Esc mobile | Benar | Tidak disembunyikan | **[BENAR]** |
| Judul hero pecah | Benar | Saya lewatkan | **[BENAR]** |
| Jarak docs 100px | Benar | `padding: 6rem` = 96px | **[BENAR]** |
| Chip terpotong | Benar | Ada overflow, tanpa cue | **[BENAR]** |
| Nav aktif | Belum pasti | Belum dipakai di nav utama | **[SEBAGIAN]** |
| Placeholder terpotong | Benar | 390px memotong | **[BENAR]** |
| Reduced motion CSS kurang | Benar | 13 dari 29 JS belum cek | **[BENAR — temuan baru]** |
| variable-weight bergetar | Dugaan | Belum diuji | **[PERLU UJI NYATA]** |

**Pelajaran:** Luna mengoreksi 2 temuan saya (X banner, Esc/user-agent) dan
menemukan 1 bug nyata yang saya lewatkan (header proyek). Verifikasi ke kode
tetap wajib — 1 temuan Luna ("header dua baris") benar, tapi **penyebabnya**
baru ketemu setelah membaca HTML+CSS.
