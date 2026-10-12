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
// ══════════════════════════════════════════════════════════════════════════════
// ── PALET: SURFACE LADDER, BUKAN DUA WARNA ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// ── MASALAH DESAIN SEBELUMNYA ───────────────────────────────────────────────
// Versi lama hanya punya DUA tingkat permukaan: latar (#0a0a0b) dan kartu
// (#16161a). Akibatnya semua elemen duduk di bidang yang sama rata — dan
// email terasa datar, seperti template yang dipakai apa adanya.
//
// ── YANG DILAKUKAN SISTEM DESAIN MAHAL (Linear, Vercel, Stripe) ─────────────
// Mereka memakai TANGGA PERMUKAAN: 4-5 tingkat gelap yang sangat berdekatan.
// Hierarki dibangun dari perbedaan tingkat itu + garis rambut (hairline),
// BUKAN dari bayangan (yang tidak didukung Outlook).
//
//   Linear: kanvas #010102 → panel #0f1011 → #141516 → #18191a → #191a1b
//
// Perbedaannya halus (2-3% kecerahan) tapi mata membacanya sebagai kedalaman.
// Inilah yang membuat desain terasa "dirancang" vs "datar".
//
// ── KENAPA DARK-NYA BIRU SEDIKIT, BUKAN HITAM MURNI ────────────────────────
// Linear memakai #010102 (sedikit biru), bukan #000000. Hitam murni terasa
// mati; sedikit warna membuat latar terasa seperti material, bukan lubang.
// Kita pakai sedikit hangat (bukan biru) karena brand kita emas.
const WARNA = {
  // ── Tangga permukaan (4 tingkat + kanvas) ────────────────────────────────
  kanvas: '#08080a',        // paling luar — sedikit lebih dalam dari sebelumnya
  latar: '#0a0a0b',         // badan email
  permukaan1: '#111113',    // kartu dalam / kotak kode
  permukaan2: '#16161a',    // kartu utama
  permukaan3: '#1c1c21',    // elemen di atas kartu (tombol sekunder, sel)
  kartuLembut: '#111113',   // alias lama → permukaan1

  // ── Garis rambut (hairline) ──────────────────────────────────────────────
  // Tiga tingkat, seperti Linear. Garis tipis yang lebih terang dari latar
  // memberi batas tanpa perlu bayangan.
  garisHalus: '#1a1a1f',
  garisLembut: '#232329',
  garis: '#2e2e36',

  // ── Teks ─────────────────────────────────────────────────────────────────
  teks: '#f5f5f7',
  teksRedup: '#a8a8b3',
  teksSamar: '#9d9da8',
  teksBisu: '#6e6e78',      // untuk metadata paling kecil

  // ── Aksen ────────────────────────────────────────────────────────────────
  emas: '#f5c542',
  emasTerang: '#ffd970',
  emasGelap: '#c9a02c',
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

    <!--
      ══════════════════════════════════════════════════════════════════════════
      ── GRADIENT ATMOSFERIK DI ATAS ──────────────────────────────────────────
      ══════════════════════════════════════════════════════════════════════════

      Ini yang paling membedakan email "dirancang" dari "template". Stripe
      memakai gradient mesh, Linear memakai radial glow halus di belakang
      konten. Efeknya: latar tidak terasa seperti bidang mati.

      ── CARA KERJA DI EMAIL ──────────────────────────────────────────────────
      Gradient CSS (radial-gradient) TIDAK didukung Outlook. Tapi bukan
      berarti tidak bisa dipakai:

        • Gmail, Apple Mail, Yahoo, Thunderbird, iOS/Android → gradient tampil
        • Outlook → melihat warna solid sebagai cadangan

      Jadi gradient ditulis di properti background, dan bgcolor tetap
      diisi warna solid. Klien yang tidak paham gradient mengabaikannya dan
      memakai warna solid — tidak ada yang rusak.

      Gradient-nya SANGAT halus (emas 7% opacity memudar dalam 420px).
      Kalau terlihat jelas, itu sudah salah — tujuannya kesan "hangat dari
      atas", bukan hiasan.
    -->
    <mj-section padding="0" background-color="${WARNA.latar}">
      <mj-column padding="0">
        <mj-raw>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WARNA.latar}"
                 style="background-image:radial-gradient(ellipse 420px 220px at 50% -60px, rgba(245,197,66,0.07) 0%, rgba(245,197,66,0.02) 40%, rgba(10,10,11,0) 70%);">
            <tr><td height="1" style="height:1px;line-height:1px;font-size:0">&nbsp;</td></tr>
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>

    <!-- Kepala: logo + nama perusahaan -->
    <mj-section padding="44px 0 0 0">
      <mj-column>
        <mj-table padding="0 0 0 32px">
          <tr>
            <td width="38" height="38" bgcolor="${WARNA.emas}"
                style="width:38px;height:38px;border-radius:11px;text-align:center;vertical-align:middle;font-family:${FONT};font-size:19px;font-weight:700;color:#0a0a0b;line-height:38px">
              <img src="https://victer.is-a.dev/assets/img/vivastic-mark-72.png"
                   width="38" height="38" alt=""
                   style="display:block;width:38px;height:38px;border:0;border-radius:11px" />
            </td>
            <td style="padding-left:13px;vertical-align:middle;font-family:${FONT};font-size:15px;font-weight:600;color:${WARNA.teks};letter-spacing:0.14em">
              VIVASTIC
            </td>
          </tr>
        </mj-table>
      </mj-column>
    </mj-section>

    <!--
      ══════════════════════════════════════════════════════════════════════════
      ── KARTU UTAMA: TIGA LAPIS, BUKAN SATU BIDANG RATA ─────────────────────
      ══════════════════════════════════════════════════════════════════════════

      ── MASALAH SEBELUMNYA ───────────────────────────────────────────────────
      Kartu lama cuma satu <mj-section> dengan border. Rata, tanpa kedalaman.

      ── YANG DILAKUKAN SEKARANG ──────────────────────────────────────────────
      Tiga lapis yang saling menumpuk, masing-masing 2-3% lebih terang:

        1. Bingkai luar   (permukaan1) — memberi "ketebalan" pada kartu
        2. Kartu isi      (permukaan2) — bidang utama
        3. Sel elemen     (permukaan3) — untuk kotak kode, tabel detail

      Plus GARIS AKSEN EMAS 2px di tepi atas kartu. Satu detail kecil ini
      yang membuat kartu terasa "punya identitas" — dipakai Stripe, Linear,
      dan hampir semua produk yang desainnya dianggap mahal.

      ── KENAPA TANPA BAYANGAN (box-shadow) ───────────────────────────────────
      Outlook tidak mendukung box-shadow sama sekali. Hierarki dibangun dari
      perbedaan tingkat permukaan + garis rambut, bukan bayangan — jadi
      terlihat sama baik di Outlook maupun Gmail.
    -->

    <!-- Lapis 1: bingkai luar — memberi ketebalan -->
    <mj-section background-color="${WARNA.permukaan1}" border-radius="18px"
                padding="1px" css-class="bingkai-kartu">
      <mj-column padding="0">
        <!--
          ── KENAPA TIDAK mj-section DI DALAM mj-column ──────────────────────
          MJML melarang <mj-section> di dalam <mj-column> — section hanya boleh
          di dalam mj-body atau mj-wrapper. Kedalaman bertingkat dibuat dengan
          mj-table mentah, bukan dengan section bersarang.
        -->
        <mj-table padding="0">
          <tr>
            <td bgcolor="${WARNA.permukaan2}" style="border-radius:17px;padding:0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="2" style="height:2px;line-height:2px;font-size:0;background:linear-gradient(90deg, rgba(245,197,66,0) 0%, ${WARNA.emas} 18%, ${WARNA.emasTerang} 50%, ${WARNA.emas} 82%, rgba(245,197,66,0) 100%);">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:30px 32px 0 32px">
                    <div style="font-family:${FONT};font-size:24px;font-weight:600;line-height:1.28;letter-spacing:-0.025em;color:${WARNA.teks};margin:0 0 22px 0">
                      {{judul}}
                    </div>
                    ${isi}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:4px 32px 30px 32px">
                    <div style="border-top:1px solid ${WARNA.garisHalus};padding-top:18px">
