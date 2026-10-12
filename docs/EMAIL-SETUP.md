# Sistem Email Korporasi — Panduan Setup

Sistem email VIVASTIC sudah siap: **8 template profesional** dengan desain
korporat, preheader, versi teks, dan dukungan Outlook. Yang tersisa hanya
**menyalakan pengiriman** — butuh satu kunci API.

---

## Kondisi Sekarang

```
✅ Mesin pengiriman    siap (dua penyedia, pilih otomatis)
✅ 8 template          siap (lihat daftar di bawah)
✅ Desain              tabel + 600px + preheader + versi teks
✅ Perbaikan bug       kode hapus akun tidak lagi pakai template reset sandi
✅ Pratinjau           npm run email:preview
❌ Kredensial          BELUM DIISI — ini yang menghambat
```

**Kenapa belum bisa kirim:** tidak ada kunci API penyedia email. Kode sudah
siap; ia menunggu satu dari dua pilihan di bawah.

---

## Pilihan 1 — Resend (PALING MUDAH, bisa tanpa domain)

**Cocok kalau:** ingin cepat jalan, belum punya domain.

### Langkah

1. Daftar di **https://resend.com** (gratis, 3.000 email/bulan, 100/hari)
2. Buka **https://resend.com/api-keys** → **Create API Key**
3. Salin kunci (mulai `re_...`)
4. Tambahkan ke `~/.portfolio-token/service.env`:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=VIVASTIC <onboarding@resend.dev>
```

5. Restart + uji:

```bash
sudo systemctl restart portfolio-token.service
cd /home/ubuntu/portfolio-victer/backend
node src/admin-cli.mjs email-test --to victerphanjaya@gmail.com
```

### Batasan mode uji (penting)

Tanpa domain terverifikasi, Resend **hanya bisa mengirim ke email yang dipakai
mendaftar Resend**. Untuk membuka semua tujuan, verifikasi domain (Pilihan 3).

---

## Pilihan 2 — Cloudflare Email (perlu domain sendiri)

**Cocok kalau:** sudah punya domain di Cloudflare.

Token Cloudflare Anda **sudah terbaca sistem** (perbaikan baru), tapi belum
punya izin Email Sending. Yang perlu:

1. Buka **https://dash.cloudflare.com/profile/api-tokens**
2. **Create Token** → **Custom token**
3. Izin yang dibutuhkan:
   - `Account` → `Email Sending` → **Edit**
4. Tambahkan ke `~/.portfolio-token/service.env`:

```bash
CF_ACCOUNT_ID=33dc8afdebc36de42802c8092ece6aed
CF_API_TOKEN=token_baru_dengan_izin_email
EMAIL_FROM=noreply@domain-anda.com
```

> Sistem menerima DUA nama kunci: `CF_*` dan `CLOUDFLARE_*`.
> Perbaikan ini memperbaiki bug lama: token Anda tersimpan sebagai
> `CLOUDFLARE_API_TOKEN` tapi kode membacanya sebagai `CF_API_TOKEN` —
> sehingga tidak pernah terbaca.

---

## Pilihan 3 — Domain Email Gratis (paling korporat)

**Cocok kalau:** ingin alamat `@victer.is-a.dev` tanpa biaya.

Domain `victer.is-a.dev` **sudah milik Anda** dan is-a.dev **mendukung
record TXT + MX** — jadi bisa dipakai untuk email korporasi. Semuanya sudah
**otomatis lewat satu perintah**.

### ⚠️ Penting: kenapa pakai subdomain `send.`

`victer.is-a.dev` sudah dipakai situs lewat **CNAME**. Aturan DNS: CNAME
**tidak bisa** dicampur dengan MX/TXT di record set yang sama.

Solusinya (pola yang sudah dipakai domain lain di repo is-a.dev):

```
victer.is-a.dev                    → CNAME (situs, TIDAK diubah)
send.victer.is-a.dev               → MX + SPF (pengiriman email)
resend._domainkey.victer.is-a.dev  → DKIM (tanda tangan)
```

Hasilnya: alamat `noreply@send.victer.is-a.dev` — profesional, dan situs
sama sekali tidak terganggu.

### Cara otomatis (satu perintah)

```bash
# 1. Daftar gratis di resend.com → API Keys → Create
# 2. Isi kunci di service.env:
echo 'RESEND_API_KEY=re_xxxxxxxxxxxx' >> ~/.portfolio-token/service.env

