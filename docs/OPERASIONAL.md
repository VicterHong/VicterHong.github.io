# Layanan Token Portofolio — Panduan Operasional

Panduan untuk pemilik portofolio: cara menerbitkan token akses, mencabutnya, dan
membaca catatan akses.

**Live:** https://victerhong.github.io
**Halaman proyek:** https://victerhong.github.io/s/e7kz4swubfvg/

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

### Analytics funnel

```bash
# Funnel konversi 7 hari terakhir
node src/admin-cli.mjs funnel --project mina --days 7

# Unique visitors
node src/admin-cli.mjs visitors --project mina --days 30
```

Funnel menunjukkan: `page_view → modal_open → token_attempt → token_success →`
`contact_sales → lead_submit → content_view`, plus conversion rate tiap tahap.

### Laporan SLA (enterprise)

```bash
# Ringkasan: harian, mingguan, bulanan
node src/admin-cli.mjs sla

# Periode tertentu
node src/admin-cli.mjs sla --days 7
```

Menampilkan uptime, latency rata-rata, p95, error rate, dan status terhadap
target 99%. Data dari tabel `sla_heartbeats` — dihitung dari request nyata.

### Ekspor audit log (enterprise)

```bash
# JSON ke layar
node src/admin-cli.mjs export --format json --limit 100

# CSV ke berkas
node src/admin-cli.mjs export --format csv --project mina --out audit-mina.csv

# Per token
node src/admin-cli.mjs export --token tok_abc123 --format csv --out token-audit.csv
```

Berguna untuk klien enterprise yang minta bukti siapa mengakses apa.

### Notifikasi webhook

Lead baru dan auto-revoke bisa dikirim ke Discord/Slack/webhook generik.
Tambahkan ke `~/.portfolio-token/service.env`:

```bash
LEAD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Lalu restart layanan dan uji:

```bash
sudo systemctl restart portfolio-token
node src/admin-cli.mjs notify-test
```

Format payload dideteksi otomatis dari URL (Discord embed, Slack text, atau JSON generik).

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

## Meninjau lead mencurigakan (anti-spam)

Form permintaan akses disaring otomatis tanpa CAPTCHA — lihat alasan lengkapnya
di `docs/PRD-v2-corporate.md` §15 (Keputusan Q3). Hasil penyaringan:

| Verdict | Arti | Tindakan |
|---------|------|----------|
| `allow` | Bersih | Lead masuk dengan status `new` — langsung bisa dibalas |
| `review` | Mencurigakan | Lead masuk dengan status `review` — tinjau dulu sebelum dibalas |
| `block` | Hampir pasti bot | **Tidak disimpan.** Tetap dibalas sukses supaya bot tidak belajar |

Lihat lead yang menunggu tinjauan:

```bash
cd ~/portfolio-victer/backend
node src/admin-cli.mjs review
```

Setelah meninjau, ubah statusnya:

```bash
node src/admin-cli.mjs mark --id 12 --status new    # ternyata sah → balas
node src/admin-cli.mjs mark --id 12 --status spam   # ternyata spam → abaikan
```

Lihat semua lead dengan status tertentu:

```bash
node src/admin-cli.mjs leads --status review
node src/admin-cli.mjs leads --status new --limit 20
```

Notifikasi webhook juga menandai lead mencurigakan dengan skor dan alasannya,
jadi Anda tahu sebelum membalas.

---

## Persetujuan syarat akses

Sebelum konten terkunci dibuka, pemegang token menyetujui syarat akses (NDA
ringan). Teks syaratnya ber-versi — kalau teks berubah, pemegang token diminta
menyetujui ulang.

Mengubah teks syarat:

1. Sunting `TERMS_TEXT` dan naikkan `TERMS_VERSION` di `backend/src/consent.mjs`
2. Restart layanan: `sudo systemctl restart portfolio-token`
3. Pemegang token yang menyetujui versi lama akan diminta menyetujui ulang
   (persetujuan lama tetap tersimpan untuk audit)

Lihat persetujuan yang tercatat:

```bash
node -e "
import('node:sqlite').then(({ DatabaseSync }) => {
  const db = new DatabaseSync(process.env.HOME + '/.portfolio-token/tokens.db');
  console.log(db.prepare('SELECT token_id, terms_version, ip, created_at FROM consents ORDER BY created_at DESC LIMIT 20').all());
  db.close();
});
"
```

---

## Layanan yang berjalan

| Layanan | Fungsi | Perintah |
|---------|--------|----------|
| `portfolio-token` | Layanan token + session | `sudo systemctl status portfolio-token` |
| `portfolio-tunnel` | Tunnel Cloudflare + publikasi URL | `sudo systemctl status portfolio-tunnel` |

### Dashboard admin (panel web)

Panel web untuk mengelola token, melihat lead, funnel, SLA, dan audit log —
tanpa perlu hafal perintah CLI.

**Akses lewat SSH tunnel** (panel hanya menerima koneksi dari server):

```bash
# Dari komputer Anda:
ssh -L 8789:127.0.0.1:8788 ubuntu@<IP-VPS>

