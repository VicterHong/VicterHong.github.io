# Analisis BlackRay.Studio — Mekanisme Animasi

## Stack
- **Next.js + Turbopack** (static chunks)
- Font: **Space Grotesk** (display) + **Manrope** (body) + Bagel Fat One
- **TIDAK ADA** GSAP / Three.js / Motion / Lenis / Locomotive
- **TIDAK ADA** canvas / WebGL

→ **100% CSS animation + React state.** Ini kuncinya: tidak perlu library mahal.

## Palet
```
bg        rgb(3,3,3) → rgb(5,5,5)   near-black, bukan #000
teks      rgb(243,243,250)          putih gading
redup     rgb(137,139,142)          abu netral
aksen     rgba(141,255,50)          hijau neon (hanya 1!)
border    rgba(255,255,255,0.15)
```

## Arsitektur: Layered Screens (bukan scroll!)

```
.pageShell  { position: relative; overflow: clip }
  .pageScreen { position: absolute; inset: 0 }   ← 4 layar bertumpuk
```

**Semua section ada di posisi yang SAMA, bertumpuk.** Bukan scroll vertikal.
Pindah section = tukar opacity + z-index.

Terbukti dari pengukuran:
```
SEBELUM:  portfolioHero  op=1 z=2 ptr=auto   ← aktif
          solutionsScreen op=0 z=1 ptr=none

MID:      portfolioHero  op=1→0 z=2→1  anim=sectionExitToServices  0.72s
          solutionsScreen op=0→1 z=1→2 anim=sectionEnterFromAbout  0.72s

SESUDAH:  portfolioHero  op=0 z=1 ptr=none
          solutionsScreen op=1 z=2 ptr=auto  ← aktif
```

## 8 Keyframes Inti

```css
/* ── TRANSISI SECTION ── */
@keyframes sectionEnterFromAbout {
  0%   { opacity: 0; transform: translateY(16px) scale(0.992) }
  100% { opacity: 1; transform: translate(0) scale(1) }
}
@keyframes sectionExitToAbout {
  0%        { opacity: 1; transform: translate(0) scale(1) }
  32%, 100% { opacity: 0; transform: translateY(16px) scale(0.992) }
}
```

**Kenapa 32%?** Keluar selesai di 32% durasi, sisanya diam. Jadi masuk dan
keluar TIDAK saling menunggu — layar baru sudah mulai muncul saat layar lama
belum selesai hilang. Terasa lebih cepat dari durasi sebenarnya.

```css
/* ── JUDUL: clip-path reveal ── */
@keyframes landingTitleIn {
  0%   { opacity: 0; clip-path: inset(100% 0 0); transform: translateY(46px) }
  100% { opacity: 1; clip-path: inset(0);        transform: translateY(0) }
}
```
`inset(100% 0 0)` = terpotong dari bawah → teks "terangkat" dari dalam dirinya.

```css
/* ── TAG MELAYANG ── */
@keyframes aboutTagReveal {
  0%   { opacity: 0; filter: blur(5px); scale: 0.92 }
  100% { opacity: var(--tag-opacity); filter: blur(0); scale: 1 }
}
@keyframes drift {
  0%   { transform: translate(-5px, -5px) }
  100% { transform: translate(7px, 6px) }
}
```
Tag punya **DUA animasi**: `aboutTagReveal` (sekali) + `drift` (infinite).

**Trik kunci:** setiap tag punya `animation-delay` dan durasi `drift` BERBEDA:
```
tag 1: drift 10s   delay -2s
tag 2: drift 12.4s delay -6.8s
tag 3: drift 12s   delay -6s
tag 4: drift 13s   delay -8s
tag 5: drift 9s    delay -4s
tag 6: drift 11s   delay -7s
tag 7: drift 14.2s delay -9.3s
```
Delay NEGATIF = animasi sudah berjalan saat halaman dimuat → tidak ada
tag yang mulai dari titik yang sama. Itu yang membuat gerakannya organik.

Reveal delay bertahap: `0.42s, 0.51s, 0.6s, 0.65s, 0.72s, 0.79s, 0.86s`
→ selisih ~0.07-0.09s, cukup untuk terasa berurutan tanpa terasa lambat.

```css
/* ── ITEM LIST ── */
@keyframes solutionItemIn {
  0%   { opacity: 0; transform: translateY(20px) scale(0.985) }
  100% { opacity: 1; transform: translateY(0) scale(1) }
}

/* ── MOCKUP ── */
@keyframes landingMockupIn {
  0%   { opacity: 0; transform: translate(3%, 18px) scale(0.96) }
  100% { opacity: 1; transform: translate(0) scale(1) }
}
```

```css
/* ── STATUS DOT ── */
@keyframes statusPulse {
  0%, 100% { opacity: 0.72; box-shadow: 0 0 10px rgba(141,255,50,0.22) }
  50%      { opacity: 1;    box-shadow: 0 0 18px rgba(141,255,50,0.45) }
}
```
2.4s infinite. Satu-satunya warna terang di halaman → mata langsung ke sana.

## Easing

```css
--ease-out-expo:  cubic-bezier(0.22, 1, 0.36, 1)     /* masuk */
--ease-in-out:    cubic-bezier(0.76, 0, 0.24, 1)     /* transisi umum */
--dur:            0.68s                               /* durasi seragam */
```

`cubic-bezier(0.22, 1, 0.36, 1)` = **ease-out-expo**: cepat di awal,
melambat di akhir. Terasa "weighted" dan premium.

## Durasi per Elemen

```
transisi section   0.72s
judul masuk        0.76s
konten masuk       0.65s
tag reveal         0.68s
hover              0.22s   ← jauh lebih cepat
tekan (transform)  0.18s   ← paling cepat
```

**Prinsip:** masuk lambat (dramatis), reaksi cepat (responsif).
Hover 0.22s vs reveal 0.68s = 3x lebih cepat.

## Yang Bisa Ditiru untuk VIVASTIC

1. **Layered screens** — bukan scroll. Cocok untuk halaman dengan 3-4 "mode"
2. **Keyframes `clip-path: inset()`** — untuk reveal judul
3. **Delay negatif pada drift** — gerakan organik tanpa JS
4. **Dua animasi pada satu elemen** — reveal + drift
5. **Easing ease-out-expo** — terasa premium
6. **Satu aksen terang saja** — sisanya monokrom
7. **Hover jauh lebih cepat dari reveal**

## Yang TIDAK Perlu Ditiru

- **Next.js** — situs ini statis, CSS animation bekerja sama baiknya
- **Font berbayar** — Space Grotesk gratis di Google Fonts
- **`overflow: clip`** — sudah didukung, tapi perlu fallback

## Catatan Penting

Situs ini **tidak pakai library animasi apa pun**. Semua dari CSS keyframes
+ React state untuk ganti class. Artinya:

→ **Bisa direplikasi tanpa menambah satu byte dependency.**

Yang membuatnya terasa mahal bukan library-nya, tapi:
- Timing yang presisi (0.68s konsisten)
- Easing yang tepat (ease-out-expo)
- Delay negatif untuk desinkronisasi
- Satu aksen warna saja
