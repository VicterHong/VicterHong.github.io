#!/usr/bin/env bash
# Uji end-to-end: jalankan server, tembak endpoint auth dengan input rusak,
# periksa status yang dikembalikan. Bersihkan diri sendiri.
#
# KENAPA SKRIP, BUKAN SATU PERINTAH:
# Server harus hidup DI LATAR BELAKANG sementara curl berjalan, lalu dimatikan.
# Menulisnya sebagai skrip membuat urutan start→uji→stop eksplisit dan bisa
# dijalankan ulang kapan saja.
#
# KENAPA PAKAI BERKAS ENV, BUKAN VARIABEL LINGKUNGAN:
# config.mjs membaca rahasia dari BERKAS (TOKEN_SERVICE_ENV), bukan dari
# process.env langsung — supaya rahasia tidak muncul di `ps e` / systemd
# environment dump. Variabel lingkungan saja akan ditolak validateConfig()
# dengan "konfigurasi belum lengkap".
set -u

DIR=$(mktemp -d /tmp/uji-server-XXXX)
trap 'kill $SRV 2>/dev/null; rm -rf "$DIR"' EXIT

# Berkas env uji (rahasia karangan, hanya untuk server lokal sementara).
cat > "$DIR/service.env" <<'EOF'
SERVICE_SECRET=uji-rahasia-lokal-minimal-24-karakter
ADMIN_KEY=uji-admin-lokal-minimal-24-karakter-xx
SALES_EMAIL=uji@example.com
ALLOWED_ORIGINS=http://127.0.0.1:8899
SITE_URL=http://127.0.0.1:8899
EOF
chmod 600 "$DIR/service.env"

export TOKEN_SERVICE_ENV="$DIR/service.env"
export DB_PATH="$DIR/uji.db"
export PORT=8899
export NODE_ENV=development

echo "══ 1. JALANKAN SERVER UJI ══"
node src/server.mjs > "$DIR/server.log" 2>&1 &
SRV=$!

# Tunggu siap (maks 10 detik) — jangan tidur tetap.
SIAP=0
for i in $(seq 1 20); do
  if curl -s -m 1 "http://127.0.0.1:8899/api/health" > /dev/null 2>&1; then SIAP=1; break; fi
  sleep 0.5
done
echo "  pid: $SRV · siap: $SIAP"
if [ "$SIAP" -ne 1 ]; then
  echo "  ❌ server tidak siap — log:"
  tail -15 "$DIR/server.log" | sed 's/^/     /'
  exit 1
fi
echo ""

echo "══ 2. KESEHATAN ══"
curl -s -m 5 "http://127.0.0.1:8899/api/health" | head -c 160
echo ""
echo ""

echo "══ 3. JSON RUSAK ke rute auth ══"
echo "   Sebelum fix: 400 permintaan_tidak_valid (dari requestHandler — salah)"
echo "   Setelah fix: 400 'JSON tidak valid' (dari safe() — benar, itu memang input klien)"
curl -s -m 5 -X POST "http://127.0.0.1:8899/api/auth/passkey/masuk/selesai" \
  -H 'content-type: application/json' --data-binary '{bad json' \
  -w '\n  → HTTP %{http_code}\n'
echo ""

echo "══ 4. JSON VALID tapi kosong (kontrol — 4xx yang benar) ══"
curl -s -m 5 -X POST "http://127.0.0.1:8899/api/auth/passkey/masuk/selesai" \
  -H 'content-type: application/json' --data-binary '{}' \
  -w '\n  → HTTP %{http_code}\n'
echo ""

echo "══ 5. GET profil tanpa sesi (kontrol — 401 benar) ══"
curl -s -m 5 "http://127.0.0.1:8899/api/auth/profil" \
  -w '\n  → HTTP %{http_code}\n'
echo ""

echo "══ 6. Rute tak dikenal (kontrol — 404 benar) ══"
curl -s -m 5 -o /dev/null -w '  → HTTP %{http_code}\n' \
  "http://127.0.0.1:8899/api/tidak-ada-endpoint-ini"
echo ""

echo "══ 7. LOG SERVER (12 baris terakhir) ══"
tail -12 "$DIR/server.log" | sed 's/^/  /'
