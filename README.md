# Portfolio — Victer

Portofolio pribadi dengan sistem akses berlapis. Situs statis: HTML, CSS, dan
JavaScript murni tanpa build step.

**Live:** https://victerhong.github.io

---

## Struktur situs

```
/                           Beranda
/s/e7kz4swubfvg/            Halaman proyek MINA (kode acak, privat)
/s/zsvjp554dkt4/            Halaman proyek Spareparts (kode acak, privat)

/assets/css/main.css        Tampilan beranda
/assets/css/*.css           Modul tampilan (astra, bento, cinematic, dst)
/assets/js/app.js           Logika render beranda (DOM murni)
/assets/js/project.js       Halaman proyek + gerbang token
/assets/js/api.js           Klien layanan token
/assets/js/data/projects.js SATU sumber kebenaran untuk semua isi
/assets/narrative/*.mp4     Video narasi per proyek
/assets/hero.mp4            Video latar beranda (opsional)

/backend/                   Layanan token (Node murni + SQLite)
/docs/                      PRD dan panduan operasional

/favicon.svg                Ikon brand { • }
/manifest.json              Metadata aplikasi web
/robots.txt                 Panduan crawler
/sitemap.xml                Peta situs
/404.html                   Halaman error
/backend-url.json           Alamat backend (diperbarui otomatis oleh tunnel)
```

URL sengaja bersih: `/<slug>/` alih-alih `/<slug>/index.html`. Ini standar situs
korporat — lebih pendek, mudah diingat, dan lebih baik untuk mesin pencari.

## Lapisan akses

| Lapisan | Akses | Isi |
|---------|-------|-----|
| Publik | Gratis | Halaman utama, ringkasan proyek, kontak |
| Halaman proyek | Gratis | Masalah, sorotan publik, metrik yang bisa diverifikasi |
| Bagian terkunci | Token | Arsitektur, keputusan desain, metrik internal |
| Enterprise | Kontak sales | Multi-proyek, SLA, catatan audit |

Konten terkunci **tidak ada di repo ini**. Ia disimpan di server VPS dan hanya
dikirim setelah token lolos verifikasi. Panduan lengkap:
[docs/OPERASIONAL.md](docs/OPERASIONAL.md).

## Kenapa tanpa framework

Situs ini beberapa bagian teks dan satu video latar. React atau Vue akan
menambah ratusan kilobita untuk pekerjaan yang bisa diselesaikan puluhan baris
DOM. GitHub Pages menyajikan berkas statis apa adanya, jadi tidak ada langkah
build yang bisa rusak dan tidak ada dependensi yang bisa kedaluwarsa.

Backend token juga tanpa dependency: modul bawaan Node (`node:sqlite`,
`node:http`, `node:crypto`) cukup untuk seluruh pekerjaannya.

## Mengubah isi

Semua teks proyek ada di `assets/js/data/projects.js`. **Tidak ada yang perlu
diubah di `index.html` atau `app.js`** untuk menambah atau menyunting proyek.

Aturan yang dijaga di berkas itu: setiap angka harus bisa diverifikasi dengan
membuka repositori proyeknya. Portofolio yang menyebut "231 tes" harus bisa
dibuktikan.

Angka ringkas di bagian pembuka **dihitung** dari data proyek (`stats()`),
bukan diketik manual — jadi tidak bisa basi saat proyek baru ditambahkan.

## Menambah proyek baru

1. Tambahkan entri di `assets/js/data/projects.js` — termasuk `access_codes`
   (kode acak untuk URL) dan `slug` (kunci internal untuk API)
2. Buat folder `/s/<kode>/index.html` (salin dari `/s/e7kz4swubfvg/` sebagai
   contoh, sesuaikan slug proyeknya)
3. Jika ada video narasi, letakkan di `assets/narrative/` dan tambahkan
   slug-nya ke `AVAILABLE` di `assets/js/narrative.js`

Halaman proyek **tidak didaftarkan di `sitemap.xml`** — URL-nya berkode acak
dan bersifat privat.

## Merotasi kode proyek

Kode proyek bisa diganti kapan saja (mis. tautan lama tersebar terlalu luas,
atau pihak ketiga yang memegang tautan sudah tidak bekerja sama). Karena setiap
proyek menyimpan **daftar** kode (`access_codes`), tautan lama tetap bekerja
sampai sengaja dihapus.

```js
// assets/js/data/projects.js
access_codes: ['kode-baru-12karakter', 'kode-lama-1', 'kode-lama-2'],
//              ^ dipakai di tautan baru   ^ tetap bekerja untuk tautan lama
```

Langkah lengkap:

1. Buat kode baru, letakkan di **awal** array `access_codes`
2. Rename folder `s/<kode-lama>/` → `s/<kode-baru>/`
3. Buat folder redirect `s/<kode-lama>/index.html` (lihat contoh yang sudah
   ada — satu baris `location.replace`)
4. Tautan di beranda otomatis memakai `access_codes[0]`

Setelah tautan lama benar-benar tidak dipakai, hapus kodenya dari
`access_codes` dan hapus folder redirect-nya — tautan lama lalu berhenti
bekerja.

## Anchor section

Anchor di beranda memakai kode acak (`/#utqvwf`, bukan `/#work`) supaya nama
bagian tidak terlihat di URL. Peta kodenya:

```
zs6xae → atas (top)        utqvwf → proyek (work)
s6ahns → tentang (about)   5nfyzw → cara kerja (approach)
cckxsk → layanan (services) 89fk39 → kontak (contact)
```

Kalau mengubah anchor, perbarui tiga tempat: `id` di `index.html`, `href` di
navigasi, dan `assets/css/main.css` (navbar mobile menyembunyikan dua tautan
lewat selektor `href`).

## Video latar (opsional)

Letakkan berkas di `assets/hero.mp4`. Situs memeriksanya dengan `HEAD` saat
dimuat:

- **Ada dan bertipe `video/*`** → video diputar sebagai latar, memudar masuk perlahan.
- **Tidak ada** → gradien yang bergerak lambat tampil sebagai gantinya.

Tidak ada kotak hitam kosong dan tidak ada ikon "video rusak" di kedua kasus.
Video juga **tidak diputar** kalau pengunjung mengaktifkan "kurangi gerakan"
di sistemnya.

## Menjalankan lokal

ES module tidak bisa dimuat lewat `file://` (aturan CORS browser). Pakai server
lokal:

```bash
python3 -m http.server 8899
# buka http://localhost:8899
```

## Deploy

Repo ini disajikan GitHub Pages dari branch `main`, direktori akar.
`.nojekyll` ada supaya berkas dan folder yang diawali garis bawah tidak
diabaikan Jekyll.

```bash
git add -A && git commit -m "..." && git push
```

Perubahan tampil dalam ~1 menit.

## Aksesibilitas

- Setiap bagian punya `aria-labelledby`.
- Video latar `aria-hidden` — tidak dibacakan pembaca layar.
- `prefers-reduced-motion` mematikan animasi **dan** video; konten tetap terlihat penuh.
- Teks sekunder dijaga di atas rasio kontras yang layak terhadap latar gelap.
- Focus ring dirancang khusus, terlihat jelas saat navigasi keyboard.

## Mesin pencari

- `robots.txt` mengizinkan halaman publik, mengecualikan bagian terkunci dan
  berkas internal.
- `sitemap.xml` mendaftarkan halaman publik.
- Setiap halaman punya `canonical`, Open Graph, dan Twitter Card — tautan yang
  dibagikan ke WhatsApp, LinkedIn, atau X tampil rapi dengan judul, deskripsi,
  dan gambar pratinjau.
