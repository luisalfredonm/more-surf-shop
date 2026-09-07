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

  // Si ya hay un carrito, arrancamos con sus fechas.
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
        setErr(data.error || 'No se pudo consultar la disponibilidad.');
        setBusy(false);
        return;
      }
      setQuote(data as Quote);
      if (data.error) setErr(data.error);
    } catch {
      setErr('Falló la conexión.');
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
      <h2>Consultá disponibilidad</h2>
      <div className="bav-dates">
        <label>
          Desde
          <input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {err && <p className="bav-err">{err}</p>}

      {quote?.available && (
        <p className="bav-ok">
          Libre · <strong>{quote.days}</strong> {quote.days === 1 ? 'día' : 'días'} ·{' '}
          <strong>{money(quote.total)}</strong>
        </p>
      )}

      {!quote?.available ? (
        <button className="bav-btn bav-btn-ghost" type="button" disabled={busy} onClick={check}>
          {busy ? 'Consultando…' : 'Ver si está libre'}
        </button>
      ) : added ? (
        <div className="bav-added">
          <p>✓ Añadida a tu reserva{resetNote ? ' (cambiaste las fechas, empezamos de nuevo)' : ''}</p>
          <a className="bav-btn" href="/reserva">
            Ver mi reserva
          </a>
          <a className="bav-back" href="/surfboard-rental-tamarindo">
            Seguir mirando tablas
          </a>
        </div>
      ) : (
        <button className="bav-btn" type="button" onClick={add}>
          + Añadir a mi reserva
        </button>
      )}

      <p className="bav-note">Podés añadir varias tablas antes de confirmar.</p>
    </div>
  );
}
