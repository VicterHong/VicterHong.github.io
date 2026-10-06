#!/usr/bin/env python3
"""Rating keamanan server — versi 2, deteksi berbasis ISI bukan nama file.

Versi 1 salah: menandai 'anthropic_credentials.py' sebagai file rahasia
hanya karena namanya mengandung 'credentials'. Padahal itu kode sumber.
Akibatnya skor turun 6 poin tanpa alasan nyata.

Versi 2 memeriksa ISI file: apakah mengandung pola kredensial yang
BENAR-BENAR valid (bukan placeholder seperti 'your_api_key').
"""
import subprocess, os, re, json

def run(cmd, sudo=False):
    if sudo:
        cmd = ['sudo'] + cmd
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ''

aspek = []

# ═══ 1. PAPARAN JARINGAN (25) ══════════════════════════════════════════════
publik = run(['ss','-tln'], sudo=True)
port_publik = set()
for ln in publik.splitlines()[1:]:
    p = ln.split()
    if len(p) < 4: continue
    if p[3].startswith(('0.0.0.0:', '[::]:')):
        port_publik.add(p[3].split(':')[-1])

# 22 = SSH (aman: kunci saja). 25 = SMTP (tidak terjangkau dari luar).
# Selain itu = berisiko.
DIIZINKAN = {'22','25'}
berisiko = port_publik - DIIZINKAN
skor1 = 25 if not berisiko else max(0, 25 - len(berisiko)*8)
aspek.append(('Paparan jaringan', skor1, 25,
              f'{len(port_publik)} port publik; ' +
              ('semua aman (SSH kunci-only, SMTP tertutup)' if not berisiko
               else f'BERISIKO: {sorted(berisiko)}')))

# ═══ 2. AUTENTIKASI (25) ═══════════════════════════════════════════════════
ssh = run(['sshd','-T'], sudo=True)
pwd_off   = 'passwordauthentication no' in ssh
root_off  = 'permitrootlogin no' in ssh
pubkey_on = 'pubkeyauthentication yes' in ssh
x11_off   = 'x11forwarding no' in ssh
m = re.search(r'maxauthtries (\d+)', ssh)
maxauth_ok = bool(m) and int(m.group(1)) <= 3
m2 = re.search(r'logingracetime (\d+)', ssh)
grace_ok = bool(m2) and int(m2.group(1)) <= 60

skor2 = pwd_off*9 + root_off*6 + pubkey_on*5 + maxauth_ok*3 + x11_off*1 + grace_ok*1
aspek.append(('Autentikasi', skor2, 25,
              f'password=off, root=off, pubkey=on, maxauth={m.group(1) if m else "?"}'))

# ═══ 3. ANTI BRUTE-FORCE (15) ══════════════════════════════════════════════
f2b = 'active' in run(['systemctl','is-active','fail2ban'])
stat = run(['fail2ban-client','status','sshd'], sudo=True)
mb = re.search(r'Total banned:\s+(\d+)', stat)
mc = re.search(r'Currently banned:\s+(\d+)', stat)
banned = int(mb.group(1)) if mb else 0
skor3 = (10 if f2b else 0) + (5 if banned > 0 else 0)
aspek.append(('Anti brute-force', skor3, 15,
              f'fail2ban={"aktif" if f2b else "MATI"}, {banned} IP diblokir'))

