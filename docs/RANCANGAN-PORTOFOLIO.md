# RANCANGAN PORTOFOLIO VICTER — Ringkasan dari Awal sampai Akhir

**Dokumen ini** merangkum perjalanan proyek dari commit pertama sampai hari ini:
apa yang dibangun, kenapa begitu, dan apa yang belum selesai.

**Dibuat:** dari pembacaan 215 commit + 37 modul backend + seluruh riwayat sesi.
**Status proyek:** live di produksi.

---

## 1. APA INI

Portofolio pribadi yang berkembang menjadi **showcase teknis bertingkat**.

```
Lapisan luar  → publik, ringan, seperti portofolio biasa
Lapisan dalam → terkunci token, berisi arsitektur & repo privat
Lapisan atas  → enterprise, kontrak & SLA
```

**Live:**
- https://victerhong.github.io → 301 → https://portfolio-victer.pages.dev
- Repo: https://github.com/VicterHong/VicterHong.github.io

**Satu kalimat:** portofolio yang membuktikan kemampuan rekayasa — bukan template yang
mengaku-ngaku.

---

## 2. MASALAH YANG DISELESAIKAN

Portofolio developer biasanya seragam: grid kartu identik, "passionate developer",
gradien ungu-biru, tanpa bukti apa pun.

Akibatnya:
- **Pembaca tidak punya alasan percaya** — semua klaim tanpa verifikasi
- **Tidak membedakan pemiliknya** dari ribuan portofolio lain
- **Tidak bisa menghasilkan** — tidak ada jalan dari "melihat" ke "membeli"

Pendekatannya berbeda:
1. Setiap angka **bisa diperiksa** dengan membuka repositorinya
2. Satu proyek unggulan dapat ruang terbesar — bukan grid yang menyamakan semuanya
3. Ada **jalur nyata** dari pengunjung → token → kontrak

---

## 3. PERJALANAN — 5 FASE

### Fase 1 — Portofolio dasar (commit 1–30)

```
eeb33e0  portofolio awal: HTML/CSS/JS murni, data dari repo nyata
d103d40  PRD v1.0
c53e01b  hero video (MP4 + WebM)
```

**Yang dibangun:** satu halaman, tanpa build step, tanpa framework. Semua isi dari
`assets/js/data/projects.js` — satu sumber kebenaran.

**Keputusan penting:** isi diambil dari repo GitHub yang **benar-benar ada**. Tidak ada
proyek karangan, tidak ada angka yang dibulatkan ke atas. Portofolio yang menyebut
"231 tes" harus bisa dibuktikan dengan membuka reponya.

---

### Fase 2 — Monetisasi & keamanan akses (commit 31–80)

```
bf289ba  sistem token akses proyek — backend, halaman terkunci, form sales
90a0cb8  token format VP-XXXX, tier, session cookie, watermark
fb0611a  device fingerprint detection
18d4c35  analytics funnel
a120777  lead automation — webhook notifications
0bd6108  security hardening — audit Fable 5.1
22183fb  enterprise package — SLA + audit export
251ffd9  admin dashboard web
```

**Yang dibangun:** sistem token lengkap — terbitkan, cabut, tangguhkan, audit.

**Keputusan penting:** token **diterbitkan pemilik**, bukan self-service. Tidak ada tombol
"beli" di halaman publik. Ini yang membuatnya terasa enterprise, bukan toko.

**Perlindungan berlapis:**
```
Token format     : VP-XXXX-XXXX-XXXX
Watermark        : per-pengunjung, terlihat di konten terkunci
Fingerprint      : deteksi perangkat
Auto-revoke      : saat terdeteksi penyalahgunaan
Audit log        : setiap kejadian tercatat
```

---

### Fase 3 — Turnstile & gerbang keamanan (commit 81–120)

