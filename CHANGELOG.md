# Changelog

Semua perubahan penting pada proyek ini, dikelompokkan per tanggal.

Total 338 perubahan dari 340 commit (2026-10-01 → 2026-10-11).

> Berkas ini dibuat otomatis dari riwayat git: `node scripts/generate-changelog.mjs`

## 2026-10-11

### Fitur baru

- **docs**: Sidebar gaya Claude Code Docs — grup + item terbuka (`d19c464`)
- **docs**: Bilah fixed, pemilih bahasa, breadcrumb, menu titik tiga (`9943b47`)
- **docs**: Panel navigasi geser dari kiri (pola Claude/Stripe/Vercel) (`c54912b`)
- **keamanan**: Input kode 2FA jadi 6 kotak terpisah (pola korporasi) (`db009ca`)
- **metrik**: Sinkronisasi otomatis metrik proyek dari repo nyata (`777360b`)
- **email**: Tambah Resend sebagai penyedia kedua — bisa dipakai tanpa domain (`b50b92d`)
- **admin**: Tab Akun di panel admin — antrean penghapusan dengan tinjauan (`ed88243`)
- **pemulihan**: Akun masa tenggang bisa dipulihkan dari halaman masuk (`e29c7dd`)
- **akun**: Model korporat 3 tahap — nonaktif → persetujuan admin → hapus (`ec2c720`)
- **profil**: Zona Berbahaya — hapus akun dengan verifikasi kode email (`40ad968`)
- **profil**: Tab horizontal + tab Notifikasi baru (`146ea44`)
- **profil**: Sistem toast — notifikasi mengambang (`a48433a`)
- **profil**: Sistem reveal tiga-fase adaptasi HorizonX.so (`a1969b1`)

### Perbaikan

- **docs**: Navigasi mobile jadi tombol buka-tutup, bukan chip scroll (`58e9179`)
- **auth**: Widget Turnstile terpotong di ponsel ≤400px (`70f383e`)
- **metrik**: Bulatkan RAM ke 8 MB — cegah deploy palsu (`ca2d8ff`)
- **keamanan**: Restrukturisasi ikut HorizonX + perbaiki 3 bug hasil uji E2E (`88c9015`)
- **profil**: Tab Notifikasi jadi PREFERENSI, bukan daftar peristiwa (`3854d52`)
- **animasi**: Gate Cloudflare menahan reveal — 15 elemen tidak pernah muncul (`81a141f`)

### Data

- **proyek**: Perbarui WhatsApp Family Assistant dengan hasil produksi (`ae91e5c`)

## 2026-10-10

### Fitur baru

- **ops**: Watchdog CPU — bersihkan proses nyasar otomatis saat beban tinggi (`4cd6715`)
- **animasi**: Adaptasi teknik BlackRay.Studio ke sistem cinematic yang ada (`8457d5a`)
- **perangkat**: Deteksi perangkat pakai Client Hints, bukan User-Agent (`d65c11d`)
- **sesi**: Masking IP di server + endpoint admin dengan IP penuh (`46fbb1e`)
- **sesi**: Lokasi, jaringan, dan ikon per baris di kartu sesi (`ff99300`)
- **ikon**: Ganti 20 ikon hand-rolled dengan Phosphor resmi (`998cb7e`)
- **menu**: Ikon + badge pola ProfileDropdown, perbaiki celah [hidden] (`1cdfb29`)
- **profil**: Unggah foto profil ke Cloudflare R2 (`e78bdf0`)
- **sesi**: Rombak panel Sesi aktif mengikuti pola GitHub/Google (`96e29c8`)
- **sesi**: Tombol cabut sesi — instruksi tanpa aksi itu cacat (`c652eb9`)
- **profil**: 7 tab lengkap dengan data nyata dari database (`8c52729`)
- **profil**: Menu akun pindah ke grup terpisah + tab Pembayaran (`7cc9215`)

### Perbaikan

