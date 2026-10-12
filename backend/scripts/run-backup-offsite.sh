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

# ── PASTIKAN `wrangler` DITEMUKAN, APA PUN PATH-NYA ────────────────────────────
#
# MASALAH YANG DIPERBAIKI DI SINI (backup off-site gagal 4 hari berturut-turut):
#
#   ❌ upload gagal: spawnSync wrangler ENOENT
#
# `wrangler` terpasang di `$HOME/.local/bin/wrangler`, TAPI PATH yang dipakai
# cron adalah:
#
#   PATH=/home/ubuntu/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin
#                                └─ $HOME/.local/bin TIDAK ADA di sini
#
# Akibatnya skrip gagal SETIAP hari pada langkah terakhir. Backup lokal dan
# enkripsi tetap berhasil, tapi file TIDAK PERNAH sampai ke R2 — jadi
# "backup off-site" yang diandalkan untuk pemulihan bencana sebenarnya
# tidak ada. Ini jenis kegagalan paling berbahaya: semuanya terlihat hijau
# di log lokal, dan baru ketahuan saat server sudah hilang.
#
# PERBAIKAN: tambahkan direktori tempat wrangler biasa dipasang ke PATH,
# TANPA menimpa PATH yang sudah ada. Kalau wrangler tetap tidak ketemu,
# berhenti dengan pesan jelas — bukan diam-diam melewati upload.
#
# KENAPA DI SINI, BUKAN DI CRONTAB:
# Memperbaiki crontab hanya memperbaiki satu pemanggil. Skrip ini juga
# dipanggil manual, dari uji restore bulanan, dan mungkin dari tempat lain
# nanti. Menaruh perbaikan di skrip membuatnya bekerja dari mana pun.
for dir in "$HOME/.local/bin" "$HOME/.hermes/node/bin" /usr/local/bin; do
  case ":$PATH:" in
    *":$dir:"*) ;;                    # sudah ada — jangan duplikat
    *) [ -d "$dir" ] && PATH="$dir:$PATH" ;;
  esac
done
export PATH

if ! command -v wrangler >/dev/null 2>&1; then
  echo "[$(date -Is)] ❌ wrangler tidak ditemukan di PATH: $PATH" >&2
  echo "    Backup TIDAK terunggah. Pasang: npm install -g wrangler" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -Is)] ❌ env tidak ditemukan: $ENV_FILE" >&2
  exit 1
fi

# Muat env. Baris komentar dan kosong dilewati. Nilai tidak dicetak.
#
# ── KENAPA TIDAK PAKAI `source` ─────────────────────────────────────────────
#
# `source` menafsirkan isi berkas sebagai SKRIP BASH. Nilai seperti
#
#   EMAIL_FROM=VIVASTIC <noreply@domain.id>
#
# adalah env var yang sah (dan memang dipakai — lihat email.mjs:228), tapi
# bash membacanya sebagai operator redirection `<` dan gagal:
#
#   syntax error near unexpected token `newline'
#
# Akibatnya SELURUH backup off-site mati, bukan hanya satu variabel.
#
# Parser Node di config.mjs sudah menangani ini dengan benar (ia memisahkan
# di `=` pertama dan mengambil sisanya apa adanya). Di sini dipakai cara yang
# sama: baca per baris, potong di `=` pertama, jangan tafsirkan isinya.
#
# Nilai tetap TIDAK dicetak — hanya jumlah variabel yang dimuat.
_dimuat=0
while IFS= read -r baris || [ -n "$baris" ]; do
  # Lewati komentar dan baris kosong
  case "$baris" in
    ''|\#*) continue ;;
  esac

  # Hanya proses baris yang punya '='
  case "$baris" in
    *=*) ;;
    *) continue ;;
  esac

  nama="${baris%%=*}"
  nilai="${baris#*=}"

  # Nama variabel harus sah (huruf, angka, garis bawah; tidak diawali angka)
  case "$nama" in
    [A-Za-z_]*) ;;
    *) continue ;;
  esac
  case "$nama" in
    *[!A-Za-z0-9_]*) continue ;;
  esac

  # Buang kutip tunggal/ganda pembungkus kalau ada
  case "$nilai" in
    \"*\") nilai="${nilai#\"}"; nilai="${nilai%\"}" ;;
    \'*\') nilai="${nilai#\'}"; nilai="${nilai%\'}" ;;
  esac

  export "$nama=$nilai"
  _dimuat=$((_dimuat + 1))
done < "$ENV_FILE"

echo "[$(date -Is)] env dimuat: $_dimuat variabel dari $(basename "$ENV_FILE")"

case "$MODE" in
  # ── MODE DIAGNOSA: muat env lalu berhenti, tanpa menyentuh R2 ────────────────
  #
  # Gunanya: memverifikasi bahwa env terbaca dengan benar TANPA menjalankan
  # backup nyata. Ini yang membuat bug `source` bisa ditangkap tes:
  # sebelum perbaikan, mode ini gagal dengan "syntax error"; sesudahnya,
  # ia melaporkan jumlah variabel yang dimuat.
  #
  # Aman dijalankan kapan pun — tidak menulis, tidak mengunggah, tidak
  # menyentuh database.
  --cek-env|cek-env)
    echo "[$(date -Is)] ✅ env terbaca tanpa error"
    # Laporkan HANYA nama variabel yang terisi, bukan nilainya.
    # Ini berguna untuk memastikan variabel penting tidak hilang.
    for v in BACKUP_ENCRYPTION_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID R2_BUCKET; do
      if [ -n "${!v:-}" ]; then
        echo "   $v: terisi"
      else
        echo "   $v: KOSONG ⚠️"
      fi
    done
    exit 0
    ;;
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
