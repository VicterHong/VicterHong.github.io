# Turnstile Production Setup

## Status Saat Ini
- ✅ Turnstile aktif dengan **test key** (selalu pass)
- ⚠️  Perlu ganti ke **production key** untuk keamanan nyata

## Langkah Ganti ke Production

### 1. Buat Widget di Cloudflare Dashboard

1. Buka https://dash.cloudflare.com
2. Pilih domain Anda (atau akun)
3. Menu sidebar: **Turnstile**
4. Klik **Add Widget**
5. Isi form:
   - **Name**: Portfolio Victer
   - **Hostname**: `portfolio-victer.pages.dev`
   - **Widget Mode**: Managed
6. Klik **Create**

### 2. Copy Key

Setelah widget dibuat, copy:
- **Site Key** (mulai dengan `0x4...`)
- **Secret Key** (mulai dengan `0x4...`)

### 3. Update Backend

Edit `~/.portfolio-token/service.env`:
```bash
TURNSTILE_SITE_KEY=0x4AAAAAAAAAAAAAAA...
TURNSTILE_SECRET_KEY=0x4AAAAAAAAAAAAAAA...
```

Restart backend:
```bash
sudo systemctl restart portfolio-token
```

### 4. Update Frontend

Edit `assets/js/project.js`:
```javascript
const TURNSTILE_SITE_KEY = '0x4AAAAAAAAAAAAAAA...';
```

### 5. Deploy

```bash
CLOUDFLARE_API_TOKEN=cfut_... \
CLOUDFLARE_ACCOUNT_ID=33dc8af... \
wrangler pages deploy . --project-name=portfolio-victer --branch=main
```

### 6. Verifikasi

Buka halaman proyek:
- Turnstile widget harus muncul
- Token harus terisi otomatis
- Form harus bisa submit

## Test Key vs Production Key

| Mode | Site Key | Behavior |
|------|----------|----------|
| Test | `1x00000000000000000000AA` | Selalu pass |
| Production | `0x4...` | Verifikasi nyata |

## Troubleshooting

### Widget tidak muncul
- Cek Site Key benar
- Cek domain diizinkan di widget settings
- Cek browser console untuk error

### Token tidak terisi
- Cek Secret Key benar
- Cek backend running
- Cek network request ke `/api/config`

### "Invalid site key"
- Site key salah atau expired
- Buat widget baru di dashboard

## Referensi
- https://developers.cloudflare.com/turnstile/
- https://dash.cloudflare.com
