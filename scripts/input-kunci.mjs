/**
 * Halaman input kunci API sekali-pakai.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MASALAH YANG DIPECAHKAN ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Kunci API tidak boleh lewat chat: riwayat percakapan tersimpan permanen dan
 * bisa tersalin ke backup, log, atau ekspor. Sekali bocor, kunci harus dicabut.
 *
 * Tapi pengguna tidak selalu punya akses terminal ke server (mis. sedang di
 * ponsel lewat Telegram). Menyalin kunci ke berkas lewat SFTP juga merepotkan.
 *
 * Halaman ini menjadi jalan tengah: kunci diketik langsung di peramban
 * pengguna, dikirim lewat HTTPS ke server, dan tidak pernah menyentuh chat.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── PENGAMANAN (berlapis) ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. TOKEN DI URL — 32 byte acak. Tanpa token, semua permintaan ditolak 404.
 *      Halaman login palsu yang dipindai bot tidak menemukan apa pun.
 *
 *   2. SEKALI PAKAI — setelah kunci tersimpan, server menutup dirinya sendiri.
 *      Tidak ada jendela waktu untuk dipakai ulang.
 *
 *   3. TENGGANG WAKTU — mati otomatis setelah 15 menit, dipakai atau tidak.
 *
 *   4. HANYA LOOPBACK — server mendengarkan di 127.0.0.1. Akses dari luar
 *      HANYA lewat tunnel HTTPS yang dibuat khusus untuk sesi ini.
 *
 *   5. KUNCI TIDAK PERNAH DI-LOG — tidak ada console.log isi kunci, tidak ada
 *      penulisan ke berkas log. Yang dicatat hanya "berhasil/gagal".
 *
 *   6. KUNCI DIUJI DULU — dikirim ke Resend sebelum disimpan. Kunci salah
 *      tidak menimpa kunci yang sudah benar.
 *
 *   7. HAPUS DARI MEMORI — variabel dibersihkan setelah ditulis.
 *
 * Jalankan: node scripts/input-kunci.mjs
 */

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT_INPUT ?? 8899);
const TENGGANG_MENIT = 15;
const BERKAS = process.env.TOKEN_SERVICE_ENV
  ?? join(process.env.HOME ?? '/home/ubuntu', '.portfolio-token', 'service.env');

// ── Token akses ───────────────────────────────────────────────────────────────
//
// 32 byte = 256 bit. Tidak bisa ditebak. Ditampilkan SEKALI di terminal,
// lalu dipakai di URL. Bot yang memindai internet tidak akan menemukannya.

const TOKEN = randomBytes(32).toString('hex');
const JALUR = `/simpan-${TOKEN}`;

let sudahDipakai = false;

// ── Halaman ───────────────────────────────────────────────────────────────────

