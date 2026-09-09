import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import NewBookingForm from './NewBookingForm';
import CheckinModal from './CheckinModal';
import WaiverModal from './WaiverModal';

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n));

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
const custInitials = (name?: string | null) => {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase() : '·';
};

interface Customer {
  full_name: string;
  email: string;
  phone: string | null;
  country_of_residence: string | null;
}
interface Participant {
  id: string;
  full_name: string;
  age: number | null;
  is_minor: boolean;
  waiver_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}
interface Booking {
  id: string;
  reference: string;
  status: string;
  participants_count: number;
  total_amount: number;
  currency: string;
  payment_method: string | null;
  payment_id: string | null;
  group_id: string | null;
  slot_date: string;
  start_time: string;
  checked_in_at: string | null;
  checkin_by: { display_name: string } | { display_name: string }[] | null;
  customer_note: string | null;
  staff_note: string | null;
  class_types: { name: string } | { name: string }[] | null;
  customers: Customer | Customer[] | null;
  booking_participants: Participant[] | null;
  booking_groups: { reference: string } | { reference: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  completed: 'completed',
  no_show: 'no-show',
};
const DAY_COLORS = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#F43F5E', '#10B981'];
const EARNS = new Set(['confirmed', 'completed']);

export default function AgendaView() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [checkinBooking, setCheckinBooking] = useState<Booking | null>(null);
  const [viewWaiver, setViewWaiver] = useState<{
    id: string;
    name: string;
    ecName: string | null;
    ecPhone: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = dateFilter || addDays(crToday(), -7);
    const to = dateFilter || addDays(crToday(), 45);
    let q = getBrowserSupabase()
      .from('bookings')
      .select(
        `id, reference, status, participants_count, total_amount, currency,
         payment_method, payment_id, group_id, slot_date, start_time, checked_in_at, customer_note, staff_note,
         checkin_by:profiles!checked_in_by ( display_name ),
         class_types ( name ),
         customers ( full_name, email, phone, country_of_residence ),
         booking_participants ( id, full_name, age, is_minor, waiver_id, emergency_contact_name, emergency_contact_phone ),
         booking_groups ( reference )`,
      )
      .gte('slot_date', from)
      .lte('slot_date', to)
      .order('slot_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);

    const { data, error } = await q;
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as Booking[]);
    setLoading(false);
  }, [statusFilter, dateFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    const { error } = await getBrowserSupabase().from('bookings').update({ status }).eq('id', id);
    setBusyId(null);
    if (error) alert(error.message);
    else await load();
  }

  async function del(b: Booking) {
    if (!confirm(`Delete booking ${b.reference}? This cannot be undone.`)) return;
    setBusyId(b.id);
    const { error } = await getBrowserSupabase().from('bookings').delete().eq('id', b.id);
    setBusyId(null);
    if (error) alert(error.message);
    else await load();
  }

  async function refund(b: Booking) {
    if (!b.group_id) return;
    if (
      !confirm(
        `Refund via PayPal and cancel ALL bookings in group ${b.reference}? This cannot be undone.`,
      )
    )
      return;
    setBusyId(b.id);
    const { data: sess } = await getBrowserSupabase().auth.getSession();
    const res = await fetch('/api/payments/paypal/refund', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ group_id: b.group_id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Could not process the refund.');
      return;
    }
    await load();
  }

  async function registerCounterPayment(b: Booking, method: 'cash' | 'card') {
    setBusyId(b.id);
    const { data: sess } = await getBrowserSupabase().auth.getSession();
    const res = await fetch('/api/payments/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ related_type: 'booking', related_id: b.id, method }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !data.ok) {
      alert(
        data.code === 'no_open_shift'
          ? 'Open your cash shift (Cash → Cash Close) before collecting payment.'
          : data.error || 'Could not record the payment.',
      );
      return;
    }
    await load();
  }

