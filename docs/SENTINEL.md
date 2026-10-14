# SentinelLite — Gateway Webhook Mandiri

Infrastruktur integrasi sendiri, bukan memakai alat pihak ketiga.

Sentinel menerima webhook dari layanan luar, **memverifikasi tanda tangannya**,
menyimpannya di antrean persisten, lalu mengirimkannya ke tujuan dengan
**percobaan ulang otomatis** dan **pemutus sirkuit per tujuan**.

---

## Kenapa ini ada

Webhook adalah cara layanan luar memberi tahu kita bahwa sesuatu terjadi:
pembayaran berhasil, kode di-push, pesan masuk. Masalahnya:

- **Tanda tangan palsu.** Tanpa verifikasi, siapa pun yang tahu URL kita bisa
  mengirim "pembayaran berhasil" dan mendapat akses gratis.
- **Layanan tujuan mati.** Kalau penerima sedang down, webhook hilang — dan
  tidak ada yang tahu sampai ada yang mengeluh.
- **Server tujuan gangguan beruntun.** Mencoba terus ke endpoint yang sedang
  mati membuang CPU dan waktu tunggu.

Sentinel menutup ketiganya.

---

## Alur

```
Layanan luar (Stripe / GitHub / Telegram)
   │
   │  POST /api/sentinel/masuk/<sumber>
   ▼
┌──────────────────────────────────────────────────┐
│ 1. Sumber dikenal?      tidak → 404             │
│ 2. Secret disetel?      tidak → 404 (nonaktif)  │
│ 3. Body ≤ 256 KB?       tidak → 413             │
│ 4. Tanda tangan sah?    tidak → 401             │
│ 5. Masuk antrean (SQLite WAL)                   │
└──────────────────────────────────────────────────┘
   │
   │  worker tiap 15 detik
   ▼
┌──────────────────────────────────────────────────┐
│ Sirkuit terbuka?  → dilewati (hemat CPU)        │
│ Kirim → sukses    → selesai                     │
│       → gagal     → backoff, coba lagi          │
│       → habis     → masuk DLQ                   │
└──────────────────────────────────────────────────┘
```

---

## Konfigurasi

Semua di `~/.portfolio-token/service.env`:

```bash
# Secret per sumber. KOSONG = sumber nonaktif.
SENTINEL_STRIPE_SECRET=whsec_...
SENTINEL_GITHUB_SECRET=...
SENTINEL_TELEGRAM_SECRET=...
SENTINEL_HMAC_SECRET=...

# Ke mana webhook diteruskan. Kosong = dicatat saja, tidak dikirim.
SENTINEL_TUJUAN_URL=https://layanan-anda.example.com/hook

# Jeda antar putaran worker (ms). Default 15000.
SENTINEL_INTERVAL_MS=15000
```

**Kenapa satu secret per sumber, bukan satu untuk semua:** kalau semua sumber
memakai secret yang sama, satu kebocoran membuka semuanya. Dengan secret
terpisah, GitHub yang bocor tidak membuat penyerang bisa memalsukan Stripe.

Setelah mengubah: `sudo systemctl restart portfolio-token.service`

---

## Daftarkan URL di penyedia

URL masuk berbentuk:

```
https://<domain>/api/sentinel/masuk/<sumber>
```

| Sumber | URL masuk | Header tanda tangan |
|---|---|---|
| Stripe | `/api/sentinel/masuk/stripe` | `Stripe-Signature` |
| GitHub | `/api/sentinel/masuk/github` | `X-Hub-Signature-256` |
| Telegram | `/api/sentinel/masuk/telegram` | `X-Telegram-Bot-Api-Secret-Token` |
| HMAC | `/api/sentinel/masuk/hmac` | `X-Signature` |
| Midtrans | `/api/midtrans/webhook` | (di dalam body) |

**Bentuk URL ini bisa dilihat di inspector** — halaman `/sentinel` menampilkan
URL lengkap tiap sumber yang aktif. Tidak perlu menebak.

---

## Verifikasi cepat

```bash
# Tanpa secret yang benar, endpoint menolak. 401 = hidup dan memverifikasi.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{}' \
  https://<domain>/api/sentinel/masuk/stripe

# Sumber tidak dikenal dijawab 404 — sama seperti URL yang tidak ada.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{}' \
  https://<domain>/api/sentinel/masuk/penyusup
```

---

## Inspector

Halaman `/sentinel` — **hanya dari loopback**, sama seperti `/admin`.

```bash
ssh -L 8789:127.0.0.1:8788 ubuntu@vps
```

