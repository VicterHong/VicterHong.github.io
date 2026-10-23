# HSTS di `victer.is-a.dev` — kenapa `max-age=0`

Status: **diketahui, belum bisa diperbaiki dari repo ini.**
Terakhir diperiksa: 23 Oktober 2026.

## Gejala

| Host | `Strict-Transport-Security` |
| --- | --- |
| `portfolio-victer.pages.dev` | `max-age=31536000; includeSubDomains; preload` ✅ |
| `victer.is-a.dev` | `max-age=0; includeSubDomains` ❌ |

Nilai dari `_headers` dan `workers/site.ts` (`max-age=63072000`) tidak pernah
sampai ke browser di domain kustom.

## Penyebab

`victer.is-a.dev` bukan zona Cloudflare milik kita. Di
`is-a.dev/register/domains/victer.json` record-nya:

```json
{ "records": { "CNAME": "portfolio-victer.pages.dev" }, "proxied": true }
```

`proxied: true` menaruh hostname ini di dalam zona **is-a.dev** (33.000+
subdomain berbagi satu zona). Zona itu punya setting HSTS sendiri di posisi
*wind down* (`max-age=0`), dan **nilai zona menimpa nilai origin**.

Bukti bahwa ini zona, bukan kode kita:

- Subdomain acak yang **tidak terdaftar** (`zz-nonexistent-test-9182.is-a.dev`)
  tetap menjawab `max-age=0` — respons itu dibuat edge, bukan origin.
- `docs.is-a.dev` dan `blog.is-a.dev` mengirim nilai yang sama.
- Worker kita tetap jalan di domain itu (`/media/` menjawab 400 dari Worker),
  tapi header `max-age=63072000`-nya diganti di edge.
- Hanya ada **satu** header HSTS — jadi ini penggantian nilai, bukan duplikasi.

Token Cloudflare yang ada tidak punya izin baca zona (`/zones` → `result: []`),
jadi nilai zona tidak bisa diubah dari sini. Zona itu pun bukan milik kita.

## Dampak sebenarnya: rendah

TLD `.dev` ada di **HSTS preload list** browser:

```
{ "name": "dev", "policy": "public-suffix", "mode": "force-https",
  "include_subdomains": true }
```

Artinya Chrome/Firefox/Safari/Edge sudah memaksa HTTPS untuk **semua** domain
`.dev` sejak instalasi browser — termasuk `victer.is-a.dev` — tanpa perlu
header dari server. Downgrade ke HTTP tidak mungkin terjadi di browser modern.

Yang tersisa hanyalah:

- Skor scanner (SecurityScorecard, Mozilla Observatory) yang membaca header.
- Klien non-browser yang tidak memakai preload list.
- Hilangnya `includeSubDomains`/`preload` untuk host itu sendiri.

## Dua cara memperbaiki

### Opsi A — lepas proxy (butuh PR ke `is-a-dev/register`)

Ubah satu baris di `domains/victer.json`:

```diff
-  "proxied": true
+  "proxied": false
```

CNAME jadi DNS-only → trafik langsung ke edge Cloudflare Pages →
`_headers` kita yang menang.

- ✅ Header jadi `max-age=31536000`, satu sumber kebenaran.
- ❌ Kehilangan Cloudflare proxy di hostname itu (WAF zone, cache rule,
  analytics zona). Pages sudah di belakang Cloudflare, jadi kehilangan
  proteksinya kecil — tapi tetap perlu ditimbang.
- ❌ Perlu review maintainer is-a.dev (PR publik).

### Opsi B — minta maintainer is-a.dev ubah setting zona

Minta HSTS zona `is-a.dev` dimatikan (bukan di-set `max-age` besar), supaya
nilai origin tiap subdomain yang berlaku. Ini menyentuh 33.000+ domain lain,
jadi kemungkinan besar ditolak atau lama.

### Opsi C — terima (rekomendasi saat ini)

Karena `.dev` sudah preload, tidak ada risiko downgrade nyata. Cukup jaga agar
kondisi ini tidak berubah diam-diam lewat:

```bash
npm run cek:hsts
```

Skrip itu gagal kalau `pages.dev` turun di bawah 31536000, kalau muncul dua
header HSTS, atau kalau nilai domain kustom berubah dari kondisi yang diketahui.

## Yang sudah dikerjakan

- `scripts/cek-hsts-live.mjs` — penjaga kondisi ini (npm run cek:hsts).
- `docs/HSTS-DOMAIN-KUSTOM.md` — dokumen ini.
