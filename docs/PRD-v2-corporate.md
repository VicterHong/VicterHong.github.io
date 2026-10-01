# PRD — Portofolio Korporat Victer (v2.0)

**Status:** draf — menggantikan PRD v1.1 menjadi arsitektur monetisasi jangka panjang
**Pemilik:** Victer (VicterHong)
**Target pasar:** perusahaan teknologi yang memerlukan akses ke detail arsitektur proyek
**Model bisnis:** freemium public page + tokenized project access + enterprise sales
**Terakhir diperbarui:** 1 Oktober 2026

---

## 1. Ringkasan Eksekutif

Portofolio pribadi berkembang menjadi **showcase korporat bertingkat**. Lapisan luar tetap
publik dan ringan seperti portofolio biasa. Setelah pengunjung menunjukkan minat pada proyek
penting, konten sensitif (arsitektur, metrik internal, repositori privat, diagram) dikunci dan
hanya bisa dibuka dengan token akses yang:

- **diterbitkan oleh pemilik** (bukan self-service publik),
- **dapat dicabut (revoked) kapan saja**,
- **berlaku per proyek**, tidak universal,
- **otomatis dicabut** jika sistem mendeteksi penyalahgunaan (sharing, scrape massal),
- **dijual melalui tim sales** — tidak ada tombol “beli” di halaman publik.

Teknologi visual diperkuat dengan **Seedance 2.5** untuk hero cinematic, **GPT Astra**
untuk micro-interactions dan animasi kontekstual, serta **Fable 5.1** untuk narasi visual
proyek yang memerlukan storytelling.

---

## 2. Visi

Menjadi **showcase teknis premium** yang tidak sekadar menampilkan proyek, tetapi juga
membuktikan kemampuan rekayasa, keamanan akses, dan kualitas presentasi pada tingkat yang
diterima perusahaan teknologi besar.

---

## 3. Tujuan Bisnis

| Kode | Tujuan | Indikator Keberhasilan |
|------|--------|------------------------|
| B1 | Menarik minat perusahaan teknologi | Jumlah permintaan demo/token dari domain korporat |
| B2 | Melindungi IP teknis sensitif | Tidak ada konten terkunci yang bocor tanpa token |
| B3 | Monetisasi akses detail proyek | Revenue dari token per proyek / kontrak enterprise |
| B4 | Membuktikan kemampuan keamanan | Fitur revoke, audit log, dan anti-sharing berfungsi |
| B5 | Skalabilitas jangka panjang | Arsitektur mendukung N proyek dan M token tanpa refactor |
| B6 | Kesan profesional | Feedback dari perekrut/klien: “tampak seperti produk enterprise” |

---

## 4. Bukan Tujuan (Non-Goals)

- **Bukan e-commerce self-service.** Tidak ada checkout publik; harga ditentukan sales.
- **Bukan CMS blog.** Konten tetap dikelola lewat berkas kode, bukan panel admin.
- **Bukan resume PDF.** Fokus pada bukti teknis, bukan riwayat kerja formal.
- **Bukan showcase desain semata.** Visual mendukung rekayasa, bukan sebaliknya.
- **Tidak untuk mass market.** Token access ditujukan untuk prospect yang sudah lolos
  verifikasi awal.

---

## 5. Persona

| Persona | Motivasi | Bagian yang Diakses |
|---------|----------|---------------------|
| **CTO / VP Engineering** | Mengevaluasi kemampuan arsitektur | Landing + project locked (dengan token) |
| **Technical Lead** | Melihat pola desain dan kualitas kode | Project detail, diagram, repo read-only |
| **Security Engineer** | Menguji kemampuan keamanan akses | Token lifecycle, audit log, anti-scrape |
| **Talent Acquisition** | Memvalidasi profil teknis | Landing + project summary (gratis) |
| **Klien Enterprise** | Mempertimbangkan kerja sama | Project case study (dengan token) |

---

## 6. Arsitektur Akses Berlapis

### 6.1 Tingkat Akses

