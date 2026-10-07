#!/bin/bash
# Bersihkan server uji yang tertinggal — dijalankan sebelum uji.
#
# ── KENAPA PERLU ────────────────────────────────────────────────────────────
# Server uji yang tidak mati bersih akan menahan port 8799. Uji berikutnya
# lalu bicara dengan server LAMA (konfigurasi berbeda) dan hasilnya
# membingungkan: 503 atau 403 dari konfigurasi yang tidak relevan.
#
# Ini sudah benar-benar terjadi — tiga kali saat menulis uji 2FA.

set -u
PORT="${1:-8799}"
DIBUNUH=0

for d in /proc/[0-9]*; do
  CMD=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
  case "$CMD" in
    *"src/server.mjs"*)
      PID=$(basename "$d")
      kill -9 "$PID" 2>/dev/null && DIBUNUH=$((DIBUNUH+1))
      ;;
  esac
done

sleep 1

# Verifikasi port benar-benar bebas
if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  echo "  ⚠ port $PORT masih dipakai setelah pembersihan:"
  ss -tlnp 2>/dev/null | grep ":$PORT " | sed 's/^/    /'
  exit 1
fi

[ "$DIBUNUH" -gt 0 ] && echo "  ✅ $DIBUNUH server uji dibersihkan"
echo "  ✅ port $PORT bebas"
exit 0
