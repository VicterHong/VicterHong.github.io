#!/bin/bash
# Sinkronkan metrik portofolio dari repo nyata, lalu deploy kalau ada perubahan.
#
# Dipasang di cron. Keluarannya dicatat ke log supaya bisa diperiksa.
#
# KENAPA PAKAI --check DULU:
# Deploy Cloudflare memakan waktu dan kuota. Kalau tidak ada yang berubah,
# tidak perlu deploy sama sekali — jadi skrip ini memeriksa dulu, dan hanya
# mendeploy saat angkanya benar-benar bergeser.

set -u

ROOT="/home/ubuntu/portfolio-victer"
NODE="/home/ubuntu/.hermes/node/bin/node"
LOG="/home/ubuntu/.portfolio-token/sync-metrik.log"

cd "$ROOT" || exit 1

echo "── $(date '+%Y-%m-%d %H:%M:%S') ──" >> "$LOG"

# 1. Apakah metrik basi?
if "$NODE" scripts/sync-metrik.mjs --check >> "$LOG" 2>&1; then
  echo "tidak ada perubahan — tidak deploy" >> "$LOG"
  exit 0
fi

# 2. Ada perubahan: sinkronkan
if ! "$NODE" scripts/sync-metrik.mjs >> "$LOG" 2>&1; then
  echo "GAGAL sinkronisasi" >> "$LOG"
  exit 1
fi

# 3. Commit supaya riwayat angkanya terlacak
git add assets/js/data/projects.js >> "$LOG" 2>&1
git commit -m "data(proyek): sinkronkan metrik otomatis $(date '+%Y-%m-%d %H:%M')" >> "$LOG" 2>&1

# 4. Deploy
if npm run deploy:aman >> "$LOG" 2>&1; then
  echo "deploy OK" >> "$LOG"
else
  echo "DEPLOY GAGAL" >> "$LOG"
  exit 1
fi

# 5. Batasi ukuran log (sisakan 500 baris terakhir)
if [ -f "$LOG" ]; then
  tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
