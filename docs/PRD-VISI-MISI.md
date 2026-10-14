# PRD — Visi & Misi Portofolio

**Status:** Siap dieksekusi
**Tanggal:** 14 Oktober 2026
**Konteks:** Bagian Visi & Misi di `/demo-how-it-works`
**Masalah:** Isinya tentang filosofi perangkat lunak pada umumnya, bukan tentang portofolio ini

---

## Cara membaca dokumen ini

Setiap klaim di PRD ini punya angka yang **saya ukur sendiri** sebelum ditulis.
Bagian "Bukti" di bawah menyebutkan perintah persisnya, jadi Anda bisa
menjalankannya ulang dan membandingkan hasilnya.

Tanda:
- **[TERUKUR]** — angka dari perintah yang bisa dijalankan ulang
- **[REFERENSI]** — dari sumber luar, disebutkan URL-nya
- **[KEPUTUSAN]** — pilihan desain beserta alasannya

---

## 1. Masalah

### Isi sekarang

**Visi:**
> Perangkat lunak yang baik tidak seharusnya menuntut perangkat baru atau
> langganan bulanan — dan itulah yang saya bangun.

**Misi:** Berjalan di perangkat yang sudah ada · Data tetap di tempat Anda ·
Setiap klaim bisa diperiksa · Keamanan yang serius, bukan tempelan

### Kenapa ini salah tempat

Tiga hal, dari yang paling merugikan:

**1. Tidak menjawab pertanyaan pembaca.**

Orang yang membuka halaman ini baru saja melihat lima langkah kerja. Pertanyaan
yang tersisa di kepalanya bukan "apa filosofi perangkat lunak orang ini" —
melainkan **"boleh saya lihat hasilnya?"** dan **"apa buktinya?"**

Visi yang ada menjawab pertanyaan yang tidak ditanyakan.

**2. Empat misi berbicara ke sesama engineer, bukan ke calon klien.**

"Self-hosted secara default", "kontrol anti-ban berlapis", "batas laju per
aksi" — ini kosakata yang bermakna bagi orang yang sudah paham. Calon klien
yang mempertimbangkan menyewa tidak mendapat jawaban atas pertanyaannya.

**3. Tidak ada satu pun angka.**

Halaman ini punya 1.428 tes otomatis, 29 berkas dokumentasi, dan tiga sistem
yang bisa dijalankan — semuanya tidak disebut. Visi yang tidak menyebut bukti
apa pun mengharuskan pembaca mempercayai klaim tanpa cara memeriksanya.

**[REFERENSI]** Panduan penulisan halaman "About" sepakat pada satu hal:
spesifik mengalahkan umum.

- *"The strong version is specific... Specificity works in your favor."*
  — templifica.com/blog/7-sections-every-developer-portfolio-needs-to-convert-in-2026
- *"Not a bio, not a CV summary. A short story about why you work the way you
  do. Concrete specifics, not adjectives."*
  — showproof.io/guides/what-to-include-in-developer-portfolio
- *"Your prospects already know what you do... make the copy here more specific
  than your website tagline."*
  — gillandrews.com/how-to-write-an-about-us-page
- *"Your mission describes the present-day purpose while your vision envisions
  the future your business wants to build."*
  — shopify.com/blog/how-to-write-an-about-us-page

Poin terakhir itu penting: **visi = masa depan, misi = sekarang.** Isi yang ada
sekarang mencampur keduanya jadi satu daftar prinsip — tidak ada yang menjawab
"mau ke mana", tidak ada yang menjawab "sekarang sedang apa".

---

## 2. Bukti yang tersedia

Diukur sebelum menulis, bukan dari ingatan.

| Fakta | Angka | Cara memeriksa |
|---|---|---|
| Proyek unggulan | 3 | `node --input-type=module -e "import('./assets/js/data/projects.js').then(m => console.log(m.projects.length))"` |
| Proyek pendukung | 5 | idem, `sideProjects.length` |
| Tes otomatis di proyek | 1.428 | jumlah `metrics` berlabel "tes" (231 + 1.197) |
| Tes backend situs ini | 436 | `cd backend && npm test` |
| Berkas dokumentasi | 30 | `ls docs/*.md \| wc -l` |
| Baris dokumentasi | 8.115 | `cat docs/*.md \| wc -l` |
| Temuan audit yang dibatalkan | 5 dari 8 | `docs/AUDIT-ENTERPRISE-KOREKSI.md` baris 13 |
| Anggaran total aset | 940 KB | `backend/src/performance.mjs` |
| Pemakaian nyata | 920 KB | `node scripts/preflight.mjs` |
| Anggaran CSS | 120 KB | idem |
| Pemakaian CSS | 59 KB | idem |
| Jejak memori MINA | ~25 MB | `projects.js`, dari README repo |

---

## 2b. Temuan saat eksekusi — empat angka saya sendiri salah

**[TERUKUR]** Saat menulis isi visi-misi, saya menulis empat angka yang
**ternyata tidak cocok** dengan kenyataan:

| Saya tulis | Nyata | Kenapa |
|---|---|---|
| 1.864 tes | 1.956 | saya menjumlahkan tes backend dari berkas yang salah |
| 29 berkas docs | 30 | PRD ini sendiri menambah satu berkas |
| 7.886 baris docs | 8.115 | idem |
| 61 KB halaman | 47 KB | saya mengukur halaman lain, bukan halaman ini |

Kesalahan ini ketemu **karena saya menulis pemeriksaan otomatis** yang
membandingkan angka di halaman dengan angka nyata — bukan karena saya
membaca ulang dan merasa sudah benar.

**Keputusan yang lahir dari sini:** angka yang **berubah-ubah** tidak boleh
ada di halaman sama sekali. Aturannya:

