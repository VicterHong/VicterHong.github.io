/**
 * Template email VIVASTIC — satu fungsi per alur.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA SATU FUNGSI PER ALUR, BUKAN SATU FUNGSI SERBA BISA ────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Sebelumnya hanya ada SATU template (reset sandi) dan ia dipakai untuk semua
 * hal — termasuk kode penghapusan akun. Akibatnya pengguna yang meminta hapus
 * akun menerima email berjudul "Ganti sandi Anda" yang membingungkan: apakah
 * sandinya berubah? apakah akunnya jadi terhapus?
 *
 * Setiap alur punya nada dan informasi berbeda:
 *
 *   • Reset sandi      → tindakan pengguna, ada tautan
 *   • Kode hapus akun  → tindakan berbahaya, butuh kode, harus ada peringatan
 *   • Verifikasi email → akun baru, sambutan
 *   • Masuk perangkat baru → peringatan keamanan, bukan tindakan
 *   • Struk pembayaran → bukti transaksi, untuk disimpan
 *
 * Menggabungkannya jadi satu template berarti salah satunya selalu terasa
 * salah tempat. Satu fungsi per alur membuat setiap email bisa tepat.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA SETIAP TEMPLATE MENGEMBALIKAN { html, teks, subjek } ──────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Pemanggil tidak perlu tahu bentuk emailnya — cukup kirim hasilnya ke
 * pengirim. Versi teks dibuat berdampingan dengan HTML di fungsi yang sama,
 * jadi tidak mungkin lupa memperbarui salah satunya.
 */

import {
  WARNA, bungkus, tombol, kotakKode, kotakCatatan, barisDetail, p, versiTeks,
} from './layout.mjs';

const DASAR = 'https://portfolio-victer.pages.dev';

/** Sapa nama dengan aman — hindari "Halo undefined,". */
function sapa(nama) {
  const bersih = String(nama ?? '').trim();
  return bersih ? `Halo ${bersih},` : 'Halo,';
}

