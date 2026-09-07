import { useCallback, useEffect, useRef, useState } from 'react';
import { usePayPalSdk } from '../booking/usePayPal';
import {
  clearCart,
  readCart,
  removeFromCart,
  setCartDates,
  type CartItem,
} from '@lib/rental-cart';
import './catalog.css';

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n));
const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

interface Line extends CartItem {
  available: boolean;
  total: number;
  note?: string;
}
interface Booked {
  group_id: string;
  group_reference: string;
  boards: number;
  days: number;
  total: number;
  currency: string;
  payment_method: 'paypal' | 'on_arrival';
  confirmed: boolean;
  from: string;
  to: string;
}

export default function CartCheckout({
  paypalClientId,
  whatsappNumber,
}: {
  paypalClientId: string;
  whatsappNumber: string;
}) {
  const today = crToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [lines, setLines] = useState<Line[]>([]);
  const [days, setDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [c, setC] = useState({ full_name: '', email: '', phone: '', note: '' });
  const [payMethod, setPayMethod] = useState<'paypal' | 'on_arrival'>(
    paypalClientId ? 'paypal' : 'on_arrival',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  const waHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hi! A question about a board rental.')}`;

  const price = useCallback(async (items: CartItem[], f: string, t: string) => {
    if (items.length === 0) {
      setLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const out = await Promise.all(
      items.map(async (it) => {
        try {
          const qs = new URLSearchParams({ unit_id: it.unit_id, from: f, to: t });
          const res = await fetch(`/api/rentals/quote?${qs}`);
          const q = await res.json().catch(() => ({}));
          if (q.days) setDays(q.days);
          return {
            ...it,
            available: !!q.available,
            total: Number(q.total) || 0,
            note: q.available ? undefined : q.error || 'Not available for those dates',
          } as Line;
        } catch {
          return { ...it, available: false, total: 0, note: "Couldn't check" } as Line;
        }
      }),
    );
    setLines(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    const cart = readCart();
    const f = cart.from || today;
    const t = cart.to || today;
    setFrom(f);
    setTo(t);
    void price(cart.items, f, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDates() {
    setCartDates(from, to);
    void price(readCart().items, from, to);
  }

  function drop(unitId: string) {
    const cart = removeFromCart(unitId);
    void price(cart.items, cart.from || from, cart.to || to);
  }

  const total = lines.filter((l) => l.available).reduce((s, l) => s + l.total, 0);
  const allOk = lines.length > 0 && lines.every((l) => l.available);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim());
  const canBook = allOk && c.full_name.trim().length >= 2 && emailOk && !busy;

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/rentals/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          items: lines.map((l) => ({ unit_id: l.unit_id })),
          contact: {
            full_name: c.full_name.trim(),
            email: c.email.trim(),
            phone: c.phone.trim() || null,
          },
          payment_method: payMethod,
          customer_note: c.note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        setErr(data.error || "We couldn't confirm the reservation.");
        setBusy(false);
        return;
      }
      setBooked(data as Booked);
      if (data.confirmed) clearCart();
      setBusy(false);
    } catch {
      setErr('Connection failed.');
      setBusy(false);
    }
  }

  // ---- Confirmación ----
  if (booked && (booked.confirmed || booked.payment_method === 'on_arrival')) {
    return <Done booked={booked} waHref={waHref} />;
  }

  return (
    <div className="rsv">
      {err && <p className="bav-err">{err}</p>}

      {booked && !booked.confirmed ? (
        <div className="rsv-pay">
          <h2>Pay to confirm</h2>
          <p className="rsv-sub">
            {booked.group_reference} · {money(booked.total, booked.currency)}
          </p>
          <PayPalBox
            clientId={paypalClientId}
            groupId={booked.group_id}
            onPaid={() => {
              clearCart();
              setBooked({ ...booked, confirmed: true });
            }}
            onFail={setErr}
          />
          <p className="rsv-note">We hold the boards for about 20 minutes while you pay.</p>
        </div>
      ) : (
        <div className="rsv-cols">
          <div>
            <section className="rsv-card">
              <h2>Rental dates</h2>
              <div className="bav-dates">
                <label>
                  From
                  <input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label>
                  To
                  <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              <button className="bav-btn bav-btn-ghost" type="button" onClick={updateDates}>
                Update dates
              </button>
            </section>

            <h2 className="rsv-h">Selected boards</h2>
            {loading ? (
              <p className="rsv-note">Checking availability…</p>
            ) : lines.length === 0 ? (
              <div className="rsv-card rsv-empty">
                <p>You haven't picked any boards yet.</p>
                <a className="bav-btn" href="/surfboard-rental-tamarindo">
                  See the boards
                </a>
              </div>
            ) : (
              lines.map((l) => (
                <div className={`rsv-line${l.available ? '' : ' is-off'}`} key={l.unit_id}>
                  {l.image ? (
                    <img src={l.image} alt="" />
                  ) : (
                    <span className="rsv-noimg">+</span>
                  )}
                  <div className="rsv-line-main">
                    <strong>{l.name}</strong>
                    <span>
                      {money(l.price_per_day)} per day
                      {l.note && <em> · {l.note}</em>}
                    </span>
                  </div>
                  <span className="rsv-line-total">{l.available ? money(l.total) : '-'}</span>
                  <button type="button" onClick={() => drop(l.unit_id)}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <aside>
            <section className="rsv-card">
              <h2>Summary</h2>
              <div className="rsv-row">
                <span>
                  {days} {days === 1 ? 'day' : 'days'} · {lines.filter((l) => l.available).length}{' '}
                  {lines.filter((l) => l.available).length === 1 ? 'board' : 'boards'}
                </span>
                <strong>{money(total)}</strong>
              </div>
              <div className="rsv-row rsv-total">
                <span>Rental total</span>
                <strong>{money(total)}</strong>
              </div>
              <p className="rsv-note">
                At pickup you leave a card copy as our guarantee and sign the waiver at the
                counter. Bring photo ID.
              </p>
            </section>

            <section className="rsv-card">
              <h2>Your details</h2>
              <label className="rsv-field">
                Full name
                <input value={c.full_name} onChange={(e) => setC({ ...c, full_name: e.target.value })} />
              </label>
              <label className="rsv-field">
                Email
                <input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
              </label>
              <label className="rsv-field">
                Phone or WhatsApp
                <input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
              </label>
              <label className="rsv-field">
                Anything we should know (optional)
                <textarea rows={3} value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} />
              </label>

              <div className="rsv-pays">
                {paypalClientId && (
                  <label className={payMethod === 'paypal' ? 'on' : ''}>
                    <input
                      type="radio"
                      checked={payMethod === 'paypal'}
                      onChange={() => setPayMethod('paypal')}
                    />
                    Pay now (card / PayPal)
                  </label>
                )}
                <label className={payMethod === 'on_arrival' ? 'on' : ''}>
                  <input
                    type="radio"
                    checked={payMethod === 'on_arrival'}
                    onChange={() => setPayMethod('on_arrival')}
                  />
                  Pay at the shop on pickup
                </label>
              </div>

              <button className="bav-btn" type="button" disabled={!canBook} onClick={confirm}>
                {busy ? 'Confirming…' : 'Confirm reservation'}
              </button>
              {!allOk && lines.length > 0 && (
                <p className="rsv-note">Remove the unavailable boards or change the dates.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function Done({ booked, waHref }: { booked: Booked; waHref: string }) {
  return (
    <div className="rsv-done">
      <p className="rsv-check">✓</p>
      <h2>Reservation confirmed</h2>
      <p className="rsv-sub">Show us this code when you arrive and we'll have the board ready.</p>
      <p className="rsv-code">{booked.group_reference}</p>
      <dl className="rsv-done-grid">
        <div>
          <dt>Dates</dt>
          <dd>
            {longDate(booked.from)} → {longDate(booked.to)} ({booked.days}{' '}
            {booked.days === 1 ? 'day' : 'days'})
          </dd>
        </div>
        <div>
          <dt>Boards</dt>
          <dd>{booked.boards}</dd>
        </div>
        <div>
          <dt>Rental total</dt>
          <dd>{money(booked.total, booked.currency)}</dd>
        </div>
      </dl>
      <p className="rsv-note">
        {booked.payment_method === 'on_arrival'
          ? "You pay at the shop on pickup. We don't ask for a card now."
          : 'Paid. We sent a copy to your email.'}{' '}
        You leave a card copy as our guarantee and sign the waiver at the counter.
      </p>
      <div className="rsv-done-cta">
        <a className="bav-btn bav-btn-ghost" href="/booking">
          Check my reservation
        </a>
        <a className="bav-back" href={waHref} target="_blank" rel="noopener noreferrer">
          Message us on WhatsApp
        </a>
      </div>
    </div>
  );
}

function PayPalBox({
  clientId,
  groupId,
  onPaid,
  onFail,
}: {
  clientId: string;
  groupId: string;
  onPaid: () => void;
  onFail: (m: string) => void;
}) {
  const status = usePayPalSdk(clientId);
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || rendered.current || !ref.current) return;
    const paypal = (window as { paypal?: any }).paypal;
    if (!paypal) return;
    rendered.current = true;
    paypal
      .Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: async () => {
          const res = await fetch('/api/payments/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.id) throw new Error(d.error || 'create-order failed');
          return d.id;
        },
        onApprove: async (data: { orderID: string }) => {
          const res = await fetch('/api/payments/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: data.orderID, group_id: groupId }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok && d.ok) onPaid();
          else onFail(d.error || "We couldn't confirm the payment. Message us on WhatsApp.");
        },
        onError: () => onFail('PayPal had a problem. Try again.'),
        onCancel: () => onFail('Payment cancelled. You can try again.'),
      })
      .render(ref.current)
      .catch(() => onFail("Couldn't load PayPal."));
  }, [status, groupId, onPaid, onFail]);

  if (status === 'error') return <p className="rsv-note">Online payment isn't available right now.</p>;
  return <div ref={ref} className="rsv-paypal" />;
}