# Lalu buka di browser:
http://localhost:8789/admin
```

Masukkan `ADMIN_KEY` (dari `~/.portfolio-token/service.env`) saat diminta.
Kunci disimpan di `sessionStorage` — hilang saat tab ditutup.

Fitur panel:
- **Ringkasan** — token aktif, lead baru, uptime 24 jam
- **Token** — daftar, filter status/tier, terbitkan token baru (dengan reveal + copy), cabut
- **Leads** — semua permintaan akses dengan detail lengkap
- **Funnel** — grafik konversi visual per proyek
- **SLA** — uptime, latency, error rate (harian/mingguan/bulanan)
- **Audit** — log aktivitas + ekspor CSV sekali klik

**Keamanan:** panel menolak semua request yang membawa header Cloudflare
(`CF-Connecting-IP`, `CF-Ray`) atau `X-Forwarded-For` — jadi tidak bisa diakses
dari internet meskipun port 8788 terekspos lewat tunnel.

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
- **Rate limiting per-IP** di endpoint publik (validate 20/menit, session 10/menit,
  sales 5/menit) — menutup brute force token tak dikenal.
- **Kunci admin dibandingkan timing-safe** (`timingSafeEqual`) — mencegah timing attack.
- Audit keamanan lengkap: [`docs/AUDIT-KEAMANAN.md`](AUDIT-KEAMANAN.md).

### Kalau ada token yang bocor

```bash
node src/admin-cli.mjs revoke --id tok_xxx --reason "bocor, diganti"
node src/admin-cli.mjs issue --project mina --to "PT Contoh" --days 30
```

---

## Health check: liveness vs readiness

Dua endpoint dengan tugas berbeda (standar Kubernetes):

### `GET /api/health` — LIVENESS

"Proses ini hidup?" Cepat, **tidak menyentuh database**. Dipakai untuk
memutuskan apakah proses perlu di-restart. Selalu **200** selama proses
bisa menjawab.

```bash
curl -s http://127.0.0.1:8788/api/health
# {"ok":true,"service":"portfolio-token-service","uptime_seconds":3600,
#  "pid":12345,"node":"v22.0.0","memory_mb":27,"time":"..."}
```

### `GET /api/ready` — READINESS

"Siap menerima trafik?" Memeriksa **dependensi nyata**:

| Pemeriksaan | Yang diuji | Gagal kalau |
|-------------|-----------|-------------|
| `database` | Query nyata ke tabel tokens | DB terkunci/rusak |
| `disk_write` | Tulis + hapus file probe | Disk read-only |
| `disk_space` | Sisa ruang | < 50 MB tersisa |
| `content_dir` | Bisa dibaca | Izin salah |
| `config` | Secret & admin key ada | Env hilang |

```bash
curl -s http://127.0.0.1:8788/api/ready
# {"ok":true,"checks":[{"name":"database","ok":true,"detail":"12 token terbaca"},...]}
```

**200** = siap, **503** = ada yang gagal (dengan detail penyebabnya).

**Kenapa dua endpoint?** Proses bisa "hidup" (liveness ok) tapi tidak bisa
melayani (readiness gagal) — misalnya database terkunci. Uptime monitor
memakai `/api/ready` supaya tidak melaporkan 100% saat layanan sebenarnya
tidak bisa melayani.

### Cek cepat kesehatan sistem

```bash
# Ringkas — satu perintah
curl -s http://127.0.0.1:8788/api/ready | python3 -m json.tool