- **perangkat**: Sinyal layar menang saat platform bertentangan (`2cd54cd`)
- **sesi**: Nama ISP, deteksi perangkat di OAuth, badge terpotong (`0e14976`)
- **oauth**: Perbaiki "kesalahan_internal" — body is not defined (`8748ff4`)
- **sesi**: Format masker IP — jumlah titik mengikuti jumlah digit (`7a32edd`)
- **header**: Foto profil muncul di menu akun semua halaman (`4491639`)
- **ci**: Catat sharp + npm ci — uji gambar tidak lagi di-skip diam-diam (`70f403d`)
- **tautan**: "Kontak" di halaman auth menuju anchor yang tidak ada (`fc84ffe`)
- **ci**: Check discovery berhenti jadi bom waktu harian (`d021efe`)
- **nav**: Tautan "Cara masuk" mendarat di tab yang salah (`979bee6`)
- **discovery**: Sinkronkan sitemap/llms dengan generator (`f7f12e1`)
- **tombol**: Kontras tombol aksi-merusak — 3.70:1 → 6.98:1 (`1bdcc20`)

### Performa

- **build**: Minifikasi JS — 619 KB → 251 KB (hemat 59%) (`d8210eb`)

### Dokumentasi

- **animasi**: Analisis mekanisme BlackRay.Studio + demo replikasi (`bef27d8`)
- **shadcn**: Status integrasi + panduan setup komponen React (`67b13dc`)

### Pemeliharaan

- Hapus log pelacak sementara dari /api/auth/masuk (`767f2d7`)
- Log sementara lacak perangkat di /api/auth/masuk (`55a9a7a`)
- **auth**: Tinggi kontrol seragam 44px + kartu dipadatkan (`6f73fb0`)
- Buang berkas yang tidak dipakai — s.bin dan .bak uji lama (`37eb3f0`)

## 2026-10-09

### Fitur baru

- **profil**: Field Organisasi + waktu masuk terakhir (`f951dc6`)
- **profil**: Kartu identitas dengan avatar — pola settings GitHub/Vercel (`4855246`)
- **docs**: Daftar isi jadi accordion — pola dokumentasi Stripe/Vercel/Linear (`49074f5`)
- **profil**: Tata letak sidebar + panel dari komponen Settings Card (`41686f2`)
- **footer**: Footer 4 kolom — struktur dari komponen shadcn, data VIVASTIC (`ca018e1`)
- **profil**: Halaman profil bergaya Stripe — bisa diedit, bukan hanya dibaca (`5689294`)
- **auth**: Sign-up beri jalan keluar saat email sudah terdaftar + 2 pengaman build (`048dc55`)
- **auth**: Sign-in beri peringatan jelas saat akun tidak ditemukan (`bbc5d5b`)
- **auth**: Halaman daftar dapat tombol provider — sama seperti halaman masuk (`0c36f64`)
- **auth**: Tambah LinkedIn + kisi tombol provider jadi fleksibel (`5c0d56e`)
- **auth**: Sembunyikan tombol Apple yang belum dikonfigurasi (`e31c9ac`)
- **sso**: Dukungan SSO di skrip pemasang kredensial (`0457aaa`)

### Perbaikan

- **kontak**: Pupil Saweria presisi — oval vertikal + offset ke dalam (`6d86867`)
- **kontak**: Pupil mata Saweria — hilangkan kesan seram (`8c23693`)
- **kontak**: Logo Saweria dengan detail wajah lengkap (`24d3dc9`)
- **kontak**: Logo Saweria dari sticker resmi + haluskan tepi (`df10e23`)
- **kontak**: Logo merek resmi untuk Ko-fi & Saweria, bukan ikon karangan (`13663ef`)
- **gate**: Pengguna yang sudah login tidak perlu verifikasi Turnstile lagi (`671f028`)
- **auth**: Teks halaman daftar akurat — akun aktif seketika, bukan ditinjau manual (`d548b2d`)
- **auth**: Halaman meluber saat widget Turnstile dimuat — penyebab "miring" (`cc9204a`)
- **auth**: Widget Turnstile sejajar dengan kolom form (`0855bbd`)
- **auth**: Tombol sign in/up tidak lagi dikunci frontend — verifikasi di backend (`bb46cd4`)
- **build**: CSS hilang di sign-in — verifikasi build buta + `hidden` dikalahkan `display:grid` (`82b72aa`)
- **auth**: Ikon passkey hilang saat diklik + ikon diganti versi FIDO (`89602a8`)
- **auth**: FRAME_ACUAN tidak pernah dideklarasikan — animasi kartu mati total (`f0bf348`)

### Dokumentasi

- LinkedIn — status + cara mengaktifkan (self-serve, tanpa review) (`01b4ad7`)
- **auth**: Status provider + keputusan tidak memakai Apple (`7e59e26`)
- **sso**: Panduan Cloudflare Access lengkap dari pengalaman pemasangan (`0b86648`)