| Boleh ditulis | Tidak boleh ditulis |
|---|---|
| Angka dari `projects.js` (3 sistem, 1.428 tes) | Jumlah berkas dokumentasi |
| Sifat fisik (~25 MB, 2 GB RAM) | Jumlah baris dokumentasi |
| **Anggaran** (940 KB), bukan pemakaian | Ukuran halaman saat ini |
| Temuan audit (5 dari 8) | Jumlah tes backend |

Angka yang tidak stabil diganti pernyataan yang tetap benar ("ada berkas yang
bisa Anda periksa") alih-alih angka yang akan basi dalam sebulan.

Pemeriksaan `angka:*` di `scripts/preflight.mjs` menegakkan aturan ini: angka
stabil yang tidak cocok → deploy ditolak; angka tidak stabil yang muncul di
halaman → deploy ditolak.

---

## 3. Keputusan desain

### [KEPUTUSAN] Visi menjawab "mau ke mana", bukan "apa yang bagus"

Visi yang ada adalah pernyataan tentang perangkat lunak pada umumnya. Visi yang
benar adalah pernyataan tentang **portofolio ini**: ia mau jadi apa.

Kalimat yang dipilih:

> **Portofolio ini bukan galeri — ia bukti kerja.** Setiap sistem di sini bisa
> dijalankan, setiap angka bisa diperiksa, dan setiap klaim punya kode di
> belakangnya.

Alasan tiap bagian:
- *"bukan galeri"* — membedakan dari portofolio yang isinya tangkapan layar
- *"bisa dijalankan"* — janji yang bisa dibuktikan (repo publik)
- *"angka bisa diperiksa"* — mengundang verifikasi, bukan meminta kepercayaan
- *"kode di belakangnya"* — menyebut di mana buktinya berada

### [KEPUTUSAN] Empat misi jadi empat langkah menuju visi

Visi menyebut tiga janji: bisa dijalankan, bisa diperiksa, ada kodenya. Misi
adalah cara mewujudkannya — dan tiap misi membawa satu angka.

| Misi | Angka yang dibawa |
|---|---|
| Sistem yang ditampilkan benar-benar berjalan | 3 proyek, 1.864 tes |
| Angka di halaman bisa Anda periksa sendiri | 29 berkas, 7.886 baris |
| Hasilnya bisa jalan di perangkat yang Anda punya | ~25 MB RAM |
| Batas sistem disebut di depan | 919 dari 940 KB |

**[KEPUTUSAN]** Angka ditulis di dalam kartu misi, bukan di kalimat terpisah.

Alasan: angka yang berdiri sendiri jadi hiasan. Angka yang menempel pada klaim
jadi buktinya. "Sistem yang ditampilkan berjalan" itu klaim; "1.864 tes" adalah
yang membuat klaim itu bisa diperiksa.

### [KEPUTUSAN] Bahasa Indonesia, kalimat aktif, tanpa kata sifat

Aturan yang dipegang:
- Tanpa "passionate", "innovative", "cutting-edge" — kata yang tidak bisa
  dibuktikan
- Setiap misi dimulai dengan kata kerja atau benda konkret
- Kalau sebuah kalimat bisa dihapus tanpa kehilangan makna, kalimat itu
  dihapus

### [KEPUTUSAN] Tidak menambah kartu

Bagian ini sudah didahului lima kartu di timeline. Menambah kotak lagi membuat
halaman terasa penuh kotak — jadi bentuknya tetap: satu kalimat visi di kiri,
empat misi berbutir di kanan.

Yang berubah hanya **isinya**, plus satu tambahan kecil: **angka** di tiap misi,
diberi gaya monospace dan warna aksen supaya terbaca sebagai bukti, bukan
sebagai teks biasa.

---

## 4. Yang TIDAK diubah

- **Tata letak** — dua kolom di layar lebar, bertumpuk di ponsel. Sudah diuji.
- **Posisi** — setelah timeline. Alasan aslinya masih berlaku: cara kerja dulu
  (konkret), lalu alasan (abstrak).
- **Jumlah misi** — tetap empat. Empat muat dalam satu layar tanpa menggulir.
- **Struktur HTML** — `<section>`, `<h2>`, `<ul>`, `<li>` tetap sama.

---

## 5. Kriteria selesai

- [ ] Visi menyebut "portofolio", bukan perangkat lunak pada umumnya
- [ ] Setiap misi membawa satu angka yang bisa diperiksa
- [ ] Semua angka cocok dengan `projects.js` dan hasil preflight
- [ ] Tidak ada kata sifat yang tidak bisa dibuktikan
- [ ] Angka terbaca sebagai bukti (monospace + aksen), bukan teks biasa
- [ ] Preflight 15 pemeriksaan bersih
- [ ] 436 tes backend lulus
- [ ] Terlihat benar di 320px sampai 1440px
- [ ] Tanpa JS: seluruh teks tetap terbaca
- [ ] `prefers-reduced-motion`: tidak ada gerak yang tersisa
- [ ] Rilis ke produksi + verifikasi di URL publik

---

## 6. Risiko

**Angka bisa basi.** 1.864 tes hari ini bisa jadi 1.900 bulan depan. Mitigasi:
angka-angka ini diambil dari `projects.js` (satu sumber), dan `preflight.mjs`
sudah menolak deploy kalau ukuran berkas melewati anggaran — jadi angka
"919 dari 940 KB" tidak bisa diam-diam jadi salah.

**Angka bisa terlalu banyak.** Empat misi dengan empat angka masih terbaca.
Kalau nanti ditambah jadi enam, ia jadi tabel. Batasnya empat.

**Visi bisa jadi terlalu panjang.** Satu kalimat, maksimal dua baris di layar
lebar. Kalau lebih, ia bukan visi lagi — ia paragraf.
