# API Reference — Layanan Token Portofolio

**Base URL produksi:** `https://translation-davidson-searches-prescription.trycloudflare.com`
(alamat berubah saat tunnel restart — selalu baca `backend-url.json`)

**Lokal (di server):** `http://127.0.0.1:8788`

**Autentikasi admin:** header `X-Admin-Key: <ADMIN_KEY>`
**Autentikasi token:** header `X-Project-Token: VP-XXXX-...` atau cookie sesi

---

## Ringkasan Endpoint

| Kategori | Jumlah | Akses |
|----------|--------|-------|
| Health & readiness | 2 | Publik |
| Token (validasi & sesi) | 4 | Publik |
| Konten terkunci | 1 | Token/sesi |
| Turnstile | 1 | Publik |
| Sales & analytics | 3 | Publik |
| Vitals (performa) | 1 | Publik |
| Eksperimen | 2 | Publik |
| Komentar | 2 | Publik |
| CMS (publik) | 3 | Publik (published saja) |
| SEO/AEO | 4 | Publik |
| Admin — token | 8 | Admin |
| Admin — lead & audit | 5 | Admin |
| Admin — CMS | 6 | Admin |
| Admin — performa | 2 | Admin |
| Admin — kolaborasi | 7 | Admin |
| Admin — eksperimen | 4 | Admin |
| Admin — publish | 4 | Admin |

---

## 1. Health & Readiness

### `GET /api/health` — Liveness

"Proses ini hidup?" Cepat, tidak menyentuh database. Dipakai uptime monitor
dan systemd watchdog.

```json
{
  "ok": true,
  "service": "portfolio-token-service",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "pid": 12345,
  "node": "v22.0.0",
  "memory_mb": 27,
  "time": "2026-10-04T16:00:00.000Z"
}
```

Selalu **200** selama proses bisa menjawab.

### `GET /api/ready` — Readiness

"Siap menerima trafik?" Memeriksa dependensi nyata: database bisa dibaca,
disk bisa ditulis, ruang cukup, konfigurasi ada.

```json
{
  "ok": true,
  "checks": [
    { "name": "database", "ok": true, "detail": "12 token terbaca" },
    { "name": "disk_write", "ok": true, "detail": "/home/ubuntu/.portfolio-token" },
    { "name": "disk_space", "ok": true, "detail": "4823 MB tersisa" },
    { "name": "content_dir", "ok": true, "detail": ".../content" },
    { "name": "config", "ok": true, "detail": "secret & admin key ada" }
  ],
  "uptime_seconds": 3600,
  "time": "2026-10-04T16:00:00.000Z"
}
```

**200** kalau siap, **503** kalau ada yang gagal. Monitoring memakai ini,
bukan `/api/health` — karena proses bisa "hidup" tapi tidak bisa melayani.

---

## 2. Konfigurasi Publik

### `GET /api/config`

Nilai yang aman dilihat siapa pun (site key Turnstile, daftar proyek).

```json
{
  "ok": true,
  "turnstile": { "enabled": true, "site_key": "0x4AAAAAA..." },
  "projects": [
    { "slug": "mina", "name": "MINA" },
    { "slug": "spareparts", "name": "Spareparts Inventory System" }
  ]
}
```

---

## 3. Token — Validasi & Sesi

### `POST /api/token/validate`

Cek token tanpa membuat sesi (untuk pratinjau).

```json
// Request
{ "project": "mina", "token": "VP-XXXX-XXXX-XXXX-XXXX" }

// 200 OK
{
  "ok": true,
  "project": "mina",
  "tier": "standard",
  "scopes": ["mina"],
  "label": "",
  "issued_to": "PT Contoh",
  "company": "PT Contoh",
  "expires_at": 1790000000000
}
```

Batas: **20 permintaan/menit per IP**.

### `POST /api/token/session`

Tukar token dengan cookie sesi (httpOnly, Secure, SameSite=None).

```json
// Request
{ "project": "mina", "token": "VP-...", "device_fp": "abc123", "turnstile_token": "..." }

// 200 OK + Set-Cookie: session=...
{
  "ok": true,
  "session": { "expires_at": 1790000000000, "devices": 1, "max_devices": 3 }
}
```

Batas: **10 permintaan/menit per IP**. Gerbang Turnstile diperiksa **sebelum**
token dinilai — bot tidak bisa menguji token.

### `POST /api/token/logout`

Hapus sesi aktif. Cookie dibersihkan.

