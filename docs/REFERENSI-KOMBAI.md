# Perbandingan Desain dengan Referensi Kombai Gallery

**Tanggal:** 5 Oktober 2026
**Sumber:** Kombai Gallery — 13.561 desain web, gratis, dirancang untuk AI agent
**Tujuan:** membandingkan nilai desain portofolio dengan yang dipakai desainer lain

---

## Kenapa ini dilakukan

Sebelumnya keputusan desain diambil dari pendapat ("180ms terasa enak").
Dengan Kombai Gallery, kita bisa **membandingkan angka nyata** dari desain
yang sudah dikurasi — bukan menebak.

Yang penting dipahami: tujuan **bukan meniru**. Tujuannya memeriksa apakah
nilai portofolio berada di luar kebiasaan, dan kalau ya, apakah itu
disengaja atau kelalaian.

---

## Referensi yang dianalisis

| Kategori | Desain | Cocok untuk section |
|---|---|---|
| Bento grid | OCTA | Layanan |
| How it works | Fernwell | Cara saya bekerja |
| Stats | Traction | hero-stats |
| Features | Axiom | Layanan |
| CTA band | Framecast | Kontak |

Kelima file HTML lengkap dengan CSS + JS tersimpan di `/tmp/kombai-refs/`.

---

## Hasil perbandingan

### Radius — COCOK ✅

```
Referensi  : 7, 9, 12, 14, 16, 18, 99, 999 px
Portofolio : 14px (utama), 9px (kecil)
```

14px dan 9px portofolio **tepat di tengah** rentang referensi. Tidak perlu
diubah.

### Gap — COCOK ✅

```
Referensi  : min=4 median=10 max=64 px
             8px (6x), 12px (3x), 10px (3x), 6px (3x)
Portofolio : 14px, 16px, 32px, 56px
```

Referensi memakai gap yang beragam sesuai konteks — 6px di dalam komponen,
64px antar-section. Portofolio juga begitu. **Keragaman itu benar**, bukan
inkonsistensi.

### Durasi transisi — COCOK ✅

```
Referensi  : 180ms, 200ms, 250ms
Portofolio : 120ms (fast), 180ms (ui), 380ms (enter)
```

Rentang UI portofolio (120–180ms) **berada dalam rentang referensi**.
`--motion-enter` 380ms lebih lambat dari referensi, tapi itu untuk elemen
MASUK (banner, panel) — kategori berbeda yang memang boleh lebih lambat.

### Teknik hover — COCOK ✅

```
Referensi bento    : transform: translateY(-3px)
Referensi features : background: rgba(255,255,255,0.02)
Portofolio         : background + border-color + box-shadow (project-card)
                     border-top-color (principle)
```

Portofolio memakai perubahan **warna/luminansi** (surface ladder), referensi
memakai **pergeseran posisi**. Keduanya sah — portofolio bahkan lebih
konservatif karena tidak menggeser elemen.

**Catatan:** `translateY(-3px)` pada kartu pernah DILEPAS di portofolio
karena konflik dengan efek depth.js. Itu keputusan yang benar.

---

## Kesimpulan

**Tidak ada nilai yang perlu diubah.** Semua nilai portofolio berada dalam
rentang yang dipakai desainer lain:

| Aspek | Status |
|---|---|
| Radius | ✅ dalam rentang |
| Gap | ✅ beragam sesuai konteks |
| Durasi UI | ✅ dalam rentang |
| Teknik hover | ✅ konsisten |

Yang penting bukan **sama** dengan referensi, tapi **konsisten** secara
internal — dan itu sudah dijaga lewat motion tokens (`--motion-fast`,
`--motion-ui`, `--motion-enter`).

---

## Yang benar-benar berguna dari latihan ini

**1. Validasi empiris.** Sebelumnya "180ms" hanya berdasarkan pendapat.
Sekarang ada 5 desain terkurasi yang memakai 180–250ms — angkanya punya
dasar.

**2. Referensi siap pakai.** Kalau nanti butuh section baru (testimoni,
pricing, FAQ), ada 13.561 contoh dengan kode lengkap yang bisa dibaca
sebelum menulis. Jauh lebih cepat daripada mulai dari nol.

**3. Cara berpikir yang lebih baik.** "Apakah ini bagus?" sulit dijawab.
"Apakah 14px radius berada di luar kebiasaan?" bisa dijawab dengan data.

---

## Cara memakai Kombai Gallery lagi

```bash
# Daftar kategori yang tersedia
node ~/.hermes/scripts/kombai-gallery.mjs categories

# Lihat desain dalam satu kategori
node ~/.hermes/scripts/kombai-gallery.mjs list carousel 5
node ~/.hermes/scripts/kombai-gallery.mjs list stats 5

# Cari lintas kategori (memindai 400 entri pertama)
node ~/.hermes/scripts/kombai-gallery.mjs search "bento"

# Unduh HTML lengkap (CSS + JS) untuk dibaca
node ~/.hermes/scripts/kombai-gallery.mjs fetch stats-web-1 /tmp/ref.html

# Ringkasan nilai transisi dari satu kategori
node ~/.hermes/scripts/kombai-gallery.mjs motion navbar 6

# Bandingkan pola dengan portofolio
node ~/.hermes/scripts/analyze-kombai-patterns.mjs
```

**Catatan teknis:**
- Kategori di API harus **lowercase** dan **satu kata** untuk yang berspasi
  (`bento grid` → 404, `bento` → bekerja via search)
- `fetch` menebak kategori dari id (`stats-web-1` → kategori `stats`)
- Token berlaku sampai 2 November 2026, tersimpan di `~/.hermes/.env`

---

## Batasan

Referensi ini berguna untuk **nilai** (radius, durasi, gap) dan **struktur**
(layout grid, susunan section). Tapi:

- Desain referensi dibuat untuk brand lain — warna, tipografi, dan nada
  tidak bisa dipindahkan begitu saja
- Portofolio ini punya kendala yang tidak dimiliki referensi: CSS budget
  120 KB/halaman, satu scroll-manager, tanpa dependency
- Yang paling penting: **selera tidak bisa di-outsource ke data.** Angka
  bisa dibandingkan; apakah sesuatu terasa tepat tetap butuh penilaian.

Referensi adalah titik awal untuk berpikir, bukan jawaban akhir.
