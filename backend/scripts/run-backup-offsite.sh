#!/usr/bin/env bash
#
# Jalankan skrip backup/restore off-site dengan environment dari service.env.
#
# KENAPA WRAPPER INI ADA:
# Skrip Node membaca konfigurasi dari environment (BACKUP_ENCRYPTION_KEY,
# CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID). service.env tidak otomatis
# dimuat oleh cron — jadi wrapper ini yang membacanya.
#
# PENTING: nilai rahasia TIDAK dicetak. Hanya jumlah variabel yang dimuat
# yang dilaporkan, supaya log tidak membocorkan apa pun.
#
# Pemakaian:
#   ./run-backup-offsite.sh              → backup off-site
#   ./run-backup-offsite.sh --verify     → uji restore
#   ./run-backup-offsite.sh --list       → daftar backup di R2
#
set -euo pipefail

ENV_FILE="${TOKEN_SERVICE_ENV:-$HOME/.portfolio-token/service.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-backup}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -Is)] ❌ env tidak ditemukan: $ENV_FILE" >&2
  exit 1
fi

# Muat env. Baris komentar dan kosong dilewati. Nilai tidak dicetak.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

case "$MODE" in
  --verify|verify)
    exec node "$SCRIPT_DIR/restore-offsite.mjs"
    ;;
  --list|list)
    exec node "$SCRIPT_DIR/restore-offsite.mjs" --list
    ;;
  --restore)
    shift
    exec node "$SCRIPT_DIR/restore-offsite.mjs" --restore "$@"
    ;;
  *)
    exec node "$SCRIPT_DIR/backup-offsite.mjs"
    ;;
esac