```
LAPAK PUBLIK (gratis, tanpa login)
├── Landing page
├── Daftar proyek dengan summary
├── Kontak dan profil singkat
└── CTA: “Minta akses detail proyek”

LAPAK TERBUKA (gratis, tanpa token)
├── Project overview: masalah, solusi high-level, teknologi publik
├── Metrik dasar yang tidak sensitif (jumlah tes, lisensi)
└── Preview blur untuk bagian sensitif

LAPAK TERKUNCI (memerlukan token)
├── Detail arsitektur dan diagram
├── Repositori privat / branch detail
├── Metrik internal dan performa
├── Dokumentasi teknis
├── Video narasi proyek (Fable 5.1)
└── Timeline dan keputusan desain

ENTERPRISE (kontak sales)
└── Akses multi-proyek, custom SLA, audit log penuh
```

### 6.2 Alur Pengguna

```
Pengunjung korporat membuka victerhong.github.io
        ↓
Melihat landing + daftar proyek (gratis)
        ↓
Klik proyek penting → halaman proyek terbuka
        ↓
Bagian sensitif ditampilkan blur + overlay “Akses Dibatasi”
        ↓
Klik “Minta Akses” → form kontak / email ke sales
        ↓
Sales memverifikasi dan menerbitkan token (per proyek, expire tertentu)
        ↓
Pengunjung memasukkan token → konten terkunci terbuka
        ↓
Setiap interaksi dicatat di audit log; token dicabut otomatis jika anomali
```

---

## 7. Persyaratan Fungsional

### 7.1 Lapak Publik

| ID | Persyaratan | Prioritas |
|----|-------------|-----------|
| F1 | Landing page cepat (< 100 KB tanpa video) | Tinggi |
| F2 | Daftar proyek dengan metadata publik | Tinggi |
| F3 | Hero video cinematic (Seedance 2.5) | Tinggi |
| F4 | Micro-interactions halus (GPT Astra) | Sedang |
| F5 | Navigasi ke halaman proyek individu | Tinggi |
| F6 | Tidak ada pelacakan pihak ketiga | Tinggi |

### 7.2 Halaman Proyek

| ID | Persyaratan | Prioritas |
|----|-------------|-----------|
| F7 | Project overview publik gratis | Tinggi |
| F8 | Bagian sensitif ditampilkan blur + overlay | Tinggi |
| F9 | Input token untuk membuka bagian sensitif | Tinggi |
| F10 | Token diverifikasi di backend self-hosted | Tinggi |
| F11 | Konten sensitif tidak ada di HTML awal (lazy fetch) | Tinggi |
| F12 | Token invalid/expired/revoked menampilkan pesan profesional | Tinggi |
| F13 | Session token dihapus saat tab ditutup (opsional) | Sedang |

### 7.3 Manajemen Token

| ID | Persyaratan | Prioritas |
|----|-------------|-----------|
| F14 | Pemilik dapat menerbitkan token per proyek | Tinggi |
| F15 | Pemilik dapat mencabut token kapan saja | Tinggi |
| F16 | Token memiliki expiry date opsional | Tinggi |
| F17 | Token memiliki batasan jumlah device/session | Sedang |
| F18 | Auto-revoke jika terdeteksi sharing: banyak IP, banyak lokasi, scrape | Tinggi |
| F19 | Audit log setiap akses token | Tinggi |
| F20 | Notifikasi ke pemilik saat token dicabut atau dicurigai | Sedang |

### 7.4 Animasi & Visual

| ID | Persyaratan | Prioritas |
|----|-------------|-----------|
| F21 | Hero video cinematic 3–5 detik (Seedance 2.5) | Tinggi |
| F22 | Micro-interactions pada hover dan scroll (GPT Astra / CSS) | Sedang |
| F23 | Video narasi per proyek untuk konten terkunci (Fable 5.1) | Sedang |
| F24 | Semua video mati saat `prefers-reduced-motion` | Tinggi |

### 7.5 Enterprise / Sales

