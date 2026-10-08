# Setup Pembayaran — Midtrans

**Status:** kode selesai, menunggu kredensial
**Terakhir diperbarui:** 8 Oktober 2026

---

## Kenapa Midtrans

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

Midtrans berlisensi Bank Indonesia (bagian dari GoTo Financial) dan
**menerima merchant INDIVIDU dengan KTP saja** — tanpa PT, tanpa NPWP.

Dengan KTP saja: QRIS, GoPay, dan Virtual Account sudah tersedia. NPWP baru
diperlukan kalau mau kartu kredit.

---

## Yang Perlu Anda Lakukan

### 1. Daftar Midtrans

```
https://dashboard.midtrans.com/register
```

Butuh: KTP, NPWP (kalau ada), rekening bank atas nama sendiri/bisnis.

### 2. Ambil Dua Kredensial

Buka **Settings → Access Keys**:

```
MIDTRANS_SERVER_KEY  → mulai "SB-Mid-server-" (sandbox)
                        atau "Mid-server-" (production)
MIDTRANS_CLIENT_KEY  → pasangannya, untuk halaman checkout
```

**ServerKey itu penting.** Ia dipakai dua hal: memanggil API, DAN
memverifikasi tanda tangan webhook. Kalau bocor, orang bisa memalsukan
pembayaran.

### 3. Isi ke `service.env`

Berkas: `~/.portfolio-token/service.env`

```
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxx
MIDTRANS_PRODUCTION=false

CHECKOUT_SUKSES_URL=https://portfolio-victer.pages.dev/pesanan
CHECKOUT_BATAL_URL=https://portfolio-victer.pages.dev/pricing
```

### 4. Daftarkan Webhook di Dashboard Midtrans

**Settings → Configuration → Notification URL**

```
URL: https://portfolio-victer.pages.dev/api/midtrans/webhook
```

Aktifkan untuk: **Payment Notification**.

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
   Server buat Invoice di Midtrans
   (nominal dari backend/src/pricing.mjs — satu sumber)
3. → Pembeli diarahkan ke halaman Midtrans
   (QRIS / VA / GoPay / OVO / DANA / kartu)
4. → Bayar
5. → Midtrans kirim webhook ke /api/midtrans/webhook
6. → Server verifikasi token + jumlah
7. → Terbitkan token akses otomatis
8. → Token dikirim ke email pembeli
```

---

## Harga yang Dikirim ke Midtrans

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

## Keamanan: Tanda Tangan Terikat Isi Transaksi

Midtrans menandatangani setiap webhook dengan:

```
sha512(order_id + status_code + gross_amount + ServerKey)
```

**Ini lebih kuat daripada token statis.** Tanda tangannya terikat pada ISI
transaksi, jadi webhook palsu untuk transaksi BERBEDA tidak bisa dibuat
walaupun penyerang tahu satu signature yang valid. Ia harus tahu ServerKey —
yang tidak pernah keluar dari server.

Sudah diuji: mengubah `order_id` atau `gross_amount` di webhook membuat
tanda tangannya tidak cocok.

### Lapisan tambahan yang tetap ada

**1. Idempotensi** — kunci unik `{order_id}:{status}:{transaction_id}`.
Midtrans mengirim webhook berkali-kali untuk satu transaksi
(pending → settlement), masing-masing membawa informasi berbeda.

**2. Verifikasi jumlah** — `gross_amount` di webhook harus cocok dengan yang
tercatat. Kalau beda, token TIDAK diterbitkan. Ini menangkap kesalahan
KONFIGURASI (nominal yang dikirim berbeda dari yang tercatat).

**3. `capture` belum tentu lunas** — untuk kartu kredit, `capture` berarti
otorisasi berhasil tapi dana belum cair. Token hanya diterbitkan kalau
`fraud_status` = `accept`. Kalau nanti di-deny, pembeli sudah dapat akses
padahal tidak membayar.

## Format Webhook Midtrans

Midtrans mengirim objek transaksi langsung sebagai teratas (bukan dibungkus
`{id, type, data}` seperti Stripe):

```json
{
  "order_id": "pay_xxx",
  "transaction_status": "settlement",
  "status_code": "200",
  "gross_amount": "200000.00",
  "fraud_status": "accept",
  "transaction_id": "trx_xxx",
  "signature_key": "..."
}
```

| `transaction_status` | Aksi |
|---|---|
| `settlement` | Terbitkan token |
| `capture` + fraud `accept` | Terbitkan token |
| `capture` + fraud lain | Tunggu — belum lunas |
| `pending` | Dicatat saja |
| `expire` | Tandai kedaluwarsa |
| `deny` / `cancel` | Tandai gagal |
| `refund` | Tandai dikembalikan |

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
POST /api/midtrans/webhook    Terima webhook dari Midtrans
GET  /api/pembayaran/status   Apakah pembayaran sudah aktif?
```

---

## Berkas Terkait

```
backend/src/midtrans.mjs     Klien API Midtrans (HTTP, token, terjemahan error)
backend/src/checkout.mjs   Logika bisnis (harga, token, idempotensi)
backend/src/config.mjs     Konfigurasi + validasi
backend/src/db.mjs         Tabel payments + payment_events
backend/src/routes.mjs     4 rute di atas
```

**Pemisahan tanggung jawab:** `midtrans.mjs` tidak tahu apa itu "paket
Profesional", dan `checkout.mjs` tidak tahu cara memanggil API Midtrans. Kalau
penyedia diganti lagi, hanya `midtrans.mjs` yang berubah.

---

## Yang Belum Dibangun

| # | Item | Catatan |
|---|---|---|
| 1 | Tombol checkout di halaman harga | Sekarang masih ke form kontak |
| 2 | Halaman `/pesanan` setelah bayar | Menampilkan status + token |
| 3 | Kirim token lewat email | Sekarang token dikembalikan di log webhook |
| 4 | Perpanjangan otomatis | Belum ada; pembeli bayar lagi secara manual |
| 5 | Refund lewat API | Belum ada; lewat dashboard Midtrans |

---

## Pengujian

```bash
node /tmp/uji-midtrans.mjs
```

**40 pemeriksaan:** konfigurasi, harga, verifikasi tanda tangan (5 kasus),
pemetaan status (10 kasus), webhook palsu, pembayaran berhasil, kiriman
ulang, jumlah tidak cocok, expire, deny, capture belum lunas, pembayaran
tidak ada.

Yang paling penting: **jumlah tidak cocok → token tidak diterbitkan**.
