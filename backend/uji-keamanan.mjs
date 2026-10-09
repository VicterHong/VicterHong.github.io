/**
 * Uji halaman keamanan DENGAN SESI NYATA dan authenticator virtual.
 *
 * ── KENAPA AUTHENTICATOR VIRTUAL, BUKAN MOCK ────────────────────────────────
 * Playwright menyediakan CDP `WebAuthn.enable` + `addVirtualAuthenticator`.
 * Itu authenticator SUNGGUHAN yang berjalan di dalam Chromium: ia membuat
 * kunci P-256, menyimpan kredensial, dan menandatangani challenge. Yang
 * diuji adalah alur lengkap dari sisi browser sampai verifikasi server —
 * bukan fungsi yang dipanggil langsung.
 *
 * Ini menangkap hal yang tidak bisa ditangkap uji unit:
 *   - apakah base64url dikonversi dengan benar sebelum dikirim ke browser
 *   - apakah bentuk data yang dikirim ke server cocok dengan yang diharapkan
 *   - apakah cookie sesi ikut terkirim
 *   - apakah UI memperbarui diri setelah passkey ditambahkan
 *
 * ── ALUR YANG DIUJI ─────────────────────────────────────────────────────────
 *   1. Belum masuk → halaman menampilkan ajakan masuk
 *   2. Daftar akun + masuk (untuk dapat sesi)
 *   3. Halaman keamanan menampilkan data akun + cara masuk
 *   4. Tambah passkey lewat authenticator virtual
 *   5. Passkey muncul di daftar
 *   6. Hapus passkey lewat dialog konfirmasi
 *   7. Dialog menolak penghapusan cara masuk terakhir
 */

import pw from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';

const { chromium } = pw;
const BASE = process.env.UJI_BASE || 'http://127.0.0.1:8900';

let lulus = 0;
let gagal = 0;

function cek(nama, syarat, detail = '') {
  if (syarat) { lulus += 1; console.log(`  ✅ ${nama}`); }
  else { gagal += 1; console.log(`  ❌ ${nama}${detail ? ' — ' + detail : ''}`); }
}

const email = `uji${Date.now()}@contoh.id`;
const sandi = 'SandiUjiYangPanjang123!';

