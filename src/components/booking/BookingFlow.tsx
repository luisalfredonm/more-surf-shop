import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePayPalSdk } from './usePayPal';
import './BookingFlow.css';

export interface BookingClassType {
  id: string;
  name: string;
  price_per_person: number;
  ratio_label: string | null;
  badge: string | null;
  description: string | null;
  included: string[];
  min_guests: number;
  max_guests: number | null;
}

interface Props {
  classTypes: BookingClassType[];
  whatsappNumber: string;
  paypalClientId: string;
  leadHours?: number;
}

interface ApiSlot {
  slot_id: string;
  slot_date: string;
  start_time: string;
  class_type_id: string;
  class_type_name: string;
  price_per_person: number;
  ratio_label: string | null;
  instructor_id: string | null;
  instructor_name: string | null;
  capacity_total: number;
  booked: number;
  remaining: number;
}

interface CartItem {
  key: string;
  classId: string;
  className: string;
  unitPrice: number;
  minG: number;
  maxG: number;
  slot: ApiSlot;
  guests: number;
  lineTotal: number;
}

type Step =
  | 'service'
  | 'date'
  | 'time'
  | 'guests'
  | 'cart'
  | 'contact'
  | 'confirm'
  | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'service', label: 'Service' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'guests', label: 'Guests' },
  { key: 'cart', label: 'Cart' },
  { key: 'contact', label: 'Contact' },
  { key: 'confirm', label: 'Payment' },
];