| ID | Persyaratan | Prioritas |
|----|-------------|-----------|
| F25 | Form permintaan akses terhubung ke email sales | Tinggi |
| F26 | Tidak ada harga publih; semua deal melalui sales | Tinggi |
| F27 | Paket enterprise: multi-proyek + SLA + audit log | Sedang |
| F28 | Dashboard admin sederhana untuk pemilik | Sedang |

---

## 8. Persyaratan Non-Fungsional

| Aspek | Persyaratan |
|-------|-------------|
| **Keamanan** | Konten sensitif tidak tersedia di HTML statis; semua verifikasi di backend |
| **Privasi** | Tidak ada analytics pihak ketiga; audit log disimpan di VPS sendiri |
| **Performa** | Halaman publik < 1 MB total; konten terkunci di-load lazy |
| **Ketersediaan** | Uptime 99% untuk landing; token service dapat maintenance window |
| **Skalabilitas** | Arsitektur stateless; database SQLite/PostgreSQL ringan |
| **Backup** | Token database di-backup otomatis harian |
| **Audit** | Semua penerbitan, pencabutan, dan akses token tercatat |

---

## 9. Keputusan Teknis

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Frontend | Static site + JS murni | GitHub Pages gratis, cepat, mudah diperbarui |
| Backend token | Self-hosted di VPS (FastAPI/Node) | Kontrol penuh, tidak bergantung Clerk/Auth0 |
| Database token | SQLite untuk awal, PostgreSQL saat scale | Sederhana, portable, cukup untuk ribuan token |
| Enkripsi token | SHA-256 hash + salt di DB; plaintext hanya saat terbit | Jika DB bocor, token tidak langsung usable |
| Konten terkunci | JSON endpoint `/api/project/:slug/locked` | HTML publik tidak mengandung data sensitif |
| Hosting backend | VPS existing (Ubuntu + systemd) | Biaya minimal, infrastruktur sudah ada |
| Video | Seedance 2.5 hero + Fable 5.1 project stories | Kualitas korporat, narasi kuat |
| Animasi UI | GPT Astra untuk micro-interactions | Gerakan halus yang tidak mengganggu |

---

## 10. Struktur Sistem

```
GitHub Pages (frontend statis)
├── index.html
├── project/:slug/index.html
├── styles.css
├── src/app.js
├── src/data/projects.js
└── assets/hero.mp4, hero.webm

VPS Backend (token service)
├── /api/health
├── POST /api/token/validate  ← frontend kirim token + project slug
├── GET  /api/project/:slug/locked  ← mengembalikan konten sensitif jika token valid
├── POST /api/contact/sales  ← form permintaan akses
├── POST /api/admin/token/issue  ← dashboard admin
├── POST /api/admin/token/revoke
└── GET  /api/admin/audit

Admin Dashboard (opsional v2.1)
└── Halaman terpisah atau CLI untuk mengelola token
```

---

## 11. Model Bisnis & Harga

### 11.1 Prinsip

- **Tidak ada harga publih.** Semua harga ditentukan oleh tim sales setelah verifikasi.
- **Token per proyek.** Tidak ada token universal yang membuka semua proyek.
- **Revocable by design.** Token dapat dicabut kapan saja oleh pemilik.

### 11.2 Opsi Paket

| Paket | Akses | Harga | Cara Dapat |
|-------|-------|-------|------------|
| **Public** | Landing + project overview | Gratis | Langsung |
| **Project Token** | 1 proyek terkunci, 7–30 hari | Sales-defined | Kontak sales |
| **Enterprise Token** | Multi-proyek, 90 hari, audit log | Sales-defined + SLA | Kontak sales |
| **Custom** | Dedicated narrative video, call, NDA | Sales-defined | Kontak sales |

### 11.3 Pencabutan Otomatis

Token akan dicabut otomatis jika sistem mendeteksi:
- Akses dari lebih dari N IP berbeda dalam 24 jam.
- Akses dari lebih dari N negara berbeda.
- Lebih dari R request per menit (indikasi scrape).
- User-agent atau pola request mencurigakan.
- Token dishare di platform publik (monitoring opsional, manual).

