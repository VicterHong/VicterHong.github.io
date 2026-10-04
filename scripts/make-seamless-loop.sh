#!/usr/bin/env bash
#
# Seamless loop generator — video background tanpa jeda sama sekali.
#
# MASALAH
#   Video biasa: frame terakhir ≠ frame pertama. Saat loop, mata melihat
#   "lompatan" — inilah yang membuat situs terasa murahan.
#
# SOLUSI (konstruksi yang benar)
#   Bagi video jadi tiga: HEAD (X dt pertama), MIDDLE, TAIL (X dt terakhir).
#
#       asli   : [HEAD][  MIDDLE  ][TAIL]
#       baru   : [  MIDDLE  ][blend(TAIL→HEAD)]
#
#   blend = TAIL melebur ke HEAD selama X detik.
#   • Frame pertama video baru  = frame ke-X        (awal MIDDLE)
#   • Frame terakhir video baru = frame ke-X juga   (akhir blend)
#   → frame awal == frame akhir → LOOP TAK TERLIHAT.
#
#   Sambungan MIDDLE→blend juga kontinu: MIDDLE berakhir di frame (N−X),
#   dan blend dimulai dari frame (N−X). Tidak ada lompatan di mana pun.
#
# Pemakaian: bash scripts/make-seamless-loop.sh [input] [output_base] [crossfade_detik]
#
set -euo pipefail

INPUT="${1:-assets/hero.mp4}"
OUT_BASE="${2:-assets/hero}"
X="${3:-1.0}"

echo "── Seamless loop generator ──"
echo "Input     : $INPUT"
echo "Output    : ${OUT_BASE}.mp4 + ${OUT_BASE}.webm"
echo "Crossfade : ${X}s"
echo ""

N=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
MID_LEN=$(python3 -c "print(f'{$N - 2*$X:.4f}')")
echo "Durasi asli: ${N}s → durasi baru: $(python3 -c "print(f'{$N - $X:.3f}')")s"
echo ""

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Normalisasi semua potongan: fps, ukuran, pixel format sama — supaya
# xfade & concat tidak mengeluh dan hasilnya mulus.
NORM="-vf format=yuv420p -r 24"

# ── HEAD: 0 → X ─────────────────────────────────────────────────────────────
ffmpeg -v error -y -ss 0 -t "$X" -i "$INPUT" $NORM -an "$TMP/head.mp4"

# ── MIDDLE: X → (N−X) ───────────────────────────────────────────────────────
ffmpeg -v error -y -ss "$X" -t "$MID_LEN" -i "$INPUT" $NORM -an "$TMP/middle.mp4"

# ── TAIL: (N−X) → N ─────────────────────────────────────────────────────────
ffmpeg -v error -y -ss "$(python3 -c "print(f'{$N - $X:.4f}')")" -i "$INPUT" $NORM -an "$TMP/tail.mp4"

# ── BLEND: TAIL melebur ke HEAD (durasi = X) ────────────────────────────────
ffmpeg -v error -y -i "$TMP/tail.mp4" -i "$TMP/head.mp4" \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=${X}:offset=0,format=yuv420p[v]" \
  -map "[v]" -an "$TMP/blend.mp4"

# ── GABUNG: MIDDLE + BLEND ──────────────────────────────────────────────────
ffmpeg -v error -y -i "$TMP/middle.mp4" -i "$TMP/blend.mp4" \
  -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -an \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
  "${OUT_BASE}.mp4"

# WebM (VP9) — browser modern memilih ini (lebih kecil, kualitas setara).
ffmpeg -v error -y -i "${OUT_BASE}.mp4" \
  -c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 -an \
  "${OUT_BASE}.webm"

# ── VERIFIKASI ──────────────────────────────────────────────────────────────
rm -f "$TMP/first.png" "$TMP/last.png"
ffmpeg -v error -y -i "${OUT_BASE}.mp4" -vf "select=eq(n\,0)" -vframes 1 -update 1 "$TMP/first.png"
ffmpeg -v error -y -sseof -0.02 -i "${OUT_BASE}.mp4" -vframes 1 -update 1 "$TMP/last.png"

python3 - "$TMP/first.png" "$TMP/last.png" <<'PY'
import sys
from PIL import Image
import numpy as np
try:
    a = np.asarray(Image.open(sys.argv[1]).convert('RGB'), dtype=float)
    b = np.asarray(Image.open(sys.argv[2]).convert('RGB'), dtype=float)
    if a.shape != b.shape:
        print(f'  ⚠ ukuran berbeda {a.shape} vs {b.shape}')
        sys.exit(0)
    diff = float(np.abs(a - b).mean())
    print(f'  Beda frame awal↔akhir: {diff:.2f}/255')
    if diff < 3:
        print('  ✅ LOOP MULUS SEMPURNA — tidak akan terlihat jeda.')
    elif diff < 8:
        print('  ✅ Loop halus — jeda tidak terlihat mata pada video latar.')
    else:
        print('  ⚠ Masih ada beda; coba crossfade lebih panjang.')
except Exception as e:
    print('  (verifikasi dilewati:', e, ')')
PY

echo ""
ls -la "${OUT_BASE}.mp4" "${OUT_BASE}.webm"
echo ""
echo "✓ Selesai."
