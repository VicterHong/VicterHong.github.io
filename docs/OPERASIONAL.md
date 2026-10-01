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
                ↓ token valid
         Konten terkunci dikirim
```

Konten sensitif **tidak pernah** ada di GitHub. Ia hidup di VPS di
`~/.portfolio-token/content/<slug>.json` dan hanya dikirim setelah token lolos.

---

## Perintah sehari-hari

Semua perintah dijalankan dari `/home/ubuntu/portfolio-victer/backend`.

### Menerbitkan token

```bash
node src/admin-cli.mjs issue --project mina --to "PT Contoh Teknologi" --days 30
```

| Opsi | Arti |
|------|------|
| `--project <slug>` | Proyek yang dibuka (`mina`, `spareparts`) |
| `--to "<nama>"` | Untuk siapa token ini — muncul di audit log |
| `--label "<teks>"` | Catatan singkat |
| `--days <n>` | Masa berlaku. Kosongkan untuk tanpa kedaluwarsa |
| `--max-ips <n>` | Batas alamat IP berbeda (default 3) |
| `--notes "<teks>"` | Catatan internal |

**Token hanya ditampilkan sekali.** Salin dan kirim ke penerima saat itu juga.
Kalau terlewat, cabut dan terbitkan yang baru — tidak ada cara melihatnya kembali.

### Melihat daftar token

```bash
node src/admin-cli.mjs list
node src/admin-cli.mjs list --project mina --status active
```

### Mencabut token

```bash
node src/admin-cli.mjs revoke --id tok_abc123 --reason "kontrak selesai"
```

Pencabutan berlaku seketika. Pengunjung yang sedang membuka konten tetap melihatnya
sampai halaman dimuat ulang, tetapi permintaan berikutnya ditolak.

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

Setelah menyimpan berkas, tidak perlu restart apa pun — konten dibaca saat diminta.

Slug hanya boleh huruf kecil, angka, dan tanda hubung (`mina`, `spareparts-inventory`).
Slug dengan `/` atau `..` ditolak.

---

## Bagaimana token dicabut otomatis

Layanan memeriksa empat sinyal setiap kali token dipakai. Melanggar salah satu =
token langsung dicabut, tanpa peringatan.

| Sinyal | Ambang default | Artinya |
|--------|----------------|---------|
| Alamat IP berbeda | > 3 dalam 24 jam | Token dibagikan ke orang lain |
| Request per menit | > 30 | Konten diambil massal |
| Percobaan gagal beruntun | ≥ 12 | Token ditebak orang lain |

Angka-angka ini diatur di `~/.portfolio-token/service.env`.

### Menyesuaikan ambang

Ubah berkas `~/.portfolio-token/service.env`, lalu:

```bash
sudo systemctl restart portfolio-token
```

Kunci yang tersedia:

| Kunci | Default | Arti |
|-------|---------|------|
| `MAX_DISTINCT_IPS` | 3 | Batas IP berbeda |
| `IP_WINDOW_HOURS` | 24 | Jendela waktu perhitungan IP |
| `RATE_LIMIT_PER_MINUTE` | 30 | Batas request per menit |
| `MAX_FAILED_ATTEMPTS` | 12 | Batas kegagalan beruntun |
| `ALLOWED_ORIGINS` | `https://victerhong.github.io` | Origin yang boleh mengakses API |

---

## Layanan yang berjalan

| Layanan | Fungsi | Perintah |
|---------|--------|----------|
| `portfolio-token` | Layanan token | `sudo systemctl status portfolio-token` |
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

Kalau API tidak bisa dihubungi, periksa `backend-url.json` di GitHub — apakah
`updated_at`-nya baru.

---

## Keamanan

- Token disimpan **hanya sebagai hash** (SHA-256 + salt). Bocornya database tidak
  langsung membuat token bisa dipakai.
- Rahasia ada di `~/.portfolio-token/service.env` dengan izin `600`, di luar repo.
- API hanya menerima permintaan dari origin yang terdaftar (CORS).
- Layanan hanya mendengarkan di `127.0.0.1`; akses publik lewat tunnel.
- Konten terkunci tidak ada di HTML statis — diperiksa otomatis saat pengujian.

### Kalau ada token yang bocor

```bash
node src/admin-cli.mjs revoke --id tok_xxx --reason "bocor, diganti"
node src/admin-cli.mjs issue --project mina --to "PT Contoh" --days 30
```

Kirim token baru ke penerima yang sah, dan beri tahu bahwa token lama tidak berlaku.

---

## Menambah proyek baru

1. Buat folder `projects/<slug>/index.html` — salin dari `projects/mina/index.html`
   dan sesuaikan teksnya.
2. Tambahkan `gated: true` pada proyek di `src/data/projects.js`.
3. Isi konten terkunci di `~/.portfolio-token/content/<slug>.json`.
4. Terbitkan token dengan `--project <slug>`.
5. Commit dan push. Tidak ada langkah build.

Slug proyek dibaca dari URL, jadi `src/project.js` tidak perlu diubah.
