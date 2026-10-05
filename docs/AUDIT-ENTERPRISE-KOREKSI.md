# Audit Enterprise — Koreksi & Status

**Tanggal:** 5 Oktober 2026
**Konteks:** Audit kesiapan skala oleh Opus 5.5 (`docs/AUDIT-ENTERPRISE.md`)

---

## Kenapa Dokumen Ini Ada

Opus memberi dua hal berharga dalam audit enterprise:

1. **Menemukan masalah nyata** yang hanya muncul pada skala besar
2. **Mengoreksi 5 dari 8 "temuan"** yang saya kumpulkan — 2 di antaranya
   salah tuduh sepenuhnya

Dokumen ini mencatat **mana yang benar-benar perlu dikerjakan**, setelah
saya verifikasi ulang ke kode yang sebenarnya. Beberapa temuan Opus juga
perlu dikoreksi balik — karena kode `collaborate.mjs` tidak disertakan
dalam prompt, jadi Opus menilai A8 tanpa melihat batas yang sudah ada.

---

## Koreksi dari Opus (yang saya terima)

Opus mengoreksi daftar temuan saya. Semua koreksinya benar setelah saya
verifikasi:

| Temuan saya | Kata Opus | Verifikasi saya |
|---|---|---|
| audit.mjs:48 `DISTINCT ip` | Bukan masalah — difilter `token_id` + pakai index | **Benar.** Ada `WHERE token_id = ? AND at >= ?` |
| audit.mjs:70 `SELECT outcome` | Salah tuduh — sudah ada `LIMIT 40` | **Benar.** Saya salah baca |
| sla.mjs:68 | Masalahnya beda — bukan unbounded, tapi `ORDER BY` full sort | **Benar.** Ada `LIMIT 1 OFFSET`, masalah di sort |
| cms/branches/experiments | Bukan masalah — data admin, puluhan baris | **Benar** |
| collaborate.mjs:125 | Berbahaya — ditulis publik, dibaca tanpa LIMIT | **Sebagian.** Lihat koreksi saya di bawah |

**Pelajaran:** saya mengumpulkan temuan dengan grep pola, bukan dengan
membaca konteks query. Dua dari delapan salah tuduh. Opus membacanya
dengan konteks.

---

## Koreksi Balik (temuan Opus yang perlu dikoreksi)

Opus menilai A8 tanpa melihat `collaborate.mjs`. Setelah saya periksa,
sebagian sudah tertangani:

### A8 — `/api/comments` publik

**Yang Opus katakan:**
> Tabelnya bisa ditulis dari endpoint publik dan dibaca tanpa LIMIT.
> Vektor: DoS total dan XSS.

**Kenyataan setelah verifikasi kode:**

```
✅ SUDAH ADA: batas 4000 karakter per komentar
   collaborate.mjs:109 → if (text.length > 4000) throw new Error('komentar terlalu panjang')

✅ SUDAH ADA: listComments punya limit bawaan 200
   collaborate.mjs:119 → listComments({ ..., limit = 200 })

✅ SUDAH ADA: rate limit 10/menit per IP (FIX-06)
   Dan IPv6 dinormalisasi /64 (FIX-05) → tidak bisa ganti alamat

✅ SUDAH ADA: target & anchor dibatasi
   collaborate.mjs:115 → String(target).slice(0, 300), String(anchor).slice(0, 200)
```

**Yang MASIH kurang (dan ini nyata):**

```
❌ TIDAK ADA moderasi — komentar langsung tampil setelah dikirim
❌ TIDAK ADA approval — siapa pun bisa kirim, langsung terlihat semua orang
❌ Escaping XSS bergantung pada sisi klien (admin.html sudah escapeHtml,
   tapi endpoint publik mengembalikan teks mentah)
❌ 10/menit × 1440 menit = 14.400 komentar/hari per IP — masih besar
   untuk spam
```

**Status: SEBAGIAN tertangani. Moderasi & escaping belum.**

