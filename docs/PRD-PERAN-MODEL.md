# PRD — Pembagian Peran Model AI

**Versi:** 1.0
**Tanggal:** 5 Oktober 2026
**Status:** Aktif
**Berlaku untuk:** Semua pekerjaan pengembangan portfolio-victer dan sistem terkait

---

## 1. Ringkasan

Dokumen ini menetapkan **siapa mengerjakan apa** di antara model AI yang tersedia. Tujuannya satu: **saldo kredit $7 di ExperientialLabs dipakai HANYA untuk penalaran, tidak pernah untuk eksekusi.**

Alasannya sederhana. Model penalaran mahal ($4–$20 per juta token), sedangkan eksekutor gratis (CodeBuddy). Kalau eksekusi ikut memakai model mahal, saldo habis dalam hitungan hari. Kalau eksekusi dialihkan ke yang gratis, saldo yang sama bertahan untuk puluhan tugas penalaran.

**Prinsip inti:** *Model mahal berpikir. Model gratis mengerjakan.*

---

## 2. Pembagian Peran

### 2.1 Opus 5.5 — Ahli Keamanan Siber

| Aspek | Nilai |
|---|---|
| Model | `explabs/claude-opus-5.5` |
| Level reasoning | `medium` |
| Biaya | $4/M input · $20/M output |
| Biaya per PRD | ±$0,22 |
| Context | 1.000.000 token |
| Tugas | Audit celah keamanan, PRD keamanan, desain SOC |

**Kenapa medium, bukan low:**
Diukur dengan prompt identik (86 token input):
```
low     → 534 token  $0,0110
medium  → 671 token  $0,0138   ← selisih 26%
high    → 696 token  $0,0143
```
`low` hanya hemat 26% tapi kualitas penalaran turun. Untuk audit keamanan, 26% tidak sepadan dengan risiko celah yang lolos. `high` hanya menambah 4% token dari medium — kalau tugasnya kritis, naikkan ke `high`.

**Yang dikerjakan:**
- Mencari celah keamanan di website (XSS, CSRF, injection, kebocoran data)
- Menyusun PRD keamanan
- Merancang arsitektur SOC (Security Operations Center)
- Analisis ancaman dan model serangan
- Review kode untuk masalah keamanan

**Yang TIDAK dikerjakan:** menulis kode produksi, mengedit file, menjalankan perintah.

---

### 2.2 GPT-6 Luna — Ahli Penalaran Desain

| Aspek | Nilai |
|---|---|
| Model | `explabs/gpt-6-luna` |
| Level reasoning | `medium` |
| Biaya | $0,10/M input · $0,50/M output |
| Biaya per PRD | ±$0,0055 |
| Context | 1.050.000 token |
| Tugas | Penalaran desain, transisi, warna, gerak |

**Kenapa Luna, bukan Astra:**
```
gpt-6-astra : $10/M in · $50/M out  → TERKUNCI, perlu top-up uang sungguhan
gpt-6-luna  : $0,10/M in · $0,50/M out → tersedia sekarang, 100x lebih murah
```
Astra terkunci sampai ada pembelian kredit. Luna sudah bisa dipakai sekarang dan cukup untuk tugas desain.

**Level reasoning terukur** (prompt sama, 86 token input):
```
none    → 145 token (0 reasoning)   $0,00002
low     → 137 token (0 reasoning)   $0,00002
medium  → 418 token (293 reasoning) $0,00005   ← direkomendasikan
high    → 549 token (407 reasoning) $0,00007
```
`medium` adalah titik seimbang: reasoning benar-benar aktif (293 token), biaya masih seperseratus sen. `low` tidak menyalakan reasoning sama sekali — untuk desain yang butuh pertimbangan estetika, itu kurang.

**Yang dikerjakan:**
- Merancang reaksi transisi (masuk, keluar, hover, tekan)
- Memilih palet warna dan memastikan kontras WCAG
- Merancang gerak yang terasa hidup tapi tidak mengganggu
- PRD desain untuk fitur baru
- Menilai apakah animasi terasa "murah" atau "profesional"

