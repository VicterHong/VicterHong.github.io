# Production Runbook — Portfolio Victer

**Status:** live · **Terakhir diperbarui:** 3 Oktober 2026

Satu halaman yang menjawab: apa yang berjalan, di mana, bagaimana memeriksa,
dan apa yang dilakukan kalau ada yang turun.

---

## 1. Peta production

| Komponen | Alamat | Teknologi | Peran |
|----------|--------|-----------|-------|
| **Gate verifikasi** | `https://portfolio-victer.pages.dev/` | Cloudflare Pages | Interstitial Turnstile (ala Cloudflare) |
| **Portfolio** | `https://portfolio-victer.pages.dev/home` | Static + vanilla JS | Halaman publik |
| **Halaman proyek** | `https://portfolio-victer.pages.dev/s/<kode>/` | Static + gate | Konten terkunci (butuh token) |
| **Edge router** | `https://portfolio-victer.victerphanjaya.workers.dev` | Cloudflare Worker | Health check + proxy API |
| **Backend token** | `127.0.0.1:8788` (VPS) | Node murni, nol dependency | Terbit/validasi/cabut token |
| **Tunnel** | `*.trycloudflare.com` (otomatis) | cloudflared quick tunnel | Menghubungkan backend ke internet |
| **Cermin** | `https://victerhong.github.io` | GitHub Pages | Cadangan (repo yang sama) |

**Alamat backend tidak pernah di-hardcode di frontend.** `backend-url.json`
di repo diperbarui otomatis oleh `backend/scripts/tunnel.sh` setiap kali URL
tunnel berubah; frontend dan monitor membacanya.

---

## 2. Pemeriksaan cepat (30 detik)

```bash
# Semua halaman utama
for u in / /home /s/e7kz4swubfvg/; do
  curl -s -o /dev/null -w "$u → %{http_code}\n" "https://portfolio-victer.pages.dev$u"
done

# Backend lokal + via internet
curl -s http://127.0.0.1:8788/api/health; echo
curl -s https://portfolio-victer.victerphanjaya.workers.dev/health; echo

# Monitor uptime (3 target sekaligus)
node backend/scripts/uptime.mjs

# Tes backend
cd backend && npm test
```

---

## 3. Yang berjalan otomatis

| Jadwal | Tugas | Perintah | Log |
|--------|-------|----------|-----|
| Tiap 5 menit | Uptime 3 target | `backend/scripts/uptime.mjs` | `~/.portfolio-token/uptime-cron.log` |
| Harian 03:45 | Backup database token | `backend/scripts/backup.mjs` | `~/.portfolio-token/backup.log` |
| Tiap jam | Cek merge PR domain | `~/check-pr-merge.sh` | `/tmp/pr-check.log` |
| Kontinu | Layanan token | systemd `portfolio-token` | `journalctl -u portfolio-token` |
| Kontinu | Tunnel | systemd (skrip tunnel) | — |

---

## 4. Kalau ada yang turun

### Landing tidak bisa dibuka (Pages)

Cloudflare Pages punya uptime sendiri. Kalau `pages.dev` bermasalah:

1. Cermin otomatis: `https://victerhong.github.io` (repo yang sama, deploy
   via push) — **beri tahu pengunjung** alamat cermin.
2. Cek deploy terakhir: `npx wrangler pages deployment list --project-name=portfolio-victer`
3. Deploy ulang: `npx wrangler pages deploy . --project-name=portfolio-victer --branch=main`

### Konten terkunci tidak bisa dibuka (backend)

Landing tetap jalan (statis). Yang mati hanya pembukaan token.

```bash
# 1. Cek layanan
sudo systemctl status portfolio-token
sudo systemctl restart portfolio-token

# 2. Cek tunnel (URL berubah? frontend membaca otomatis dari repo)
cat backend-url.json
# kalau basi, tunggu skrip tunnel menulis ulang (maks 60 detik)

# 3. Cek dari luar
curl -s https://<tunnel-url>/api/health
```

### Verifikasi Turnstile gagal untuk semua pengunjung

Gejala: gate muncul, pengunjung selesai verifikasi, tapi selalu gagal.

```bash
# Cek secret key masih valid (bukan dicabut di dashboard)
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -d "secret=$(grep TURNSTILE_SECRET_KEY ~/.portfolio-token/service.env | cut -d= -f2)" \
  -d "response=XXXX.DUMMY.TOKEN.XXXX"
# Jawaban berisi "invalid-input-secret" = key dicabut/salah
```

Catatan: kalau `TURNSTILE_SECRET_KEY` dikosongkan, verifikasi otomatis
di-skip dan situs tetap jalan (mode aman) — tombol token langsung aktif.

### Database token hilang/rusak

Lihat `docs/OPERASIONAL.md` § "Memulihkan dari backup".

---

## 5. Deploy perubahan

```bash
cd ~/portfolio-victer

# 1. Frontend (Pages) — tidak ada langkah build
export CLOUDFLARE_API_TOKEN="$(grep '^CLOUDFLARE_API_TOKEN=' ~/.portfolio-token/service.env | cut -d= -f2-)"
export CLOUDFLARE_ACCOUNT_ID="$(grep '^CLOUDFLARE_ACCOUNT_ID=' ~/.portfolio-token/service.env | cut -d= -f2-)"
npx wrangler pages deploy . --project-name=portfolio-victer --branch=main

# 2. Backend (VPS)
sudo systemctl restart portfolio-token

# 3. Cermin GitHub Pages
git push origin main
```

