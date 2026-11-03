# Proyek dari folder

Satu folder = satu proyek di portofolio. Taruh foldernya di sini, situs terbit sendiri
(layanan `portfolio-projects-watch` menjalankan build, preflight, dan deploy).

```
projects/
  kasir-toko/          nama folder = slug: huruf kecil, angka, tanda hubung
    project.md         wajib — salin dari _contoh/project.md
    cover.jpg          opsional, maks 600 KB (jpg/png/webp, potret 620x820 paling rapi)
    loop.mp4           opsional, maks 2 MB, tanpa suara (dipakai kalau featured: true)
```

- Folder berawalan `_` adalah draf: tidak diterbitkan.
- Folder yang tidak sah ditolak, alasannya ada di log: `journalctl --user -u portfolio-projects-watch`.
- Detail teknis yang terkunci (arsitektur, metrik) TIDAK ditulis di sini; tetap di server token.
- Tiga sistem produksi (MINA, Spareparts, WhatsApp) tetap di `assets/js/data/projects.js`.