# 3. Jalankan — semua langkah otomatis:
cd /home/ubuntu/portfolio-victer
node scripts/setup-domain-email.mjs --siapkan
```

Perintah itu melakukan **enam langkah**:

```
1. Tambah send.victer.is-a.dev ke akun Resend
2. Ambil record DNS (DKIM + SPF + MX) dari Resend
3. Susun berkas JSON untuk repo is-a.dev
4. Clone fork + salin berkas ke domains/
5. Commit + push ke cabang baru
6. Buat pull request dengan TEMPLATE YANG BENAR
```

> Langkah 6 penting: repo is-a.dev punya validator otomatis yang **menolak PR**
> kalau template-nya tidak diisi persis (termasuk komentar penandanya).
> Skrip sudah mengurus itu.

Setelah PR di-merge:

```bash
# 4. Minta Resend memeriksa DNS
node scripts/setup-domain-email.mjs --verifikasi

# 5. Cek status
node scripts/setup-domain-email.mjs --status

# 6. Isi pengirim + restart
echo 'EMAIL_FROM=VIVASTIC <noreply@send.victer.is-a.dev>' >> ~/.portfolio-token/service.env
sudo systemctl restart portfolio-token.service

# 7. Uji kirim sungguhan
cd backend && node src/admin-cli.mjs email-test --to victerphanjaya@gmail.com
```

**Hasil:** alamat email korporasi sungguhan, gratis, tanpa mengganggu situs.

> ⏱️ Waktu tunggu: PR is-a.dev direview **relawan** — bisa beberapa jam
> sampai beberapa hari. Setelah merge, DNS menyebar 1-5 menit.

---

## Daftar Template (8 buah)

| # | Template | Kapan dikirim |
|---|----------|---------------|
| 1 | Reset sandi | Pengguna lupa sandi |
| 2 | Kode hapus akun | Konfirmasi hapus akun (kode + peringatan) |
| 3 | Kode batal hapus | Pemulihan akun (sisa hari) |
| 4 | Selamat datang | Setelah pendaftaran |
| 5 | Masuk perangkat baru | Peringatan keamanan |
| 6 | Struk pembayaran | Otomatis setelah bayar (Midtrans) |
| 7 | Akun dinonaktifkan | Masa tenggang dimulai |
| 8 | Kode masuk | Verifikasi 2FA |

### Lihat desainnya

```bash
cd /home/ubuntu/portfolio-victer
npm run email:preview
# lalu buka file:///home/ubuntu/portfolio-victer/preview-email.html
```

Halaman itu menampilkan semua template dalam iframe — bisa diperiksa di
ukuran ponsel sebelum satu email pun dikirim.

---

## Spesifikasi Desain (standar korporat)

```
Layout       <table role="presentation">   → kompatibel Outlook (mesin render Word)
Lebar        600px                          → standar email transaksional
Preheader    tersembunyi di atas            → pratinjau informatif di daftar masuk
Mode gelap   color-scheme: dark             → cegah pembalikan warna otomatis
Tombol       VML fallback                   → tombol tampil benar di Outlook
Versi teks   WAJIB, dibuat berdampingan     → skor spam + klien teks + pembaca layar
Warna        #f5c542 emas · #0a0a0b gelap   → sama dengan situs
```

---

## Pemecahan Masalah

### Email tidak sampai

1. **Periksa folder spam** — pengirim baru sering masuk spam
2. **Cek konfigurasi:**
   ```bash
   cd /home/ubuntu/portfolio-victer/backend
   node src/admin-cli.mjs email-test --to alamat@anda.com
   ```
   Perintah ini menampilkan penyedia aktif + hasil kirim + penyebab gagal.
3. **Resend tanpa domain:** tujuan harus email pendaftar Resend
4. **Cloudflare:** domain belum di-onboard untuk Email Sending

### Cek log

```bash
sudo journalctl -u portfolio-token.service --since "10 minutes ago" | grep email
```

### Kalau email gagal, alur pengguna TETAP jalan

Sistem ini dirancang begitu: kegagalan email **tidak melempar error**.
Kode/token penting ditulis ke log server sebagai cadangan, supaya pengguna
tidak terjebak.

```
[email] GAGAL kirim reset-sandi ke x@y.id: resend_403: ...
[email] CADANGAN reset-sandi untuk x@y.id: TAUTAN RESET MANUAL → https://...
```

---

## Ringkasan Perintah

```bash
# Pratinjau desain
npm run email:preview

# Uji kirim (perintah baru)
cd backend && node src/admin-cli.mjs email-test --to alamat@anda.com

# Lihat log
sudo journalctl -u portfolio-token.service -f | grep -i email

# Restart setelah mengubah service.env
sudo systemctl restart portfolio-token.service
```