### `GET /api/project/:slug/locked`

Konten sensitif. Butuh sesi valid atau token di header.

```json
{
  "ok": true,
  "content": { "slug": "mina", "title": "...", "sections": [...] },
  "watermark": "Lisensi: PT Contoh • STANDARD"
}
```

Konten **tidak pernah** ada di HTML statis — hanya dikirim setelah verifikasi.

---

## 4. Turnstile

### `POST /api/verify-turnstile`

Verifikasi token Turnstile di sisi server (secret tidak pernah ke browser).

```json
// Request
{ "token": "0.abc..." }

// 200 OK
{ "ok": true, "verified": true, "ray_id": "..." }
```

Batas: **30 permintaan/menit per IP**.

---

## 5. Sales & Analytics

### `POST /api/contact/sales`

Form permintaan akses. Validasi server-side + penapisan 4 lapis.

```json
// Request
{
  "company": "PT Contoh Jaya",
  "name": "Budi Santoso",
  "email": "budi@contoh.co.id",
  "role": "CTO",
  "project": "mina",
  "budget_range": "Rp 10–25 juta",
  "urgency": "1–2 minggu",
  "message": "Butuh sistem serupa...",
  "honeypot": "",      // harus kosong
  "elapsed_ms": 45000  // waktu isi form
}

// 200 OK (selalu sukses — bot tidak belajar dari respons)
{ "ok": true }
```

Batas: **5 permintaan/menit per IP**. Verdict `block` tidak disimpan.

### `POST /api/analytics/track`

Catat event funnel.

```json
{ "event": "page_view", "project": "mina", "metadata": {} }
```

Event yang diterima: `page_view`, `modal_open`, `token_attempt`,
`token_success`, `token_fail`, `contact_sales`, `lead_submit`,
`session_create`, `content_view`.

Batas: **60 permintaan/menit per IP**.

---

## 6. Vitals (Core Web Vitals)

### `POST /api/vitals`

Metrik performa dari pengunjung nyata.

```json
{ "name": "lcp", "value": 1234, "rating": "good", "path": "/home" }
```

Nama metrik: `lcp`, `inp`, `cls`, `ttfb`, `fcp`.
Batas: **60 permintaan/menit per IP**.

---

## 7. Eksperimen A/B

### `GET /api/experiment/:slug?v=<visitor>`

Dapatkan varian untuk pengunjung (deterministik per visitor).

```json
{ "ok": true, "variant": "control" }
```

404 kalau eksperimen tidak berjalan.

### `POST /api/experiment/convert`

Catat konversi.

```json
{ "slug": "hero-test", "variant": "control", "event": "conversion", "visitor": "abc" }
```

---

## 8. Komentar (Review)

### `GET /api/comments?target=/home&resolved=0`

### `POST /api/comments`

```json
{ "target": "/home", "anchor": "hero-title", "body": "Perbesar judul?", "author": "reviewer" }
```

Batas: **10 permintaan/menit per IP**.

---

## 9. CMS (Publik — published saja)

### `GET /api/cms/collections`

### `GET /api/cms/:collection/items?limit=100`

### `GET /api/cms/:collection/items/:slug`

Draft **tidak pernah** terlihat tanpa kunci admin.

---

## 10. SEO / AEO

### `GET /api/seo/sitemap` — `application/xml`

### `GET /api/seo/robots` — `text/plain`

### `GET /api/seo/llms` — `text/plain` (llms.txt untuk AI)

### `GET /api/seo/jsonld` — structured data

---

## 11. Admin — Token

Semua butuh `X-Admin-Key`.

### `POST /api/admin/token/issue`

```json
{
  "project": "mina",
  "scopes": ["mina", "spareparts"],
  "tier": "standard",
  "expires_in_days": 30,
  "issued_to": "Budi Santoso",
  "company": "PT Contoh Jaya",
  "max_ips": 3,
  "max_devices": 3,
  "notes": "Pilot project"
}
```

**Token plaintext hanya muncul di respons ini** — tidak bisa dibaca lagi.
Slug proyek yang tidak dikenal ditolak dengan daftar pilihan.

### `POST /api/admin/token/revoke`

```json
{ "id": "tok_abc123", "reason": "Kontrak selesai" }
```

### `POST /api/admin/token/suspend` / `resume`

### `GET /api/admin/tokens?status=&tier=&project=&limit=`

