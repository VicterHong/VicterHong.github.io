/**
 * Template email VIVASTIC — pemasangan nilai ke HTML hasil kompilasi MJML.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── ARSITEKTUR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   email-src/templates.mjml.mjs  →  sumber MJML (yang diedit manusia)
 *              ↓  node scripts/build-email.mjs
 *   src/email/html.mjs            →  HTML tabel (kompatibel semua klien email)
 *              ↓  berkas ini — mengisi {{variabel}} dengan nilai sebenarnya
 *   HTML final                    →  siap dikirim
 *
 * Berkas ini TIDAK berisi HTML template. Ia hanya:
 *   1. Mengambil HTML dari html.mjs (hasil kompilasi MJML)
 *   2. Mengisi placeholder {{...}} dengan nilai yang diberikan pemanggil
 *   3. Menyediakan versi teks polos
 *
 * ── KENAPA DIPISAH BEGITU ───────────────────────────────────────────────────
 * Server email berjalan TANPA node_modules. Kalau berkas ini mengimpor `mjml`
 * untuk mengompilasi saat berjalan, server butuh dependensi — dan keunggulan
 * "tetap hidup walau node_modules rusak" hilang.
 *
 * Kompilasi terjadi saat BUILD; hasilnya di-commit. Server hanya membaca
 * string HTML yang sudah jadi.
 *
 * ── KENAPA SEMUA NILAI DI-ESCAPE ────────────────────────────────────────────
 * Nama pengguna bisa berisi `<`, `>`, `&`, kutip. Tanpa escape, karakter itu
 * merusak struktur email — atau menyisipkan elemen yang tidak kita maksud.
 * Lihat src/email/variabel.mjs.
 */

import { HTML_EMAIL } from './html.mjs';
import { isiVariabel, nilaiStandar, placeholderTersisa } from './variabel.mjs';

/**
 * Kalimat sapaan lengkap — "Halo Victer," atau "Halo,".
 *
 * ── KENAPA KALIMAT LENGKAP, BUKAN HANYA NAMA ────────────────────────────────
 * Template MJML memakai `{{sapaan}}` yang berdiri sendiri di barisnya.
 * Kalau yang dikirim hanya nama, email tanpa nama akan tampil "Halo ," —
 * ada spasi menggantung sebelum koma, terlihat seperti kesalahan sistem.
 *
 * Mengirim kalimat lengkap membuat kedua kasus benar tanpa logika di template.
 */
function sapaan(nama) {
  const bersih = String(nama ?? '').trim();
  return bersih ? `Halo ${bersih},` : 'Halo,';
}

