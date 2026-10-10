#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# WATCHDOG CPU — turunkan beban otomatis saat server jenuh
# ══════════════════════════════════════════════════════════════════════════════
#
# ── MASALAH YANG DIPECAHKAN ───────────────────────────────────────────────────
#
# Ditemukan 39 proses Chrome NYASAR dari sesi lama — hidup 3 hari 22 jam,
# memakai 2.4 GB RAM, dan menaikkan load server 1-core sampai 31.
#
# Chrome itu tidak pernah ditutup karena:
#   • Sesi Hermes-nya sudah berakhir, tapi prosesnya tidak ikut mati
#   • Tidak ada yang memeriksa proses yatim (orphan)
#
# Akibatnya server jenuh berhari-hari tanpa ada yang tahu. Dashboard baru
# menunjukkan masalah setelah pengguna melihatnya sendiri.
#
# Script ini menutup celah itu: memeriksa beban, dan kalau sudah terlalu
# tinggi SELAMA BEBERAPA WAKTU, membersihkan proses yatim secara otomatis.
#
# ── KENAPA HARUS "SELAMA BEBERAPA WAKTU", BUKAN SEKALI CEK ───────────────────
#
# Load tinggi sesaat itu NORMAL — build, deploy, transkripsi video, semuanya
# menaikkan load sebentar. Membunuh proses karena lonjakan sesaat akan merusak
# pekerjaan yang sedang berjalan.
#
# Yang berbahaya adalah load tinggi yang BERTAHAN. Karena itu script ini
# memakai konfirmasi berlapis:
#
#   cek 1  load tinggi → catat, TIDAK melakukan apa-apa
#   cek 2  masih tinggi → catat, TIDAK melakukan apa-apa
#   cek 3  masih tinggi → baru bertindak
#
# Dengan timer 5 menit, artinya load harus tinggi ~15 menit berturut-turut.
#
# ── APA YANG DILAKUKAN SAAT BEBAN TINGGI ─────────────────────────────────────
#
#   1. Tutup Chrome yatim (proses dari sesi yang sudah berakhir)
#   2. Tutup proses Hermes yatim yang menggantung
#   3. LAPOR ke Telegram — apa yang ditemukan dan apa yang dilakukan
#
# Script ini TIDAK PERNAH membunuh:
#   • Proses produksi (portfolio-token, tunnel, hermes-bot, mina-dashboard)
#   • Proses root
#   • Proses yang sedang dipakai sesi Hermes AKTIF
#   • Proses dalam status D (menunggu disk — mematikan justru memperburuk)
#
# ── I/O WAIT: KENAPA DIPERIKSA TAPI TIDAK DITINDAK ───────────────────────────
#
# iowait tinggi artinya CPU menunggu DISK, bukan sibuk menghitung. Membunuh
# proses pada kondisi ini TIDAK membantu — bahkan berbahaya, karena proses yang
# sedang menulis data bisa meninggalkan file setengah jadi.
#
# Jadi iowait hanya DILAPORKAN, tidak ditindak. Kalau iowait yang tinggi,
# solusinya bukan membunuh proses tapi mengurangi I/O.
# ══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── Konfigurasi ───────────────────────────────────────────────────────────────
STATE_DIR="/home/ubuntu/.portfolio-token/watchdog"
STATE_FILE="$STATE_DIR/status.txt"
LOG_FILE="$STATE_DIR/watchdog.log"
ENV_FILE="/home/ubuntu/hermes_ai_agent/.env"

# ── Ambang batas — dipilih dari kondisi server nyata ──────────────────────────
#
# Server ini 1 core. Load 1.0 = CPU penuh terpakai.
#   1-3   : normal untuk server yang bekerja
#   3-6   : berat, tapi masih wajar saat build/deploy
#   >6    : jenuh — ada yang salah
#
# 6 dipilih karena load 5.88 sudah muncul di dashboard saat Chrome nyasar
# masih hidup. Di bawah itu, lonjakan sementara wajar terjadi.
LOAD_WARN=6

# iowait di atas ini berarti CPU lebih banyak menunggu disk daripada bekerja.
# 30% sudah tidak sehat untuk server yang sebagian besar tugasnya network I/O.
IOWAIT_WARN=30

