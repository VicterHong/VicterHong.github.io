/**
 * Diagnostik konfigurasi email — VIVASTIC
 *
 * ── KENAPA ALAT INI ADA ─────────────────────────────────────────────────────
 *
 * Tanpa konfigurasi email, fitur-fitur ini TIDAK BISA DIPAKAI pengguna:
 *
 *   • Hapus akun     → kode verifikasi dikirim lewat email
 *   • Pemulihan akun → kode pembatalan dikirim lewat email
 *   • Lupa sandi     → tautan reset dikirim lewat email
 *
 * Kegagalannya SENYAP: server mencatat "email gagal terkirim" dan menulis
 * kodenya ke log sebagai fallback. Pengguna melihat pesan yang tidak
 * menjelaskan apa yang salah, dan admin harus membaca log untuk tahu kenapa.
 *
 * Alat ini memeriksa konfigurasinya SEBELUM ada pengguna yang terdampak.
 *
 * ── CARA PAKAI ──────────────────────────────────────────────────────────────
 *
 *   node scripts/cek-email.mjs           → periksa konfigurasi saja
 *   node scripts/cek-email.mjs --kirim   → kirim email uji sungguhan
 *
 * Alamat tujuan diambil dari SALES_EMAIL di service.env.
 */

import { readFileSync, existsSync } from 'node:fs';

const ENV_FILE = '/home/ubuntu/.portfolio-token/service.env';

// ── BACA ENV LANGSUNG, BUKAN LEWAT config.mjs ───────────────────────────────
//
// config.mjs memvalidasi saat import dan bisa keluar kalau ada yang kurang.
// Alat diagnostik harus SELALU bisa jalan — terutama saat ada yang salah.
function bacaEnv(path) {
  if (!existsSync(path)) return {};
  const hasil = {};
  for (const baris of readFileSync(path, 'utf8').split('\n')) {
    const bersih = baris.trim();
    if (!bersih || bersih.startsWith('#')) continue;
    const i = bersih.indexOf('=');
    if (i < 0) continue;
    const kunci = bersih.slice(0, i).trim();
    let nilai = bersih.slice(i + 1).trim();
    // Kutip dibuang — service.env kadang memakai kutip.
    if ((nilai.startsWith('"') && nilai.endsWith('"')) ||
        (nilai.startsWith("'") && nilai.endsWith("'"))) {
      nilai = nilai.slice(1, -1);
    }
    hasil[kunci] = nilai;
  }
  return hasil;
}

const env = bacaEnv(ENV_FILE);

let lulus = 0, gagal = 0, peringatan = 0;

function cek(nama, nilai, { wajib = true, petunjuk = '' } = {}) {
  const ada = Boolean(nilai && String(nilai).trim());
  if (ada) {
    // Nilai TIDAK ditampilkan — hanya panjangnya. Kunci API yang tercetak di
    // terminal bisa tertinggal di riwayat shell atau log sesi.
    const panjang = String(nilai).length;
    console.log(`  ✅ ${nama} — terisi (${panjang} karakter)`);
    lulus++;
    return true;
  }
  if (wajib) {
    console.log(`  ❌ ${nama} — KOSONG`);
    if (petunjuk) console.log(`     ${petunjuk}`);
    gagal++;
  } else {
    console.log(`  ⚠️  ${nama} — kosong (opsional)`);
    peringatan++;
  }
  return false;
}

console.log('\n  ══════════════════════════════════════════════════════════════');
console.log('    DIAGNOSTIK EMAIL — VIVASTIC');
console.log('  ══════════════════════════════════════════════════════════════\n');

console.log(`  Berkas konfigurasi: ${ENV_FILE}`);
console.log(`  ${existsSync(ENV_FILE) ? '✅ ditemukan' : '❌ TIDAK DITEMUKAN'}\n`);

// ══════════════════════════════════════════════════════════════════════════════
// 1. KONFIGURASI PENGIRIMAN
// ══════════════════════════════════════════════════════════════════════════════
console.log('  ══ 1. PENYEDIA EMAIL ══');

// ── DUA PENYEDIA, DIPILIH OTOMATIS ──────────────────────────────────────────
//
// Resend bisa dipakai TANPA domain sendiri (mode uji). Cloudflare WAJIB punya
// domain yang sudah di-onboard.
//
// Yang mana yang aktif ditentukan oleh email.mjs: Resend diperiksa dulu.
const adaResend = Boolean(env.RESEND_API_KEY?.trim());
const adaCf = Boolean(env.CF_API_TOKEN?.trim() && env.CF_ACCOUNT_ID?.trim() && env.EMAIL_FROM?.trim());

if (adaResend) {
  console.log('  ✅ RESEND_API_KEY — terisi');
  console.log('     → penyedia aktif: RESEND');
  lulus++;
} else {
  console.log('  ○  RESEND_API_KEY — kosong');
}

