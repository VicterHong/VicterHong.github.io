# Portfolio — Victer

Portofolio pribadi dengan sistem akses berlapis. Situs statis: HTML, CSS, dan
JavaScript murni tanpa build step.

**Live:** https://victerhong.github.io

---

## Struktur situs

```
/                           Beranda
/s/                         Halaman proyek (kode acak, privat)
/s/                         Halaman proyek (kode acak, privat)

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

1. Tambahkan entri di `assets/js/data/projects.js`
2. Buat folder `/<slug>/index.html` (salin dari `mina/index.html` sebagai
   contoh, sesuaikan `data-project` dan slug)
3. Tambahkan URL-nya ke `sitemap.xml`
4. Jika ada video narasi, letakkan di `assets/narrative/` dan tambahkan
   slug-nya ke `AVAILABLE` di `assets/js/narrative.js`

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