**Yang TIDAK dikerjakan:** menulis kode produksi, mengedit file.

---

### 2.3 CodeBuddy — Eksekutor

| Aspek | Nilai |
|---|---|
| Provider | `cbai/*` (CodeBuddy, sudah terpasang di 9router) |
| Biaya | **GRATIS** |
| Model tersedia | 12 model |

**Model yang tersedia:**
```
cbai/kimi-k2.5          cbai/deepseek-v4-pro
cbai/kimi-k2.6          cbai/deepseek-v4.1-flash
cbai/kimi-k2.7          cbai/deepseek-v3-2-volc
cbai/glm-5.1            cbai/minimax-m2.7
cbai/glm-5.2            cbai/minimax-m3
cbai/glm-5v-turbo       cbai/hy3-preview
```

**Yang dikerjakan:**
- Menulis kode produksi
- Mengedit file
- Menjalankan perintah terminal
- Menjalankan tes
- Deploy

**Pemilihan model eksekutor:**
```
Kode umum        → cbai/kimi-k2.6
Kode kompleks    → cbai/kimi-k2.7
Kode + reasoning → cbai/deepseek-v4-pro
Tugas cepat      → cbai/deepseek-v4.1-flash
```

---

## 3. Alur Kerja

```
┌─────────────────────────────────────────────────────────────┐
│  1. PENALARAN                                                │
│                                                              │
│  Masalah keamanan          Masalah desain                    │
│  explabs/claude-opus-5.5   explabs/gpt-6-luna                │
│  reasoning: medium         reasoning: medium                 │
│  → PRD keamanan            → PRD desain                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │  PRD (dokumen, bukan kode)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. EKSEKUSI                                                 │
│                                                              │
│  CodeBuddy (GRATIS) — membaca PRD, menulis kode              │
│  Tidak menyentuh saldo ExperientialLabs sama sekali          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │  kode + tes
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  3. VERIFIKASI                                               │
│                                                              │
│  Tes otomatis (preflight, backend test, CI)                  │
│  Kalau ada masalah keamanan → kembali ke Opus                │
│  Kalau ada masalah desain   → kembali ke Luna                │
└─────────────────────────────────────────────────────────────┘
```

**Aturan handoff:** penalaran menghasilkan **dokumen**, bukan kode. Eksekutor menerima dokumen dan menulis kodenya. Model penalaran tidak pernah mengedit file.

---

## 4. Cara Memanggil

### Opus 5.5 (keamanan)

```bash
curl -s https://api.experientiallabs.ai/v1/chat/completions \
  -H "Authorization: Bearer $EXPLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-5.5",
    "reasoning_effort": "medium",
    "max_tokens": 8000,
    "messages": [{"role": "user", "content": "Audit keamanan: ..."}]
  }'
```

### GPT-6 Luna (desain)

```bash
curl -s https://api.experientiallabs.ai/v1/chat/completions \
  -H "Authorization: Bearer $EXPLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-luna",
    "reasoning_effort": "medium",
    "max_tokens": 8000,
    "messages": [{"role": "user", "content": "Rancang transisi: ..."}]
  }'
```

### Lewat 9router (kalau provider sudah aktif)

```
Model: explabs/claude-opus-5.5   (keamanan)
Model: explabs/gpt-6-luna        (desain)
Model: cbai/kimi-k2.6            (eksekusi)
```

---

## 5. Batasan Teknis

### Reasoning effort per model

| Model | Level tersedia | Bawaan |
|---|---|---|
| `claude-opus-5.5` | low, medium, high, xhigh, max | medium |
| `gpt-6-luna` | none, low, medium, high, xhigh, max | medium |
| `gpt-6-sol` | none, low, medium, high, xhigh, max | medium |
| `gpt-6-astra` | — (terkunci) | — |

