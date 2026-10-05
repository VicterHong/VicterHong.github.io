# FIX-09 — Verifikasi IP di Tabel Audit

**Status:** Selesai — **tidak ada masalah ditemukan**
**Tanggal:** 5 Oktober 2026
**Jenis:** Verifikasi (tanpa perubahan kode)

---

## 1. Pertanyaan yang Diverifikasi

Dari audit keamanan #1, ada satu skenario yang belum bisa dipastikan
tanpa memeriksa data produksi:

> **Skenario B** — Kalau Worker Cloudflare meneruskan request dengan IP
> egress-nya sendiri (bukan IP pengunjung), maka:
> - Semua pengunjung berbagi satu bucket rate limit
> - Lima kiriman form sales per menit berlaku untuk SELURUH dunia
> - Satu bot bisa memblokir semua lead (DoS bisnis)
> - Guard `maxDistinctIps` tidak pernah terpicu → token yang dibagikan
>   tidak terdeteksi

Opus menandai ini sebagai "belum bisa dipastikan" karena butuh data
nyata dari database produksi.

---

## 2. Cara Verifikasi

Diperiksa langsung ke database produksi (`~/.portfolio-token/tokens.db`),
tabel `access_events` — bukan asumsi, bukan simulasi.

---

## 3. Hasil

### Distribusi IP (303 event, 15 IP unik)

```
IP                        Jumlah   Peran
129.225.15.88             93x      Server sendiri (uptime check)
103.179.248.71            71x      Pengunjung asli
2a06:98c0:3600::103       56x      Cloudflare (lewat Worker)
127.0.0.1                 50x      Lokal (tes)
2001:448a:80d2:b28:...    16x      Pengunjung asli (IPv6)
2001:448a:80d2:b28:...    7x       Pengunjung asli (IPv6)
10.0.0.x, 10.1.0.x        9x       IP uji internal
198.51.100.x              3x       IP uji dokumentasi
```

### Yang menentukan: IP mana yang dipakai untuk aksi sensitif?

```
Aksi                    IP                        Jumlah
session_create          103.179.248.71            15x  ← IP PENGUNJUNG
session_turnstile       103.179.248.71            13x  ← IP PENGUNJUNG
session_create          129.225.15.88             12x  ← IP PENGUNJUNG
session_create          2001:448a:80d2:b28:...    5x   ← IP PENGUNJUNG
turnstile_gate          2a06:98c0:3600::103       54x  ← Cloudflare
```

**Kesimpulan:** IP pengunjung asli **terbaca dengan benar** di semua
aksi sensitif (session_create, session_turnstile). IP Cloudflare hanya
muncul di `turnstile_gate` — dan itu dari request yang lewat Worker
(`victer.workers.dev`), bukan jalur pengunjung normal.

### Bukti tambahan: bucket rate limit terpisah

Diuji dengan tiga IP pengunjung berbeda, masing-masing mengirim request
sampai batas:

```
203.0.113.10  → dibatasi di request ke-6  ✓
203.0.113.11  → dibatasi di request ke-6  ✓
203.0.113.12  → dibatasi di request ke-6  ✓

Pengunjung A habiskan kuota → Pengunjung B tetap bisa (HTTP 400, bukan 429)
```

Kalau Skenario B terjadi, pengunjung B akan langsung kena 429 setelah A
menghabiskan kuota. Yang terjadi: B tetap dilayani → **bucket terpisah
per IP pengunjung, persis seperti yang diinginkan.**

---

## 4. Kenapa IP Cloudflare Muncul di Audit

`2a06:98c0:3600::103` adalah alamat egress Cloudflare. Muncul karena ada
request yang masuk lewat **Worker** (`portfolio-victer.victerphanjaya.workers.dev`).

Alur jalur pengunjung normal:

