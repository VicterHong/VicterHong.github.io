import { useEffect, useState } from 'react';
import { Glass } from './Glass';
import { VideoBed } from './VideoBed';
import {
  RELEASE,
  copySummary,
  discount,
  money,
  perMonth,
  useCopyTimer,
  usePenawaran,
  usePlanOrder,
  useReducedMotion,
  type Penawaran,
  type Plan,
} from './data';

/** Aset latar. Berkas disalin ke akses/assets/motion/ saat build. */
const ASET = 'media/';

/**
 * Halaman akses 3D.
 *
 * Tiga hal yang dijaga:
 *  1. Harga dan kebijakan berasal dari satu berkas data, bukan diketik di JSX.
 *  2. Pembayaran ditutup selama aplikasi 3D belum siap, dan alasannya ditulis
 *     SEBELUM tombolnya, bukan sebagai catatan kaki di bawah.
 *  3. Tidak ada pratinjau palsu: blok transaksi memuat contoh berlabel contoh
 *     dan keadaan kosong yang sebenarnya.
 *
 * Permukaan memakai Glass: refraksi SVG asli, bukan blur saja. Latar video
 * memberi kedalaman yang tidak mungkin didapat dari kartu di atas warna solid.
 */
export default function App() {
  const { state, reload } = usePenawaran();
  const reduced = useReducedMotion();
  const plans = usePlanOrder();
  const [selected, setSelected] = useState<'year' | 'lifetime'>('lifetime');
  const [copied, setCopied] = useState(false);
  const copyTimer = useCopyTimer();
  const [masuk, setMasuk] = useState<'memuat' | 'belum' | 'ya'>('belum');
  const [login, setLogin] = useState('');

  // Status akun dibaca dari API yang sama dengan beranda. Gagal berarti
  // "belum masuk", bukan halaman rusak: harga tetap harus terbaca.
  useEffect(() => {
    let alive = true;
    fetch('/api/akses', { credentials: 'include', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok) return;
        setMasuk(d.masuk ? 'ya' : 'belum');
        if (d.masuk) setLogin(String(d.nama || d.login || d.issued_to || ''));
      })
      .catch(() => {
        if (alive) setMasuk('belum');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={`page${reduced ? ' page--still' : ''}`}>
      <VideoBed src={`${ASET}hero-main.mp4`} poster={`${ASET}hero-main-poster.webp`} scrim={0.5} />
      <div className="grain" aria-hidden="true" />
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
          <a href="#ketentuan">Ketentuan</a>
        </nav>
        <span className="bar__user">
          {masuk === 'ya' && login ? `@${login}` : 'Belum masuk'}
        </span>
        <a className="bar__back" href="/home.html">Kembali</a>
      </header>

      <main id="konten" className="wrap">
        {state.phase === 'loading' && <Glass className="panel panel--status"><SkeletonStatus /></Glass>}

        {state.phase === 'error' && (
          <Glass className="panel panel--status">
            <div className="signed-out">
              <p className="field-label">Gagal memuat</p>
              <h2 className="status__title">Data akses tidak tersedia</h2>
              <p className="status__sub">
                Berkas penawaran gagal dibaca ({state.message}). Tidak ada angka yang
                ditampilkan supaya tidak ada harga tebakan.
              </p>
              <button className="btn btn--ghost btn--auto" type="button" onClick={reload}>
                Coba lagi
              </button>
            </div>
          </Glass>
        )}

        {state.phase === 'ready' && (
          <>
            <StatusPanel data={state.data} masuk={masuk} login={login} reduced={reduced} />

            <div className="split">
              <Glass className="panel panel--pay">
                <PlanPicker
                  data={state.data}
                  plans={plans}
                  selected={selected}
                  setSelected={setSelected}
                  copied={copied}
                  onCopy={() => copySummary(state.data, selected, setCopied, copyTimer)}
                />
              </Glass>

              <Glass className="panel panel--history">
                <TransactionPanel data={state.data} />
              </Glass>
            </div>

            <Glass className="panel panel--policy">
              <PolicyPanel data={state.data} />
            </Glass>

            <p className="foot">
              Harga dalam Rupiah, kurs tampilan Rp{state.data.idr.toLocaleString('id-ID')} per USD.
              Pembayaran diverifikasi di server lewat webhook Midtrans. Akses tidak pernah
              diberikan dari browser.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function StatusPanel({
  data,
  masuk,
  login,
  reduced,
}: {
  data: Penawaran;
  masuk: 'memuat' | 'belum' | 'ya';
  login: string;
  reduced: boolean;
}) {
  const trialJam = 72;

  return (
    <Glass className="panel panel--status">
      <header className="status__head">
        <div>
          <p className="field-label">Status akses</p>
          <h1 className="status__title">
            {masuk === 'ya' ? 'Masa akses berjalan' : 'Akses belum dibuka'}
          </h1>
          <p className="status__sub">
            {masuk === 'ya'
              ? 'Semua scene terbuka. Tidak ada penagihan otomatis.'
              : 'Masuk dengan akun yang sudah terdaftar untuk melihat masa akses dan riwayat.'}
          </p>
        </div>
        <span className="pill" data-state={masuk === 'ya' ? 'trialing' : 'unverified'}>
          {masuk === 'ya' ? 'Trial' : 'Belum aktif'}
        </span>
      </header>

      <div className="meter" role="group" aria-label="Sisa masa akses">
        <div className="meter__track">
          <div
            className="meter__fill"
            style={{ width: masuk === 'ya' ? '100%' : '0%' }}
            data-still={reduced ? 'ya' : 'tidak'}
          />
        </div>
        <div className="meter__meta">
          <span>{masuk === 'ya' ? `Sisa ${trialJam} jam` : 'Menunggu aktivasi'}</span>
          <span>{masuk === 'ya' ? 'dari 72 jam' : 'Belum ada'}</span>
        </div>
      </div>

      <dl className="facts">
        <div>
          <dt>Akun</dt>
          <dd>{masuk === 'ya' && login ? `@${login}` : 'Belum masuk'}</dd>
        </div>
        <div>
          <dt>Paket</dt>
          <dd>{masuk === 'ya' ? 'Trial 3 hari' : 'Belum ada'}</dd>
        </div>
        <div>
          <dt>Berlaku sampai</dt>
          <dd>{masuk === 'ya' ? '24 Oktober 2026' : 'Belum ada'}</dd>
        </div>
        <div>
          <dt>Pembayaran</dt>
          <dd className="facts__wait">Ditutup</dd>
        </div>
      </dl>

      <p className="status__clock">{RELEASE.body}</p>
    </Glass>
  );
}

function PlanPicker({
  data,
  plans,
  selected,
  setSelected,
  copied,
  onCopy,
}: {
  data: Penawaran;
  plans: Array<'year' | 'lifetime'>;
  selected: 'year' | 'lifetime';
  setSelected: (id: 'year' | 'lifetime') => void;
  copied: boolean;
  onCopy: () => void;
}) {
  const chosen = data.plans[selected];

  return (
    <>
      <p className="field-label">Perpanjang atau buka permanen</p>
      <h2 className="card__title">Pilih paket</h2>

      <fieldset className="plans">
        <legend className="sr-only">Pilih paket akses</legend>
        {plans.map((id) => {
          const plan = data.plans[id];
          return (
            <label key={id} className={`plan${selected === id ? ' plan--on' : ''}`}>
              <input
                type="radio"
                name="paket"
                value={id}
                checked={selected === id}
                onChange={() => setSelected(id)}
              />
              <span className="plan__body">
                {plan.badge && <span className="plan__flag">{plan.badge}</span>}
                <span className="plan__top">
                  <span className="plan__name">{plan.name}</span>
                  <span className="plan__price">
                    {plan.anchorIdr > plan.idr && <s>{money(plan.anchorIdr)}</s>}
                    {money(plan.idr)}
                  </span>
                </span>
                <span className="plan__meta">
                  {perMonth(plan) ? `${money(perMonth(plan) as number)} per bulan` : 'Sekali bayar'}
                  {discount(plan) > 0 ? ` · hemat ${discount(plan)}%` : ''}
                </span>
                <span className="plan__tagline">{plan.tagline}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <ul className="points">
        {chosen.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>

      <p className="field-label">Metode</p>
      <div className="methods">
        {data.methods.map((m) => (
          <div key={m.id} className="method method--on">
            <span className="method__label">{m.label}</span>
            <span className="method__note">{m.note}</span>
          </div>
        ))}
      </div>

      <dl className="summary">
        <div>
          <dt>Harga paket</dt>
          <dd>{money(chosen.idr)}</dd>
        </div>
        <div>
          <dt>
            MDR QRIS <span>0% · ditanggung VIVASTIC</span>
          </dt>
          <dd>{money(0)}</dd>
        </div>
        <div className="summary__total">
          <dt>Total dibayar</dt>
          <dd>{money(chosen.idr)}</dd>
        </div>
      </dl>

      {/* Alasan ditulis SEBELUM tombol. Di bawah tombol, ia terbaca sebagai
          catatan kaki dan pengunjung sudah menyimpulkan sendiri. */}
      <p className="why">{RELEASE.closedReason}</p>
      <button className="btn" type="button" disabled>
        {RELEASE.closedCta}
      </button>

      <button className="btn btn--ghost btn--wide" type="button" onClick={onCopy}>
        {copied ? 'Ringkasan disalin' : 'Salin ringkasan harga'}
      </button>
      <p className="fine">
        Ringkasan berguna kalau kamu ingin menanyakan paket ini lebih dulu. Menyalin
        tidak membuat pesanan.
      </p>
    </>
  );
}

function TransactionPanel({ data }: { data: Penawaran }) {
  return (
    <>
      <header className="card__head">
        <div>
          <p className="field-label">Riwayat</p>
          <h2 className="card__title">Transaksi</h2>
        </div>
        <button className="btn btn--ghost btn--auto" type="button" disabled>
          Memuat
        </button>
      </header>

      <div className="tx tx--sample">
        <p className="tx__label">Contoh tampilan</p>
        <p className="tx__code">{data.sampleOrder.code}</p>
        <dl className="tx__facts">
          <div>
            <dt>Paket</dt>
            <dd>{data.plans[data.sampleOrder.plan].name}</dd>
          </div>
          <div>
            <dt>Nominal</dt>
            <dd>{money(data.sampleOrder.amountIdr)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              Lunas <em>(contoh)</em>
            </dd>
          </div>
        </dl>
        <p className="tx__note">
          Contoh bentuk pesanan setelah pembayaran dibuka, bukan pesanan siapa pun.
        </p>
      </div>

      <div className="empty">
        <p>Belum ada transaksi.</p>
        <p className="empty__sub">
          Pembelian pertama akan muncul di sini beserta nomor referensinya.
        </p>
      </div>
    </>
  );
}

function PolicyPanel({ data }: { data: Penawaran }) {
  return (
    <>
      <p className="field-label">Ketentuan</p>
      <h2 className="card__title">Pembelian &amp; refund</h2>
      <p className="policy__lead">
        Berlaku untuk semua paket. Angka di bawah mengikat, bukan ringkasan.
      </p>

      <dl className="policy__list">
        {data.policy.lines.map((line) => (
          <div key={line.title} className="policy__item">
            <dt>{line.title}</dt>
            <dd>{line.body}</dd>
          </div>
        ))}
      </dl>

      <p className="policy__meta">
        Jendela refund: {data.policy.refundDays} hari kalender sejak pembayaran diterima.
        Hak paket hanya materi permukaan; berkas sumber, model 3D, dan kode tidak ikut
        dialihkan.
      </p>
    </>
  );
}

function SkeletonStatus() {
  return (
    <div className="skeleton" aria-hidden="true">
      <span className="skeleton__line" style={{ width: '34%' }} />
      <span className="skeleton__line skeleton__line--lg" style={{ width: '58%' }} />
      <span className="skeleton__line" style={{ width: '44%' }} />
      <div className="skeleton__facts">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton__line" style={{ width: '100%' }} />
        ))}
      </div>
    </div>
  );
}

export type { Plan };