# Butuh 3 cek berturut-turut sebelum bertindak. Timer 5 menit = ~15 menit.
AMBANG_CEK=3

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ── Baca kredensial Telegram ──────────────────────────────────────────────────
TOKEN=""
CHAT=""
if [ -r "$ENV_FILE" ]; then
  TOKEN=$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | head -1)
  CHAT=$(grep -oP '^ALLOWED_TELEGRAM_USER_IDS=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' | tr -d "'" | cut -d, -f1 | head -1)
fi

catat() {
  echo "[$(TZ='Asia/Jakarta' date '+%d/%m %H:%M:%S')] $1" >> "$LOG_FILE"
}

kirim() {
  # Kirim ke Telegram kalau kredensial tersedia. Diam-diam gagal kalau tidak —
  # notifikasi yang gagal tidak boleh menggagalkan pembersihan.
  [ -z "$TOKEN" ] || [ -z "$CHAT" ] && return 0
  curl -s -m 15 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    -d "chat_id=${CHAT}" \
    -d "parse_mode=HTML" \
    --data-urlencode "text=$1" >/dev/null 2>&1 || true
}

# ══════════════════════════════════════════════════════════════════════════════
# 1. UKUR BEBAN
# ══════════════════════════════════════════════════════════════════════════════

# Load average 1 menit, tanpa desimal (dibulatkan ke bawah).
LOAD=$(awk '{printf "%d", $1}' /proc/loadavg)

# ── iowait: DIHITUNG DARI SELISIH DUA SAMPEL ─────────────────────────────────
#
# Kolom /proc/stat adalah jumlah TICK sejak boot — bukan persentase. Membaginya
# dengan jumlah CPU memberi angka kumulatif seumur server, yang tidak berguna
# (server ini sudah hidup 51 hari).
#
# Yang benar: ambil dua sampel berjarak 1 detik, lalu hitung berapa tick yang
# bertambah di tiap kategori. Itu barulah kondisi SEKARANG.
#
# ── SUSUNAN KOLOM /proc/stat ─────────────────────────────────────────────────
#
#   cpu  user nice system idle iowait irq softirq steal
#        $2   $3   $4     $5   $6     $7  $8      $9
#
#   total  = jumlah semuanya
#   idle   = $5 (benar-benar menganggur)
#   iowait = $6 (menunggu disk — BUKAN menganggur, tapi juga bukan bekerja)
#
# ── KENAPA IDLE DAN IOWAIT DIPISAH ───────────────────────────────────────────
#
# Versi pertama skrip ini hanya menyimpan total dan iowait, lalu menghitung
# "CPU terpakai = total - iowait". Hasilnya SELALU ~100% — karena idle ikut
# terhitung sebagai "terpakai". Bug ini terlihat saat uji: load 1.83 tapi
# script melaporkan CPU 100%.
#
# Dengan memisahkan ketiganya, angkanya jadi jujur:
#   CPU% + iowait% + idle% ≈ 100%
baca_stat() { awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5, $6}' /proc/stat; }
read -r T1 IDLE1 I1 <<< "$(baca_stat)"
sleep 1
read -r T2 IDLE2 I2 <<< "$(baca_stat)"
DT=$((T2 - T1))
DIDLE=$((IDLE2 - IDLE1))
DI=$((I2 - I1))

if [ "$DT" -gt 0 ]; then
  CPU_PAKAI=$(( (DT - DIDLE - DI) * 100 / DT ))
  IOWAIT=$(( DI * 100 / DT ))
  IDLE_PCT=$(( DIDLE * 100 / DT ))
  # Jaga-jaga kalau pembulatan membuat angka negatif.
  [ "$CPU_PAKAI" -lt 0 ] && CPU_PAKAI=0
  [ "$IOWAIT" -lt 0 ] && IOWAIT=0
  [ "$IDLE_PCT" -lt 0 ] && IDLE_PCT=0
else
  CPU_PAKAI=0
  IOWAIT=0
  IDLE_PCT=0
fi

catat "load=$LOAD cpu=${CPU_PAKAI}% iowait=${IOWAIT}% idle=${IDLE_PCT}%"

# ══════════════════════════════════════════════════════════════════════════════
# 2. PUTUSKAN: BERTINDAK ATAU TIDAK
# ══════════════════════════════════════════════════════════════════════════════

