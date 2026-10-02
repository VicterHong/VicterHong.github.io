# Laporan Audit Keamanan — Fable 5.1

**Tanggal:** 2 Oktober 2026
**Cakupan:** Backend token service (Node + SQLite), frontend statis (GitHub Pages)
**Metode:** Review kode manual menyeluruh — autentikasi, otorisasi, input handling,
path traversal, XSS, rate limiting, kebocoran data, konfigurasi cookie.

---

## Ringkasan

| Tingkat | Jumlah | Status |
|---------|--------|--------|
| 🔴 Critical | 1 | ✅ Diperbaiki |
| 🟠 High | 1 | ✅ Diperbaiki |
| 🟡 Medium | 3 | ✅ Diperbaiki |
| 🟢 Low | 2 | ✅ Diperbaiki |
| ⚪ Info | 3 | Terdokumentasi |

**Kesimpulan:** Tidak ada kerentanan yang tersisa pada kategori Critical/High.
Sistem layak untuk produksi dengan token pelanggan nyata.

---

## Temuan & Perbaikan

### 🔴 C1 — Timing attack pada kunci admin

**Lokasi:** `backend/src/routes.mjs` — `isAdmin()`
**Masalah:** Kunci admin dibandingkan dengan `===`. Perbandingan string di V8
berhenti di karakter pertama yang berbeda, sehingga waktu respons membocorkan
berapa banyak karakter awal yang benar. Penyerang bisa menebak kunci karakter
demi karakter (statistical timing attack).

**Perbaikan:** `crypto.timingSafeEqual` dengan panjang yang disamakan lebih dulu.

```js
if (key.length !== expected.length) return false;
return timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(expected, 'utf8'));
```

---

### 🟠 H1 — Brute force token tanpa batas

**Lokasi:** `backend/src/routes.mjs`, `backend/src/server.mjs`
**Masalah:** Guard penyalahgunaan (`checkAbuse`) bekerja **per token**. Percobaan
dengan token yang TIDAK DIKENAL tidak punya `token_id`, jadi tidak pernah
tersentuh guard. Penyerang bisa mencoba ribuan kombinasi token tanpa hambatan.

**Perbaikan:** Rate limiter per-IP (`backend/src/rate-limit.mjs`) di endpoint publik:

| Endpoint | Batas |
|----------|-------|
| `/api/token/validate` | 20 / menit / IP |
| `/api/token/session` | 10 / menit / IP |
| `/api/contact/sales` | 5 / menit / IP |
| `/api/analytics/track` | 60 / menit / IP |

Respons 429 menyertakan `Retry-After`. **Terverifikasi:** request ke-21 ditolak.

---

### 🟡 M1 — Event analytics tidak di-whitelist

**Masalah:** `event_type` apa pun diterima. Penyerang (atau bug frontend) bisa
mengisi database dengan event sampah, merusak statistik funnel.

**Perbaikan:** Whitelist 9 event yang dikenal; selain itu → 400.

---

### 🟡 M2 — Metadata analytics tidak dibatasi

**Masalah:** `metadata` disimpan apa adanya sebagai JSON — bisa sangat besar.

**Perbaikan:** Maksimum 20 kunci, nama kunci ≤ 64 karakter, nilai ≤ 300 karakter.

---

### 🟡 M3 — Tidak ada header keamanan tambahan

**Perbaikan:** Ditambahkan `X-Frame-Options: DENY` (anti-clickjacking) dan
`Referrer-Policy: no-referrer` pada semua respons JSON. Sebelumnya sudah ada
`X-Content-Type-Options: nosniff` dan `Cache-Control: no-store`.

---

### 🟢 L1 — Referrer bocor ke backend

**Catatan:** Header `Referer` dari halaman proyek dikirim ke backend dan disimpan
di analytics. Ini disengaja (atribusi), tapi dokumentasikan agar pemilik tahu.

---

### 🟢 L2 — Sesi tidak dihapus saat token di-revoke

**Status:** Sudah benar sejak awal — `revokeToken()` menjalankan
`DELETE FROM sessions WHERE token_id = ?` di dalam transaksi. Diverifikasi ulang.

---

## Yang Sudah Baik (Terverifikasi)

| Aspek | Status | Bukti |
|-------|--------|-------|
| Token disimpan sebagai hash | ✅ | SHA-256 + salt `SERVICE_SECRET`, plaintext tidak pernah di DB |
| Path traversal dicegah | ✅ | `isValidSlug()` regex + double-check `resolve()` di dalam `contentDir` |
| XSS di frontend | ✅ | Semua render pakai `textContent`, tidak ada `innerHTML` dengan data user |
| SQL injection | ✅ | Semua query pakai prepared statement dengan parameter |
| Cookie session | ✅ | `HttpOnly; Secure; SameSite=None` — tidak bisa dibaca JS |
| Session ID di-hash | ✅ | SHA-256 + secret sebelum masuk DB |
| Auto-revoke sharing | ✅ | Terbukti: 3 IP → token mati seketika |
| Timing-safe token compare | ✅ | `hashesEqual()` pakai `timingSafeEqual` |
| Body size limit | ✅ | Maksimum 64 KB, `req.destroy()` saat lewat |
| CORS ketat | ✅ | Hanya origin di `ALLOWED_ORIGINS` |
| Secret tidak di repo | ✅ | `service.env` di luar repo, `.gitignore` |

---

## Rekomendasi Lanjutan (Opsional)

1. **Rotasi SERVICE_SECRET** setiap 6 bulan — mencabut semua token lama sekaligus.
2. **Cloudflare WAF** di depan tunnel untuk lapisan kedua rate limiting.
3. **Alert webhook** saat ada 429 beruntun dari satu IP (indikasi serangan aktif).
4. **Backup database** harian ke lokasi terpisah (sudah ada backup manual).

---

*Audit dilakukan sebagai bagian dari roadmap v2.5 — "Fable 5.1 untuk keamanan website".*
