# Autentikasi — Google, Microsoft, Apple, GitHub, Passkey, SSO

Backend sudah **berfungsi penuh**. Yang tersisa hanya mengisi kredensial: tanpa
kredensial, tombol tidak muncul dan endpoint menolak dengan pesan yang jelas
(bukan 404 atau 500).

---

## Ringkas: apa yang sudah jadi

| Cara masuk | Status | Yang Anda butuhkan |
|---|---|---|
| **Passkey** | ✅ AKTIF | — tidak ada. Langsung jalan. |
| **Google** | ✅ AKTIF | — sudah terpasang (production) |
| **GitHub** | ✅ AKTIF | — sudah terpasang |
| **Microsoft** | ✅ AKTIF | — sudah terpasang (multi-tenant + pribadi) |
| **SSO perusahaan** | ✅ AKTIF | — Cloudflare Access (OIDC, One-time PIN) |
| **Apple** | ⬜ TIDAK DIPAKAI | $99/tahun — lihat PROVIDER-STATUS.md |

**Ringkasnya:** lima dari enam cara masuk sudah aktif. Apple diputuskan
tidak dipakai karena $99/tahun sementara permintaannya diperkirakan
sedikit — kodenya sudah siap kalau nanti berubah pikiran.

Lihat `PROVIDER-STATUS.md` untuk status terkini dan cara mengaktifkan
Apple kalau diperlukan.

**Passkey tidak butuh kredensial pihak ketiga.** Ia memakai kunci kriptografi
yang dibuat perangkat pengguna, jadi bisa langsung dipakai.

---

## 1. Passkey (sudah aktif)

Tidak ada yang perlu diisi. Yang perlu dipastikan hanya origin:

```bash
# service.env
WEBAUTHN_ORIGINS=https://staging.vivastic.id,https://abc.pages.dev
```

`SITE_URL` selalu ikut otomatis. Origin **harus** memuat host yang melayani
halaman masuk — WebAuthn mengikat kredensial ke domain, jadi origin yang tidak
terdaftar membuat pendaftaran gagal dengan pesan yang membingungkan pengguna.

**Cara pengguna memakainya:** klik "Masuk dengan passkey" → sidik jari / wajah
/ PIN perangkat. Tidak ada email yang diketik. Browser yang memilih akun.

**Menambah passkey** butuh sesi aktif (untuk mencegah orang mendaftarkan
passkey ke akun milik orang lain):

```
POST /api/auth/passkey/registrasi/mulai    → challenge
POST /api/auth/passkey/registrasi/selesai  → verifikasi + simpan
```

---

## 2. Google

