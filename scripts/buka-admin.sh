#!/usr/bin/env bash
#
# Buka panel admin portofolio — SATU PERINTAH, jalankan DI LAPTOP.
#
# Yang dilakukan:
#   1. Membuka SSH tunnel (bind ke SEMUA alamat loopback — IPv4 + IPv6)
#   2. Menunggu sampai tunnel benar-benar siap
#   3. Memverifikasi dengan HTTP request sungguhan
#   4. Membuka browser ke URL yang BENAR (angka, bukan 'localhost')
#
# Pemakaian:
#   bash buka-admin.sh                       # default: ubuntu@129.225.15.88
#   bash buka-admin.sh ubuntu@IP-LAIN        # server lain
#   bash buka-admin.sh ubuntu@IP ~/kunci.key # kunci berbeda
#
set -uo pipefail

SERVER="${1:-ubuntu@129.225.15.88}"
KEY="${2:-$HOME/mykey.key}"
LOCAL_PORT="${ADMIN_PORT:-8789}"
REMOTE_PORT=8788

echo "════════════════════════════════════════════════════════"
echo " Panel Admin Portofolio"
echo "════════════════════════════════════════════════════════"
echo ""
echo " Server     : $SERVER"
echo " Kunci      : $KEY"
echo " Tunnel     : localhost:${LOCAL_PORT} → ${REMOTE_PORT} (di server)"
echo ""

# ── Periksa kunci ───────────────────────────────────────────────────────────
if [ ! -f "$KEY" ]; then
  echo "❌ Kunci tidak ditemukan: $KEY"
  echo "   Sebutkan lokasi kunci sebagai argumen kedua:"
  echo "     bash buka-admin.sh $SERVER ~/.ssh/id_rsa"
  exit 1
fi

# ── Bersihkan tunnel lama di port yang sama ─────────────────────────────────
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${LOCAL_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ℹ Port ${LOCAL_PORT} sedang dipakai — menutup tunnel lama…"
  OLD_PIDS=$(lsof -nP -tiTCP:"${LOCAL_PORT}" -sTCP:LISTEN 2>/dev/null)
  [ -n "$OLD_PIDS" ] && kill $OLD_PIDS 2>/dev/null
  sleep 1
fi

# ── Buka tunnel di latar belakang ───────────────────────────────────────────
# -N            : tidak buka shell (hanya terowongan)
# -o ExitOnForwardFailure : gagal cepat kalau port tidak bisa dipakai
# Bind address  : 'localhost' (bukan 127.0.0.1) supaya SSH mendengarkan
#                 IPv4 DAN IPv6 — Chrome sering mencoba ::1 lebih dulu.
LOG=$(mktemp)
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "localhost:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  -i "$KEY" "$SERVER" >"$LOG" 2>&1 &
TUNNEL_PID=$!

echo "Tunnel dibuka (PID ${TUNNEL_PID}). Menunggu siap…"

# ── Tunggu sampai tunnel siap ───────────────────────────────────────────────
READY=0
for i in $(seq 1 20); do
  sleep 1
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo ""
    echo "❌ Tunnel GAGAL dibuka. Pesan SSH:"
    sed 's/^/   /' "$LOG"
    echo ""
    echo "   Periksa: kunci benar? alamat server benar? jaringan OK?"
    exit 1
  fi
  CODE=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${LOCAL_PORT}/admin" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  printf "."
done
echo ""

if [ "$READY" -ne 1 ]; then
  echo "❌ Tunnel terbuka, tapi panel belum menjawab (HTTP ${CODE})."
  echo "   Pesan SSH:"
  sed 's/^/   /' "$LOG"
  kill "$TUNNEL_PID" 2>/dev/null
  exit 1
fi

# ── Verifikasi IPv4 + IPv6 ──────────────────────────────────────────────────
CODE4=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${LOCAL_PORT}/admin" 2>/dev/null || echo "000")
CODE6=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://[::1]:${LOCAL_PORT}/admin" 2>/dev/null || echo "000")

echo "✅ Tunnel siap!"
echo "   IPv4 127.0.0.1 → HTTP ${CODE4}"
echo "   IPv6 [::1]     → HTTP ${CODE6}"
if [ "$CODE6" = "000" ]; then
  echo "   (IPv6 belum jalan — PAKAI URL ANGKA di bawah, jangan 'localhost')"
fi
echo ""

URL="http://127.0.0.1:${LOCAL_PORT}/admin"

# ── Buka browser ────────────────────────────────────────────────────────────
echo "Membuka browser: ${URL}"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 &
elif command -v start >/dev/null 2>&1; then
  start "$URL" >/dev/null 2>&1 &
else
  echo "   (tidak bisa membuka otomatis — buka manual)"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo " SIAP DIPAKAI"
echo "════════════════════════════════════════════════════════"
echo ""
echo " URL    : ${URL}"
echo " Kunci  : tempelkan kunci admin dari server"
echo "          (di server: grep ^ADMIN_KEY= ~/.portfolio-token/service.env | cut -d= -f2-)"
echo ""
echo " Tunnel berjalan di latar belakang (PID ${TUNNEL_PID})."
echo " Tutup dengan:  kill ${TUNNEL_PID}"
echo ""
echo " Tekan Ctrl+C untuk menutup tunnel sekarang…"

# Tunggu sampai pengguna menekan Ctrl+C.
trap 'kill "$TUNNEL_PID" 2>/dev/null; rm -f "$LOG"; echo ""; echo "Tunnel ditutup."; exit 0' INT TERM
while kill -0 "$TUNNEL_PID" 2>/dev/null; do sleep 2; done
