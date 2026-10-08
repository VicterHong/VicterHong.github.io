# Setup Pembayaran — Xendit

**Status:** kode selesai, menunggu kredensial
**Terakhir diperbarui:** 8 Oktober 2026

---

## Kenapa Xendit, Bukan Stripe

Stripe **tidak mendukung Indonesia secara penuh** — statusnya *preview*
(undangan saja). Kebanyakan bisnis Indonesia tidak bisa mendaftar sendiri,
dan yang di-approve hanya settle IDR lewat metode lokal.

Jalan "pakai rekening Payoneer" **tidak sah**. Stripe mensyaratkan empat hal
sekaligus:

```
1. Badan hukum terdaftar di negara itu    (PT/CV di negara tersebut)
2. NPWP / Tax ID negara itu               (EIN untuk US)
3. Alamat fisik yang bisa terima surat    (bukan PO Box)
4. Rekening bank FISIK di negara itu      (bukan virtual account)
```

Payoneer hanya menjawab nomor 4 — dan Stripe secara eksplisit
**mengecualikan virtual account** untuk jalur ini. Kalau dipaksa, akunnya bisa
dibekukan setelah ada pembayaran masuk.

Xendit berlisensi Bank Indonesia, settle IDR langsung ke rekening bank
Indonesia, dan mendukung metode yang memang dipakai pembeli Indonesia:
QRIS, VA (BCA/Mandiri/BNI/BRI), GoPay, OVO, DANA, ShopeePay, kartu.

---

## Yang Perlu Anda Lakukan

### 1. Daftar Xendit

```
https://dashboard.xendit.co/register
```

Butuh: KTP, NPWP (kalau ada), rekening bank atas nama sendiri/bisnis.

### 2. Ambil Dua Kredensial

Buka **Settings → Developers → API Keys**:

```
XENDIT_SECRET_KEY      → mulai dengan "xnd_development_" (test)
                          atau "xnd_production_" (live)
XENDIT_CALLBACK_TOKEN  → ada di Settings → Developers → Webhooks
```

**Callback token itu penting.** Tanpa itu, endpoint webhook kita terbuka —
siapa pun yang tahu URL-nya bisa mengirim "pembayaran berhasil" palsu dan
mendapat token akses gratis.

### 3. Isi ke `service.env`

Berkas: `~/.portfolio-token/service.env`

```
XENDIT_SECRET_KEY=xnd_development_xxxxxxxxxxxx
XENDIT_CALLBACK_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx

CHECKOUT_SUKSES_URL=https://portfolio-victer.pages.dev/pesanan
CHECKOUT_BATAL_URL=https://portfolio-victer.pages.dev/pricing
```

### 4. Daftarkan Webhook di Dashboard Xendit

**Settings → Developers → Webhooks → Invoices**

```
URL: https://portfolio-victer.pages.dev/api/xendit/webhook
```

Pilih event: **Invoice paid**, **Invoice expired**, **Invoice failed**.

### 5. Restart Backend

```bash
sudo systemctl restart portfolio-token.service
```

### 6. Verifikasi

```bash
curl -s http://127.0.0.1:8788/api/pembayaran/status | python3 -m json.tool
```

Yang diharapkan: `"aktif": true`.

---

## Cara Kerjanya

```
1. Pembeli klik "Mulai dari sini" di halaman harga
2. → POST /api/checkout
   Server buat Invoice di Xendit
   (nominal dari backend/src/pricing.mjs — satu sumber)
3. → Pembeli diarahkan ke halaman Xendit
   (QRIS / VA / GoPay / OVO / DANA / kartu)
4. → Bayar
5. → Xendit kirim webhook ke /api/xendit/webhook
6. → Server verifikasi token + jumlah
7. → Terbitkan token akses otomatis
8. → Token dikirim ke email pembeli
```

---

## Harga yang Dikirim ke Xendit

Angka diambil dari `backend/src/pricing.mjs` — sumber yang **sama** dengan
yang ditampilkan di halaman harga.

| Paket | Periode | Dibayar | Per bulan |
|---|---|---|---|
| Standar | Bulanan | Rp 63.200 | Rp 63.200 |
| Standar | Tahunan | Rp 711.000 | Rp 59.250 |
| Profesional | Bulanan | Rp 200.000 | Rp 200.000 |
| Profesional | Tahunan | Rp 2.250.000 | Rp 187.500 |

**IDR itu zero-decimal.** Rp 200.000 dikirim sebagai `200000`, bukan
`20000000`. Salah satu nol saja berarti 10x salah tagih.

---

## Tiga Lapisan Keamanan