1. Buka [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. **Create Credentials** → **OAuth client ID** → **Web application**
3. **Authorized redirect URIs** — tambahkan **persis** ini:

```
https://portfolio-victer.pages.dev/api/auth/google/callback
```

4. Salin ke `service.env`:

```bash
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
```

> **Redirect URI harus sama persis.** RFC 9700 melarang pencocokan pola untuk
> redirect URI — perbandingan dilakukan byte per byte. Satu garis miring
> tambahan di akhir akan ditolak dengan `redirect_uri_mismatch`.

---

## 3. GitHub

1. [GitHub Developer Settings](https://github.com/settings/developers) →
   **New OAuth App**
2. **Authorization callback URL**:

```
https://portfolio-victer.pages.dev/api/auth/github/callback
```

3. Salin:

```bash
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=xxxxx
```

> **GitHub bukan OpenID Connect.** Tidak ada `id_token`, tidak ada JWKS.
> Identitas diambil dengan memanggil `api.github.com/user`, dan email diambil
> dari `/user/emails` — hanya email **primary + verified** yang dipakai.
> Email publik di profil bisa diubah siapa saja, jadi tidak dipercaya.

---

## 4. Microsoft

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
   **App registrations** → **New registration**
2. **Redirect URI** → platform **Web**:

```
https://portfolio-victer.pages.dev/api/auth/microsoft/callback
```

3. **Certificates & secrets** → **New client secret** → salin **Value**
   (bukan Secret ID)
4. Salin:

```bash
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=xxxxx~xxxxx
```

> **Jangan** tandai redirect URI sebagai `spa`. Tipe `spa` mewajibkan
> permintaan token datang dari browser dengan header `Origin`, sementara alur
> kita menukar code dari server (back channel). Microsoft akan menolak dengan
> `invalid_request`.
>
> Issuer Microsoft memuat `{tenantid}`, jadi verifikasi issuer di kode
> memakai pencocokan pola — bukan perbandingan langsung.

---

## 5. Apple

Apple adalah yang paling rumit: **tidak ada client secret berupa string**.
Yang dipakai adalah JWT yang ditandatangani private key `.p8`.

### 5a. Buat Services ID (bukan App ID)

1. [Apple Developer](https://developer.apple.com/account/resources/identifiers)
   → **Identifiers** → **+** → **Services IDs**
2. Identifier, misalnya: `id.vivastic.signin`
3. Centang **Sign In with Apple** → **Configure**
   - **Primary App ID**: pilih App ID aplikasi Anda
   - **Domains**: `portfolio-victer.pages.dev`
   - **Return URLs**: `https://portfolio-victer.pages.dev/api/auth/apple/callback`

> **Services ID, bukan App ID.** Hanya Services ID yang menerima
> `redirect_uri` untuk alur web. App ID dipakai aplikasi native.

### 5b. Buat kunci privat

1. **Keys** → **+** → centang **Sign in with Apple** → **Configure** →
   pilih Primary App ID
2. **Download** berkas `.p8` — **hanya bisa diunduh sekali**
3. Catat **Key ID** (10 karakter)

### 5c. Salin ke service.env

```bash
APPLE_CLIENT_ID=id.vivastic.signin
APPLE_TEAM_ID=ABCDE12345
APPLE_KEY_ID=XYZ9876543
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49...\n-----END PRIVATE KEY-----
```

> **Baris baru ditulis `\n`.** Variabel lingkungan tidak bisa memuat baris baru
> asli. Kode menggantinya kembali (`replace(/\\n/g, '\n')`) sebelum dipakai
> menandatangani.
>
> **Nama pengguna hanya dikirim SEKALI** — pada otorisasi pertama. Setelah itu
> Apple tidak mengirimnya lagi. Ini perilaku Apple, bukan bug.

---

## 6. SSO perusahaan

SSO **belum bisa langsung dipakai** — ia butuh broker identitas.

**Kenapa:** SSO perusahaan tidak punya satu endpoint otorisasi yang diketahui
sebelumnya. Setiap organisasi punya IdP sendiri (Okta, Azure AD, Google
Workspace). Broker-lah yang tahu IdP mana yang harus dihubungi berdasarkan
domain email pengguna — sehingga kita tidak perlu menyimpan rahasia milik
setiap pelanggan.

**Pilihan broker:** [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/),
Okta, atau Auth0.

```bash
SSO_ENTRY_POINT=https://vivastic.cloudflareaccess.com/cdn-cgi/access/sso
```

**Yang masih perlu ditulis:** callback SSO saat ini **menolak semua
permintaan** dengan pesan `sso_belum_dikonfigurasi`. Itu disengaja — menerima
identitas tanpa memverifikasi tanda tangan broker berarti siapa pun bisa masuk
sebagai siapa pun dengan menebak URL callback.

Setelah broker dipilih, yang perlu ditambahkan di `auth-routes.mjs` adalah
verifikasi tanda tangan broker. Untuk Cloudflare Access, itu header
`Cf-Access-Jwt-Assertion` yang diverifikasi terhadap JWKS tim.

---

## Endpoint lengkap

### OAuth

```
GET  /api/auth/google              → alihkan ke Google
GET  /api/auth/google/callback     → selesai, buat sesi
GET  /api/auth/microsoft
GET  /api/auth/microsoft/callback
GET  /api/auth/apple
GET  /api/auth/apple/callback
POST /api/auth/apple/callback      ← Apple memakai form_post
GET  /api/auth/github
GET  /api/auth/github/callback
GET  /api/auth/sso
GET  /api/auth/sso/callback
```

Parameter opsional: `?lanjut=/halaman-tujuan` — hanya path internal yang
diterima, untuk mencegah open redirect.

### Passkey

```
POST /api/auth/passkey/registrasi/mulai    (butuh sesi)
POST /api/auth/passkey/registrasi/selesai  (butuh sesi)
POST /api/auth/passkey/masuk/mulai
POST /api/auth/passkey/masuk/selesai
```

### Manajemen cara masuk

```
GET  /api/auth/identitas        (butuh sesi)
POST /api/auth/identitas/hapus  (butuh sesi)
```

---

## Kode galat di halaman masuk

Kegagalan dialihkan ke `/sign-in?galat=<kode>`. Kode yang mungkin muncul:

| Kode | Arti |
|---|---|
| `provider_belum_aktif` | Kredensial provider belum diisi |
| `provider_tidak_dikenal` | Nama provider salah |
| `state_tidak_sah` | State kedaluwarsa / sudah dipakai (CSRF) |
| `callback_tidak_lengkap` | Provider tidak mengirim code atau state |
| `tukar_code_gagal` | Penukaran code ditolak provider |
| `identitas_gagal` | id_token tidak lolos verifikasi |
| `ditolak_pengguna` | Pengguna menekan "Batal" di halaman provider |
| `terlalu_banyak` | Rate limit |
| `sso_belum_dikonfigurasi` | Broker SSO belum diatur |

---

## Keamanan: keputusan yang diambil

**Authorization Code + PKCE, bukan implicit flow.**
RFC 9700 (Januari 2025) melarang implicit flow. Token tidak boleh muncul di URL
— URL tersimpan di riwayat browser, header Referer, dan log server. Yang boleh
lewat front channel hanya `code`: sekali pakai, berumur pendek, tidak berguna
tanpa `code_verifier` yang tidak pernah meninggalkan server.

**`state` wajib, disimpan di database, dihapus saat dipakai.**
Disimpan di database, bukan cookie, karena `code_verifier` adalah rahasia —
kalau ia ada di cookie, ia ikut terkirim di setiap request dan bisa terbaca
kalau ada XSS.

**id_token diverifikasi tanda tangannya terhadap JWKS provider.**
Tanpa ini, siapa pun yang bisa menyisipkan respons dari provider bisa mengaku
sebagai pengguna mana pun. Mempercayai isi JWT tanpa memeriksa tanda tangannya
sama dengan mempercayai input pengguna.

**Email harus terverifikasi sebelum menyambung ke akun yang sudah ada.**
Kalau tidak, penyerang bisa mendaftar di provider dengan mengetik email korban
(banyak provider mengizinkan sebelum verifikasi), lalu masuk ke akun korban.

**Passkey: tanda tangan diverifikasi terhadap kunci publik di database.**
`id` kredensial yang dikirim klien hanya dipakai untuk mencari baris. Klien
bisa mengirim id apa pun; tanpa kunci privat yang cocok, tanda tangannya tidak
sah. Diuji: tanda tangan dengan kunci salah **ditolak**.

**Origin WebAuthn diperiksa terhadap daftar putih.**
Tanpa ini, situs penyerang bisa memicu autentikasi ke domain kita.

**Attestation WebAuthn TIDAK diverifikasi.**
Sesuai anjuran FIDO Alliance untuk layanan konsumen. Attestation berguna kalau
Anda membatasi authenticator tertentu (misalnya hanya kunci hardware
bersertifikat FIPS); memeriksanya untuk semua pengguna mematahkan passkey
lintas perangkat.

---

## Menguji

```bash
cd backend
SERVICE_SECRET=... ADMIN_KEY=... DB_PATH=/tmp/uji.db PORT=8799 NODE_ENV=development node src/server.mjs &
node uji-auth.mjs
```

23 pemeriksaan, termasuk kriptografi passkey nyata (kunci P-256 dibuat,
ditandatangani, diverifikasi).

---

## Setelah mengisi kredensial

Tombol menyala sendiri. Tidak ada HTML yang perlu diubah — frontend membaca
`/api/config` dan menampilkan tombol hanya untuk provider yang siap.

Verifikasi:

```bash
curl -s https://portfolio-victer.pages.dev/api/config | python3 -m json.tool | grep -A 6 sso
```
