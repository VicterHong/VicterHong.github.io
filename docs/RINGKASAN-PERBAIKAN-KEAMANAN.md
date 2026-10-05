# Ringkasan Perbaikan Keamanan

**Periode:** 5 Oktober 2026
**Sumber:** Audit keamanan oleh Opus 5.5 → PRD perbaikan → eksekusi CodeBuddy
**Status:** 9 dari 9 FIX selesai, semua terverifikasi di produksi

---

## Ringkasan Singkat

Audit menemukan 8 celah (2 Tinggi, 5 Sedang, 1 Rendah), ditambah 1 celah
baru yang ditemukan saat verifikasi. Semuanya sudah diperbaiki dan
di-deploy ke produksi.

**Total biaya:** $0,90 dari saldo penalaran (audit $0,30 + PRD $0,30 +
riset $0,13 + uji $0,17). Eksekusi $0 — memakai CodeBuddy gratis.

---

## Daftar FIX

### FIX-01 — Proses tidak mati karena satu request
**Temuan:** #2 (Tinggi) · **Berkas:** `server.mjs`

```
Masalah: resolveRoute(), rateLimited(), new URL(host) dipanggil SEBELUM
         blok try. URIError dari decodeURIComponent dan TypeError dari
         header Host rusak menjadi unhandledRejection → proses MATI.
         systemd restart → state rate limit tereset → bisa diulang.

Perbaikan: requestHandler jadi pembungkus try/catch; new URL() pakai base
           tetap; setInterval dibungkus; unhandledRejection + uncaughtException
           ditangani.
```

**Verifikasi:** decodeURIComponent rusak → 400, proses hidup. Header Host rusak → 200, proses hidup.

---

### FIX-02 — Router aman terhadap decode & path traversal
**Temuan:** #2 (Tinggi) · **Berkas:** `routes.mjs`

```
Masalah: decodeURIComponent tanpa try/catch; hasilnya dipakai tanpa
         validasi. '%2F' didekode jadi '/' → slug bisa berisi '..'

Perbaikan: try/catch + validasi per tipe parameter (default-deny).
           slug → /^[a-z0-9][a-z0-9-]{0,62}$/
           id   → /^tok_[a-f0-9]{16}$/
```

**Verifikasi:** 8 serangan ditahan (404). 13/13 token & slug di database cocok dengan regex baru — perbaikan tidak mematahkan fungsi admin.

---

### FIX-03 — Batasi /api/admin/* ke loopback
**Temuan:** Celah BARU yang ditemukan Opus saat verifikasi · **Berkas:** `server.mjs`

```
Masalah: Pemeriksaan loopback hanya untuk /admin (HTML). /api/admin/*
         (±30 endpoint) TERBUKA dari internet lewat tunnel, hanya dijaga
         kunci statis. Dibuktikan: curl ke Worker → HTTP 401 (endpoint ADA).

Perbaikan: blokir /api/admin/* sebelum routing, hanya loopback.
           Dijawab 404 (bukan 403) supaya penyerang tidak tahu endpoint ada.
```

**Verifikasi:** dari internet semua → 404 (sebelumnya 401). Panel admin via loopback tetap 200 dengan kunci asli.

---

### FIX-04 — Jangan bocorkan pesan error internal
**Temuan:** #3 (Sedang) · **Berkas:** `routes.mjs`, `server.mjs`

```
Masalah: safe() mengirim err.message MENTAH untuk semua status termasuk 500.
         ENOENT membawa path lengkap → bocorkan username VPS + struktur direktori.

Perbaikan: 5xx → selalu 'kesalahan_internal'; 4xx → pesan tampil hanya kalau
           lolos filter (≤80 karakter, tanpa '/', tanpa istilah sistem).
           Field 'path' di respons 404 juga dihapus.
```

**Verifikasi:** 5 jenis serangan → respons bersih. Pesan 4xx yang sah tetap terbaca.

---

### FIX-05 — Normalisasi IP + hapus fallback X-Forwarded-For
**Temuan:** #1 sisa + #8 (Sedang) · **Berkas:** `http-util.mjs`, `routes.mjs`

```
Masalah: 1. X-Forwarded-For dipercaya → penyerang tambah satu header
            untuk memalsukan IP → rate limit dilewati total.
         2. Rate limit pakai IPv6 penuh → penyerang ganti alamat dalam
            /64 (2^64 alamat) → semua batas hilang.

Perbaikan: clientIp() hanya percaya CF-Connecting-IP; ipBucket() memotong
           IPv6 ke /64; IPv4-mapped dinormalkan.
```

**Verifikasi:** XFF diabaikan (dibuktikan: 6 request dengan XFF berbeda → dibatasi di ke-6). IPv6 /64 sama → dibatasi. /64 berbeda → tidak saling blokir.

---

### FIX-06 — Rate limit default + cache /api/ready
**Temuan:** #7 (Sedang) + kebocoran path baru · **Berkas:** `routes.mjs`, `health.mjs`

```
Masalah: 1. Endpoint tanpa aturan khusus TIDAK dibatasi (default-allow).
         2. /api/ready: query DB + TULIS disk + statfs tiap panggilan.
         3. /api/ready bocorkan path VPS di detail disk_write & content_dir.

Perbaikan: default-deny (120/menit untuk semua /api/*); cache /api/ready
           10 detik; detail jadi 'bisa ditulis' / 'bisa dibaca'.
```

**Verifikasi:** default limit dibatasi tepat di request ke-121. `/api/ready` bersih dari path. Cache bekerja.

---

### FIX-07 — Perbandingan kunci admin yang benar
**Temuan:** #4b (Rendah) · **Berkas:** `routes.mjs`