### Pemeliharaan

- **profil**: Hapus field organisasi + bersihkan pola "AI slop" (`b243ec1`)
- **apple**: Hapus IdP Apple tiruan dan seluruh jejaknya (`f2ae1f3`)
- **apple**: IdP tiruan + uji alur Apple lengkap (20/20 lulus) (`7a182b9`)
- **auth**: Ikon SSO dibedakan dari ikon kolom sandi — gembok → gedung (`1347088`)
- **auth**: Ikon passkey jadi kunci saja (Phosphor Key) (`b100b2a`)
- **auth**: Checkbox profesional + simpan metode login + lihat profil tersimpan (`6c75edf`)
- **auth**: Checkbox "Ingat email" + ikon gembok SSO — mengikuti Cloudflare (`9d048f6`)
- **auth**: Tombol SSO jadi "Masuk dengan SSO" — tanpa nama vendor (`7426e2f`)

## 2026-10-08

### Fitur baru

- **sso**: SSO perusahaan lewat OIDC generik — berfungsi untuk semua IdP (`cd926ab`)
- **avatar**: Avatar pengguna dibuat di edge — tanpa backend, tanpa penyimpanan (`3bf688b`)
- **auth**: Tangani kode galat OAuth + skrip pemasang kredensial (`a954323`)
- **keamanan**: Halaman keamanan akun — daftar cara masuk, tambah/hapus passkey (`de3dba8`)
- **auth**: Backend OAuth (Google/Microsoft/Apple/GitHub), passkey, SSO (`9677acf`)
- **auth**: Ikon di semua field, passkey jadi kunci, footer tiga lapis (`4dcfcfa`)
- **auth**: Satu logo, bahasa korporat, animasi mata, hapus field perusahaan (`ad74b15`)
- **auth**: Hapus placeholder + panduan login di docs (`62c1265`)
- **brand**: Logo dari icon Vic's Private HQ + favicon + perbaikan kolom auth (`2a32c32`)
- **brand**: Monogram VIVASTIC + latar grid teknis, ganti logo { } dan partikel (`675d91c`)
- **auth**: Halaman sign-in profesional + SSO/identitas mengikuti pola korporat (`bda5a6d`)
- **logo**: Logo interaktif { } di semua halaman + perbaiki kedipan idle (`2276916`)
- **pricing**: Gerbang verifikasi + tautan Harga di navigasi (`be2cde1`)
- **legal**: Halaman Kebijakan Privasi & Syarat Ketentuan + rebrand ke Vivastic (`fa370c1`)
- **pembayaran**: Pindah ke Midtrans — modal KTP, tanpa PT (`c1b2651`)
- **pembayaran**: Skrip setup kredensial Xendit — input tersembunyi (`2025418`)
- **pembayaran**: Integrasi Xendit — langganan berbayar (`f7f0327`)
- **pricing**: Glow berputar saat kartu dipilih + kesejajaran grid (`740a52e`)
- **pricing**: Diskon per periode — Bulanan 20%, Tahunan 25% (`d6c0ebd`)
- **pricing**: Halaman harga dengan data dari backend + skeleton (`63e8b65`)

### Perbaikan

- **perf**: Total-bytes menghitung CSS dua kali — preflight memblokir deploy (`2d34ea1`)
- **microsoft**: Email akun kerja tidak terbaca + uji tidak rapuh (`93e6e37`)
- **oauth**: Worker menelan redirect OAuth — login GitHub tidak bisa dipakai (`0eb412e`)
- **auth**: Passkey & SSO dipindah ke bawah, ritme jarak diseragamkan (`00bf3e6`)
- **auth**: Pulihkan form sign-up yang rusak + bersihkan hint + legal footer (`ffc49d4`)
- **legal**: Hapus aturan _redirects yang menyebabkan loop tak berujung (`ec4301b`)
- **pricing**: Harga sejajar, tombol seragam, glow mulus (`48a22e4`)
- **pricing**: Kesejajaran kartu di KEDUA mode periode (`c9f90f6`)

### Pemeliharaan

