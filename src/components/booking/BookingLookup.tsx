import { useState } from 'react';
import './BookingLookup.css';

const fmtDate = (iso: string) =>
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

const STATUS_ES: Record<string, string> = {
  pending: 'pendiente de pago',
  pending_payment: 'pendiente de pago',
  confirmed: 'confirmada',
  cancelled: 'cancelada',
  completed: 'completada',
  no_show: 'no-show',
};

interface Result {
  reference: string;
  status: string;
  paid: boolean;
  total: number;
  currency: string;
  items: { class_name: string; slot_date: string; start_time: string; guests: number; status: string }[];
}

export default function BookingLookup() {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/bookings/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: reference.trim(), email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'No pudimos encontrar tu reserva.');
        return;
      }
      setResult(data);
    } catch {
      setError('Falló la conexión. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bl">
      {!result && (
        <form onSubmit={submit}>
          {error && <div className="bl-err">{error}</div>}
          <div className="bl-field">
            <label htmlFor="bl-ref">Booking code</label>
            <input
              id="bl-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="GRP-XXXXX"
              autoComplete="off"
              required
            />
          </div>
          <div className="bl-field">
            <label htmlFor="bl-email">Email</label>
            <input
              id="bl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button className="bl-btn" type="submit" disabled={busy}>
            {busy ? 'Buscando…' : 'Ver mi reserva'}
          </button>
        </form>
      )}

      {result && (
        <div className="bl-result">
          <span className="bl-ref">{result.reference}</span>
          <p className="bl-status">
            Estado: <strong>{STATUS_ES[result.status] ?? result.status}</strong> ·{' '}
            {result.paid ? `pagado ${money(result.total, result.currency)}` : `pagás ${money(result.total, result.currency)} al llegar`}
          </p>
          <ul className="bl-items">
            {result.items.map((it, i) => (
              <li key={i}>
                <strong>{it.class_name}</strong> — {fmtDate(it.slot_date)} · {fmtTime(it.start_time)} ·{' '}
                {it.guests} pers
                {it.status !== result.status && (
                  <em> ({STATUS_ES[it.status] ?? it.status})</em>
                )}
              </li>
            ))}
          </ul>
          <p className="bl-note">Llegá 15 min antes y firmá el waiver en el mostrador.</p>
          <button className="bl-btn bl-btn-ghost" type="button" onClick={() => setResult(null)}>
            Buscar otra
          </button>
        </div>
      )}
    </div>
  );
}
