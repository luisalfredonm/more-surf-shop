import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Cash → Sales. El reporte contable, que NO es el arqueo.
 *
 *   Cash Close  -> ¿cuánto efectivo hay en el cajón?  filtra por shift_id
 *   Sales       -> ¿cuánto vendí?                     filtra por paid_at
 *
 * Por eso PayPal aparece acá y no allá: esa plata nunca pasó por el cajón.
 * Ver supabase/schema-reports.sql.
 *
 * Imprime: los totales + el listado de pagos del período ("Today" + Print es
 * el reporte del día). Lo que es sólo pantalla lleva .st-noprint.
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
function longDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
function periodLabel(from: string, to: string): string {
  if (from === to) return longDay(from);
  const f = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return `${f(from)} – ${f(to)}`;
}

/** Hora y día de un pago en Costa Rica, sin importar la zona del navegador. */
const CR_TZ = 'America/Costa_Rica';
function timeCR(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: CR_TZ,
    hour: 'numeric',
    minute: '2-digit',
  });
}
function dayCR(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: CR_TZ }); // YYYY-MM-DD
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
/** Pasarelas: sin cajero cuando el cliente pagó solo en la web. */
const ONLINE = new Set(['paypal', 'tilopay']);

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

/** Un renglón del listado = un pago (o un reembolso). Ver sales_transactions. */
interface Txn {
  payment_id: string;
  paid_at: string;
  status: 'paid' | 'refunded';
  method: string;
  amount: number;
  fee: number | null;
  net: number | null;
  service: string;
  reference: string | null;
  customer: string | null;
  items: string[];
  collected_by: string | null;
  note: string | null;
}

type Preset = 'today' | 'week' | 'month' | 'last_month' | 'custom';