if (adaCf) {
  console.log('  ✅ CF_API_TOKEN + CF_ACCOUNT_ID + EMAIL_FROM — lengkap');
  if (adaResend) {
    console.log('     ⚠️  Tapi RESEND_API_KEY juga terisi → RESEND yang dipakai');
    console.log('        Hapus RESEND_API_KEY kalau mau pindah ke Cloudflare.');
    peringatan++;
  } else {
    console.log('     → penyedia aktif: CLOUDFLARE');
    lulus++;
  }
} else {
  const adaSebagian = Boolean(env.CF_API_TOKEN?.trim() || env.CF_ACCOUNT_ID?.trim() || env.EMAIL_FROM?.trim());
  if (adaSebagian) {
    console.log('  ⚠️  Konfigurasi Cloudflare TIDAK LENGKAP — butuh ketiganya:');
    if (!env.CF_ACCOUNT_ID?.trim()) console.log('        ❌ CF_ACCOUNT_ID kosong');
    if (!env.CF_API_TOKEN?.trim()) console.log('        ❌ CF_API_TOKEN kosong');
    if (!env.EMAIL_FROM?.trim()) console.log('        ❌ EMAIL_FROM kosong');
    peringatan++;
  } else {
    console.log('  ○  Cloudflare — belum dikonfigurasi (butuh domain sendiri)');
  }
}

const siap = adaResend || adaCf;
const adaAccountId = adaCf;
const adaToken = adaCf;
const adaFrom = adaCf || adaResend;

// ══════════════════════════════════════════════════════════════════════════════
// 2. VALIDASI BENTUK
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 2. BENTUK NILAI ══');

if (env.CF_ACCOUNT_ID) {
  // Account ID Cloudflare selalu 32 karakter hex.
  const ok = /^[a-f0-9]{32}$/i.test(env.CF_ACCOUNT_ID.trim());
  if (ok) {
    console.log('  ✅ CF_ACCOUNT_ID berbentuk benar (32 karakter hex)');
    lulus++;
  } else {
    console.log('  ❌ CF_ACCOUNT_ID bentuknya tidak dikenal');
    console.log('     Harusnya 32 karakter hex. Yang umum salah: menyalin Zone ID,');
    console.log('     atau menyalin nama akun.');
    gagal++;
  }
}

if (env.EMAIL_FROM) {
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.EMAIL_FROM.trim());
  if (ok) {
    console.log('  ✅ EMAIL_FROM berbentuk alamat email');
    lulus++;
  } else {
    console.log('  ❌ EMAIL_FROM bukan alamat email yang valid');
    gagal++;
  }
}

