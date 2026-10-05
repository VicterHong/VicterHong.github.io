#!/usr/bin/env bash
#
# Migrasi ke domain kustom victer.is-a.dev
#
# JALANKAN HANYA SETELAH PR is-a-dev/register#54937 DI-MERGE.
#
# Skrip ini mengubah semua rujukan domain dari portfolio-victer.pages.dev
# ke victer.is-a.dev. Domain lama TETAP BEKERJA (Cloudflare Pages dan
# GitHub Pages tidak dimatikan), jadi tidak ada tautan yang rusak — ini
# hanya memindahkan domain UTAMA yang dipakai canonical/OG/sitemap.
#
# Kenapa harus diganti: canonical dan og:url menentukan versi mana yang
# diindeks Google. Kalau keduanya menunjuk pages.dev padahal domain kustom
# sudah aktif, Google melihat dua versi konten yang sama dan bisa memilih
# yang salah sebagai versi utama.
#
# Pemakaian:
#   ./scripts/migrate-domain.sh            # jalankan migrasi
#   ./scripts/migrate-domain.sh --dry-run  # lihat perubahan tanpa menulis
#   ./scripts/migrate-domain.sh --revert   # kembali ke pages.dev
#
set -euo pipefail

DOMAIN_BARU="victer.is-a.dev"
DOMAIN_LAMA="portfolio-victer.pages.dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
REVERT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --revert) REVERT=1 ;;
  esac
done

if [ "$REVERT" -eq 1 ]; then
  DARI="$DOMAIN_BARU"; KE="$DOMAIN_LAMA"
  echo "Mode: KEMBALI ke $DOMAIN_LAMA"
else
  DARI="$DOMAIN_LAMA"; KE="$DOMAIN_BARU"
  echo "Mode: MIGRASI ke $DOMAIN_BARU"
fi

# Berkas yang memuat domain publik.
# Sengaja TIDAK menyertakan domains/victer.json (itu konfigurasi PR, jangan diubah)
# dan scripts/*.mjs debug (itu alat uji, bukan bagian situs).
FILES=(
  home.html
  docs.html
  index.html
  404.html
  sitemap.xml
  robots.txt
  llms.txt
  backend/src/seo.mjs
  backend/scripts/uptime.mjs
  workers/site.ts
  workers/redirect.js
)

echo ""
echo "Berkas yang diperiksa:"
TOTAL=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then continue; fi
  # grep -c mengembalikan exit 1 kalau tidak ada kecocokan; `|| true`
  # mencegah set -e menghentikan skrip, dan `head -1` menormalkan output.
  N=$(grep -c "$DARI" "$f" 2>/dev/null | head -1 || true)
  N=${N:-0}
  if [ "$N" -gt 0 ] 2>/dev/null; then
    echo "  $f: $N kemunculan"
    TOTAL=$((TOTAL + N))
  fi
done

echo ""
echo "Total: $TOTAL kemunculan"

if [ "$TOTAL" -eq 0 ]; then
  echo "Tidak ada yang perlu diubah."
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "(dry-run — tidak ada berkas yang diubah)"
  exit 0
fi

# Backup dulu
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/domain-migrasi-$STAMP"
mkdir -p "$BACKUP_DIR"
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp "$f" "$BACKUP_DIR/$f"
  fi
done
echo ""
echo "Backup: $BACKUP_DIR"

# Ganti
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then continue; fi
  if grep -q "$DARI" "$f" 2>/dev/null; then
    # macOS sed butuh argumen '' setelah -i; Linux tidak. Deteksi otomatis.
    if sed --version >/dev/null 2>&1; then
      sed -i "s|$DARI|$KE|g" "$f"
    else
      sed -i '' "s|$DARI|$KE|g" "$f"
    fi
    echo "  ✓ $f"
  fi
done

echo ""
echo "Selesai. Langkah berikutnya:"
echo ""
if [ "$REVERT" -eq 0 ]; then
  echo "  1. Tambahkan $DOMAIN_BARU ke ALLOWED_ORIGINS di service.env:"
  echo "       sudo nano ~/.portfolio-token/service.env"
  echo "       ALLOWED_ORIGINS=https://victer.is-a.dev,https://portfolio-victer.pages.dev,https://victerhong.github.io"
  echo ""
  echo "  2. Tambahkan $DOMAIN_BARU ke TURNSTILE_HOSTNAMES:"
  echo "       TURNSTILE_HOSTNAMES=victer.is-a.dev,portfolio-victer.pages.dev,victerhong.github.io"
  echo "     (dan tambahkan domain itu di dashboard Cloudflare Turnstile)"
  echo ""
  echo "  3. Tambahkan domain kustom di Cloudflare Pages:"
  echo "       Dashboard → Workers & Pages → portfolio-victer → Custom domains"
  echo ""
  echo "  4. Deploy ulang:"
  echo "       wrangler pages deploy . --project-name=portfolio-victer"
  echo "       wrangler deploy workers/site.ts"
  echo ""
  echo "  5. Restart backend:"
  echo "       sudo -n systemctl restart portfolio-token"
  echo ""
  echo "  6. Verifikasi:"
  echo "       curl -sI https://$DOMAIN_BARU | head -5"
  echo "       curl -s https://$DOMAIN_BARU/api/health"
else
  echo "  Kembali ke $DOMAIN_LAMA. Jangan lupa kembalikan juga"
  echo "  ALLOWED_ORIGINS dan TURNSTILE_HOSTNAMES kalau perlu."
fi
