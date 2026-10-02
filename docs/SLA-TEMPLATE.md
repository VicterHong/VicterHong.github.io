# Perjanjian Tingkat Layanan (SLA) — Akses Portofolio Enterprise

**Penyedia:** Victer Phanjaya
**Penerima:** [Nama Perusahaan Klien]
**Tanggal berlaku:** [Tanggal]
**Masa berlaku:** [90 hari / 1 tahun]

---

## 1. Ruang Lingkup Layanan

Penyedia memberikan akses terkendali ke konten portofolio teknis melalui
**Enterprise Token** dengan cakupan berikut:

| Komponen | Cakupan Enterprise |
|----------|-------------------|
| Proyek | Multi-proyek (sesuai kesepakatan) |
| Masa akses | 90 hari (dapat diperpanjang) |
| Perangkat | Sampai 5 perangkat aktif |
| Lokasi | Sampai 5 alamat IP dalam 24 jam |
| Audit log | Ekspor lengkap (JSON/CSV) sesuai permintaan |
| Watermark | Nama perusahaan + tier di setiap konten |
| Dukungan | Email, respons dalam 1×24 jam kerja |

---

## 2. Target Tingkat Layanan

### 2.1 Ketersediaan (Uptime)

| Periode | Target | Pengukuran |
|---------|--------|------------|
| Harian | 99,0% | Heartbeat per request |
| Mingguan | 99,0% | Agregat 7 hari |
| Bulanan | 99,0% | Agregat 30 hari |

**Definisi uptime:** persentase request yang dijawab dengan status < 500 dari
total request yang tercatat. Diukur otomatis oleh layanan, bukan klaim manual.

**Ketersediaan halaman publik:** 99,9% (di-host GitHub Pages, terpisah dari
layanan token).

### 2.2 Latensi

| Metrik | Target |
|--------|--------|
| Latency rata-rata | < 200 ms |
| Latency p95 | < 500 ms |

Diukur dari server VPS ke database, tidak termasuk latensi jaringan klien.

### 2.3 Waktu Respons Dukungan

| Kanal | Respons pertama |
|-------|-----------------|
| Email | 1×24 jam kerja |
| Penerbitan token baru | 2×24 jam kerja |
| Pencabutan darurat | 4 jam (setiap hari) |

---

## 3. Pemantauan & Pelaporan

Layanan mencatat setiap request ke dalam tabel `sla_heartbeats`. Klien dapat
meminta laporan SLA kapan saja:

```bash
# Laporan 7 hari terakhir
node src/admin-cli.mjs sla --days 7
```

**Format laporan:**

```
LAPORAN SLA — Layanan Token Portofolio
──────────────────────────────────────────
  7 HARI (168 jam)
    Total request : 12.450
    Uptime        : 99,94%  (target 99,0%)
    Latency rata² : 42 ms
    Latency p95   : 118 ms
    Error         : 8 (0,06%)
    Status SLA    : ✅ TERPENUHI
```

Laporan bulanan dikirim otomatis ke email klien pada tanggal 1 setiap bulan.

---

## 4. Pengecualian SLA

Target tidak berlaku untuk kegagalan yang disebabkan oleh:

1. **Force majeure** — bencana alam, pemadaman listrik regional, gangguan ISP.
2. **Pemeliharaan terjadwal** — diberitahukan minimal 24 jam sebelumnya.
3. **Tindakan klien** — token yang dicabut otomatis karena pelanggaran aturan
   penggunaan (lihat §5), atau konfigurasi yang salah dari sisi klien.
4. **Gangguan pihak ketiga** — GitHub Pages, Cloudflare, atau layanan DNS.
5. **Serangan siber** — DDoS atau upaya peretasan yang memaksa pembatasan sementara.

---

## 5. Aturan Penggunaan

Enterprise Token **TIDAK BOLEH**:

- Dibagikan ke pihak di luar organisasi Penerima
- Digunakan dari lebih banyak IP/perangkat dari yang disepakati
- Digunakan untuk pengambilan konten massal (scraping)
- Dipublikasikan di platform publik (GitHub, forum, media sosial)

**Konsekuensi:** token dicabut otomatis tanpa pemberitahuan. Pemulihan memerlukan
penerbitan token baru dan dapat dikenakan biaya administrasi.

Semua pelanggaran tercatat dalam audit log dengan bukti IP, waktu, dan pola akses.

---

## 6. Keamanan Data

| Aspek | Komitmen |
|-------|----------|
| Penyimpanan token | SHA-256 + salt, plaintext tidak pernah disimpan |
| Session | Cookie httpOnly, Secure, SameSite=None |
| Audit log | Disimpan di VPS Penyedia, tidak dibagikan ke pihak ketiga |
| Analytics | Tanpa pihak ketiga (no Google Analytics, no tracking eksternal) |
| Watermark | Nama perusahaan tertanam di konten yang dibuka |
| Enkripsi transit | HTTPS wajib (TLS 1.2+) |

---

## 7. Kompensasi Kegagalan SLA

Jika uptime bulanan di bawah target:

| Uptime aktual | Kompensasi |
|---------------|------------|
| 98,0% – 98,99% | Perpanjangan 7 hari |
| 95,0% – 97,99% | Perpanjangan 30 hari |
| < 95,0% | Pengembalian penuh biaya bulan tersebut |

Kompensasi harus diklaim dalam 14 hari setelah laporan bulanan diterima.

---

## 8. Pengakhiran

- **Oleh klien:** kapan saja, dengan pemberitahuan 7 hari. Sisa masa akses hangus.
- **Oleh penyedia:** dengan pemberitahuan 30 hari, atau segera jika ada
  pelanggaran §5.
- Setelah pengakhiran: token dicabut, semua sesi dihapus, audit log disimpan
  90 hari untuk keperluan verifikasi.

---

## 9. Kontak

| Keperluan | Kontak |
|-----------|--------|
| Dukungan umum | [email sales] |
| Insiden darurat | [email + nomor telepon] |
| Permintaan audit log | [email sales] |

---

**Ditandatangani:**

Penyedia: _________________________ Tanggal: ___________

Penerima: _________________________ Tanggal: ___________

---

*Dokumen ini bagian dari roadmap v2.4 — Enterprise package + SLA + custom domain.*
*Angka SLA dapat disesuaikan per kontrak. Template ini titik awal yang jujur —
hanya menjanjikan apa yang benar-benar diukur sistem.*