- **auth**: Subjudul disederhanakan jadi pola korporat (`e2d48f5`)
- **anti-slop**: Bersihkan em dash dari data harga di backend (`a403ec4`)
- **anti-slop**: Hapus em dash & gradient tombol sesuai audit referensi (`fc20f51`)
- A11y(auth): naikkan kontras ikon mata dari 4.09:1 ke 7.72:1 (`886e874`)
- **auth**: Ikon mata pakai path resmi Lucide (eye + eye-off) (`807fc25`)
- **auth**: Ikon kolom sandi jadi GEMBOK, ikon mata tetap di kanan (`2890f05`)
- **brand**: VIVASTIC huruf kapital semua + letter-spacing disesuaikan (`25bb7e1`)
- **pricing**: Hapus badge "HARGA" di atas judul (`f834a80`)
- **pricing**: Bahasa korporasi untuk fitur "mencakup paket lain" (`b7706fc`)
- **pricing**: Tipografi harga korporat — diperkecil, bobot turun, angka seragam (`200818c`)

## 2026-10-07

### Fitur baru

- **auth**: 7 endpoint 2FA + integrasi gerbang login (`8e86871`)
- **auth**: 2FA end-to-end — enrollment, verifikasi, kode pemulihan (`5cf13cd`)
- **auth**: Modul TOTP — RFC 6238 dari nol, nol dependensi (`b51121d`)
- **auth**: Halaman masuk premium — 3D tilt, blob, partikel, TOTP, passkey (`ddd4239`)

### Perbaikan

- **auth**: Animasi berbasis WAKTU, bukan frame — konsisten di semua perangkat (`7e593ca`)
- **build**: Minifikasi HTML — selesaikan pelanggaran anggaran 90 KB (`f4d0ebc`)

## 2026-10-06

### Fitur baru

- **security**: Script analisis lengkap + catatan sudo (`4df61a9`)
- **security**: Rating keamanan komposit + kartu visual (`10db8ef`)
- **security**: Analisis tren, peta geografis, alert lonjakan otomatis (`6446aaa`)
- **ops**: Pemantauan uptime ringan via systemd timer (`06b5c34`)
- **gate**: Clearance ke cookie HttpOnly bertanda tangan server (`a049401`)
- **gate**: Sembunyikan widget Turnstile — spinner -> Berhasil saja (`f6c723b`)
- **gate**: Font stack asli Cloudflare + teks peringatan 'verifikasi lama' 37 bahasa (`a75a493`)
- **gate**: Tenggang 15 menit + gate di docs.html & 404.html (`7d54d74`)
- **gate**: Masa tenggang 3 menit + perbaiki loop 'Berhasil!' yang stuck (`b03d8ed`)
- **media**: Holding state premium + live update dari R2 (`404b344`)
- **media**: LQIP di manifest publik + dimensi gambar (`da4d419`)
- **media**: Gambar galeri dari R2 + skeleton + ikon korporat (`7ef319a`)
- **spotlight**: Mobile setara desktop + rotasi pelukan (`5c70c75`)
- **spotlight**: Efek "napas" — kartu menyusut saat meluncur, mengembang saat mendarat (`09d5509`)
- **spotlight**: Auto-scroll slide + jeda (varian A, dipilih pemilik) (`af4a895`)
- **spotlight**: Ganti cover-flow ke center-mode scale (pola Slick center) (`dbb618f`)
- **spotlight**: Spring physics, hapus petunjuk & tombol, perbaiki lompatan (`ad56b06`)
- **spotlight**: Hapus semua angka + drift kontinu (auto-scroll mulus) (`fdeb6b1`)
- **spotlight**: Hapus angka, auto-scroll, transisi melayang (`9adb9d0`)
- **spotlight**: Ganti visual generate dengan foto Unsplash + color grading (`9556c62`)
- **spotlight**: Carousel jadi galeri komersial — visual, glow, aksesibilitas (`195d435`)
- **premium**: Akses repo lewat undangan — token jadi kunci nyata (`0a598e2`)
- **premium**: Repo privat — token jadi kunci akses kode, bukan sekadar tulisan (`0c93fd3`)
- **ui**: Carousel spotlight — galeri proyek dengan kartu melengkung (`ba80d75`)
- **portfolio**: Terapkan temuan Luna + Opus + panduan desain Anthropic (`5596035`)

### Perbaikan

