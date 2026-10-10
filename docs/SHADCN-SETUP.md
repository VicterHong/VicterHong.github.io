# Integrasi Komponen shadcn/ui — Status & Panduan Setup

Dokumen ini menjawab satu pertanyaan: **bisakah komponen React dari shadcn/ui
(seperti `profile-dropdown.tsx`) dipasang di repo ini?** Jawaban singkatnya:
belum, dan memasangnya sekarang akan menghasilkan berkas mati. Dokumen ini
menjelaskan alasannya, jalur setup lengkap kalau memang mau ke sana, dan apa
yang sudah dikerjakan sebagai gantinya.

---

## 1. Status codebase ini

Repo ini adalah **situs statis tanpa framework**, bukan proyek React. Itu
keputusan sadar yang sudah dicatat di [README](../README.md#kenapa-tanpa-framework).

| Syarat | Status | Keterangan |
|---|---|---|
| Struktur proyek shadcn | ❌ tidak ada | Tidak ada `components/`, `lib/`, `components.json` |
| Tailwind CSS | ❌ tidak ada | Tidak terpasang, tidak ada `tailwind.config.*` |
| TypeScript untuk React | ⚠️ ada, tapi bukan untuk React | `tsconfig.json` hanya mencakup `workers/**/*.ts` |
| React / Next.js | ❌ tidak ada | Tidak ada di `dependencies` mana pun |
| Langkah build | ❌ tidak ada | Tidak ada bundler; berkas statis disajikan apa adanya |

Yang **ada**: 10 halaman HTML, CSS vanilla di `assets/css/`, JS vanilla ES
module di `assets/js/`, dan backend token Node tanpa dependency. Deploy ke
Cloudflare Pages sebagai berkas statis.

### Kenapa `tsconfig.json` yang ada tidak cukup

```json
{
  "include": ["workers/**/*.ts"],   // ← hanya Worker Cloudflare
  "compilerOptions": {
    "noEmit": true,                  // ← tidak pernah menghasilkan JS
    "lib": ["es2022"],               // ← tanpa "dom"
    "types": ["@cloudflare/workers-types"]
  }
}
```

Berkas ini **hanya untuk type-check Worker**, bukan untuk aplikasi. Tidak ada
`"jsx": "react-jsx"`, tidak ada `"lib": ["dom"]`, dan `noEmit: true` berarti
tidak ada apa pun yang pernah dikompilasi jadi JavaScript yang bisa dijalankan
browser. Menaruh berkas `.tsx` di dalamnya tidak akan menghasilkan apa-apa.

---

## 2. Path default komponen dan gaya

Ini jawaban atas pertanyaan "tentukan path default untuk komponen dan styles".

### Path default shadcn/ui

| Peran | Alias di `components.json` | Path hasil |
|---|---|---|
| Komponen umum | `aliases.components` | `@/components` |
| **Komponen UI primitif** | `aliases.ui` | **`@/components/ui`** |
| Utilitas | `aliases.utils` | `@/lib/utils` |
| Hook | `aliases.hooks` | `@/hooks` |
| CSS global | `tailwind.css` | `app/globals.css` (Next.js App Router) |

Bentuk `components.json` yang setara:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

> **Tailwind v4:** `tailwind.config` sengaja dikosongkan. Sejak v4, Tailwind
> dikonfigurasi lewat CSS (`@import "tailwindcss"` + `@theme inline`), bukan
> lewat berkas JS. Mengisinya akan menunjuk ke berkas yang tidak dipakai.

### Path default di repo ini

| Peran | Path yang dipakai sekarang | Alasan |
|---|---|---|
| Gaya | `assets/css/*.css` | Satu berkas per area; digabung `build-css.mjs` |
| Skrip | `assets/js/*.js` | ES module, dimuat `type="module"` |
| Data | `assets/js/data/*.js` | Konten proyek, bukan kode |
| Komponen | — | Tidak ada sistem komponen; HTML ditulis langsung |

Path ini **berbeda** dari konvensi shadcn, dan itu wajar: keduanya memecahkan
masalah yang berbeda. `assets/` adalah konvensi situs statis; `@/components/ui`
adalah konvensi aplikasi React yang di-bundle.

### Kenapa `/components/ui` penting

Kalau nanti pindah ke React, folder ini bukan sekadar selera — ia punya tiga
fungsi teknis:

1. **CLI menaruh berkas di sana.** `aliases.ui` di `components.json` menentukan
   tujuan `shadcn add`. Kalau aliasnya tidak ada, CLI gagal atau menaruh berkas
   di tempat yang tidak terduga, dan impor antar-komponen jadi salah.

2. **Impor antar-komponen mengandalkannya.** `profile-dropdown.tsx` mengimpor
   `@/components/ui/dropdown-menu`. Alias `@/` harus dipetakan di `tsconfig.json`
   (`paths`) **dan** di bundler. Tanpa folder itu, impornya menunjuk ke ruang
   kosong.

3. **Memisahkan dua jenis komponen.** `components/ui/` berisi primitif yang
   **tidak boleh** punya logika bisnis — `button`, `dropdown-menu`, `dialog`.
   Ia hanya soal tampilan dan aksesibilitas. Komponen yang tahu tentang data
   Anda (profil, token, tagihan) diletakkan di `components/`, bukan di
   `components/ui/`. Mencampurnya berarti setiap kali menambah primitif baru,
   Anda harus memeriksa apakah ia diam-diam mengimpor data aplikasi.

   Inilah alasan `profile-dropdown.tsx` sebenarnya **melanggar** konvensi itu:
   ia menyimpan `SAMPLE_PROFILE_DATA` di dalam berkas UI-nya. Di proyek nyata,
   `data` seharusnya selalu datang lewat props.

---

## 3. Kalau memang mau pindah ke React

Tiga jalur, dari yang paling murah ke paling mahal. **Jalur 3 yang sudah
dipakai repo ini.**

### Jalur 1 — React "island" di satu halaman

Hanya untuk komponen ini, tanpa menyentuh halaman lain. Butuh Vite sebagai
bundler kedua di samping `build-css.mjs`.

```bash
# 1. Inisialisasi proyek React kecil di subfolder
npm create vite@latest components -- --template react-ts
cd components && npm install

# 2. Tailwind v4
npm install tailwindcss @tailwindcss/vite
# tambahkan @tailwindcss/vite ke vite.config.ts

# 3. Inisialisasi shadcn
npx shadcn@latest init

# 4. Tambahkan komponen
npx shadcn@latest add dropdown-menu button
```

Setelah itu `profile-dropdown.tsx` disalin ke `components/src/components/ui/`,
lalu di-mount ke satu elemen di halaman HTML:

```html
<div id="profil-mount"></div>
<script type="module" src="/components/dist/profil.js"></script>
```

**Biaya:** ~140 KB (≈45 KB gzip) untuk React + ReactDOM, ditambah satu langkah
build baru yang bisa rusak. Anggaran situs 940 KB; terpakai 595 KB.

**Masalahnya:** menu ini sudah ada di 5 halaman sebagai vanilla. Menambah
island berarti dua sistem berbeda menangani hal yang sama — dan keduanya harus
dijaga tetap sinkron.

### Jalur 2 — Migrasi penuh ke Next.js

Ini yang dimaksud "setup via shadcn CLI" pada umumnya.

```bash
npx shadcn@latest init -t next     # scaffold proyek Next.js + shadcn
npx shadcn@latest add dropdown-menu button
```

Lalu seluruh situs ditulis ulang sebagai komponen React:

| Yang harus ditulis ulang | Jumlah |
|---|---|
| Halaman HTML | 10 |
| Berkas CSS vanilla | 30 (12.450 baris) |
| Berkas JS vanilla | 41 (14.200 baris) |
| Skrip yang ikut rusak | `deploy-aman.mjs`, `preflight.mjs`, `cf-gate.js`, `functions/[[path]].js`, `workers/site.ts` |
| Uji yang harus disesuaikan | 5 job CI (216 uji backend, 15 pemeriksaan preflight, cek HTML, panel admin, dokumentasi) |

**Ini bukan pekerjaan satu sore.** Dan hasilnya: situs yang sekarang hijau CI,
0 error, dan semua teruji akan dibongkar untuk fitur yang sudah bekerja.

### Jalur 3 — Adopsi polanya ke vanilla ✅ *(yang dipakai)*

Tidak memasang React sama sekali. Yang diambil adalah **polanya**, diterapkan
ke komponen vanilla yang sudah ada di `assets/js/nav-akun.js`.

| Pola dari `profile-dropdown.tsx` | Diterapkan di vanilla |
|---|---|
| Ikon di kiri setiap item | SVG inline 16px, stroke 1.7 seragam |
| Badge nilai di kanan item | Badge paket token + sisa masa berlaku |
| Avatar bulat di tombol | Foto dari R2 (sudah ada) |
| Pemisah sebelum "Sign Out" | `.nav-akun-garis` sebelum "Keluar" |

**Yang sengaja TIDAK ditiru:** contoh aslinya menampilkan `"PRO"` dan
`"Gemini 2.0 Flash"`. Keduanya tidak ada di backend ini. Menampilkannya berarti
mengarang data di menu yang muncul di **setiap halaman** — kalau angkanya
salah, pengguna salah paham tentang masa berlaku aksesnya. Yang dipakai adalah
data nyata dari `/api/auth/token-saya`.

**Biaya: 0 KB tambahan, 0 risiko CI.**

Rinciannya ada di commit `1cdfb29`.

---

## 4. Kalau nanti tetap mau memasang `.tsx`-nya

Langkah ini **belum dijalankan**, dan sengaja. Menyalin `.tsx` ke repo ini
sekarang akan menghasilkan berkas yang tidak pernah dikompilasi dan tidak
pernah dipanggil — kode mati yang membuat sesi berikutnya mengira ada fitur
yang sebenarnya tidak jalan.

Kalau memutuskan pindah ke React, urutannya:

```bash
# 1. Scaffold (pilih salah satu)
npx shadcn@latest init -t next          # Next.js baru
# atau: npm create vite@latest . -- --template react-ts   # Vite di repo ini

# 2. Pasang dependensi komponen
npm install lucide-react @radix-ui/react-dropdown-menu \
            @radix-ui/react-slot class-variance-authority

# 3. Pasang primitif shadcn
npx shadcn@latest add dropdown-menu button

# 4. Baru salin profile-dropdown.tsx ke components/ui/
```

### Yang harus disesuaikan setelah disalin

| Baris di contoh | Masalah | Perbaikan |
|---|---|---|
| `import Image from "next/image"` | Hanya ada di Next.js | Pakai `<img>` biasa, atau `next/image` kalau memang Next.js |
| `href: "https://kokonutui.com/"` | Tautan contoh, bukan situs Anda | Ganti ke `/keamanan` dan `/keamanan#panelMasuk` |
| `SAMPLE_PROFILE_DATA` | Data karangan di dalam berkas UI | Hapus; selalu lewat props |
| `data.subscription` / `data.model` | Tidak ada di backend | Ganti ke `tier` + `kedaluwarsa_pada` |
| `gap-16` di tombol | Jarak 4rem — kemungkinan salah ketik | `gap-2` atau `gap-3` |
| `showTopbar` di props | Dideklarasikan, tidak pernah dipakai | Hapus |
| `target="_blank"` di semua item | Menu sendiri terbuka di tab baru | Hapus untuk tautan internal |
| Ikon `Gemini` | Merek pihak ketiga | Hapus kalau tidak dipakai |
| Warna `purple`/`blue` | Bukan palet situs ini | Pakai `--accent` (`#f5c542`) |

### Catatan aksesibilitas

Contoh `profile-dropdown.tsx` memakai Radix UI, yang sudah menangani fokus,
navigasi papan ketik, dan `aria-*` dengan benar. Versi vanilla di repo ini
menangani hal yang sama secara manual (`aria-expanded`, `aria-haspopup`,
`role="menuitem"`, tutup saat Escape, klik di luar). Keduanya benar — bedanya
Radix memakainya sebagai jaminan, vanilla sebagai tanggung jawab yang harus
diuji. Uji di `scripts/` memeriksa ini.

---

## 5. Ringkasan keputusan

| Pertanyaan | Jawaban |
|---|---|
| Apakah repo mendukung shadcn? | **Tidak.** Tidak ada React, Tailwind, atau struktur komponen. |
| Path default komponen? | `@/components` (umum), `@/components/ui` (primitif) |
| Path default styles? | `app/globals.css` (Next.js) atau `src/styles/globals.css` |
| Apakah `/components/ui` wajib? | Ya, kalau memakai CLI shadcn — alias `ui` menentukan tujuan `shadcn add` |
| Apakah `.tsx` sudah disalin? | **Belum, sengaja.** Akan jadi kode mati di repo non-React. |
| Apa yang dikerjakan? | Polanya diadopsi ke vanilla — 0 KB, 0 risiko |

Kalau tujuan akhirnya adalah aplikasi React penuh, **Jalur 2** di atas adalah
jawabannya, dan dokumen ini bisa dijadikan daftar periksa. Kalau tujuannya
hanya menu profil yang lebih baik, itu sudah selesai.
