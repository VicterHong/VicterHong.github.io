# Audit Keamanan: portfolio-victer (backend token)

**Catatan cakupan:** `routes.mjs` terpotong. Modul `db.mjs`, `tokens.mjs`, `sessions.mjs`, `cms.mjs`, `content.mjs`, `rate-limit.mjs`, dispatcher server, dan `admin.html` tidak tersedia. Temuan yang bergantung pada kode tersebut ditandai **[perlu verifikasi]** dan tidak saya anggap pasti.

---

## 1. IP klien diambil dari header yang bisa dipalsukan, sehingga rate limit dan guard bisa dilewati atau rusak

**Tingkat:** Tinggi jika origin bisa dijangkau tanpa melewati Cloudflare. Sedang jika tidak.

**Bukti:** `http-util.mjs` → `clientIp()`:
```js
const cf = req.headers['cf-connecting-ip'];
if (typeof cf === 'string' && cf.trim()) return cf.trim();
const fwd = req.headers['x-forwarded-for'];
```
Nilai ini dipakai sebagai kunci `rateLimited()` (`${pathname}:${clientIp(req)}`), di `enforceAbuseRules` (hitungan `maxDistinctIps`), di `recordEvent`, dan dioper ke Turnstile sebagai `remoteip`.

**Dampak nyata:**
- **Skenario A, origin terjangkau langsung.** Anda menulis bahwa header backend diukur "langsung". Jika itu berarti backend bisa diakses tanpa lewat edge Cloudflare (misalnya `HOST` diubah ke `0.0.0.0`, ada proxy lokal, atau ada proses lain di VPS), penyerang cukup mengirim `CF-Connecting-IP: <acak>` di setiap request. Akibatnya:
  - Batas 20/menit di `/api/token/validate`, 10/menit di session, dan 5/menit di sales hilang sepenuhnya.
  - Log audit bisa diisi IP palsu.
  - Token yang sah bisa sengaja dibuat melewati `maxDistinctIps`, lalu dicabut otomatis. Ini butuh token korban.
- **Skenario B, lewat Worker.** Jika Worker meneruskan request dengan `fetch()`, ada kemungkinan `CF-Connecting-IP` yang sampai ke backend adalah IP egress Worker, bukan IP pengunjung. Akibatnya:
  - **Semua pengunjung berbagi satu bucket.** Lima kiriman form sales per menit berlaku untuk seluruh dunia. Satu bot bisa memblokir semua lead (DoS bisnis).
  - Guard `maxDistinctIps` **tidak pernah terpicu**, sehingga token yang dibagikan tidak terdeteksi.

**Perbaikan:**
1. Periksa tabel audit. Jika semua IP sama atau berada di rentang Cloudflare (misalnya `2a06:98c0::/29`), berarti Skenario B terjadi.
2. Di Worker, set header eksplisit lalu verifikasi di backend dengan secret bersama:
   ```js
   // Worker
   headers.set('x-client-ip', request.headers.get('cf-connecting-ip'));
   headers.set('x-edge-auth', env.EDGE_SECRET);
   ```
   Backend hanya mempercayai `x-client-ip` jika `x-edge-auth` cocok (dibandingkan secara timing-safe). Jika tidak cocok, pakai `req.socket.remoteAddress`.
3. Hapus fallback `x-forwarded-for`. Pastikan `HOST=127.0.0.1` dan firewall menutup port 8788.

---

## 2. `decodeURIComponent` tanpa penanganan error, plus potensi path traversal pada `:slug`

**Tingkat:** Tinggi **[perlu verifikasi lokasi pemanggilan]**

**Bukti:** `routes.mjs` → `matchPath()`:
```js
if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(u[i]);
```
`matchPath` dipanggil oleh dispatcher **sebelum** handler dijalankan, jadi kemungkinan besar **di luar** pembungkus `safe()`.

**Dampak nyata:**
- **Crash.** `GET /api/project/%E0%A4%A/locked` membuat `decodeURIComponent` melempar `URIError`. Jika listener `http.createServer` tidak membungkusnya dengan try/catch, Node memunculkan `uncaughtException` dan proses mati. systemd memang akan me-restart layanan, tetapi request ini bisa diulang tanpa henti. Setiap restart juga mengosongkan state rate limit di memori.
- **Path traversal.** `%2F` didekode menjadi `/`. Contohnya, `/api/project/..%2F..%2F.ssh%2Fauthorized_keys/locked` lolos dari pemisahan `split('/')`, lalu menghasilkan slug `../../.ssh/authorized_keys`. Ini aman **hanya jika** `isValidSlug()` dipanggil sebelum `loadLockedContent()` dan memakai whitelist ketat.