${catatanKaki ? `                      <p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.6;color:${WARNA.teksSamar}">${catatanKaki}</p>` : ''}
                      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.teksBisu}">
                        Email otomatis dari VIVASTIC. Pesan ini dikirim karena ada aktivitas pada akun Anda — mohon jangan dibalas.
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </mj-table>
      </mj-column>
    </mj-section>

    <!-- Kaki halaman di luar kartu -->
    <mj-section padding="30px 0 44px 0">
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

/**
 * Kotak kode besar (OTP) — dipakai beberapa template.
 *
 * ── KENAPA TAMPILANNYA DIUBAH ───────────────────────────────────────────────
 * Versi lama: kotak abu rata dengan border 1px. Fungsional, tapi terlihat
 * seperti input form biasa.
 *
 * Versi baru:
 *   • Latar LEBIH GELAP dari kartu (permukaan1, bukan permukaan2) — kode
 *     terasa "masuk ke dalam" kartu, bukan menempel di atasnya
 *   • Garis aksen emas di tepi atas — mengaitkan kotak dengan brand
 *   • Huruf monospace 34px dengan letter-spacing 10px — angka terpisah jelas
 *   • Border 1px yang lebih halus + radius 12px
 */
function kotakKode() {
  return `        <mj-table padding="0 0 26px 0">
          <tr>
            <td align="center" bgcolor="${WARNA.permukaan1}"
                style="border:1px solid ${WARNA.garisHalus};border-radius:12px;padding:0;overflow:hidden">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="2" style="height:2px;line-height:2px;font-size:0;background:linear-gradient(90deg, rgba(245,197,66,0) 0%, rgba(245,197,66,0.55) 50%, rgba(245,197,66,0) 100%);">&nbsp;</td>
                </tr>
              </table>
              <div style="font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${WARNA.emas};line-height:1;padding:22px 16px 24px 16px;text-indent:10px">
                {{kode}}
              </div>
            </td>
          </tr>
        </mj-table>`;
}

