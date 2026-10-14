# PRD — Area Klien: Daftar Proyek + Token Akses Berbasis Langganan

**Status:** Menunggu konfirmasi aturan kuota
**Tanggal:** 14 Oktober 2026
**Konteks:** Halaman area klien (setelah login), komponen daftar proyek dengan
tampilan List/Card/Pack, dan sistem kuota token akses per paket.

---

## Cara membaca dokumen ini

Aturan kuota di bawah saya tulis ulang dari penjelasan lisan. **Bagian yang saya
tidak yakin ditandai [PERLU KONFIRMASI]** — saya tidak mau membangun sistem
pembatasan akses di atas tebakan.

Tanda:
- **[JELAS]** — sudah jelas dari penjelasan, tidak perlu ditanyakan
- **[PERLU KONFIRMASI]** — saya menafsirkan; mohon dikoreksi kalau salah
- **[USULAN]** — saya tambahkan sendiri karena ada celah yang belum dibahas

---

## 1. Ringkasan fitur

Tiga hal yang dibangun:

1. **Halaman area klien** (`/proyek`) — muncul setelah login. Daftar proyek
   dengan tiga tampilan: List, Card, Pack.
2. **Sistem star → trial** — pengunjung yang memberi star di repo GitHub
   portofolio mendapat akses 1× melihat data metrik.
3. **Kuota token akses per paket** — Standar dan Profesional bisa membuat token
   sendiri dengan batas bulanan; Enterprise tanpa batas praktis.

---

## 2. Aturan akses — yang saya pahami

### 2.1 Tingkatan akses

| | Pengunjung (belum login) | Login gratis | Standar | Profesional | Enterprise |
|---|---|---|---|---|---|
| Lihat daftar proyek | ya (publik) | ya | ya | ya | ya |
| Lihat data metrik | **tidak** | **1× saja** (setelah star) | ya | ya | ya |
| Buat token akses | tidak | **tidak** | 1×/bulan | 5×/bulan | [PERLU KONFIRMASI] |
| Baca kode sumber | tidak | tidak | tidak | ya | ya |

### 2.2 Aturan star → trial

**[JELAS]** dari penjelasan:
- Pengunjung **wajib** memberi star di repo GitHub portofolio untuk dapat trial
- Star itu memberi **1× kesempatan** melihat data metrik
- Hanya **bisa dibaca 1 kali** — bukan akses berulang
- Bonus star **berlaku untuk semua paket**: Standar, Profesional, Enterprise
  masing-masing dapat 1× tambahan

**[PERLU KONFIRMASI]** — tiga hal yang belum jelas:

**A. Bagaimana star diverifikasi?**
Tiga pilihan:
1. **Cek lewat GitHub API** — pengunjung login pakai akun GitHub, sistem cek
   apakah dia benar-benar memberi star. Paling aman, tapi butuh OAuth GitHub.
2. **Klik tombol "Saya sudah star"** — tanpa verifikasi. Siapa pun bisa klaim.
3. **Cek manual oleh Anda** — pengunjung klaim, Anda verifikasi lewat email.

Saya **menyarankan pilihan 1** kalau tujuannya mencegah penyalahgunaan. Tapi
kalau tujuannya sekadar menghargai niat baik, pilihan 2 sudah cukup.

**B. "Hanya bisa terbaca 1" — apa yang dibatasi?**
- Apakah 1× per **proyek**, atau 1× per **akun**?
  Contoh: pengunjung buka MINA (metrik terbuka), lalu buka Spareparts —
  apakah Spareparts ikut terbuka, atau perlu star lagi?

**C. Kalau pengunjung sudah punya langganan, apakah trial star masih berguna?**
Contoh: pelanggan Standar (yang sudah bisa lihat metrik) memberi star — bonus
1×-nya jadi apa? Beberapa kemungkinan:
- Bonus jadi 1 token akses tambahan (2 total bulan itu)
- Bonus jadi sia-sia (sudah punya akses)
- Bonus jadi 1× lihat metrik proyek yang belum dia langgani

### 2.3 Aturan kuota token

**[JELAS]** dari penjelasan:

| Paket | Token per bulan | 12 bulan |
|---|---|---|
| Standar | 1× | 12 |
| Profesional | 5× | 60 |
| Enterprise | [PERLU KONFIRMASI] | — |
| Gratis | **0** | 0 |

**[PERLU KONFIRMASI]** — tiga hal:

**D. Enterprise berapa?**
Penjelasan menyebut "buat profesional" untuk yang Enterprise, tapi tidak
menyebut angkanya. Pilihan: 10×/bulan, tanpa batas, atau sesuai kesepakatan.

**E. Bonus star menambah kuota — bagaimana hitungannya?**
Penjelasan: *"kalo standar ngestar itu 1x jadi dapat 1 lagi jadi 2"*.

