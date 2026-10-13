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
GET  /api/checkout/konteks    Siapa yang masuk & apakah perlu step-up 2FA
POST /api/checkout/2fa        Step-up: verifikasi kode, buka jendela sudo
POST /api/checkout            Mulai pembayaran (WAJIB sesi + email akun + sudo)
GET  /api/pesanan/:id         Cek status pembayaran (menyertakan url_pembayaran
                              saat masih pending, untuk tombol "lanjutkan")
POST /api/midtrans/webhook    Terima webhook dari Midtrans
GET  /api/pembayaran/status   Apakah pembayaran sudah aktif?
```

── CATATAN HOST MIDTRANS ────────────────────────────────────────────────────

Snap dan API v2 memakai HOST BERBEDA, dan tertukar berarti 404 HTML (bukan
JSON) sehingga pemeriksaan status selalu gagal:

```
Snap    (buat transaksi)   app.midtrans.com        / app.sandbox.midtrans.com
API v2  (status, cancel)   api.midtrans.com        / api.sandbox.midtrans.com
```

── CATATAN IDEMPOTENSI ──────────────────────────────────────────────────────

Kunci idempotensi dari browser menjadi `order_id` Midtrans DAN
`payments.idempotency_key` (UNIK). Percobaan ulang dengan kunci yang sama
mengembalikan `payment_url` yang TERSIMPAN — bukan membuat transaksi Snap
baru. Ini perlu karena API status v2 tidak mengenal transaksi Snap yang belum
dibuka pembeli ("Transaction doesn't exist"), jadi URL-nya tidak bisa diambil
kembali dari Midtrans.

---

## Berkas Terkait

```
backend/src/midtrans.mjs     Klien API Midtrans (Snap + API v2, terjemahan error)
assets/js/pricing.js         Tombol paket → dialog email → POST /api/checkout
assets/js/pesanan.js         Halaman /pesanan — baca status dari /api/pesanan/:id
pesanan.html                 Halaman status setelah pembayaran
backend/src/checkout.mjs   Logika bisnis (harga, token, idempotensi)
backend/src/config.mjs     Konfigurasi + validasi
backend/src/db.mjs         Tabel payments + payment_events
backend/src/routes.mjs     4 rute di atas
```

**Pemisahan tanggung jawab:** `midtrans.mjs` tidak tahu apa itu "paket
Profesional", dan `checkout.mjs` tidak tahu cara memanggil API Midtrans. Kalau
penyedia diganti lagi, hanya `midtrans.mjs` yang berubah.

---

## Alur checkout (sudah jalan)

```
/pricing                Tombol paket → dialog (assets/js/pricing.js)
   ↓ GET  /api/checkout/konteks   siapa yang masuk? perlu 2FA?
   │
   ├─ belum masuk  → /sign-in?lanjut=/pricing?paket=…  (pembelian TIDAK anonim)
   ├─ perlu 2FA    → POST /api/checkout/2fa  (step-up, buka jendela sudo 30 menit)
   └─ siap         → POST /api/checkout
   ↓ server membuat transaksi Snap → { url }
halaman pembayaran Midtrans
   ↓ selesai
/pesanan                Midtrans mengembalikan ke CHECKOUT_SUKSES_URL;
                        halaman membaca status dari GET /api/pesanan/:id
```

### Gerbang korporat di /api/checkout

Tiga pemeriksaan, berurutan, SEMUA di server (klien tidak dipercaya):

| # | Aturan | Jawaban kalau gagal |
|---|---|---|
| 1 | Wajib sesi | `401 belum_masuk` + `saran: masuk` |
| 2 | Email harus akun yang sedang masuk | `403 email_tidak_cocok` + `email_sesi` |
| 3 | Kalau 2FA aktif, sesi harus sudah step-up | `403 perlu_2fa` + `saran: verifikasi_2fa` |

Email & nama diambil dari AKUN, bukan dari body permintaan — body bisa berisi
apa saja. Tanpa aturan (2), pengguna yang masuk sebagai a@perusahaan.com bisa
memulai pembayaran atas nama b@perusahaan.com hanya dengan mengetik emailnya,
dan token aksesnya terbit untuk b.

### Step-up 2FA (pola GitHub sudo mode)

Kolom `sessions.sudo_until` menyimpan batas waktu sampai kapan SESI ini boleh
melakukan aksi sensitif tanpa memasukkan kode lagi. Jendelanya 30 menit
(`SUDO_MS` di `sessions.mjs`).

- **Login yang baru melewati 2FA** langsung membuka jendela sudo — pengguna
  tidak diminta kode dua kali berturut-turut.
- **Sesi token biasa** (atau sesi lama) mulai dengan `sudo_until = 0`; aksi
  sensitif akan meminta kode lebih dulu.
- **Sudo melekat pada SESI, bukan token.** Membuka sudo di laptop tidak
  membuka sudo di ponsel — kalau disimpan di token, satu verifikasi akan
  membuka semua perangkat sekaligus.
- **Endpoint step-up tidak memakai Turnstile.** Ia hanya bisa dipanggil dengan
  cookie sesi sah, dan `verifikasi2fa` sudah membatasi 5 percobaan gagal →
  identitas diblokir sementara. Dialog pembayaran tidak merender widget
  Turnstile, jadi memaksanya berarti step-up SELALU gagal (`token_kosong`) dan
  pembeli ber-2FA tidak akan pernah bisa membayar.

Kunci idempotensi dibuat sekali saat dialog dibuka dan dipakai ulang untuk
setiap percobaan ulang — order_id Midtrans yang sama tidak menghasilkan
transaksi kedua.

---

## Yang Belum Dibangun

| # | Item | Catatan |
|---|---|---|
| 1 | Kirim token lewat email | Struk sudah dikirim (`kirimStrukPembayaran`), tapi token aksesnya belum ikut — untuk sekarang hanya ada di log webhook |
| 2 | Perpanjangan otomatis | Belum ada; pembeli bayar lagi secara manual |
| 3 | Refund lewat API | Belum ada; lewat dashboard Midtrans |

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
