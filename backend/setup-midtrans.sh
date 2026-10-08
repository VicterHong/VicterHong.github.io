#!/usr/bin/env bash
#
# Setup kredensial Midtrans — input tersembunyi, tidak masuk riwayat shell.
#
# ── KENAPA SKRIP, BUKAN EDIT MANUAL ──────────────────────────────────────────
# Dua alasan:
#
#   1. Kunci tidak muncul di layar saat diketik (`read -s`). Kalau diedit
#      manual dengan editor, kuncinya terlihat di terminal — dan bisa
#      terekam screenshot atau screen-sharing.
#
#   2. Kunci tidak masuk riwayat shell. Menjalankan
#      `export MIDTRANS_SERVER_KEY=xnd_xxx` meninggalkan jejak di
#      ~/.bash_history yang bisa dibaca siapa pun yang punya akses.
#
# ── CARA PAKAI ───────────────────────────────────────────────────────────────
#   bash ~/portfolio-victer/backend/setup-midtrans.sh
#
# Lalu tempel kuncinya saat diminta. Tidak akan terlihat di layar.

set -euo pipefail

ENV_FILE="${TOKEN_SERVICE_ENV:-$HOME/.portfolio-token/service.env}"

echo ""
echo "  ════════════════════════════════════════════════"
echo "   Setup kredensial Midtrans"
echo "  ════════════════════════════════════════════════"
echo ""
echo "   Ambil dari: https://dashboard.midtrans.com/settings/config_info"
echo ""
echo "   ⚠️  Kunci akan disembunyikan saat Anda mengetik."
echo "       Itu memang disengaja — bukan error."
echo ""

if [ ! -f "$ENV_FILE" ]; then
  echo "  ❌ Berkas tidak ditemukan: $ENV_FILE"
  echo "     Pastikan layanan token sudah pernah dijalankan."
  exit 1
fi

# ── Periksa apakah sudah ada ────────────────────────────────────────────────
if grep -q "^MIDTRANS_SERVER_KEY=" "$ENV_FILE" 2>/dev/null; then
  echo "  ⚠️  MIDTRANS_SERVER_KEY sudah ada di berkas itu."
  echo ""
  read -r -p "  Ganti dengan yang baru? (ketik 'ya' untuk lanjut): " konfirmasi
  if [ "$konfirmasi" != "ya" ]; then
    echo ""
    echo "  Dibatalkan. Tidak ada yang berubah."
    echo ""
    exit 0
  fi
  echo ""
fi

# ── Input tersembunyi ───────────────────────────────────────────────────────
printf "  MIDTRANS_SERVER_KEY: "
read -rs SERVER_KEY
echo ""

if [ -z "$SERVER_KEY" ]; then
  echo "  ❌ Kosong — dibatalkan."
  exit 1
fi

# ── Validasi bentuk ─────────────────────────────────────────────────────────
# Midtrans memakai awalan yang berbeda untuk sandbox dan production:
#   SB-Mid-server-xxx  → Sandbox
#   Mid-server-xxx     → Production
#
# Salah mode berarti pembayaran sungguhan padahal Anda mengira sedang menguji.
case "$SERVER_KEY" in
  SB-Mid-server-*)
    MODE="SANDBOX"
    ;;
  Mid-server-*)
    MODE="PRODUCTION"
    ;;
  *)
    echo ""
    echo "  ⚠️  Awalan tidak dikenali (bukan SB-Mid-server- / Mid-server-)."
    echo "     Pastikan ini benar-benar ServerKey dari dashboard Midtrans."
    echo ""
    read -r -p "  Lanjutkan tetap? (ketik 'ya'): " paksa
    if [ "$paksa" != "ya" ]; then
      echo "  Dibatalkan."
      exit 1
    fi
    MODE="TIDAK DIKENAL"
    ;;
esac

printf "  MIDTRANS_CLIENT_KEY: "
read -rs CLIENT_KEY
echo ""

if [ -z "$CLIENT_KEY" ]; then
  echo "  ❌ Kosong — dibatalkan."
  exit 1
fi

# ── Tulis ke berkas ─────────────────────────────────────────────────────────
TMP=$(mktemp)
chmod 600 "$TMP"

grep -vE '^MIDTRANS_(SERVER_KEY|CLIENT_KEY|PRODUCTION)=' "$ENV_FILE" > "$TMP" || true

if [ -s "$TMP" ] && [ "$(tail -c 1 "$TMP" | wc -l)" -eq 0 ]; then
  echo "" >> "$TMP"
fi

{
  echo ""
  echo "# ── Midtrans (pembayaran langganan) ──────────────────────────────────"
  echo "# Diisi $(date '+%d %B %Y %H:%M') · mode: $MODE"
  echo "MIDTRANS_SERVER_KEY=$SERVER_KEY"
  echo "MIDTRANS_CLIENT_KEY=$CLIENT_KEY"
  echo "MIDTRANS_PRODUCTION=$([ "$MODE" = "PRODUCTION" ] && echo true || echo false)"
  echo ""
  echo "# Halaman tujuan setelah pembayaran"
  echo "CHECKOUT_SUKSES_URL=https://portfolio-victer.pages.dev/pesanan"
  echo "CHECKOUT_BATAL_URL=https://portfolio-victer.pages.dev/pricing"
} >> "$TMP"

# Ganti berkas asli — atomik
cp "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
rm -f "$TMP"

unset SERVER_KEY CLIENT_KEY

echo ""
echo "  ════════════════════════════════════════════════"
echo "   ✅ Tersimpan"
echo "  ════════════════════════════════════════════════"
echo ""
echo "   Berkas : $ENV_FILE"
echo "   Mode   : $MODE"
echo ""

if [ "$MODE" = "PRODUCTION" ]; then
  echo "   ⚠️  MODE PRODUCTION — pembayaran memakai uang sungguhan."
  echo ""
  echo "      Pastikan Notification URL sudah diisi di dashboard Midtrans"
  echo "      SEBELUM ada pembeli. Tanpa itu, pembayaran masuk tapi token"
  echo "      akses tidak pernah terbit."
  echo ""
  echo "      URL: https://portfolio-victer.pages.dev/api/midtrans/webhook"
  echo ""
elif [ "$MODE" = "SANDBOX" ]; then
  echo "   ℹ️  MODE SANDBOX — tidak ada uang sungguhan."
  echo "      Bagus untuk mencoba alur lengkap dulu."
  echo ""
fi

echo "   Langkah berikutnya:"
echo ""
echo "     sudo systemctl restart portfolio-token.service"
echo "     sleep 3"
echo "     curl -s http://127.0.0.1:8788/api/pembayaran/status | python3 -m json.tool"
echo ""
echo "   Yang diharapkan: \"aktif\": true"
echo ""