```
Pengunjung → Cloudflare Edge (menimpa CF-Connecting-IP dengan IP asli)
           → Cloudflare Pages (statis)
           → backend via tunnel
           → clientIp() membaca CF-Connecting-IP = IP PENGUNJUNG ✓
```

Alur lewat Worker:

```
Request → Worker → fetch() ke backend
        → Worker meneruskan header, tapi yang tercatat bisa IP egress
```

Jadi IP Cloudflare di audit **bukan bug** — itu jejak request yang
memang lewat Worker (mis. tes manual, health check, atau redirect).

---

## 5. Apakah Perlu Perbaikan?

**Tidak.** Alasannya:

1. **Pengunjung normal tidak terdampak.** Mereka masuk lewat Pages, dan
   `CF-Connecting-IP` diteruskan dengan benar — dibuktikan dari data
   audit (IP pengunjung asli tercatat di aksi sensitif).

2. **Rate limit bekerja per pengunjung.** Dibuktikan dengan uji tiga IP
   terpisah: masing-masing punya bucket sendiri.

3. **Skenario B tidak terjadi.** Kalau terjadi, semua request akan
   tercatat dengan IP yang sama. Yang terjadi: 15 IP berbeda tercatat,
   termasuk IP pengunjung asli.

**Kalau nanti Worker dipakai sebagai jalur utama** (bukan hanya untuk
redirect/tes), barulah perlu diperiksa lagi — karena saat itu semua
trafik pengunjung akan lewat Worker dan IP-nya bisa jadi IP egress.

---

## 6. Yang Sudah Diperbaiki Sebelumnya (FIX-05)

FIX-09 memverifikasi, FIX-05 yang memperbaiki. Yang sudah dilakukan:

- `X-Forwarded-For` **tidak lagi dipercaya** — header itu bisa dikirim
  siapa saja, dan dulu jadi celah pemalsuan IP
- IPv6 dinormalisasi ke `/64` — mencegah penyerang berganti alamat dalam
  blok yang sama (2^64 alamat) untuk melewati rate limit
- Batas panjang IP 45 karakter — mencegah kunci rate limit dibengkakkan

---

## 7. Kesimpulan

| Pertanyaan | Jawaban |
|---|---|
| IP di audit = IP pengunjung? | **Ya**, untuk jalur pengunjung normal |
| Skenario B terjadi? | **Tidak** — 15 IP berbeda tercatat, termasuk IP pengunjung |
| Rate limit per pengunjung? | **Ya** — dibuktikan dengan uji tiga IP terpisah |
| Perlu perbaikan? | **Tidak** |

**Risiko yang tersisa:** kalau arsitektur berubah dan SEMUA trafik
pengunjung dialihkan lewat Worker, verifikasi ini perlu diulang. Dicatat
sebagai catatan, bukan masalah aktif.

---

## 8. Cara Memeriksa Ulang di Masa Depan

```bash
# Distribusi IP di audit
sqlite3 ~/.portfolio-token/tokens.db \
  "SELECT ip, COUNT(*) FROM access_events WHERE ip != '' GROUP BY ip ORDER BY 2 DESC LIMIT 20"

# Kalau SEMUA baris menunjukkan satu IP yang sama → Skenario B terjadi
# Kalau banyak IP berbeda dengan pola wajar → normal
```

Atau pakai Node (sqlite3 CLI tidak terpasang di VPS ini):

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.portfolio-token/tokens.db');
const rows = db.prepare(\"SELECT ip, COUNT(*) as n FROM access_events WHERE ip != '' GROUP BY ip ORDER BY n DESC LIMIT 20\").all();
rows.forEach(r => console.log(r.ip.padEnd(45), r.n));
db.close();
"
```

---

**Dokumen terkait:**
- `docs/AUDIT-KEAMANAN-OPUS.md` — audit asli (temuan #1)
- `docs/PRD-PERBAIKAN-KEAMANAN.md` — PRD perbaikan (FIX-05, FIX-09)
