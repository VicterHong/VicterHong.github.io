#!/usr/bin/env bash
#
# Diagnostik akses panel admin — jalankan DI LAPTOP Anda (bukan di server).
#
# Tujuan: mencari tahu kenapa Chrome "masih memuat" saat membuka panel admin.
#
# Pemakaian:
#   bash diagnose-admin-access.sh 127.0.0.1 8789
#
set -uo pipefail

HOST="${1:-127.0.0.1}"
PORT="${2:-8789}"

echo "════════════════════════════════════════════════════════"
echo " Diagnostik akses panel admin"
echo " Target: http://${HOST}:${PORT}/admin"
echo "════════════════════════════════════════════════════════"
echo ""

# ── 1. Apakah ada yang mendengarkan di port lokal? ──────────────────────────
echo "── 1. Port ${PORT} di laptop ini ──"
if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | tail -n +1 | head -5; then
    echo "   ✓ ada yang mendengarkan"
  else
    echo "   ✗ TIDAK ADA yang mendengarkan di port ${PORT}"
    echo "     → Tunnel SSH belum aktif, atau bind-nya ke alamat lain."
  fi
elif command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep ":${PORT}" || echo "   ✗ TIDAK ADA yang mendengarkan di port ${PORT}"
else
  echo "   (lsof/ss tidak tersedia — lewati)"
fi
echo ""

# ── 2. Uji IPv4 ─────────────────────────────────────────────────────────────
echo "── 2. Koneksi ke 127.0.0.1:${PORT} (IPv4) ──"
CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/admin" 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then
  echo "   ✓ HTTP 200 — panel terjangkau lewat IPv4"
elif [ "$CODE" = "000" ]; then
  echo "   ✗ tidak terjangkau (timeout/refused)"
else
  echo "   ⚠ HTTP ${CODE}"
fi
echo ""

# ── 3. Uji IPv6 ─────────────────────────────────────────────────────────────
echo "── 3. Koneksi ke [::1]:${PORT} (IPv6) ──"
CODE6=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "http://[::1]:${PORT}/admin" 2>/dev/null || echo "000")
if [ "$CODE6" = "200" ]; then
  echo "   ✓ HTTP 200 — panel terjangkau lewat IPv6"
elif [ "$CODE6" = "000" ]; then
  echo "   ✗ tidak terjangkau"
  echo "     → Kalau IPv4 ✓ tapi IPv6 ✗: browser mungkin coba IPv6 dulu."
  echo "       Solusi: pakai URL eksplisit http://127.0.0.1:${PORT}/admin"
else
  echo "   ⚠ HTTP ${CODE6}"
fi
echo ""

# ── 4. Kecepatan respons ────────────────────────────────────────────────────
echo "── 4. Waktu respons ──"
TIME=$(curl -s -m 10 -o /dev/null -w "%{time_total}" "http://127.0.0.1:${PORT}/admin" 2>/dev/null || echo "?")
echo "   ${TIME}s (harus < 1s; kalau lambat, tunnel-nya bermasalah)"
echo ""

# ── 5. Apakah HTML panel benar-benar sampai? ────────────────────────────────
echo "── 5. Isi respons ──"
BODY=$(curl -s -m 10 "http://127.0.0.1:${PORT}/admin" 2>/dev/null | head -c 200)
if echo "$BODY" | grep -qi "Admin — Layanan Token"; then
  echo "   ✓ HTML panel admin diterima"
elif echo "$BODY" | grep -qi "akses_ditolak"; then
  echo "   ✗ DITOLAK — permintaan dianggap datang dari luar loopback"
  echo "     → Tunnel mengirim header proxy. Pakai 127.0.0.1 eksplisit."
elif [ -z "$BODY" ]; then
  echo "   ✗ respons kosong — tunnel terhubung tapi server tidak menjawab"
else
  echo "   ⚠ respons tidak dikenal: $(echo "$BODY" | head -c 80)"
fi
echo ""

# ── 6. Cek proxy yang mungkin mengganggu ────────────────────────────────────
echo "── 6. Proxy di lingkungan ──"
ENV_PROXY=$(env | grep -iE "^(http_proxy|https_proxy|all_proxy)=" || true)
if [ -n "$ENV_PROXY" ]; then
  echo "   ⚠ ada proxy aktif:"
  echo "$ENV_PROXY" | sed 's/^/     /'
  echo "     → Chrome mungkin mengarahkan localhost lewat proxy. Tambahkan"
  echo "       'localhost,127.0.0.1' ke daftar bypass proxy Chrome."
else
  echo "   ✓ tidak ada proxy env"
fi
echo ""

# ── Ringkasan + solusi ──────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════"
echo " RINGKASAN & SOLUSI"
echo "════════════════════════════════════════════════════════"
echo ""
if [ "$CODE" = "200" ] && [ "$CODE6" = "200" ]; then
  echo " ✅ Tunnel sehat di IPv4 dan IPv6."
  echo "    Buka: http://127.0.0.1:${PORT}/admin"
elif [ "$CODE" = "200" ]; then
  echo " ✅ Tunnel sehat di IPv4."
  echo "    PAKAI URL INI (jangan 'localhost', pakai angka):"
  echo "      http://127.0.0.1:${PORT}/admin"
else
  echo " ❌ Tunnel belum siap. Periksa:"
  echo ""
  echo " 1) Pastikan SSH tunnel masih terbuka (terminal jangan ditutup):"
  echo "      ssh -N -L 127.0.0.1:${PORT}:127.0.0.1:8788 -i ~/mykey.key ubuntu@129.225.15.88"
  echo "    Tanda berhasil: terminal diam (tidak kembali ke prompt)."
  echo ""
  echo " 2) Kalau SSH menanyakan passphrase / fingerprint, jawab dulu."
  echo ""
  echo " 3) Pakai alamat ANGKA, bukan nama — hindari ambiguitas IPv4/IPv6:"
  echo "      ssh -N -L 127.0.0.1:${PORT}:127.0.0.1:8788 ..."
  echo "      buka http://127.0.0.1:${PORT}/admin"
  echo ""
  echo " 4) Cek kunci SSH:"
  echo "      ls -l ~/mykey.key   # harus -rw------- (600)"
  echo "      chmod 600 ~/mykey.key"
  echo ""
  echo " 5) Coba mode verbose untuk melihat error:"
  echo "      ssh -v -N -L 127.0.0.1:${PORT}:127.0.0.1:8788 -i ~/mykey.key ubuntu@129.225.15.88"
fi
echo ""