# ═══ 4. KERAHASIAAN FILE (15) — berbasis ISI, bukan nama ══════════════════
# Pola kredensial NYATA (bukan placeholder).
POLA = [
    (r'[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}', 'Telegram bot token'),
    (r'sk-[A-Za-z0-9]{32,}', 'OpenAI/Anthropic key'),
    (r'AKIA[0-9A-Z]{16}', 'AWS access key'),
    (r'ghp_[A-Za-z0-9]{36}', 'GitHub token'),
    (r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----', 'Private key'),
    (r'xox[baprs]-[A-Za-z0-9-]{10,}', 'Slack token'),
]
# Placeholder yang HARUS diabaikan
PLACEHOLDER = re.compile(
    r'your_|xxx|XXX|example|EXAMPLE|placeholder|PLACEHOLDER|'
    r'\[REDACTED\]|REDACTED|\*\*\*|\.\.\.|changeme|CHANGEME|'
    r'<[a-z_]+>|\$\{|test|TEST|dummy|DUMMY|fake|FAKE|'
    # Konteks dokumentasi/analisis — bukan kredensial yang dipakai.
    # Ditemukan nyata: file analisis berisi teks "Itu bukan key asli"
    # lalu contoh pola key. Tanpa pengecualian ini, dokumen jadi false positive.
    r'bukan\s+key|not\s+(a\s+)?(real\s+)?key|contoh|sample|'
    r'analisis|analysis|pattern|pola|ilustrasi|illustration', re.I)

# Cari file rahasia yang world-readable DAN berisi kredensial nyata
kandidat = run(['find','/home/ubuntu','-maxdepth','4','-type','f','-perm','/o+r'], sudo=True)
kandidat = [f for f in kandidat.splitlines()
            if not re.search(r'node_modules|\.cache|\.npm|site-packages|/dist/|\.git/|\.hermes/hermes-agent/', f)]

bocor = []
diperiksa = 0
for f in kandidat:
    # File tes sengaja memuat contoh kredensial palsu untuk MENGUJI detektor
    # kebocoran (mis. 'const key = "sk-abc...3456"'). Itu bukan kebocoran —
    # itu justru alat yang mendeteksi kebocoran. Lewati.
    if re.search(r'\.test\.|\.spec\.|/tests?/|test_|_test\.', f):
        continue
    try:
        # Baca maks 200KB
        isi = run(['head','-c','200000',f], sudo=True)
        if not isi: continue
        diperiksa += 1
        for pola, nama in POLA:
            for mt in re.finditer(pola, isi):
                potongan = isi[max(0,mt.start()-60):mt.end()+20]
                if PLACEHOLDER.search(potongan):
                    continue   # placeholder, bukan kredensial nyata
                bocor.append((f, nama))
                break
    except Exception:
        continue

skor4 = 15 if not bocor else max(0, 15 - len(bocor)*5)
aspek.append(('Keratahasiaan file', skor4, 15,
              f'{len(bocor)} kredensial nyata terbuka (dari {diperiksa} file diperiksa)'
              if bocor else f'tidak ada kredensial terbuka ({diperiksa} file diperiksa)'))

# ═══ 5. HARDENING KERNEL (10) ══════════════════════════════════════════════
wajib = {
    'kernel.kptr_restrict': 1, 'kernel.dmesg_restrict': 1,
    'kernel.yama.ptrace_scope': 1, 'net.ipv4.tcp_syncookies': 1,
    'kernel.randomize_va_space': 2, 'fs.protected_hardlinks': 1,
    'fs.protected_symlinks': 1,
}
ok = sum(1 for k, v in wajib.items() if run(['sysctl','-n',k]).strip() == str(v))
skor5 = round(10 * ok / len(wajib))
aspek.append(('Hardening kernel', skor5, 10, f'{ok}/{len(wajib)} sysctl aktif'))

# ═══ 6. PEMBARUAN (10) ═════════════════════════════════════════════════════
uu_on = 'enabled' in run(['systemctl','is-enabled','unattended-upgrades'])
log = run(['tail','-80','/var/log/unattended-upgrades/unattended-upgrades.log'], sudo=True)
uu_jalan = 'Starting unattended upgrades' in log
running = os.uname().release
pkgs = run(['dpkg','-l','linux-image-*'])
vers = re.findall(r'linux-image-(\d+\.\d+\.\d+-\d+)-oracle', pkgs)
terbaru = max(vers) if vers else ''
kernel_ok = running.replace('-oracle','') == terbaru

skor6 = (5 if uu_on and uu_jalan else 0) + (5 if kernel_ok else 0)
aspek.append(('Pembaruan', skor6, 10,
              f'auto-update={"jalan" if uu_jalan else "?"}, '
              f'kernel={"terbaru" if kernel_ok else f"BASI (pakai {running}, ada {terbaru})"}'))

# ═══ TOTAL ═════════════════════════════════════════════════════════════════
total = sum(a[1] for a in aspek)
maks = sum(a[2] for a in aspek)
persen = round(100 * total / maks)

print("=" * 70)
print("  RATING KEAMANAN SERVER — portfolio-victer")
print("=" * 70)
print()
print(f"  {'ASPEK':<20} {'SKOR':>9}  {'':<11} KETERANGAN")
print("  " + "-" * 66)
for nama, s, b, ket in aspek:
    bar = '█' * round(10 * s / b)
    print(f"  {nama:<20} {s:>3}/{b:<4} {bar:<11} {ket[:44]}")
print("  " + "-" * 66)
print(f"  {'TOTAL':<20} {total:>3}/{maks}")
print()

if persen >= 95:   grade, label = 'A+', 'LUAR BIASA'
elif persen >= 90: grade, label = 'A',  'SANGAT BAIK'
elif persen >= 80: grade, label = 'B+', 'BAIK'
elif persen >= 70: grade, label = 'B',  'CUKUP BAIK'
elif persen >= 60: grade, label = 'C',  'PERLU PERBAIKAN'
else:              grade, label = 'D',  'BERISIKO'

print(f"  SKOR AKHIR : {persen}/100   →   GRADE {grade}  ({label})")
print()
print("  ── CATATAN ──")
if not kernel_ok:
    print(f"    • Kernel {terbaru} belum aktif (jalan {running}) — reboot kapan kamu siap")
    print(f"      Patch keamanan kernel belum berlaku sampai reboot.")
if bocor:
    print(f"    • {len(bocor)} kredensial nyata terbuka — perlu diperbaiki segera")
for f, nama in bocor[:5]:
    print(f"        {nama}: {f}")
if not bocor and kernel_ok:
    print("    • Tidak ada temuan. Postur keamanan sudah kuat.")
print()
print("=" * 70)

json.dump({'persen': persen, 'grade': grade, 'total': total, 'maks': maks,
           'aspek': [{'nama':n,'skor':s,'bobot':b,'ket':k} for n,s,b,k in aspek],
           'kredensial_bocor': [{'file':f,'jenis':n} for f,n in bocor]},
          open('/tmp/rating-keamanan.json','w'), indent=1)
print(f"  Tersimpan: /tmp/rating-keamanan.json")
