#!/bin/bash
# ── Alert keamanan otomatis — lonjakan serangan SSH ────────────────────────
#
# ── KENAPA SCRIPT INI ADA ───────────────────────────────────────────────────
# Server ini diserang 62 bot/hari secara konstan. Itu NORMAL — tidak perlu
# notifikasi. Yang perlu kamu TAHU adalah LONJAKAN: kalau tiba-tiba 200+
# serangan sehari, itu tanda ada yang menargetkanmu secara khusus.
#
# Jadi script ini TIDAK lapor "ada serangan" (selalu ada). Dia lapor
# "serangan naik drastis" — itu yang butuh perhatianmu.
#
# ── CARA KERJA ──────────────────────────────────────────────────────────────
# Setiap 6 jam: hitung ban dalam 1 jam terakhir. Bandingkan dengan baseline
# (rata-rata 7 hari). Kalau naik >3x lipat ATAU >50 ban/jam → kirim alert.
#
# ── ANTI-SPAM ───────────────────────────────────────────────────────────────
# Alert sama tidak dikirim berulang. Simpan di state file. Hanya kirim
# lagi kalau situasinya BERUBAH (naik lagi setelah reda).

set -uo pipefail

ENV_FILE="/home/ubuntu/hermes_ai_agent/.env"
STATE_DIR="/home/ubuntu/.portfolio-token/security-monitor"
STATE_FILE="$STATE_DIR/alert-state.txt"
LOG_FILE="$STATE_DIR/security.log"
DB="/var/lib/fail2ban/fail2ban.sqlite3"

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ── Ambang batas ───────────────────────────────────────────────────────────
# Baseline dari data nyata: 62,5 ban/hari = 2,6 ban/jam.
# Ambang 15/jam = ~6x baseline. Cukup tinggi supaya tidak spam,
# cukup rendah supaya lonjakan nyata terdeteksi.
AMBANG_JAM=15
AMBANG_NAIK=4      # kali lipat dari baseline

# ── Kredensial Telegram ────────────────────────────────────────────────────
TOKEN=""
CHAT=""
if [ -r "$ENV_FILE" ]; then
  TOKEN=$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | head -1)
  CHAT=$(grep -oP '^ALLOWED_TELEGRAM_USER_IDS=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | cut -d, -f1 | head -1)
fi

catat() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# ── Hitung ban per periode ─────────────────────────────────────────────────
# Pakai Python (sqlite3 CLI tidak terpasang di server ini).
baca() {
  sudo /usr/bin/python3 -c "
import sqlite3, time, sys
jam = float(sys.argv[1])
db = sqlite3.connect('$DB')
cur = db.cursor()
sekarang = time.time()
batas = sekarang - (jam * 3600)
cur.execute('SELECT COUNT(*) FROM bans WHERE timeofban >= ?', (batas,))
n = cur.fetchone()[0]
# Baseline: rata-rata ban/jam selama 7 hari terakhir
cur.execute('SELECT COUNT(*) FROM bans WHERE timeofban >= ?', (sekarang - 7*86400,))
total7 = cur.fetchone()[0]
db.close()
print(f'{n} {total7}')
" "$1" 2>/dev/null || echo "0 0"
}

read -r JAM_INI TOTAL_7HARI <<< "$(baca 1)"
[ -z "$JAM_INI" ] && JAM_INI=0
[ -z "$TOTAL_7HARI" ] && TOTAL_7HARI=0

# Baseline per jam (7 hari = 168 jam)
if [ "$TOTAL_7HARI" -gt 0 ]; then
  BASELINE=$(( TOTAL_7HARI / 168 ))
else
  BASELINE=3
fi
[ "$BASELINE" -lt 1 ] && BASELINE=1

catat "cek: ${JAM_INI} ban/jam terakhir · baseline ${BASELINE}/jam · 7hari ${TOTAL_7HARI}"

# ── Deteksi lonjakan ───────────────────────────────────────────────────────
LONJAKAN=0
if [ "$JAM_INI" -ge "$AMBANG_JAM" ]; then
  LONJAKAN=1
  ALASAN="jumlah absolut tinggi (${JAM_INI} ≥ ${AMBANG_JAM}/jam)"
elif [ "$BASELINE" -gt 0 ] && [ "$JAM_INI" -ge $(( BASELINE * AMBANG_NAIK )) ] && [ "$JAM_INI" -ge 8 ]; then
  LONJAKAN=1
  ALASAN="naik ${AMBANG_NAIK}x dari baseline (${JAM_INI} vs ${BASELINE}/jam)"
fi

# ── Kirim alert ────────────────────────────────────────────────────────────
if [ "$LONJAKAN" -eq 1 ]; then
  SEBELUMNYA=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  KUNCI="lonjakan-${JAM_INI}"

  # Kirim hanya kalau ini lonjakan BARU (bukan yang sama berulang)
  if [ "$SEBELUMNYA" != "$KUNCI" ]; then
    # Ambil detail: IP terbaru, negara teratas
    DETAIL=$(sudo /usr/bin/python3 -c "
import sqlite3, time, json, collections
db = sqlite3.connect('$DB')
cur = db.cursor()
sekarang = time.time()
cur.execute('SELECT ip, timeofban FROM bans WHERE timeofban >= ? ORDER BY timeofban DESC LIMIT 10', (sekarang-3600,))
ips = [r[0] for r in cur.fetchall()]
db.close()
geo = {}
try:
    geo = json.load(open('/tmp/geo-cache.json'))
except Exception:
    pass
negara = collections.Counter()
for ip in ips:
    d = geo.get(ip, {})
    if d.get('country'): negara[d['country']] += 1
top = ', '.join(f'{n} ({c})' for n, c in negara.most_common(3)) or 'belum dipetakan'
print(f'{len(ips)} IP baru: {\", \".join(ips[:5])}')
print(f'Negara: {top}')
" 2>/dev/null)

    if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
      PESAN="🚨 <b>Lonjakan serangan SSH</b>
$(date -u '+%Y-%m-%d %H:%M UTC')

${JAM_INI} percobaan dalam 1 jam terakhir
Baseline: ${BASELINE}/jam (7 hari)
Sebab: ${ALASAN}

${DETAIL}

✅ Semua diblokir otomatis oleh fail2ban
ℹ️ Tidak perlu tindakan — ini hanya pemberitahuan."

      curl -s -o /dev/null --max-time 15 \
        -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
        -d "chat_id=${CHAT}" -d "parse_mode=HTML" \
        --data-urlencode "text=${PESAN}" 2>/dev/null
      catat "ALERT dikirim: ${JAM_INI} ban/jam (${ALASAN})"
    fi
    echo "$KUNCI" > "$STATE_FILE"
  fi
else
  # Normal — hapus state supaya lonjakan berikutnya bisa dilaporkan
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    catat "kembali normal: ${JAM_INI} ban/jam"
  fi
fi

# ── Batasi log ─────────────────────────────────────────────────────────────
if [ -f "$LOG_FILE" ]; then
  BARIS=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$BARIS" -gt 500 ] 2>/dev/null; then
    tail -300 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
fi

exit 0