Xendit memakai **token statis** di header `x-callback-token` — sama di setiap
request. Ini **berbeda dari Stripe** yang menandatangani setiap webhook dengan
HMAC.

Konsekuensinya: token saja tidak cukup. Yang melindungi integrasi ini:

### 1. Verifikasi Token

Token dibandingkan dengan `timingSafeEqual` — waktu eksekusi tidak
membocorkan berapa karakter yang sudah benar.

### 2. Idempotensi

Kunci unik: `{invoice_id}:{status}`. Xendit mengirim webhook berkali-kali
untuk satu invoice (PENDING → PAID) — masing-masing membawa informasi berbeda,
jadi kuncinya gabungan, bukan hanya invoice ID.

### 3. Verifikasi Jumlah

**Ini yang paling penting** — dan tidak ada di Stripe karena Stripe sudah
menandatangani body-nya.

Xendit tidak menandatangani body. Jadi kalau nominal di webhook berbeda dari
yang tercatat, token **TIDAK diterbitkan** dan kejadiannya ditandai untuk
diperiksa manual.

Sudah diuji: pembayaran dengan nominal tidak cocok berhasil ditahan.

---

## Format Webhook Xendit

Berbeda dari Stripe yang membungkus event dalam `{id, type, data}`, Xendit
mengirim **invoice langsung** sebagai objek teratas:

```json
{
  "id": "inv_xxx",
  "external_id": "pay_xxx",
  "status": "PAID",
  "amount": 200000,
  "paid_amount": 200000,
  "payer_email": "pembeli@contoh.id"
}
```

Jadi tidak ada `event.type` — yang menentukan adalah `status`:

| Status Xendit | Aksi |
|---|---|
| `PAID` | Terbitkan token |
| `SETTLED` | Terbitkan token (kalau belum) |
| `PENDING` | Dicatat saja |
| `EXPIRED` | Tandai kedaluwarsa |
| `FAILED` | Tandai gagal |

**Kenapa `PAID` dan `SETTLED` sama-sama menerbitkan token:** `PAID` = pembeli
sudah membayar. `SETTLED` = uang sudah masuk rekening. Untuk penerbitan token,
yang penting adalah `PAID` — menunggu `SETTLED` berarti pembeli menunggu 1-2
hari kerja, dan itu tidak perlu.

---

## Masa Berlaku Token

```
Bulanan : 35 hari  (30 + 5 hari tenggang)
Tahunan : 370 hari (365 + 5)
```

**Kenapa ada tenggang 5 hari:** supaya pembeli tidak langsung kehilangan akses
kalau perpanjangan telat sehari. Perpanjangan otomatis belum dibangun — untuk
sekarang, pembeli membayar lagi dan token baru diterbitkan.

---

## Endpoint

```
POST /api/checkout            Mulai pembayaran
GET  /api/pesanan/:id         Cek status pembayaran
POST /api/xendit/webhook      Terima webhook dari Xendit
GET  /api/pembayaran/status   Apakah pembayaran sudah aktif?
```

---

## Berkas Terkait

```
backend/src/xendit.mjs     Klien API Xendit (HTTP, token, terjemahan error)
backend/src/checkout.mjs   Logika bisnis (harga, token, idempotensi)
backend/src/config.mjs     Konfigurasi + validasi
backend/src/db.mjs         Tabel payments + payment_events
backend/src/routes.mjs     4 rute di atas
```

**Pemisahan tanggung jawab:** `xendit.mjs` tidak tahu apa itu "paket
Profesional", dan `checkout.mjs` tidak tahu cara memanggil API Xendit. Kalau
penyedia diganti lagi, hanya `xendit.mjs` yang berubah.

---

## Yang Belum Dibangun

| # | Item | Catatan |
|---|---|---|
| 1 | Tombol checkout di halaman harga | Sekarang masih ke form kontak |
| 2 | Halaman `/pesanan` setelah bayar | Menampilkan status + token |
| 3 | Kirim token lewat email | Sekarang token dikembalikan di log webhook |
| 4 | Perpanjangan otomatis | Belum ada; pembeli bayar lagi secara manual |
| 5 | Refund lewat API | Belum ada; lewat dashboard Xendit |

---

## Pengujian

```bash
node /tmp/uji-xendit.mjs
```

**34 pemeriksaan:** konfigurasi, harga, verifikasi token, pemetaan status,
webhook palsu, pembayaran berhasil, jumlah tidak cocok, expired, failed,
pembayaran tidak ada, status pending.

Yang paling penting: **jumlah tidak cocok → token tidak diterbitkan**.
