# Status Provider Autentikasi — VIVASTIC

Terakhir diperbarui: 2026-10-09

## ✅ Aktif di Produksi

| Provider  | Status | Kredensial | Catatan |
|-----------|--------|------------|---------|
| Google    | ✅ AKTIF | Ada | Consent screen: **In production** — semua orang bisa login |
| Microsoft | ✅ AKTIF | Ada | Multi-tenant + akun pribadi. Secret kedaluwarsa ~Okt 2028 |
| GitHub    | ✅ AKTIF | Ada | OAuth App |
| SSO       | ✅ AKTIF | Ada | Cloudflare Access (team: red-leaf-5479), OIDC, One-time PIN |
| Passkey   | ✅ AKTIF | Tidak perlu | WebAuthn — tanpa kredensial pihak ketiga |
| LinkedIn  | ⬜ Menunggu | Belum | Kode siap; tinggal isi Client ID + Secret |

### Cara mengaktifkan LinkedIn

Self-serve, gratis, tanpa review:

1. [developer.linkedin.com](https://developer.linkedin.com) → **Create app**
2. Tab **Products** → tambahkan **"Sign In with LinkedIn using OpenID Connect"**
   (tersedia langsung, tidak perlu menunggu persetujuan)
3. Tab **Auth** → salin **Client ID** dan **Primary Client Secret**
4. Tambahkan **Authorized redirect URL**:
   `https://portfolio-victer.pages.dev/api/auth/linkedin/callback`
5. Isi `service.env`:
   ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```
6. `sudo systemctl restart portfolio-token.service`

Tombolnya muncul sendiri — tidak perlu ubah HTML.

## ⬜ Apple — DIPUTUSKAN TIDAK DIPAKAI

**Alasan:** $99/tahun, dan permintaan login lewat Apple ID diperkirakan sedikit.

**Status kode:** endpoint, verifikasi id_token, dan penanganan form_post sudah
ADA di `src/oauth.mjs` dan `src/auth-routes.mjs` — tapi **BELUM PERNAH diuji
dengan Apple sungguhan**, karena itu butuh membership berbayar.

Yang sudah terbukti hanyalah bahwa kode kita *mengikuti bentuk yang benar*:
callback menangani POST form_post, email dibaca dari id_token (Apple tidak
punya endpoint userinfo), dan `client_secret` dibuat sebagai JWT ES256.
Belum ada bukti kode ini bekerja melawan Apple asli.

**Kalau nanti berubah pikiran:**

1. Daftar Apple Developer Program ($99/tahun)
2. Buat Services ID + kunci .p8 (lihat `AUTH-SETUP.md` bagian Apple)
3. Isi 4 nilai di `service.env`:
   ```
   APPLE_CLIENT_ID=id.vivastic.signin
   APPLE_TEAM_ID=ABCDE12345
   APPLE_KEY_ID=XYZ9876543
   APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
   ```
4. `sudo systemctl restart portfolio-token.service`

**Tombolnya menyala sendiri** — tidak perlu ubah HTML. Frontend membaca
`/api/config` dan menampilkan tombol hanya untuk provider yang siap.

**Sisihkan waktu untuk menguji.** Karena belum pernah diuji dengan Apple
asli, ada kemungkinan perlu penyesuaian (mis. format kunci .p8, atau
perbedaan klaim). Anggarkan waktu debug, bukan sekadar "isi lalu jalan".

## Catatan: AltStore / SideStore TIDAK Bisa Menggantikan

Sering disarankan, tapi **tidak berlaku** untuk kasus ini:

```
AltStore/SideStore → memasang APLIKASI di iPhone sendiri
Yang dibutuhkan    → Sign in with Apple untuk WEBSITE
```

Dari dokumentasi Apple:
- Tabel *Supported capabilities*: Sign in with Apple = ADP saja
- Akun gratis TIDAK punya "Certificates, Identifiers & Profiles"
- **Services ID** (yang dibutuhkan untuk web) dibuat di sana

Jadi tidak ada jalan pintas — Sign in with Apple butuh membership berbayar.

## Pengguna Apple Tetap Terlayani

Meski tanpa "Sign in with Apple", pengguna iPhone/iPad **tetap punya
cara masuk yang mulus**:

```
Passkey → Face ID / Touch ID di Safari iOS ✅
```

Passkey berfungsi di Safari iOS dan memakai biometrik perangkat.
Untuk pengguna Apple yang tidak punya akun Google/Microsoft/GitHub,
ini menutup kebutuhan mereka tanpa Apple ID sebagai IdP.

## Kalau Nanti Ada Klien yang Minta Apple

Evaluasi ulang dengan pertanyaan:

1. Apakah klien benar-benar butuh, atau hanya "nice to have"?
2. Berapa banyak pengguna yang HANYA punya Apple ID?
3. Apakah $99/tahun sepadan dengan nilai klien itu?

Kalau jawabannya ya — bayar, isi kredensial, selesai dalam ~30 menit.
