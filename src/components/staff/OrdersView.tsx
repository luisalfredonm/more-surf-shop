import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Shop → Orders. La cola del mostrador: órdenes online esperando que el cliente
 * pase a retirar, más el historial de ventas.
 *
 * Entregar dispara /api/shop/pickup, que cobra (si hacía falta) y descuenta el
 * stock en una transacción. El stock físico baja recién acá.
 */

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n) || 0);
const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'awaiting payment',
  reserved: 'reserved',
  paid: 'paid',
  picked_up: 'picked up',
  cancelled: 'cancelled',
};
const BADGE: Record<string, string> = {
  pending_payment: 'pending_payment',
  reserved: 'unpaid',
  paid: 'paid',
  picked_up: 'completed',
  cancelled: 'cancelled',
};

interface Item {
  name_snapshot: string;
  qty: number;
  line_total: number;
}
interface Order {
  id: string;
  reference: string;
  channel: string;
  status: string;
  total: number;
  currency: string;
  created_at: string;
  picked_up_at: string | null;
  customer_note: string | null;
  customers: { full_name: string; email: string; phone: string | null } | null;
  order_items: Item[] | null;
  handler: { display_name: string } | { display_name: string }[] | null;
}

const COLS =
  'id, reference, channel, status, total, currency, created_at, picked_up_at, customer_note, ' +
  'customers ( full_name, email, phone ), order_items ( name_snapshot, qty, line_total ), ' +
  'handler:profiles!handed_over_by ( display_name )';

export default function OrdersView() {
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasShift, setHasShift] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sb = getBrowserSupabase();

    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      const { data: s } = await sb
        .from('cash_shifts')
        .select('id')
        .eq('profile_id', uid)
        .eq('status', 'open')
        .maybeSingle();
      setHasShift(!!s);
    }

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const q =
      tab === 'queue'
        ? sb.from('orders').select(COLS).in('status', ['reserved', 'paid']).order('created_at')
        : sb
            .from('orders')
            .select(COLS)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(100);
    const { data, error } = await q;
    if (error) setErr(error.message);
    setRows((data ?? []) as unknown as Order[]);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handOver(o: Order, method: 'cash' | 'card' | null) {
    setBusyId(o.id);
    setErr(null);
    const { data: sess } = await getBrowserSupabase().auth.getSession();
    const res = await fetch('/api/shop/pickup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ order_id: o.id, method }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !data.ok) {
      setErr(
        data.code === 'no_open_shift'
          ? 'Open your cash shift (Cash → Cash Close) before collecting payment.'
          : data.error || 'Could not complete the pickup.',
      );
      return;
    }
    await load();
  }

  async function cancel(o: Order) {
    if (!confirm(`Cancel order ${o.reference}? The stock goes back on sale.`)) return;
    setBusyId(o.id);
    const { error } = await getBrowserSupabase()
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', o.id);
    setBusyId(null);
    if (error) setErr(error.message);
    else await load();
  }

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <div className="st-tabs">
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
          Waiting for pickup{' '}
          {tab === 'queue' && rows.length > 0 && (
            <span className="st-tab-flag">{rows.length}</span>
          )}
        </button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          All orders
        </button>
      </div>

      {err && (
        <div className="st-err" style={{ marginTop: '1rem' }}>
          {err}
        </div>
      )}

      {hasShift === false && tab === 'queue' && (
        <p className="st-note" style={{ marginTop: '1rem' }}>
          You have no open cash shift — you can hand over prepaid orders, but not collect payment.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="st-empty">
          {tab === 'queue' ? 'Nothing waiting for pickup.' : 'No orders in the last 30 days.'}
        </p>
      ) : (
        <>
          <p className="st-tbl-count">
            {rows.length} {rows.length === 1 ? 'order' : 'orders'}
            {tab === 'queue' && ' waiting'}
          </p>
          <div className="st-tbl-wrap">
            <table className="st-tbl st-tbl-cards">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="st-tbl-num">
                    Total
                  </th>
                  <th scope="col">Placed</th>
                  <th scope="col">
                    <span className="st-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const cust = one(o.customers);
                  const items = o.order_items ?? [];
                  const units = items.reduce((s, i) => s + i.qty, 0);
                  const unpaid = o.status === 'reserved';
                  const canHandOver = o.status === 'reserved' || o.status === 'paid';
                  const handler = one(o.handler)?.display_name;
                  return (
                    <tr key={o.id}>
                      <td className="st-card-main">
                        <span className="st-tbl-name">
                          {cust?.full_name ?? 'Walk-in'}
                          <span className="st-src">{o.channel}</span>
                        </span>
                        <span className="st-tbl-sub">{o.reference}</span>
                        {cust?.email && (
                          <span className="st-ord-contact">
                            {cust.email}
                            {cust.phone ? ` · ${cust.phone}` : ''}
                          </span>
                        )}
                      </td>

                      <td className="st-ord-items st-card-full" data-label="Items">
                        <span className="st-ord-lines">
                          {items.map((i) => `${i.qty}× ${i.name_snapshot}`).join(', ') || '—'}
                        </span>
                        <span className="st-tbl-sub">
                          {units} {units === 1 ? 'unit' : 'units'}
                        </span>
                        {o.customer_note && (
                          <span className="st-ord-note">“{o.customer_note}”</span>
                        )}
                      </td>

                      <td className="st-card-badge">
                        <span className={`st-badge ${BADGE[o.status] ?? 'unpaid'}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>

                      <td className="st-tbl-num st-tbl-price" data-label="Total">{money(o.total, o.currency)}</td>

                      <td className="st-ord-when" data-label="Placed">
                        {dt(o.created_at)}
                        {o.picked_up_at && (
                          <span className="st-tbl-sub">picked up {dt(o.picked_up_at)}</span>
                        )}
                        {handler && <span className="st-tbl-sub">by {handler}</span>}
                      </td>

                      <td className="st-card-full">
                        {canHandOver ? (
                          <span className="st-tbl-acts st-ord-acts">
                            {unpaid ? (
                              <>
                                <button
                                  className="st-btn st-btn-primary st-btn-sm"
                                  disabled={busyId === o.id || hasShift !== true}
                                  onClick={() => handOver(o, 'cash')}
                                >
                                  Cash
                                </button>
                                <button
                                  className="st-btn st-btn-primary st-btn-sm"
                                  disabled={busyId === o.id || hasShift !== true}
                                  onClick={() => handOver(o, 'card')}
                                >
                                  Card
                                </button>
                              </>
                            ) : (
                              <button
                                className="st-btn st-btn-primary st-btn-sm"
                                disabled={busyId === o.id}
                                onClick={() => handOver(o, null)}
                              >
                                Hand over
                              </button>
                            )}
                            <button
                              className="st-btn st-btn-danger st-btn-sm"
                              disabled={busyId === o.id}
                              onClick={() => cancel(o)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="st-tbl-muted st-ord-done">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {tab === 'queue' && (
            <p className="st-note st-ord-hint">
              Handing over is what drops the stock. An unpaid order is collected here and lands in
              your cash shift; a prepaid one only needs the hand over.
            </p>
          )}
        </>
      )}
    </div>
  );
}