- **report**: Konversi semua waktu UTC → WIB (UTC+7) (`0eb4a1f`)
- **cookie**: 'Terima semua' tidak mencentang toggle analitik (`a264d95`)
- **gate**: Clearance pakai nonce, bukan IP — IP binding tidak andal di rantai 4 hop (`39a49b9`)
- **gate**: Sembunyikan widget saat timeout + tutup celah ruang kosong (`68a628b`)
- **build**: Ringkas komentar HTML — preflight sempat gagal di batas 90 KB (`cda9d85`)
- **gate**: Turnstile tidak lagi menggantung — timeout token + tombol coba lagi (`f69302e`)
- **media**: Elemen media SELALU dibuat, bukan hanya kalau ada gambar (`094a773`)
- **media**: Proxy pakai Pages Function, bukan _redirects (`be9ecd8`)
- **media**: Proxy /api dan /media lewat Pages _redirects (`814d612`)
- **spotlight**: Hilangkan double-animation gambar — akar glitch yang tersisa (`bb874e4`)
- **spotlight**: Glitch saat mantul — susut dihitung dari energi pegas, bukan kecepatan (`b26e2f5`)
- **spotlight**: Glitching — bayangan terpotong, tepi bergerigi, kedutan bayangan (`000284f`)
- **spotlight**: Arah drag terbalik + 4 bug posisi yang ditemukan berantai (`d279f9d`)
- **spotlight**: Auto-scroll belum slick — lompatan 441px tiap ganti kartu (`d5d8c02`)
- **premium**: Isi email tombol undangan + jangan render tombol mati (`d98bdd3`)
- **gate**: Footer Ray ID terpotong di layar pendek (`fb726fc`)

### Performa

- **spotlight**: Hilangkan sisa glitch — hysteresis, z-index halus, layer GPU tetap (`b755b91`)
- **spotlight**: Optimasi bayangan berjenjang + hemat decode video (`5ec86b2`)
- **build**: Minifikasi CSS 53% — hemat 65 KB, sumber tetap terbaca (`2a8f5f8`)

### Dokumentasi

- **gate**: Perbaiki komentar yang tidak akurat soal X-Client-IP (`7d457ce`)

### Pemeliharaan

- **discovery**: Perbarui lastmod sitemap ke 2026-10-06 (`e82001f`)

## 2026-10-05

### Fitur baru

- **portfolio**: Video narasi di bagian publik + font halaman proyek (`a4cf8c5`)
- **design**: Aksen kuning premium #f5c542 — ganti oranye, plus i18n gate (`8cd243f`)
- **design**: Tipografi + transisi — Satoshi/Playfair & easeOutQuart (`544650f`)
- **design**: Artefak proyek + ritme galeri — PRD UI/UX dari GPT-6 Luna (`a97c670`)
- **design**: Sampul proyek 3D — screenshot UI asli MINA (`86971b1`)
- **content**: Prinsip kerja — dari manifesto teknis ke cara kerja dengan klien (`5df4323`)
- **design**: Kartu Layanan — ikon + tata letak diukur, CSS di bawah anggaran (`d2b8dd9`)
- **design**: Batch 3 — nav aktif (P1-6) + audit gerak nyata (`2aa101c`)

### Perbaikan

