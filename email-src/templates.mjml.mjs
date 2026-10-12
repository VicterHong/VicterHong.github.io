/**
 * Sumber MJML untuk SEMUA email VIVASTIC.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA MJML, BUKAN HTML MENTAH ──────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Menulis HTML email manual berarti mengurus sendiri: tabel bersarang untuk
 * Outlook, komentar bersyarat VML untuk tombol, `mso-line-height-rule` untuk
 * jarak baris, lebar piksel yang konsisten di 600px, dan puluhan quirk lain
 * per klien email.
 *
 * MJML adalah bahasa markup yang dirancang khusus untuk itu. Compiler-nya
 * menghasilkan HTML tabel + komentar bersyarat yang sudah teruji di:
 * Outlook 2016-2024, Gmail (web/iOS/Android), Apple Mail, Yahoo, Samsung
 * Mail, Thunderbird, dan ProtonMail.
 *
 * Yang kita tulis cukup `<mj-section>`, `<mj-column>`, `<mj-button>` — dan
 * compiler mengurus sisa kerumitannya.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── VARIABEL: {{nama}} — DIISI SAAT KIRIM, BUKAN SAAT BUILD ─────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Template ini memakai placeholder `{{nama_variabel}}` yang diganti nilai
 * sebenarnya saat email dikirim. Contoh:
 *
 *   {{nama}}          → "Victer"
 *   {{kode}}          → "483920"
 *   {{tautan}}        → "https://victer.is-a.dev/reset-sandi?token=abc"
 *
 * Keuntungannya: satu template melayani semua penerima, dan isi yang berubah
 * (nama, kode, tautan, jumlah) tidak perlu ditulis ulang di HTML.
 *
 * ── KENAPA DIISI SAAT KIRIM, BUKAN SAAT BUILD ───────────────────────────────
 * Kalau variabel diganti saat build, setiap kombinasi nilai butuh file
 * terkompilasi sendiri — 8 template × jumlah penerima. Mustahil.
 * Dengan placeholder, compiler jalan SEKALI, dan penggantian nilai hanya
 * operasi teks di memori.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── CARA PAKAI ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/build-email.mjs      → kompilasi ke src/email/html.mjs
 *
 * Hasil kompilasi di-commit, jadi server TIDAK perlu MJML saat berjalan.
 * (Server berjalan tanpa node_modules — lihat catatan di scripts/build-email.mjs.)
 */