---

## 12. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Konten sensitif bocor | Tinggi | Lazy fetch, token required, no sensitive data in static HTML |
| Token dishare | Tinggi | Auto-revoke rules, device/session limit, audit log |
| Backend down | Sedang | Landing page tetap jalan (GitHub Pages); konten terkunci tidak bisa dibuka |
| Scrape massal | Sedang | Rate limiting, CAPTCHA setelah threshold, token revocation |
| Video hero terlalu besar | Rendah | Kompresi < 2 MB, WebM + MP4, preload none |
| Sales bottleneck | Sedang | Form otomatis ke email; dashboard admin sederhana |

---

## 13. Roadmap

| Versi | Isi | Target |
|-------|-----|--------|
| **v1.2** | Ganti hero video dengan versi final tanpa watermark | Segera |
| **v2.0** ✅ | Token access system + halaman proyek terkunci | **Selesai** |
| **v2.1** | Admin dashboard untuk issue/revoke token | 1 minggu setelah v2.0 |
| **v2.2** | Fable 5.1 project narrative videos | 3–4 minggu |
| **v2.3** | GPT Astra micro-interactions di seluruh halaman | 2–3 minggu |
| **v2.4** | Enterprise package + SLA + custom domain | 1–2 bulan |

---

## 14. Definisi Selesai v2.0 ✅

- [x] Landing page profesional dengan hero video
- [x] Setidaknya 2 halaman proyek dengan bagian publik + terkunci (MINA, Spareparts)
- [x] Backend token service berjalan di VPS (`portfolio-token`, port 8788)
- [x] Validasi token berfungsi; konten sensitif tidak ada di HTML statis (diverifikasi)
- [x] Blur overlay dan form token di frontend
- [x] Form permintaan akses ke email sales
- [x] Audit log dasar tersedia
- [x] Token dapat diterbitkan dan dicabut oleh pemilik
- [x] Auto-revoke untuk pola sharing/scrape (terbukti: 3 IP → dicabut seketika)
- [x] Dokumentasi deploy dan penggunaan admin (`docs/OPERASIONAL.md`)

### Catatan implementasi v2.0

| Keputusan | Hasil |
|-----------|-------|
| Stack backend | Node murni + `node:sqlite` — **nol dependency** |
| Database | SQLite (WAL), cukup untuk ribuan token |
| Penyimpanan token | SHA-256 + salt; plaintext tampil sekali saat terbit |
| Akses publik backend | Cloudflare quick tunnel + publikasi URL otomatis ke repo |
| Ambang auto-revoke | >3 IP/24 jam, >30 req/menit, ≥12 gagal beruntun |
| Tes | 22 tes, semuanya lulus |
| Memori layanan | ~21 MB (token) + ~19 MB (tunnel) |

---

## 15. Pertanyaan Terbuka untuk Diputuskan

| # | Pertanyaan | Dampak |
|---|-----------|--------|
| Q1 | Backend pakai FastAPI (Python) atau Express (Node)? | Stack teknis, kecepatan development |
| Q2 | Database token pakai SQLite atau langsung PostgreSQL? | Skalabilitas, backup |
| Q3 | Apakah perlu CAPTCHA pada form sales? | Spam vs UX |
| Q4 | Apakah konten terkunci dienkripsi di transit (HTTPS saja cukup)? | Keamanan |
| Q5 | Apakah perlu NDA digital sebelum token diterbitkan? | Legal, sales flow |

---

## 16. Catatan Implementasi

- Semua API backend **wajib HTTPS**.
- Token di-hash sebelum disimpan; plaintext hanya ditampilkan sekali saat terbit.
- Frontend tidak menyimpan token di `localStorage` secara permanen — opsional session-only.
- Setiap project slug unik dan immutable.
- Audit log menyimpan: timestamp, IP, user-agent, project slug, token hash (terakhir 8 karakter), action.
