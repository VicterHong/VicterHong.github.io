# Analisis HorizonX.so — Halaman Utama (Landing Page)

Sumber: `https://horizonx.so/` — halaman ini **publik**, tidak butuh login.
Tanggal ekstraksi: 11 Okt 2026
Metode: baca `document.styleSheets` + `getComputedStyle` langsung dari browser

> Catatan: `https://horizonx.so/home` mengalihkan ke `/login`. Yang publik
> adalah `/` (landing page). Dokumen ini melengkapi `ANALISIS-HORIZONX.md`
> yang fokus pada sistem reveal.

---

## Produk Mereka

**"The premium UI & code library for the vibecoding era."**

Library UI kit, komponen, dan file Figma untuk proyek nyata. Pengguna
mengunduh yang dibutuhkan, lalu memodifikasinya. Model bisnis: langganan
(ada banner "20% off your first month" dengan countdown).

**Struktur navigasi:** Explore · Tools · MCP · Pricing · FAQ · Docs ·
Affiliate · Community · Log in

---

## Struktur Halaman

| # | Section | Tinggi | Isi |
|---|---|---|---|
| 1 | Hero | 821px | Judul + preview kartu |
| 2 | Library | 1840px | Grid kartu template |
| 3 | Tools | 1840px | — |
| 4 | Textures | 1840px | — |
| 5 | Most Visited | 1840px | — |
| 6 | From browse to build | 739px | Alur 3 langkah |
| 7 | Rated 5.0 | 483px | Testimoni |
| 8 | Pricing | 2245px | Paket langganan |
| 9 | FAQ | 838px | Pertanyaan |
| 10 | Footer | 545px | — |

**Pola:** empat section galeri (Library, Tools, Textures, Most Visited)
semuanya **1840px** — tinggi identik. Itu bukan kebetulan: mereka memakai
tata letak yang sama, hanya isinya berbeda.

---

## Design Token (dibaca dari `:root`)

```css
/* Warna — monokrom dengan satu aksen */
--color-primary-color: #171717;        /* hampir hitam, bukan #000 */
--color-secondary-color: #171717;
--tertiary-color: #f3f3f3;             /* latar abu sangat muda */

/* Bentuk */
--radius-card: 30px;                   /* kartu */
--radius-pill: 48px;                   /* tombol */
--radius-chip: 100px;                  /* label kecil */

/* Bayangan */
--shadow-card: 0 20px 70px #17171712;  /* blur 70px, alpha 7% */

/* Permukaan kaca */
--color-surface-glass-opaque: #ffffffe6;

/* Tipografi */
--font-display: "Inter", system-ui, -apple-system, ...;

/* Animasi */
--reveal-duration: .22s;

/* Ukuran font responsif — clamp, bukan breakpoint */
--fs-4xl: clamp(1.5rem, calc(1.32rem + .75vw), 2rem);
--fs-xl-to-5xl: clamp(1.1875rem, calc(.73rem + 1.97vw), 2.5rem);

/* Warna semantik */
--color-star-filled: #171717;          /* bintang rating */
--color-notify-drop: #6366f1;          /* indigo untuk notifikasi */
```

### Tiga Hal yang Perlu Diperhatikan

**1. Hitam mereka `#171717`, bukan `#000000`**

Hitam murni di layar terasa keras dan membuat tepi huruf "bergerigi".
`#171717` (sekitar 9% abu) lebih lembut dibaca.

**2. Tiga tingkat radius, masing-masing punya peran**

```
30px   → kartu (besar, sudut terlihat)
48px   → tombol (pill, hampir bulat penuh)
100px  → chip/label (benar-benar pill)
```

Kontras bentuk inilah yang memberi kesan modern — bukan semuanya
membulat sama.

**3. Ukuran font pakai `clamp()`, bukan media query**

```css
--fs-4xl: clamp(1.5rem, calc(1.32rem + .75vw), 2rem);
```

Satu deklarasi menggantikan tiga blok `@media`. Font menyesuaikan
**terus-menerus** seiring lebar layar, bukan melompat di breakpoint.

---

## Anatomi Kartu Galeri

Diukur dari `.product-card` yang sebenarnya:

```
Grid       : 2 kolom × 332px, gap 20px
Kartu      : 332×366px, radius 30px
Latar      : rgba(23,23,23,0.06) — 6% hitam
Border     : tidak ada (0px)
Bayangan   : tidak ada
Padding    : 0 (gambar penuh, teks punya padding sendiri)
```

