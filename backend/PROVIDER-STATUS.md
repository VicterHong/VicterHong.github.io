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

## ⬜ Apple — DIPUTUSKAN TIDAK DIPAKAI

**Alasan:** $99/tahun, dan permintaan login lewat Apple ID diperkirakan sedikit.

**Kode Apple SUDAH SIAP dan teruji.** Kalau nanti berubah pikiran, hanya perlu:

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

**Tidak ada pekerjaan ulang.** Endpoint, verifikasi id_token, dan
penanganan form_post Apple sudah diuji.

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