---

## Status Setiap Temuan

| # | Temuan | Status | Catatan |
|---|---|---|---|
| **A1** | Heartbeat SLA per request | **BELUM** | 3.500 baris vs 303 event (rasio 11:1). Sumber pertumbuhan terbesar |
| **A2** | Rate limit sumber IP | **SELESAI** | FIX-05: hanya `CF-Connecting-IP`, XFF dihapus, IPv6 /64 |
| **A3** | Retensi data | **BELUM** | `cleanupAnalytics` & `cleanupFingerprints` ada tapi tidak dipanggil |
| **A4** | Query admin full scan | **BELUM** | Belum terasa pada 303 event, kritis di ratusan ribu |
| **A5** | busy_timeout=0 + last_seen per request | **BELUM** | `new DatabaseSync(path)` tanpa timeout; `last_seen` ditulis tiap request |
| **A6** | Map rate limit tumbuh | **BELUM** | Sweep ada, tapi tanpa batas keras `MAX_KEYS` |
| **A7** | Backup blokir + disk | **BELUM** | Perlu cek: berapa salinan disimpan? |
| **A8** | Komentar publik | **SEBAGIAN** | Batas & rate limit ada; moderasi & escaping belum |

---

## Yang Paling Penting dari Opus

### 1. Akar masalahnya satu: `DatabaseSync` sinkron

> "Tidak ada konkurensi sama sekali. Seluruh server adalah satu antrean
> tunggal, dan setiap operasi sinkron yang lambat menahan SEMUA pengguna."

**Angka konkret yang Opus berikan:**

```
Beban 500 req/menit = 8,3 req/detik

Satu query admin 500ms:
  → 4 request masuk selama itu
  → masing-masing menunggu rata-rata 250ms ekstra
  → latensi naik dari 5ms → 250-500ms (50-100×)

50 admin refresh/menit tanpa cache:
  → 50 × 0,5s = 25 detik kerja blokir per menit
  → 42% waktu event loop habis untuk admin
  → request publik tertahan 1-2 detik
```

**Aturan praktis dari Opus:**

> Tidak boleh ada satu operasi sinkron >20 ms di thread utama.
> Yang lebih lama harus dipecah per batch atau dipindah ke worker.
> Ukur kepatuhannya dengan p99 event loop lag <50 ms.

### 2. Yang BUKAN masalah (hemat waktu)

Opus memberi daftar hal yang sering dituduh masalah skala tapi tidak:

| Tuduhan | Kenyataan (angka dari Opus) |
|---|---|
| "SQLite tidak untuk produksi" | 8 req/detik vs kapasitas 5.000-50.000 insert/detik → headroom >500× |
| "Butuh Postgres untuk 10.000 token" | 10.000 × 500 byte = **5 MB**. Lookup <20 µs |
| "1 juta event terlalu banyak" | 1 juta × 400 byte = **400 MB**, muat di page cache 6 GB |
| "1 CPU tidak cukup" | 8 req/detik × 2ms = **1,6% CPU** |
| "50 admin berat" | 50 admin × 1 load/30 detik = 1,7 req/detik |
| "Butuh Redis" | Satu proses → Map lebih cepat (ns vs 0,3ms RTT) |
| "100.000 pengunjung/bulan besar" | = 0,04 pengunjung/detik |

**Ini menghemat waktu:** saya tidak perlu migrasi ke Postgres/Redis.

### 3. Batas jujur sistem

```
Pemicu                      Ambang
Throughput berkelanjutan    ~300-500 req/detik (40-60× skenario ini)
Query analitik              analytics_events > 20-30 juta baris
Data panas                  > ~4 GB (melebihi page cache)
Ketersediaan                kontrak >99,9% (satu VPS tanpa failover)
Banyak penulis              butuh >1 proses
```

