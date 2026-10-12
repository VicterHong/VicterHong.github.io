#!/bin/bash
#
# Pasang hook `post-commit` di repo proyek, supaya metrik portofolio
# tersinkron OTOMATIS begitu ada commit — bukan menunggu jadwal cron.
#
# Pemakaian:
#   bash scripts/pasang-hook.sh              # pasang di repo yang terdaftar
#   bash scripts/pasang-hook.sh --lepas      # cabut semua hook
#   bash scripts/pasang-hook.sh --status     # lihat keadaan sekarang
#
# ── KENAPA INSTALLER, BUKAN SALIN MANUAL ────────────────────────────────────
#
# `core.hooksPath` bisa disetel siapa saja, dan repo yang dikloning ulang
# kehilangan hook-nya tanpa jejak. Installer ini idempoten: dijalankan dua kali
# hasilnya sama, dan bisa melaporkan keadaan sebenarnya.
#
set -u

PORTFOLIO="/home/ubuntu/portfolio-victer"
HOOK_SRC="$PORTFOLIO/scripts/git-hook-post-commit"

# Repo proyek yang metriknya masuk ke portofolio. Sengaja TIDAK termasuk
# portofolio sendiri — sinkronisasi menulis commit ke sana, jadi hook di sana
# akan memicu dirinya sendiri tanpa henti.
REPO_LIST=(
  "/home/ubuntu/whatsapp-family-bot"
  "/home/ubuntu/mina-remote-control"
)

AKSI="${1:-pasang}"

# ── PEMASANGAN PER REPO ───────────────────────────────────────────────────────

pasang_satu() {
  local repo="$1"
  local nama
  nama="$(basename "$repo")"

  if [ ! -d "$repo/.git" ]; then
    printf "  ⏭️  %-28s bukan repo git\n" "$nama"
    return 1
  fi

  # Tolak repo portofolio sendiri: hook di sana = lingkaran tanpa akhir.
  if [ "$repo" = "$PORTFOLIO" ]; then
    printf "  ⏭️  %-28s dilewati (repo portofolio)\n" "$nama"
    return 1
  fi

  # Salin hook ke repo proyek, supaya ia hidup walau portofolio dipindahkan.
  local dir="$repo/.git/hooks"
  mkdir -p "$dir" || return 1
  cp "$HOOK_SRC" "$dir/post-commit" || return 1
  chmod +x "$dir/post-commit" || return 1

  # `core.hooksPath` bisa menunjuk ke tempat lain dan membuat hook ini diabaikan
  # tanpa pesan apa pun. Kalau ada, laporkan — jangan diam-diam tidak bekerja.
  local hp
  hp="$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$hp" ]; then
    printf "  ⚠️  %-28s terpasang, TAPI core.hooksPath=%s (hook ini mungkin diabaikan)\n" "$nama" "$hp"
    return 0
  fi

  printf "  ✅ %-28s hook terpasang\n" "$nama"
  return 0
}

lepas_satu() {
  local repo="$1"
  local nama
  nama="$(basename "$repo")"
  local target="$repo/.git/hooks/post-commit"

  # Hanya hapus kalau itu hook KITA — jangan sentuh hook buatan pengguna.
  if [ -f "$target" ] && grep -q "sinkronkan metrik portofolio" "$target" 2>/dev/null; then
    rm -f "$target"
    printf "  🗑️  %-28s hook dicabut\n" "$nama"
    return 0
  fi
  printf "  ⏭️  %-28s tidak ada hook kita\n" "$nama"
  return 1
}

status_satu() {
  local repo="$1"
  local nama
  nama="$(basename "$repo")"
  local target="$repo/.git/hooks/post-commit"

  if [ -f "$target" ] && grep -q "sinkronkan metrik portofolio" "$target" 2>/dev/null; then
    printf "  ✅ %-28s terpasang (%s)\n" "$nama" "$(stat -c '%y' "$target" 2>/dev/null | cut -d. -f1)"
  elif [ -f "$target" ]; then
    printf "  ⚠️  %-28s ada hook LAIN (bukan milik kita)\n" "$nama"
  else
    printf "  ❌ %-28s belum terpasang\n" "$nama"
  fi
}

# ── JALANKAN ──────────────────────────────────────────────────────────────────

case "$AKSI" in
  --lepas|lepas)
    echo "Mencabut hook:"
    for r in "${REPO_LIST[@]}"; do lepas_satu "$r"; done
    ;;
  --status|status)
    echo "Keadaan hook:"
    for r in "${REPO_LIST[@]}"; do status_satu "$r"; done
    echo ""
    echo "Cron jaring pengaman:"
    if crontab -l 2>/dev/null | grep -q "sync-metrik-cron.sh"; then
      echo "  ✅ terpasang (setiap 6 jam)"
    else
      echo "  ❌ tidak ada — pasang supaya metrik tetap sinkron kalau hook gagal"
    fi
    ;;
  *)
    if [ ! -f "$HOOK_SRC" ]; then
      echo "❌ Hook sumber tidak ada: $HOOK_SRC" >&2
      exit 1
    fi
    echo "Memasang hook post-commit:"
    OK=0
    for r in "${REPO_LIST[@]}"; do
      if pasang_satu "$r"; then OK=$((OK+1)); fi
    done
    echo ""
    echo "Terpasang di $OK repo."
    echo ""
    echo "Cara kerjanya:"
    echo "  1. Commit di repo proyek → hook jalan di latar belakang (commit TIDAK menunggu)"
    echo "  2. Tunggu 90 detik supaya commit beruntun digabung jadi satu deploy"
    echo "  3. Metrik disinkronkan, lalu deploy"
    echo ""
    echo "Periksa:  bash $0 --status"
    echo "Log    :  /home/ubuntu/.portfolio-token/hook-commit.log"
    ;;
esac
