# Portfolio — Victer

Portofolio pribadi. Situs statis: HTML, CSS, dan JavaScript murni tanpa build step.

**Live:** https://victerhong.github.io

## Kenapa tanpa framework

Situs ini beberapa bagian teks dan satu video latar. React atau Vue akan menambah
ratusan kilobita untuk pekerjaan yang bisa diselesaikan puluhan baris DOM. GitHub Pages
menyajikan berkas statis apa adanya, jadi tidak ada langkah build yang bisa rusak dan
tidak ada dependensi yang bisa kedaluwarsa.

## Struktur

```
index.html              halaman tunggal
styles.css              seluruh tampilan
src/app.js              logika render (DOM murni)
src/data/projects.js    SATU sumber kebenaran untuk semua isi
assets/hero.mp4         video latar (opsional — lihat di bawah)
```

## Mengubah isi

Semua teks proyek ada di `src/data/projects.js`. **Tidak ada yang perlu diubah di
`index.html` atau `app.js`** untuk menambah atau menyunting proyek.

Aturan yang dijaga di berkas itu: setiap angka harus bisa diverifikasi dengan membuka
repositori proyeknya. Portofolio yang menyebut "231 tes" harus bisa dibuktikan.

Angka ringkas di bagian pembuka **dihitung** dari data proyek (`stats()`), bukan diketik
manual — jadi tidak bisa basi saat proyek baru ditambahkan.

## Video latar (opsional)

Letakkan berkas di `assets/hero.mp4`. Situs memeriksanya dengan `HEAD` saat dimuat:

- **Ada dan bertipe `video/*`** → video diputar sebagai latar, memudar masuk perlahan.
- **Tidak ada** → gradien yang bergerak lambat tampil sebagai gantinya.

Tidak ada kotak hitam kosong dan tidak ada ikon "video rusak" di kedua kasus. Video juga
**tidak diputar** kalau pengunjung mengaktifkan "kurangi gerakan" di sistemnya.

## Menjalankan lokal

ES module tidak bisa dimuat lewat `file://` (aturan CORS browser). Pakai server lokal:

```bash
python3 -m http.server 8899
# buka http://localhost:8899
```

## Deploy

Repo ini disajikan GitHub Pages dari branch `main`, direktori akar. `.nojekyll` ada
supaya berkas dan folder yang diawali garis bawah tidak diabaikan Jekyll.

```bash
git add -A && git commit -m "..." && git push
```

Perubahan tampil dalam ~1 menit.

## Aksesibilitas

- Setiap bagian punya `aria-labelledby`.
- Video latar `aria-hidden` — tidak dibacakan pembaca layar.
- `prefers-reduced-motion` mematikan animasi **dan** video; konten tetap terlihat penuh.
- Teks sekunder dijaga di atas rasio kontras yang layak terhadap latar gelap.