/** Tanggal dalam bahasa Indonesia, format panjang. */
function tanggalIndonesia(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function waktuIndonesia(ms = Date.now()) {
  return new Date(ms).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' WIB';
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. RESET SANDI
// ══════════════════════════════════════════════════════════════════════════════

export function templateResetSandi({ nama, tautan, berlakuMenit = 60 }) {
  const subjek = 'Ganti sandi akun VIVASTIC Anda';

  const html = bungkus({
    judul: 'Ganti sandi Anda',
    preheader: `Tautan ganti sandi — berlaku ${berlakuMenit} menit dan hanya bisa dipakai sekali`,
    isi: `
      ${p(sapa(nama))}
      ${p('Kami menerima permintaan untuk mengganti sandi akun VIVASTIC Anda. Klik tombol di bawah untuk membuat sandi baru.')}
      <div style="margin:0 0 20px">${tombol({ teks: 'Buat sandi baru', url: tautan })}</div>
      ${p(`Tautan ini berlaku <strong style="color:${WARNA.teks}">${berlakuMenit} menit</strong> dan hanya bisa dipakai sekali.`, { redup: true, margin: '0 0 8px' })}
      ${p('Kalau Anda tidak meminta ini, abaikan email ini — sandi Anda tidak berubah dan akun Anda tetap aman.', { redup: true })}
      ${kotakCatatan({
        teks: `Tombol tidak bekerja? Salin tautan ini ke peramban:<br><span style="color:${WARNA.teksSamar};word-break:break-all">${tautan}</span>`,
        jenis: 'info',
      })}
    `,
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Kami menerima permintaan untuk mengganti sandi akun VIVASTIC Anda.',
      '',
      'Buka tautan ini untuk membuat sandi baru:',
      tautan,
      '',
      `Tautan berlaku ${berlakuMenit} menit dan hanya bisa dipakai sekali.`,
      '',
      'Kalau Anda tidak meminta ini, abaikan email ini — sandi Anda tidak berubah.',
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. KODE HAPUS AKUN
// ══════════════════════════════════════════════════════════════════════════════
//
// Ini email paling sensitif di sistem: kalau kodenya salah dikirim atau
// dibocorkan, akun bisa dihapus orang lain. Nada emailnya harus tegas bahwa
// ini tindakan serius — bukan sekadar "kode verifikasi Anda".

export function templateKodeHapusAkun({ nama, kode, berlakuMenit = 15, sisaHari = 30 }) {
  const subjek = 'Kode konfirmasi penghapusan akun VIVASTIC';

  const html = bungkus({
    judul: 'Konfirmasi penghapusan akun',
    preheader: `Kode: ${kode} — berlaku ${berlakuMenit} menit. Abaikan kalau Anda tidak meminta ini.`,
    isi: `
      ${p(sapa(nama))}
      ${p('Kami menerima permintaan untuk <strong style="color:' + WARNA.teks + '">menghapus akun VIVASTIC Anda</strong>. Masukkan kode di bawah untuk melanjutkan.')}
      ${kotakKode(kode)}
      ${p(`Kode berlaku <strong style="color:${WARNA.teks}">${berlakuMenit} menit</strong>. Jangan bagikan kode ini kepada siapa pun — staf VIVASTIC tidak pernah memintanya.`, { redup: true })}
      ${kotakCatatan({
        teks: `<strong style="color:${WARNA.merah}">Ini bukan penghapusan langsung.</strong> Setelah dikonfirmasi, akun Anda dinonaktifkan dan masih bisa dipulihkan selama <strong>${sisaHari} hari</strong>. Setelah masa itu, seluruh data dihapus permanen.`,
        jenis: 'peringatan',
      })}
      ${p('Kalau Anda tidak meminta penghapusan, abaikan email ini. Akun Anda tidak akan berubah, dan kami sarankan Anda segera mengganti sandi.', { redup: true })}
      ${p('Ingin memeriksa aktivitas akun Anda dulu?', { redup: true, margin: '0 0 8px' })}
      <div style="margin:0 0 8px">${tombol({ teks: 'Buka pengaturan keamanan', url: `${DASAR}/keamanan`, warna: WARNA.kartu, warnaTeks: WARNA.teks })}</div>
    `,
    catatanKaki: 'Anda menerima email ini karena ada permintaan penghapusan akun dari perangkat Anda.',
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Kami menerima permintaan untuk MENGHAPUS akun VIVASTIC Anda.',
      '',
      `KODE KONFIRMASI: ${kode}`,
      '',
      `Kode berlaku ${berlakuMenit} menit. Jangan bagikan kepada siapa pun.`,
      '',
      `PENTING: Ini bukan penghapusan langsung. Akun Anda dinonaktifkan`,
      `dan masih bisa dipulihkan selama ${sisaHari} hari. Setelah itu,`,
      'seluruh data dihapus permanen.',
      '',
      'Kalau Anda tidak meminta ini, abaikan email ini.',
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. KODE BATAL HAPUS AKUN
// ══════════════════════════════════════════════════════════════════════════════

export function templateKodeBatalHapus({ nama, kode, berlakuMenit = 15, sisaHari }) {
  const subjek = 'Kode pembatalan penghapusan akun VIVASTIC';

  const html = bungkus({
    judul: 'Batalkan penghapusan akun',
    preheader: `Kode: ${kode} — pakai untuk memulihkan akun Anda`,
    isi: `
      ${p(sapa(nama))}
      ${p('Akun VIVASTIC Anda sedang dalam masa tenggang penghapusan. Masukkan kode di bawah untuk <strong style="color:' + WARNA.teks + '">membatalkan penghapusan</strong> dan memulihkan akun Anda.')}
      ${kotakKode(kode)}
      ${p(`Kode berlaku <strong style="color:${WARNA.teks}">${berlakuMenit} menit</strong>.`, { redup: true })}
      ${sisaHari ? kotakCatatan({
        teks: `Sisa waktu pemulihan: <strong style="color:${WARNA.teks}">${sisaHari} hari</strong>. Setelah masa itu berakhir, akun dan seluruh datanya dihapus permanen dan tidak bisa dipulihkan.`,
        jenis: 'peringatan',
      }) : ''}
      ${p('Kalau Anda memang ingin menghapus akun, abaikan email ini.', { redup: true })}
    `,
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Akun VIVASTIC Anda sedang dalam masa tenggang penghapusan.',
      '',
      `KODE PEMBATALAN: ${kode}`,
      '',
      `Kode berlaku ${berlakuMenit} menit.`,
      ...(sisaHari ? ['', `Sisa waktu pemulihan: ${sisaHari} hari.`] : []),
      '',
      'Kalau Anda memang ingin menghapus akun, abaikan email ini.',
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. SELAMAT DATANG / VERIFIKASI EMAIL
// ══════════════════════════════════════════════════════════════════════════════

export function templateSelamatDatang({ nama, email, tautanVerifikasi }) {
  const subjek = 'Selamat datang di VIVASTIC — konfirmasi email Anda';

  const html = bungkus({
    judul: 'Selamat datang di VIVASTIC',
    preheader: 'Satu langkah lagi — konfirmasi alamat email Anda',
    isi: `
      ${p(sapa(nama))}
      ${p('Terima kasih telah mendaftar. Akun Anda sudah dibuat dan siap dipakai.')}
      ${tautanVerifikasi ? `
        ${p('Konfirmasi alamat email Anda untuk mengamankan akun:')}
        <div style="margin:0 0 20px">${tombol({ teks: 'Konfirmasi email', url: tautanVerifikasi })}</div>
      ` : ''}
      ${barisDetail([
        ['Email akun', email],
        ['Tanggal daftar', tanggalIndonesia()],
        ['Status', `<span style="color:${WARNA.hijau}">Aktif</span>`],
      ])}
      ${p('Apa yang bisa Anda lakukan sekarang:', { margin: '0 0 10px' })}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
        ${['Kelola proyek dan token akses Anda', 'Aktifkan verifikasi 2 langkah untuk keamanan tambahan', 'Pantau aktivitas masuk akun Anda'].map((t) => `
        <tr><td style="padding:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:${WARNA.teksRedup}">
          <span style="color:${WARNA.emas}">›</span>&nbsp; ${t}
        </td></tr>`).join('')}
      </table>
      <div style="margin:0 0 8px">${tombol({ teks: 'Buka dasbor', url: `${DASAR}/keamanan`, warna: WARNA.kartu, warnaTeks: WARNA.teks })}</div>
    `,
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Terima kasih telah mendaftar di VIVASTIC.',
      'Akun Anda sudah dibuat dan siap dipakai.',
      '',
      `Email akun   : ${email}`,
      `Tanggal daftar: ${tanggalIndonesia()}`,
      '',
      ...(tautanVerifikasi ? ['Konfirmasi email Anda:', tautanVerifikasi, ''] : []),
      'Buka dasbor: ' + DASAR + '/keamanan',
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. PERINGATAN MASUK DARI PERANGKAT BARU
// ══════════════════════════════════════════════════════════════════════════════
//
// Email keamanan yang BAIK memberi pengguna cara memverifikasi: waktu, lokasi,
// perangkat. Tanpa itu, pengguna tidak bisa menilai apakah ini benar dirinya.
// Yang buruk hanya berkata "ada login baru" — dan pengguna mengabaikannya.

export function templateMasukPerangkatBaru({
  nama, perangkat, lokasi, ip, waktu = Date.now(), tautanAmankan,
}) {
  const subjek = 'Masuk baru ke akun VIVASTIC Anda';

  const html = bungkus({
    judul: 'Ada yang masuk ke akun Anda',
    preheader: `${perangkat ?? 'Perangkat baru'} · ${lokasi ?? 'lokasi tidak dikenal'}`,
    isi: `
      ${p(sapa(nama))}
      ${p('Kami mendeteksi masuk ke akun VIVASTIC Anda dari perangkat yang belum pernah dipakai.')}
      ${barisDetail([
        ['Waktu', waktuIndonesia(waktu)],
        ['Perangkat', perangkat ?? 'Tidak dikenal'],
        ['Lokasi', lokasi ?? 'Tidak dikenal'],
        ...(ip ? [['Alamat IP', ip]] : []),
      ])}
      ${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Apakah ini Anda?</strong> Kalau ya, tidak ada yang perlu dilakukan. Kalau bukan, segera amankan akun Anda — ganti sandi dan cabut semua sesi yang tidak dikenal.`,
        jenis: 'peringatan',
      })}
      <div style="margin:0 0 8px">${tombol({ teks: 'Amankan akun saya', url: tautanAmankan ?? `${DASAR}/keamanan` })}</div>
      ${p('Sesi yang tidak dikenal bisa Anda cabut dari halaman Keamanan.', { redup: true })}
    `,
    catatanKaki: 'Anda menerima email ini karena email keamanan selalu dikirim untuk masuk dari perangkat baru.',
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Kami mendeteksi masuk ke akun VIVASTIC Anda dari perangkat baru.',
      '',
      `Waktu    : ${waktuIndonesia(waktu)}`,
      `Perangkat: ${perangkat ?? 'Tidak dikenal'}`,
      `Lokasi   : ${lokasi ?? 'Tidak dikenal'}`,
      ...(ip ? [`Alamat IP: ${ip}`] : []),
      '',
      'Kalau ini Anda, tidak ada yang perlu dilakukan.',
      'Kalau BUKAN Anda, segera ganti sandi dan cabut sesi yang tidak dikenal:',
      (tautanAmankan ?? DASAR + '/keamanan'),
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. STRUK PEMBAYARAN
// ══════════════════════════════════════════════════════════════════════════════

export function templateStrukPembayaran({
  nama, email, nomorPesanan, paket, periode, jumlah, status = 'Lunas', waktu = Date.now(), tautanPesanan,
}) {
  const subjek = `Struk pembayaran ${nomorPesanan} — VIVASTIC`;

  const html = bungkus({
    judul: 'Pembayaran diterima',
    preheader: `${paket} · ${jumlah} · ${nomorPesanan}`,
    isi: `
      ${p(sapa(nama))}
      ${p('Terima kasih. Pembayaran Anda sudah kami terima dan akses Anda sudah aktif.')}
      ${kotakCatatan({
        teks: `<strong style="color:${WARNA.hijau}">✓ ${status}</strong> — akses ${paket} sudah bisa dipakai sekarang.`,
        jenis: 'sukses',
      })}
      ${barisDetail([
        ['Nomor pesanan', `<span style="font-family:monospace;font-size:13px">${nomorPesanan}</span>`],
        ['Paket', paket],
        ['Periode', periode],
        ['Tanggal', waktuIndonesia(waktu)],
        ['Email akun', email],
        ['Total', `<strong style="color:${WARNA.emas};font-size:16px">${jumlah}</strong>`],
      ])}
      <div style="margin:0 0 8px">${tombol({ teks: 'Lihat pesanan', url: tautanPesanan ?? `${DASAR}/pesanan` })}</div>
      ${p('Simpan email ini sebagai bukti pembayaran Anda.', { redup: true })}
    `,
    catatanKaki: 'Pertanyaan tentang tagihan? Balas email ini atau hubungi kami lewat pusat bantuan.',
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Terima kasih. Pembayaran Anda sudah kami terima.',
      '',
      `Status       : ${status}`,
      `Nomor pesanan: ${nomorPesanan}`,
      `Paket        : ${paket}`,
      `Periode      : ${periode}`,
      `Tanggal      : ${waktuIndonesia(waktu)}`,
      `Email akun   : ${email}`,
      `Total        : ${jumlah}`,
      '',
      'Simpan email ini sebagai bukti pembayaran Anda.',
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. AKUN DINONAKTIFKAN (masa tenggang dimulai)
// ══════════════════════════════════════════════════════════════════════════════

export function templateAkunDinonaktifkan({ nama, sisaHari = 30, tautanPulihkan }) {
  const subjek = 'Akun VIVASTIC Anda dinonaktifkan sementara';

  const html = bungkus({
    judul: 'Akun Anda dinonaktifkan',
    preheader: `Masih bisa dipulihkan dalam ${sisaHari} hari`,
    isi: `
      ${p(sapa(nama))}
      ${p('Permintaan penghapusan akun VIVASTIC Anda sudah kami terima. Akun Anda kini dinonaktifkan.')}
      ${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Anda masih punya waktu ${sisaHari} hari.</strong> Selama masa ini, akun dan seluruh data Anda masih tersimpan dan bisa dipulihkan sepenuhnya.`,
        jenis: 'peringatan',
      })}
      ${p('Setelah masa tenggang berakhir, akun beserta seluruh data — proyek, token, riwayat — akan dihapus permanen dan tidak bisa dikembalikan.')}
      <div style="margin:0 0 8px">${tombol({ teks: 'Pulihkan akun saya', url: tautanPulihkan ?? `${DASAR}/pemulihan` })}</div>
      ${p('Kalau Anda memang ingin menghapus akun, tidak ada yang perlu dilakukan.', { redup: true })}
    `,
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Permintaan penghapusan akun VIVASTIC Anda sudah kami terima.',
      'Akun Anda kini dinonaktifkan.',
      '',
      `Anda masih punya waktu ${sisaHari} hari untuk memulihkannya.`,
      'Setelah masa itu, akun dan seluruh data dihapus permanen.',
      '',
      'Pulihkan akun: ' + (tautanPulihkan ?? DASAR + '/pemulihan'),
    ],
  });

  return { subjek, html, teks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. KODE VERIFIKASI 2FA / MASUK
// ══════════════════════════════════════════════════════════════════════════════

export function templateKodeMasuk({ nama, kode, berlakuMenit = 10, lokasi, ip }) {
  const subjek = `Kode masuk VIVASTIC: ${kode}`;

  const html = bungkus({
    judul: 'Kode masuk Anda',
    preheader: `${kode} — berlaku ${berlakuMenit} menit`,
    isi: `
      ${p(sapa(nama))}
      ${p('Gunakan kode berikut untuk menyelesaikan proses masuk ke akun VIVASTIC Anda.')}
      ${kotakKode(kode)}
      ${p(`Kode berlaku <strong style="color:${WARNA.teks}">${berlakuMenit} menit</strong>. Jangan bagikan kode ini kepada siapa pun.`, { redup: true })}
      ${(lokasi || ip) ? barisDetail([
        ...(lokasi ? [['Lokasi', lokasi]] : []),
        ...(ip ? [['Alamat IP', ip]] : []),
      ]) : ''}
      ${p('Kalau Anda tidak merasa mencoba masuk, abaikan email ini dan pertimbangkan mengganti sandi Anda.', { redup: true })}
    `,
  });

  const teks = versiTeks({
    judul: subjek,
    baris: [
      sapa(nama),
      '',
      'Gunakan kode berikut untuk masuk ke akun VIVASTIC Anda:',
      '',
      `KODE: ${kode}`,
      '',
      `Kode berlaku ${berlakuMenit} menit. Jangan bagikan kepada siapa pun.`,
      ...(lokasi ? ['', `Lokasi: ${lokasi}`] : []),
      ...(ip ? [`Alamat IP: ${ip}`] : []),
    ],
  });

  return { subjek, html, teks };
}