```
815ab13  Cloudflare Turnstile — CAPTCHA tanpa geser
3ef821a  setup Cloudflare profesional — wrangler, workers, config
1724ccb  full edge deployment — Pages + Workers + R2
dff62a3  Turnstile gate untuk semua halaman
41d05a0  interstitial Cloudflare persis (interaction-only)
```

**Yang dibangun:** gerbang verifikasi di semua halaman, dengan tampilan seperti
Cloudflare asli.

**Masalah yang muncul berantai:**
- Widget menggantung → timeout token + tombol coba lagi
- Loop "Berhasil!" stuck → masa tenggang + perbaikan state
- Clearance pakai IP → **tidak andal** di rantai 4 hop → ganti ke nonce acak
- Cookie clearance → dipindah ke HttpOnly bertanda tangan server

**Pelajaran:** IP tidak bisa diandalkan untuk mengikat sesi saat ada banyak hop proxy.
Cloudflare menimpa `CF-Connecting-IP` di setiap hop. Yang bertahan hanya header kustom —
dan itupun terukur tetap berisi IP Cloudflare di backend.

---

### Fase 4 — Desain premium & audit (commit 121–180)

```
5b6714c  efek depth tingkat Framer/Awwwards — scroll-stand, tilt, glare
16f014c  particles Three.js + custom video player + masonry
c5aed5c  8 modul produksi — CMS, Performance, Collaborate, Grow, SEO, AEO
d822467  hilangkan semua emoji — ganti ikon SVG
8be7278  audit keamanan oleh Opus 5.5 (8 temuan)
4631cde  PRD perbaikan keamanan — 9 FIX
ae54d3d  PRD perbaikan desain dari audit GPT-6 Luna
```

**Yang dibangun:** efek visual tingkat award-site, tapi tetap di bawah anggaran byte.

**Dua audit besar:**
```
Audit keamanan (Opus 5.5) → 8 temuan → 9 FIX
Audit desain (GPT-6 Luna) → beberapa batch perbaikan
```

**9 FIX keamanan:**
```
FIX-01  proses tidak mati karena satu request
FIX-02  router aman terhadap decode & path traversal
FIX-03  batasi /api/admin/* ke loopback
FIX-04  jangan bocorkan pesan error internal
FIX-05  normalisasi IP + hapus fallback X-Forwarded-For
FIX-06  rate limit default + cache /api/ready
FIX-07  perbandingan kunci admin yang benar
FIX-08  Turnstile fail-closed + validasi hostname/action
FIX-09  verifikasi IP audit
```

**Perbaikan desain:**
- Target sentuh 44px di **semua** viewport (WCAG 2.5.5)
- `prefers-reduced-motion` menyeluruh
- Jarak docs mobile 103px → 63px (media query bertabrakan)
- Nav aktif + scroll-spy

---

### Fase 5 — Premium & produksi (commit 181–215)

```
8cd243f  aksen kuning premium #f5c542
ba80d75  carousel spotlight — galeri proyek dengan kartu melengkung
7ef319a  gambar galeri dari R2 + skeleton + ikon korporat
be9ecd8  proxy pakai Pages Function, bukan _redirects
ddd4239  halaman masuk premium — 3D tilt, blob, partikel, TOTP, passkey
b51121d  modul TOTP — RFC 6238 dari nol, nol dependensi
5cf13cd  2FA end-to-end — enrollment, verifikasi, kode pemulihan
8e86871  7 endpoint 2FA + integrasi gerbang login
63e8b65  halaman harga dengan data dari backend + skeleton
```

**Yang dibangun:**
- Galeri spotlight dengan spring physics (menyelesaikan 10+ bug berantai)
- Halaman login premium
- **2FA dari nol** — TOTP RFC 6238 tanpa dependensi
- Halaman harga dengan data dari backend

**Keputusan penting — harga di backend:**
```
SEBELUM: harga di HTML → harus diubah di setiap halaman
SESUDAH: backend/src/pricing.mjs → satu sumber kebenaran
```

