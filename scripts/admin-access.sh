#!/usr/bin/env bash
#
# Akses panel admin dengan aman.
#
# Panel admin HANYA bisa dibuka dari loopback server (bukan internet).
# Skrip ini membuat SSH tunnel lokal → server, lalu memberi URL + kunci.
#
# Pemakaian (dari komputer Anda):
#   bash scripts/admin-access.sh user@ip-vps
#
# Pemakaian (di server, untuk tes cepat):
#   bash scripts/admin-access.sh --local
#
set -euo pipefail

MODE="${1:---local}"
LOCAL_PORT="${ADMIN_PORT:-8789}"
REMOTE_PORT=8788

if [ "$MODE" = "--local" ]; then
  echo "── Panel admin (mode lokal di server) ──"
  echo ""
  echo "Buka di browser server, atau lewat port-forward editor/VS Code:"
  echo ""
  echo "  URL   : http://127.0.0.1:${REMOTE_PORT}/admin"
  echo ""
  echo "Kalau Anda di komputer lain, buat SSH tunnel:"
  echo ""
  echo "  ssh -L ${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT} $(whoami)@$(hostname -I | awk '{print $1}')"
  echo "  lalu buka: http://localhost:${LOCAL_PORT}/admin"
  echo ""
else
  HOST="$MODE"
  echo "── Membuat SSH tunnel ke ${HOST} ──"
  echo ""
  echo "Setelah tunnel aktif, buka di browser Anda:"
  echo "  http://localhost:${LOCAL_PORT}/admin"
  echo ""
  echo "Tekan Ctrl+C untuk menutup tunnel."
  echo ""
  ssh -N -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" "$HOST"
fi

echo ""
echo "── Kunci admin ──"
ENV_FILE="${TOKEN_SERVICE_ENV:-$HOME/.portfolio-token/service.env}"
if [ -f "$ENV_FILE" ]; then
  echo "Kunci admin tersimpan di: $ENV_FILE"
  echo "Ambil dengan: grep ^ADMIN_KEY= $ENV_FILE | cut -d= -f2-"
  echo ""
  echo "(Sengaja tidak ditampilkan di sini — kunci tidak boleh masuk log/riwayat.)"
else
  echo "Berkas env tidak ditemukan: $ENV_FILE"
fi
echo ""
echo "── CLI (tanpa browser) ──"
echo "  cd ~/portfolio-victer/backend"
echo "  npm run admin -- help          # daftar semua perintah"
echo "  npm run admin -- list          # daftar token"
echo "  npm run admin -- leads         # daftar leads"
echo "  npm run admin -- sla           # laporan SLA"
echo ""
