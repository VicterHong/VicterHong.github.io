#!/usr/bin/env python3
"""Grafik tren serangan SSH — profesional, dari fail2ban DB.

Menghasilkan PNG dengan 4 panel:
  1. Serangan per jam (24 jam) — kapan mereka menyerang
  2. Serangan per hari — tren jangka panjang
  3. Top 15 IP penyerang — siapa yang paling agresif
  4. Top 12 negara (kalau data geolokasi ada)
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import sqlite3, json, os, datetime, collections

plt.rcParams.update({
    'figure.dpi': 130,
    'font.size': 9,
    'axes.grid': True,
    'grid.alpha': 0.25,
    'grid.linestyle': '--',
    'axes.spines.top': False,
    'axes.spines.right': False,
    'figure.facecolor': 'white',
})

# ── Data ───────────────────────────────────────────────────────────────────
db = sqlite3.connect('/var/lib/fail2ban/fail2ban.sqlite3')
cur = db.cursor()
cur.execute("SELECT ip, timeofban, bancount FROM bans ORDER BY timeofban")
rows = cur.fetchall()
db.close()

per_jam = collections.Counter()
per_hari = collections.Counter()
per_ip = collections.Counter()
for ip, t, bc in rows:
    if not t: continue
    d = datetime.datetime.fromtimestamp(t)
    per_jam[d.hour] += 1
    per_hari[d.date()] += 1
    per_ip[ip] += bc

# Geolokasi (kalau sudah siap)
negara = collections.Counter()
geo_path = '/tmp/geo-all.json'
if os.path.exists(geo_path):
    try:
        geo = json.load(open(geo_path))
        for ip, d in geo.items():
            if d.get('status') == 'success' and d.get('country'):
                negara[d['country']] += 1
    except Exception:
        pass

# ── Figure ─────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(13, 9))
fig.suptitle('Analisis Serangan SSH — Server portfolio-victer\n'
             f'{len(rows)} ban · {len(per_ip)} IP unik · 28 Sep – 6 Okt 2026',
             fontsize=13, fontweight='bold', y=0.98)

GOLD = '#c9a227'
DARK = '#1a1a1a'
RED = '#c0392b'

# ── Panel 1: per jam ───────────────────────────────────────────────────────
ax1 = fig.add_subplot(2, 2, 1)
jam = [per_jam.get(h, 0) for h in range(24)]
maks_jam = max(jam)
warna = [RED if v == maks_jam else GOLD for v in jam]
ax1.bar(range(24), jam, color=warna, edgecolor=DARK, linewidth=0.4)
ax1.set_title('Aktivitas per Jam (UTC)', fontweight='bold', fontsize=10)
ax1.set_xlabel('Jam')
ax1.set_ylabel('Jumlah ban')
ax1.set_xticks(range(0, 24, 3))
ax1.axhline(sum(jam)/24, color=DARK, linestyle=':', linewidth=1, alpha=0.6)
ax1.text(0.5, maks_jam*0.95, f'rata-rata {sum(jam)/24:.1f}/jam',
         fontsize=7.5, style='italic', color=DARK)
# Tandai puncak
h_puncak = jam.index(maks_jam)
ax1.annotate(f'{maks_jam}', xy=(h_puncak, maks_jam), xytext=(h_puncak, maks_jam*1.06),
             ha='center', fontsize=8, fontweight='bold', color=RED)

# ── Panel 2: per hari ──────────────────────────────────────────────────────
ax2 = fig.add_subplot(2, 2, 2)
hari = sorted(per_hari.keys())
nilai = [per_hari[d] for d in hari]
ax2.plot(hari, nilai, marker='o', color=GOLD, linewidth=2.2,
         markersize=7, markerfacecolor=DARK, markeredgecolor=GOLD, markeredgewidth=1.5)
ax2.fill_between(hari, nilai, alpha=0.18, color=GOLD)
ax2.set_title('Tren Harian', fontweight='bold', fontsize=10)
ax2.set_ylabel('Jumlah ban')
ax2.xaxis.set_major_formatter(mdates.DateFormatter('%d %b'))
plt.setp(ax2.get_xticklabels(), rotation=30, ha='right')
rata = sum(nilai)/len(nilai)
ax2.axhline(rata, color=RED, linestyle='--', linewidth=1, alpha=0.7)
ax2.text(hari[0], rata*1.02, f'rata-rata {rata:.0f}/hari',
         fontsize=7.5, color=RED, style='italic')
# Label nilai
for d, v in zip(hari, nilai):
    ax2.annotate(str(v), (d, v), textcoords='offset points', xytext=(0, 7),
                 ha='center', fontsize=7)

# ── Panel 3: top IP ────────────────────────────────────────────────────────
ax3 = fig.add_subplot(2, 2, 3)
top_ip = per_ip.most_common(12)
labels = [ip for ip, _ in top_ip][::-1]
vals = [v for _, v in top_ip][::-1]
bars = ax3.barh(range(len(labels)), vals, color=GOLD, edgecolor=DARK, linewidth=0.4)
ax3.set_yticks(range(len(labels)))
ax3.set_yticklabels(labels, fontsize=7.5, family='monospace')
ax3.set_title('12 IP Paling Agresif', fontweight='bold', fontsize=10)
ax3.set_xlabel('Total percobaan gagal')
for i, v in enumerate(vals):
    ax3.text(v + max(vals)*0.015, i, str(v), va='center', fontsize=7.5, fontweight='bold')

# ── Panel 4: negara ────────────────────────────────────────────────────────
ax4 = fig.add_subplot(2, 2, 4)
if negara:
    top_neg = negara.most_common(10)
    labs = [n for n, _ in top_neg][::-1]
    vv = [v for _, v in top_neg][::-1]
    ax4.barh(range(len(labs)), vv, color=GOLD, edgecolor=DARK, linewidth=0.4)
    ax4.set_yticks(range(len(labs)))
    ax4.set_yticklabels(labs, fontsize=8)
    ax4.set_title(f'Asal Negara (dari {sum(negara.values())} IP terpetakan)',
                  fontweight='bold', fontsize=10)
    ax4.set_xlabel('Jumlah IP penyerang')
    for i, v in enumerate(vv):
        ax4.text(v + max(vv)*0.02, i, str(v), va='center', fontsize=7.5, fontweight='bold')
else:
    ax4.text(0.5, 0.5, 'Data geolokasi\nsedang dikumpulkan...',
             ha='center', va='center', fontsize=11, style='italic', color='#888')
    ax4.axis('off')

fig.tight_layout(rect=[0, 0, 1, 0.95])
out = '/home/ubuntu/tren-serangan-ssh.png'
fig.savefig(out, bbox_inches='tight', facecolor='white')
print(f"OK {out}")

# ── Ringkasan teks ─────────────────────────────────────────────────────────
print()
print("RINGKASAN:")
print(f"  total ban    : {len(rows)}")
print(f"  IP unik      : {len(per_ip)}")
print(f"  jam tersibuk : {h_puncak:02d}:00 UTC ({maks_jam} ban)")
print(f"  hari tersibuk: {max(per_hari, key=per_hari.get)} ({max(nilai)} ban)")
if negara:
    print(f"  negara teratas: {negara.most_common(3)}")