export default function SalesView({ printedBy }: { printedBy?: string }) {
  const today = todayCR();
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnErr, setTxnErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState(() => new Date());

  // Ctrl+P también pasa por acá, no sólo el botón: la hora impresa es la del
  // momento de imprimir, y el título es el nombre que propone el "Save as PDF".
  useEffect(() => {
    let prevTitle = '';
    const before = () => {
      prevTitle = document.title;
      document.title = `More Surf Shop - Sales ${from === to ? from : `${from} to ${to}`}`;
      flushSync(() => setPrintedAt(new Date()));
    };
    const after = () => {
      if (prevTitle) document.title = prevTitle;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [from, to]);

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
    const [r, d, o, x] = await Promise.all([
      sb.rpc('sales_report', args),
      sb.rpc('sales_daily', args),
      sb.rpc('sales_unreconciled', args),
      sb.rpc('sales_transactions', args),
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
    // El listado es posterior a los totales: una base con el schema viejo
    // sigue mostrando el resumen y sólo pide actualizar para el listado.
    if (x.error) {
      setTxnErr(
        x.error.code === 'PGRST202'
          ? 'The transaction list needs the latest supabase/schema-reports.sql. Run it again in Supabase.'
          : x.error.message,
      );
      setTxns([]);
    } else {
      setTxnErr(null);
      setTxns((x.data ?? []) as Txn[]);
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

  const hasAnything = t.txns > 0 || txns.length > 0;

  return (
    <div className="st-sales">
      {/* Encabezado del papel. En pantalla el período ya se ve en los filtros. */}
      <header className="st-rep-head">
        <img src="/images/logo.png" alt="More Surf Shop" width="850" height="351" />
        <div>
          <strong>Sales report</strong>
          <span className="st-rep-period">{periodLabel(from, to)}</span>
          <span>
            Costa Rica time · printed{' '}
            {printedAt.toLocaleString('en-US', {
              timeZone: CR_TZ,
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {printedBy ? ` by ${printedBy}` : ''}
          </span>
        </div>
      </header>

      <div className="st-filters st-noprint">
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
        <button
          className="st-btn st-btn-primary st-rep-print"
          onClick={() => window.print()}
          disabled={loading || !hasAnything}
        >
          Print report
        </button>
      </div>

      {err && <div className="st-err">{err}</div>}

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Loading…
        </p>
      ) : !hasAnything ? (
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
            <section className="st-card st-noprint">
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

          {txnErr ? (
            <div className="st-err">{txnErr}</div>
          ) : (
            <Transactions txns={txns} multiDay={from !== to} />
          )}

          <p className="st-rep-foot">
            Figures by payment date, Costa Rica time. Refunds are listed on the day they were made
            and are not subtracted from “Sold”. Gateway fees as reported by PayPal.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * El listado: un renglón por pago, en orden cronológico, agrupado por día
 * cuando el período abarca más de uno. Los filtros son de pantalla, pero lo
 * que se imprime es lo que se ve, así que el encabezado dice si hay filtro.
 */
function Transactions({ txns, multiDay }: { txns: Txn[]; multiDay: boolean }) {
  const [q, setQ] = useState('');
  const [service, setService] = useState('all');
  const [method, setMethod] = useState('all');

  const services = useMemo(() => [...new Set(txns.map((x) => x.service))], [txns]);
  const methods = useMemo(() => [...new Set(txns.map((x) => x.method))], [txns]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter(
      (x) =>
        (service === 'all' || x.service === service) &&
        (method === 'all' || x.method === method) &&
        (!needle ||
          [x.reference, x.customer, x.collected_by, x.note, ...x.items].some((s) =>
            s?.toLowerCase().includes(needle),
          )),
    );
  }, [txns, q, service, method]);

  const byDay = useMemo(() => {
    const m = new Map<string, Txn[]>();
    for (const x of shown) {
      const d = dayCR(x.paid_at);
      const list = m.get(d);
      if (list) list.push(x);
      else m.set(d, [x]);
    }
    return [...m.entries()];
  }, [shown]);

  const total = (list: Txn[], status: Txn['status']) =>
    list.filter((x) => x.status === status).reduce((a, x) => a + Number(x.amount), 0);
  const sold = total(shown, 'paid');
  const refunded = total(shown, 'refunded');
  const paidCount = shown.filter((x) => x.status === 'paid').length;

  const filtered = shown.length !== txns.length;
  const filterLabel = [
    service !== 'all' && (SERVICE_LABEL[service] ?? service),
    method !== 'all' && (METHOD_LABEL[method] ?? method),
    q.trim() && `“${q.trim()}”`,
  ]
    .filter(Boolean)
    .join(' · ');

  function clear() {
    setQ('');
    setService('all');
    setMethod('all');
  }

  return (
    <section className="st-rep">
      <div className="st-rep-top">
        <h3 className="st-h2">Transactions</h3>
        <p className="st-tbl-count">
          {filtered ? `${shown.length} of ${txns.length}` : txns.length}{' '}
          {txns.length === 1 ? 'entry' : 'entries'}
          {filtered && filterLabel && <> · only {filterLabel}</>}
        </p>
      </div>

      {txns.length === 0 ? (
        <p className="st-empty">No payments in this period.</p>
      ) : (
        <>
          <div className="st-tbl-bar st-noprint">
            <input
              className="st-tbl-search"
              type="search"
              placeholder="Search reference, customer, item…"
              aria-label="Search transactions"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {services.length > 1 && (
              <select
                aria-label="Service"
                value={service}
                onChange={(e) => setService(e.target.value)}
              >
                <option value="all">All services</option>
                {services.map((s) => (
                  <option key={s} value={s}>
                    {SERVICE_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            )}
            {methods.length > 1 && (
              <select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="all">All methods</option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="st-tbl-empty">
              <p>Nothing matches these filters.</p>
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="st-tbl-wrap">
              <table className="st-tbl st-rep-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Customer</th>
                    <th scope="col">What</th>
                    <th scope="col">Method</th>
                    <th scope="col">By</th>
                    <th scope="col" className="st-tbl-num">
                      Amount
                    </th>
                  </tr>
                </thead>
                {byDay.map(([day, list]) => (
                  <tbody key={day}>
                    {multiDay && (
                      <tr className="st-rep-day">
                        <th scope="rowgroup" colSpan={5}>
                          {longDay(day)}
                          <span>
                            {list.length} {list.length === 1 ? 'entry' : 'entries'}
                          </span>
                        </th>
                        <td className="st-tbl-num">{money(total(list, 'paid'))}</td>
                      </tr>
                    )}
                    {list.map((x) => (
                      <TxnRow key={x.payment_id} x={x} />
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={5}>
                      Sold · {paidCount} {paidCount === 1 ? 'payment' : 'payments'}
                    </th>
                    <td className="st-tbl-num">{money(sold)}</td>
                  </tr>
                  {refunded > 0 && (
                    <>
                      <tr>
                        <th scope="row" colSpan={5}>
                          Refunded
                        </th>
                        <td className="st-tbl-num st-rep-neg">−{money(refunded)}</td>
                      </tr>
                      <tr className="st-rep-grand">
                        <th scope="row" colSpan={5}>
                          After refunds
                        </th>
                        <td className="st-tbl-num">{money(sold - refunded)}</td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TxnRow({ x }: { x: Txn }) {
  const refund = x.status === 'refunded';
  const by = x.collected_by ?? (ONLINE.has(x.method) ? 'Online' : '—');
  // Un reembolso de mostrador trae el motivo en la nota; uno de PayPal no.
  const note = x.note ?? (refund && ONLINE.has(x.method) ? 'Refunded through PayPal' : null);

  return (
    <tr className={refund ? 'is-refund' : undefined}>
      <td className="st-rep-time">{timeCR(x.paid_at)}</td>
      <td>
        <span className="st-tbl-name">
          {x.customer ?? <span className="st-tbl-muted">Walk-in</span>}
        </span>
        {x.reference && <span className="st-tbl-sub">{x.reference}</span>}
      </td>
      <td className="st-rep-what">
        {refund && <span className="st-rep-tag">Refund</span>}
        {x.items.length > 0 ? (
          x.items.map((line, i) => (
            <span key={i} className="st-rep-line">
              {line}
            </span>
          ))
        ) : (
          <span className="st-rep-line st-tbl-muted">{SERVICE_LABEL[x.service] ?? x.service}</span>
        )}
        {note && <span className="st-ord-note">{note}</span>}
      </td>
      <td className="st-rep-method">{METHOD_LABEL[x.method] ?? x.method}</td>
      <td className="st-tbl-muted">{by}</td>
      <td className="st-tbl-num">
        <span className={refund ? 'st-rep-neg' : 'st-tbl-price'}>
          {refund ? `−${money(x.amount)}` : money(x.amount)}
        </span>
        {!refund && Number(x.fee) > 0 && (
          <span className="st-tbl-sub">fee −{money(x.fee)}</span>
        )}
      </td>
    </tr>
  );
}