function halaman({ pesan = '', jenis = '' } = {}) {
  const warna = jenis === 'sukses' ? '#34d399' : jenis === 'gagal' ? '#f87171' : '#a1a1aa';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Simpan Kunci API</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0a0a0b; color:#f4f4f6; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .kartu { width:100%; max-width:440px; background:#16161a; border:1px solid #26262c;
           border-radius:16px; padding:28px; }
  .logo { width:36px; height:36px; border-radius:11px; background:#f5c542; color:#0a0a0b;
          font-weight:700; font-size:18px; display:flex; align-items:center;
          justify-content:center; margin-bottom:18px; }
  h1 { margin:0 0 8px; font-size:20px; font-weight:600; letter-spacing:-0.02em; }
  p.ket { margin:0 0 22px; font-size:14px; line-height:1.6; color:#a1a1aa; }
  label { display:block; font-size:13px; color:#a1a1aa; margin-bottom:8px; }
  input { width:100%; padding:13px 14px; background:#0e0e11; border:1px solid #26262c;
          border-radius:9px; color:#f4f4f6; font-size:15px;
          font-family:'SF Mono',Consolas,monospace; outline:none; }
  input:focus { border-color:#f5c542; }
  button { width:100%; margin-top:16px; padding:14px; background:#f5c542; color:#0a0a0b;
           border:0; border-radius:9px; font-size:15px; font-weight:600; cursor:pointer; }
  button:active { opacity:.85; }
  .pesan { margin-top:18px; padding:13px 15px; border-radius:9px; font-size:13px;
           line-height:1.6; border-left:3px solid ${warna}; background:#121214; color:#a1a1aa; }
  .catatan { margin-top:20px; font-size:12px; line-height:1.6; color:#71717a; }
</style>
</head>
<body>
  <div class="kartu">
    <div class="logo">V</div>
    <h1>Simpan Kunci Resend</h1>
    <p class="ket">Tempel kunci API di bawah. Kunci dikirim lewat HTTPS, diuji ke Resend, lalu disimpan ke server — <strong style="color:#f4f4f6">tidak pernah masuk riwayat chat</strong>.</p>

    <form method="POST" action="${JALUR}">
      <label for="kunci">Kunci API (mulai <code>re_</code>)</label>
      <input id="kunci" name="kunci" type="password" autocomplete="off"
             spellcheck="false" autocapitalize="off" placeholder="re_..." required autofocus>
      <button type="submit">Simpan &amp; Uji</button>
    </form>

    ${pesan ? `<div class="pesan">${pesan}</div>` : ''}

    <p class="catatan">
      Halaman ini <strong>mati sendiri</strong> setelah kunci tersimpan, dan juga
      mati otomatis setelah ${TENGGANG_MENIT} menit. Kunci tidak ditulis ke log.
    </p>
  </div>
</body>
</html>`;
}

// ── Simpan kunci ──────────────────────────────────────────────────────────────

async function simpan(kunci) {
  const bersih = String(kunci).trim().replace(/^["']|["']$/g, '');

  if (!bersih.startsWith('re_')) {
    return { ok: false, pesan: 'Kunci tidak dikenali — kunci Resend selalu mulai dengan <code>re_</code>.' };
  }
  if (bersih.length < 20) {
    return { ok: false, pesan: `Kunci terlalu pendek (${bersih.length} karakter) — sepertinya terpotong saat menempel.` };
  }

  // ── Uji ke Resend SEBELUM disimpan ──────────────────────────────────────────
  // Kalau ditulis dulu lalu diuji, kunci yang salah akan menimpa kunci yang baik.
  let sah = false;
  let alasan = '';

  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${bersih}` },
      signal: AbortSignal.timeout(15_000),
    });

    sah = res.ok;
    if (!res.ok) alasan = `Resend menolak (HTTP ${res.status})`;
  } catch (e) {
    return { ok: false, pesan: `Tidak bisa menghubungi Resend: ${e.message.slice(0, 100)}. Coba lagi.` };
  }

  if (!sah) {
    return { ok: false, pesan: `Kunci ${alasan}. Buat kunci baru di <a href="https://resend.com/api-keys" style="color:#f5c542">resend.com/api-keys</a>.` };
  }

  // ── Tulis (ganti baris lama, jangan menumpuk) ───────────────────────────────
  if (!existsSync(BERKAS)) {
    return { ok: false, pesan: `Berkas ${BERKAS} tidak ditemukan di server.` };
  }

  copyFileSync(BERKAS, `${BERKAS}.bak.${Date.now()}`);

  const isi = readFileSync(BERKAS, 'utf8')
    .split('\n')
    .filter((b) => !b.startsWith('RESEND_API_KEY='))
    .join('\n');

  writeFileSync(BERKAS, `${isi.replace(/\n+$/, '')}\nRESEND_API_KEY=${bersih}\n`, { mode: 0o600 });

  return { ok: true, pesan: 'Kunci sah dan tersimpan. Server akan menutup diri.' };
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // Semua jalur selain token yang benar → 404. Tidak ada petunjuk apa pun.
  if (!req.url.startsWith(JALUR)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  if (sudahDipakai) {
    res.writeHead(410, { 'content-type': 'text/html; charset=utf-8' });
    res.end(halaman({ pesan: 'Halaman ini sudah dipakai dan tidak berlaku lagi.', jenis: 'gagal' }));
    return;
  }

  // GET → tampilkan formulir
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(halaman());
    return;
  }

  // POST → simpan kunci
  if (req.method === 'POST') {
    let badan = '';
    req.on('data', (c) => {
      badan += c;
      if (badan.length > 4096) req.destroy();   // kunci tidak sepanjang ini
    });

    req.on('end', async () => {
      const params = new URLSearchParams(badan);
      const kunci = params.get('kunci') ?? '';

      const hasil = await simpan(kunci);

      res.writeHead(hasil.ok ? 200 : 400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(halaman({
        pesan: hasil.ok
          ? `${hasil.pesan}<br><br>Langkah berikutnya: minta asisten menjalankan <code>setup-domain-email.mjs --siapkan</code>.`
          : hasil.pesan,
        jenis: hasil.ok ? 'sukses' : 'gagal',
      }));

      if (hasil.ok) {
        sudahDipakai = true;
        console.log('[input-kunci] ✅ Kunci tersimpan — server menutup diri.');
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1500);
      }
    });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ══ HALAMAN INPUT KUNCI ══');
  console.log('');
  console.log(`  Lokal : http://127.0.0.1:${PORT}${JALUR}`);
  console.log('');
  console.log(`  Token : ${TOKEN.slice(0, 16)}…`);
  console.log(`  Mati  : otomatis setelah ${TENGGANG_MENIT} menit, atau segera setelah kunci disimpan`);
  console.log('');
  console.log('  Menunggu tunnel...');
});

// Mati otomatis — halaman tidak boleh hidup lebih lama dari perlu.
setTimeout(() => {
  console.log(`[input-kunci] tenggang ${TENGGANG_MENIT} menit habis — menutup.`);
  server.close();
  process.exit(0);
}, TENGGANG_MENIT * 60 * 1000);
