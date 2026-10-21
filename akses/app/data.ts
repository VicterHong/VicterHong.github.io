import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Bentuk data dari akses/data/penawaran.json. Satu sumber untuk halaman ini. */
export type Plan = {
  name: string;
  tagline: string;
  idr: number;
  anchorIdr: number;
  months: number | null;
  badge?: string;
  points: string[];
};

export type Method = { id: string; label: string; note: string };

export type PolicyLine = { title: string; body: string };

export type Penawaran = {
  idr: number;
  note: string;
  plans: Record<'year' | 'lifetime', Plan>;
  methods: Method[];
  policy: { refundDays: number; lines: PolicyLine[] };
  sampleOrder: { code: string; plan: 'year' | 'lifetime'; amountIdr: number };
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const money = (value: number) => rupiah.format(Math.round(value || 0));

export const perMonth = (plan: Plan) =>
  plan.months ? Math.round(plan.idr / plan.months) : null;

export const discount = (plan: Plan) =>
  plan.anchorIdr > plan.idr
    ? Math.round((1 - plan.idr / plan.anchorIdr) * 100)
    : 0;

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; data: Penawaran }
  | { phase: 'error'; message: string };

/**
 * Memuat penawaran sekali. Gagal berarti halaman menampilkan keadaan error
 * yang jelas, bukan harga kosong atau angka tebakan.
 */
export function usePenawaran() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetch(new URL('data/penawaran.json', document.baseURI), {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as Penawaran;
      if (!data?.plans?.year || !data?.plans?.lifetime) throw new Error('data_tidak_lengkap');
      setState({ phase: 'ready', data });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'tidak_diketahui',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}

/** Apakah pengunjung meminta gerak dikurangi. Dipakai untuk mematikan transisi. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}

/** Satu tempat untuk memutuskan apa yang boleh dikatakan tentang status rilis. */
export const RELEASE = {
  stage: 'Dalam pengembangan',
  headline: 'Portofolio 3D sedang dibangun.',
  body:
    'Harga, alur pembayaran, dan riwayat transaksi di halaman ini sudah final. ' +
    'Pembayaran belum dibuka karena aplikasi 3D-nya belum siap dipakai.',
  paymentsOpen: false,
  closedCta: 'Pembayaran belum dibuka',
  closedReason:
    'Tombol pembayaran aktif setelah aplikasi 3D lolos uji di perangkat nyata. ' +
    'Harga di bawah tidak akan berubah saat itu.',
} as const;

export const ORDER_STATUS: Record<string, string> = {
  paid: 'Lunas',
  pending: 'Menunggu',
  failed: 'Gagal',
  expired: 'Kedaluwarsa',
};

export function usePlanOrder(): Array<'year' | 'lifetime'> {
  return useMemo(() => ['year', 'lifetime'], []);
}

/** Salin ringkasan sebagai teks biasa supaya bisa ditempel ke chat. */
export function copySummary(
  data: Penawaran,
  plan: 'year' | 'lifetime',
  setCopied: (value: boolean) => void,
  timer: { current: number | null },
) {
  const chosen = data.plans[plan];
  const text = [
    `VIVASTIC ${chosen.name}`,
    `Harga: ${money(chosen.idr)}`,
    `Biaya QRIS: ${money(0)} (ditanggung VIVASTIC)`,
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
    /* Gagal menyalin bukan kesalahan halaman: teksnya tetap terlihat. */
  } finally {
    area.remove();
  }
}

/** Timer yang dibersihkan saat komponen dilepas. */
export function useCopyTimer() {
  const ref = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (ref.current) window.clearTimeout(ref.current);
    },
    [],
  );
  return ref;
}
