# Impor Desain dari Platform Visual

Desain email di **Stripo.email**, **Beefree.io**, atau platform lain — lalu
impor ke sistem VIVASTIC dengan satu perintah.

---

## Cara Pakai (5 Langkah)

### 1. Desain di platform visual

Buka salah satu:
- **https://stripo.email** — gratis, 6 template/bulan
- **https://beefree.io** — gratis, builder drag-and-drop

Desain sesuka Anda. Tidak perlu mengikuti struktur apa pun.

### 2. Sisipkan variabel di tempat yang perlu diisi

Pakai sintaks apa pun — importer menormalkannya otomatis:

```
Stripo      [[${nama}]]  atau  [[nama]]
Mailchimp   *|FNAME|*
SendGrid    [%jumlah%]
Liquid      {{ customer.name }}
Beefree     [nama]
```

Semua jadi `{{nama}}` di sistem kita.

### 3. Ekspor HTML

Di Stripo/Beefree: **Export → HTML**.

Simpan ke:
```
email-src/impor/<nama>.html
```

Contoh: `email-src/impor/promo.html`

### 4. Buat berkas meta

Buat `email-src/impor/<nama>.meta.json`:

```json
{
  "subjek": "Penawaran khusus untuk {{nama}}",
  "judul": "Promo Akhir Tahun",
  "preheader": "Diskon 30% sampai 31 Desember",
  "variabelWajib": ["nama", "kode_promo"]
}
```

| Field | Wajib | Keterangan |
|-------|-------|------------|
| `subjek` | ✅ | Subjek email (boleh berisi variabel) |
| `judul` | — | Judul di `<title>` email |
| `preheader` | — | Teks pratinjau di daftar masuk |
| `variabelWajib` | — | Diisi otomatis kalau kosong |

### 5. Jalankan importer

```bash
cd /home/ubuntu/portfolio-victer
node scripts/impor-desain.mjs
```

Importer akan:
```
✅ Normalisasi variabel ([[${nama}]] → {{nama}})
✅ Periksa kompatibilitas (flexbox? grid? skrip?)
✅ Bungkus dengan <mj-raw> supaya bisa dikompilasi
✅ Tulis email-src/impor/<nama>.mjml.mjs
```

---

## Setelah Impor

### Kompilasi + uji

```bash
node scripts/build-email.mjs       # MJML → HTML
node --test backend/test/          # pastikan tidak ada yang rusak
```

### Daftarkan ke sistem pengiriman

Importer menghasilkan berkas di `email-src/impor/`. Untuk memakainya, daftarkan
di `email-src/templates.mjml.mjs`:

```js
// Tambahkan di akhir berkas
import { meta as metaPromo, mjml as mjmlPromo } from './impor/promo.mjml.mjs';

TEMPLATE.promo = {
  subjek: metaPromo.subjek,
  variabelWajib: metaPromo.variabelWajib,
  mjml: mjmlPromo,
};
```

Lalu build ulang.

---

## ⚠️ Pemeriksaan Kompatibilitas (Otomatis)

Importer **menolak** HTML yang tidak akan bekerja di klien email:

| Masalah | Kenapa Fatal |
|---------|--------------|
| `display:flex` | Outlook pakai mesin render Microsoft Word — flexbox tidak dikenal, tata letak hancur |
| `display:grid` | Sama seperti flexbox |
| `position:absolute/fixed` | Outlook mengabaikannya — elemen menumpuk di kiri atas |
| Tidak ada `<table>` | Email berbasis `<div>` berantakan di Outlook |
| `<script>` | Klien email memblokirnya; filter spam menandainya |
| `onclick=` dll | Sama seperti skrip |

Kalau ada masalah, importer **berhenti** dan menjelaskan apa yang salah:

```
❌ TIDAK AMAN — 1 masalah:
   • Memakai flexbox (display:flex). Outlook memakai mesin render
     Microsoft Word yang TIDAK mengenal flexbox — tata letaknya akan hancur.

Perbaiki desainnya di platform visual, ekspor ulang, lalu jalankan lagi.
```

### Kalau platform visual memaksa flexbox

Sebagian platform menghasilkan flexbox untuk tata letak dua kolom. Solusinya:

1. **Di platform:** ubah tata letak jadi satu kolom (vertikal)
2. **Atau:** edit HTML hasil ekspor — ganti `display:flex` dengan tabel
3. **Atau:** paksa impor dengan `--paksa` (hanya kalau Anda sudah memeriksa
   sendiri dan menerima risikonya)

---

## Struktur Berkas

```
email-src/
├── templates.mjml.mjs           ← template bawaan (8 buah)
└── impor/
    ├── promo.html               ← HTML dari platform visual
    ├── promo.meta.json          ← subjek + variabel
    └── promo.mjml.mjs           ← hasil impor (jangan edit manual)
```

---

## Kenapa Pakai `<mj-raw>`, Bukan Konversi Penuh

Importer **tidak** mengonversi HTML menjadi struktur MJML
(`mj-section` → `mj-column` → `mj-text`). Alasannya:

Mengonversi berarti **menebak maksud desain** — dan tebakan itu sering salah:
- Dua kolom bisa jadi satu kolom bertumpuk
- Warna latar bisa hilang
- Jarak antar elemen bisa berubah

`<mj-raw>` meneruskan HTML apa adanya. Desainnya tetap **persis** seperti yang
Anda buat di platform visual.

**Konsekuensinya harus dikatakan jujur:** karena HTML diteruskan apa adanya,
kompatibilitasnya bergantung pada platform yang membuatnya — bukan pada MJML.
Karena itu `periksaHtml()` memeriksa hal-hal yang tidak bisa diperbaiki MJML
(flexbox, grid, skrip).

---

## Perintah Ringkas

```bash
# Impor desain dari email-src/impor/*.html
node scripts/impor-desain.mjs

# Kompilasi MJML → HTML
node scripts/build-email.mjs

# Lihat pratinjau
npm run email:preview

# Screenshot per template
npm run email:shot

# Uji
node --test backend/test/
```

---

## Contoh Lengkap

**Skenario:** buat email promo akhir tahun.

```bash
# 1. Desain di Stripo, sisipkan variabel [[${nama}]] dan [[${kode_promo}]]
# 2. Export HTML → simpan ke email-src/impor/promo.html

# 3. Buat meta
cat > email-src/impor/promo.meta.json << 'EOF'
{
  "subjek": "Promo khusus untuk {{nama}} — kode {{kode_promo}}",
  "judul": "Promo Akhir Tahun",
  "preheader": "Diskon 30% dengan kode {{kode_promo}}"
}
EOF

# 4. Impor
node scripts/impor-desain.mjs
#   ── promo ──
#   Variabel: kode_promo, nama
#   ✅ Aman — 12 tabel, tanpa flexbox/grid/skrip
#   ✅ Ditulis: email-src/impor/promo.mjml.mjs

# 5. Daftarkan + build
#    (edit email-src/templates.mjml.mjs, lalu:)
node scripts/build-email.mjs
```

Selesai — email promo siap dikirim lewat sistem yang sama, dengan variabel
terisi otomatis dan versi teks dibuat.
