import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Cash → Sales. El reporte contable, que NO es el arqueo.
 *
 *   Cash Close  -> ¿cuánto efectivo hay en el cajón?  filtra por shift_id
 *   Sales       -> ¿cuánto vendí?                     filtra por paid_at
 *
 * Por eso PayPal aparece acá y no allá: esa plata nunca pasó por el cajón.
 * Ver supabase/schema-reports.sql.
 */

const money = (n: number | null | undefined, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n) || 0);

/** Hoy en Costa Rica (UTC-6 todo el año), no en la zona del navegador. */
function todayCR(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function prettyDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const SERVICE_LABEL: Record<string, string> = {
  lessons: 'Surf lessons',
  rentals: 'Board rentals',
  shop: 'Shop',
};
const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  paypal: 'PayPal',
  sinpe: 'SINPE',
  tilopay: 'Tilopay',
};
/** Lo que entra al cajón y por lo tanto al arqueo. El resto llega al banco. */
const IN_DRAWER = new Set(['cash', 'card']);

interface Row {
  service: string;
  method: string;
  gross: number;
  fee: number;
  net: number;
  refunds: number;
  txn_count: number;
}
interface Day {
  day: string;
  gross: number;
  net: number;
  txn_count: number;
}
interface Orphan {
  payment_id: string;
  provider: string;
  amount: number;
  related_type: string;
  paid_at: string;
  notes: string | null;
}

type Preset = 'today' | 'week' | 'month' | 'last_month' | 'custom';