**Catatan:** Opus 5.5 **tidak menerima** `none` maupun `minimal` — akan error 400. Level terendahnya `low`.

### Parameter yang ditolak

- `gpt-6-astra` menolak `temperature` → error 400
- `gpt-6-luna` menerima `temperature`

### Kalau level tidak didukung

Gateway otomatis menurunkan ke level terdekat **di bawah** yang diminta, tidak pernah menaikkan. Penggantian dicatat di field `x-experiential-ignored-parameters` pada respons.

---

## 6. Anggaran

### Biaya per tugas (terukur)

| Tugas | Model | Biaya |
|---|---|---|
| PRD keamanan | Opus 5.5 medium | $0,22 |
| PRD desain | Luna medium | $0,0055 |
| Eksekusi | CodeBuddy | GRATIS |

### Umur saldo $7

```
Opus 5.5 saja     : 31 PRD keamanan
Luna saja         : 1.270 PRD desain
Kombinasi         : ~30 fitur lengkap (1 PRD keamanan + 1 PRD desain per fitur)
```

**Eksekusi tidak memengaruhi angka ini** — CodeBuddy gratis.

### Kalau saldo habis

Tidak ada risiko tagihan. Key ini tidak punya kartu tersimpan dan tidak mengaktifkan *credits overflow*, jadi:
- Request berhenti dengan pesan error
- Tidak ada penagihan otomatis
- Tidak ada langganan yang jalan

---

## 7. Status Model

| Model | Status | Catatan |
|---|---|---|
| `claude-opus-5.5` | ✅ Tersedia | Terverifikasi dengan tes nyata |
| `gpt-6-luna` | ✅ Tersedia | Terverifikasi dengan tes nyata |
| `gpt-6-sol` | ✅ Tersedia | Alternatif Luna, 20x lebih mahal |
| `grok-4.7` | ✅ Tersedia | Alternatif, reasoning aktif |
| `gpt-6-astra` | ❌ Terkunci | Perlu top-up uang sungguhan |
| `gpt-6-astra-pro` | ❌ Terkunci | Sama |

**Kalau nanti top-up:** Astra terbuka dan bisa dipakai untuk desain kelas atas ($10/$50 per M). Sampai saat itu, Luna sudah memadai.

---

## 8. Yang Tidak Boleh Dilakukan

1. **Memakai model penalaran untuk eksekusi.** Menulis kode dengan Opus 5.5 menghabiskan saldo 40x lebih cepat daripada yang diperlukan.
2. **Memakai level `high`/`max` tanpa alasan.** Selisih token dari `medium` tidak sebanding untuk tugas rutin.
3. **Menjalankan tes berbayar tanpa memberi tahu.** Setiap panggilan mengurangi saldo — catat pemakaiannya.
4. **Mengirim `temperature` ke Astra.** Akan error 400.
5. **Meminta level `none`/`minimal` ke Opus.** Akan error 400.
6. **Menganggap eksekusi gratis berarti tanpa batas.** CodeBuddy gratis, tapi tetap ada batas laju dari provider-nya.

---

## 9. Verifikasi

Semua angka di dokumen ini berasal dari pengukuran nyata, bukan perkiraan:

- Level reasoning diukur dengan prompt identik (86 token input), 4 level per model
- Harga diambil dari katalog publik `GET /api/models/<slug>`
- Status model diuji dengan panggilan nyata ke API
- Saldo dibaca dari `GET /api/v1/credits`

**Biaya riset:** $0,1319 dari saldo $7 (dipakai untuk 15 panggilan uji).

---

## 10. Riwayat Versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 5 Okt 2026 | Dokumen awal — pembagian peran Opus / Luna / CodeBuddy |

---

**Dokumen terkait:**
- `docs/AUDIT-KEAMANAN.md` — hasil audit keamanan
- `docs/PRD-v2-corporate.md` — PRD produk utama
- `docs/PRODUCTION.md` — runbook produksi