Lalu buka `http://localhost:8789/sentinel` dan masukkan `ADMIN_KEY`.

Yang bisa dilakukan:

- Lihat payload masuk, header, dan latensi tiap pesan
- Kirim ulang pesan yang gagal
- Pantau sirkuit per tujuan, termasuk hitung mundur sampai uji berikutnya
- Tutup paksa sirkuit yang sedang terbuka
- Lihat URL masuk tiap sumber untuk didaftarkan di penyedia

**Kenapa dibatasi loopback:** halaman ini memuat body webhook — data
pembayaran, email pelanggan, ID pesanan. Dan tombolnya bisa memicu pengiriman
ke layanan luar.

---

## Mekanisme

### Backoff

Jendela tunggu naik bertingkat: **30s → 60s → 2m → 5m → 10m → 30m**.

Dengan **jitter 20%** — tiap jeda diacak ±20%. Tanpa jitter, semua pesan yang
gagal bersamaan akan dicoba lagi pada detik yang sama, dan server tujuan
menerima ledakan permintaan sekaligus.

### Dead-Letter Queue

Setelah 6 percobaan, pesan masuk DLQ. **Tidak dihapus** — pesan DLQ justru
yang paling perlu disimpan: itu bukti ada yang salah, dan mungkin perlu
dikirim ulang setelah diperbaiki.

Pembersih otomatis (`bersihkanSelesai`) hanya menghapus pesan yang **berhasil**
dan sudah lebih tua dari 7 hari.

### Circuit breaker

Per endpoint tujuan. Setelah **5 kegagalan beruntun**, sirkuit terbuka dan
pengiriman ke endpoint itu dihentikan sementara.

Tiga keadaan:

- **Tertutup** (normal) — pengiriman lewat
- **Terbuka** (diputus) — pengiriman dilewati, hemat CPU dan waktu tunggu
- **Setengah terbuka** (menguji) — **satu** percobaan diizinkan. Berhasil →
  tertutup lagi. Gagal → terbuka lagi dengan jendela tunggu lebih panjang.

Sirkuit diperiksa **sebelum** pesan diambil dari antrean. Kalau tidak, semua
pesan terlanjur terambil dan sirkuitnya tidak berguna.

### Idempotensi

Dua lapis:

1. **ID peristiwa** dari provider (Stripe: `payload.id`, GitHub:
   `X-GitHub-Delivery`)
2. **Sidik jari isi** — untuk provider yang tidak mengirim ID (Telegram)

ID peristiwa **mengalah** atas sidik jari: dua peristiwa berbeda dengan isi
identik tetap diterima.

Kiriman ulang tetap dijawab **200**, bukan ditolak. Kalau dijawab non-2xx,
provider akan mengirim ulang terus sampai menyerah.

---

## Keamanan

| Aspek | Bagaimana |
|---|---|
| Tanda tangan palsu | Ditolak **sebelum** apa pun disimpan |
| Sumber tidak dikenal | 404 — tidak membocorkan sumber mana yang terpasang |
| Sumber nonaktif | 404 — sama, tidak membedakan |
| Perbandingan tanda tangan | `timingSafeEqual` — mencegah timing attack |
| Replay attack | Toleransi timestamp 300 detik (Stripe) |
| Header bocor | Daftar putih — `authorization`/`cookie` tidak diteruskan |
| Body di log | **Tidak pernah** — memuat data pembayaran dan pribadi |
| Path traversal | Daftar putih aset, bukan gabung path |
| Isi payload di UI | `textContent`, bukan `innerHTML` |
| Halaman inspector | Hanya loopback, CSP ketat, `noindex` |

---

## Tes

```bash
cd backend
node --test test/sentinel-*.test.mjs        # unit
node test/sentinel-alur-lengkap.mjs         # alur end-to-end
node test/sentinel-masuk-http.mjs           # HTTP sungguhan
```

Yang paling penting diuji: **payload palsu ditolak sebelum tersimpan.** Kalau
itu gagal, seluruh modul ini tidak ada gunanya.

---

## Kalau ada yang tidak jalan

**Webhook tidak sampai.** Cek URL-nya dulu:
`curl -s -o /dev/null -w '%{http_code}\n' -X POST ...` → harus **401**.
**404 berarti URL-nya salah.**

**Antrean penuh tapi tidak bergerak.** Cek `SENTINEL_TUJUAN_URL` — kalau
kosong, worker tidak jalan dan pesan hanya dicatat.

**Sumber tidak aktif.** Secret-nya belum disetel. Cek di inspector: kartu
sumber yang abu-abu berarti nonaktif.
