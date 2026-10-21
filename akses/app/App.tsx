import { useEffect, useRef, useState } from 'react';
import {
  RELEASE,
  discount,
  money,
  perMonth,
  usePenawaran,
  usePlanOrder,
  useReducedMotion,
  type Penawaran,
  type Plan,
} from './data';

/**
 * Halaman akses 3D. Tiga hal yang dijaga di sini:
 *
 *  1. Harga dan kebijakan berasal dari satu berkas data, bukan diketik ulang
 *     di JSX. Kalau angka berubah, yang berubah hanya berkas itu.
 *  2. Pembayaran ditutup selama aplikasi 3D belum siap. Tombolnya memang
 *     tidak bisa ditekan, dan alasannya ditulis, bukan disembunyikan.
 *  3. Tidak ada pratinjau palsu. Bagian "transaksi" menampilkan contoh yang
 *     diberi label contoh, dan keadaan kosong yang sebenarnya.
 */
export default function App() {
  const { state, reload } = usePenawaran();
  const reduced = useReducedMotion();
  const plans = usePlanOrder();
  const [selected, setSelected] = useState<'year' | 'lifetime'>('lifetime');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  return (
    <div className={`page${reduced ? ' page--still' : ''}`}>
      <a className="skip" href="#konten">Lompat ke konten</a>

      <header className="bar">
        <a className="bar__brand" href="/home.html">
          VIVASTIC
          <span className="bar__slash" aria-hidden="true">/</span>
          <span className="bar__sub">Akses 3D</span>
        </a>
        <nav className="bar__nav" aria-label="Navigasi halaman">
          <a href="#paket">Paket</a>
          <a href="#transaksi">Transaksi</a>
          <a href="#kebijakan">Kebijakan</a>
        </nav>
        <a className="bar__back" href="/home.html">
          Kembali ke portofolio
        </a>
      </header>

      <main id="konten">
        <section className="hero" aria-labelledby="judul">
          <div className="hero__copy">
            <p className="stage" role="status">
              <span className="stage__dot" aria-hidden="true" />
              {RELEASE.stage}
            </p>
            <h1 id="judul">
              Portofolio 3D,
              <br />
              satu akses.
            </h1>
            <p className="hero__lede">
              Satu halaman React yang menampilkan scene 3D, bukan halaman
              statis. Harga dan ketentuan sudah tetap; aplikasinya masih
              diselesaikan.
            </p>
            <div className="hero__actions">
              <a className="btn" href="#paket">Lihat paket</a>
              <a className="link" href="#transaksi">Cara transaksi</a>
            </div>
          </div>

          <div className="ledger" aria-label="Status rilis">
            <div className="ledger__row">
              <span className="ledger__key">Aplikasi 3D</span>
              <span className="ledger__val" data-tone="wait">Belum siap</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__key">Harga</span>
              <span className="ledger__val" data-tone="done">Final</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__key">Pembayaran</span>
              <span className="ledger__val" data-tone="wait">Ditutup</span>
            </div>
            <div className="ledger__row">
              <span className="ledger__key">Aset berlisensi</span>
              <span className="ledger__val" data-tone="wait">Sedang dikumpulkan</span>
            </div>
            <p className="ledger__note">{RELEASE.body}</p>
          </div>
        </section>

        <section className="band" id="paket" aria-labelledby="judul-paket">
          <header className="band__head">
            <h2 id="judul-paket">Pilih masa akses</h2>
            <p>
              Kedua paket membuka aplikasi yang sama. Yang berbeda hanya
              lamanya.
            </p>
          </header>

          {state.phase === 'loading' && <PricingSkeleton />}

          {state.phase === 'error' && (
            <div className="notice" role="alert">
              <h3>Harga tidak bisa dimuat</h3>
              <p>
                Berkas penawaran gagal dibaca ({state.message}). Tidak ada angka
                yang ditampilkan supaya tidak ada harga tebakan.
              </p>
              <button className="btn btn--ghost" type="button" onClick={reload}>
                Coba lagi
              </button>
            </div>
          )}

          {state.phase === 'ready' && (
            <div className="pricing">
              <fieldset className="plans">
                <legend className="sr-only">Pilih paket akses</legend>
                {plans.map((id) => {
                  const plan = state.data.plans[id];
                  return (
                    <label
                      key={id}
                      className={`plan${selected === id ? ' plan--on' : ''}`}
                    >
                      <input
                        type="radio"
                        name="paket"
                        value={id}
                        checked={selected === id}
                        onChange={() => setSelected(id)}
                      />
                      <span className="plan__head">
                        <span className="plan__name">{plan.name}</span>
                        {plan.badge && <span className="plan__badge">{plan.badge}</span>}
                      </span>
                      <span className="plan__price">
                        {money(plan.idr)}
                        {plan.anchorIdr > plan.idr && (
                          <s>{money(plan.anchorIdr)}</s>
                        )}
                      </span>
                      <span className="plan__meta">
                        {perMonth(plan)
                          ? `${money(perMonth(plan) as number)} per bulan`
                          : 'Sekali bayar'}
                        {discount(plan) > 0 ? ` · hemat ${discount(plan)}%` : ''}
                      </span>
                      <span className="plan__tagline">{plan.tagline}</span>
                      <ul className="plan__points">
                        {plan.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </label>
                  );
                })}
              </fieldset>

              <aside className="checkout" aria-label="Ringkasan pembayaran">
                <h3 className="checkout__title">Ringkasan</h3>
                <dl className="sum">
                  <div>
                    <dt>Paket</dt>
                    <dd>{state.data.plans[selected].name}</dd>
                  </div>
                  <div>
                    <dt>Harga</dt>
                    <dd>{money(state.data.plans[selected].idr)}</dd>
                  </div>
                  <div>
                    <dt>
                      Biaya QRIS
                      <span className="sum__hint">ditanggung VIVASTIC</span>
                    </dt>
                    <dd>{money(0)}</dd>
                  </div>
                  <div className="sum__total">
                    <dt>Total</dt>
                    <dd>{money(state.data.plans[selected].idr)}</dd>
                  </div>
                </dl>

                {/* Alasan ditulis SEBELUM tombol. Di bawah tombol, ia
                    terbaca sebagai catatan kaki dan pengunjung sudah
                    menyimpulkan sendiri kenapa tombolnya mati. */}
                <p className="checkout__why">{RELEASE.closedReason}</p>
                <button className="btn btn--wide" type="button" disabled>
                  {RELEASE.closedCta}
                </button>

                <button
                  className="btn btn--ghost btn--wide"
                  type="button"
                  onClick={() => copySummary(state.data, selected, setCopied, copyTimer)}
                >
                  {copied ? 'Ringkasan disalin' : 'Salin ringkasan harga'}
                </button>
                <p className="checkout__fine">
                  Ringkasan berguna kalau kamu ingin menanyakan paket ini lebih
                  dulu. Menyalin tidak membuat pesanan.
                </p>
                <p className="checkout__rate">
                  Kurs tampilan Rp{state.data.idr.toLocaleString('id-ID')} per USD.
                  Nominal transaksi ditentukan server saat pembayaran dibuka.
                </p>
              </aside>
            </div>
          )}
        </section>

        <section className="band" id="transaksi" aria-labelledby="judul-transaksi">
          <header className="band__head">
            <h2 id="judul-transaksi">Transaksi</h2>
            <p>
              Setelah pembayaran dibuka, setiap pesanan punya kode yang bisa
              dibaca ulang dan dicocokkan dengan mutasi bank.
            </p>
          </header>

          {state.phase === 'ready' && (
            <div className="tx-grid">
              <article className="tx tx--sample" aria-labelledby="tx-contoh">
                <p className="tx__label">Contoh tampilan</p>
                <h3 id="tx-contoh" className="tx__code">
                  {state.data.sampleOrder.code}
                </h3>
                <dl className="tx__facts">
                  <div>
                    <dt>Paket</dt>
                    <dd>{state.data.plans[state.data.sampleOrder.plan].name}</dd>
                  </div>
                  <div>
                    <dt>Nominal</dt>
                    <dd>{money(state.data.sampleOrder.amountIdr)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      Lunas <em>(contoh)</em>
                    </dd>
                  </div>
                </dl>
                <p className="tx__note">
                  Ini contoh bentuk pesanan setelah pembayaran dibuka, bukan
                  pesanan siapa pun. Kode asli diterbitkan server, bukan oleh
                  halaman ini.
                </p>
              </article>

              <article className="tx tx--empty" aria-labelledby="tx-kosong">
                <p className="tx__label">Pesananmu</p>
                <h3 id="tx-kosong">Belum ada transaksi</h3>
                <p className="tx__note">
                  Riwayat akan muncul di sini setelah pembayaran pertama. Belum
                  ada data akun yang diminta, jadi tidak ada yang bisa
                  ditampilkan sekarang.
                </p>
                <ul className="tx__steps">
                  <li>Pilih paket dan periksa totalnya.</li>
                  <li>Bayar lewat QRIS saat pembayaran dibuka.</li>
                  <li>Server memverifikasi, lalu menerbitkan kode akses.</li>
                </ul>
              </article>
            </div>
          )}
        </section>

        <section className="band" id="kebijakan" aria-labelledby="judul-kebijakan">
          <header className="band__head">
            <h2 id="judul-kebijakan">Kebijakan pembelian</h2>
            <p>
              Ditulis apa adanya, termasuk yang tidak didapat pembeli.
            </p>
          </header>

          {state.phase === 'ready' && (
            <div className="policy">
              {state.data.policy.lines.map((line) => (
                <article key={line.title} className="policy__item">
                  <h3>{line.title}</h3>
                  <p>{line.body}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="foot">
        <p>
          VIVASTIC. Halaman ini bagian dari portofolio, bukan toko terpisah.
        </p>
        <nav aria-label="Tautan kaki">
          <a href="/home.html">Beranda</a>
          <a href="/pricing">Harga layanan</a>
          <a href="/privasi">Privasi</a>
          <a href="/syarat">Syarat</a>
        </nav>
      </footer>
    </div>
  );
}

/** Menyalin ringkasan sebagai teks biasa, supaya bisa ditempel ke chat. */
function copySummary(
  data: Penawaran,
  plan: 'year' | 'lifetime',
  setCopied: (value: boolean) => void,
  timer: { current: number | null },
) {
  const chosen = data.plans[plan];
  const text = [
    `VIVASTIC ${chosen.name}`,
    `Harga: ${money(chosen.idr)}`,
    `Biaya QRIS: ${money(0)} (ditanggung merchant)`,
    `Total: ${money(chosen.idr)}`,
    `Status: ${RELEASE.stage}, pembayaran belum dibuka`,
  ].join('\n');

  const done = () => {
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2600);
  };

  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    return;
  }
  fallbackCopy(text, done);
}

/** Clipboard API butuh konteks aman; ini jalur cadangan untuk selain itu. */
function fallbackCopy(text: string, done: () => void) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    /* Menyalin gagal bukan kesalahan halaman: teksnya tetap terlihat di layar. */
  } finally {
    area.remove();
  }
}

function PricingSkeleton() {
  return (
    <div className="pricing" aria-hidden="true">
      <div className="plans">
        {[0, 1].map((i) => (
          <div key={i} className="plan plan--skeleton">
            <span className="sk sk--sm" />
            <span className="sk sk--lg" />
            <span className="sk sk--md" />
            <span className="sk sk--sm" />
          </div>
        ))}
      </div>
      <div className="checkout checkout--skeleton">
        <span className="sk sk--sm" />
        <span className="sk sk--lg" />
        <span className="sk sk--md" />
      </div>
    </div>
  );
}

export type { Plan };