# Lihat yang gagal saja
curl -s http://127.0.0.1:8788/api/ready | python3 -c "
import json,sys
d = json.load(sys.stdin)
for c in d['checks']:
    if not c['ok']: print(f\"✗ {c['name']}: {c['detail']}\")
print('SEMUA SEHAT' if d['ok'] else 'ADA MASALAH')
"
```

---

## Rotasi log (otomatis)

Log yang tumbuh tanpa batas bisa memenuhi disk VPS kecil (yang juga dipakai
database & backup). Rotasi berjalan lewat cron:

```
15 4 * * * node backend/scripts/rotate-logs.mjs
```

**Kebijakan:**
- File > **5 MB** diputar (rename dengan cap waktu)
- Simpan maksimal **5 arsip** per file
- Arsip lebih tua dari **90 hari** dihapus

**File yang dikelola:** `uptime.log`, `uptime-cron.log`, `backup.log`,
`deploy.log` (eksplisit — tidak menyapu file lain).

**Lokasi arsip:** `~/.portfolio-token/archive/`

```bash
# Jalankan manual
node backend/scripts/rotate-logs.mjs
# [rotate] uptime.log (6144 KB) → uptime.log.2026-10-04T16-12-04
# [rotate] selesai — 1 diputar, 0 dihapus

# Lihat arsip
ls -lh ~/.portfolio-token/archive/
```

---

## CI/CD (GitHub Actions)

Setiap push & pull request menjalankan **5 job** (`.github/workflows/ci.yml`):

| Job | Yang diperiksa |
|-----|----------------|
| **Test backend** | Sintaks semua modul + 153 test |
| **Preflight situs** | Berkas wajib, anggaran performa, pemindaian rahasia, discovery sinkron |
| **Struktur HTML** | Halaman wajib, meta SEO/AEO, gate di halaman token |
| **Panel admin** | Sintaks JS, fitur wajib (filter, modal, tab) |
| **Dokumentasi** | Dokumen wajib ada, tidak ada rahasia |

**Kenapa penting:** bug filter (argumen `url` tidak diteruskan) yang pernah
terjadi sekarang **tertangkap otomatis** sebelum sampai produksi.

```bash
# Jalankan semua pemeriksaan secara lokal sebelum push
cd backend && npm test
cd .. && node scripts/preflight.mjs
```

---

## Backup database (otomatis)

PRD §8 mewajibkan backup harian. Sudah berjalan lewat cron:

```
45 3 * * * node /home/ubuntu/portfolio-victer/backend/scripts/backup.mjs
```

**Cara kerja:** `VACUUM INTO` membaca snapshot konsisten tanpa menghentikan
layanan (SQLite WAL mendukung pembaca bersamaan penulis). Salinan
**diverifikasi** dengan `PRAGMA integrity_check` + hitungan baris — kalau
rusak, file dihapus dan backup dianggap gagal (backup rusak lebih
berbahaya daripada tidak ada backup).

**Lokasi:** `~/.portfolio-token/backups/tokens-<stamp>.db` (izin 600, folder 700)
**Retensi:** 30 hari (otomatis dihapus setelahnya)
**Log:** `~/.portfolio-token/backup.log`

### Menjalankan backup manual

```bash
node backend/scripts/backup.mjs
# [2026-10-03T17:18:12] ✅ backup ~/.portfolio-token/backups/tokens-20261003171812.db
#   (268 KB) — 8 token, 219 event, 0 lead, 0 arsip lama dihapus
```

### Memulihkan dari backup

```bash
# 1. Hentikan layanan
sudo systemctl stop portfolio-token

# 2. Ganti database dengan salinan (pilih file terbaru)
cp ~/.portfolio-token/tokens.db ~/.portfolio-token/tokens.db.rusak   # simpan yang rusak
cp ~/.portfolio-token/backups/tokens-<stamp>.db ~/.portfolio-token/tokens.db
rm -f ~/.portfolio-token/tokens.db-wal ~/.portfolio-token/tokens.db-shm

# 3. Verifikasi lalu jalankan kembali
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.HOME+'/.portfolio-token/tokens.db',{readOnly:true});console.log(d.prepare('SELECT COUNT(*) AS n FROM tokens').get())"
sudo systemctl start portfolio-token
curl -s http://127.0.0.1:8788/api/health
```

### Menyesuaikan retensi

```bash
BACKUP_RETENTION_DAYS=90 node backend/scripts/backup.mjs
```

---

## Menambah proyek baru

1. Buat folder `<kode>/index.html` — salin dari `s/e7kz4swubfvg/index.html`
   dan sesuaikan teksnya.
2. Tambahkan `gated: true` pada proyek di `src/data/projects.js`.
3. Isi konten terkunci di `~/.portfolio-token/content/<slug>.json`.
4. Terbitkan token dengan `--project <slug>`.
5. Commit dan push. Tidak ada langkah build.