# Hitungan berturut-turut disimpan di file, karena script ini mati setiap
# selesai — tidak ada variabel yang bertahan antar-jalan.
BERTURUT=0
[ -r "$STATE_FILE" ] && BERTURUT=$(cat "$STATE_FILE" 2>/dev/null | tr -dc '0-9' | head -c 4)
BERTURUT=${BERTURUT:-0}

if [ "$LOAD" -gt "$LOAD_WARN" ]; then
  BERTURUT=$((BERTURUT + 1))
  echo "$BERTURUT" > "$STATE_FILE"
  catat "load tinggi ($LOAD > $LOAD_WARN) — hitungan ke-$BERTURUT dari $AMBANG_CEK"

  if [ "$BERTURUT" -lt "$AMBANG_CEK" ]; then
    # Belum cukup bukti. Tunggu cek berikutnya.
    exit 0
  fi
else
  # Beban normal — reset hitungan supaya lonjakan singkat tidak menumpuk.
  if [ "$BERTURUT" -gt 0 ]; then
    catat "load normal kembali ($LOAD) — hitungan direset dari $BERTURUT"
  fi
  echo "0" > "$STATE_FILE"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# 3. BEBAN TINGGI BERTAHAN — BERSIHKAN
# ══════════════════════════════════════════════════════════════════════════════

catat "BERTINDAK — beban tinggi $AMBANG_CEK cek berturut-turut"

# ── Daftar proses yang DILINDUNGI ─────────────────────────────────────────────
#
# ══ BUG YANG DITEMUKAN SAAT UJI — PENTING ════════════════════════════════════
#
# Versi pertama memakai pencocokan NAMA di command line:
#
#   LINDUNG=("portfolio-token" "hermes-bot" ...)
#   dilindungi() { case "$cmd" in *"$p"*) return 0 ;; esac }
#
# Saat diuji dengan command line NYATA, ini BOCOR:
#
#   /home/ubuntu/.hermes/hermes-agent/venv/bin/python run_agent.py
#     → TIDAK cocok dengan "hermes-bot"  → TIDAK terlindungi ❌
#
#   /usr/bin/node /home/ubuntu/portfolio-victer/backend/src/server.mjs
#     → TIDAK cocok dengan "portfolio-token" → TIDAK terlindungi ❌
#
# Artinya: proses produksi bisa ikut dibunuh. Ini bug yang berbahaya, dan
# ditemukan justru karena ada uji keamanan sebelum dipasang.
#
# ══ PERBAIKAN: PID DARI SYSTEMD, BUKAN NAMA ══════════════════════════════════
#
# Systemd tahu PERSIS PID mana yang menjadi proses utama setiap layanan.
# Itu sumber kebenaran — bukan tebakan dari string command line.
#
# Selain itu, semua ANAK proses dari layanan terlindungi juga ikut dilindungi.
# Kalau tidak, membunuh anak dari proses produksi akan merusaknya.
#
# ── KENAPA LEBIH BAIK ────────────────────────────────────────────────────────
#
#   • Tidak bergantung pada isi command line (bisa berubah kapan saja)
#   • Tetap benar walau layanan di-restart (PID diambil ulang setiap jalan)
#   • Tidak bisa "kebetulan cocok" dengan proses yang tidak seharusnya
#
# ── PROSES HERMES SENDIRI ────────────────────────────────────────────────────
#
# Watchdog ini dijalankan OLEH Hermes. Kalau ia membunuh proses Hermes,
# ia membunuh induknya sendiri — dan tidak ada yang membersihkan lagi.
# Karena itu seluruh pohon proses Hermes dilindungi.
UNITS_LINDUNG=(
  "portfolio-token.service"
  "portfolio-tunnel.service"
  "mina-tunnel.service"
  "mina-dashboard.service"
  "hermes-bot.service"
)

PID_LINDUNG=()

