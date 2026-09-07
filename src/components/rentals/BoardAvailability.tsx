import { useEffect, useState } from 'react';
import { addToCart, readCart, type CartItem } from '@lib/rental-cart';
import './catalog.css';

const money = (n: number) => `$${Number(n).toFixed(0)}`;
const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);

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
  const [resetNote, setResetNote] = useState(false);

  // If a cart already exists, start from its dates.
  useEffect(() => {
    const c = readCart();
    if (c.from && c.to) {
      setFrom(c.from);
      setTo(c.to);
    }
  }, []);

  useEffect(() => {
    setQuote(null);
    setAdded(false);
  }, [from, to]);

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
    const before = readCart();
    const wipes = before.items.length > 0 && (before.from !== from || before.to !== to);
    addToCart(unit, from, to);
    setResetNote(wipes);
    setAdded(true);
  }

  return (
    <div className="bav">
      <h2>Check availability</h2>
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

      {err && <p className="bav-err">{err}</p>}

      {quote?.available && (
        <p className="bav-ok">
          Free · <strong>{quote.days}</strong> {quote.days === 1 ? 'day' : 'days'} ·{' '}
          <strong>{money(quote.total)}</strong>
        </p>
      )}

      {!quote?.available ? (
        <button className="bav-btn bav-btn-ghost" type="button" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check if it\'s free'}
        </button>
      ) : added ? (
        <div className="bav-added">
          <p>✓ Added to your reservation{resetNote ? ' (dates changed, we started over)' : ''}</p>
          <a className="bav-btn" href="/reservation">
            View my reservation
          </a>
          <a className="bav-back" href="/surfboard-rental-tamarindo">
            Keep browsing boards
          </a>
        </div>
      ) : (
        <button className="bav-btn" type="button" onClick={add}>
          + Add to my reservation
        </button>
      )}

      <p className="bav-note">You can add several boards before you confirm.</p>
    </div>
  );
}