// ---- helpers ----
const crNow = () => new Date(Date.now() - 6 * 3_600_000);
const crToday = () => crNow().toISOString().slice(0, 10);
const ymOf = (iso: string) => iso.slice(0, 7);
const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0, 10);
  return { first, last };
};
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const fmtMonthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
const fmtDateShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const fmtDateLong = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
const waLink = (num: string, msg: string) =>
  `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
const uid = () => Math.random().toString(36).slice(2, 9);

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function BookingFlow({
  classTypes,
  whatsappNumber,
  paypalClientId,
  leadHours = 12,
}: Props) {
  const bookable = classTypes.filter((c) => c.price_per_person > 0);
  const paypalEnabled = paypalClientId.length > 0;
  const sdkStatus = usePayPalSdk(paypalClientId);

  const [step, setStep] = useState<Step>('service');

  // draft (the item being built)
  const [draftClassId, setDraftClassId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [draftSlot, setDraftSlot] = useState<ApiSlot | null>(null);
  const [draftGuests, setDraftGuests] = useState(1);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // month availability
  const [viewMonth, setViewMonth] = useState(ymOf(crToday()));
  const [monthSlots, setMonthSlots] = useState<ApiSlot[]>([]);
  const [monthState, setMonthState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // cart + contact
  const [cart, setCart] = useState<CartItem[]>([]);
  const [contact, setContact] = useState({ full_name: '', email: '', phone: '', country: '' });
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState(''); // honeypot

  // submit / result
  const [payMethod, setPayMethod] = useState<'paypal' | 'on_arrival'>(
    paypalEnabled ? 'paypal' : 'on_arrival',
  );
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [result, setResult] = useState<
    {
      group_id: string;
      group_reference: string;
      total: number;
      currency: string;
      items: { className: string; date: string; time: string; guests: number }[];
      paid: boolean;
    } | null
  >(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const draftClass = bookable.find((c) => c.id === draftClassId) ?? null;

  const loadMonth = useCallback(
    async (classId: string, ym: string) => {
      setMonthState('loading');
      const { first, last } = monthBounds(ym);
      const from = first < crToday() ? crToday() : first;
      try {
        const res = await fetch(
          `/api/availability?from=${from}&to=${last}&classTypeId=${encodeURIComponent(
            classId,
          )}&minLeadHours=${leadHours}`,
        );
        if (!res.ok) {
          setMonthState('error');
          return;
        }
        const data = await res.json();
        setMonthSlots(Array.isArray(data.slots) ? data.slots : []);
        setMonthState('ok');
      } catch {
        setMonthState('error');
      }
    },
    [leadHours],
  );

  const enabledDates = useMemo(() => {
    const min = draftClass?.min_guests ?? 1;
    return new Set(monthSlots.filter((s) => s.remaining >= min).map((s) => s.slot_date));
  }, [monthSlots, draftClass]);

  const daySlots = useMemo(() => {
    if (!draftDate) return [];
    const min = draftClass?.min_guests ?? 1;
    return monthSlots
      .filter((s) => s.slot_date === draftDate && s.remaining >= min)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [monthSlots, draftDate, draftClass]);

  function pickClass(id: string) {
    const c = bookable.find((x) => x.id === id)!;
    setDraftClassId(id);
    setDraftDate(null);
    setDraftSlot(null);
    setDraftGuests(c.min_guests);
    setViewMonth(ymOf(crToday()));
    void loadMonth(id, ymOf(crToday()));
    setStep('date');
  }

  function pickDate(dateStr: string) {
    setDraftDate(dateStr);
    setDraftSlot(null);
    setStep('time');
  }

  function pickSlot(s: ApiSlot) {
    const maxG = Math.min(draftClass?.max_guests ?? s.capacity_total, s.remaining);
    setDraftSlot(s);
    setDraftGuests((g) => Math.max(draftClass?.min_guests ?? 1, Math.min(g, maxG)));
    setStep('guests');
  }

  const guestMax = draftSlot
    ? Math.min(draftClass?.max_guests ?? draftSlot.capacity_total, draftSlot.remaining)
    : 1;
  const guestMin = draftClass?.min_guests ?? 1;

  function commitDraftToCart() {
    if (!draftClass || !draftSlot) return;
    const item: CartItem = {
      key: editingKey ?? uid(),
      classId: draftClass.id,
      className: draftClass.name,
      unitPrice: draftClass.price_per_person,
      minG: guestMin,
      maxG: guestMax,
      slot: draftSlot,
      guests: draftGuests,
      lineTotal: Math.round(draftClass.price_per_person * draftGuests * 100) / 100,
    };
    setCart((prev) =>
      editingKey ? prev.map((it) => (it.key === editingKey ? item : it)) : [...prev, item],
    );
    setEditingKey(null);
    setStep('cart');
  }

  function editCartItem(it: CartItem) {
    setEditingKey(it.key);
    setDraftClassId(it.classId);
    setDraftDate(it.slot.slot_date);
    setDraftSlot(it.slot);
    setDraftGuests(it.guests);
    setViewMonth(ymOf(it.slot.slot_date));
    void loadMonth(it.classId, ymOf(it.slot.slot_date));
    setStep('guests');
  }

  function addAnother() {
    setEditingKey(null);
    setDraftClassId(null);
    setDraftDate(null);
    setDraftSlot(null);
    setStep('service');
  }

  const cartTotal = useMemo(
    () => Math.round(cart.reduce((s, it) => s + it.lineTotal, 0) * 100) / 100,
    [cart],
  );

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim());
  const contactValid = contact.full_name.trim().length >= 2 && emailOk;

  async function submit() {
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((it) => ({
            class_type_id: it.classId,
            slot_id: it.slot.slot_id,
            guests: it.guests,
          })),
          contact: {
            full_name: contact.full_name.trim(),
            email: contact.email.trim(),
            phone: contact.phone.trim() || null,
            country_of_residence: contact.country.trim() || null,
          },
          payment_method: payMethod,
          customer_note: note.trim() || null,
          source: 'web',
          website,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 201 && data.ok) {
        const items = cart.map((it) => ({
          className: it.className,
          date: it.slot.slot_date,
          time: it.slot.start_time,
          guests: it.guests,
        }));
        if (data.payment_method === 'on_arrival') {
          setResult({ ...data, items, paid: false });
          setStep('done');
        } else {
          setResult({ ...data, items, paid: false }); // paypal: espera captura
        }
        return;
      }
      if (res.status === 409) {
        setBanner(
          `${data.error || 'Un horario ya no está disponible.'} Revisá tu carrito.`,
        );
        setStep('cart');
        return;
      }
      setBanner(
        data.error || 'No se pudo crear la reserva. Probá de nuevo o escribinos por WhatsApp.',
      );
    } catch {
      setBanner('Falló la conexión. Probá de nuevo o escribinos por WhatsApp.');
    } finally {
      setSubmitting(false);
    }
  }

  const handlePaid = useCallback(() => {
    setResult((r) => (r ? { ...r, paid: true } : r));
    setStep('done');
  }, []);

  // ---------- render helpers ----------
  const visibleSteps = STEPS;
  const stepIndex = visibleSteps.findIndex((s) => s.key === step);

  const chips: string[] = [];
  if (draftClass) chips.push(draftClass.name);
  if (draftDate) chips.push(fmtDateShort(draftDate));
  if (draftSlot && (step === 'guests' || step === 'time')) chips.push(fmtTime(draftSlot.start_time));
  if (draftSlot && step === 'guests')
    chips.push(`${draftGuests} guest${draftGuests === 1 ? '' : 's'} · ${money(draftClass!.price_per_person * draftGuests)}`);
  if (cart.length && step !== 'done') chips.push(`Cart: ${cart.length} item${cart.length === 1 ? '' : 's'}`);

  const orderSummary = (
    <div className="bf-summary">
      {cart.map((it) => (
        <div className="bf-summary-line" key={it.key}>
          <div>
            <strong>{it.className}</strong>
            <br />
            <span className="bf-muted">
              {fmtDateShort(it.slot.slot_date)} · {fmtTime(it.slot.start_time)} · {it.guests} guest
              {it.guests === 1 ? '' : 's'}
            </span>
          </div>
          <div className="bf-summary-price">{money(it.lineTotal)}</div>
        </div>
      ))}
      <div className="bf-summary-line bf-summary-total">
        <strong>Total</strong>
        <strong>{money(cartTotal)}</strong>
      </div>
    </div>
  );

  return (
    <div className="bf-card">
      {/* Stepper */}
      <ol className="bf-stepper">
        {visibleSteps.map((s, i) => (
          <li
            key={s.key}
            className={`bf-step${i === stepIndex ? ' is-active' : ''}${i < stepIndex ? ' is-done' : ''}`}
          >
            <span className="bf-step-dot">{i < stepIndex ? '✓' : i + 1}</span>
            <span className="bf-step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="bf-body">
        {chips.length > 0 && step !== 'done' && (
          <div className="bf-chips">
            {chips.map((c, i) => (
              <span className="bf-chip" key={i}>
                {c}
              </span>
            ))}
          </div>
        )}

        {banner && (
          <div className="bf-banner" role="alert">
            {banner}
          </div>
        )}

        {/* SERVICE */}
        {step === 'service' && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Choose your experience
            </h3>
            <p className="bf-sub">All lessons include board, rash guard and instructor. Price per person.</p>
            <div className="bf-options">
              {bookable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`bf-option${c.id === draftClassId ? ' is-selected' : ''}`}
                  onClick={() => pickClass(c.id)}
                >
                  <span>
                    <span className="bf-option-name">
                      {c.name}
                      {c.badge && <span className="bf-tag">{c.badge}</span>}
                    </span>
                    {c.ratio_label && <span className="bf-option-ratio">{c.ratio_label}</span>}
                  </span>
                  <span className="bf-option-price">
                    {money(c.price_per_person)}
                    <small>/ person</small>
                  </span>
                </button>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="bf-nav">
                <span className="bf-nav-spacer" />
                <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('cart')}>
                  Back to cart →
                </button>
              </div>
            )}
          </>
        )}

        {/* DATE */}
        {step === 'date' && draftClass && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Choose your date
            </h3>
            <p className="bf-sub">
              Pick a date for your surf session. We need at least {leadHours} hours' notice.
            </p>

            <div className="bf-cal">
              <div className="bf-cal-head">
                <button
                  type="button"
                  className="bf-cal-arrow"
                  onClick={() => {
                    const prev = shiftMonth(viewMonth, -1);
                    if (prev >= ymOf(crToday())) {
                      setViewMonth(prev);
                      void loadMonth(draftClass.id, prev);
                    }
                  }}
                  disabled={viewMonth <= ymOf(crToday())}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span className="bf-cal-title">{fmtMonthTitle(viewMonth)}</span>
                <button
                  type="button"
                  className="bf-cal-arrow"
                  onClick={() => {
                    const next = shiftMonth(viewMonth, 1);
                    setViewMonth(next);
                    void loadMonth(draftClass.id, next);
                  }}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>

              <div className="bf-cal-grid bf-cal-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="bf-cal-wd">
                    {w}
                  </span>
                ))}
              </div>

              {monthState === 'loading' ? (
                <p className="bf-muted bf-cal-msg">
                  <span className="bf-spin">◠</span> Loading…
                </p>
              ) : monthState === 'error' ? (
                <p className="bf-muted bf-cal-msg">Could not load availability.</p>
              ) : (
                <CalendarGrid
                  ym={viewMonth}
                  enabled={enabledDates}
                  selected={draftDate}
                  onPick={pickDate}
                />
              )}
            </div>

            <div className="bf-nav">
              <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('service')}>
                ← Back
              </button>
            </div>
          </>
        )}

        {/* TIME */}
        {step === 'time' && draftClass && draftDate && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Pick a time
            </h3>
            <p className="bf-sub">
              Available slots for <strong>{fmtDateLong(draftDate)}</strong>
            </p>
            {daySlots.length === 0 ? (
              <p className="bf-muted">No slots left for that day.</p>
            ) : (
              <div className="bf-slotgrid">
                {daySlots.map((s) => (
                  <button
                    key={s.slot_id}
                    type="button"
                    className={`bf-slot${s.slot_id === draftSlot?.slot_id ? ' is-selected' : ''}`}
                    onClick={() => pickSlot(s)}
                  >
                    <span className="bf-slot-time">{fmtTime(s.start_time)}</span>
                    <span className="bf-slot-meta">
                      {s.remaining} spot{s.remaining === 1 ? '' : 's'} left
                      {s.instructor_name ? ` · ${s.instructor_name}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="bf-nav">
              <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('date')}>
                ← Back
              </button>
            </div>
          </>
        )}

        {/* GUESTS */}
        {step === 'guests' && draftClass && draftSlot && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              How many guests?
            </h3>
            <p className="bf-sub">
              {guestMin === guestMax
                ? `${guestMin} ${guestMin === 1 ? 'person' : 'people'} for this lesson.`
                : `Minimum ${guestMin} and maximum ${guestMax} people per booking.`}
            </p>

            <div className="bf-counter">
              <button
                type="button"
                className="bf-counter-btn"
                onClick={() => setDraftGuests((g) => Math.max(guestMin, g - 1))}
                disabled={draftGuests <= guestMin}
                aria-label="Fewer guests"
              >
                −
              </button>
              <span className="bf-counter-val" aria-live="polite">
                {draftGuests}
              </span>
              <button
                type="button"
                className="bf-counter-btn"
                onClick={() => setDraftGuests((g) => Math.min(guestMax, g + 1))}
                disabled={draftGuests >= guestMax}
                aria-label="More guests"
              >
                +
              </button>
            </div>

            <div className="bf-total-card">
              <span className="bf-total-label">Total price</span>
              <span className="bf-total-val">{money(draftClass.price_per_person * draftGuests)}</span>
              <span className="bf-total-calc">
                {money(draftClass.price_per_person)} × {draftGuests}{' '}
                {draftGuests === 1 ? 'person' : 'people'}
              </span>
            </div>

            {draftClass.included.length > 0 && (
              <div className="bf-included">
                <span className="bf-included-h">What's included</span>
                <ul>
                  {draftClass.included.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bf-nav">
              <button
                type="button"
                className="bf-btn bf-btn-ghost"
                onClick={() => setStep(editingKey ? 'cart' : 'time')}
              >
                ← Back
              </button>
              <span className="bf-nav-spacer" />
              <button type="button" className="bf-btn bf-btn-primary" onClick={commitDraftToCart}>
                {editingKey ? 'Update' : 'Continue'} →
              </button>
            </div>
          </>
        )}

        {/* CART */}
        {step === 'cart' && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Review your cart
            </h3>
            <p className="bf-sub">You can add multiple classes and pay once.</p>

            {cart.length === 0 ? (
              <p className="bf-muted">Your cart is empty.</p>
            ) : (
              <div className="bf-cartlist">
                {cart.map((it) => (
                  <div className="bf-cart-item" key={it.key}>
                    <div>
                      <strong>{it.className}</strong>
                      <br />
                      <span className="bf-muted">
                        {fmtDateShort(it.slot.slot_date)} · {fmtTime(it.slot.start_time)}
                        <br />
                        {it.guests} guest{it.guests === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="bf-cart-right">
                      <span className="bf-cart-price">{money(it.lineTotal)}</span>
                      <span className="bf-cart-actions">
                        <button type="button" onClick={() => editCartItem(it)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="bf-danger"
                          onClick={() => setCart((prev) => prev.filter((x) => x.key !== it.key))}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
                <div className="bf-cart-total">
                  <span>Total</span>
                  <span>{money(cartTotal)}</span>
                </div>
              </div>
            )}

            <div className="bf-nav">
              <button
                type="button"
                className="bf-btn bf-btn-ghost"
                onClick={() => setStep(cart.length ? 'guests' : 'service')}
              >
                ← Back
              </button>
              <span className="bf-nav-spacer" />
              <button type="button" className="bf-btn bf-btn-ghost" onClick={addAnother}>
                + Add another class
              </button>
              <button
                type="button"
                className="bf-btn bf-btn-primary"
                onClick={() => setStep('contact')}
                disabled={cart.length === 0}
              >
                Continue →
              </button>
            </div>
          </>
        )}

        {/* CONTACT */}
        {step === 'contact' && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Your contact info
            </h3>
            <p className="bf-sub">We'll send your booking confirmation to this email.</p>

            <div className="bf-fields">
              <div className="bf-row">
                <div className="bf-field">
                  <label htmlFor="bf-name">Full name *</label>
                  <input
                    id="bf-name"
                    value={contact.full_name}
                    onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
                    autoComplete="name"
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="bf-field">
                  <label htmlFor="bf-email">Email *</label>
                  <input
                    id="bf-email"
                    type="email"
                    inputMode="email"
                    value={contact.email}
                    onChange={(e) => setContact({ ...contact, email: e.target.value })}
                    autoComplete="email"
                    placeholder="jane@example.com"
                  />
                </div>
              </div>
              <div className="bf-row">
                <div className="bf-field">
                  <label htmlFor="bf-phone">Phone / WhatsApp</label>
                  <input
                    id="bf-phone"
                    type="tel"
                    inputMode="tel"
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                    autoComplete="tel"
                    placeholder="+1 555 000 0000"
                  />
                </div>
                <div className="bf-field">
                  <label htmlFor="bf-country">Country</label>
                  <input
                    id="bf-country"
                    value={contact.country}
                    onChange={(e) => setContact({ ...contact, country: e.target.value })}
                    autoComplete="country-name"
                  />
                </div>
              </div>
              <div className="bf-field">
                <label htmlFor="bf-note">Special notes / requests</label>
                <textarea
                  id="bf-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Skill level, injuries, special requests…"
                />
              </div>
              <div className="bf-hp" aria-hidden="true">
                <label htmlFor="bf-website">Website</label>
                <input
                  id="bf-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
            </div>

            <div className="bf-nav">
              <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('cart')}>
                ← Back
              </button>
              <span className="bf-nav-spacer" />
              <button
                type="button"
                className="bf-btn bf-btn-primary"
                onClick={() => setStep('confirm')}
                disabled={!contactValid}
              >
                Go to payment →
              </button>
            </div>
          </>
        )}

        {/* CONFIRM */}
        {step === 'confirm' && (
          <>
            <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
              Almost there!
            </h3>
            <p className="bf-sub">Review your booking and choose how to pay.</p>

            {orderSummary}

            <div className="bf-paymethod">
              {paypalEnabled && (
                <label className={`bf-pay-opt${payMethod === 'paypal' ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="paym"
                    checked={payMethod === 'paypal'}
                    onChange={() => setPayMethod('paypal')}
                  />
                  <span>
                    <strong>Pay now with PayPal</strong>
                    <br />
                    <span className="bf-muted">Card or PayPal balance. Spot confirmed instantly.</span>
                  </span>
                </label>
              )}
              <label className={`bf-pay-opt${payMethod === 'on_arrival' ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="paym"
                  checked={payMethod === 'on_arrival'}
                  onChange={() => setPayMethod('on_arrival')}
                />
                <span>
                  <strong>Pay on arrival — {money(cartTotal)}</strong>
                  <br />
                  <span className="bf-muted">
                    Bring cash or card. Your spot is reserved now, no upfront payment.
                  </span>
                </span>
              </label>
            </div>

            <ul className="bf-checklist">
              <li>Your spot is reserved as soon as you confirm.</li>
              <li>Meet your instructor 15 minutes before your session.</li>
              <li>You'll sign the liability waiver at the shop.</li>
              <li>A confirmation email is sent right away.</li>
            </ul>

            {/* PayPal path after booking created */}
            {result && !result.paid && payMethod === 'paypal' ? (
              sdkStatus === 'ready' ? (
                <PayPalButtonsBox groupId={result.group_id} onPaid={handlePaid} onFail={setBanner} />
              ) : sdkStatus === 'error' ? (
                <div className="bf-state">
                  <p>Couldn't load PayPal.</p>
                  <a
                    className="bf-wa"
                    href={waLink(
                      whatsappNumber,
                      `Hi! Reservation ${result.group_reference} — I want to pay but PayPal didn't load.`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Pay via WhatsApp
                  </a>
                </div>
              ) : (
                <p className="bf-muted">
                  <span className="bf-spin">◠</span> Loading payment…
                </p>
              )
            ) : (
              <div className="bf-nav">
                <button
                  type="button"
                  className="bf-btn bf-btn-ghost"
                  onClick={() => setStep('contact')}
                  disabled={submitting}
                >
                  ← Back
                </button>
                <span className="bf-nav-spacer" />
                <button
                  type="button"
                  className="bf-btn bf-btn-primary"
                  onClick={submit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <span className="bf-spin">◠</span> Confirming…
                    </>
                  ) : payMethod === 'paypal' ? (
                    'Continue to PayPal'
                  ) : (
                    'Confirm reservation'
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* DONE */}
        {step === 'done' && result && (
          <div className="bf-state">
            <div className="bf-state-icon" aria-hidden="true">
              ✓
            </div>
            <h3>{result.paid ? 'Reservation confirmed & paid' : 'Reservation confirmed'}</h3>
            <span className="bf-ref">{result.group_reference}</span>
            <div className="bf-done-items">
              {result.items.map((it, i) => (
                <div key={i}>
                  {it.className} · {fmtDateShort(it.date)} · {fmtTime(it.time)} · {it.guests} guest
                  {it.guests === 1 ? '' : 's'}
                </div>
              ))}
            </div>
            <p>
              {result.paid
                ? `Paid ${money(result.total, result.currency)}. `
                : `Pay ${money(result.total, result.currency)} on arrival (cash or card). `}
              Meet your instructor 15 minutes early and sign the waiver at the shop. Keep your code{' '}
              {result.group_reference}.
            </p>
            <a
              className="bf-wa"
              href={waLink(
                whatsappNumber,
                `Hi! I have reservation ${result.group_reference}. A question:`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Message us on WhatsApp
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Calendar grid ----------
function CalendarGrid({
  ym,
  enabled,
  selected,
  onPick,
}: {
  ym: string;
  enabled: Set<string>;
  selected: string | null;
  onPick: (d: string) => void;
}) {
  const [y, m] = ym.split('-').map(Number);
  const offset = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  }
  return (
    <div className="bf-cal-grid">
      {cells.map((dateStr, i) => {
        if (!dateStr) return <span key={`e${i}`} className="bf-cal-cell is-empty" />;
        const day = Number(dateStr.slice(-2));
        const on = enabled.has(dateStr);
        return (
          <button
            key={dateStr}
            type="button"
            className={`bf-cal-cell${on ? ' is-on' : ''}${dateStr === selected ? ' is-sel' : ''}`}
            disabled={!on}
            onClick={() => on && onPick(dateStr)}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}

// ---------- PayPal buttons ----------
function PayPalButtonsBox({
  groupId,
  onPaid,
  onFail,
}: {
  groupId: string;
  onPaid: () => void;
  onFail: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    const paypal = (window as { paypal?: any }).paypal;
    if (rendered.current || !ref.current || !paypal) return;
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
  }, [groupId, onPaid, onFail]);

  return <div ref={ref} className="bf-paypal" />;
}
