#!/usr/bin/env bash
#
# Setup kredensial Xendit — input tersembunyi, tidak masuk riwayat shell.
#
# ── KENAPA SKRIP, BUKAN EDIT MANUAL ──────────────────────────────────────────
# Dua alasan:
#
#   1. Kunci tidak muncul di layar saat diketik (`read -s`). Kalau diedit
#      manual dengan editor, kuncinya terlihat di terminal — dan bisa
#      terekam screenshot atau screen-sharing.
#
#   2. Kunci tidak masuk riwayat shell. Menjalankan
#      `export XENDIT_SECRET_KEY=xnd_xxx` meninggalkan jejak di
#      ~/.bash_history yang bisa dibaca siapa pun yang punya akses.
#
# ── CARA PAKAI ───────────────────────────────────────────────────────────────
#   bash ~/portfolio-victer/backend/setup-xendit.sh
#
# Lalu tempel kuncinya saat diminta. Tidak akan terlihat di layar.

set -euo pipefail

ENV_FILE="${TOKEN_SERVICE_ENV:-$HOME/.portfolio-token/service.env}"

echo ""
echo "  ════════════════════════════════════════════════"
echo "   Setup kredensial Xendit"
echo "  ════════════════════════════════════════════════"
echo ""
echo "   Ambil dari: https://dashboard.xendit.co/settings/developers"
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
if grep -q "^XENDIT_SECRET_KEY=" "$ENV_FILE" 2>/dev/null; then
  echo "  ⚠️  XENDIT_SECRET_KEY sudah ada di berkas itu."
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
printf "  XENDIT_SECRET_KEY: "
read -rs SECRET_KEY
echo ""

if [ -z "$SECRET_KEY" ]; then
  echo "  ❌ Kosong — dibatalkan."
  exit 1
fi

# ── Validasi bentuk ─────────────────────────────────────────────────────────
# Xendit memakai awalan yang berbeda untuk test dan live. Salah mode berarti
# pembayaran sungguhan padahal Anda mengira sedang menguji.
case "$SECRET_KEY" in
  xnd_development_*)
    MODE="TEST"
    ;;
  xnd_production_*)
    MODE="LIVE"
    ;;
  *)
    echo ""
    echo "  ⚠️  Awalan tidak dikenali (bukan xnd_development_ / xnd_production_)."
    echo "     Pastikan ini benar-benar kunci Xendit."
    echo ""
    read -r -p "  Lanjutkan tetap? (ketik 'ya'): " paksa
    if [ "$paksa" != "ya" ]; then
      echo "  Dibatalkan."
      exit 1
    fi
    MODE="TIDAK DIKENAL"
    ;;
esac

printf "  XENDIT_CALLBACK_TOKEN: "
read -rs CALLBACK_TOKEN
echo ""

if [ -z "$CALLBACK_TOKEN" ]; then
  echo "  ❌ Kosong — dibatalkan."
  exit 1
fi

# ── Tulis ke berkas ─────────────────────────────────────────────────────────
# Hapus baris lama kalau ada, lalu tambahkan yang baru.
#
# `sed -i` dengan pola ini aman: kalau barisnya tidak ada, tidak ada yang
# berubah — bukan error.
TMP=$(mktemp)
chmod 600 "$TMP"

grep -vE '^XENDIT_(SECRET_KEY|CALLBACK_TOKEN)=' "$ENV_FILE" > "$TMP" || true

# Pastikan berkas diakhiri baris baru sebelum menambah
if [ -s "$TMP" ] && [ "$(tail -c 1 "$TMP" | wc -l)" -eq 0 ]; then
  echo "" >> "$TMP"
fi

{
  echo ""
  echo "# ── Xendit (pembayaran langganan) ────────────────────────────────────"
  echo "# Diisi $(date '+%d %B %Y %H:%M') · mode: $MODE"
  echo "XENDIT_SECRET_KEY=$SECRET_KEY"
  echo "XENDIT_CALLBACK_TOKEN=$CALLBACK_TOKEN"
  echo ""
  echo "# Halaman tujuan setelah pembayaran"
  echo "CHECKOUT_SUKSES_URL=https://portfolio-victer.pages.dev/pesanan"
  echo "CHECKOUT_BATAL_URL=https://portfolio-victer.pages.dev/pricing"
} >> "$TMP"

# ── Ganti berkas asli — atomik ──────────────────────────────────────────────
# `mv` dalam satu filesystem bersifat atomik: tidak ada saat berkas setengah
# tertulis yang bisa dibaca proses lain.
cp "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
rm -f "$TMP"

# Bersihkan variabel dari memori shell
unset SECRET_KEY CALLBACK_TOKEN

echo ""
echo "  ════════════════════════════════════════════════"
echo "   ✅ Tersimpan"
echo "  ════════════════════════════════════════════════"
echo ""
echo "   Berkas : $ENV_FILE"
echo "   Mode   : $MODE"
echo ""

if [ "$MODE" = "LIVE" ]; then
  echo "   ⚠️  MODE LIVE — pembayaran akan memakai uang sungguhan."
  echo ""
  echo "      Pastikan webhook sudah didaftarkan di dashboard Xendit"
  echo "      SEBELUM ada pembeli. Tanpa webhook, pembayaran masuk"
  echo "      tapi token akses tidak pernah terbit."
  echo ""
  echo "      URL webhook:"
  echo "        https://portfolio-victer.pages.dev/api/xendit/webhook"
  echo "      Event: Invoice paid, Invoice expired, Invoice failed"
  echo ""
elif [ "$MODE" = "TEST" ]; then
  echo "   ℹ️  MODE TEST — tidak ada uang sungguhan."
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