**Filter didukung** — `status` (active/revoked/suspended), `tier`
(standard/enterprise), `project` (slug), `limit` (maks 500).

### `GET /api/admin/token/:id`

### `GET /api/admin/projects`

### `POST /api/admin/cleanup` — bersihkan sesi kedaluwarsa

---

## 12. Admin — Lead & Audit

### `GET /api/admin/leads?status=&limit=`

### `GET /api/admin/audit?limit=&token=&project=`

### `GET /api/admin/analytics/funnel?days=&project=`

### `GET /api/admin/analytics/events?limit=`

### `GET /api/admin/sla?days=`

### `GET /api/admin/export/audit?format=json|csv&limit=`

---

## 13. Admin — CMS

### `POST /api/admin/cms/collection`

```json
{ "slug": "catatan", "title": "Catatan", "fields": [{"name": "judul", "type": "text"}] }
```

### `POST /api/admin/cms/item`

```json
{ "collection": "catatan", "slug": "rilis-1", "data": {"judul": "..."}, "status": "draft" }
```

Setiap simpanan membuat **versi baru** — riwayat tidak pernah hilang.

### `POST /api/admin/cms/status` — draft → review → published → archived

### `POST /api/admin/cms/delete`

### `GET /api/admin/cms/versions/:collection/:slug`

### `POST /api/admin/cms/rollback` — `{ collection, slug, version }`

---

## 14. Admin — Performa

### `GET /api/admin/performance?days=7`

Ringkasan Core Web Vitals: p50/p75/p95 vs anggaran.

### `GET /api/admin/performance/assets`

Audit ukuran aset terhadap anggaran.

---

## 15. Admin — Kolaborasi (Branch)

### `GET /api/admin/branches`

### `GET /api/admin/branch/:name`

### `POST /api/admin/branch/create` — `{ name, base, message }`

### `POST /api/admin/branch/change` — catat perubahan tanpa menyentuh produksi

### `POST /api/admin/branch/merge` — terapkan ke produksi

### `POST /api/admin/branch/discard`

### `POST /api/admin/comment/resolve` — `{ id, resolved }`

---

## 16. Admin — Eksperimen

### `GET /api/admin/experiments`

### `GET /api/admin/experiment/:slug/results` — hasil + uji signifikansi

### `POST /api/admin/experiment` — `{ slug, name, variants, goal, status }`

---

## 17. Admin — Publish

### `GET /api/admin/preflight`

Pemeriksaan sebelum deploy: berkas wajib, anggaran performa, pemindaian
rahasia.

### `POST /api/admin/publish/verify` — `{ url, marker }`

Verifikasi URL publik benar-benar hidup (bukan asumsi).

### `POST /api/admin/release` — catat rilis

### `GET /api/admin/releases?limit=`

---

## Kode Error Umum

| Kode | Arti |
|------|------|
| `admin_key_salah` | Header `X-Admin-Key` salah/kosong |
| `proyek_tidak_valid` | Slug proyek tidak sesuai format |
| `proyek_tidak_dikenal` | Slug valid tapi tidak ada di daftar proyek |
| `token_diperlukan` | Tidak ada token di header/body |
| `token_tidak_valid` | Token tidak cocok dengan hash mana pun |
| `token_dicabut` | Token sudah dicabut |
| `token_kedaluwarsa` | Token lewat masa berlaku |
| `sesi_tidak_valid` | Cookie sesi kedaluwarsa/tidak cocok |
| `turnstile_gagal` | Verifikasi Turnstile tidak lolos |
| `batas_laju` | Terlalu banyak permintaan (429) |

---

## Batas Laju (Rate Limit)

| Endpoint | Batas |
|----------|-------|
| `/api/token/validate` | 20/menit |
| `/api/token/session` | 10/menit |
| `/api/contact/sales` | 5/menit |
| `/api/analytics/track` | 60/menit |
| `/api/vitals` | 60/menit |
| `/api/comments` | 10/menit |
| `/api/verify-turnstile` | 30/menit |

Melebihi batas → **429** dengan `{ "ok": false, "error": "batas_laju" }`.

---

## Auto-Revoke (Otomatis)

Token dicabut otomatis tanpa campur tangan admin kalau:

| Kondisi | Ambang |
|---------|--------|
| IP berbeda | > 3 IP / 24 jam |
| Permintaan | > 30 / menit |
| Kegagalan beruntun | ≥ 12 |

Pencabutan dicatat di tabel `revocations` dengan `automatic = 1`.
