import { useEffect, useRef, useState } from 'react';
import { usePayPalSdk } from '../booking/usePayPal';
import './RentalWidget.css';

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

interface Preset {
  label: string;
  kind: 'hour' | 'day' | 'week';
  qty: number;
  price?: number | null;
}
const DEFAULT_PRESETS: Preset[] = [
  { label: '2 hours', kind: 'hour', qty: 2 },
  { label: '4 hours', kind: 'hour', qty: 4 },
  { label: '1 day', kind: 'day', qty: 1 },
  { label: '2 days', kind: 'day', qty: 2 },
  { label: '1 week', kind: 'week', qty: 1 },
];
const MS: Record<string, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };

interface Unit {
  unit_id: string;
  code: string;
  model_name: string;
  category: string;
  length_label: string | null;
  skill_level: string;
  image: string | null;
  price_per_hour: number;
  price_per_day: number;
}
interface Booked {
  group_id: string;
  group_reference: string;
  rental_reference: string;
  total: number;
  currency: string;
  payment_method: 'paypal' | 'on_arrival';
  confirmed: boolean;
  end_at: string;
}

function unitTotal(u: Unit, p: Preset): number {
  if (typeof p.price === 'number' && p.price >= 0) return p.price; // chip con precio fijo
  const unit = p.kind === 'hour' ? u.price_per_hour : p.kind === 'week' ? u.price_per_day * 7 : u.price_per_day;
  return Math.round(unit * p.qty * 100) / 100;
}
const crToday = () => new Date(Date.now() - 6 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

export default function RentalWidget({
  paypalClientId,
  categories,
  whatsappNumber,
}: {
  paypalClientId: string;
  categories: { slug: string; label: string }[];
  whatsappNumber: string;
}) {
  const [step, setStep] = useState<'pick' | 'results' | 'contact' | 'pay' | 'done'>('pick');
  const [date, setDate] = useState(crToday());
  const [time, setTime] = useState('09:00');
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESETS[2]);
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);
  const [category, setCategory] = useState('');

  const [units, setUnits] = useState<Unit[]>([]);
  const [picked, setPicked] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [c, setC] = useState({ full_name: '', email: '', phone: '' });
  const [payMethod, setPayMethod] = useState<'paypal' | 'on_arrival'>(
    paypalClientId ? 'paypal' : 'on_arrival',
  );
  const [booked, setBooked] = useState<Booked | null>(null);

  const startAt = new Date(`${date}T${time}:00`);
  const endAt = new Date(startAt.getTime() + preset.qty * MS[preset.kind]);
  const waHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hi! I want to rent a surfboard in Tamarindo.')}`;

  async function search() {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ from: startAt.toISOString(), to: endAt.toISOString() });
      if (category) qs.set('category', category);
      const res = await fetch(`/api/rentals/availability?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || 'Could not check availability.');
        setBusy(false);
        return;
      }
      if (Array.isArray(data.settings?.duration_presets) && data.settings.duration_presets.length) {
        const ps = data.settings.duration_presets as Preset[];
        setPresets(ps);
        if (!ps.some((p) => p.kind === preset.kind && p.qty === preset.qty)) setPreset(ps[0]);
      }
      setUnits(data.units ?? []);
      setStep('results');
    } catch {
      setErr('Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/rentals/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: picked.unit_id,
          start_at: startAt.toISOString(),
          rate_type: preset.kind,
          units_billed: preset.qty,
          contact: {
            full_name: c.full_name.trim(),
            email: c.email.trim(),
            phone: c.phone.trim() || null,
          },
          payment_method: payMethod,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        setErr(data.error || 'Could not reserve. Try WhatsApp.');
        setBusy(false);
        return;
      }
      setBooked(data as Booked);
      setStep(data.confirmed ? 'done' : 'pay');
    } catch {
      setErr('Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim());
  const contactValid = c.full_name.trim().length >= 2 && emailOk;

  return (
    <div className="rw">
      {err && <div className="rw-err">{err}</div>}

      {step === 'pick' && (
        <div className="rw-card">
          <div className="rw-row">
            <label>
              Pickup date
              <input type="date" value={date} min={crToday()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label className="rw-block">
            Board type
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any</option>
              {categories.map((k) => (
                <option key={k.slug} value={k.slug}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rw-block">
            <span className="rw-label">Duration</span>
            <div className="rw-chips">
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className={preset.kind === p.kind && preset.qty === p.qty ? 'on' : ''}
                  onClick={() => setPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="rw-note">
            Return by{' '}
            {endAt.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
          <button className="rw-btn" disabled={busy} onClick={search}>
            {busy ? 'Checking…' : 'See available boards'}
          </button>
        </div>
      )}

      {step === 'results' && (
        <div className="rw-card">
          <button className="rw-back" onClick={() => setStep('pick')}>
            ← Change dates
          </button>
          {units.length === 0 ? (
            <div className="rw-empty">
              <p>No boards free for that window.</p>
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="rw-wa">
                Ask us on WhatsApp
              </a>
            </div>
          ) : (
            <ul className="rw-units">
              {units.map((u) => (
                <li key={u.unit_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(u);
                      setStep('contact');
                    }}
                  >
                    <span className="rw-u-name">
                      {u.model_name} <em>#{u.code}</em>
                    </span>
                    <span className="rw-u-spec">
                      {u.length_label ? `${u.length_label} · ` : ''}
                      {u.skill_level}
                    </span>
                    <span className="rw-u-price">{money(unitTotal(u, preset))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 'contact' && picked && (
        <div className="rw-card">
          <button className="rw-back" onClick={() => setStep('results')}>
            ← Other boards
          </button>
          <p className="rw-pick">
            <strong>
              {picked.model_name} #{picked.code}
            </strong>{' '}
            · {preset.label} · <strong>{money(unitTotal(picked, preset))}</strong>
          </p>
          <div className="rw-row">
            <label>
              Name
              <input
                value={c.full_name}
                onChange={(e) => setC({ ...c, full_name: e.target.value })}
              />
            </label>
            <label>
              Phone (optional)
              <input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            </label>
          </div>
          <label className="rw-block">
            Email
            <input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
          </label>
          <div className="rw-block">
            <span className="rw-label">Payment</span>
            <div className="rw-pay">
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
                Pay at the shop
              </label>
            </div>
          </div>
          <button className="rw-btn" disabled={!contactValid || busy} onClick={book}>
            {busy ? 'Reserving…' : payMethod === 'paypal' ? 'Continue to payment' : 'Reserve'}
          </button>
        </div>
      )}

      {step === 'pay' && booked && (
        <div className="rw-card">
          <p className="rw-pick">
            <strong>{booked.group_reference}</strong> · {money(booked.total, booked.currency)}
          </p>
          {paypalClientId ? (
            <RentalPayPal
              clientId={paypalClientId}
              groupId={booked.group_id}
              onPaid={() => setStep('done')}
              onFail={setErr}
            />
          ) : (
            <p className="rw-note">Payment unavailable — message us on WhatsApp.</p>
          )}
          <p className="rw-note">Your board is held for ~20 minutes while you pay.</p>
        </div>
      )}

      {step === 'done' && booked && (
        <div className="rw-card rw-done">
          <p className="rw-big">✓</p>
          <p>
            Reserved — code <strong>{booked.group_reference}</strong>
          </p>
          <p className="rw-note">
            {booked.confirmed && booked.payment_method === 'on_arrival'
              ? `Pay ${money(booked.total, booked.currency)} at the shop when you pick up.`
              : 'Paid. See you at the shop.'}
          </p>
          <p className="rw-note">
            Bring photo ID. You'll sign the rental waiver at the counter when you pick up the board.
          </p>
        </div>
      )}
    </div>
  );
}

function RentalPayPal({
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
          else onFail(d.error || 'Could not confirm payment. Message us on WhatsApp.');
        },
        onError: () => onFail('PayPal had a problem. Try again.'),
        onCancel: () => onFail('Payment cancelled. You can try again.'),
      })
      .render(ref.current)
      .catch(() => onFail('Could not display PayPal.'));
  }, [status, groupId, onPaid, onFail]);

  if (status === 'error') return <p className="rw-note">Payment unavailable right now.</p>;
  return <div ref={ref} className="rw-paypal" />;
}
