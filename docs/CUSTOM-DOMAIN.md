# Panduan Custom Domain — Gated Portfolio

Panduan lengkap memindahkan portofolio dari `victerhong.github.io` ke domain sendiri.
Custom domain adalah fitur paket **Enterprise** dan memberi kesan profesional
yang tidak bisa ditandingi subdomain gratis.

---

## Kenapa custom domain?

| Aspek | GitHub Pages | Custom Domain |
|-------|--------------|---------------|
| Kesan profesional | `victerhong.github.io` | `victer.id` atau `victer.dev` |
| Kontrol branding | Terbatas | Penuh |
| Email profesional | Tidak | `sales@victer.id` |
| SEO | Berbagi domain dengan GitHub | Domain sendiri, kredibilitas lebih tinggi |
| Nilai jual enterprise | Sulit dijual | Layak untuk klien korporat |

---

## Langkah 1 — Beli domain

Registrar yang direkomendasikan (harga per tahun, kira-kira):

| Registrar | Harga `.id` | Harga `.dev` | Harga `.com` |
|-----------|-------------|--------------|--------------|
| Cloudflare Registrar | — | ~$12 | ~$10 |
| Namecheap | ~$15 | ~$12 | ~$11 |
| Niagahoster | ~Rp 200rb | — | ~Rp 150rb |

**Rekomendasi:** Cloudflare Registrar kalau sudah pakai Cloudflare Tunnel —
DNS-nya langsung terhubung, dan harganya at-cost (tanpa markup).

Pilihan nama yang tersedia (perlu dicek ketersediaannya):
- `victer.id` — singkat, lokal, profesional
- `victer.dev` — kesan developer, cocok untuk portofolio teknis
- `victerh.dev` — kalau `victer.dev` sudah diambil
- `victer.build` — alternatif modern

---

## Langkah 2A — Setup dengan GitHub Pages (frontend)

1. **Beli domain** di registrar pilihan.

2. **Tambahkan file `CNAME`** di akar repo:
   ```
   victer.id
   ```

3. **Konfigurasi DNS** di registrar:

   | Tipe | Nama | Nilai | TTL |
   |------|------|-------|-----|
   | A | `@` | `185.199.108.153` | Auto |
   | A | `@` | `185.199.109.153` | Auto |
   | A | `@` | `185.199.110.153` | Auto |
   | A | `@` | `185.199.111.153` | Auto |
   | CNAME | `www` | `victerhong.github.io` | Auto |

4. **Set di GitHub:**
   Settings → Pages → Custom domain → isi `victer.id` → Save.
   Centang "Enforce HTTPS" setelah sertifikat terbit (5–30 menit).

5. **Uji:**
   ```bash
   curl -sI https://victer.id | head -5
   ```

---

## Langkah 2B — Setup backend dengan Cloudflare Tunnel + domain sendiri

Setelah domain aktif di Cloudflare, tunnel bisa memakai subdomain tetap
seperti `api.victer.id` — **tidak lagi URL acak `trycloudflare.com`**:

1. **Login Cloudflare:**
   ```bash
   cloudflared tunnel login
   ```

2. **Buat named tunnel:**
   ```bash
   cloudflared tunnel create portfolio-api
   ```

3. **Konfigurasi `~/.cloudflared/config.yml`:**
   ```yaml
   tunnel: portfolio-api
   credentials-file: /home/ubuntu/.cloudflared/<TUNNEL-ID>.json
   ingress:
     - hostname: api.victer.id
       service: http://127.0.0.1:8788
     - service: http_status:404
   ```

4. **Route DNS:**
   ```bash
   cloudflared tunnel route dns portfolio-api api.victer.id
   ```

5. **Jalankan sebagai service:**
   ```bash
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```

6. **Perbarui `backend-url.json` di repo:**
   ```json
   { "api_base": "https://api.victer.id" }
   ```

7. **Perbarui `ALLOWED_ORIGINS`** di `~/.portfolio-token/service.env`:
   ```
   ALLOWED_ORIGINS=https://victer.id,https://www.victer.id
   ```
   Lalu restart: `sudo systemctl restart portfolio-token`

**Keuntungan named tunnel:**
- URL tidak berubah saat restart (tidak perlu update `backend-url.json` terus)
- Bisa pakai Cloudflare Access untuk proteksi tambahan
- Analytics + WAF gratis dari Cloudflare

---

## Langkah 3 — Email profesional (opsional)

Untuk `sales@victer.id` tanpa server mail sendiri:

| Layanan | Gratis? | Cara |
|---------|---------|------|
| Cloudflare Email Routing | ✅ | Forward `sales@victer.id` → Gmail pribadi |
| Zoho Mail | ✅ (5 user) | Mailbox penuh + IMAP |
| ImprovMX | ✅ | Forward sederhana |

**Cloudflare Email Routing** paling mudah:
1. Dashboard Cloudflare → Email → Email Routing
2. Tambahkan `sales@victer.id` → forward ke `victerphanjaya@gmail.com`
3. Tambahkan record MX yang diminta Cloudflare

Lalu update di `service.env`:
```
SALES_EMAIL=sales@victer.id
```

---

## Checklist go-live

- [ ] Domain dibeli
- [ ] File `CNAME` ditambahkan ke repo
- [ ] DNS A + CNAME dikonfigurasi
- [ ] GitHub Pages custom domain diset
- [ ] HTTPS enforced (sertifikat terbit)
- [ ] Named tunnel dibuat (kalau pakai Cloudflare)
- [ ] `backend-url.json` diperbarui
- [ ] `ALLOWED_ORIGINS` diperbarui + service restart
- [ ] Email routing dikonfigurasi
- [ ] `SALES_EMAIL` diperbarui
- [ ] Uji end-to-end: token → konten terbuka dari domain baru
- [ ] Update tautan di `src/data/projects.js` kalau ada URL absolut

---

## Biaya per tahun

| Item | Biaya |
|------|-------|
| Domain `.id` | ~Rp 200.000 |
| Domain `.dev` | ~$12 (~Rp 190.000) |
| Cloudflare Tunnel | Gratis |
| Cloudflare Email Routing | Gratis |
| GitHub Pages | Gratis |
| VPS (sudah ada) | — |
| **Total tambahan** | **~Rp 200.000/tahun** |

---

*Dokumen ini bagian dari roadmap v2.4 — Enterprise package + SLA + custom domain.*
