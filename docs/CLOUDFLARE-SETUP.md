# Setup Cloudflare Lengkap — Panduan Aktivasi

## Status Saat Ini
✅ Worker deployed: https://portfolio-victer.victerphanjaya.workers.dev
✅ API Token terkonfigurasi
⚠️ R2, Analytics Engine, Custom Domain — butuh aktivasi manual dashboard

---

## Langkah 1: Aktifkan R2 (Storage)

1. Buka https://dash.cloudflare.com/33dc8afdebc36de42802c8092ece6aed/r2
2. Klik **"Enable R2"** (gratis 10GB/bulan)
3. Tunggu aktivasi (1-2 menit)
4. Bucket "portfolio-assets" akan dibuat otomatis saat deploy

## Langkah 2: Aktifkan Analytics Engine

1. Buka https://dash.cloudflare.com/33dc8afdebc36de42802c8092ece6aed/workers/analytics-engine
2. Klik **"Enable Analytics Engine"**
3. Gratis 10M events/bulan

## Langkah 3: Custom Domain

1. Buka https://dash.cloudflare.com/33dc8afdebc36de42802c8092ece6aed/workers/services/view/portfolio-victer
2. Tab **"Triggers"** → **"Add Custom Domain"**
3. Masukkan domain: `api.victerhong.github.io` atau domain lain
4. Cloudflare akan buat DNS record otomatis

---

## Setelah Aktivasi — Deploy Full

Jalankan di terminal server:

```bash
cd ~/portfolio-victer

# Deploy dengan R2 + Analytics
CLOUDFLARE_API_TOKEN="[REDACTED — ganti dengan token Anda]" \
CLOUDFLARE_ACCOUNT_ID="33dc8afdebc36de42802c8092ece6aed" \
wrangler deploy --env production
```

---

## Arsitektur Target

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge (Global)                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Workers: portfolio-victer                              │  │
│  │  │  ├── /health → JSON status                           │  │
│  │  │  ├── /api/* → API proxy ke backend                  │  │
│  │  │  └── /* → Static assets dari R2                      │  │
│  │  │                                                   │  │
│  │  Bindings:                                        │  │
│  │  │  ├── R2: portfolio-assets (static files)              │  │
│  │  │  ├── KV: sessions (cache)                             │  │
│  │  │  └── Analytics: portfolio-analytics (metrics)         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Custom Domain: api.victerhong.github.io (atau domain Anda)        │
│                                                                     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    Backend (VPS) — Tetap Berjalan                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Node.js + SQLite (port 8788)                         │  │
│  │  │  ├── Token validation                                  │  │
│  │  │  ├── Lead management                                   │  │
│  │  │  └── Anti-spam + Consent                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Cloudflare Tunnel — backend tetap terhubung ke internet            │
│                                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Biaya

| Fitur | Gratis | Pro |
|-------|--------|-----|
| Workers | 100k req/hari | $5/bulan |
| R2 | 10GB storage | $0.015/GB |
| Analytics Engine | 10M events | $0.25/M |
| KV | 1GB storage | $0.50/GB |

Untuk portfolio pribadi, tier gratis cukup.

---

## Kontak

Ada masalah? Kirim pesan ke bot Telegram ini.
