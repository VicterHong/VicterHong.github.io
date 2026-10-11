# Sistem Desain HorizonX — Hasil Ekstraksi

Sumber: `https://horizonx.so/login` (halaman publik; sisanya butuh login)
Tanggal ekstraksi: 10 Okt 2026
Metode: baca `document.styleSheets` langsung dari browser

---

## Temuan Terpenting: Sistem Reveal Dua-Fase

HorizonX tidak memakai animasi CSS biasa. Mereka memakai **tiga kelas
berurutan** yang dipasang JavaScript:

```
.is-armed     → elemen disiapkan (tersembunyi, siap beranimasi)
.is-revealed  → elemen ditampilkan (transisi berjalan)
.is-settled   → bersihkan will-change (setelah selesai)
```

### Kenapa Tiga Fase, Bukan Dua

Versi naif hanya punya dua: sembunyi → tampil. Masalahnya, elemen yang
disembunyikan sebelum JavaScript jalan akan **berkedip** — terlihat sebentar,
lalu hilang, lalu muncul lagi.

Dengan `.is-armed`, JavaScript menandai elemen **sebelum** menyembunyikannya.
Kalau JS tidak jalan, tidak ada `.is-armed` — dan elemen tetap terlihat.
Fail-open, bukan fail-closed.

### Kenapa `.is-settled` Penting

`will-change: transform` memberi tahu browser "elemen ini akan berubah".
Browser lalu membuat **layer GPU terpisah** untuk elemen itu.

Kalau dibiarkan selamanya, 50 elemen = 50 layer GPU = memori terbuang.
`.is-settled` menghapus `will-change` setelah animasi selesai.

**Ini detail yang sering dilewatkan.** Kebanyakan implementasi memasang
`will-change` dan lupa membersihkannya.

---

## Token Desain (CSS Variables)

```css
--reveal-distance: 14px;   /* jarak gerak masuk */
--reveal-duration: .26s;   /* durasi */
--reveal-stagger: 24ms;    /* jeda antar item */
--reveal-index: 11;        /* indeks item (diisi JS) */
--focus: #a48bff;          /* warna fokus (ungu) */

/* Warna teks — pakai alpha, bukan hex terpisah */
--text-1: #fff;
--text-2: #ffffffb8;   /* 72% */
--text-3: #fff9;       /* 60% */

/* Permukaan */
--chip: #ffffff0d;      /* 5% putih */
--chip-line: #ffffff21; /* 13% putih */
--line: #ffffff17;      /* 9% putih */
```

**Pola penting:** teks dan permukaan memakai **satu warna dengan alpha berbeda**,
bukan lima hex terpisah. Ini membuat tema gelap/terang mudah ditukar.

---

## Pola Stagger — Kunci Kecepatan Implementasi

```css
.reveal-stagger.is-armed > * {
  opacity: 0;
  transform: translate3d(0, var(--reveal-distance), 0);
  transition-delay: calc(var(--reveal-index, 0) * var(--reveal-stagger));
}
```

**Perhatikan:** tidak ada `:nth-child(1)`, `:nth-child(2)`, dst.

Delay dihitung dari `--reveal-index` yang diisi JavaScript. Satu aturan CSS
menangani berapa pun jumlah item — 5, 50, atau 500.

Bandingkan dengan pendekatan umum yang menulis `:nth-child(1..10)` manual.
Itu terbatas 10 item dan harus diedit setiap kali daftar bertambah.

---

## Varian Siap Pakai

### Arah (`translate3d`)

```css
.reveal-stagger--down.is-armed > *  { transform: translate3d(0, calc(var(--reveal-distance) * -1), 0); }
.reveal-stagger--left.is-armed > *  { transform: translate3d(var(--reveal-distance), 0, 0); }
.reveal-stagger--right.is-armed > * { transform: translate3d(calc(var(--reveal-distance) * -1), 0, 0); }
```

Default (tanpa modifier) = masuk dari bawah.

### Kepadatan

```css
.reveal-stagger--tight   { --reveal-stagger: 18ms; }  /* daftar rapat */
.reveal-stagger--base    { --reveal-stagger: 24ms; }  /* default */
.reveal-stagger--relaxed { --reveal-stagger: 30ms; }  /* item besar */
```

### Varian Settle — Gerak Lebih Halus

```css
.reveal-stagger--settle {
  --reveal-stagger: 24ms;
  --reveal-duration: .24s;
}
.reveal-stagger--settle.is-armed > * { transform: translateY(8px); }  /* 8px, bukan 14px */
```

Dipakai untuk elemen yang sudah ada di layar dan hanya perlu "menetap" —
bukan masuk dari luar.

---

## Keyframes yang Ditemukan

| Nama | Fungsi |
|---|---|
| `auth-shake` | Goyang saat login gagal (opacity 0.86 + translate -5px) |
| `nav-progress-shimmer` | Kilau progress bar navigasi (-250% → 350%) |
| `skeleton-pulse` | Opacity 1 → 0.4 → 1 (loading placeholder) |
| `preview-loading-spin` | Rotasi 360° |
| `drawer-backdrop-in` | Backdrop drawer muncul |
| `mm-swap` | Tukar isi: translateY(4px) + fade |
| `cover-shimmer-appear` | Latar muncul ke rgba(255,255,255,0.05) |

**Catatan:** keyframes mereka **minimal** — hanya 0% dan 100% untuk sebagian
besar. Yang membuat terasa halus adalah transisi + easing, bukan keyframes rumit.

---

## Bentuk Elemen

| Elemen | Radius | Padding | Catatan |
|---|---|---|---|
| Kartu | 30px | 32px | Sudut sangat membulat |
| Input | 9999px (pill) | 16px 20px | Border 1px #d2d2d7 |
| Tombol | 9999px (pill) | — | — |

**Pola:** input dan tombol **pill penuh**, kartu **30px**. Kontras bentuk ini
yang memberi kesan modern — bukan semuanya membulat sama.

---

## Transisi Standar

```css
transition: border-color .15s cubic-bezier(.4, 0, .2, 1),
            background-color .15s cubic-bezier(.4, 0, .2, 1),
            box-shadow .15s cubic-bezier(.4, 0, .2, 1);
```

**Easing `cubic-bezier(.4, 0, .2, 1)`** = Material Design standard.
Cocok untuk perubahan kecil (hover, fokus). Bukan untuk reveal.

**Pemisahan yang benar:**
- Reveal (masuk) → `--reveal-duration: .26s` dengan easing berbeda
- Interaksi (hover/fokus) → `.15s` cubic-bezier Material

---

## Yang TIDAK Bisa Diekstrak

Halaman profil/settings HorizonX **butuh login** — tidak bisa dilihat.
Yang terdokumentasi di atas dari halaman login publik.

Kalau perlu detail halaman akun, harus lihat langsung saat login.