**Perbaikan:**
```js
let v;
try { v = decodeURIComponent(u[i]); } catch { return null; }
if (!/^[a-z0-9-]{1,64}$/.test(v)) return null;
params[p[i].slice(1)] = v;
```
Selain itu:
- Bungkus seluruh request listener dengan try/catch.
- Tambahkan `process.on('unhandledRejection', ...)` yang hanya mencatat log.
- Di `content.mjs`, setelah `resolve(contentDir, slug)`, pastikan hasilnya masih diawali `contentDir + path.sep`.

---

## 3. Pesan error internal dikirim ke klien

**Tingkat:** Sedang

**Bukti:** `safe()`:
```js
if (!res.headersSent) sendJson(res, code, { ok: false, error: err?.message ?? 'kesalahan internal' });
```
Untuk error 500, `err.message` mentah dikirim ke klien.

**Dampak nyata:** Penyerang yang memicu error bisa membaca detail internal. Contohnya:
- `ENOENT: no such file or directory, open '/home/<user>/.portfolio-token/content/x.json'` membocorkan username VPS dan struktur direktori.
- Pesan SQLite seperti `SQLITE_CONSTRAINT`, nama tabel, atau nama kolom membantu menyusun serangan injeksi jika ada titik lemah di modul lain.

Ini berlaku untuk semua endpoint publik yang memakai `safe()`.

**Perbaikan:**
```js
const msg = code >= 500 ? 'kesalahan_internal' : (err?.message ?? 'kesalahan');
```
Untuk error 4xx, kirim kode error yang sudah ditentukan (whitelist), bukan `message` bebas.

---

## 4. Model autentikasi admin: satu kunci statis tanpa pembatasan

**Tingkat:** Sedang. Menjadi Tinggi jika digabung dengan temuan #5.

**Bukti:** `isAdmin()` membandingkan satu `config.adminKey` statis. `PUBLIC_LIMITS` tidak mencakup `/api/admin/*`.

**Dampak nyata:**
- Kunci yang sama berlaku untuk sekitar 30 endpoint: issue/revoke token, export, cleanup, dan publish. Tidak ada kedaluwarsa, tidak ada identitas per admin, dan tidak ada MFA. Satu kebocoran berarti penyerang menguasai semua endpoint, termasuk export data lead.
- Panel `admin.html` berjalan di browser, jadi kunci hampir pasti disimpan di `localStorage`/`sessionStorage` atau diketik ulang. **[perlu verifikasi]** Jika disimpan di storage, XSS sekecil apa pun di origin Pages dapat mencuri kunci tersebut.
- Tidak ada rate limit pada percobaan kunci yang salah. Brute force terhadap kunci acak ≥24 karakter memang tidak realistis, tetapi juga tidak ada alarm atau pencatatan.

