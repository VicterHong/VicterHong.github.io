#!/usr/bin/env bash
# Tunnel untuk layanan token portofolio.
#
# Cloudflare quick tunnel memberi URL acak yang berubah setiap restart. Supaya frontend
# di GitHub Pages selalu tahu alamat terbaru, skrip ini menulis URL itu ke berkas
# backend-url.json di repo portofolio lalu push — frontend membacanya sebelum memanggil API.
#
# Dijalankan oleh systemd; jangan jalankan dua salinan sekaligus.

set -uo pipefail

REPO="/home/ubuntu/portfolio-victer"
URL_FILE="$REPO/backend-url.json"
CLOUDFLARED="/home/ubuntu/.9router/bin/cloudflared"
LOCAL_PORT="8788"
LOG_TAG="[portfolio-tunnel]"

log() { echo "$LOG_TAG $*"; }

# Terbitkan URL baru ke GitHub hanya kalau berbeda dari yang sudah tercatat.
publish_url() {
  local url="$1"
  local current=""
  [ -f "$URL_FILE" ] && current="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$URL_FILE','utf8')).api_base||'')}catch{}" 2>/dev/null)"

  if [ "$url" = "$current" ]; then
    log "URL tidak berubah: $url"
    return 0
  fi

  log "URL baru: $url (sebelumnya: ${current:-kosong})"
  node -e "
    const fs = require('fs');
    fs.writeFileSync('$URL_FILE', JSON.stringify({
      api_base: '$url',
      updated_at: new Date().toISOString()
    }, null, 2) + '\n');
  "

  cd "$REPO" || return 1
  git add backend-url.json
  git -c user.email=bot@portfolio -c user.name=portfolio-tunnel \
      commit -q -m "tunnel: perbarui alamat layanan token" 2>/dev/null
  git push -q origin main 2>/dev/null && log "dipublikasikan ke GitHub Pages" || log "GAGAL push (akan dicoba lagi nanti)"
}

# Jalankan cloudflared dan tangkap URL dari outputnya.
run_tunnel() {
  local tmp
  tmp="$(mktemp)"
  log "memulai cloudflared ke 127.0.0.1:$LOCAL_PORT"

  "$CLOUDFLARED" tunnel --url "http://127.0.0.1:$LOCAL_PORT" --no-autoupdate 2>&1 | tee "$tmp" &
  local cf_pid=$!

  # Tunggu URL muncul di output (maksimum 60 detik).
  local waited=0
  while [ $waited -lt 60 ]; do
    local found
    found="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$tmp" | head -1)"
    if [ -n "$found" ]; then
      publish_url "$found"
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if [ $waited -ge 60 ]; then
    log "URL tidak terdeteksi dalam 60 detik"
  fi

  # Tunggu proses cloudflared selesai (systemd akan restart kalau mati).
  wait $cf_pid
  rm -f "$tmp"
}

# Ulang selamanya: quick tunnel bisa mati, dan setiap kali URL-nya berubah.
while true; do
  run_tunnel
  log "tunnel berhenti, memulai ulang dalam 10 detik"
  sleep 10
done
