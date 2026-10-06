#!/usr/bin/env python3
"""Geolokasi semua IP penyerang — dengan cache agar bisa dilanjutkan.

Rate limit ip-api.com: 45 request/menit. 465 IP = ~10,5 menit.
Cache disimpan per-IP supaya kalau script dihentikan, tidak mengulang.
"""
import sqlite3, json, os, time, urllib.request, sys

CACHE = '/tmp/geo-cache.json'
OUT = '/tmp/geo-all.json'

# Muat cache
cache = {}
if os.path.exists(CACHE):
    try:
        cache = json.load(open(CACHE))
    except Exception:
        cache = {}

db = sqlite3.connect('/var/lib/fail2ban/fail2ban.sqlite3')
cur = db.cursor()
cur.execute("SELECT ip, SUM(bancount) FROM bans GROUP BY ip ORDER BY SUM(bancount) DESC")
ips = [(r[0], r[1]) for r in cur.fetchall()]
db.close()

print(f"Total IP: {len(ips)}")
print(f"Sudah di-cache: {len(cache)}")

hasil = {}
for i, (ip, tot) in enumerate(ips, 1):
    if ip in cache:
        hasil[ip] = cache[ip]
        continue
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,isp,org,as,lat,lon,proxy,hosting"
        with urllib.request.urlopen(url, timeout=8) as r:
            d = json.loads(r.read())
        hasil[ip] = d
        cache[ip] = d
    except Exception as e:
        hasil[ip] = {'status': 'fail', 'error': str(e)}
        cache[ip] = hasil[ip]

    # Simpan cache setiap 20 IP
    if i % 20 == 0:
        json.dump(cache, open(CACHE, 'w'))
        print(f"  {i}/{len(ips)} selesai...", flush=True)
    time.sleep(1.4)   # ~43 req/menit, di bawah batas 45

json.dump(cache, open(CACHE, 'w'))
json.dump(hasil, open(OUT, 'w'), indent=1)
print(f"SELESAI: {len(hasil)} IP dianalisis")