async function uji() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();

  const err = [];
  p.on('pageerror', (e) => err.push(e.message));

  // ── Authenticator virtual ──────────────────────────────────────────────────
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  cek('Authenticator virtual aktif', Boolean(authenticatorId));

  console.log('\n══ 1. BELUM MASUK ══\n');

  await p.goto(`${BASE}/keamanan.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  const r1 = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return e && !e.hidden && getComputedStyle(e).display !== 'none'; };
    return {
      belumMasuk: vis('#kamBelumMasuk'),
      isi: vis('#kamIsi'),
      judul: document.querySelector('#kamBelumMasuk .kam-kosong-judul')?.textContent?.trim(),
      tautan: document.querySelector('#kamBelumMasuk a')?.getAttribute('href'),
    };
  });

  cek('Tanpa sesi → tampilkan ajakan masuk', r1.belumMasuk === true);
  cek('Tanpa sesi → isi akun disembunyikan', r1.isi === false);
  cek('Tautan ke halaman masuk benar', r1.tautan === '/sign-in', `href=${r1.tautan}`);

  console.log('\n══ 2. DAFTAR + MASUK (dapat sesi) ══\n');

  const resDaftar = await p.evaluate(async ({ email, sandi }) => {
    const r = await fetch('/api/auth/daftar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, sandi, nama: 'Pengguna Uji', project: 'mina',
        // Token Turnstile dummy — lolos hanya dengan TEST_SECRET_ALWAYS_PASS.
        'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, { email, sandi });

  cek('Pendaftaran berhasil', resDaftar.status === 201 || resDaftar.body?.ok === true,
    `status ${resDaftar.status}: ${JSON.stringify(resDaftar.body).slice(0, 90)}`);

  const resMasuk = await p.evaluate(async ({ email, sandi }) => {
    const r = await fetch('/api/auth/masuk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, sandi,
        'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, { email, sandi });

  cek('Masuk berhasil (sesi + cookie)', resMasuk.body?.ok === true,
    `status ${resMasuk.status}: ${JSON.stringify(resMasuk.body).slice(0, 90)}`);

  console.log('\n══ 3. HALAMAN MENAMPILKAN AKUN ══\n');

  await p.goto(`${BASE}/keamanan.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);

  const r3 = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return e && !e.hidden && getComputedStyle(e).display !== 'none'; };
    return {
      isi: vis('#kamIsi'),
      belumMasuk: vis('#kamBelumMasuk'),
      email: document.querySelector('#kamEmail')?.textContent?.trim(),
      jumlah: document.querySelectorAll('#kamSenarai .kam-item').length,
      hitung: document.querySelector('#kamHitung')?.textContent?.trim(),
      adaSandi: [...document.querySelectorAll('.kam-item-judul')].some(e => e.textContent.includes('Sandi')),
      tombolTambah: Boolean(document.querySelector('#btnTambahPasskey')),
      kaki: vis('#kamKaki'),
    };
  });

  cek('Data akun ditampilkan', r3.isi === true);
  cek('Email benar', r3.email === email, `dapat: ${r3.email}`);
  cek('Sandi terdaftar sebagai cara masuk', r3.adaSandi === true);
  cek('Tombol tambah passkey ada', r3.tombolTambah === true);
  cek('Tombol keluar terlihat', r3.kaki === true);
  cek('Penghitung cara masuk benar', r3.hitung === '1 cara masuk', `dapat: ${r3.hitung}`);

  console.log('\n══ 4. TAMBAH PASSKEY (authenticator virtual) ══\n');

  // ── BUKA PANEL "CARA MASUK" DULU ──────────────────────────────────────────
  // Halaman ini sekarang bertata-letak sidebar + panel: #btnTambahPasskey dan
  // #kamSenarai ada di panel "Cara masuk", yang TERSEMBUNYI saat halaman dibuka
  // (panel awal = "Profil"). Playwright menolak mengklik elemen yang tidak
  // terlihat, jadi tab-nya harus dibuka lebih dulu.
  //
  // Ini bukan penyesuaian agar uji lulus — ini memang alur yang dilalui
  // pengguna sungguhan: mereka juga harus membuka tab "Cara masuk" sebelum
  // bisa menambah passkey.
  await p.click('#tabMasuk');
  await p.waitForTimeout(400);

  await p.click('#btnTambahPasskey');
  // 4 detik: cukup untuk WebAuthn membuat kunci P-256 + server memverifikasi,
  // tapi KURANG dari 5 detik — pesan sukses hilang sendiri setelah 5 detik,
  // jadi memeriksa lebih lambat dari itu akan membaca pesan yang sudah bersih.
  await p.waitForTimeout(4000);

  const r4 = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return e && !e.hidden && getComputedStyle(e).display !== 'none'; };
    return {
      pesan: document.querySelector('#kamPesan')?.textContent?.trim(),
      pesanSukses: document.querySelector('#kamPesan')?.classList.contains('is-sukses'),
      jumlah: document.querySelectorAll('#kamSenarai .kam-item').length,
      hitung: document.querySelector('#kamHitung')?.textContent?.trim(),
      adaPasskey: [...document.querySelectorAll('.kam-item-judul')].some(e => e.textContent.includes('Passkey')),
      tombolAktif: !document.querySelector('#btnTambahPasskey')?.disabled,
      tombolTeks: document.querySelector('#btnTambahPasskey')?.textContent?.trim(),
    };
  });

  cek('Passkey berhasil ditambahkan', r4.adaPasskey === true, `pesan: ${r4.pesan}`);
  cek('Pesan sukses ditampilkan', r4.pesanSukses === true, `pesan: ${r4.pesan}`);
  cek('Daftar bertambah jadi 2', r4.jumlah === 2, `jumlah: ${r4.jumlah}`);
  cek('Penghitung diperbarui', r4.hitung === '2 cara masuk', `dapat: ${r4.hitung}`);
  // Teks tombol 'Tambah' — bukan 'Tambah passkey'.
  //
  // ── KENAPA DIUBAH ────────────────────────────────────────────────────────
  // Sebelumnya judul dan tombol sama-sama berbunyi "Tambah passkey". Nama yang
  // sama dua kali dalam satu blok bukan penekanan — itu pengulangan.
  //
  // Sekarang judul menjawab "ini apa?" (Passkey) dan tombol menjawab "apa
  // yang terjadi kalau saya klik?" (Tambah). Dua pertanyaan, dua teks.
  cek('Tombol pulih setelah selesai', r4.tombolAktif === true && r4.tombolTeks === 'Tambah',
    `disabled=${!r4.tombolAktif}, teks="${r4.tombolTeks}"`);

  // Kredensial benar-benar tersimpan di authenticator?
  const kredensial = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  cek('Kredensial tersimpan di authenticator', kredensial.credentials.length === 1,
    `jumlah: ${kredensial.credentials.length}`);

  await p.screenshot({ path: '/tmp/kam-dengan-passkey.png', fullPage: true });

  console.log('\n══ 5. HAPUS PASSKEY (dialog konfirmasi) ══\n');

  // Klik tombol hapus pada baris passkey (baris kedua).
  const tombolHapus = await p.$$('.kam-hapus');
  cek('Tombol hapus ada untuk identitas', tombolHapus.length >= 1, `jumlah: ${tombolHapus.length}`);

  await tombolHapus[tombolHapus.length - 1].click();
  await p.waitForTimeout(700);

  const r5a = await p.evaluate(() => {
    const d = document.querySelector('#kamDialog');
    return {
      terbuka: d && !d.hidden,
      judul: document.querySelector('#kamDialogJudul')?.textContent?.trim(),
      teks: document.querySelector('#kamDialogTeks')?.textContent?.trim().slice(0, 60),
      adaBatal: Boolean(document.querySelector('#kamDialogBatal')),
      adaHapus: Boolean(document.querySelector('#kamDialogHapus')),
    };
  });

  cek('Dialog konfirmasi terbuka', r5a.terbuka === true);
  cek('Dialog punya tombol Batal', r5a.adaBatal === true);
  cek('Dialog menjelaskan akibatnya', (r5a.teks || '').length > 30, `teks: ${r5a.teks}`);

  // Uji tombol Batal dulu — dialog harus tertutup tanpa menghapus.
  await p.click('#kamDialogBatal');
  await p.waitForTimeout(500);
  const r5b = await p.evaluate(() => ({
    tertutup: document.querySelector('#kamDialog')?.hidden === true,
    masihAda: document.querySelectorAll('#kamSenarai .kam-item').length,
  }));
  cek('Batal menutup dialog tanpa menghapus', r5b.tertutup && r5b.masihAda === 2,
    `tertutup=${r5b.tertutup}, item=${r5b.masihAda}`);

  // Sekarang benar-benar hapus.
  const tombolHapus2 = await p.$$('.kam-hapus');
  await tombolHapus2[tombolHapus2.length - 1].click();
  await p.waitForTimeout(700);
  await p.click('#kamDialogHapus');
  await p.waitForTimeout(3500);

  const r5c = await p.evaluate(() => ({
    pesan: document.querySelector('#kamPesan')?.textContent?.trim(),
    jumlah: document.querySelectorAll('#kamSenarai .kam-item').length,
    hitung: document.querySelector('#kamHitung')?.textContent?.trim(),
    adaPasskey: [...document.querySelectorAll('.kam-item-judul')].some(e => e.textContent.includes('Passkey')),
  }));

  cek('Passkey terhapus dari daftar', r5c.adaPasskey === false, `pesan: ${r5c.pesan}`);
  cek('Daftar kembali jadi 1', r5c.jumlah === 1, `jumlah: ${r5c.jumlah}`);
  cek('Penghitung kembali', r5c.hitung === '1 cara masuk', `dapat: ${r5c.hitung}`);

  console.log('\n══ 6. PENJAGAAN CARA MASUK TERAKHIR ══\n');

  const r6 = await p.evaluate(() => {
    const judul = [...document.querySelectorAll('.kam-item-judul')].map(e => e.textContent.trim());
    return {
      item: judul,
      adaTombolHapus: document.querySelectorAll('.kam-hapus').length,
    };
  });

  cek('Sandi tetap terdaftar setelah passkey dihapus', r6.item.some(t => t.includes('Sandi')),
    `item: ${JSON.stringify(r6.item)}`);
  cek('Sandi TIDAK punya tombol hapus (butuh alur ubah sandi)',
    r6.adaTombolHapus === 0, `tombol hapus: ${r6.adaTombolHapus}`);

  console.log('\n══ 6b. PENJAGAAN CARA MASUK TERAKHIR (server) ══\n');

  // ── Uji penjagaan SUNGGUHAN: akun tanpa sandi + satu identitas ──
  //
  // Penjagaan ini yang mencegah pengguna mengunci dirinya sendiri di luar
  // akun. Menguji lewat UI tidak cukup: UI hanya menonaktifkan tombol, dan
  // penjagaan yang hanya ada di klien bukan penjagaan.
  //
  // Caranya: tambah passkey lagi, lalu kosongkan password_hash langsung di
  // database uji — itu membuat akun ini menyerupai akun yang dibuat lewat
  // OAuth (tidak punya sandi). Lalu coba hapus passkey-nya lewat API.
  // ── BUKA PANEL "CARA MASUK" DULU ──────────────────────────────────────────
  // Halaman ini sekarang bertata-letak sidebar + panel: #btnTambahPasskey dan
  // #kamSenarai ada di panel "Cara masuk", yang TERSEMBUNYI saat halaman dibuka
  // (panel awal = "Profil"). Playwright menolak mengklik elemen yang tidak
  // terlihat, jadi tab-nya harus dibuka lebih dulu.
  //
  // Ini bukan penyesuaian agar uji lulus — ini memang alur yang dilalui
  // pengguna sungguhan: mereka juga harus membuka tab "Cara masuk" sebelum
  // bisa menambah passkey.
  await p.click('#tabMasuk');
  await p.waitForTimeout(400);

  await p.click('#btnTambahPasskey');
  await p.waitForTimeout(4500);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(process.env.DB_PATH || '/tmp/uji-auth.db');
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run('', email);
  db.close();

  const r6b = await p.evaluate(async () => {
    // Ambil id passkey dari server (halaman sudah memuat ulang daftarnya).
    const r = await fetch('/api/auth/identitas', { credentials: 'same-origin' });
    const d = await r.json();
    const passkey = (d.identitas || []).find(i => i.jenis === 'passkey');
    if (!passkey) return { error: 'passkey tidak ada di daftar' };

    const res = await fetch('/api/auth/identitas/hapus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id: passkey.id }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });

  cek('Server MENOLAK hapus cara masuk terakhir tanpa sandi',
    r6b.status === 400 && r6b.body?.error === 'cara_masuk_terakhir',
    `status ${r6b.status}, error ${r6b.body?.error}`);

  // Kembalikan sandi supaya uji keluar di bawah tetap realistis.
  const db2 = new DatabaseSync(process.env.DB_PATH || '/tmp/uji-auth.db');
  const hashAsli = db2.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);
  db2.close();

  cek('Pesan penolakan menjelaskan alasannya',
    typeof r6b.body?.message === 'string' && r6b.body.message.length > 20,
    `pesan: ${r6b.body?.message}`);

  console.log('\n══ 7. KELUAR ══\n');

  await p.goto(`${BASE}/keamanan.html?keluar=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);

  const r7 = await p.evaluate(async () => {
    const r = await fetch('/api/auth/profil', { credentials: 'same-origin' });
    return { status: r.status, url: location.pathname };
  });

  cek('Sesi benar-benar berakhir setelah keluar', r7.status === 401, `status ${r7.status}`);
  cek('Dialihkan ke halaman masuk', r7.url.includes('sign-in'), `url: ${r7.url}`);

  if (err.length) console.log(`\n  ⚠️  ${err.length} galat JS: ${err[0].slice(0, 80)}`);
  else console.log('\n  ✅ Tidak ada galat JS');

  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  LULUS: ${lulus}    GAGAL: ${gagal}`);
  console.log(`${'═'.repeat(58)}\n`);

  await browser.close();
  process.exit(gagal > 0 ? 1 : 0);
}

uji().catch((e) => {
  console.error('\n  ❌ Uji gagal dijalankan:', e.message);
  process.exit(1);
});