export default function SalesView() {
  const today = todayCR();
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    const t = todayCR();
    if (p === 'today') {
      setFrom(t);
      setTo(t);
    } else if (p === 'week') {
      setFrom(shift(t, -6));
      setTo(t);
    } else if (p === 'month') {
      setFrom(startOfMonth(t));
      setTo(t);
    } else if (p === 'last_month') {
      const prev = shift(startOfMonth(t), -1);
      setFrom(startOfMonth(prev));
      setTo(endOfMonth(prev));
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sb = getBrowserSupabase();
    const args = { p_from: from, p_to: to };
    const [r, d, o] = await Promise.all([
      sb.rpc('sales_report', args),
      sb.rpc('sales_daily', args),
      sb.rpc('sales_unreconciled', args),
    ]);
    const bad = r.error || d.error || o.error;
    if (bad) {
      setErr(
        bad.message.includes('sales_report') || bad.code === 'PGRST202'
          ? 'The sales report is not installed yet. Run supabase/schema-reports.sql.'
          : bad.message,
      );
      setRows([]);
      setDays([]);
      setOrphans([]);
    } else {
      setRows((r.data ?? []) as Row[]);
      setDays((d.data ?? []) as Day[]);
      setOrphans((o.data ?? []) as Orphan[]);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = useMemo(() => {
    const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + Number(f(r)), 0);
    const byKey = (key: 'service' | 'method') => {
      const m = new Map<string, Row>();
      for (const r of rows) {
        const k = r[key];
        const cur = m.get(k);
        if (cur) {
          cur.gross += Number(r.gross);
          cur.fee += Number(r.fee);
          cur.net += Number(r.net);
          cur.refunds += Number(r.refunds);
          cur.txn_count += Number(r.txn_count);
        } else {
          m.set(k, { ...r, [key]: k, gross: Number(r.gross), fee: Number(r.fee),
            net: Number(r.net), refunds: Number(r.refunds), txn_count: Number(r.txn_count) });
        }
      }
      return [...m.values()].sort((a, b) => b.gross - a.gross);
    };
    return {
      gross: sum((r) => r.gross),
      fee: sum((r) => r.fee),
      net: sum((r) => r.net),
      refunds: sum((r) => r.refunds),
      txns: sum((r) => r.txn_count),
      drawer: rows.filter((r) => IN_DRAWER.has(r.method)).reduce((a, r) => a + Number(r.gross), 0),
      services: byKey('service'),
      methods: byKey('method'),
    };
  }, [rows]);

  // Comisión sin desglosar: pagos de pasarela cuyo neto no vino de PayPal.
  const unknownFee = useMemo(
    () => rows.some((r) => !IN_DRAWER.has(r.method) && Number(r.fee) === 0 && Number(r.gross) > 0),
    [rows],
  );

  const peak = Math.max(1, ...days.map((d) => Number(d.gross)));

  return (
    <div>
      <div className="st-filters">
        <div className="st-chiprow" style={{ marginBottom: 0 }}>
          {([
            ['today', 'Today'],
            ['week', 'Last 7 days'],
            ['month', 'This month'],
            ['last_month', 'Last month'],
          ] as [Preset, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`st-chip ${preset === k ? 'on' : ''}`}
              onClick={() => applyPreset(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="st-spacer" />
        <div className="st-field">
          <label htmlFor="sales-from">From</label>
          <input
            id="sales-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setPreset('custom');
              setFrom(e.target.value);
            }}
          />
        </div>
        <div className="st-field">
          <label htmlFor="sales-to">To</label>
          <input
            id="sales-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setPreset('custom');
              setTo(e.target.value);
            }}
          />
        </div>
      </div>

      {err && <div className="st-err">{err}</div>}

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Loading…
        </p>
      ) : t.txns === 0 ? (
        <p className="st-empty">No payments in this period.</p>
      ) : (
        <>
          <div className="st-tiles">
            <div className="st-tile">
              <span className="st-tile-label">Sold</span>
              <span className="st-tile-val">{money(t.gross)}</span>
              <span className="st-note">
                {t.txns} {t.txns === 1 ? 'payment' : 'payments'}
              </span>
            </div>
            <div className="st-tile">
              <span className="st-tile-label">Gateway fees</span>
              {/* Un "$0.00" cuando la comisión existe pero no está registrada miente.
                  Preferimos decir que no la tenemos. */}
              <span className="st-tile-val warn">
                {t.fee > 0 ? `−${money(t.fee)}` : unknownFee ? 'n/a' : money(0)}
              </span>
              <span className="st-note">{unknownFee ? 'not recorded yet' : 'PayPal'}</span>
            </div>
            <div className="st-tile">
              <span className="st-tile-label">You receive</span>
              <span className="st-tile-val ok">
                {unknownFee ? '≈ ' : ''}
                {money(t.net)}
              </span>
              <span className="st-note">
                {unknownFee ? 'unrecorded fees not deducted' : 'after fees'}
              </span>
            </div>
            <div className="st-tile">
              <span className="st-tile-label">Through the drawer</span>
              <span className="st-tile-val accent">{money(t.drawer)}</span>
              <span className="st-note">the rest lands in the bank</span>
            </div>
          </div>

          {t.refunds > 0 && (
            <p className="st-note" style={{ marginBottom: '1rem' }}>
              {money(t.refunds)} refunded in this period. Refunds are shown separately and are not
              subtracted from the figures above.
            </p>
          )}

          <div className="st-sales-cols">
            <section className="st-card">
              <h3 className="st-h2">Where the money came from</h3>
              <table className="st-sales-table">
                <tbody>
                  {t.services.map((s) => (
                    <tr key={s.service}>
                      <th scope="row">{SERVICE_LABEL[s.service] ?? s.service}</th>
                      <td className="st-sales-bar">
                        <span
                          style={{ width: `${Math.round((s.gross / (t.gross || 1)) * 100)}%` }}
                        />
                      </td>
                      <td className="st-sales-pct">
                        {Math.round((s.gross / (t.gross || 1)) * 100)}%
                      </td>
                      <td className="st-sales-num">{money(s.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="st-card">
              <h3 className="st-h2">How it was paid</h3>
              <table className="st-sales-table">
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col" className="st-sales-num">Gross</th>
                    <th scope="col" className="st-sales-num">Fee</th>
                    <th scope="col" className="st-sales-num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {t.methods.map((m) => (
                    <tr key={m.method}>
                      <th scope="row">
                        {METHOD_LABEL[m.method] ?? m.method}
                        <span className="st-sales-tag">
                          {IN_DRAWER.has(m.method) ? 'drawer' : 'bank'}
                        </span>
                      </th>
                      <td className="st-sales-num">{money(m.gross)}</td>
                      <td className="st-sales-num st-sales-fee">
                        {m.fee > 0 ? `−${money(m.fee)}` : IN_DRAWER.has(m.method) ? '—' : '?'}
                      </td>
                      <td className="st-sales-num">{money(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unknownFee && (
                <p className="st-note">
                  A “?” means the payment was captured before we started recording gateway fees.
                  New PayPal payments store the fee automatically.
                </p>
              )}
            </section>
          </div>

          {days.length > 1 && (
            <section className="st-card">
              <h3 className="st-h2">Day by day</h3>
              <div className="st-sales-days">
                {days.map((d) => (
                  <div className="st-sales-day" key={d.day} title={`${d.day}: ${money(d.gross)}`}>
                    <span
                      className="st-sales-day-bar"
                      style={{ height: `${Math.max(4, (Number(d.gross) / peak) * 100)}%` }}
                    />
                    <span className="st-sales-day-lbl">{prettyDay(d.day)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {orphans.length > 0 && (
            <section className="st-card st-sales-warn">
              <h3 className="st-h2">Counter payments with no cash shift</h3>
              <p className="st-note">
                {money(orphans.reduce((a, o) => a + Number(o.amount), 0))} in cash or card that no
                cash close will ever see. PayPal is not listed here: having no shift is correct for
                online money.
              </p>
              <ul className="st-sales-orphans">
                {orphans.map((o) => (
                  <li key={o.payment_id}>
                    <span className="st-badge unpaid">{o.provider}</span>
                    <strong>{money(o.amount)}</strong>
                    <span className="st-note">
                      {o.related_type} · {new Date(o.paid_at).toLocaleDateString('en-US')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