```
Masalah: 1. Panjang STRING dibandingkan, bukan BYTE. Kunci multibyte
            8 karakter (16 byte) vs ASCII 8 karakter (8 byte) → lolos
            pemeriksaan → timingSafeEqual MELEMPAR RangeError → 500.
         2. Pemeriksaan panjang membocorkan panjang kunci lewat waktu.

Perbaikan: hash kedua nilai dengan SHA-256 sebelum dibandingkan. Hash
           selalu 32 byte → tidak pernah melempar, waktu selalu sama.
```

**Verifikasi:** 8 kasus unit lulus (2 di antaranya sebelumnya melempar). Di produksi: multibyte → 401 (sebelumnya 500).

---

### FIX-08 — Turnstile fail-closed + validasi hostname/action
**Temuan:** #6 (Sedang) · **Berkas:** `turnstile.mjs`, `routes.mjs`, `config.mjs`

```
Masalah: 1. Gerbang token gagal-TERBUKA: secret kosong → proteksi mati
            diam-diam tanpa jejak.
         2. Pelewatan tidak tercatat di audit.
         3. Hostname tidak divalidasi → token dari domain lain diterima.
         4. Action tidak diperiksa → token form sales bisa buka gerbang.

Perbaikan: failOpen jadi parameter eksplisit. Gerbang token = fail-closed;
           form sales = fail-open (demi konversi). Setiap pelewatan dicatat.
           Validasi hostname + action. Status 503 untuk gangguan infra.
```

**Temuan saat implementasi:** rencana awal pakai `NODE_ENV=production`,
tapi diperiksa ke `/proc/<pid>/environ` — service produksi TIDAK menyetel
NODE_ENV. Diganti: SITE_KEY sebagai penanda.

**Konfigurasi hostname:** dibaca dari API Cloudflare (bukan diasumsikan):
`portfolio-victer.pages.dev`, `victerhong.github.io`.

**Verifikasi:** 13 uji unit + 4 uji live + uji startup, semua lulus. Test suite 153 → 156.

---

### FIX-09 — Verifikasi IP di tabel audit
**Temuan:** #1 Skenario B · **Berkas:** tidak ada (verifikasi saja)

```
Pertanyaan: apakah IP di audit = IP pengunjung, atau IP Cloudflare?

Hasil: 15 IP berbeda tercatat, termasuk IP pengunjung asli pada aksi
       sensitif. Rate limit terbukti per pengunjung (uji 3 IP terpisah,
       masing-masing punya bucket sendiri).

       IP Cloudflare muncul hanya dari request lewat Worker — bukan
       jalur pengunjung normal. TIDAK PERLU PERBAIKAN.
```

---

## Ringkasan Dampak

| Sebelum | Sesudah |
|---|---|
| Satu request rusak bisa mematikan layanan | Proses tetap hidup, error dicatat |
| Path traversal bisa lolos lewat `%2F` | Semua parameter divalidasi (default-deny) |
| `/api/admin/*` terbuka dari internet (401) | Tertutup dari internet (404) |
| Error 500 bocorkan path VPS | Hanya pesan umum; detail tetap di log server |
| IP bisa dipalsukan via header | Hanya `CF-Connecting-IP` dipercaya |
| IPv6 bisa ganti alamat 2^64 kali | Dinormalisasi ke /64 |
| Endpoint baru otomatis tanpa batas | Default-deny 120/menit |
| `/api/ready` tulis disk tiap panggilan | Di-cache 10 detik |
| Kunci admin multibyte → error 500 | SHA-256, tidak pernah melempar |
| Turnstile bisa mati diam-diam | Fail-closed + setiap pelewatan dicatat |
| Token dari domain lain diterima | Hostname divalidasi |

---

## Verifikasi Menyeluruh

Setiap FIX diverifikasi dengan cara yang sama:

1. **Bukti masalah dulu** — sebelum memperbaiki, dibuktikan bug-nya nyata
2. **Uji di instans kedua** (port 8790) — tidak langsung ke produksi
3. **Cek kompatibilitas data** — memastikan perbaikan tidak mematahkan data yang ada
4. **Deploy produksi** — lalu uji lagi dengan serangan yang sama
5. **Jalankan test suite** — 156/156 lulus
6. **Commit dengan penjelasan** — termasuk risiko yang diketahui

---

## Catatan Penting

**NODE_ENV tidak diset di produksi.** Ditemukan saat FIX-08. Ini berarti
validasi apa pun yang bergantung pada `NODE_ENV === 'production'` tidak
akan pernah jalan. Kalau nanti menambah validasi serupa, jangan pakai
NODE_ENV — pakai penanda yang benar-benar ada di konfigurasi.

**Tabel audit menyimpan IP asli.** Ini penting untuk guard
`maxDistinctIps` (deteksi token yang dibagikan). Kalau IP dinormalisasi
di sana, dua pengunjung di jaringan yang sama akan dianggap satu —
guard-nya jadi salah. Normalisasi hanya untuk kunci rate limit.

**Domain kustom belum aktif.** Saat `victer.is-a.dev` aktif, tambahkan
ke `TURNSTILE_HOSTNAMES` — kalau tidak, pengunjung dari domain baru akan
ditolak. Lihat `docs/MIGRASI-DOMAIN.md`.

---

## Dokumen Terkait

- `docs/AUDIT-KEAMANAN-OPUS.md` — audit asli (8 temuan)
- `docs/PRD-PERBAIKAN-KEAMANAN.md` — PRD perbaikan (9 FIX)
- `docs/FIX-09-VERIFIKASI-IP.md` — laporan verifikasi IP
- `docs/PRD-PERAN-MODEL.md` — pembagian peran model AI
- `docs/MIGRASI-DOMAIN.md` — rencana migrasi domain kustom