// ── Palet — sama dengan situs, supaya email dan halaman terasa satu produk ────
const WARNA = {
  latar: '#0a0a0b',
  kartu: '#16161a',
  kartuLembut: '#121214',
  garis: '#26262c',
  garisLembut: '#1e1e23',
  teks: '#f4f4f6',
  teksRedup: '#a1a1aa',
  teksSamar: '#9d9da8',
  emas: '#f5c542',
  hijau: '#34d399',
  merah: '#f87171',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Kerangka dasar — dipakai SEMUA template.
 *
 * ── KENAPA SATU KERANGKA, BUKAN TIAP TEMPLATE SENDIRI ───────────────────────
 * Kepala, kaki, dan gaya kartu harus identik di semua email. Kalau setiap
 * template menyusunnya sendiri, satu perubahan (mis. warna garis) harus
 * disalin ke 8 tempat — dan cepat atau lambat salah satunya terlewat.
 *
 * @param {object} opsi
 * @param {string} opsi.preheader - teks pratinjau di daftar masuk
 * @param {string} opsi.isi       - blok MJML bagian tengah
 * @param {string} [opsi.catatanKaki]
 */
function kerangka({ preheader, isi, catatanKaki = '' }) {
  return `<mjml>
  <mj-head>
    <mj-title>{{judul_email}}</mj-title>
    <mj-preview>${preheader}</mj-preview>

    <!--
      ── META UNTUK MODE GELAP ────────────────────────────────────────────────
      MJML TIDAK menghasilkan <meta name="color-scheme"> secara otomatis.
      Tanpa meta ini, klien email tertentu (Outlook mobile, Gmail Android)
      MEMBALIK warna email sendiri — hasilnya teks gelap di latar gelap dan
      isinya tidak terbaca.

      <mj-raw> menyisipkan HTML mentah ke <head> hasil kompilasi, melewati
      pemroses MJML. Ini satu-satunya cara menambahkan meta yang MJML tidak
      kenal.
    -->
    <mj-raw>
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <meta name="x-apple-disable-message-reformatting">
    </mj-raw>

    <mj-attributes>
      <mj-all font-family="${FONT}" />
      <mj-text color="${WARNA.teksRedup}" font-size="15px" line-height="1.65" padding="0 0 16px 0" />

      <!--
        ── TOMBOL: padding DALAM vs padding LUAR ──────────────────────────────
        Di MJML, atribut padding pada mj-button adalah jarak DI LUAR tombol
        (margin), bukan ruang di dalam tombol. Memberi nilai 15px 30px di
        situ hanya menambah jarak di sekeliling tombol — dan tombolnya
        sendiri jadi tipis karena tidak punya ruang dalam.

        Ruang di dalam tombol diatur oleh inner-padding. Nilai itu yang
        membuat tombol setinggi ~48px — di atas ambang 44px yang
        direkomendasikan Apple/Google untuk sasaran sentuh.

        padding 0 0 8px 0 = jarak 8px DI BAWAH tombol, supaya tidak menempel
        dengan paragraf berikutnya.
      -->
      <mj-button background-color="${WARNA.emas}" color="#0a0a0b" font-size="15px" font-weight="600"
                 border-radius="8px" padding="0 0 8px 0" inner-padding="15px 30px" align="left" />
    </mj-attributes>

    <mj-style>
      /* Tautan di footer: lebih redup dari isi, tapi tetap jelas bisa diklik */
      .tautan-kaki a { color: ${WARNA.teksRedup} !important; text-decoration: underline !important; }
      .tautan-kaki { color: ${WARNA.teksSamar} !important; }
    </mj-style>
  </mj-head>

  <mj-body background-color="${WARNA.latar}" width="600px">

    <!-- Kepala: logo + nama perusahaan -->
    <mj-section padding="40px 0 0 0">
      <mj-column>
        <mj-table padding="0 0 0 32px">
          <tr>
            <td width="36" height="36" bgcolor="${WARNA.emas}"
                style="width:36px;height:36px;border-radius:10px;text-align:center;vertical-align:middle;font-family:${FONT};font-size:18px;font-weight:700;color:#0a0a0b;line-height:36px">
              <img src="https://victer.is-a.dev/assets/img/vivastic-mark-72.png"
                   width="36" height="36" alt=""
                   style="display:block;width:36px;height:36px;border:0;border-radius:10px" />
            </td>
            <td style="padding-left:12px;vertical-align:middle;font-family:${FONT};font-size:15px;font-weight:600;color:${WARNA.teks};letter-spacing:0.06em">
              VIVASTIC
            </td>
          </tr>
        </mj-table>
      </mj-column>
    </mj-section>

    <!-- Kartu isi -->
    <mj-section background-color="${WARNA.kartu}" border-radius="14px" border="1px solid ${WARNA.garis}"
                padding="28px 32px 8px 32px">
      <mj-column>
        <mj-text color="${WARNA.teks}" font-size="23px" font-weight="600" line-height="1.3"
                 letter-spacing="-0.02em" padding="0 0 20px 0">
          {{judul}}
        </mj-text>
${isi}
      </mj-column>
    </mj-section>

    <!-- Catatan kaki di dalam kartu -->
    <mj-section background-color="${WARNA.kartu}" border-radius="0 0 14px 14px"
                padding="8px 32px 28px 32px" border-left="1px solid ${WARNA.garis}"
                border-right="1px solid ${WARNA.garis}" border-bottom="1px solid ${WARNA.garis}">
      <mj-column>
        <mj-divider border-color="${WARNA.garisLembut}" border-width="1px" padding="0 0 20px 0" />
${catatanKaki ? `        <mj-text font-size="13px" color="${WARNA.teksSamar}" padding="0 0 12px 0">${catatanKaki}</mj-text>` : ''}
        <mj-text font-size="12px" color="${WARNA.teksSamar}" padding="0">
          Email otomatis dari VIVASTIC. Pesan ini dikirim karena ada aktivitas pada akun Anda — mohon jangan dibalas.
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- Kaki halaman di luar kartu -->
    <mj-section padding="28px 0 40px 0">
      <mj-column>
        <mj-text align="center" font-size="12px" color="${WARNA.teksSamar}" padding="0 0 14px 0"
                 letter-spacing="0.02em">
          Layanan pengembangan perangkat lunak
        </mj-text>
        <mj-text align="center" font-size="12px" color="${WARNA.teksSamar}" padding="0 0 14px 0"
                 css-class="tautan-kaki">
          <a href="https://victer.is-a.dev/docs">Panduan</a> &nbsp;·&nbsp;
          <a href="https://victer.is-a.dev/privasi">Kebijakan privasi</a> &nbsp;·&nbsp;
          <a href="https://victer.is-a.dev/keamanan">Keamanan</a>
        </mj-text>
        <mj-text align="center" font-size="12px" color="${WARNA.teksSamar}" padding="0">
          © {{tahun}} VIVASTIC
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── TEMPLATE — satu per alur ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/** Kotak kode besar (OTP) — dipakai beberapa template. */
function kotakKode() {
  return `        <mj-table padding="0 0 24px 0">
          <tr>
            <td align="center" bgcolor="${WARNA.kartuLembut}"
                style="border:1px solid ${WARNA.garis};border-radius:10px;padding:20px 16px">
              <div style="font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${WARNA.emas};line-height:1">
                {{kode}}
              </div>
            </td>
          </tr>
        </mj-table>`;
}

/** Kotak catatan (info / peringatan / sukses). */
function kotakCatatan({ teks, jenis = 'info' }) {
  const gaya = {
    info: { garis: WARNA.garis, latar: WARNA.kartuLembut, aksen: WARNA.teksSamar },
    peringatan: { garis: '#7c2d12', latar: '#1c1210', aksen: WARNA.merah },
    sukses: { garis: '#064e3b', latar: '#0f1a17', aksen: WARNA.hijau },
  }[jenis] ?? { garis: WARNA.garis, latar: WARNA.kartuLembut, aksen: WARNA.teksSamar };

  return `        <mj-table padding="0 0 24px 0">
          <tr>
            <td bgcolor="${gaya.latar}" style="border-left:3px solid ${gaya.aksen};border-radius:6px;padding:14px 16px">
              <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${WARNA.teksRedup}">${teks}</p>
            </td>
          </tr>
        </mj-table>`;
}

/** Tabel detail (label kiri, nilai kanan) — untuk struk. */
function tabelDetail(baris) {
  const isi = baris.map(([label, nilai], i) => {
    const garis = i === 0 ? '' : `border-top:1px solid ${WARNA.garisLembut};`;
    return `          <tr>
            <td style="${garis}padding:11px 0 0;font-family:${FONT};font-size:14px;color:${WARNA.teksSamar};vertical-align:top;width:45%">${label}</td>
            <td style="${garis}padding:11px 0 0;font-family:${FONT};font-size:14px;color:${WARNA.teks};text-align:right;vertical-align:top">${nilai}</td>
          </tr>`;
  }).join('\n');

  return `        <mj-table padding="0 0 24px 0">
          <tr>
            <td style="border:1px solid ${WARNA.garis};border-radius:10px;padding:18px 20px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${isi}
              </table>
            </td>
          </tr>
        </mj-table>`;
}

// ── Daftar template ───────────────────────────────────────────────────────────
//
// Setiap entri: nama, variabel yang WAJIB ada, dan fungsi yang menghasilkan
// MJML. `variabelWajib` dipakai generator untuk memastikan setiap placeholder
// yang dipakai template benar-benar dikirim pemanggil — tanpa itu, email
// sampai dengan "{{nama}}" mentah di dalamnya.

export const TEMPLATE = {

  reset_sandi: {
    subjek: 'Ganti sandi akun VIVASTIC Anda',
    variabelWajib: ['nama', 'tautan', 'berlaku_menit'],
    mjml: () => kerangka({
      preheader: 'Tautan ganti sandi — berlaku {{berlaku_menit}} menit dan hanya bisa dipakai sekali',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Kami menerima permintaan untuk mengganti sandi akun VIVASTIC Anda. Klik tombol di bawah untuk membuat sandi baru.</mj-text>
        <mj-button href="{{tautan}}" padding="0 0 20px 0">Buat sandi baru</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}" padding="0 0 8px 0">
          Tautan ini berlaku <strong style="color:${WARNA.teks}">{{berlaku_menit}} menit</strong> dan hanya bisa dipakai sekali.
        </mj-text>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kalau Anda tidak meminta ini, abaikan email ini — sandi Anda tidak berubah dan akun Anda tetap aman.
        </mj-text>
${kotakCatatan({
        teks: `Tombol tidak bekerja? Salin tautan ini ke peramban:<br><span style="color:${WARNA.teksSamar};word-break:break-all">{{tautan}}</span>`,
        jenis: 'info',
      })}`,
    }),
  },

  kode_hapus_akun: {
    subjek: 'Kode konfirmasi penghapusan akun VIVASTIC',
    variabelWajib: ['nama', 'kode', 'berlaku_menit', 'sisa_hari'],
    mjml: () => kerangka({
      preheader: 'Kode: {{kode}} — berlaku {{berlaku_menit}} menit. Abaikan kalau Anda tidak meminta ini.',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Kami menerima permintaan untuk <strong style="color:${WARNA.teks}">menghapus akun VIVASTIC Anda</strong>. Masukkan kode di bawah untuk melanjutkan.</mj-text>
${kotakKode()}
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kode berlaku <strong style="color:${WARNA.teks}">{{berlaku_menit}} menit</strong>. Jangan bagikan kode ini kepada siapa pun — staf VIVASTIC tidak pernah memintanya.
        </mj-text>
${kotakCatatan({
        teks: `<strong style="color:${WARNA.merah}">Ini bukan penghapusan langsung.</strong> Setelah dikonfirmasi, akun Anda dinonaktifkan dan masih bisa dipulihkan selama <strong>{{sisa_hari}} hari</strong>. Setelah masa itu, seluruh data dihapus permanen.`,
        jenis: 'peringatan',
      })}
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kalau Anda tidak meminta penghapusan, abaikan email ini. Akun Anda tidak akan berubah, dan kami sarankan Anda segera mengganti sandi.
        </mj-text>
        <mj-text font-size="13px" color="${WARNA.teksSamar}" padding="0 0 8px 0">Ingin memeriksa aktivitas akun Anda dulu?</mj-text>
        <mj-button href="https://victer.is-a.dev/keamanan" background-color="${WARNA.kartu}" color="${WARNA.teks}"
                   border="1px solid ${WARNA.garis}" padding="0 0 8px 0">Buka pengaturan keamanan</mj-button>`,
      catatanKaki: 'Anda menerima email ini karena ada permintaan penghapusan akun dari perangkat Anda.',
    }),
  },

  kode_batal_hapus: {
    subjek: 'Kode pembatalan penghapusan akun VIVASTIC',
    variabelWajib: ['nama', 'kode', 'berlaku_menit'],
    mjml: () => kerangka({
      preheader: 'Kode: {{kode}} — pakai untuk memulihkan akun Anda',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Akun VIVASTIC Anda sedang dalam masa tenggang penghapusan. Masukkan kode di bawah untuk <strong style="color:${WARNA.teks}">membatalkan penghapusan</strong> dan memulihkan akun Anda.</mj-text>
${kotakKode()}
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kode berlaku <strong style="color:${WARNA.teks}">{{berlaku_menit}} menit</strong>.
        </mj-text>
        <mj-raw>{{blok_sisa_hari}}</mj-raw>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">Kalau Anda memang ingin menghapus akun, abaikan email ini.</mj-text>`,
    }),
  },

  selamat_datang: {
    subjek: 'Selamat datang di VIVASTIC — konfirmasi email Anda',
    variabelWajib: ['nama', 'email'],
    mjml: () => kerangka({
      preheader: 'Satu langkah lagi — konfirmasi alamat email Anda',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Terima kasih telah mendaftar. Akun Anda sudah dibuat dan siap dipakai.</mj-text>
        <mj-raw>{{blok_verifikasi}}</mj-raw>
${tabelDetail([
        ['Email akun', '{{email}}'],
        ['Tanggal daftar', '{{tanggal}}'],
        ['Status', `<span style="color:${WARNA.hijau}">Aktif</span>`],
      ])}
        <mj-text padding="0 0 10px 0">Apa yang bisa Anda lakukan sekarang:</mj-text>
        <mj-table padding="0 0 20px 0">
          <tr><td style="padding:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.6;color:${WARNA.teksRedup}"><span style="color:${WARNA.emas}">›</span>&nbsp; Kelola proyek dan token akses Anda</td></tr>
          <tr><td style="padding:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.6;color:${WARNA.teksRedup}"><span style="color:${WARNA.emas}">›</span>&nbsp; Aktifkan verifikasi 2 langkah untuk keamanan tambahan</td></tr>
          <tr><td style="padding:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.6;color:${WARNA.teksRedup}"><span style="color:${WARNA.emas}">›</span>&nbsp; Pantau aktivitas masuk akun Anda</td></tr>
        </mj-table>
        <mj-button href="https://victer.is-a.dev/keamanan" background-color="${WARNA.kartu}" color="${WARNA.teks}"
                   border="1px solid ${WARNA.garis}" padding="0 0 8px 0">Buka dasbor</mj-button>`,
    }),
  },

  masuk_perangkat_baru: {
    subjek: 'Masuk baru ke akun VIVASTIC Anda',
    variabelWajib: ['nama', 'perangkat', 'lokasi', 'waktu'],
    mjml: () => kerangka({
      preheader: '{{perangkat}} · {{lokasi}}',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Kami mendeteksi masuk ke akun VIVASTIC Anda dari perangkat yang belum pernah dipakai.</mj-text>
${tabelDetail([
        ['Waktu', '{{waktu}}'],
        ['Perangkat', '{{perangkat}}'],
        ['Lokasi', '{{lokasi}}'],
        ['Alamat IP', '{{ip}}'],
      ])}
${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Apakah ini Anda?</strong> Kalau ya, tidak ada yang perlu dilakukan. Kalau bukan, segera amankan akun Anda — ganti sandi dan cabut semua sesi yang tidak dikenal.`,
        jenis: 'peringatan',
      })}
        <mj-button href="https://victer.is-a.dev/keamanan" padding="0 0 8px 0">Amankan akun saya</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Sesi yang tidak dikenal bisa Anda cabut dari halaman Keamanan.
        </mj-text>`,
      catatanKaki: 'Anda menerima email ini karena email keamanan selalu dikirim untuk masuk dari perangkat baru.',
    }),
  },

  struk_pembayaran: {
    subjek: 'Struk pembayaran {{nomor_pesanan}} — VIVASTIC',
    variabelWajib: ['nama', 'nomor_pesanan', 'paket', 'periode', 'jumlah', 'waktu', 'email'],
    mjml: () => kerangka({
      preheader: '{{paket}} · {{jumlah}} · {{nomor_pesanan}}',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Terima kasih. Pembayaran Anda sudah kami terima dan akses Anda sudah aktif.</mj-text>
${kotakCatatan({
        teks: `<strong style="color:${WARNA.hijau}">✓ {{status}}</strong> — akses {{paket}} sudah bisa dipakai sekarang.`,
        jenis: 'sukses',
      })}
${tabelDetail([
        ['Nomor pesanan', `<span style="font-family:monospace;font-size:13px">{{nomor_pesanan}}</span>`],
        ['Paket', '{{paket}}'],
        ['Periode', '{{periode}}'],
        ['Tanggal', '{{waktu}}'],
        ['Email akun', '{{email}}'],
        ['Total', `<strong style="color:${WARNA.emas};font-size:16px">{{jumlah}}</strong>`],
      ])}
        <mj-button href="https://victer.is-a.dev/pesanan" padding="0 0 8px 0">Lihat pesanan</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">Simpan email ini sebagai bukti pembayaran Anda.</mj-text>`,
      catatanKaki: 'Pertanyaan tentang tagihan? Balas email ini atau hubungi kami lewat pusat bantuan.',
    }),
  },

  akun_dinonaktifkan: {
    subjek: 'Akun VIVASTIC Anda dinonaktifkan sementara',
    variabelWajib: ['nama', 'sisa_hari'],
    mjml: () => kerangka({
      preheader: 'Masih bisa dipulihkan dalam {{sisa_hari}} hari',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Permintaan penghapusan akun VIVASTIC Anda sudah kami terima. Akun Anda kini dinonaktifkan.</mj-text>
${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Anda masih punya waktu {{sisa_hari}} hari.</strong> Selama masa ini, akun dan seluruh data Anda masih tersimpan dan bisa dipulihkan sepenuhnya.`,
        jenis: 'peringatan',
      })}
        <mj-text>Setelah masa tenggang berakhir, akun beserta seluruh data — proyek, token, riwayat — akan dihapus permanen dan tidak bisa dikembalikan.</mj-text>
        <mj-button href="https://victer.is-a.dev/pemulihan" padding="0 0 8px 0">Pulihkan akun saya</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">Kalau Anda memang ingin menghapus akun, tidak ada yang perlu dilakukan.</mj-text>`,
    }),
  },

  kode_masuk: {
    subjek: 'Kode masuk VIVASTIC: {{kode}}',
    variabelWajib: ['nama', 'kode', 'berlaku_menit'],
    mjml: () => kerangka({
      preheader: '{{kode}} — berlaku {{berlaku_menit}} menit',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Gunakan kode berikut untuk menyelesaikan proses masuk ke akun VIVASTIC Anda.</mj-text>
${kotakKode()}
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kode berlaku <strong style="color:${WARNA.teks}">{{berlaku_menit}} menit</strong>. Jangan bagikan kode ini kepada siapa pun.
        </mj-text>
        <mj-raw>{{blok_lokasi}}</mj-raw>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Kalau Anda tidak merasa mencoba masuk, abaikan email ini dan pertimbangkan mengganti sandi Anda.
        </mj-text>`,
    }),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ── SIKLUS LANGGANAN ─────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ── KENAPA EMPAT TEMPLATE, BUKAN SATU ─────────────────────────────────────
  //
  // Langganan punya EMPAT momen berbeda, dan pengguna butuh hal berbeda di
  // masing-masing:
  //
  //   1. Akan berakhir  → kesempatan memperpanjang dengan tenang
  //   2. Sudah berakhir → akses terputus, butuh jalan kembali SEGERA
  //   3. Sudah perpanjang → konfirmasi, supaya tidak ada keraguan
  //   4. Gagal bayar    → masalah pembayaran, butuh tindakan spesifik
  //
  // Memakai satu template untuk semuanya menghasilkan email yang salah nada:
  // "perpanjang sekarang!" saat langganan masih 7 hari lagi terasa mendesak
  // tanpa alasan, dan "langganan Anda akan berakhir" setelah aksesnya mati
  // terasa tidak nyambung.
  //
  // ── YANG PALING PENTING: PENGINGAT SEBELUM BERAKHIR ───────────────────────
  // Tanpa email ini, pelanggan baru tahu aksesnya habis saat ia gagal membuka
  // sesuatu — dan pengalaman itu terasa seperti sistem rusak, bukan seperti
  // langganan yang perlu diperpanjang.

  langganan_akan_berakhir: {
    subjek: 'Langganan {{paket}} Anda berakhir dalam {{sisa_hari}} hari',
    variabelWajib: ['nama', 'paket', 'sisa_hari', 'tanggal_berakhir', 'jumlah'],
    mjml: () => kerangka({
      preheader: 'Berakhir {{tanggal_berakhir}} — perpanjang untuk tetap punya akses',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>
          Langganan <strong style="color:${WARNA.teks}">{{paket}}</strong> Anda akan berakhir
          dalam <strong style="color:${WARNA.emas}">{{sisa_hari}} hari</strong>.
        </mj-text>
${tabelDetail([
        ['Paket', '{{paket}}'],
        ['Berakhir pada', '{{tanggal_berakhir}}'],
        ['Perpanjangan', '{{jumlah}}'],
      ])}
        <mj-text>
          Kalau Anda perpanjang sekarang, akses Anda berlanjut tanpa jeda —
          token dan konfigurasi yang sudah ada tetap bekerja, tidak perlu
          diatur ulang.
        </mj-text>
        <mj-button href="{{tautan_perpanjang}}">Perpanjang sekarang</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Tidak ada yang perlu dilakukan kalau Anda memang ingin berhenti —
          akses akan berakhir sendiri pada tanggal di atas.
        </mj-text>`,
      catatanKaki: 'Anda menerima email ini karena langganan Anda akan berakhir. Kami kirim lebih awal supaya Anda punya waktu memutuskan.',
    }),
  },

  langganan_berakhir: {
    subjek: 'Langganan {{paket}} Anda sudah berakhir',
    variabelWajib: ['nama', 'paket', 'tanggal_berakhir'],
    mjml: () => kerangka({
      preheader: 'Akses Anda dijeda — aktifkan kembali kapan saja',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>
          Langganan <strong style="color:${WARNA.teks}">{{paket}}</strong> Anda berakhir
          pada <strong style="color:${WARNA.teks}">{{tanggal_berakhir}}</strong>.
          Akses ke fitur berlangganan kini <strong style="color:${WARNA.merah}">dijeda</strong>.
        </mj-text>
${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Data Anda tidak dihapus.</strong> Proyek, konfigurasi, dan riwayat tetap tersimpan. Begitu Anda mengaktifkan kembali, semuanya tersedia seperti sebelumnya.`,
        jenis: 'info',
      })}
        <mj-text>
          Tidak ada batas waktu untuk kembali. Kalau nanti Anda butuh lagi,
          cukup aktifkan kembali dari halaman langganan.
        </mj-text>
        <mj-button href="{{tautan_perpanjang}}">Aktifkan kembali</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Punya pertanyaan sebelum memutuskan? Balas email ini — kami bantu.
        </mj-text>`,
      catatanKaki: 'Anda menerima email ini karena langganan Anda berakhir hari ini.',
    }),
  },

  langganan_diperpanjang: {
    subjek: 'Langganan {{paket}} Anda aktif sampai {{tanggal_berakhir}}',
    variabelWajib: ['nama', 'paket', 'tanggal_berakhir', 'nomor_pesanan'],
    mjml: () => kerangka({
      preheader: 'Terima kasih — akses Anda berlanjut tanpa jeda',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>Terima kasih sudah memperpanjang. Langganan Anda sudah aktif kembali.</mj-text>
${kotakCatatan({
        teks: `<strong style="color:${WARNA.hijau}">✓ Aktif</strong> — akses {{paket}} Anda berlanjut sampai {{tanggal_berakhir}}.`,
        jenis: 'sukses',
      })}
${tabelDetail([
        ['Paket', '{{paket}}'],
        ['Aktif sampai', '{{tanggal_berakhir}}'],
        ['Nomor pesanan', `<span style="font-family:monospace;font-size:13px">{{nomor_pesanan}}</span>`],
      ])}
        <mj-text>
          Token dan konfigurasi Anda tidak berubah — tidak ada yang perlu
          diatur ulang.
        </mj-text>
        <mj-button href="https://victer.is-a.dev/pesanan" background-color="${WARNA.kartu}" color="${WARNA.teks}"
                   border="1px solid ${WARNA.garis}">Lihat detail pesanan</mj-button>`,
      catatanKaki: 'Simpan email ini sebagai bukti perpanjangan langganan Anda.',
    }),
  },

  pembayaran_gagal: {
    subjek: 'Pembayaran langganan {{paket}} Anda gagal',
    variabelWajib: ['nama', 'paket', 'jumlah', 'alasan'],
    mjml: () => kerangka({
      preheader: 'Akses Anda masih aktif — perbaiki pembayaran dalam {{sisa_hari}} hari',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>
          Kami tidak berhasil memproses pembayaran langganan
          <strong style="color:${WARNA.teks}">{{paket}}</strong> Anda.
        </mj-text>
${tabelDetail([
        ['Paket', '{{paket}}'],
        ['Jumlah', `<strong style="color:${WARNA.emas}">{{jumlah}}</strong>`],
        ['Alasan', '{{alasan}}'],
      ])}
${kotakCatatan({
        teks: `<strong style="color:${WARNA.teks}">Akses Anda masih aktif.</strong> Anda punya waktu {{sisa_hari}} hari untuk memperbaiki pembayaran sebelum akses dijeda.`,
        jenis: 'peringatan',
      })}
        <mj-text>
          Cara paling cepat: buat pesanan baru dengan metode pembayaran yang
          berbeda. Akses Anda tetap berjalan selama proses ini.
        </mj-text>
        <mj-button href="{{tautan_bayar}}">Bayar ulang</mj-button>
        <mj-text font-size="13px" color="${WARNA.teksSamar}">
          Sudah membayar tapi masih menerima email ini? Balas dengan bukti
          transfer — kami periksa dan perbaiki.
        </mj-text>`,
      catatanKaki: 'Anda menerima email ini karena ada masalah pembayaran pada langganan Anda.',
    }),
  },

  token_akan_kedaluwarsa: {
    subjek: 'Token akses Anda kedaluwarsa dalam {{sisa_hari}} hari',
    variabelWajib: ['nama', 'label_token', 'sisa_hari', 'tanggal_kedaluwarsa'],
    mjml: () => kerangka({
      preheader: 'Token "{{label_token}}" berakhir {{tanggal_kedaluwarsa}}',
      isi: `        <mj-text>{{sapaan}}</mj-text>
        <mj-text>
          Token akses <strong style="color:${WARNA.teks}">{{label_token}}</strong>
          akan kedaluwarsa dalam <strong style="color:${WARNA.emas}">{{sisa_hari}} hari</strong>.
        </mj-text>
${tabelDetail([
        ['Token', '{{label_token}}'],
        ['Kedaluwarsa', '{{tanggal_kedaluwarsa}}'],
      ])}
${kotakCatatan({
        teks: 'Token yang kedaluwarsa berhenti bekerja otomatis. Kalau ada integrasi yang memakainya, integrasi itu akan gagal pada tanggal tersebut.',
        jenis: 'peringatan',
      })}
        <mj-text>
          Perbarui atau ganti token dari halaman token akses sebelum tanggal
          itu supaya tidak ada layanan yang terputus.
        </mj-text>
        <mj-button href="https://victer.is-a.dev/keamanan">Kelola token akses</mj-button>`,
      catatanKaki: 'Anda menerima email ini karena ada token akses yang mendekati kedaluwarsa.',
    }),
  },

};

/** Warna & font diekspor supaya generator bisa memakainya untuk versi teks. */
export const META = { WARNA, FONT };
