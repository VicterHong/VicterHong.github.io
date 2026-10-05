# Design Kit — Video Narasi Portofolio (Figma Import)

Paket desain untuk fitur video narasi per proyek (roadmap v2.2), dibuat agar bisa
langsung diimpor ke **Figma gratis** dan dipakai dengan **Seedance versi gratis**.

---

## Isi Paket

| Berkas | Isi | Cara pakai |
|--------|-----|-----------|
| `design-kit.html` | Mockup lengkap (hero, kartu video, warna, prompt) | Buka di browser untuk preview |
| `01-video-showcase-hero.svg` | Hero video showcase 1440×900 | Drag ke Figma |
| `02-video-cards.svg` | 3 kartu video per proyek | Drag ke Figma |
| `03-color-system.svg` | Palet warna + tipografi | Drag ke Figma |

Semua SVG dirancang **layer-friendly** — Figma akan mengenali teks sebagai teks
(bisa diedit), warna sebagai fill, dan bentuk sebagai vector.

---

## Cara Impor ke Figma (Gratis)

1. Buka **figma.com** → login akun gratis (atau daftar, gratis).
2. Buat file baru: **New design file**.
3. Drag berkas `.svg` dari folder ini ke canvas Figma.
4. Setiap SVG masuk sebagai frame — klik dua kali untuk masuk dan edit.
5. Teks bisa diedit langsung; warna bisa diubah lewat panel Fill.

**Tips:** kalau ingin semua aset dalam satu halaman, drag semuanya sekaligus —
Figma akan menempatkannya berurutan.

---

## Prompt Seedance (Gratis)

Empat prompt siap pakai. Semuanya bisa dijalankan dengan **kredit harian gratis**
di Dreamina (`dreamina.capcut.com`) — pilih model Seedance 2.0 atau 2.0 Lite.

### P1 — Hero: Jaringan Data

```
Cinematic macro shot of a golden neural network gradually illuminating in deep
black space. Light travels along thin connecting lines from the center outward,
particles drift slowly. Slow camera push-in, shallow depth of field, warm golden
bokeh in background. Polished, premium, 16:9, 5 seconds, no text, no watermark,
no logos.
```

### P2 — MINA: Terminal Berjalan

```
Cinematic close-up of a small glowing terminal window on a dark desk, command
lines appearing one by one as if being typed. Warm screen glow reflects on the
surface. Slow dolly movement to the right, shallow depth of field, moody
lighting. Professional tech aesthetic, 16:9, 5 seconds, no readable text, no
watermark, no logos.
```

### P3 — Gated Portal: Gerbang Terbuka

```
Cinematic shot of a minimalist dark door with warm orange light gradually
appearing through the edges as it opens slightly. Abstract geometric frame
around the door, particles of light floating. Slow camera orbit, premium
architectural aesthetic, 16:9, 5 seconds, no text, no watermark, no logos.
```

### P4 — Spareparts: Rak Bergerak

```
Cinematic shot of organized dark storage shelves, warm accent lights turning on
sequentially row by row. Clean industrial aesthetic, slow camera tilt upward.
Minimal, premium, 16:9, 5 seconds, no readable text, no watermark, no logos.
```

**Catatan penting:** frasa `no text, no watermark, no logos` di setiap prompt
membuat hasil bersih tanpa watermark — tidak perlu dihapus manual seperti video
hero sebelumnya.

---

## Cara Pakai Prompt

1. Buka `dreamina.capcut.com` → **AI Video**.
2. Pilih model **Seedance 2.0** (atau **2.0 Lite** kalau kredit terbatas).
3. Set aspect ratio **16:9**, durasi **5 detik**.
4. Paste salah satu prompt di atas → **Generate**.
5. Unduh hasilnya, kirim ke saya untuk integrasi ke portofolio.

Kredit harian gratis biasanya cukup untuk 1–3 klip per hari. Kalau habis,
tunggu reset besok — tidak perlu bayar.

---

## Setelah Video Jadi

Kirim berkas video ke saya, dan saya akan:

1. **Bersihkan watermark** kalau masih ada (teknik `delogo`, terverifikasi bersih
   122/122 frame pada video hero).
2. **Optimalkan** ke WebM + MP4 (<2 MB per format, sesuai standar portofolio).
3. **Integrasikan** ke halaman proyek dengan pemutar yang:
   - lazy-load (video tidak dimuat sampai dibutuhkan)
   - hormati `prefers-reduced-motion`
   - punya fallback poster kalau video gagal dimuat
   - pakai scroll-scrub seperti hero (opsional)

---

## Spesifikasi Teknis

| Aspek | Nilai |
|-------|-------|
| Aspect ratio | 16:9 |
| Resolusi ideal | 1920×1080 (1280×720 cukup) |
| Durasi | 5–10 detik per klip |
| Format | MP4 (H.264) atau WebM |
| Ukuran target | < 2 MB per format setelah optimasi |
| Warna aksen | #F5C542 (oranye portofolio) |
| Background | #0A0A0B (hitam pekat) |

---

## Struktur Folder

```
design/figma-import/
├── README.md                      ← dokumen ini
├── design-kit.html                ← mockup interaktif (buka di browser)
├── 01-video-showcase-hero.svg     ← hero video showcase
├── 02-video-cards.svg             ← kartu video per proyek
└── 03-color-system.svg            ← palet warna
```

---

*Bagian dari roadmap v2.2 — Fable 5.1 project narrative videos.*
*Semua desain dibuat agar konsisten dengan portofolio yang sudah live di
https://victerhong.github.io*
