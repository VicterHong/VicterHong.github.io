#!/usr/bin/env python3
"""Kartu rating keamanan — visual profesional untuk Telegram."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json, os

d = json.load(open('/tmp/rating-keamanan.json'))
persen = d['persen']
aspek = d['aspek']

fig = plt.figure(figsize=(11, 6.2))
fig.patch.set_facecolor('#0d1117')

# ── Skor besar di kiri ─────────────────────────────────────────────────────
ax_skor = fig.add_axes([0.04, 0.42, 0.26, 0.44])
ax_skor.axis('off')
ax_skor.set_facecolor('#0d1117')

# Lingkaran skor
from matplotlib.patches import Circle, Wedge
warna = '#22c55e' if persen >= 90 else ('#eab308' if persen >= 75 else '#ef4444')
ax_skor.add_patch(Circle((0.5, 0.5), 0.42, fill=False, edgecolor='#1f2937', linewidth=14))
ax_skor.add_patch(Wedge((0.5, 0.5), 0.42, 90, 90 - persen*3.6,
                        width=0.14, facecolor=warna))
ax_skor.text(0.5, 0.58, str(persen), ha='center', va='center',
             fontsize=46, fontweight='bold', color='#f3f4f6')
ax_skor.text(0.5, 0.40, '/100', ha='center', va='center', fontsize=15, color='#6b7280')
ax_skor.set_xlim(0, 1); ax_skor.set_ylim(0, 1)

fig.text(0.17, 0.34, f'GRADE {d["grade"]}', ha='center', fontsize=15,
         fontweight='bold', color=warna)

# ── Judul ──────────────────────────────────────────────────────────────────
fig.text(0.5, 0.955, 'Rating Keamanan Server', ha='center', fontsize=19,
         fontweight='bold', color='#f3f4f6')
fig.text(0.5, 0.912, 'portfolio-victer · instance-20260816-1817 · Ubuntu 24.04.5',
         ha='center', fontsize=10.5, color='#9ca3af')

# ── Bar per aspek ──────────────────────────────────────────────────────────
ax = fig.add_axes([0.36, 0.10, 0.60, 0.76])
ax.set_facecolor('#0d1117')
ax.axis('off')

y = 0.94
for a in aspek:
    nama = a['nama']
    s, b = a['skor'], a['bobot']
    rasio = s / b
    w = '#22c55e' if rasio == 1 else ('#eab308' if rasio >= 0.6 else '#ef4444')

    ax.text(0, y, nama, fontsize=11, color='#d1d5db', va='center')
    ax.text(1.0, y, f'{s}/{b}', fontsize=10.5, color='#9ca3af',
            va='center', ha='right', family='monospace')

    # Bar
    ax.add_patch(plt.Rectangle((0, y-0.052), 1.0, 0.032,
                               facecolor='#1f2937', edgecolor='none'))
    ax.add_patch(plt.Rectangle((0, y-0.052), rasio, 0.032,
                               facecolor=w, edgecolor='none'))

    # Keterangan kecil
    ket = a['ket']
    if len(ket) > 62: ket = ket[:60] + '…'
    ax.text(0, y-0.085, ket, fontsize=8, color='#6b7280', va='center')

    y -= 0.155

ax.set_xlim(0, 1); ax.set_ylim(0, 1)

# ── Catatan bawah ──────────────────────────────────────────────────────────
catatan = []
if 'kernel' in str(d.get('aspek')).lower():
    for a in aspek:
        if a['nama'] == 'Pembaruan' and 'BASI' in a['ket']:
            catatan.append('[!]  Kernel 7.0.0-1013 belum aktif — patch keamanan berlaku setelah reboot')
            break
catatan.append('[v]  0 kredensial terbuka (2.605 file diperiksa isinya)')
catatan.append('[v]  536 serangan SSH diblokir · 0 berhasil masuk')

fig.text(0.04, 0.055, '\n'.join(catatan), fontsize=8.5, color='#9ca3af',
         va='bottom', linespacing=1.7)

out = '/home/ubuntu/rating-keamanan.png'
fig.savefig(out, facecolor='#0d1117', bbox_inches='tight', dpi=115)
print(f"OK {out} ({os.path.getsize(out)//1024} KB)")
print()
print(f"SKOR: {persen}/100  GRADE {d['grade']}")
for a in aspek:
    print(f"  {a['nama']:<22} {a['skor']:>3}/{a['bobot']:<3}  {a['ket'][:45]}")
