#!/bin/bash
# ── Pemantauan uptime ringan untuk portfolio-victer ─────────────────────────
#
# ── KENAPA SCRIPT BASH, BUKAN UPTIME KUMA / WORKFLOW n8n ────────────────────
# Server ini punya 1 core dengan load average 3.82, dan swap sudah 1 GB
# terpakai. Menambah container baru (Uptime Kuma ~120-180 MB) akan memperburuk
# keadaan — dan yang paling berisiko adalah tiga layanan produksi:
#
#   portfolio-token.service    backend website
#   portfolio-tunnel.service   tunnel website
#   mina-tunnel.service        tunnel bot
#
# Kalau RAM habis, Linux OOM killer membunuh proses ACAK — bisa salah satu
# dari tiga itu.
#
# Script ini jalan ~2 detik lalu mati. RAM yang dipakai: nol saat diam.
# Yang penting bukan dashboard, tapi TAHU kalau ada yang mati — dan itu
# diberikan script ini.
#
# ── CARA KERJA ──────────────────────────────────────────────────────────────
# Dipanggil systemd timer setiap 5 menit. Memeriksa enam hal. Kalau ada yang
# gagal, kirim SATU pesan Telegram berisi semua masalah (bukan enam pesan
# terpisah — itu spam).
#
# ── ANTI-SPAM ───────────────────────────────────────────────────────────────
# Notifikasi yang sama tidak dikirim berulang. Disimpan di file status:
# masalah yang sudah dilaporkan tidak dilaporkan lagi sampai pulih.
# Jadi kalau website down 1 jam (12 kali cek), kamu dapat 1 pesan — bukan 12.

set -uo pipefail

# ── Konfigurasi ─────────────────────────────────────────────────────────────
ENV_FILE="/home/ubuntu/hermes_ai_agent/.env"
STATE_DIR="/home/ubuntu/.portfolio-token/monitor"
STATE_FILE="$STATE_DIR/status.txt"
LOG_FILE="$STATE_DIR/monitor.log"

# Ambang batas — dipilih dari kondisi server nyata, bukan angka umum.
DISK_WARN=85          # % — di atas ini, waktu untuk bersih-bersih
SWAP_WARN_MB=1500     # MB — swap 2 GB total; 1.5 GB terpakai = RAM kritis
LOAD_WARN=6           # load average di 1 core; 3.82 sekarang = sudah berat

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ── Baca kredensial Telegram ────────────────────────────────────────────────
# Dibaca dari file env yang sudah ada — tidak ada kredensial baru yang dibuat.
TOKEN=""
CHAT=""
if [ -r "$ENV_FILE" ]; then
  TOKEN=$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | head -1)
  CHAT=$(grep -oP '^ALLOWED_TELEGRAM_USER_IDS=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | cut -d, -f1 | head -1)
fi

MASALAH=()

catat() {
  MASALAH+=("$1")
  echo "[$(date -u +%H:%M:%S)] $1" >> "$LOG_FILE"
}

# ── 1. Website produksi ─────────────────────────────────────────────────────
# Cek halaman utama. Timeout 15 detik: cukup longgar untuk koneksi lambat,
# cukup ketat supaya tidak menggantung menunggu yang memang mati.
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "https://portfolio-victer.pages.dev/home" 2>/dev/null || echo "000")
[ "$CODE" != "200" ] && catat "🌐 Website /home → HTTP $CODE (harus 200)"

# ── 2. API health ───────────────────────────────────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "https://portfolio-victer.pages.dev/api/health" 2>/dev/null || echo "000")
[ "$CODE" != "200" ] && catat "🔌 API /api/health → HTTP $CODE (harus 200)"

# ── 3. Layanan systemd ──────────────────────────────────────────────────────
for svc in portfolio-token portfolio-tunnel; do
  STATUS=$(systemctl is-active "$svc.service" 2>/dev/null || echo "unknown")
  [ "$STATUS" != "active" ] && catat "⚙️  Layanan $svc → $STATUS (harus active)"
done

# ── 4. Disk ─────────────────────────────────────────────────────────────────
# Ambil angka saja dari kolom ke-5 df (tanpa tanda %).
DISK=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ -n "$DISK" ] && [ "$DISK" -ge "$DISK_WARN" ] 2>/dev/null; then
  catat "💾 Disk ${DISK}% terpakai (ambang ${DISK_WARN}%)"
fi

# ── 5. Swap ─────────────────────────────────────────────────────────────────
# Tanda paling jelas bahwa RAM sudah tidak cukup.
SWAP=$(free -m | awk '/Swap:/ {print $3}')
if [ -n "$SWAP" ] && [ "$SWAP" -ge "$SWAP_WARN_MB" ] 2>/dev/null; then
  catat "🧠 Swap ${SWAP} MB terpakai (ambang ${SWAP_WARN_MB} MB)"
fi

# ── 6. Load average ─────────────────────────────────────────────────────────
# Di 1 core, load > 1 berarti antrian. Ambang 6 = sudah sangat berat.
LOAD=$(awk '{printf "%d", $1}' /proc/loadavg)
if [ -n "$LOAD" ] && [ "$LOAD" -ge "$LOAD_WARN" ] 2>/dev/null; then
  catat "🔥 Load average ${LOAD} (ambang ${LOAD_WARN})"
fi

# ── Kirim notifikasi ────────────────────────────────────────────────────────
# Hanya kalau ada MASALAH BARU. Bandingkan dengan yang sudah dilaporkan.
SEKARANG=$(printf '%s\n' "${MASALAH[@]:-}" | sort)

if [ ${#MASALAH[@]} -gt 0 ]; then
  SEBELUMNYA=$(cat "$STATE_FILE" 2>/dev/null || echo "")

  # Kirim hanya kalau daftarnya BERBEDA dari yang terakhir dilaporkan.
  if [ "$SEKARANG" != "$SEBELUMNYA" ]; then
    if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
      PESAN="⚠️ <b>Pemantauan portfolio-victer</b>
$(date -u '+%Y-%m-%d %H:%M UTC')

$(printf '%s\n' "${MASALAH[@]}")"

      curl -s -o /dev/null --max-time 15 \
        -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        -d "chat_id=${CHAT}" \
        -d "parse_mode=HTML" \
        --data-urlencode "text=${PESAN}" 2>/dev/null
    fi
    printf '%s\n' "$SEKARANG" > "$STATE_FILE"
  fi
else
  # Semua sehat. Kalau sebelumnya ada masalah, kirim kabar pulih.
  SEBELUMNYA=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  if [ -n "$SEBELUMNYA" ]; then
    if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
      curl -s -o /dev/null --max-time 15 \
        -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        -d "chat_id=${CHAT}" \
        -d "parse_mode=HTML" \
        --data-urlencode "text=✅ <b>Semua normal kembali</b>
$(date -u '+%Y-%m-%d %H:%M UTC')
Website, API, layanan, disk, swap, load — semua sehat." 2>/dev/null
    fi
    rm -f "$STATE_FILE"
  fi
fi

# ── Batasi ukuran log ───────────────────────────────────────────────────────
# Log tumbuh tanpa batas kalau dibiarkan. Simpan 500 baris terakhir saja.
if [ -f "$LOG_FILE" ]; then
  BARIS=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$BARIS" -gt 500 ] 2>/dev/null; then
    tail -300 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
fi

exit 0
