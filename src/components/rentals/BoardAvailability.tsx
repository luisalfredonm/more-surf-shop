import { useEffect, useState } from 'react';
import { addToCart, readCart, clearCart, type CartItem } from '@lib/rental-cart';
import './catalog.css';

const money = (n: number) => `$${Number(n).toFixed(0)}`;
const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

interface Quote {
  available: boolean;
  days: number;
  total: number;
  currency: string;
  error?: string;
}

export default function BoardAvailability({ unit }: { unit: CartItem }) {
  const today = crToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [alreadyIn, setAlreadyIn] = useState(false);
  // Cuántas tablas hay ya en la reserva. Si hay al menos una, sus fechas
  // mandan: no dejamos que este widget las cambie y borre el carrito.
  const [inCart, setInCart] = useState(0);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const c = readCart();
    if (c.items.length > 0 && c.from && c.to) {
      setFrom(c.from);
      setTo(c.to);
      setInCart(c.items.length);
      setLocked(true);
      if (c.items.some((i) => i.unit_id === unit.unit_id)) {
        setAlreadyIn(true);
        setAdded(true);
      }
    }
  }, [unit.unit_id]);

  useEffect(() => {
    setQuote(null);
    if (!alreadyIn) setAdded(false);
  }, [from, to, alreadyIn]);

  async function check() {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ unit_id: unit.unit_id, from, to });
      const res = await fetch(`/api/rentals/quote?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.available) {
        setErr(data.error || "We couldn't check availability.");
        setBusy(false);
        return;
      }
      setQuote(data as Quote);
      if (data.error) setErr(data.error);
    } catch {
      setErr('Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  function add() {
    addToCart(unit, from, to);
    setInCart(readCart().items.length);
    setAdded(true);
  }

  // Sin esto, un carrito armado antes dejaba las fechas bloqueadas y la única
  // salida era irse a /reservation a vaciarlo.
  function startOver() {
    clearCart();
    setLocked(false);
    setInCart(0);
    setAlreadyIn(false);
    setAdded(false);
    setQuote(null);
    setErr(null);
    setFrom(today);
    setTo(today);
  }

  return (
    <div className="bav">
      <h2>Check availability</h2>

      {locked ? (
        <p className="bav-locked">
          You already picked{' '}
          <strong>
            {prettyDate(from)} to {prettyDate(to)}
          </strong>{' '}
          for {inCart === 1 ? 'a board' : `${inCart} boards`}. Change the dates on the{' '}
          <a href="/reservation">reservation page</a>, or{' '}
          <button type="button" className="bav-linkbtn" onClick={startOver}>
            start over
          </button>
          .
        </p>
      ) : (
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
      )}

      {err && <p className="bav-err">{err}</p>}

      {quote?.available && !added && (
        <p className="bav-ok">
          Free · <strong>{quote.days}</strong> {quote.days === 1 ? 'day' : 'days'} ·{' '}
          <strong>{money(quote.total)}</strong>
        </p>
      )}

      {added ? (
        <div className="bav-added">
          <p>
            ✓ {alreadyIn ? 'Already in your reservation' : 'Added to your reservation'}
            {inCart > 0 && (
              <>
                {' '}
                · {inCart} {inCart === 1 ? 'board' : 'boards'}
              </>
            )}
          </p>
          <a className="bav-btn" href="/reservation">
            Go to checkout
          </a>
          <a className="bav-back" href="/surfboard-rental-tamarindo">
            Add another board
          </a>
        </div>
      ) : !quote?.available ? (
        <button className="bav-btn bav-btn-ghost" type="button" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : "Check if it's free"}
        </button>
      ) : (
        <button className="bav-btn" type="button" onClick={add}>
          + Add to my reservation
        </button>
      )}

      {!added && (
        <p className="bav-note">You can add several boards before you confirm.</p>
      )}
    </div>
  );
}
