#!/usr/bin/env python3
"""Peta serangan SSH — PNG langsung via matplotlib (tanpa konverter SVG).

Gambar peta dunia sederhana dari garis pantai koordinat + titik penyerang.
Tidak pakai basemap/tile (butuh internet + dependensi berat); garis pantai
digambar dari data koordinat kasar yang disematkan — cukup untuk konteks.
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json, os, collections

GEO = '/tmp/geo-all.json'
CACHE = '/tmp/geo-cache.json'
path = GEO if os.path.exists(GEO) else CACHE
data = json.load(open(path))

# ── Kumpulkan titik ────────────────────────────────────────────────────────
titik = []
negara = collections.Counter()
for ip, d in data.items():
    if d.get('status') != 'success': continue
    lat, lon = d.get('lat'), d.get('lon')
    if lat is None or lon is None: continue
    titik.append((lon, lat, d.get('country', '?'), d.get('city', ''),
                  (d.get('org') or d.get('isp') or '')[:35]))
    negara[d.get('country', '?')] += 1

print(f"Titik: {len(titik)} · Negara: {len(negara)}")

# ── Garis pantai kasar (benua utama, koordinat sederhana) ──────────────────
# Cukup untuk memberi konteks visual — bukan peta presisi.
BENUA = {
    'Amerika Utara': [(-168,66),(-140,70),(-100,72),(-80,68),(-60,50),(-70,42),
                      (-80,26),(-98,18),(-105,22),(-115,30),(-125,40),(-130,55),(-168,66)],
    'Amerika Selatan': [(-82,10),(-60,10),(-50,0),(-35,-6),(-40,-22),(-55,-35),
                        (-70,-52),(-75,-45),(-72,-18),(-80,-5),(-82,10)],
    'Eropa': [(-10,36),(0,44),(10,45),(20,40),(30,45),(40,48),(40,60),(30,70),
              (10,58),(0,50),(-10,36)],
    'Afrika': [(-18,16),(10,37),(32,31),(42,12),(50,0),(42,-16),(32,-26),(18,-34),
               (12,-18),(8,4),(-18,16)],
    'Asia': [(30,45),(60,45),(90,50),(120,45),(135,35),(120,20),(100,10),(80,8),
             (70,20),(55,25),(45,30),(30,45)],
    'Australia': [(114,-22),(130,-12),(142,-11),(153,-25),(146,-38),(130,-32),
                  (114,-22)],
}
def gambar_benua(ax, pts, nama):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ax.fill(xs, ys, color='#1e293b', edgecolor='#334155', linewidth=0.7, zorder=1)

# ── Figure ─────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(15, 8.2))
fig.patch.set_facecolor('#0d1117')
ax = fig.add_axes([0.02, 0.06, 0.72, 0.86])
ax.set_facecolor('#0d1117')

for nama, pts in BENUA.items():
    gambar_benua(ax, pts, nama)

# Grid
ax.set_xlim(-180, 180); ax.set_ylim(-60, 78)
ax.set_xticks(range(-180, 181, 30))
ax.set_yticks(range(-60, 79, 30))
ax.grid(True, color='#1f2937', linewidth=0.5, linestyle='-', alpha=0.6)
ax.tick_params(colors='#6b7280', labelsize=8)
for s in ax.spines.values(): s.set_color('#1f2937')
ax.axhline(0, color='#374151', linewidth=0.8, linestyle='--', alpha=0.5)

# ── Titik penyerang ────────────────────────────────────────────────────────
per_lokasi = collections.defaultdict(lambda: {'n': 0, 'c': '', 'ct': '', 'isp': ''})
for lon, lat, c, ct, isp in titik:
    k = (round(lat), round(lon))
    per_lokasi[k]['n'] += 1
    per_lokasi[k].update({'c': c, 'ct': ct, 'isp': isp})

maks = max(v['n'] for v in per_lokasi.values()) if per_lokasi else 1

for (lat, lon), info in sorted(per_lokasi.items(), key=lambda x: x[1]['n']):
    inten = info['n'] / maks
    if inten > 0.55:
        warna, size, alpha = '#ef4444', 300, 0.9
    elif inten > 0.28:
        warna, size, alpha = '#f59e0b', 130, 0.8
    else:
        warna, size, alpha = '#fbbf24', 45, 0.65
    ax.scatter(lon, lat, s=size, c=warna, alpha=alpha,
               edgecolors='white', linewidths=0.6, zorder=5)

# ── Judul ──────────────────────────────────────────────────────────────────
fig.text(0.5, 0.965, 'Peta Serangan SSH — Server portfolio-victer',
         ha='center', fontsize=17, fontweight='bold', color='#f3f4f6')
fig.text(0.5, 0.925, f'{len(titik)} IP penyerang dari {len(negara)} negara · '
         f'28 Sep – 6 Okt 2026 · semua diblokir fail2ban',
         ha='center', fontsize=11, color='#9ca3af')

# ── Legenda ────────────────────────────────────────────────────────────────
leg = [plt.scatter([], [], s=45, c='#fbbf24', alpha=0.65, edgecolors='white',
                   linewidths=0.6, label='1-2 IP'),
       plt.scatter([], [], s=130, c='#f59e0b', alpha=0.8, edgecolors='white',
                   linewidths=0.6, label='3-6 IP'),
       plt.scatter([], [], s=300, c='#ef4444', alpha=0.9, edgecolors='white',
                   linewidths=0.6, label='7+ IP (klaster botnet)')]
l = ax.legend(handles=leg, loc='lower left', fontsize=9, framealpha=0.85,
              facecolor='#111827', edgecolor='#374151', labelcolor='#d1d5db')
l.get_frame().set_linewidth(0.5)

# ── Top negara (kanan) ─────────────────────────────────────────────────────
ax2 = fig.add_axes([0.76, 0.10, 0.22, 0.76])
ax2.set_facecolor('#0d1117')
top = negara.most_common(14)
sisa_n = len(negara) - len(top)
sisa_ip = sum(c for _, c in negara.most_common()[len(top):])
labs = [n for n, _ in top][::-1]
vals = [v for _, v in top][::-1]
if sisa_n > 0:
    labs = [f'lainnya ({sisa_n} negara)'] + labs
    vals = [sisa_ip] + vals
warna_bar = ['#4b5563'] + ['#eab308'] * (len(labs)-1)
ax2.barh(range(len(labs)), vals, color=warna_bar, alpha=0.85,
         edgecolor='#374151', linewidth=0.5)
ax2.set_yticks(range(len(labs)))
ax2.set_yticklabels(labs, fontsize=8.5, color='#d1d5db')
ax2.set_title(f'Asal Negara — {len(negara)} negara', fontsize=11,
              fontweight='bold', color='#f3f4f6', pad=10)
ax2.set_xlabel('Jumlah IP', fontsize=9, color='#9ca3af')
ax2.tick_params(colors='#6b7280', labelsize=8)
ax2.grid(True, axis='x', color='#1f2937', linewidth=0.5, alpha=0.6)
for s in ax2.spines.values(): s.set_color('#1f2937')
for i, v in enumerate(vals):
    w = '#9ca3af' if i == 0 and sisa_n > 0 else '#eab308'
    ax2.text(v + max(vals)*0.02, i, str(v), va='center', fontsize=8, color=w)

out = '/home/ubuntu/peta-serangan.png'
fig.savefig(out, facecolor='#0d1117', bbox_inches='tight', dpi=110)
print(f"OK {out} ({os.path.getsize(out)//1024} KB)")

print()
print("TOP 14 NEGARA:")
for n, c in top:
    print(f"  {n:<22} {c:>4}  {'█' * min(35, c)}")