- **design**: Grid prinsip 2x2 + teks kartu rata (diukur) (`7e2aaf7`)
- **design**: Scroll-spy — pilih section yang mengandung garis aktif (`ecad14b`)
- **design**: Jarak docs mobile 103px -> 63px (media query bertabrakan) (`4ff2cd9`)
- **a11y**: Target sentuh 44px di SEMUA viewport (WCAG 2.5.5) (`c705396`)
- **design**: Batch 1 — header proyek + 5 perbaikan desain dari audit Luna (`c1b3c1c`)
- **security**: FIX-08 Turnstile fail-closed + validasi hostname/action (`03b36cd`)
- **security**: FIX-07 perbandingan kunci admin yang benar (`bbb92ca`)
- **security**: FIX-06 rate limit default + cache /api/ready + tutup kebocoran path (`0864292`)
- **security**: FIX-05 normalisasi IP + hapus fallback X-Forwarded-For (`523f7f0`)
- **security**: FIX-04 jangan bocorkan pesan error internal (`bdbc1e3`)
- **security**: FIX-03 batasi /api/admin/* ke loopback (`c04d61b`)
- **security**: FIX-02 router aman terhadap decode & path traversal (`559773d`)
- **security**: FIX-01 proses tidak mati karena satu request (`555576e`)

### Performa

- **a11y**: Batch 2 — motion tokens + prefers-reduced-motion menyeluruh (`1423d99`)
- A4 + A6 — index filter audit + rate limiter tahan serangan (`d7e8502`)
- A1 — agregasi heartbeat SLA per menit (6,4:1 kompresi) (`1824d9d`)
- A5 + A3 + E — konkurensi SQLite, retensi, metrik event loop (`92e424d`)

### Dokumentasi

- Perbandingan desain dengan referensi Kombai Gallery (`32bb281`)
- PRD perbaikan desain dari audit GPT-6 Luna (`ae54d3d`)
- Audit kesiapan skala enterprise (Opus 5.5) (`a2f9cc3`)
- FIX-09 selesai — verifikasi IP audit + ringkasan 9 FIX (`e59c25b`)
- Siapkan migrasi domain victer.is-a.dev (menunggu PR merge) (`a80a421`)
- PRD perbaikan keamanan dari 8 temuan audit (9 FIX) (`4631cde`)
- Audit keamanan oleh Opus 5.5 (8 temuan) (`8be7278`)
- PRD pembagian peran model AI (penalaran vs eksekusi) (`196835d`)

### Pemeliharaan

- **design**: Hapus sampul proyek — penilaian visual dari pemilik (`d6b2d79`)
- A7 + A8 — backup off-site terenkripsi + moderasi komentar (`2e1052b`)
- Perbarui tanggal lastmod sitemap (5 Okt) (`886b67d`)

## 2026-10-04

### Fitur baru

- **ui**: Efek gelombang saat tekan tombol + tombol kaca transparan (`296202b`)
- **cookies**: Bilah memanjang penuh + animasi lebih responsif (`2f060df`)
- **cookies**: Banner persetujuan cookie dua lapis (`0009791`)
- **admin**: Skeleton penahan tata letak untuk semua panel (`dd68abf`)
- **docs**: Halaman panduan penggunaan publik ala dokumentasi korporat (`7c99a14`)
- **production**: Health jujur + rotasi log + dokumentasi API + CI (`b94876e`)
- **admin**: Pilih proyek bebas + multi-proyek per token (`33452ea`)
- **tools**: Skrip satu-perintah untuk buka panel admin (`99684fd`)
- **tools**: Diagnostik akses panel admin (`7c19f16`)
- **admin**: Panel admin lengkap — 11 tab termasuk 8 modul Framer (`6fa7c50`)
- **video**: Seamless loop sungguhan — crossfade tail→head (`71e9990`)
- **framer-grade**: 8 modul produksi — CMS, Performance, Collaborate, Grow, SEO, AEO, Convert, Publish (`c5aed5c`)
- **video**: Seamless loop optimization - zero gap (`7659e54`)
- **phase3**: Particles Three.js + custom video player + masonry (`16f014c`)
- **phase2**: Horizontal scroll + orb menu + variable weight (`f11bb18`)
- **phase1**: Film grain + wave reveal + magnetic cards (`2f00cb2`)
- **editorial**: Sentuhan exclusive portfolio — nomor section, rail navigasi, marquee (`ac96e23`)

### Perbaikan

- **ripple**: Gelombang tidak terlihat + tidak ada di menu navigasi (`0ad6a7a`)
- **nav**: Tautan menu tidak bisa disentuh — scrim menutupi panel (`a9c29c9`)
- **ui**: Logo & menu identik di kedua halaman, hapus tombol Hubungi (`11e67e7`)
- **docs**: Background video + header identik home + menu mobile rapi (`59f2802`)
- **test**: Hilangkan flaky test jendela waktu — pakai margin lebar (`af69f88`)
- **test**: Hapus flaky test — jendela waktu 1ms tidak andal di CI (`1d47340`)
- **backend**: Urutan query tidak deterministik — temuan CI (`8e6e3d5`)
- **admin**: Filter tidak berfungsi — bug argumen url di wrapper safe() (`160887c`)
- **admin**: Tombol Muat ulang — feedback visual + error tidak lagi ditelan (`9ba5a40`)
- **admin**: Responsif di HP — mode kartu, tidak perlu scroll samping (`2058278`)
- **server**: Listen di IPv4 + IPv6 — perbaiki SSH tunnel 'localhost' (`68d0e95`)
- **backend**: Root situs benar + pemindaian rahasia tanpa false positive (`dfddff9`)
- Disable particles, restore video background (`65b7380`)
- **wave-reveal**: Threshold 0.1 + 3s fallback untuk mobile (`b7ff25d`)

### Performa

- **video**: Hapus HEAD probe, pakai native <source> fallback (`f7bc744`)
- **corporate**: Optimasi fase 1-3 untuk production (`f28d352`)

### Pemeliharaan

- **ui**: Hilangkan semua emoji — ganti dengan ikon SVG + samakan UI docs (`d822467`)
- **ci**: Update actions ke v5 — hilangkan peringatan deprecation (`ce0b118`)
- **admin**: Audit menyeluruh panel admin — 8 area diperiksa (`06955df`)
- **admin**: Perbaiki layout modal terhimpit — spacing lega & grid rata (`054212d`)
- **admin**: Modal pencabutan token profesional (`632f688`)
- **admin**: Rapikan UI modal — minimalis, standar korporat (`8c0bff5`)
- **scripts**: Add production debug + screenshot tools (`9485d83`)

## 2026-10-03

### Fitur baru

- **production**: SEO production + uptime monitoring (PRD §8) (`e713ce9`)
- **3d**: Efek depth tingkat Framer/Awwwards — scroll-stand, tilt berlapis, glare, spotlight (`5b6714c`)
- **design**: Hero standar Framer/Dribbble — bukti visual + nav CTA + scroll progress (`14aea95`)
- **ops**: Backup harian database token (PRD §8) + dokumentasi (`5458430`)
- **form**: Standar korporat — bintang wajib, validasi spesifik, opsi budget/urgensi rapi (`9190b38`)
- **security**: Gerbang Turnstile untuk token akses + form permintaan (`1fbdfff`)
- **gate**: Interstitial Cloudflare persis (interaction-only) + halaman utama pulih (`41d05a0`)
- **gate**: Style profesional mirip kofi.com / Cloudflare (`44d7b3b`)
- **security**: Turnstile gate untuk semua halaman (`dff62a3`)
- **turnstile**: Production setup dengan Cloudflare MCP (`4d4e571`)
- **domain**: Setup custom domain options (`f8e6080`)
- **cloudflare**: Full edge deployment — Pages + Workers + R2 (`1724ccb`)
- **cloudflare**: Setup lengkap — deploy script + dokumentasi (`10718ae`)
- **cloudflare**: Deploy Worker live ke edge (`2b3d504`)
- **cloudflare**: Setup profesional — wrangler, cf CLI, workers, config (`3ef821a`)
- Cloudflare Turnstile — CAPTCHA tanpa geser (`815ab13`)
- **v2.5**: Anti-spam form (Q3) + persetujuan syarat akses (Q5) (`2b9caa7`)
- Anchor ter-obfuscate + kode proyek 12 karakter dengan sistem alias (`12bf763`)
- URL berkode acak /s/<kode>/ — pola Notion, Figma, Linear (`89e24c8`)
- File standar korporat — manifest, 404, README (`01f7ddb`)
- Teknik premium dari Linear, Vercel, Stripe (`2fcd3d1`)
- Logo dalam TILE SERAGAM — gaya skill-icons (standar industri) (`30d0c22`)
- Logo resmi FULL-COLOR dari koleksi Iconify logos: (`5d8ad05`)
- Ganti dengan logo RESMI dari Simple Icons (`ce9ce3a`)
- Logo teknologi interaktif — gambar asli, bukan teks pill (`0fa8161`)
- Logo interaktif coding — kurung { } yang bisa digerakkan user (`23f9ba2`)
- Restrukturisasi landing page jadi standar portfolio (`21d096b`)

### Perbaikan

- **depth**: Guard init ganda + jaring pengaman 6 detik (`bc2a3cf`)
- **form**: Minimum realistis nama/perusahaan + pesan token kosong kustom (`1abc91e`)
- **gate**: Kunci tombol lagi setelah logout + cache bump v9 (`928da50`)
- **turnstile**: Production-ready, hapus banner testing (`32cd8d6`)
- **turnstile**: Widget render otomatis saat form dibuka (`1c60ef6`)
- Panah link hilang + grid highlight belum rata (`a7f184b`)
- Konflik CSS ::before/::after + grid highlight tidak rata (`2cb4ea4`)
- Tile warna SQL/Telegram/WhatsApp/n8n tidak muncul (`a83be08`)
- Tinggi visual logo SERAGAM + ikon SQL netral (`d3b7e14`)

### Dokumentasi

- **production**: Runbook production lengkap + PRD v3.0 (`8e278c4`)
- **gate**: Perbarui komentar agar konsisten dengan tombol 'Buka' (`e829e3e`)
- **turnstile**: Add production setup guide (`a0b4062`)
- Cara rotasi kode + peta anchor (`5e24880`)

### Pemeliharaan

- **cta**: 'Detail teknis' jadi tombol utama solid, repo sekunder (`b9c56a6`)
- **gate**: Tombol tetap 'Buka' saat terkunci + gaya disabled jelas (`05e1d80`)
- **gate**: Sembunyikan pesan sukses verifikasi di gerbang token (`097e96d`)
- **gate**: Widget Turnstile bahasa Indonesia + lebar wajar (`9b2c326`)
- Struktur korporat + URL bersih (`d832bc7`)
- Perbesar glyph systemd di tile (`3a525e2`)
- Ukuran logo seragam + ikon SQL generik (`00b7717`)
- Naikkan kontras logo sebelum hover (`22958ca`)
- Gabung semua logo jadi SATU panel tilt 3D (`7179783`)

## 2026-10-02

### Perbaikan

- Video hero kurang terlihat — naikkan opacity + text-shadow (`a67ab82`)
- Video hero tidak terlihat di HP — poster + retry autoplay (`eaea16b`)
- Video hero tidak terlihat di mobile (`e50eb0b`)
- Animasi mobile — judul hilang + threshold observer terlalu tinggi (`8c912ae`)
- Path video narasi pakai siteRoot (relatif dari modul, bukan halaman) (`097d111`)
- Cache bust project.js v=2 untuk tier badge + watermark (`783f95c`)
- Tambah mode:cors untuk cookie cross-origin (`e052fd6`)

### Dokumentasi

- Tandai v2.2 selesai di PRD roadmap (`d0770cf`)
- Tandai v1.2 selesai (hero video tanpa watermark) (`b96f46e`)
- Tandai v2.3-v2.4 selesai di PRD roadmap (`02c8d92`)
- Update OPERASIONAL.md — analytics, webhook, keamanan v2.6 (`015ea51`)
- Update OPERASIONAL.md untuk v2.1 (tier, session, watermark) (`f8f9311`)

### Pemeliharaan

- Kembalikan video hero ke opacity 0.55 (versi yang disukai pengguna) (`4921e5a`)
- V2.2: video narasi per proyek — dibuat programatik, tanpa AI, tanpa watermark (`2593090`)
- V2.2 design kit: video narasi portofolio (Figma + Seedance gratis) (`b32228c`)
- V2.9: cinematic scroll effects (teknik PRIOR, vanilla) (`9335b03`)
- V1.2: hero video final tanpa watermark (roadmap v1.2) (`bb16695`)
- V2.8: admin dashboard web (F28) (`251ffd9`)
- V2.7: enterprise package — SLA tracking + audit export + custom domain guide (F27) (`22183fb`)
- V2.6: security hardening — audit Fable 5.1 (`0bd6108`)
- V2.5: GPT Astra micro-interactions (F4) (`1f58c65`)
- V2.4: lead automation — webhook notifications (M4) (`a120777`)
- V2.3: analytics funnel (M3) (`18d4c35`)
- V2.2: device fingerprint detection (M2) (`fb0611a`)
- Ignore backend config dan test files (`32b02b0`)
- V2.1: token format VP-XXXX, tier system, session cookie, watermark, lead form lengkap (`90a0cb8`)

## 2026-10-01

### Dokumentasi

- Panduan operasional + README lapisan akses (`5991c8e`)

### Pemeliharaan

- PRD v2.0: tandai selesai + catatan implementasi (`b62b5b3`)
- Pratinjau terkunci tidak lagi membocorkan istilah internal (`1639038`)
- V2.0: sistem token akses proyek — backend, halaman terkunci, form sales (`bf289ba`)
- Perbarui alamat layanan token (`df07139`)
- Perbarui alamat layanan token (`0314d24`)
- PRD v2.0: arsitektur portofolio korporat dengan tokenized access, monetisasi sales, Seedance 2.5, GPT Astra, Fable 5.1 (`ddd4b8d`)
- V1.1-temp: turunkan opacity hero video ke 0.28 (watermark sementara) (`a7db6d8`)
- V1.1: tambah hero video (MP4 + WebM), update loader untuk multi-format, preload none (`c53e01b`)
- PRD v1.0: tujuan, non-goals, persyaratan, arsitektur, rencana rilis, 5 pertanyaan terbuka (`d103d40`)
- Portofolio awal: HTML/CSS/JS murni, data dari repo nyata, video latar opsional (`eeb33e0`)