Frontend memuat `/api/pricing` dan menggambar hasilnya. Halaman harga **tidak berisi
satu angka pun**. Skeleton loader menghilangkan layout shift.

---

## 4. ARSITEKTUR SEKARANG

### Struktur berkas

```
portfolio-victer/
├── index.html           halaman depan (redirect/landing)
├── home.html            halaman utama portofolio
├── docs.html            panduan penggunaan
├── pricing.html         halaman harga
├── masuk.html           login
├── daftar.html          pendaftaran
├── 404.html             halaman error
│
├── assets/
│   ├── css/   (27 berkas)  — sumber, diminifikasi saat build
│   └── js/    (30+ modul)  — ES modules, tanpa framework
│
├── backend/
│   ├── src/   (37 modul)   — API, token, auth, 2FA, pricing
│   └── test/  (15 berkas)  — uji otomatis
│
├── scripts/   (24 skrip)   — build, preflight, audit, deploy
│
├── functions/[[path]].js   — Pages Function: proxy /api & /media
├── workers/site.ts         — Worker edge: teruskan ke backend
└── docs/      (21 dokumen) — PRD, audit, operasional
```

### Rantai permintaan

```
Pengunjung
   ↓
Cloudflare Pages (portfolio-victer.pages.dev)
   ↓ functions/[[path]].js — proxy
Cloudflare Worker (portfolio-victer.victerphanjaya.workers.dev)
   ↓ workers/site.ts — teruskan
Tunnel → Backend Node (localhost:8788)
   ↓
SQLite + R2
```

**Kenapa proxy, bukan fetch langsung:** fetch dari pages.dev ke workers.dev = lintas origin.
Butuh CORS benar, cookie SameSite=None, dua kali DNS+TLS. Dengan proxy semuanya **satu
origin** dari sudut browser.

### 80 rute API

```
Publik    : /api/health, /api/ready, /api/config, /api/pricing
Token     : /api/token/validate, /session, /logout, /2fa/*
Auth      : /api/auth/daftar, /masuk, /2fa, /lupa-sandi, /reset-sandi
Konten    : /api/project/:slug/locked
Form      : /api/contact/sales
Admin     : /api/admin/* (dibatasi loopback + kunci)
```

---

## 5. KEPUTUSAN DESAIN YANG DIPERTAHANKAN

| Keputusan | Alasan |
|---|---|
| **Tanpa framework** | React/Vue menambah ratusan KB untuk pekerjaan puluhan baris |
| **Tanpa build step (untuk isi)** | Tidak ada dependensi yang bisa kedaluwarsa |
| **Satu sumber data** | Tambah proyek = sunting 1 berkas |
| **Angka bisa diverifikasi** | Setiap klaim punya tautan repo yang membuktikannya |
| **Tanpa emoji sebagai ikon** | Semua SVG inline — konsisten di semua perangkat |
| **Harga di backend** | Satu sumber kebenaran, tidak bisa berbeda antar halaman |
| **Token diterbitkan manual** | Tidak ada tombol beli — yang membuatnya terasa enterprise |
| **Aksen kuning #f5c542** | Bukan oranye, bukan ungu-biru (menghindari "AI slop") |

---

## 6. ANGGARAN PERFORMA

Preflight memeriksa sebelum deploy — **deploy dibatalkan kalau gagal**.

```
Total       : 688 KB / 900 KB   ✅
JS per hal. : 102 KB / 250 KB   ✅
CSS per hal.:  63 KB / 120 KB   ✅
HTML per hal:  11 KB /  90 KB   ✅
```

**15 pemeriksaan preflight:** berkas wajib, anggaran performa, pemindaian rahasia,
SEO/AEO (JSON-LD, canonical, Open Graph).

**Pelajaran yang ditemukan:** anggaran HTML dulu diukur sebagai **total semua halaman**,
padahal CSS/JS diukur **per halaman**. Pengunjung hanya mengunduh satu halaman — jadi
setiap halaman baru selalu "melanggar" anggaran. Sudah diseragamkan jadi per-halaman.

