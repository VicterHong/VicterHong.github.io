/**
 * Decoder CBOR minimal — cukup untuk membaca struktur WebAuthn.
 *
 * ── KENAPA DITULIS SENDIRI ───────────────────────────────────────────────────
 * WebAuthn mengirim attestationObject dan COSE public key dalam format CBOR
 * (RFC 8949). Pustaka CBOR pihak ketiga menambah dependency yang harus
 * dipercaya dan dirawat — padahal yang dibutuhkan hanya sebagian kecil format:
 * integer, byte string, text string, array, dan map.
 *
 * Decoder ini SENGAJA menolak apa pun di luar kebutuhan itu. Menolak lebih
 * baik daripada menebak: input yang tidak dikenal berarti data yang tidak
 * kita mengerti, dan memprosesnya justru berbahaya.
 *
 * ── YANG TIDAK DIDUKUNG (dan kenapa aman) ────────────────────────────────────
 * Tag (major type 6), indefinite-length, dan float tidak muncul di struktur
 * WebAuthn yang kita baca. Kalau muncul, decoder melempar — dan pemanggil
 * memperlakukannya sebagai verifikasi gagal, bukan sebagai data valid.
 */

/** Melempar dengan pesan yang menyebut posisi — memudahkan penelusuran. */
function gagal(pesan, offset) {
  throw new Error(`CBOR: ${pesan} (offset ${offset})`);
}

/**
 * Decode satu nilai CBOR dari buffer.
 *
 * Mengembalikan { nilai, akhir } — `akhir` adalah offset setelah nilai,
 * supaya pemanggil bisa membaca nilai berikutnya (attestationObject berisi
 * map, lalu sisa buffer harus habis).
 */
export function decodeSatu(buf, mulai = 0) {
  if (mulai >= buf.length) gagal('buffer habis', mulai);

  const awal = buf[mulai];
  const major = awal >> 5;
  const info = awal & 0x1f;
  let pos = mulai + 1;

  // ── Panjang/argumen tambahan ───────────────────────────────────────────────
  // info 0-23  : nilai langsung
  // info 24    : 1 byte berikutnya
  // info 25    : 2 byte
  // info 26    : 4 byte
  // info 27    : 8 byte
  // info 31    : indefinite — tidak didukung
  let panjang;
  if (info < 24) {
    panjang = info;
  } else if (info === 24) {
    if (pos + 1 > buf.length) gagal('butuh 1 byte panjang', pos);
    panjang = buf[pos];
    pos += 1;
  } else if (info === 25) {
    if (pos + 2 > buf.length) gagal('butuh 2 byte panjang', pos);
    panjang = buf.readUInt16BE(pos);
    pos += 2;
  } else if (info === 26) {
    if (pos + 4 > buf.length) gagal('butuh 4 byte panjang', pos);
    panjang = buf.readUInt32BE(pos);
    pos += 4;
  } else if (info === 27) {
    if (pos + 8 > buf.length) gagal('butuh 8 byte panjang', pos);
    // Nilai > 2^53 tidak bisa diwakili Number dengan aman. Untuk WebAuthn
    // (signCount 32-bit, panjang array kecil) ini tidak pernah terjadi.
    const besar = buf.readBigUInt64BE(pos);
    if (besar > BigInt(Number.MAX_SAFE_INTEGER)) gagal('integer terlalu besar', pos);
    panjang = Number(besar);
    pos += 8;
  } else {
    gagal(`panjang tidak didukung (info ${info})`, mulai);
  }

  switch (major) {
    case 0: // unsigned integer
      return { nilai: panjang, akhir: pos };

    case 1: // negative integer: -1 - n
      return { nilai: -1 - panjang, akhir: pos };

    case 2: { // byte string
      if (pos + panjang > buf.length) gagal('byte string melebihi buffer', pos);
      const nilai = buf.subarray(pos, pos + panjang);
      return { nilai, akhir: pos + panjang };
    }

    case 3: { // text string
      if (pos + panjang > buf.length) gagal('text string melebihi buffer', pos);
      const nilai = buf.toString('utf8', pos, pos + panjang);
      return { nilai, akhir: pos + panjang };
    }

    case 4: { // array
      const nilai = [];
      let p = pos;
      for (let i = 0; i < panjang; i += 1) {
        const item = decodeSatu(buf, p);
        nilai.push(item.nilai);
        p = item.akhir;
      }
      return { nilai, akhir: p };
    }

    case 5: { // map
      const nilai = new Map();
      let p = pos;
      for (let i = 0; i < panjang; i += 1) {
        const kunci = decodeSatu(buf, p);
        const isi = decodeSatu(buf, kunci.akhir);
        nilai.set(kunci.nilai, isi.nilai);
        p = isi.akhir;
      }
      return { nilai, akhir: p };
    }

    case 7: // simple value / float
      // true (21), false (20), null (22) muncul sebagai nilai sederhana.
      // Float tidak dipakai WebAuthn; kalau muncul, kita tolak.
      if (info === 20) return { nilai: false, akhir: pos };
      if (info === 21) return { nilai: true, akhir: pos };
      if (info === 22) return { nilai: null, akhir: pos };
      gagal(`simple value ${info} tidak didukung`, mulai);
      break;

    default:
      gagal(`major type ${major} tidak didukung`, mulai);
  }

  // Tidak tercapai — semua cabang di atas mengembalikan atau melempar.
  gagal('struktur tidak dikenal', mulai);
}

/** Decode buffer CBOR menjadi satu nilai. Sisa byte setelahnya diabaikan. */
export function decode(buf) {
  return decodeSatu(buf, 0).nilai;
}