**Pola penting: tanpa border, tanpa bayangan.**

Kartu dibedakan dari latar hanya lewat **isi 6% hitam**. Ini kebalikan
dari kebanyakan desain yang memakai border 1px + bayangan.

Kenapa berhasil: latarnya putih murni, jadi 6% hitam sudah cukup untuk
membedakan. Menambah border akan membuatnya terasa "kotak".

### Isi Kartu (dua bagian)

**Bagian atas — preview:**
- Gambar penuh, sudut atas membulat
- Badge menempel di pojok kiri atas:
  - `Premium` — ikon mahkota kuning + teks, latar gelap transparan
  - `New` — titik hijau + teks, latar putih

**Bagian bawah — informasi:**
```
Judul       : "Crest Water Hero"        (font-semibold)
Deskripsi   : "A 3D credit card floats over a live sunset sea..."
Meta        : [logo HorizonX] HorizonX  [tag: Code]
```

**Deskripsi dipotong, tidak ditampilkan penuh.** Itu disengaja —
kartu tetap seragam tingginya, dan pengguna yang tertarik akan membuka
detailnya.

---

## Pola Hover (dari kelas `card-glow`)

Kartu punya elemen anak dengan kelas `card-glow` dan `card-glow-mesh`.
Dari namanya, ini **efek cahaya yang mengikuti kursor** — bukan sekadar
bayangan statis.

Latar kartu memakai token `--color-surface-glass-opaque` (#ffffffe6) —
putih 90%. Dikombinasikan dengan glow di belakangnya, hasilnya kesan
kaca bercahaya.

---

## Tipografi — Hierarki

```
Hero headline  : besar, bold, dua baris, rata tengah
Section judul  : "Library" — bold, hitam
Section sub    : "A selection of templates and assets..." — abu, reguler
Kartu judul    : font-semibold, leading-snug
Kartu desk     : lebih kecil, abu
```

**Judul section pendek satu kata** ("Library", "Tools", "Textures",
"Most Visited"). Subjudulnya satu kalimat penjelas.

Ini pola yang mudah ditiru dan sangat efektif: judul pendek mudah
dipindai, subjudul memberi konteks.

---

## Yang Bisa Diterapkan ke VIVASTIC

### 1. Tiga tingkat radius (mudah, dampak besar)

```css
--radius-kartu: 30px;
--radius-tombol: 48px;
--radius-chip: 100px;
```

Saat ini VIVASTIC memakai radius yang lebih seragam. Kontras bentuk
akan membuatnya terasa lebih modern.

### 2. Hitam `#171717`, bukan `#000000`

Kalau VIVASTIC pakai hitam murni di teks, ganti ke `#171717`. Lebih
lembut dibaca, terutama di layar beresolusi tinggi.

### 3. Font responsif dengan `clamp()`

Mengganti blok `@media` untuk ukuran font. Satu baris per ukuran.

### 4. Kartu tanpa border (khusus tema terang)

Kalau ada bagian bertema terang, coba hapus border dan pakai latar
6% gelap. Terasa lebih bersih.

### 5. Deskripsi kartu dipotong

Kalau kartu proyek VIVASTIC punya deskripsi panjang, potong dengan
`-webkit-line-clamp` supaya tinggi kartu seragam.

---

## Yang TIDAK Bisa Diekstrak

- **Halaman `/home`, `/settings`, profil** — semua butuh login
- **Kode sumber CSS lengkap** — hanya aturan yang aktif di halaman
  publik yang terbaca
- **Aset gambar preview** — terproteksi, hanya terlihat di browser

---

## Perbandingan dengan BlackRay.studio

| | BlackRay | HorizonX |
|---|---|---|
| Library | Tidak ada | Tidak ada |
| Animasi | CSS keyframes | CSS + reveal 3-fase |
| Palet | Monokrom + hijau neon | Monokrom + kuning/indigo |
| Hitam | `#0a0b0d` (gelap) | `#171717` (terang) |
| Radius | Seragam | 3 tingkat |
| Font | Space Grotesk | Inter |

**Kesamaan:** keduanya monokrom dengan satu aksen, dan keduanya menolak
library animasi berat.

**Perbedaan utama:** HorizonX fokus pada **sistem** (token, radius
bertingkat, font responsif), BlackRay fokus pada **gerakan**.