Juga: daftar halaman yang diaudit dulu **hardcoded** — halaman baru tidak pernah diperiksa.
Sekarang dideteksi otomatis.

---

## 7. YANG SUDAH SELESAI

```
✅ Portofolio publik dengan data nyata dari repo
✅ Sistem token akses (terbit, cabut, tangguh, audit)
✅ 9 FIX keamanan dari audit Opus 5.5
✅ Turnstile gate di semua halaman
✅ 2FA dari nol (TOTP RFC 6238, nol dependensi)
✅ Halaman login & daftar
✅ Halaman harga dengan data dari backend
✅ Galeri spotlight dengan spring physics
✅ Admin dashboard (11 tab)
✅ Preflight 15 pemeriksaan
✅ Deploy otomatis: GitHub Pages + Cloudflare Pages
✅ 2FA end-to-end dengan kode pemulihan
```

---

## 8. YANG BELUM SELESAI

| # | Item | Status | Catatan |
|---|------|--------|---------|
| 1 | **Harga final** | ⏳ Menunggu | Rp 149rb / Rp 399rb masih asumsi |
| 2 | **Halaman kontak khusus** | ⏳ | Tombol masih ke `/#89fk39` (bagian home) |
| 3 | **Perbandingan paket** | 🔄 Baru dipindah | Dari pricing.html ke docs.html |
| 4 | **Domain kustom** | ⛔ Tidak dipakai | Alasan Terms of Service |
| 5 | **Versi bahasa Inggris** | ⏳ | Sekarang hanya Bahasa Indonesia |
| 6 | **Halaman detail per proyek** | ⏳ | Semua masih di satu halaman |

---

## 9. RISIKO & CATATAN

**Ketergantungan pada tunnel.** Backend berjalan lokal, diakses lewat Cloudflare Tunnel.
Kalau tunnel mati, `/api/*` mati — halaman harga tidak bisa memuat. Skeleton akan
berputar lalu muncul pesan error dengan tombol coba lagi.

**Token di URL.** Token akses dikirim lewat URL `/s/<kode>/`. URL bisa tersimpan di
riwayat browser atau terkirim ke orang lain. Mitigasi: token bisa dicabut kapan saja,
dan ada deteksi penyalahgunaan.

**Biaya Cloudflare.** Setiap permintaan lewat Pages Function dihitung satu invokasi
Workers. Untuk galeri 8 gambar = 9 invokasi per kunjungan. Jauh di bawah batas gratis
100.000/hari, tapi perlu diperhatikan kalau trafik naik drastis.

**SQLite.** Database tunggal tanpa replikasi. Sudah ada backup harian, tapi tidak ada
failover otomatis.

---

## 10. RENCANA BERIKUTNYA

**Prioritas tinggi:**
1. Tetapkan harga final (Standar / Profesional / Enterprise)
2. Buat halaman kontak khusus — supaya tombol tidak selalu ke bagian home
3. Selesaikan pemindahan tabel perbandingan ke docs.html

**Prioritas sedang:**
4. Halaman detail per proyek
5. Versi bahasa Inggris

**Prioritas rendah:**
6. Diagram arsitektur per proyek (SVG statis)
7. Bagian "sekarang mengerjakan"

---

## 11. ANGKA RINGKAS

```
Commit             : 215
Modul backend      : 37
Rute API           : 80
Berkas uji         : 15
Skrip              : 24
Halaman            : 7
Modul JS           : 30+
Berkas CSS         : 27
Dokumen            : 21
CSS sumber         : 282 KB → 114 KB terminifikasi
JS sumber          : 463 KB
Anggaran terpakai  : 688 KB / 900 KB
```

---

*Dokumen ini disusun dari pembacaan menyeluruh: 215 commit, struktur berkas di disk,
21 dokumen PRD/audit, dan riwayat sesi. Tidak ada yang diubah di kode.*
