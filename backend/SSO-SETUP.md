# SSO Perusahaan (OIDC)

SSO sudah **berfungsi penuh** di backend. Yang dibutuhkan hanya kredensial dari
IdP organisasi.

---

## Kenapa OIDC, bukan SAML

OIDC memakai JWT dan **dokumen discovery**, sehingga **satu implementasi**
bekerja untuk:

```
Okta              Azure AD (Entra)     Google Workspace
Keycloak          Auth0                OneLogin
JumpCloud         Cloudflare Access
```

SAML butuh parsing XML dan konfigurasi berbeda per vendor — setiap klien baru
berarti perubahan kode.

**Klien yang hanya mendukung SAML** tetap bisa dilayani: broker (Cloudflare
Access, Okta) bicara SAML ke IdP mereka, lalu OIDC ke kita. Tidak ada
perubahan kode yang dibutuhkan.

---

## Cara Kerja

```
1. Pengguna klik "Masuk dengan SSO"
2. Kita baca /.well-known/openid-configuration dari IdP
   → dapat authorization_endpoint, token_endpoint, jwks_uri
3. Alihkan pengguna ke IdP dengan state + nonce (+ PKCE kalau didukung)
4. Pengguna login di IdP organisasinya
5. IdP kembalikan code ke /api/auth/sso/callback
6. Kita tukar code → id_token (back channel)
7. Verifikasi tanda tangan id_token terhadap JWKS IdP
8. Verifikasi issuer + audience + nonce + exp
9. Temukan/buat pengguna, buat sesi
```

**Tidak ada URL IdP yang ditulis di kode.** Semuanya dibaca dari discovery —
jadi kode tidak basi kalau IdP pindah endpoint.

---

## Konfigurasi

Empat variabel di `service.env`:

```bash
SSO_ISSUER=https://vivastic.okta.com
SSO_CLIENT_ID=0oa1b2c3d4e5f6g7h8i9
SSO_CLIENT_SECRET=rahasia-dari-idp

# Opsional
SSO_LABEL=Okta                    # teks tombol: "Masuk dengan Okta"
SSO_DOMAINS=vivastic.id           # batasi ke domain ini (dipisah koma)
```

### Cara Mendapatkan Nilai

Buka dokumen discovery IdP Anda:

```
https://<domain-IdP>/.well-known/openid-configuration
```

Cari `issuer` di dokumen itu — **itulah nilai SSO_ISSUER**.

Contoh per IdP:

```
Okta            https://vivastic.okta.com
Azure AD        https://login.microsoftonline.com/<tenant-id>/v2.0
Google Workspace  https://accounts.google.com
Keycloak        https://sso.perusahaan.com/realms/nama-realm
Auth0           https://vivastic.us.auth0.com
Cloudflare      https://vivastic.cloudflareaccess.com
```

### Redirect URI yang Harus Didaftarkan

Daftarkan **persis** ini di aplikasi OIDC IdP:

```
https://portfolio-victer.pages.dev/api/auth/sso/callback
```

---

## SSO_DOMAINS — Batasi ke Organisasi Tertentu

Kosong = semua domain boleh (cocok untuk broker multi-organisasi).

Diisi = hanya email dari domain itu yang bisa masuk:

```bash
SSO_DOMAINS=vivastic.id,anak-perusahaan.co.id
```

**Pemeriksaan dilakukan DUA KALI:**

```
1. Di /api/auth/sso    → kalau pengguna sudah mengisi email (login_hint),
                          domain diperiksa SEBELUM dialihkan ke IdP.
                          Pengguna dari domain lain tidak dibuang ke IdP
                          yang pasti menolaknya.

2. Di /api/auth/sso/callback → diperiksa ULANG setelah identitas datang.
                          Ini yang MENENTUKAN — IdP bisa mengembalikan
                          identitas dari domain apa pun, dan login_hint
                          hanyalah petunjuk yang bisa diabaikan.
```

Pemeriksaan kedua tidak bisa dilewati dengan tidak mengisi email.

---

## PKCE — Dipakai Kalau IdP Mendukung

Discovery menyebutkan dukungannya di `code_challenge_methods_supported`.
Kalau ada `S256`, kita pakai. Kalau tidak, kita lewati.

**Kenapa tidak dipaksa:** banyak IdP korporat lama tidak mendukung PKCE.
Memaksa berarti login gagal dengan pesan yang membingungkan. `state` + `nonce`
masih melindungi di kedua kasus.

---

## Keamanan

| Pemeriksaan | Kenapa |
|---|---|
| `state` sekali pakai | Mencegah CSRF. Diuji: pemakaian kedua ditolak. |
| `nonce` | Mengikat id_token ke permintaan otorisasi ini. SSO korporat sering lewat jaringan internal — tanpa nonce, id_token lama bisa diputar ulang. |
| Tanda tangan id_token | Terhadap JWKS IdP. Tanpa ini, siapa pun bisa mengaku sebagai siapa pun. |
| `issuer` | Discovery **dan** id_token. Kalau tidak cocok, ada proxy/salah URL — kita berhenti, bukan melanjutkan. |
| `audience` | id_token harus ditujukan untuk client_id kita, bukan aplikasi lain. |
| HTTPS wajib | OIDC di atas HTTP berarti code dan id_token bisa disadap. Pengecualian: localhost. |
| Domain | Kalau `SSO_DOMAINS` diisi, diperiksa dua kali (lihat di atas). |

