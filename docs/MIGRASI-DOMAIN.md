# Migrasi ke Domain Kustom `victer.is-a.dev`

**Status:** Menunggu PR di-merge
**PR:** [is-a-dev/register#54937](https://github.com/is-a-dev/register/pull/54937)
**Terakhir diperiksa:** 5 Oktober 2026 — PR OPEN, semua check LULUS (Label, Template, Tests)

---

## 1. Situasi Sekarang

Situs berjalan di tiga alamat sekaligus:

| Alamat | Status | Peran |
|---|---|---|
| `portfolio-victer.pages.dev` | Aktif | Domain utama saat ini (canonical/OG) |
| `victerhong.github.io/portfolio-victer` | Aktif | Cadangan (GitHub Pages) |
| `victer.is-a.dev` | **Belum aktif** | Menunggu PR merge |

**Yang sudah selesai:**
- Konfigurasi domain di `domains/victer.json` sudah disiapkan
- PR #54937 sudah dibuat, semua check hijau
- Skrip migrasi `scripts/migrate-domain.sh` sudah siap dan diuji

**Yang belum:**
- PR belum di-merge oleh maintainer is-a.dev
- Domain belum ditambahkan di Cloudflare Pages
- Belum ada di `ALLOWED_ORIGINS` dan `TURNSTILE_HOSTNAMES`

---

## 2. Kenapa Harus Diganti (bukan sekadar ditambah)

Kalau domain kustom aktif tapi `canonical` dan `og:url` masih menunjuk
`pages.dev`, Google melihat **dua versi konten yang sama**. Akibatnya:

- Google bisa memilih `pages.dev` sebagai versi utama yang diindeks
- Peringkat pencarian terpecah antara dua alamat
- Tautan yang dibagikan di media sosial menampilkan alamat `pages.dev`,
  bukan domain profesional

Domain lama **tetap bekerja** setelah migrasi — Cloudflare Pages dan
GitHub Pages tidak dimatikan. Yang berubah hanya domain mana yang
dinyatakan sebagai versi utama.

---

## 3. Langkah Setelah PR Merge

### Langkah 1 — Verifikasi domain sudah aktif

```bash
# DNS harus sudah mengarah ke Cloudflare Pages
dig +short victer.is-a.dev CNAME
# Harus menampilkan: portfolio-victer.pages.dev

curl -sI https://victer.is-a.dev | head -3
# Harus 200 (atau 301 ke https)
```

Kalau DNS belum mengarah, tunggu propagasi (biasanya < 1 jam untuk is-a.dev).

### Langkah 2 — Tambahkan domain di Cloudflare Pages

```
Dashboard Cloudflare
→ Workers & Pages
→ portfolio-victer
→ Custom domains
→ Set up a custom domain
→ masukkan: victer.is-a.dev
```

Cloudflare akan memverifikasi kepemilikan lewat CNAME yang sudah ada.

### Langkah 3 — Tambahkan domain di widget Turnstile

**PENTING** — kalau langkah ini dilewatkan, pengunjung dari domain baru
akan **ditolak** oleh gerbang token (hostname tidak cocok).

```
Dashboard Cloudflare
→ Turnstile
→ Portfolio Victer Production
→ Settings → Hostname Management
→ tambahkan: victer.is-a.dev
```

### Langkah 4 — Perbarui konfigurasi backend

Edit `~/.portfolio-token/service.env`:

```bash
sudo nano ~/.portfolio-token/service.env
```

Tambahkan domain baru ke **dua** variabel (jangan hapus yang lama — domain
lama masih dipakai sebagai cadangan):

```env
ALLOWED_ORIGINS=https://victer.is-a.dev,https://portfolio-victer.pages.dev,https://victerhong.github.io

TURNSTILE_HOSTNAMES=victer.is-a.dev,portfolio-victer.pages.dev,victerhong.github.io
```

### Langkah 5 — Jalankan migrasi domain di kode

```bash
cd ~/portfolio-victer

# Lihat dulu apa yang akan berubah (tidak menulis apa pun)
./scripts/migrate-domain.sh --dry-run

# Jalankan migrasi
./scripts/migrate-domain.sh
```

Skrip ini mengubah 27 kemunculan di 10 berkas:
`home.html`, `docs.html`, `index.html`, `sitemap.xml`, `robots.txt`,
`llms.txt`, `backend/src/seo.mjs`, `backend/scripts/uptime.mjs`,
`workers/site.ts`, `workers/redirect.js`

Backup otomatis dibuat di `/tmp/domain-migrasi-<tanggal>/`.

### Langkah 6 — Deploy

```bash
cd ~/portfolio-victer

# Situs statis
wrangler pages deploy . --project-name=portfolio-victer

# Worker (router edge)
wrangler deploy workers/site.ts

# Backend (konfigurasi baru dibaca saat start)
sudo -n systemctl restart portfolio-token
```

### Langkah 7 — Verifikasi

```bash
# 1. Situs bisa diakses dari domain baru
curl -sI https://victer.is-a.dev | head -5

# 2. API backend
curl -s https://victer.is-a.dev/api/health

# 3. Canonical sudah menunjuk domain baru
curl -s https://victer.is-a.dev/home | grep canonical

# 4. Domain lama masih bekerja (tidak boleh rusak)
curl -sI https://portfolio-victer.pages.dev | head -3

# 5. Gerbang token masih berfungsi
#    Buka https://victer.is-a.dev/s/e7kz4swubfvg/ di browser,
#    selesaikan verifikasi, pastikan token bisa dimasukkan.
```

### Langkah 8 — Kirim sitemap baru ke Google

```
Google Search Console
→ Tambahkan properti baru: https://victer.is-a.dev
→ Sitemaps → kirim: https://victer.is-a.dev/sitemap.xml
```

---

## 4. Kalau Ada Masalah

### Pengunjung ditolak dengan pesan verifikasi

**Penyebab paling mungkin:** domain baru belum ditambahkan di widget
Turnstile, atau belum ada di `TURNSTILE_HOSTNAMES`.

**Cara memastikan:** cek log backend —

```bash
sudo -n journalctl -u portfolio-token --since "10 minutes ago" | grep turnstile
```

Kalau ada masalah hostname, log akan menampilkan:

```
[turnstile] hostname_tidak_cocok: diterima hostname="victer.is-a.dev" —
daftar diizinkan: ["portfolio-victer.pages.dev","victerhong.github.io"].
Perbarui TURNSTILE_HOSTNAMES di service.env kalau hostname ini sah.
```

Pesan itu langsung memberi tahu apa yang harus ditambahkan.

### Halaman tidak bisa diakses sama sekali

Cek apakah domain sudah ditambahkan di Cloudflare Pages (Langkah 2).
Tanpa itu, Cloudflare tidak tahu harus melayani apa.

### Perlu kembali ke domain lama

```bash
cd ~/portfolio-victer
./scripts/migrate-domain.sh --revert
wrangler pages deploy . --project-name=portfolio-victer
sudo -n systemctl restart portfolio-token
```

---

## 5. Yang TIDAK Berubah

- **Domain lama tetap aktif** — `pages.dev` dan `github.io` tidak dimatikan
- **Backend tetap di VPS** — hanya domain publik yang berubah
- **Token akses tetap bekerja** — tidak ada perubahan pada sistem token
- **Data di database tidak tersentuh** — ini murni perubahan alamat

---

## 6. Catatan Teknis

**Kenapa PR memakai CNAME, bukan URL record?**

Sempat ada kebingungan soal ini. Dokumentasi is-a-dev menyebut CNAME
ke `pages.dev` masuk daftar yang ditolak, tapi setelah PR diperbaiki,
semua check LULUS. Konfigurasi yang benar untuk Cloudflare Pages adalah:

```json
{
  "record": {
    "CNAME": "portfolio-victer.pages.dev"
  }
}
```

**Kenapa domain lama tidak dihapus dari ALLOWED_ORIGINS?**

CORS memakai allowlist. Kalau domain lama dihapus, pengunjung yang masih
membuka tab lama (atau tautan yang sudah tersebar) akan diblokir browser.
Menyimpan keduanya tidak menimbulkan risiko — keduanya memang domain kita.

**Kenapa `victer.is-a.dev` belum ada di sitemap?**

Sitemap menyatakan versi utama. Kalau domain belum aktif tapi sudah ada
di sitemap, Google akan menemukan tautan mati. Urutan yang benar:
domain aktif dulu → baru masukkan ke sitemap (Langkah 5).