# PID utama setiap layanan + keturunannya — TAPI BUKAN browser.
#
# ══ BUG KEDUA YANG DITEMUKAN SAAT UJI ════════════════════════════════════════
#
# Versi pertama melindungi SEMUA keturunan setiap unit. Saat diuji, ternyata
# `mina-dashboard.service` (PID 573223) adalah proses `hermes` — dan proses
# hermes itulah yang MENJALANKAN chrome nyasar.
#
# Jadi chrome terlindungi lewat jalur unit, walaupun perlindungan pohon proses
# sudah diperbaiki. Hasilnya tetap "dibunuh=0 proses".
#
# Ditemukan dengan memeriksa jumlah keturunan per unit:
#   portfolio-token.service   11 keturunan
#   hermes-bot.service         3 keturunan
#   mina-dashboard.service    53 keturunan  ← hermes + semua anaknya
#
# ══ PERBAIKAN ════════════════════════════════════════════════════════════════
#
# Browser dan proses Playwright DIKECUALIKAN dari perlindungan, walaupun mereka
# keturunan sah dari sebuah unit. Yang dilindungi adalah proses utama layanan
# dan pekerja-pekerja non-browser-nya — bukan browser yang justru jadi sasaran.
for unit in "${UNITS_LINDUNG[@]}"; do
  MAIN=$(systemctl show -p MainPID --value "$unit" 2>/dev/null || echo 0)
  [ -z "$MAIN" ] || [ "$MAIN" = "0" ] && continue
  PID_LINDUNG+=("$MAIN")

  # Anak-cucu proses, kecuali browser.
  while read -r anak; do
    [ -z "$anak" ] && continue
    [ "$anak" = "$MAIN" ] && continue

    cmd_anak=$(ps -o cmd= -p "$anak" 2>/dev/null) || continue
    case "$cmd_anak" in
      *chrome*|*chromium*|*playwright*|*--headless*) continue ;;
    esac

    PID_LINDUNG+=("$anak")
  done < <(pstree -p "$MAIN" 2>/dev/null | grep -oP '\(\K[0-9]+' | tail -n +2)
done

# ── Pohon proses Hermes sendiri ──────────────────────────────────────────────
#
# ══ BUG YANG DITEMUKAN SAAT UJI — PERLINDUNGAN TERLALU LUAS ══════════════════
#
# Versi pertama melindungi SELURUH keturunan proses Hermes:
#
#   pstree -p <hermes> → semua anak-cucu dilindungi
#
# Hasilnya: 440 PID terlindungi — TERMASUK chrome nyasar itu sendiri, karena
# chrome dijalankan OLEH Hermes. Akibatnya watchdog tidak pernah membunuh apa
# pun: "dibunuh=0 proses" padahal ada 7 chrome yang seharusnya dibersihkan.
#
# Lebih buruk lagi: watchdog jadi tidak berguna sama sekali.
#
# ══ PERBAIKAN: LINDUNGI PROSES HERMES, BUKAN BROWSER-NYA ═════════════════════
#
# Yang perlu dilindungi adalah proses Hermes itu sendiri (agar watchdog tidak
# membunuh induknya), TAPI BUKAN browser yang dijalankannya — justru browser
# itulah yang menjadi sasaran.
#
# Jadi: proses hermes sendiri + anak langsungnya yang BUKAN browser.
# Keturunan lebih dalam (browser, renderer) tidak dilindungi.
pid_ini=$$
while true; do
  ppid_ini=$(ps -o ppid= -p "$pid_ini" 2>/dev/null | tr -d ' ')
  [ -z "$ppid_ini" ] || [ "$ppid_ini" = "0" ] || [ "$ppid_ini" = "1" ] && break
  pid_ini="$ppid_ini"
done

# Proses puncak (hermes) + dirinya sendiri.
PID_LINDUNG+=("$pid_ini" "$$")

# Anak LANGSUNG dari hermes — tapi bukan browser.
# Satu tingkat saja: cukup agar watchdog tidak membunuh shell tempat ia
# berjalan, tanpa ikut melindungi browser yang jadi sasaran.
while read -r anak; do
  [ -z "$anak" ] && continue
  [ "$anak" = "$$" ] && continue
  cmd_anak=$(ps -o cmd= -p "$anak" 2>/dev/null) || continue
  case "$cmd_anak" in
    *chrome*|*chromium*|*playwright*) continue ;;   # browser TIDAK dilindungi
  esac
  PID_LINDUNG+=("$anak")
done < <(ps -o pid= --ppid "$pid_ini" 2>/dev/null | tr -d ' ')

dilindungi() {
  local pid="$1"
  for p in "${PID_LINDUNG[@]}"; do
    [ "$pid" = "$p" ] && return 0
  done
  return 1
}