**Penggantinya bertahap (jangan lompat):**
1. Pisahkan analytics ke file SQLite sendiri
2. Naikkan VPS ke 2 CPU
3. Baru pertimbangkan PostgreSQL — **hanya kalau metrik menunjukkan**

---

## Urutan Kerja dari Opus

### SEKARANG (±1 hari)

| # | Temuan | Alasan | Biaya |
|---|---|---|---|
| 1 | **A8** moderasi + escaping komentar | Bisa dieksploitasi hari ini | 1-2 jam |
| 2 | **A2** sumber IP | **SUDAH SELESAI** (FIX-05) | — |
| 3 | **A7** backup off-thread + off-site + uji restore | Risiko kehilangan data total | 2-3 jam |
| 4 | **A1** heartbeat SLA per menit | Sumber pertumbuhan terbesar | 60-90 mnt |
| 5 | **A3** index + `auto_vacuum` + VACUUM | **Hanya murah selagi DB kecil** | 45 mnt |
| 6 | **A5** busy_timeout + synchronous + throttle last_seen | 3 baris kode | 30 mnt |
| 7 | **E** metrik event loop delay | Tanpa ini tidak tahu kapan perlu | 15 mnt |

### NANTI (1-2 bulan)

- **A4** `ORDER BY id` + index tambahan + cache 60s
- **A3** jadwal `prune()` harian
- **A6** sweep + batas Map

### TIDAK PERLU

- Migrasi Postgres, Redis, cluster Node
- Ganti framework HTTP
- Sharding / DB per tenant

---

## Satu Hal Paling Penting (dari Opus)

> **Di sistem ini, tidak ada konkurensi sama sekali. Seluruh server adalah
> satu antrean tunggal, dan setiap operasi sinkron yang lambat menahan
> SEMUA pengguna.**

Insinyur melihat "Node.js = async, non-blocking" lalu berasumsi satu admin
dengan query lambat hanya memperlambat dirinya sendiri. Dengan
`DatabaseSync`, kerja CPU dan I/O SQLite dilakukan **langsung di call stack
JavaScript**. Kata kunci `async` tidak membantu — `await` atas nilai sinkron
tidak memindahkan kerja ke tempat lain.

```
Konkurensi efektif untuk kerja DB = 1
Server berperilaku seperti antrean dengan satu kasir
Latensi request = waktu kerjanya + total kerja sinkron semua request sebelumnya
```

**Implikasi praktis:**

- Biaya diukur dalam **milidetik blokir**, bukan jumlah query
- DELETE retensi & agregasi harus per batch kecil (<20ms) dengan `setImmediate()`
- Query berat & backup pindah ke `worker_threads` dengan koneksi sendiri
- Dashboard admin pakai **pra-agregasi**, bukan scan saat dibuka
- Wajib pasang `monitorEventLoopDelay()` — CPU% bisa 15% sementara p99 sudah 500ms

---

## Langkah Berikutnya

**Rekomendasi saya:** kerjakan yang **murah dan mendesak** dulu:

1. **A5** (30 mnt) — 3 baris kode, hilangkan fsync per request
2. **A3** (45 mnt) — VACUUM + index, **hanya murah selagi DB 584 KB**
3. **E** (15 mnt) — metrik event loop delay, supaya keputusan berikutnya berbasis data
4. **A1** (60-90 mnt) — agregasi heartbeat, hentikan sumber pertumbuhan terbesar
5. **A8** (1-2 jam) — moderasi komentar

**Total ~4 jam** untuk menutup semua yang mendesak.

**A7 (backup)** perlu diperiksa dulu: berapa salinan disimpan, apakah
restore pernah diuji. Kalau belum pernah diuji, itu prioritas tertinggi —
backup yang tidak pernah diuji sama dengan tidak punya backup.

---

**Dokumen terkait:**
- `docs/AUDIT-ENTERPRISE.md` — audit lengkap dari Opus
- `docs/RINGKASAN-PERBAIKAN-KEAMANAN.md` — 9 FIX keamanan sebelumnya