---

## Menguji

```bash
# Terminal 1: IdP tiruan
cd backend && node idp-tiruan.mjs 9911

# Terminal 2: server dengan SSO dikonfigurasi ke IdP tiruan
cd backend && SERVICE_SECRET=... ADMIN_KEY=... DB_PATH=/tmp/uji.db PORT=8799 \
  SITE_URL=http://localhost:8900 \
  SSO_ISSUER=http://127.0.0.1:9911 \
  SSO_CLIENT_ID=klien-uji \
  SSO_CLIENT_SECRET=rahasia-uji \
  SSO_LABEL="VIVASTIC ID" \
  SSO_DOMAINS=perusahaan.com \
  node src/server.mjs

# Terminal 3: uji
cd backend && node uji-sso.mjs
```

**25 pemeriksaan, semuanya lulus.** Termasuk:

```
✅ Discovery dibaca dan divalidasi
✅ PKCE S256 dipakai (IdP mendukung)
✅ State sekali pakai — pemakaian kedua DITOLAK
✅ Nonce diverifikasi
✅ Tanda tangan JWT diverifikasi terhadap JWKS
✅ Akun dibuat dari identitas SSO
✅ Sesi benar-benar berfungsi (cookie bisa akses /api/auth/profil)
✅ Domain di luar daftar DITOLAK
✅ State palsu ditolak
✅ Penolakan pengguna ditangani
```

`idp-tiruan.mjs` membuat kunci RSA sungguhan, menerbitkan JWT yang
ditandatangani, dan menyediakan JWKS — jadi verifikasi tanda tangan
**benar-benar diuji**, bukan di-mock.

---

## Per IdP: Catatan Khusus

### Okta

```
1. Applications → Create App Integration → OIDC → Web Application
2. Sign-in redirect URI: https://portfolio-victer.pages.dev/api/auth/sso/callback
3. Salin Client ID + Client Secret
4. SSO_ISSUER=https://<domain>.okta.com
```

### Azure AD (Entra)

```
1. App registrations → New registration
2. Redirect URI → Web → https://portfolio-victer.pages.dev/api/auth/sso/callback
3. Certificates & secrets → New client secret → salin VALUE
4. SSO_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
```

⚠️ Pakai `<tenant-id>`, bukan `common` — SSO perusahaan biasanya
single-tenant.

### Google Workspace

```
1. APIs & Services → Credentials → OAuth client ID → Web application
2. Authorized redirect URI: https://portfolio-victer.pages.dev/api/auth/sso/callback
3. SSO_ISSUER=https://accounts.google.com
```

⚠️ Kalau `SSO_ISSUER=https://accounts.google.com`, ini akan bertabrakan
dengan tombol Google biasa — pakai salah satu, atau pakai `SSO_LABEL` untuk
membedakan.

### Cloudflare Access

```
1. Zero Trust → Access → Applications → Add an application → SaaS
2. Tambahkan OIDC sebagai aplikasi SaaS
3. Redirect URI: https://portfolio-victer.pages.dev/api/auth/sso/callback
4. SSO_ISSUER=https://<team>.cloudflareaccess.com
```

Keunggulan: Cloudflare Access **gratis sampai 50 user**, dan bisa
menjembatani IdP yang hanya mendukung SAML.

### Keycloak (self-hosted)

```
1. Realm → Clients → Create
2. Valid redirect URIs: https://portfolio-victer.pages.dev/api/auth/sso/callback
3. SSO_ISSUER=https://<domain>/realms/<nama-realm>
```

---

## Kode Galat

| Kode | Arti |
|---|---|
| `sso_belum_aktif` | SSO_ISSUER atau SSO_CLIENT_ID belum diisi |
| `sso_idp_tidak_terjangkau` | Discovery IdP gagal — cek SSO_ISSUER dan koneksi |
| `sso_domain_tidak_cocok` | Email di luar SSO_DOMAINS |
| `state_tidak_sah` | State kedaluwarsa / sudah dipakai |
| `callback_tidak_lengkap` | IdP tidak mengirim code atau state |
| `tukar_code_gagal` | Penukaran code ditolak IdP |
| `identitas_gagal` | id_token tidak lolos verifikasi |
| `ditolak_pengguna` | Pengguna menekan Batal di IdP |

---

## Tombol di Halaman Masuk

Tombol SSO **menyala sendiri** begitu `SSO_ISSUER` + `SSO_CLIENT_ID` diisi.
Label-nya dari `SSO_LABEL`:

```
SSO_LABEL kosong    → "Masuk dengan SSO perusahaan"
SSO_LABEL=Okta      → "Masuk dengan Okta"
```

Frontend juga mengirim email yang sudah diisi pengguna sebagai `login_hint` —
membantu IdP memilih akun yang benar, dan memungkinkan pemeriksaan domain
lebih awal.