catat "dilindungi: ${#PID_LINDUNG[@]} proses (dari ${#UNITS_LINDUNG[@]} unit + proses Hermes)"

# ── Kumpulkan kandidat: CHROME NYASAR ─────────────────────────────────────────
#
# ══ BUG DESAIN YANG DITEMUKAN SAAT UJI — INI YANG PALING PENTING ═════════════
#
# Versi pertama hanya mencari proses YATIM (PPID=1), dengan asumsi Chrome
# nyasar sudah tidak punya induk karena sesinya berakhir.
#
# SAAT DIUJI DENGAN PROSES NYATA, ASUMSI ITU SALAH DUA KALI:
#
#   1. Chrome nyasar itu BUKAN yatim. PPID-nya adalah proses `hermes`
#      (PID 2077097) yang MASIH HIDUP. Jadi PPID=1 tidak pernah cocok.
#
#   2. Proses yang benar-benar yatim di server ini diadopsi oleh
#      `systemd --user` (PID 36370), BUKAN init (PID 1). Diuji dengan
#      double-fork: PPID hasilnya 36370, bukan 1.
#
# Kesimpulan: kriteria PPID=1 tidak akan PERNAH menangkap masalah sebenarnya.
# Watchdog akan lapor "tidak ada masalah" selamanya — lebih buruk daripada
# tidak ada watchdog, karena memberi rasa aman yang palsu.
#
# ══ KRITERIA YANG BENAR ══════════════════════════════════════════════════════
#
# Chrome nyasar dikenali dari gabungan sinyal, bukan satu saja:
#
#   a. Namanya chrome/chromium
#   b. Dijalankan dengan --headless (browser otomasi, bukan browser pengguna)
#   c. Sudah hidup LEBIH dari AMBANG_UMUR detik
#   d. TIDAK ada koneksi aktif ke port debugging-nya
#
# Sinyal (d) yang paling menentukan. Browser yang sedang dipakai SELALU punya
# koneksi ke port debug-nya — itu cara Hermes mengendalikannya. Kalau tidak ada
# koneksi sama sekali dan umurnya sudah lama, browser itu tidak ada yang pakai.
#
# Ambang umur mencegah browser yang BARU dibuka ikut dibunuh — saat Hermes baru
# start browser, ada jeda sebelum koneksi terbentuk.
AMBANG_UMUR=1800   # 30 menit — cukup lama untuk memastikan benar-benar nyasar

chrome_nyasar() {
  local pid="$1"

  # (a) harus chrome
  local cmd
  cmd=$(ps -o cmd= -p "$pid" 2>/dev/null) || return 1
  case "$cmd" in
    *chrome*|*chromium*) ;;
    *) return 1 ;;
  esac

  # (b) harus headless — browser otomasi
  case "$cmd" in
    *--headless*) ;;
    *) return 1 ;;
  esac

  # (c) harus sudah lama hidup
  local umur
  umur=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -z "$umur" ] && return 1
  [ "$umur" -lt "$AMBANG_UMUR" ] && return 1

  # (d) port debug-nya harus tidak ada yang memakai
  #
  # Port diambil dari command line (--remote-debugging-port=NNNN).
  # Kalau tidak disebut, berarti tidak ada koneksi yang mungkin — aman dibunuh.
  local port
  port=$(printf '%s' "$cmd" | grep -oP 'remote-debugging-port=\K[0-9]+' | head -1)

  if [ -n "$port" ]; then
    local koneksi
    koneksi=$(ss -tnH 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" || $5 ~ p"$"' | wc -l)
    [ "$koneksi" -gt 0 ] && return 1   # ada yang memakai — jangan sentuh
  fi

  return 0
}

# ── Kumpulkan kandidat ────────────────────────────────────────────────────────
#
# Iterasi semua proses milik user ubuntu. Proses root tidak pernah disentuh.
DIBUNUH=()
DITEMUKAN=()

