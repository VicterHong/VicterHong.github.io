# Tambah proyek: taruh folder di server

Folder sumber (hanya di server, tidak di-commit): `~/portfolio-victer/projects/`

```
projects/
  kasir-toko/              nama folder = slug: huruf kecil, angka, tanda hubung
    project.md             wajib
    cover.jpg              opsional: jpg/png/webp, maks 600 KB (potret 620x820 paling rapi)
    loop.mp4               opsional: maks 2 MB, tanpa suara
```

Contoh `project.md`:

```
---
name: Kasir Toko
subtitle: Kasir offline untuk toko kelontong
stack: Python, SQLite, Telegram
repo: https://github.com/VicterHong/kasir-toko
cover_alt: Layar kasir saat mencatat penjualan
featured: false
order: 10
---
Ringkasan satu paragraf. Hanya paragraf pertama yang tampil di situs.

Paragraf berikutnya tidak dipublikasikan (catatan pribadi aman di sini).
```

## Yang terjadi otomatis

Layanan `portfolio-projects-watch` (systemd user) menunggu 20 detik setelah
perubahan terakhir, lalu:

1. memvalidasi SEMUA folder: satu folder rusak = rilis batal, situs tidak berubah
2. menjalankan `scripts/deploy-aman.mjs` (build, preflight, verifikasi, deploy)
3. commit + push hanya `assets/js/data/projects.generated.js` dan `assets/projects/`

## Aturan

- Folder berawalan `_` adalah draf, tidak tampil.
- Ditolak: nama folder tidak sah, slug sama dengan proyek bawaan (mina, spareparts,
  whatsapp-bot), field tak dikenal, repo bukan HTTPS, berkas selain tiga di atas,
  symlink, media palsu/terlalu besar.
- Hapus folder = proyek turun dari situs pada rilis berikutnya.
- Detail teknis terkunci (arsitektur, metrik) TIDAK ditulis di sini; tetap di
  `~/.portfolio-token/content/<slug>.json`.

## Perintah

```
XDG_RUNTIME_DIR=/run/user/1001 systemctl --user status portfolio-projects-watch
XDG_RUNTIME_DIR=/run/user/1001 journalctl --user -u portfolio-projects-watch -n 30
node scripts/publish-projects.mjs        # uji validasi tanpa deploy
```
