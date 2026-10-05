# Audit Gerak Nyata (Batch 3)

**Tanggal:** 5 Oktober 2026
**Skrip:** `scripts/audit-motion.mjs`
**Hasil:** Tidak ada masalah gerak yang perlu diperbaiki

---

## Kenapa audit ini ada

Audit desain (Luna) menulis dengan jujur:

> "Transisi dan gerak belum bisa dinilai dari screenshot statis. Jumlah
> modul animasi yang ada juga belum membuktikan situs terasa hidup."

Itu benar. Batch 3 adalah jawabannya — tapi dibagi dua:

1. **Yang BISA diukur skrip** — respons hover/press/focus, durasi, animasi
   loop, properti mahal. Ini yang dikerjakan `audit-motion.mjs`.
2. **Yang TIDAK bisa diukur skrip** — apakah geraknya terasa nyaman. Itu
   butuh mata dan tangan manusia. Daftar periksa manual ada di bagian akhir.

Memisahkan keduanya penting: kalau kita menyerahkan semuanya ke penilaian
manusia, masalah objektif (mis. focus tidak terlihat) bisa terlewat karena
mata sudah lelah. Kalau menyerahkan semuanya ke skrip, kita akan
"memperbaiki" hal yang sebenarnya sudah baik.

---

## Hasil pengukuran

### 1. Respons state — BAIK

```
Elemen interaktif terlihat : 36
Punya transisi responsif   : 32/36
Punya focus indicator      : 36/36 ✅
```

**4 elemen yang dilaporkan "tanpa transisi" — semuanya false positive:**

| Elemen | Kenapa bukan masalah |
|---|---|
| `.brand` (logo header) | Elemen identitas, bukan tombol aksi. Hover pada logo bukan konvensi. |
| `Selengkapnya` (tautan dalam banner) | Tautan dalam teks — konvensi underline, bukan transisi warna. Sudah punya `text-decoration: underline`. |
| `<input>` pencarian docs | Sudah punya `transition: border-color 0.2s` + `:focus`. Skrip salah memilih `<input>` tanpa class. |

### 2. Durasi — BAIK

```
    200ms   59x  ✅
    180ms   31x  ✅
    250ms   25x  ✅
    350ms    8x  (kemunculan, bukan hover)
    450ms    5x  (kemunculan, bukan hover)
    150ms    2x  ✅

Dalam rentang 100-250ms: 117/130 = 90%
```

**Durasi 350-450ms bukan masalah.** Itu untuk elemen MASUK (banner cookie,
panel, orb menu) — kategori `--motion-enter` yang memang boleh lebih lambat
dari `--motion-ui`. Elemen yang masuk dengan 180ms terasa tersentak; hover
yang 380ms terasa lambat. Dua kategori, dua nilai.

### 3. Animasi tanpa henti — BAIK

Ditemukan 4 animasi loop: `drift` (26s), `caret-blink` (1.1s),
`marquee-left` (42s), `marquee-right` (48s).

Semuanya **berhenti saat `prefers-reduced-motion`** — diverifikasi:

```
reduced-motion=true:
  hero-fallback  drift  dur=1e-05s  iter=1  berjalan=0  ✅
  (marquee, caret, wave-char tidak ada yang berjalan)
```

### 4. Properti layout di transisi — BAIK

```
✅ Tidak ada transisi pada properti layout
```

Semua transisi memakai `transform`, `opacity`, `color`, `border-color`,
`box-shadow` — properti yang tidak memicu reflow.

---

## Temuan penting: skrip audit bisa salah

Versi pertama `audit-motion.mjs` melaporkan **17 dari 36 elemen tanpa focus
indicator** — terdengar seperti masalah aksesibilitas serius.

Ternyata SALAH. Proyek sudah punya `:focus-visible` global di `premium.css`:

```css
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

Skrip hanya memeriksa `outline-style`, yang memang di-set `none` — padahal
fokus ditampilkan lewat `box-shadow`. Skrip melaporkan "tidak ada" untuk
sesuatu yang ada.

**Kenapa ini berbahaya:** kalau dipercaya, kita akan "memperbaiki" fokus
dengan menambah outline — dan hasilnya justru dua indikator fokus
bertumpuk, lebih buruk dari sebelumnya.

**Perbaikan skrip:** sekarang memeriksa apakah ada aturan `:focus-visible`
yang cocok dengan elemen, dengan mencocokkan selector dari stylesheet —
bukan menebak dari computed style.

**Pelajaran:** skrip audit adalah alat, bukan kebenaran. Setiap temuan
harus diverifikasi ke kode sebelum dipercaya — termasuk temuan dari skrip
yang kita tulis sendiri.

---

## Daftar periksa manual (yang tidak bisa diukur skrip)

Jalankan di HP dan laptop, dengan mata dan tangan:

### Gerak terasa nyaman?

- [ ] Gulir halaman utama perlahan — apakah ada efek yang terasa
      "menempel" atau tersendat?
- [ ] Apakah `variable-weight` (berat huruf berubah saat gulir) terasa
      halus, atau justru seperti teks bergetar?
- [ ] Marquee di bagian bawah — mengganggu atau menambah hidup?
- [ ] Kartu proyek saat disentuh — responsnya terasa langsung?

### Umpan balik terasa benar?

- [ ] Tekan tombol — apakah terasa "ditekan" (ada perubahan seketika)?
- [ ] Hover tautan nav — perubahannya terasa halus atau lambat?
- [ ] Scroll-spy: saat menggulir, apakah penanda nav berpindah di tempat
      yang masuk akal (bukan melompat-lompat)?
- [ ] Banner cookie masuk — terasa mengganggu atau wajar?

### Ada yang mengganggu?

- [ ] Ada animasi yang membuat mata lelah kalau diperhatikan lama?
- [ ] Ada elemen yang bergerak padahal Anda tidak melakukan apa pun?
- [ ] Di HP, apakah ada gerak yang membuat baterai cepat habis?

### Aksesibilitas (uji dengan keyboard)

- [ ] Tekan Tab dari awal halaman — apakah SETIAP elemen interaktif
      mendapat penanda fokus yang terlihat?
- [ ] Tab sampai ke nav — apakah penanda fokus terlihat jelas?
- [ ] Tekan Enter pada tautan nav — apakah berpindah dengan benar?

### Preferensi gerak (uji reduced-motion)

Aktifkan "Reduce motion" di pengaturan OS, lalu muat ulang:

- [ ] Semua gerak berhenti?
- [ ] Konten tetap terlihat (tidak ada yang hilang karena animasi tidak
      jalan)?
- [ ] Situs tetap bisa dipakai sepenuhnya?

---

## Cara menjalankan ulang

```bash
# Audit gerak otomatis (ukur respons, durasi, animasi loop)
node scripts/audit-motion.mjs https://portfolio-victer.pages.dev/home

# Uji reduced-motion (bandingkan dengan/tanpa preferensi)
node scripts/test-reduced-motion.mjs

# Uji scroll-spy (apakah nav menandai section dengan benar)
node scripts/test-scroll-spy.mjs

# Ukur pemecahan baris judul hero
node scripts/measure-hero.mjs
```

Semua skrip ini disimpan supaya bisa dijalankan ulang setelah perubahan —
regresi gerak ketahuan tanpa harus menunggu ada yang mengeluh.

---

## Kesimpulan

**Tidak ada masalah gerak yang perlu diperbaiki.** Yang diukur semuanya
dalam rentang yang baik:

- Focus indicator: 36/36 ✅
- Durasi UI dalam rentang ideal: 90% ✅
- Animasi loop berhenti saat reduced-motion: ✅
- Tidak ada transisi properti layout: ✅

Yang tersisa adalah penilaian subjektif: apakah geraknya terasa NYAMAN.
Itu butuh daftar periksa manual di atas — dan itu pekerjaan manusia, bukan
skrip.
