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

/** Aset latar. Berkas disalin ke akses/media/ saat build. */
const ASET = 'media/';

/**
 * Halaman akses 3D, versi ringkas.
 *
 * Tiga panel: status, paket, pertanyaan. Riwayat transaksi dan ketentuan tidak
 * punya panel sendiri karena keduanya belum punya isi yang bisa ditampilkan.
 * Ketentuannya masuk FAQ, tempat orang benar-benar mencarinya.
 *
 * Tidak ada nama akun, sisa jam, atau tanggal berakhir yang ditulis di sini.
 * Semuanya bergantung pada data akun yang belum tersedia, dan angka karangan
 * membuat halaman terbaca palsu.
 */
export default function App() {
  const { state, reload } = usePenawaran();
  const reduced = useReducedMotion();
  const plans = usePlanOrder();
  const [selected, setSelected] = useState<'year' | 'lifetime'>('lifetime');
  const [copied, setCopied] = useState(false);
  const copyTimer = useCopyTimer();
  const [aktif, setAktif] = useState(false);

  // Status akun dibaca dari API yang sama dengan beranda. Gagal berarti
  // "belum aktif", bukan halaman rusak: harga tetap harus terbaca.
  useEffect(() => {
    let alive = true;
    fetch('/api/akses', { credentials: 'include', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setAktif(Boolean(d?.ok && d.masuk && d.berbayar));
      })
      .catch(() => {
        /* Diam: status akun bukan syarat untuk membaca harga. */
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
          <a href="#tanya">Pertanyaan</a>
        </nav>
        <a className="bar__back" href="/home.html">Kembali</a>
      </header>

      <main id="konten" className="wrap">
        {state.phase === 'loading' && (
          <Glass className="panel panel--status">
            <SkeletonStatus />
          </Glass>
        )}

        {state.phase === 'error' && (
          <Glass className="panel panel--status">
            <p className="field-label">Gagal memuat</p>
            <h2 className="status__title">Harga tidak bisa dimuat</h2>
            <p className="status__sub">
              Berkas penawaran gagal dibaca ({state.message}). Tidak ada angka yang
              ditampilkan supaya tidak ada harga tebakan.
            </p>
            <button className="btn btn--ghost btn--auto" type="button" onClick={reload}>
              Coba lagi
            </button>
          </Glass>
        )}

        {state.phase === 'ready' && (
          <>
            <StatusPanel aktif={aktif} />

            <Glass className="panel panel--pay" as="section">
              <PlanPicker
                data={state.data}
                plans={plans}
                selected={selected}
                setSelected={setSelected}
                copied={copied}
                onCopy={() => copySummary(state.data, selected, setCopied, copyTimer)}
              />
            </Glass>

            <Glass className="panel panel--faq" as="section">
              <Faq data={state.data} />
            </Glass>

            <p className="foot">
              Harga dalam Rupiah, kurs tampilan Rp{state.data.idr.toLocaleString('id-ID')} per USD.
              Pembayaran diverifikasi di server lewat webhook Midtrans.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function StatusPanel({ aktif }: { aktif: boolean }) {
  return (
    <Glass className="panel panel--status">
      <header className="status__head">
        <div>
          <p className="field-label">Status</p>
          <h1 className="status__title">
            {aktif ? 'Akses aktif' : 'Aplikasi 3D belum siap dipakai'}
          </h1>
          <p className="status__sub">
            {aktif
              ? 'Semua scene terbuka. Tidak ada penagihan otomatis.'
              : 'Harga dan ketentuan di halaman ini sudah final. Pembayaran dibuka setelah aplikasinya lolos uji di perangkat nyata.'}
          </p>
        </div>
        <span className="pill" data-state={aktif ? 'trialing' : 'unverified'}>
          {aktif ? 'Aktif' : 'Dalam pengembangan'}
        </span>
      </header>

      <dl className="facts">
        <div>
          <dt>Aplikasi</dt>
          <dd>{aktif ? 'Terbuka' : 'Belum siap'}</dd>
        </div>
        <div>
          <dt>Harga</dt>
          <dd>Final</dd>
        </div>
        <div>
          <dt>Pembayaran</dt>
          <dd className="facts__wait">Ditutup</dd>
        </div>
        <div>
          <dt>Aset 3D</dt>
          <dd className="facts__wait">Sedang dikumpulkan</dd>
        </div>
      </dl>
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
      <p className="field-label">Paket</p>
      <h2 className="card__title">Pilih masa akses</h2>

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

      <dl className="summary">
        <div>
          <dt>Harga paket</dt>
          <dd>{money(chosen.idr)}</dd>
        </div>
        <div>
          <dt>
            Biaya QRIS <span>ditanggung VIVASTIC</span>
          </dt>
          <dd>{money(0)}</dd>
        </div>
        <div className="summary__total">
          <dt>Total</dt>
          <dd>{money(chosen.idr)}</dd>
        </div>
      </dl>

      {/* Alasan ditulis SEBELUM tombol. Di bawah tombol, ia terbaca sebagai
          catatan kaki dan pembaca sudah menyimpulkan sendiri. */}
      <p className="why">{RELEASE.closedReason}</p>
      <button className="btn" type="button" disabled>
        {RELEASE.closedCta}
      </button>

      <button className="btn btn--ghost btn--wide" type="button" onClick={onCopy}>
        {copied ? 'Ringkasan disalin' : 'Salin ringkasan harga'}
      </button>
      <p className="fine">Menyalin tidak membuat pesanan.</p>
    </>
  );
}

/** FAQ menyerap ketentuan, metode bayar, dan status aset. Satu tempat untuk
 *  pertanyaan yang benar-benar muncul sebelum membeli. */
function Faq({ data }: { data: Penawaran }) {
  const items = [
    {
      q: 'Kapan pembayaran dibuka?',
      a: 'Setelah aplikasi 3D lolos uji di perangkat nyata. Yang berubah hanya tombolnya, bukan nominal paket.',
    },
    {
      q: 'Apa yang didapat pembeli?',
      a: 'Akses ke aplikasi 3D selama masa paket. Berkas sumber, model 3D, tekstur, dan kode tidak ikut dialihkan.',
    },
    {
      q: 'Bagaimana cara membayar?',
      a: 'QRIS lewat Midtrans. Biaya QRIS ditanggung VIVASTIC, jadi nominal yang dibayar sama dengan harga paket.',
    },
    {
      q: 'Bisa refund?',
      a: `Bisa, penuh, sampai ${data.policy.refundDays} hari kalender setelah pembayaran diterima. Lewat dari itu pembelian final.`,
    },
    {
      q: 'Apakah diperpanjang otomatis?',
      a: 'Tidak. Akses berhenti di tanggal yang tertera tanpa penarikan dana tambahan.',
    },
    {
      q: 'Kenapa aset 3D masih dikumpulkan?',
      a: 'Aset premium berlisensi komersial sedang dipilih satu per satu. Halaman ini tidak memakai model pengganti buatan sendiri.',
    },
  ];

  return (
    <>
      <p className="field-label">Pertanyaan</p>
      <h2 className="card__title">Sebelum membeli</h2>

      <div className="faq">
        {items.map((item) => (
          <details key={item.q} className="faq__item">
            <summary className="faq__q">{item.q}</summary>
            <p className="faq__a">{item.a}</p>
          </details>
        ))}
      </div>
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