/** Tanggal dalam bahasa Indonesia, format panjang. */
function tanggalIndonesia(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Waktu lengkap bahasa Indonesia. */
function waktuIndonesia(ms = Date.now()) {
  return new Date(ms).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' WIB';
}

/**
 * Bangun email dari template terkompilasi.
 *
 * @param {string} nama     - kunci template (mis. 'reset_sandi')
 * @param {object} nilai    - nilai variabel
 * @param {object} [opsi]
 * @param {string} [opsi.judul]    - judul besar di kartu
 * @param {string[]} [opsi.mentah] - variabel yang isinya HTML (tidak di-escape)
 * @returns {{subjek: string, html: string, teks: string}}
 */
function bangun(nama, nilai = {}, { judul, mentah = [] } = {}) {
  const tpl = HTML_EMAIL[nama];

  if (!tpl) {
    throw new Error(
      `Template "${nama}" tidak ada. Yang tersedia: ${Object.keys(HTML_EMAIL).join(', ')}`
    );
  }

  const semuaNilai = { ...nilaiStandar({ judul }), ...nilai };

  const html = isiVariabel(tpl.html, semuaNilai, { mentah });

  // ── PEMERIKSAAN TERAKHIR ──────────────────────────────────────────────────
  // Kalau ada placeholder yang belum terisi, email akan sampai dengan
  // "{{nama}}" mentah — dan itu baru ketahuan dari keluhan pengguna, setelah
  // email tidak bisa ditarik kembali. Lebih baik gagal di sini.
  const sisa = placeholderTersisa(html);
  if (sisa.length) {
    throw new Error(
      `Template "${nama}" masih punya placeholder kosong: ${sisa.join(', ')}. ` +
      `Pemanggil harus mengirim nilai untuk variabel itu.`
    );
  }

  return {
    subjek: isiVariabel(tpl.subjek, semuaNilai),
    html,
    teks: isiVariabel(tpl.teks, semuaNilai),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── FUNGSI TEMPLATE — dipakai langsung oleh email.mjs ───────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export function templateResetSandi({ nama, tautan, berlakuMenit = 60 }) {
  return bangun('reset_sandi', {
    sapaan: sapaan(nama),
    tautan,
    berlaku_menit: String(berlakuMenit),
  }, {
    judul: 'Ganti sandi Anda',
    // `tautan` muncul di atribut href — TIDAK boleh di-escape sebagai teks,
    // karena `&` di query string akan jadi `&amp;` dan tautannya rusak.
    mentah: ['tautan'],
  });
}

export function templateKodeHapusAkun({ nama, kode, berlakuMenit = 15, sisaHari = 30 }) {
  return bangun('kode_hapus_akun', {
    sapaan: sapaan(nama),
    kode: String(kode),
    berlaku_menit: String(berlakuMenit),
    sisa_hari: String(sisaHari),
  }, {
    judul: 'Konfirmasi penghapusan akun',
  });
}

export function templateKodeBatalHapus({ nama, kode, berlakuMenit = 15, sisaHari }) {
  // Blok sisa hari bersifat opsional — hanya muncul kalau sisaHari diketahui.
  const blok = sisaHari
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0"><tr><td bgcolor="#1c1210" style="border-left:3px solid #f87171;border-radius:6px;padding:14px 16px"><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.6;color:#a1a1aa">Sisa waktu pemulihan: <strong style="color:#f4f4f6">${sisaHari} hari</strong>. Setelah masa itu berakhir, akun dan seluruh datanya dihapus permanen dan tidak bisa dipulihkan.</p></td></tr></table>`
    : '';

  return bangun('kode_batal_hapus', {
    sapaan: sapaan(nama),
    kode: String(kode),
    berlaku_menit: String(berlakuMenit),
    blok_sisa_hari: blok,
  }, {
    judul: 'Batalkan penghapusan akun',
    mentah: ['blok_sisa_hari'],
  });
}

export function templateSelamatDatang({ nama, email, tautanVerifikasi }) {
  const blok = tautanVerifikasi
    ? `<p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#a1a1aa">Konfirmasi alamat email Anda untuk mengamankan akun:</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0"><tr><td align="left"><a href="${tautanVerifikasi}" style="display:inline-block;padding:15px 30px;background:#f5c542;color:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;line-height:18px;text-decoration:none;border-radius:8px">Konfirmasi email</a></td></tr></table>`
    : '';

  return bangun('selamat_datang', {
    sapaan: sapaan(nama),
    email: email ?? '',
    tanggal: tanggalIndonesia(),
    blok_verifikasi: blok,
  }, {
    judul: 'Selamat datang di VIVASTIC',
    mentah: ['blok_verifikasi'],
  });
}

export function templateMasukPerangkatBaru({
  nama, perangkat, lokasi, ip, waktu, tautanAmankan,
}) {
  return bangun('masuk_perangkat_baru', {
    sapaan: sapaan(nama),
    perangkat: perangkat ?? 'Tidak dikenal',
    lokasi: lokasi ?? 'Tidak dikenal',
    ip: ip ?? '-',
    waktu: waktuIndonesia(waktu),
  }, {
    judul: 'Ada yang masuk ke akun Anda',
  });
}

export function templateStrukPembayaran({
  nama, email, nomorPesanan, paket, periode, jumlah, status = 'Lunas', waktu, tautanPesanan,
}) {
  return bangun('struk_pembayaran', {
    sapaan: sapaan(nama),
    email: email ?? '',
    nomor_pesanan: nomorPesanan,
    paket,
    periode,
    jumlah,
    status,
    waktu: waktuIndonesia(waktu),
  }, {
    judul: 'Pembayaran diterima',
  });
}

export function templateAkunDinonaktifkan({ nama, sisaHari = 30, tautanPulihkan }) {
  return bangun('akun_dinonaktifkan', {
    sapaan: sapaan(nama),
    sisa_hari: String(sisaHari),
  }, {
    judul: 'Akun Anda dinonaktifkan',
  });
}

export function templateKodeMasuk({ nama, kode, berlakuMenit = 10, lokasi, ip }) {
  const FONT_LOKAL = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  const blok = (lokasi || ip)
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0"><tr><td style="border:1px solid #26262c;border-radius:10px;padding:18px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
      + (lokasi ? `<tr><td style="padding:0;font-family:${FONT_LOKAL};font-size:14px;color:#9d9da8;vertical-align:top;width:45%">Lokasi</td><td style="padding:0;font-family:${FONT_LOKAL};font-size:14px;color:#f4f4f6;text-align:right;vertical-align:top">${lokasi}</td></tr>` : '')
      + (ip ? `<tr><td style="border-top:1px solid #1e1e23;padding:11px 0 0;font-family:${FONT_LOKAL};font-size:14px;color:#9d9da8;vertical-align:top;width:45%">Alamat IP</td><td style="border-top:1px solid #1e1e23;padding:11px 0 0;font-family:${FONT_LOKAL};font-size:14px;color:#f4f4f6;text-align:right;vertical-align:top">${ip}</td></tr>` : '')
      + `</table></td></tr></table>`
    : '';

  return bangun('kode_masuk', {
    sapaan: sapaan(nama),
    kode: String(kode),
    berlaku_menit: String(berlakuMenit),
    blok_lokasi: blok,
  }, {
    judul: 'Kode masuk Anda',
    mentah: ['blok_lokasi'],
  });
}

/** Daftar template yang tersedia — untuk diagnosa. */
export function daftarTemplate() {
  return Object.keys(HTML_EMAIL);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── TEMPLATE SIKLUS LANGGANAN ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// ── KENAPA EMPAT FUNGSI TERPISAH ────────────────────────────────────────────
// Setiap momen dalam siklus langganan butuh nada berbeda. Memakai satu fungsi
// untuk semuanya menghasilkan email yang salah konteks — lihat penjelasan
// lengkap di email-src/templates.mjml.mjs.

/** Tanggal saja (tanpa jam) — untuk tanggal berakhir langganan. */
function tanggalSaja(ms) {
  return new Date(ms).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Pengingat SEBELUM langganan berakhir — email paling penting di siklus ini.
 *
 * Tanpa ini, pelanggan baru tahu aksesnya habis saat ia gagal membuka
 * sesuatu. Pengalaman itu terasa seperti sistem rusak, bukan seperti
 * langganan yang perlu diperpanjang.
 */
export function templateLanggananAkanBerakhir({
  nama, paket, sisaHari, tanggalBerakhir, jumlah, tautanPerpanjang,
}) {
  return bangun('langganan_akan_berakhir', {
    sapaan: sapaan(nama),
    paket,
    sisa_hari: String(sisaHari),
    tanggal_berakhir: typeof tanggalBerakhir === 'number'
      ? tanggalSaja(tanggalBerakhir)
      : String(tanggalBerakhir ?? ''),
    jumlah: jumlah ?? '',
    tautan_perpanjang: tautanPerpanjang ?? 'https://victer.is-a.dev/pricing',
  }, {
    judul: 'Langganan Anda akan berakhir',
    mentah: ['tautan_perpanjang'],
  });
}

/** Pemberitahuan setelah langganan benar-benar berakhir (akses dijeda). */
export function templateLanggananBerakhir({ nama, paket, tanggalBerakhir, tautanPerpanjang }) {
  return bangun('langganan_berakhir', {
    sapaan: sapaan(nama),
    paket,
    tanggal_berakhir: typeof tanggalBerakhir === 'number'
      ? tanggalSaja(tanggalBerakhir)
      : String(tanggalBerakhir ?? ''),
    tautan_perpanjang: tautanPerpanjang ?? 'https://victer.is-a.dev/pricing',
  }, {
    judul: 'Langganan Anda sudah berakhir',
    mentah: ['tautan_perpanjang'],
  });
}

/** Konfirmasi perpanjangan berhasil. */
export function templateLanggananDiperpanjang({ nama, paket, tanggalBerakhir, nomorPesanan }) {
  return bangun('langganan_diperpanjang', {
    sapaan: sapaan(nama),
    paket,
    tanggal_berakhir: typeof tanggalBerakhir === 'number'
      ? tanggalSaja(tanggalBerakhir)
      : String(tanggalBerakhir ?? ''),
    nomor_pesanan: nomorPesanan ?? '',
  }, {
    judul: 'Langganan diperpanjang',
  });
}

/** Pemberitahuan pembayaran gagal — dengan jendela waktu perbaikan. */
export function templatePembayaranGagal({
  nama, paket, jumlah, alasan, sisaHari = 7, tautanBayar,
}) {
  return bangun('pembayaran_gagal', {
    sapaan: sapaan(nama),
    paket,
    jumlah: jumlah ?? '',
    alasan: alasan ?? 'Tidak diketahui',
    sisa_hari: String(sisaHari),
    tautan_bayar: tautanBayar ?? 'https://victer.is-a.dev/pricing',
  }, {
    judul: 'Pembayaran gagal',
    mentah: ['tautan_bayar'],
  });
}

/** Pengingat token akses yang mendekati kedaluwarsa. */
export function templateTokenAkanKedaluwarsa({
  nama, labelToken, sisaHari, tanggalKedaluwarsa,
}) {
  return bangun('token_akan_kedaluwarsa', {
    sapaan: sapaan(nama),
    label_token: labelToken ?? 'Token akses',
    sisa_hari: String(sisaHari),
    tanggal_kedaluwarsa: typeof tanggalKedaluwarsa === 'number'
      ? tanggalSaja(tanggalKedaluwarsa)
      : String(tanggalKedaluwarsa ?? ''),
  }, {
    judul: 'Token akses akan kedaluwarsa',
  });
}