**Bug tambahan (Rendah):**
- `key.length !== expected.length` membandingkan panjang **string**, tetapi `timingSafeEqual` membutuhkan panjang **byte** yang sama. Kunci dengan panjang karakter sama tetapi berisi karakter multibyte membuat fungsi ini melempar `RangeError`. Jika `isAdmin` dipanggil di dalam `safe()`, pesan error ini ikut bocor (lihat #3). Jika di luar, ada risiko crash.
- Pemeriksaan panjang juga membocorkan panjang kunci lewat perbedaan waktu respons.

**Perbaikan:**
```js
import { createHash, timingSafeEqual } from 'node:crypto';
const h = (s) => createHash('sha256').update(String(s)).digest();
return timingSafeEqual(h(key), h(expected));
```
Langkah tambahan:
- Batasi `/api/admin/*` per IP, misalnya 10 kegagalan per 15 menit, dan catat setiap kegagalan di audit.
- Batasi akses admin di edge dengan Cloudflare Access (Zero Trust, gratis), sehingga backend tidak terbuka untuk publik.
- Jangan simpan kunci di `localStorage`. Untuk jangka panjang, ganti dengan sesi admin yang berumur pendek.

---

## 5. Header keamanan hilang di Pages: CSP dan X-Frame-Options

**Tingkat:** Sedang

**Bukti:** Header yang terukur di production (Pages) tidak memuat CSP, X-Frame-Options, maupun Permissions-Policy.

**Dampak nyata:**
- **Tanpa CSP**, satu saja `innerHTML` yang lupa di-escape (70 pemakaian `escapeHtml` berarti ada 70 titik yang harus benar semua) atau satu skrip pihak ketiga yang disusupi sudah cukup untuk menjalankan JS bebas. Jika `admin.html` dilayani dari Pages, akibatnya kunci admin dicuri (#4). Data dari `/api/comments` (publik, bisa ditulis siapa saja) adalah kandidat stored XSS yang paling jelas jika ditampilkan di panel admin. **[perlu verifikasi render komentar]**
- **Tanpa X-Frame-Options / `frame-ancestors`**, halaman admin dan halaman form token bisa dimuat dalam iframe di situs penyerang. Ini membuka clickjacking, misalnya admin dibuat tanpa sadar mengklik "revoke" atau "publish".
- **HSTS:** dampaknya praktis kecil. Seluruh TLD `.dev` (termasuk `pages.dev`) sudah ada di daftar HSTS preload browser. Header ini baru penting jika Anda memakai domain kustom non-`.dev`, atau jika hostname tunnel backend bukan `.dev`.

**Perbaikan:** Tambahkan berkas `_headers` di Pages:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://<host-api>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
```
Untuk backend (respons JSON), tambahkan di `sendJson`:
```
content-security-policy: default-src 'none'; frame-ancestors 'none'
```

---

## 6. Turnstile gagal-terbuka (fail-open) dan tidak memvalidasi hostname/action

**Tingkat:** Sedang

**Bukti:** `turnstile.mjs`:
- `if (!secret) return { ok: true, skipped: true };` membuat Turnstile mati diam-diam jika secret kosong.
- Respons 5xx, timeout 8 detik, dan error jaringan semuanya dikembalikan sebagai `ok: true, skipped: true`.
- `data.hostname` diambil tetapi tidak pernah dibandingkan. `data.action` sama sekali tidak diperiksa.
- `turnstileGate` tidak mencatat event apa pun saat `skipped`, sehingga mode bypass tidak terlihat di audit.

**Dampak nyata:**
- Jika `TURNSTILE_SECRET_KEY` hilang dari `service.env` (misalnya saat migrasi atau salah ketik nama variabel), seluruh proteksi bot pada gerbang token dan form sales mati **tanpa jejak**.
- Token yang diselesaikan di hostname lain (preview deployment, staging) atau untuk aksi lain tetap diterima. Ini menyimpang dari rekomendasi Cloudflare.

**Perbaikan:**
- Di produksi, tambahkan `TURNSTILE_SECRET_KEY` ke `validateConfig()` sehingga layanan menolak start jika kosong.
- Catat setiap `skipped` dengan `recordEvent({ outcome: 'dilewati', detail: result.error })` dan pasang peringatan di sisi admin.
- Validasi hostname dan action:
  ```js
  if (data.hostname !== EXPECTED_HOST) return { ok: false, error: 'hostname_tidak_cocok' };
  if (expectedAction && data.action !== expectedAction) return { ok: false, error: 'action_tidak_cocok' };
  ```
- Untuk `/api/token/validate` dan `/api/token/session`, pertimbangkan fail-closed saat Cloudflare tidak terjangkau. Rate limit saja tidak cukup jika temuan #1 terjadi.

---

## 7. Endpoint publik tanpa rate limit

**Tingkat:** Sedang

**Bukti:** `PUBLIC_LIMITS` hanya mencakup 7 path. Endpoint berikut tidak dibatasi:
- `/api/experiment/convert`
- `/api/ready`
- `/api/cms/collections`
- `/api/seo/*`
- `/api/token/logout`
- `/api/config`
- `/api/project/:slug/locked`
- semua `/api/admin/*`

**Dampak nyata:**
- **`/api/experiment/convert`:** penyerang bisa mengirim konversi palsu tanpa batas. Hasil A/B test menjadi tidak bisa dipercaya, dan database SQLite membengkak (DoS disk).
- **`/api/ready`:** setiap request membaca database dan menguji penulisan disk. Membanjirinya menghasilkan I/O berat. Isi responsnya (ruang disk, status konfigurasi) juga perlu dicek karena bisa membocorkan informasi. **[perlu verifikasi isi `readiness()`]**
- **`/api/project/:slug/locked`:** tidak ada batas per IP. Untuk token tak dikenal, satu-satunya penghalang adalah guard berbasis token yang tidak berlaku. Brute force sesi/token lewat endpoint ini tidak dibatasi.

**Perbaikan:** Balik logikanya menjadi **default-deny**. Setiap path tanpa aturan khusus mendapat batas default (misalnya 60/menit). Untuk `experiment/convert`, tambahkan deduplikasi per visitor atau eksperimen. Untuk `/api/ready`, simpan hasilnya di cache selama 5–10 detik.

---

## 8. Rate limit per alamat IPv6 penuh

**Tingkat:** Sedang (Rendah jika temuan #1 sudah diperbaiki)

**Bukti:** Kunci rate limit memakai `clientIp(req)` utuh.

**Dampak nyata:** Satu VPS biasanya mendapat blok /64, yaitu 2^64 alamat. Penyerang yang berganti alamat di setiap request melewati semua batas per IP.

**Perbaikan:** Normalisasi alamat IPv6 ke prefiks /64 (atau /56) sebelum dijadikan kunci. T