  const stats = useMemo(() => {
    const total = rows.length;
    const confirmed = rows.filter((r) => r.status === 'confirmed').length;
    const pending = rows.filter((r) => r.status === 'pending_payment').length;
    const revenue = rows
      .filter((r) => EARNS.has(r.status))
      .reduce((s, r) => s + Number(r.total_amount), 0);
    return { total, confirmed, pending, revenue };
  }, [rows]);

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const r of rows) {
      const arr = map.get(r.slot_date) ?? [];
      arr.push(r);
      map.set(r.slot_date, arr);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div>
      <div className="st-tiles">
        <Tile label="Total bookings" value={String(stats.total)} />
        <Tile label="Confirmed" value={String(stats.confirmed)} tone="ok" />
        <Tile label="Pending" value={String(stats.pending)} tone="warn" />
        <Tile label="Revenue" value={money(stats.revenue)} tone="accent" />
      </div>

      <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
        <button
          className={`st-btn st-btn-sm ${showNew ? 'st-btn-ghost' : 'st-btn-primary'}`}
          onClick={() => setShowNew((v) => !v)}
        >
          {showNew ? 'Close' : '+ New booking'}
        </button>
      </div>
      {showNew && (
        <NewBookingForm
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      )}

      <div className="st-filters">
        <div className="st-field">
          <label htmlFor="af-status">Status</label>
          <select
            id="af-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="pending_payment">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="no_show">No-show</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="af-date">Date</label>
          <input
            id="af-date"
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
        {dateFilter && (
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setDateFilter('')}>
            Clear
          </button>
        )}
        <span className="st-spacer" />
        <span className="st-note">
          {rows.length} result{rows.length === 1 ? '' : 's'} · {byDay.length} day
          {byDay.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <p className="st-empty">
          <span className="st-spin">◠</span> Loading…
        </p>
      )}
      {error && <div className="st-err">{error}</div>}
      {!loading && !error && byDay.length === 0 && (
        <p className="st-empty">No bookings in this range.</p>
      )}

      {byDay.map(([date, list], di) => {
        const color = DAY_COLORS[di % DAY_COLORS.length];
        const dayTotal = list.reduce((s, b) => s + Number(b.total_amount), 0);
        const conf = list.filter((b) => b.status === 'confirmed').length;
        return (
          <div className="st-day-card" style={{ borderLeftColor: color }} key={date}>
            <div className="st-day-hd">
              <span className="st-day-dot" style={{ background: color }} />
              <strong>{fmtDay(date)}</strong>
              <span className="st-day-sum">
                {list.length} booking{list.length === 1 ? '' : 's'}
                {conf > 0 ? ` · ✓ ${conf} confirmed` : ''} · {money(dayTotal)}
              </span>
            </div>

            {list.map((b) => {
              const cust = one(b.customers);
              const grp = one(b.booking_groups);
              const ct = one(b.class_types);
              const isOpen = openId === b.id;
              const pay = b.payment_id
                ? { cls: 'paid', label: 'paid' }
                : b.status === 'confirmed' && b.payment_method === 'on_arrival'
                  ? { cls: 'unpaid', label: 'pay on arrival' }
                  : b.status === 'pending_payment'
                    ? { cls: 'unpaid', label: 'awaiting payment' }
                    : null;
              return (
                <div className="st-brow-wrap" key={b.id}>
                  <div className="st-brow">
                    <div className="st-b-when">
                      <span className="st-b-time">{fmtTime(b.start_time)}</span>
                      <span className="st-b-ref">
                        {b.reference}
                        {grp?.reference && <em>{grp.reference}</em>}
                      </span>
                    </div>

                    <div className="st-b-main">
                      <span className="st-b-svc">{ct?.name ?? '—'}</span>
                      <span className="st-b-cust">
                        <span className="st-b-avatar">{custInitials(cust?.full_name)}</span>
                        <span className="st-b-custtext">
                          <strong>{cust?.full_name ?? '—'}</strong>
                          {cust?.email && <span className="st-b-line">{cust.email}</span>}
                          {(cust?.phone || cust?.country_of_residence) && (
                            <span className="st-b-line">
                              {[cust?.phone, cust?.country_of_residence]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                      </span>
                    </div>

                    <div className="st-b-facts">
                      <span className="st-b-guests">
                        {b.participants_count} {b.participants_count === 1 ? 'guest' : 'guests'}
                      </span>
                      <span className="st-b-total">{money(b.total_amount, b.currency)}</span>
                      <span className="st-b-status">
                        <span className={`st-badge ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                        {pay && <span className={`st-badge ${pay.cls}`}>{pay.label}</span>}
                      </span>
                    </div>

                    <div className="st-b-actions">
                      <button
                        className="st-btn st-btn-ghost st-btn-sm"
                        onClick={() => setOpenId(isOpen ? null : b.id)}
                      >
                        {isOpen ? 'Hide' : 'View'}
                      </button>
                      {b.status !== 'cancelled' && (
                        <button
                          className="st-btn st-btn-danger st-btn-sm"
                          disabled={busyId === b.id}
                          onClick={() => {
                            if (confirm(`Cancel ${b.reference}?`)) setStatus(b.id, 'cancelled');
                          }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        className="st-btn st-btn-danger st-btn-sm"
                        disabled={busyId === b.id}
                        onClick={() => del(b)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="st-bdetail">
                      <dl>
                        {b.booking_participants && b.booking_participants.length > 0 && (
                          <>
                            <dt>Waivers</dt>
                            <dd>
                              <div className="st-waiver-chips">
                                {b.booking_participants.map((p, i) =>
                                  p.waiver_id ? (
                                    <button
                                      key={p.id ?? i}
                                      className="st-wchip ok is-btn"
                                      onClick={() =>
                                        setViewWaiver({
                                          id: p.waiver_id!,
                                          name: p.full_name,
                                          ecName: p.emergency_contact_name,
                                          ecPhone: p.emergency_contact_phone,
                                        })
                                      }
                                    >
                                      ✓ {p.full_name}
                                      {p.is_minor ? ' · minor' : ''}
                                    </button>
                                  ) : (
                                    <span key={p.id ?? i} className="st-wchip pending">
                                      ⏳ {p.full_name}
                                      {p.is_minor ? ' · minor' : ''}
                                    </span>
                                  ),
                                )}
                              </div>
                            </dd>
                          </>
                        )}
                        {b.checked_in_at && (
                          <>
                            <dt>Checked in</dt>
                            <dd>
                              {new Date(b.checked_in_at).toLocaleString('en-US')}
                              {one(b.checkin_by)?.display_name
                                ? ` · por ${one(b.checkin_by)!.display_name}`
                                : ''}
                            </dd>
                          </>
                        )}
                        {b.customer_note && (
                          <>
                            <dt>Customer note</dt>
                            <dd>{b.customer_note}</dd>
                          </>
                        )}
                        {b.staff_note && (
                          <>
                            <dt>Staff note</dt>
                            <dd>{b.staff_note}</dd>
                          </>
                        )}
                      </dl>
                      <div className="st-actions">
                        {b.status === 'pending_payment' && (
                          <button
                            className="st-btn st-btn-ghost st-btn-sm"
                            disabled={busyId === b.id}
                            onClick={() => setStatus(b.id, 'confirmed')}
                          >
                            Confirm (manual)
                          </button>
                        )}
                        {b.status === 'confirmed' && !b.payment_id && (
                          <>
                            <button
                              className="st-btn st-btn-ghost st-btn-sm"
                              disabled={busyId === b.id}
                              onClick={() => registerCounterPayment(b, 'cash')}
                            >
                              Collect cash
                            </button>
                            <button
                              className="st-btn st-btn-ghost st-btn-sm"
                              disabled={busyId === b.id}
                              onClick={() => registerCounterPayment(b, 'card')}
                            >
                              Collect card
                            </button>
                          </>
                        )}
                        {b.payment_id &&
                          b.payment_method === 'paypal' &&
                          b.status !== 'cancelled' && (
                            <button
                              className="st-btn st-btn-danger st-btn-sm"
                              disabled={busyId === b.id}
                              onClick={() => refund(b)}
                            >
                              Refund (PayPal)
                            </button>
                          )}
                        {b.status === 'confirmed' && !b.checked_in_at && (
                          <button
                            className="st-btn st-btn-primary st-btn-sm"
                            onClick={() => setCheckinBooking(b)}
                          >
                            Check in + waivers
                          </button>
                        )}
                        {b.checked_in_at && (
                          <span className="st-badge confirmed">checked in</span>
                        )}
                        {b.status === 'confirmed' && (
                          <>
                            {!b.checked_in_at && (
                              <span className="st-gate-warn">⚠ no check-in</span>
                            )}
                            <button
                              className="st-btn st-btn-ghost st-btn-sm"
                              disabled={busyId === b.id}
                              onClick={() => setStatus(b.id, 'completed')}
                            >
                              Completed
                            </button>
                            <button
                              className="st-btn st-btn-ghost st-btn-sm"
                              disabled={busyId === b.id}
                              onClick={() => setStatus(b.id, 'no_show')}
                            >
                              No-show
                            </button>
                          </>
                        )}
                        {(b.status === 'completed' ||
                          b.status === 'no_show' ||
                          b.status === 'cancelled') && (
                          <button
                            className="st-btn st-btn-ghost st-btn-sm"
                            disabled={busyId === b.id}
                            onClick={() => setStatus(b.id, 'confirmed')}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {checkinBooking && (
        <CheckinModal
          booking={{
            id: checkinBooking.id,
            reference: checkinBooking.reference,
            participants_count: checkinBooking.participants_count,
            customer_name: one(checkinBooking.customers)?.full_name ?? '',
          }}
          onClose={() => setCheckinBooking(null)}
          onDone={() => {
            setCheckinBooking(null);
            void load();
          }}
        />
      )}

      {viewWaiver && (
        <WaiverModal
          waiverId={viewWaiver.id}
          participantName={viewWaiver.name}
          emergencyName={viewWaiver.ecName}
          emergencyPhone={viewWaiver.ecPhone}
          onClose={() => setViewWaiver(null)}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'accent';
}) {
  return (
    <div className="st-tile">
      <span className="st-tile-label">{label}</span>
      <span className={`st-tile-val${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}