/**
 * Kotak catatan (info / peringatan / sukses).
 *
 * ── PERUBAHAN ───────────────────────────────────────────────────────────────
 * Sebelumnya: latar abu seragam untuk semua jenis, hanya warna garis yang
 * berbeda. Akibatnya catatan "peringatan" dan "info" terlihat hampir sama.
 *
 * Sekarang: setiap jenis punya latar berwarna sendiri yang SANGAT redup
 * (bukan abu netral) — peringatan terasa hangat-merah, sukses terasa
 * hijau dingin. Perbedaan itu terbaca sekilas tanpa perlu membaca teksnya.
 */
function kotakCatatan({ teks, jenis = 'info' }) {
  const gaya = {
    info: { latar: WARNA.permukaan1, aksen: WARNA.teksBisu, teks: WARNA.teksRedup },
    peringatan: { latar: '#171010', aksen: WARNA.merah, teks: '#e8c4c4' },
    sukses: { latar: '#0d1614', aksen: WARNA.hijau, teks: '#c4e8dc' },
  }[jenis] ?? { latar: WARNA.permukaan1, aksen: WARNA.teksBisu, teks: WARNA.teksRedup };

  return `        <mj-table padding="0 0 26px 0">
          <tr>
            <td bgcolor="${gaya.latar}" style="border-left:2px solid ${gaya.aksen};border-radius:0 8px 8px 0;padding:15px 18px">
              <p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.65;color:${gaya.teks}">${teks}</p>
            </td>
          </tr>
        </mj-table>`;
}

/**
 * Tabel detail (label kiri, nilai kanan) — untuk struk dan ringkasan.
 *
 * ── PERUBAHAN ───────────────────────────────────────────────────────────────
 * Sebelumnya: border 1px penuh mengelilingi, latar transparan.
 * Sekarang: latar LEBIH GELAP dari kartu (permukaan1) tanpa border penuh —
 * hanya garis pemisah antar baris. Terasa seperti panel data, bukan tabel
 * yang ditempel.
 *
 * Label memakai huruf kapital kecil dengan letter-spacing — pola yang dipakai
 * Stripe untuk metadata: terbaca sebagai "keterangan", bukan "isi".
 */
function tabelDetail(baris) {
  const isi = baris.map(([label, nilai], i) => {
    const garis = i === 0 ? '' : `border-top:1px solid ${WARNA.garisHalus};`;
    return `          <tr>
            <td style="${garis}padding:12px 0 0;font-family:${FONT};font-size:12px;color:${WARNA.teksBisu};vertical-align:top;width:44%;text-transform:uppercase;letter-spacing:0.07em">${label}</td>
            <td style="${garis}padding:12px 0 0;font-family:${FONT};font-size:14px;color:${WARNA.teks};text-align:right;vertical-align:top">${nilai}</td>
          </tr>`;
  }).join('\n');

  return `        <mj-table padding="0 0 26px 0">
          <tr>
            <td bgcolor="${WARNA.permukaan1}" style="border:1px solid ${WARNA.garisHalus};border-radius:12px;padding:20px 22px">
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
        <mj-button href="https://victer.is-a.dev/keamanan" background-color="${WARNA.permukaan3}" color="${WARNA.teks}"
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
        <mj-button href="https://victer.is-a.dev/keamanan" background-color="${WARNA.permukaan3}" color="${WARNA.teks}"
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
        <mj-button href="https://victer.is-a.dev/pesanan" background-color="${WARNA.permukaan3}" color="${WARNA.teks}"
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