**Penting:** setelah mengubah CSS/JS, naikkan versi di URL (`project.js?v=N`)
supaya browser tidak memakai versi cache lama.

---

## 5b. Rollback — mengembalikan deploy yang bermasalah

Ditulis karena sebelumnya **tidak ada** prosedur ini. Tanpa rollback yang
terdokumentasi, orang yang panik akan menebak — dan tebakan saat panik
biasanya memperburuk keadaan.

### Kapan rollback, kapan perbaiki di tempat

| Keadaan | Tindakan |
|---|---|
| Halaman rusak, penyebabnya jelas, perbaikan < 5 menit | **Perbaiki di tempat** — rollback lalu deploy ulang lebih lama |
| Halaman rusak, penyebabnya belum jelas | **Rollback dulu**, selidiki setelah situs hidup |
| Backend error setelah restart | **Rollback backend**, lihat bagian bawah |
| Database korup | **JANGAN rollback** — pulihkan dari backup (§4) |

Prinsipnya: **situs hidup lebih penting daripada versi terbaru.** Rollback itu
murah dan bisa diulang; pengunjung yang melihat halaman rusak tidak kembali.

### Rollback frontend (Cloudflare Pages)

```bash
cd ~/portfolio-victer

# 1. Lihat versi terakhir yang diketahui baik
git tag --sort=-v:refname | head -5

# 2. Kembalikan ke tag itu (--detach supaya main tidak tergeser)
git checkout v2.6.0

# 3. Deploy versi itu
export CLOUDFLARE_API_TOKEN="$(grep '^CLOUDFLARE_API_TOKEN=' ~/.portfolio-token/service.env | cut -d= -f2-)"
export CLOUDFLARE_ACCOUNT_ID="$(grep '^CLOUDFLARE_ACCOUNT_ID=' ~/.portfolio-token/service.env | cut -d= -f2-)"
node scripts/build-css.mjs
npx wrangler pages deploy dist --project-name=portfolio-victer --branch=main

# 4. Verifikasi
curl -s -o /dev/null -w '%{http_code}\n' https://portfolio-victer.pages.dev/
```

**Setelah pulih:** kembali ke `main` dan perbaiki dari sana.

```bash
git checkout main
```

### Rollback backend (VPS)

Backend tidak punya versi tersimpan per-deploy — tapi git punya.

```bash
cd ~/portfolio-victer

# 1. Lihat commit yang sedang berjalan
git log --oneline -5

# 2. Kembalikan berkas backend ke commit sebelumnya
git checkout <commit-baik> -- backend/src/

# 3. Restart
sudo systemctl restart portfolio-token

# 4. Verifikasi
curl -s http://127.0.0.1:8788/api/health
curl -s http://127.0.0.1:8788/api/ready | head -c 200
```

**Kembalikan perubahan git** setelah selesai menyelidiki:

```bash
git checkout main -- backend/src/
```

### Rollback database

**Tidak ada rollback database.** SQLite tidak punya undo, dan memutar balik
tulisan bisa menghapus data yang sah.

Yang ada: **pulihkan dari backup** (§4). Itu berarti kehilangan perubahan
sejak backup terakhir — karena itu backup harian jalan otomatis.

```bash
# Lihat backup yang ada
ls -lt ~/.portfolio-token/backups/ | head -5

# Pulihkan (HENTIKAN layanan dulu)
sudo systemctl stop portfolio-token
cp ~/.portfolio-token/backups/<berkas-terbaik>.db ~/.portfolio-token/tokens.db
sudo systemctl start portfolio-token
```

### Kalau rollback juga gagal

Urutan yang disarankan:

1. **Cek apakah masalahnya di kita atau di luar** — `curl -s https://portfolio-victer.pages.dev/` dari jaringan lain. Kalau hanya jaringan Anda yang bermasalah, tidak ada yang perlu di-rollback.
2. **Cek status Cloudflare** — gangguan Pages adalah satu-satunya kasus di mana menunggu lebih baik daripada bertindak.
3. **Matikan yang bermasalah, bukan semuanya** — kalau hanya satu endpoint rusak, hentikan endpoint itu. Situs yang sebagian hidup lebih baik daripada mati total.

---

## 6. Batas & catatan jujur

| Hal | Kondisi sebenarnya |
|-----|-------------------|
| Custom domain | `victer.is-a.dev` — PR #54937 open, menunggu maintainer (3/3 check lolos) |
| Tunnel | Quick tunnel (`trycloudflare.com`) — URL berubah saat restart, ditangani otomatis |
| Database | SQLite (WAL) — cukup untuk ribuan token; PostgreSQL saat skala jauh lebih besar |
| R2 bucket | Tidak tersedia di akun ini — aset dilayani dari Pages |
| Uptime | Dipantau tiap 5 menit; target PRD 99% untuk landing |
| Analytics | Audit log di VPS sendiri; tidak ada pelacakan pihak ketiga |
