import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

interface ClassType {
  id: string;
  name: string;
  price_per_person: number;
  min_guests: number;
  max_guests: number | null;
}
interface ApiSlot {
  start_time: string;
  remaining: number;
}

export default function NewBookingForm({ onCreated }: { onCreated: () => void }) {
  const [services, setServices] = useState<ClassType[]>([]);
  const [svcId, setSvcId] = useState('');
  const [date, setDate] = useState(addDays(crToday(), 1));
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [slotsState, setSlotsState] = useState<'idle' | 'loading' | 'ok' | 'empty'>('idle');
  const [time, setTime] = useState('');
  const [guests, setGuests] = useState(1);
  const [c, setC] = useState({ full_name: '', email: '', phone: '', country: '' });
  const [pay, setPay] = useState<'on_arrival' | 'cash_now' | 'card_now'>('on_arrival');
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = getBrowserSupabase();
    sb.from('class_types')
      .select('id, name, price_per_person, min_guests, max_guests')
      .eq('active', true)
      .eq('category', 'lesson')
      .order('sort_order')
      .then(({ data }) => {
        const list = (data ?? []) as ClassType[];
        setServices(list);
        if (list.length && !svcId) setSvcId(list[0].id);
      });
    void sb.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return setHasShift(false);
      void sb
        .from('cash_shifts')
        .select('id')
        .eq('profile_id', uid)
        .eq('status', 'open')
        .maybeSingle()
        .then(({ data: s }) => setHasShift(!!s));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const svc = services.find((s) => s.id === svcId) ?? null;

  const loadSlots = useCallback(async () => {
    if (!svcId || !date) return;
    setSlotsState('loading');
    setTime('');
    try {
      const res = await fetch(
        `/api/availability?from=${date}&to=${date}&classTypeId=${encodeURIComponent(svcId)}`,
      );
      const data = await res.json();
      const list: ApiSlot[] = Array.isArray(data.slots) ? data.slots : [];
      setSlots(list);
      setSlotsState(list.length ? 'ok' : 'empty');
    } catch {
      setSlots([]);
      setSlotsState('empty');
    }
  }, [svcId, date]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    if (svc) setGuests(svc.min_guests);
  }, [svc]);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim());
  const payNow = pay === 'cash_now' || pay === 'card_now';
  const valid =
    svcId && time && c.full_name.trim().length >= 2 && emailOk && (!payNow || hasShift === true);

  async function submit() {
    if (!valid || !svc) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ class_type_id: svcId, slot_date: date, start_time: time, guests }],
          contact: {
            full_name: c.full_name.trim(),
            email: c.email.trim(),
            phone: c.phone.trim() || null,
            country_of_residence: c.country.trim() || null,
          },
          payment_method: 'on_arrival',
          source: 'walk_in',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        setErr(data.error || 'No se pudo crear la reserva.');
        setBusy(false);
        return;
      }

      if (payNow && Array.isArray(data.booking_ids)) {
        const { data: sess } = await getBrowserSupabase().auth.getSession();
        const authz = `Bearer ${sess.session?.access_token ?? ''}`;
        const method = pay === 'card_now' ? 'card' : 'cash';
        for (const bid of data.booking_ids) {
          const pr = await fetch('/api/payments/counter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authz },
            body: JSON.stringify({ related_type: 'booking', related_id: bid, method }),
          });
          const pd = await pr.json().catch(() => ({}));
          if (!pr.ok || !pd.ok) {
            setErr(
              `Reserva ${data.group_reference} creada, pero el cobro falló: ${pd.error ?? ''} — registralo desde la agenda.`,
            );
          }
        }
      }

      setMsg(`Reserva creada: ${data.group_reference}`);
      setC({ full_name: '', email: '', phone: '', country: '' });
      setTime('');
      onCreated();
    } catch {
      setErr('Falló la conexión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-card">
      {err && <div className="st-err">{err}</div>}
      {msg && (
        <div className="st-note" style={{ marginBottom: '0.75rem' }}>
          {msg}
        </div>
      )}

      <div className="st-row">
        <div className="st-field">
          <label htmlFor="nb-svc">Servicio</label>
          <select id="nb-svc" value={svcId} onChange={(e) => setSvcId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — ${Number(s.price_per_person).toFixed(0)}/pers
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="nb-date">Fecha</label>
          <input id="nb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="st-row">
        <div className="st-field">
          <label htmlFor="nb-time">Hora</label>
          <select
            id="nb-time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={slotsState !== 'ok'}
          >
            <option value="">
              {slotsState === 'loading'
                ? 'Cargando…'
                : slotsState === 'empty'
                  ? 'Sin horarios ese día'
                  : 'Elegí una hora'}
            </option>
            {slots.map((s) => (
              <option key={s.start_time} value={s.start_time}>
                {fmtTime(s.start_time)} · {s.remaining} cupo(s)
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="nb-guests">Personas</label>
          <input
            id="nb-guests"
            type="number"
            min={svc?.min_guests ?? 1}
            max={svc?.max_guests ?? 20}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="st-row">
        <div className="st-field">
          <label htmlFor="nb-name">Nombre del cliente</label>
          <input
            id="nb-name"
            value={c.full_name}
            onChange={(e) => setC({ ...c, full_name: e.target.value })}
          />
        </div>
        <div className="st-field">
          <label htmlFor="nb-email">Email</label>
          <input
            id="nb-email"
            type="email"
            value={c.email}
            onChange={(e) => setC({ ...c, email: e.target.value })}
          />
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor="nb-phone">Teléfono (opcional)</label>
          <input
            id="nb-phone"
            value={c.phone}
            onChange={(e) => setC({ ...c, phone: e.target.value })}
          />
        </div>
        <div className="st-field">
          <label htmlFor="nb-pay">Pago</label>
          <select
            id="nb-pay"
            value={pay}
            onChange={(e) => setPay(e.target.value as 'on_arrival' | 'cash_now' | 'card_now')}
          >
            <option value="on_arrival">Cobrar al llegar</option>
            <option value="cash_now">Efectivo — cobrado ahora</option>
            <option value="card_now">Tarjeta — cobrado ahora</option>
          </select>
        </div>
      </div>

      {payNow && hasShift === false && (
        <div className="st-err">
          Para cobrar ahora necesitás un turno de caja abierto (Caja → Cierre de caja).
        </div>
      )}

      <button className="st-btn st-btn-primary" type="button" disabled={!valid || busy} onClick={submit}>
        {busy ? 'Creando…' : 'Crear reserva'}
      </button>
    </div>
  );
}