Yang saya pahami: Standar dapat 1 token/bulan, **ditambah** 1 dari bonus star =
2 token di bulan itu. Yang perlu dikonfirmasi:
- Bonus berlaku **sekali seumur akun**, atau **setiap bulan**?
- Kalau bulan ini tidak dipakai, apakah hangus atau menumpuk?

**F. Token yang dibuat berlaku berapa lama?**
Sistem yang ada sekarang punya masa berlaku token. Kalau kuota bulanan habis,
apakah token lama tetap hidup, atau ikut mati?

---

## 3. Yang perlu dibangun

### 3.1 Basis data (migrasi baru)

Tabel baru:

```
subscriptions       -- langganan aktif per akun
  id, user_id, tier, periode, mulai_at, selesai_at, status

token_quota         -- pemakaian kuota per bulan
  id, user_id, bulan (YYYY-MM), tier, kuota_dasar,
  bonus_star, terpakai, updated_at

star_bonus          -- catatan bonus dari star
  id, user_id, tier, sumber (github|klaim),
  github_username, diberikan_at, dipakai_at

metric_views        -- trial 1× lihat metrik
  id, user_id, project_slug, dibuka_at, ip, user_agent
```

**[USULAN]** Saya tambahkan `metric_views` karena aturan "hanya bisa terbaca 1"
perlu dicatat per proyek — kalau tidak, tidak ada cara tahu mana yang sudah
dibuka.

### 3.2 Endpoint API

```
GET  /api/proyek                    -- daftar proyek + status akses per user
GET  /api/proyek/:slug/metrik       -- data metrik (dengan pemeriksaan akses)
POST /api/token/buat                -- buat token (cek kuota bulanan)
GET  /api/token/daftar              -- token milik user
POST /api/star/klaim                -- klaim bonus star
GET  /api/langganan/saya            -- status langganan + sisa kuota
```

### 3.3 Halaman area klien

`/proyek` — memuat:
- Daftar proyek (dari `assets/js/data/projects.js`, satu sumber)
- Tiga tampilan: List / Card / Pack (port dari komponen 21st.dev)
- Tab "Token Akses" — buat + lihat token, dengan penghitung kuota
- Penanda status: mana yang terbuka, mana yang terkunci

### 3.4 Port komponen (nol dependency)

Komponen aslinya React + Tailwind + motion + hugeicons. Saya port ke vanilla
CSS + JS, sama seperti How It Works dan kartu zigzag Visi & Misi.

**Yang dipertahankan:**
- Tiga tampilan dengan transisi halus antar tampilan
- Susunan "pack" (kartu bertumpuk dengan rotasi)
- Label + nomor di tiap item

**Yang diubah:**
- Warna mengikuti aksen situs (emas), bukan `--primary` Tailwind
- Ikon: pakai `assets/js/icons.js` yang sudah ada (30 ikon SVG), bukan
  hugeicons (148 MB)
- Isi: proyek Anda (MINA, Spareparts, WhatsApp bot), bukan galeri foto

---

## 4. Yang TIDAK dibangun

- **Pembayaran otomatis** — sistem langganan butuh webhook Midtrans. Itu
  pekerjaan terpisah dan lebih besar.
- **OAuth GitHub** — kecuali Anda memilih opsi A di bagian 2.2.
- **Panel admin untuk mengelola langganan** — sementara lewat `admin-cli.mjs`.

---

## 5. Kriteria selesai

- [ ] Pengunjung tanpa login: daftar proyek terlihat, metrik terkunci
- [ ] Login gratis: bisa klaim star, dapat 1× buka metrik
- [ ] Standar: 1 token/bulan, metrik terbuka
- [ ] Profesional: 5 token/bulan
- [ ] Enterprise: sesuai jawaban D
- [ ] Bonus star menambah kuota sesuai jawaban E
- [ ] Kuota tidak bisa dilampaui (ditegakkan di server, bukan hanya UI)
- [ ] Tiga tampilan (List/Card/Pack) berfungsi di 320px sampai 1440px
- [ ] Nol dependency baru — masuk anggaran 2048 KB
- [ ] Preflight bersih · 436 tes backend lulus
- [ ] Reduced motion dihormati
- [ ] Tanpa JS: daftar proyek tetap terbaca

---

## 6. Risiko

**Kuota bisa dibobol kalau hanya dijaga di UI.** Semua pemeriksaan kuota harus
di server. UI hanya menampilkan sisa.

**Bonus star rawan disalahgunakan.** Kalau tidak diverifikasi, satu orang bisa
membuat banyak akun dan mengklaim star berkali-kali. Mitigasi tergantung
jawaban A.

**Anggaran 2048 KB masih terbatas.** Halaman area klien + tiga tampilan + tab
token akan menambah CSS dan JS. Saya akan ukur setelah dibangun; kalau lewat,
saya laporkan sebelum deploy (preflight akan menolak).

**Data metrik sensitif.** Halaman metrik sudah ada sistem gemboknya. Yang baru
adalah pemeriksaan TIER — pastikan tidak ada jalur yang melewatinya.
