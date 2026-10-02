# Layanan Token Portofolio — Panduan Operasional

Panduan untuk pemilik portofolio: cara menerbitkan token akses, mencabutnya, dan
membaca catatan akses.

**Live:** https://victerhong.github.io
**Halaman proyek:** https://victerhong.github.io/projects/mina/

---

## Arsitektur singkat

```
Pengunjung → GitHub Pages (statis, publik)
                ↓ token dimasukkan
             Tunnel Cloudflare
                ↓
         Layanan token di VPS (port 8788)
                ↓ token valid → set session cookie
         Konten terkunci dikirim (cookie-based)
```

Konten sensitif **tidak pernah** ada di GitHub. Ia hidup di VPS di
`~/.portfolio-token/content/<slug>.json` dan hanya dikirim setelah session cookie
atau token lolos verifikasi.

---

## Perintah sehari-hari

Semua perintah dijalankan dari `/home/ubuntu/portfolio-victer/backend`.

### Menerbitkan token

```bash
# Token standard (1 proyek)
node src/admin-cli.mjs issue --project mina --to "PT Contoh Teknologi" --days 30

# Token enterprise (multi-project)
node src/admin-cli.mjs issue --project mina --tier enterprise \
  --scopes mina,spareparts --company "PT Besar" --days 90
```

| Opsi | Arti |
|------|------|
| `--project <slug>` | Proyek utama token |
| `--tier standard\|enterprise` | Tier akses (default: standard) |
| `--scopes <slug1,slug2>` | Proyek lain yang bisa diakses |
| `--to "<nama>"` | Untuk siapa token ini |
| `--company "<nama>"` | Nama perusahaan (untuk watermark) |
| `--days <n>` | Masa berlaku. Kosongkan = tanpa kedaluwarsa |
| `--max-ips <n>` | Batas alamat IP berbeda (default 3) |
| `--max-devices <n>` | Batas sesi aktif (default 3) |
| `--notes "<teks>"` | Catatan internal |

**Token hanya ditampilkan sekali.** Format baru: `VP-XXXX-XXXX-XXXX-XXXX`.
Salin dan kirim ke penerima saat itu juga. Kalau terlewat, cabut dan terbitkan
yang baru.

### Melihat daftar token

```bash
node src/admin-cli.mjs list
node src/admin-cli.mjs list --project mina --status active --tier enterprise
```

### Mencabut token

```bash
node src/admin-cli.mjs revoke --id tok_abc123 --reason "kontrak selesai"
```

Pencabutan berlaku seketika. Semua sesi aktif token tersebut juga dihapus.

### Melihat siapa mengakses apa

```bash
node src/admin-cli.mjs audit --limit 30
node src/admin-cli.mjs audit --project mina
node src/admin-cli.mjs audit --token tok_abc123
```

### Melihat permintaan akses masuk

```bash
node src/admin-cli.mjs leads
```

---

## Mengisi konten terkunci

Berkas per proyek di `~/.portfolio-token/content/<slug>.json`:

```json
{
  "slug": "mina",
  "title": "MINA — Detail Arsitektur",
  "sections": [
    { "heading": "Judul bagian", "body": "Isi bagian ini." }
  ]
}
```

Setelah menyimpan berkas, tidak perlu restart — konten dibaca saat diminta.

Slug hanya boleh huruf kecil, angka, dan tanda hubung. Slug dengan `/` atau `..`
ditolak.

---

## Bagaimana token dicabut otomatis

Layanan memeriksa empat sinyal setiap kali token dipakai. Melanggar salah satu =
token langsung dicabut, tanpa peringatan.

| Sinyal | Ambang default | Artinya |
|--------|----------------|---------|
| Alamat IP berbeda | > 3 dalam 24 jam | Token dibagikan |
| Request per menit | > 30 | Konten diambil massal |
| Percobaan gagal beruntun | ≥ 12 | Token ditebak |
| Sesi aktif | > maxDevices | Token dipakai di terlalu banyak device |

Angka-angka ini diatur di `~/.portfolio-token/service.env`.

### Menyesuaikan ambang

Ubah berkas `~/.portfolio-token/service.env`, lalu:

```bash
sudo systemctl restart portfolio-token
```

| Kunci | Default | Arti |
|-------|---------|------|
| `MAX_DISTINCT_IPS` | 3 | Batas IP berbeda |
| `IP_WINDOW_HOURS` | 24 | Jendela waktu perhitungan IP |
| `RATE_LIMIT_PER_MINUTE` | 30 | Batas request per menit |
| `MAX_FAILED_ATTEMPTS` | 12 | Batas kegagalan beruntun |
| `MAX_DEVICES` | 3 | Batas sesi aktif per token |
| `SESSION_DURATION_HOURS` | 24 | Durasi session cookie |
| `ALLOWED_ORIGINS` | `https://victerhong.github.io` | Origin yang boleh mengakses API |

---

## Layanan yang berjalan

| Layanan | Fungsi | Perintah |
|---------|--------|----------|
| `portfolio-token` | Layanan token + session | `sudo systemctl status portfolio-token` |
| `portfolio-tunnel` | Tunnel Cloudflare + publikasi URL | `sudo systemctl status portfolio-tunnel` |

### Kalau ada masalah

```bash
# Lihat log
sudo journalctl -u portfolio-token -n 50 --no-pager
tail -30 /home/ubuntu/.hermes/logs/portfolio-tunnel.log

# Restart
sudo systemctl restart portfolio-token portfolio-tunnel

# Uji langsung
curl -s http://127.0.0.1:8788/api/health
```

### Alamat backend berubah

Quick tunnel Cloudflare memberi URL acak yang berubah saat restart. Skrip tunnel
mendeteksi URL baru dan otomatis menulisnya ke `backend-url.json` di repo, lalu push.
Frontend membaca berkas itu setiap kali halaman dibuka.

---

## Keamanan

- Token disimpan **hanya sebagai hash** (SHA-256 + salt). Bocornya database tidak
  langsung membuat token bisa dipakai.
- Session cookie: **httpOnly, Secure, SameSite=None** — tidak bisa diakses JS.
- Rahasia ada di `~/.portfolio-token/service.env` dengan izin `600`, di luar repo.
- API hanya menerima permintaan dari origin yang terdaftar (CORS).
- Layanan hanya mendengarkan di `127.0.0.1`; akses publik lewat tunnel.
- Konten terkunci tidak ada di HTML statis.
- Dynamic watermark: nama perusahaan + tier ditampilkan di konten terbuka.

### Kalau ada token yang bocor

```bash
node src/admin-cli.mjs revoke --id tok_xxx --reason "bocor, diganti"
node src/admin-cli.mjs issue --project mina --to "PT Contoh" --days 30
```

---

## Menambah proyek baru

1. Buat folder `projects/<slug>/index.html` — salin dari `projects/mina/index.html`
   dan sesuaikan teksnya.
2. Tambahkan `gated: true` pada proyek di `src/data/projects.js`.
3. Isi konten terkunci di `~/.portfolio-token/content/<slug>.json`.
4. Terbitkan token dengan `--project <slug>`.
5. Commit dan push. Tidak ada langkah build.