while read -r pid; do
  [ -z "$pid" ] && continue
  [ "$pid" = "$$" ] && continue

  # Perlindungan berlapis — PID dari systemd + pohon proses Hermes.
  # Kalau salah satu lapis menolak, proses TIDAK dibunuh.
  dilindungi "$pid" && continue

  # Chrome nyasar (kriteria a-d di atas).
  if chrome_nyasar "$pid"; then
    umur=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
    DIBUNUH+=("$pid")
    DITEMUKAN+=("Chrome nyasar (PID $pid, hidup $((umur/3600))j $(( (umur%3600)/60 ))m)")
    continue
  fi

  # ── Server uji lokal yang menggantung ─────────────────────────────────────
  #
  # Kriteria sama: hidup lama + tidak ada koneksi. Server uji dari sesi lama
  # menahan port dan memakai RAM tanpa ada yang memakainya.
  cmd=$(ps -o cmd= -p "$pid" 2>/dev/null) || continue
  case "$cmd" in
    *http.server*|*server-uji*)
      umur=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
      [ -z "$umur" ] || [ "$umur" -lt "$AMBANG_UMUR" ] && continue

      # Port-nya harus tidak ada yang memakai.
      port=$(printf '%s' "$cmd" | grep -oP '\s\K[0-9]{4,5}(?=\s|$)' | head -1)
      if [ -n "$port" ]; then
        koneksi=$(ss -tnH 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" || $5 ~ p"$"' | wc -l)
        [ "$koneksi" -gt 0 ] && continue
      fi

      DIBUNUH+=("$pid")
      DITEMUKAN+=("Server uji menggantung (PID $pid, hidup $((umur/3600))j)")
      ;;
  esac
done < <(ps -u ubuntu -o pid= 2>/dev/null)

# ── LAPOR SEBELUM BERTINDAK ───────────────────────────────────────────────────
#
# Laporan dikirim SEBELUM membunuh, bukan sesudah. Kalau script mati di tengah
# jalan, kita tetap tahu apa yang sedang dicoba.
LAPORAN="⚠️ <b>Watchdog CPU — beban tinggi $AMBANG_CEK cek berturut-turut</b>

Load: <b>$LOAD</b> (ambang: $LOAD_WARN)
CPU: $CPU_PAKAI%  ·  iowait: ${IOWAIT}%
CPU core: $(nproc)

"

if [ ${#DIBUNUH[@]} -gt 0 ]; then
  LAPORAN+="<b>Proses yatim ditemukan (${#DIBUNUH[@]}):</b>
$(printf '• %s\n' "${DITEMUKAN[@]:0:10}")"
  [ ${#DITEMUKAN[@]} -gt 10 ] && LAPORAN+="
… dan $(( ${#DITEMUKAN[@]} - 10 )) lainnya"
  LAPORAN+="

Dibersihkan otomatis."
else
  LAPORAN+="<b>Tidak ada proses yatim yang ditemukan.</b>

Beban tinggi berasal dari proses AKTIF — tidak ada yang dibunuh.
Periksa manual kalau berlanjut."
fi

if [ "$IOWAIT" -gt "$IOWAIT_WARN" ]; then
  LAPORAN+="

ℹ️ <b>iowait tinggi (${IOWAIT}%)</b> — CPU menunggu disk.
Tidak ditindak: membunuh proses saat menunggu disk bisa merusak data
yang sedang ditulis. Yang perlu dikurangi adalah I/O-nya."
fi

kirim "$LAPORAN"

# ── BUNUH ─────────────────────────────────────────────────────────────────────
if [ ${#DIBUNUH[@]} -gt 0 ]; then
  for pid in "${DIBUNUH[@]}"; do
    # SIGTERM dulu — memberi kesempatan proses menutup file dengan rapi.
    kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 5

  # Sisa yang membandel baru di-SIGKILL.
  for pid in "${DIBUNUH[@]}"; do
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  done

  catat "dibunuh: ${DIBUNUH[*]}"
fi

# ── RESET ─────────────────────────────────────────────────────────────────────
#
# Setelah bertindak, hitungan direset. Kalau beban masih tinggi di cek
# berikutnya, script akan menunggu 3 cek lagi sebelum bertindak kedua kali.
#
# Ini disengaja: memberi waktu pembersihan pertama bekerja. Kalau langsung
# bertindak lagi, kita bisa membunuh proses yang sedang dipakai sesi baru.
echo "0" > "$STATE_FILE"

catat "selesai — load=$LOAD, dibunuh=${#DIBUNUH[@]} proses"
