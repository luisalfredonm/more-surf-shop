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
        rows.map((o) => {
          const cust = one(o.customers);
          const items = o.order_items ?? [];
          const unpaid = o.status === 'reserved';
          const canHandOver = o.status === 'reserved' || o.status === 'paid';
          return (
            <div className="st-card st-rental-row" key={o.id}>
              <div className="st-rental-main">
                <span className="st-b-ref">{o.reference}</span>
                <strong className="st-svc-title">{cust?.full_name ?? 'Walk-in'}</strong>
                <span className="st-note">
                  {cust?.email}
                  {cust?.phone ? ` · ${cust.phone}` : ''}
                </span>
                <span className="st-note">
                  {items.map((i) => `${i.qty}x ${i.name_snapshot}`).join(' · ') || '—'}
                </span>
                {o.customer_note && <span className="st-note">{o.customer_note}</span>}
              </div>

              <div className="st-rental-meta">
                <span className={`st-badge ${BADGE[o.status] ?? 'unpaid'}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
                <span className="st-badge confirmed">{o.channel}</span>
              </div>

              <div className="st-rental-dates">
                <span>ordered {dt(o.created_at)}</span>
                {o.picked_up_at && <span>picked up {dt(o.picked_up_at)}</span>}
                <span className="st-b-total">{money(o.total, o.currency)}</span>
                {one(o.handler)?.display_name && (
                  <span className="st-note">handed over by {one(o.handler)!.display_name}</span>
                )}
              </div>

              {canHandOver && (
                <div className="st-rental-actions">
                  {unpaid ? (
                    <>
                      <button
                        className="st-btn st-btn-primary st-btn-sm"
                        disabled={busyId === o.id || hasShift !== true}
                        onClick={() => handOver(o, 'cash')}
                      >
                        Hand over · cash
                      </button>
                      <button
                        className="st-btn st-btn-primary st-btn-sm"
                        disabled={busyId === o.id || hasShift !== true}
                        onClick={() => handOver(o, 'card')}
                      >
                        Hand over · card
                      </button>
                    </>
                  ) : (
                    <button
                      className="st-btn st-btn-primary st-btn-sm"
                      disabled={busyId === o.id}
                      onClick={() => handOver(o, null)}
                    >
                      Hand over (paid)
                    </button>
                  )}
                  <button
                    className="st-btn st-btn-danger st-btn-sm"
                    disabled={busyId === o.id}
                    onClick={() => cancel(o)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