if (env.CF_API_TOKEN) {
  // Token Cloudflare panjangnya ~40 karakter. Yang jauh lebih pendek
  // biasanya Global API Key yang tertukar.
  const panjang = env.CF_API_TOKEN.trim().length;
  if (panjang < 30) {
    console.log(`  ⚠️  CF_API_TOKEN hanya ${panjang} karakter — biasanya ~40`);
    console.log('     Pastikan ini API Token, bukan Global API Key.');
    peringatan++;
  } else {
    console.log(`  ✅ CF_API_TOKEN panjangnya wajar (${panjang} karakter)`);
    lulus++;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. SITUS — untuk tautan di dalam email
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══ 3. TAUTAN DALAM EMAIL ══');

cek('SITE_URL', env.SITE_URL, {
  wajib: false,
  petunjuk: 'Dipakai untuk tautan reset sandi. Kalau kosong, tautannya relatif dan tidak berguna di email.',
});

if (env.SITE_URL && !/^https?:\/\//.test(env.SITE_URL)) {
  console.log('  ❌ SITE_URL harus absolut (mulai dengan https://)');
  console.log('     Tautan relatif tidak bisa diklik di dalam email.');
  gagal++;
} else if (env.SITE_URL) {
  console.log('  ✅ SITE_URL absolut');
  lulus++;
}

cek('SALES_EMAIL', env.SALES_EMAIL, {
  wajib: false,
  petunjuk: 'Dipakai sebagai alamat tujuan email uji (--kirim).',
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. RINGKASAN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n  ══════════════════════════════════════════════════════════════');

if (siap && gagal === 0) {
  console.log('    ✅ KONFIGURASI EMAIL SIAP');
  console.log('  ══════════════════════════════════════════════════════════════\n');
  console.log('  Langkah berikutnya:');
  console.log('    1. Restart backend:  sudo systemctl restart portfolio-token.service');
  console.log('    2. Kirim email uji:  node scripts/cek-email.mjs --kirim\n');
} else {
  // ── KENAPA MENGHITUNG ULANG DI SINI ────────────────────────────────────────
  //
  // `gagal` hanya menghitung pemeriksaan WAJIB yang gagal. Penyedia email yang
  // belum dikonfigurasi bukan "masalah" — ia keadaan yang sah (fitur berjalan
  // dengan fallback log). Tapi tanpa perhitungan ini, pesannya jadi
  // "BELUM SIAP — 0 masalah" yang kontradiktif dan membingungkan.
  const kurang = [];
  if (!siap) kurang.push('penyedia email belum dikonfigurasi');
  if (gagal > 0) kurang.push(`${gagal} nilai tidak valid`);

  console.log(`    ❌ BELUM SIAP — ${kurang.join(', ')}`);
  console.log('  ══════════════════════════════════════════════════════════════\n');

  if (!siap) {
    console.log('  SELAMA BELUM SIAP, yang terjadi pada pengguna:');
    console.log('    • Minta hapus akun    → kode ditulis ke LOG, bukan dikirim');
    console.log('    • Lupa sandi          → tautan reset ditulis ke LOG');
    console.log('    • Pemulihan akun      → kode ditulis ke LOG');
    console.log('');
    console.log('    Pengguna TIDAK menerima email apa pun, dan prosesnya');
    console.log('    tidak bisa diselesaikan tanpa admin membacakan kodenya.\n');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. KIRIM EMAIL UJI
// ══════════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--kirim')) {
  console.log('  ══ 4. EMAIL UJI ══\n');

  if (!siap) {
    console.log('  ❌ Tidak bisa kirim — konfigurasi belum lengkap.\n');
    process.exit(1);
  }

  const tujuan = env.SALES_EMAIL || env.EMAIL_FROM;
  console.log(`  Tujuan: ${tujuan}`);

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`;

  const isi = {
    from: env.EMAIL_FROM,
    to: tujuan,
    subject: 'Uji konfigurasi email — VIVASTIC',
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">Konfigurasi email bekerja</h2>
      <p style="color:#444;line-height:1.6">
        Email ini dikirim oleh alat diagnostik VIVASTIC. Kalau Anda menerimanya,
        pengiriman email sudah siap — dan fitur hapus akun, pemulihan akun, serta
        reset sandi bisa dipakai pengguna.
      </p>
      <p style="color:#888;font-size:13px;margin-top:20px">
        Dikirim ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
      </p>
    </div>`,
    text: 'Konfigurasi email VIVASTIC bekerja. Fitur hapus akun, pemulihan, dan reset sandi sudah siap.',
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        // ── KENAPA `Bearer`, BUKAN `x-auth-email` ──────────────────────────
        // Kedua penyedia memakai Bearer token standar. Header lain yang
        // beredar di contoh-contoh lama tidak berlaku untuk endpoint ini.
        Authorization: `Bearer ${pakaiResend ? env.RESEND_API_KEY : env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isi),
    });

    const hasil = await res.json().catch(() => ({}));

    // ── DUA BENTUK SUKSES, TERGANTUNG PENYEDIA ──────────────────────────
    //
    //   Resend     → { id: "..." }               (tanpa field `success`)
    //   Cloudflare → { success: true, result: {} }
    const sukses = res.ok && (pakaiResend ? Boolean(hasil.id) : hasil.success !== false);

    if (sukses) {
      console.log('\n  ✅ EMAIL TERKIRIM');
      console.log(`     Cek kotak masuk: ${tujuan}\n`);
      lulus++;
    } else {
      console.log(`\n  ❌ GAGAL (HTTP ${res.status})\n`);

      // ── TERJEMAHKAN GALAT CLOUDFLARE ─────────────────────────────────────
      //
      // Pesan aslinya teknis ("code 1000"). Yang dibutuhkan: apa yang harus
      // diperbaiki.
      const pesan = JSON.stringify(hasil.errors ?? hasil).slice(0, 300);
      console.log(`     Respons: ${pesan}\n`);

      if (/not authorized|authentication/i.test(pesan)) {
        console.log('     → Token tidak berizin. Pastikan izinnya mencakup');
        console.log('       Email Routing / Email Sending.');
      } else if (/domain|not verified|onboard/i.test(pesan)) {
        console.log('     → Domain pengirim belum diverifikasi di Cloudflare.');
        console.log('       Onboard domainnya dulu di Email → Email Routing.');
      } else if (/from|sender/i.test(pesan)) {
        console.log('     → EMAIL_FROM tidak cocok dengan domain yang terdaftar.');
        console.log('       Alamat pengirim HARUS di domain yang sudah diverifikasi.');
      } else {
        console.log('     → Periksa CF_ACCOUNT_ID dan izin token di dashboard.');
      }
      gagal++;
    }
  } catch (err) {
    console.log(`\n  ❌ TIDAK BISA MENGHUBUNGI CLOUDFLARE`);
    console.log(`     ${err.message}\n`);
    gagal++;
  }
} else if (siap) {
  console.log('  Untuk kirim email uji: node scripts/cek-email.mjs --kirim\n');
}

process.exit(gagal > 0 ? 1 : 0);
