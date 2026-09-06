import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const DAYS_AHEAD = 14;

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
const fmtTime = (t: string) => t.slice(0, 5);
const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('es-CR', { style: 'currency', currency: c }).format(n);

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

interface Participant {
  full_name: string;
  age: number | null;
  is_minor: boolean;
}
interface Customer {
  full_name: string;
  email: string;
  phone: string | null;
  country_of_residence: string | null;
}
interface Booking {
  id: string;
  reference: string;
  status: string;
  participants_count: number;
  customer_note: string | null;
  staff_note: string | null;
  total_amount: number;
  currency: string;
  waiver_id: string | null;
  payment_id: string | null;
  customers: Customer | Customer[] | null;
  booking_participants: Participant[] | null;
}
interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  status: string;
  capacity_total: number;
  class_types: { name: string } | { name: string }[] | null;
  instructors: { name: string } | { name: string }[] | null;
  bookings: Booking[] | null;
}

const ACTIVE = new Set(['confirmed', 'pending_payment']);

export default function AgendaView() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = crToday();
    const to = addDays(from, DAYS_AHEAD - 1);
    const { data, error } = await getBrowserSupabase()
      .from('lesson_slots')
      .select(
        `id, slot_date, start_time, status, capacity_total,
         class_types ( name ),
         instructors ( name ),
         bookings (
           id, reference, status, participants_count, customer_note, staff_note,
           total_amount, currency, waiver_id, payment_id,
           customers ( full_name, email, phone, country_of_residence ),
           booking_participants ( full_name, age, is_minor )
         )`,
      )
      .gte('slot_date', from)
      .lte('slot_date', to)
      .order('slot_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSlots((data ?? []) as unknown as Slot[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(bookingId: string, status: string) {
    setBusyId(bookingId);
    const { error } = await getBrowserSupabase()
      .from('bookings')
      .update({ status })
      .eq('id', bookingId);
    setBusyId(null);
    if (error) {
      alert(`No se pudo actualizar: ${error.message}`);
      return;
    }
    await load();
  }

  const byDay = groupByDay(slots);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
        <h2 className="st-h2">Agenda · próximos {DAYS_AHEAD} días</h2>
        <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => void load()}>
          Actualizar
        </button>
      </div>

      {loading && (
        <p className="st-empty">
          <span className="st-spin">◠</span> Cargando…
        </p>
      )}
      {error && <div className="st-err">{error}</div>}
      {!loading && !error && byDay.length === 0 && (
        <p className="st-empty">No hay slots abiertos en el rango. Abrí slots en la pestaña «Slots».</p>
      )}

      {byDay.map(({ date, items }) => (
        <div className="st-day" key={date}>
          <div className="st-day-label">{fmtDay(date)}</div>
          {items.map((slot) => {
            const ct = one(slot.class_types);
            const ins = one(slot.instructors);
            const bookings = slot.bookings ?? [];
            const used = bookings
              .filter((b) => ACTIVE.has(b.status))
              .reduce((s, b) => s + b.participants_count, 0);
            return (
              <div className="st-slot" key={slot.id}>
                <div className="st-slot-head">
                  <span className="st-slot-time">{fmtTime(slot.start_time)}</span>
                  <span className="st-slot-meta">
                    {ct?.name ?? '—'}
                    {ins?.name ? ` · ${ins.name}` : ''}
                  </span>
                  {slot.status === 'closed' && <span className="st-slot-closed">cerrado</span>}
                  <span className="st-slot-cap">
                    {used}/{slot.capacity_total}
                  </span>
                </div>

                {bookings.length === 0 && (
                  <div className="st-booking">
                    <span className="st-note">Sin reservas.</span>
                  </div>
                )}

                {bookings.map((b) => {
                  const cust = one(b.customers);
                  const isOpen = openId === b.id;
                  const paidBadge =
                    b.status === 'confirmed'
                      ? b.payment_id
                        ? 'paid'
                        : 'unpaid'
                      : b.status === 'pending_payment'
                        ? 'unpaid'
                        : null;
                  return (
                    <div className="st-booking" key={b.id}>
                      <div
                        className="st-booking-top"
                        onClick={() => setOpenId(isOpen ? null : b.id)}
                      >
                        <span className="st-ref">{b.reference}</span>
                        <span className="st-booking-name">{cust?.full_name ?? '—'}</span>
                        <span className="st-booking-ppl">
                          {b.participants_count} pers · {money(b.total_amount, b.currency)}
                        </span>
                        <span className={`st-badge ${b.status}`}>
                          {b.status.replace('_', ' ')}
                        </span>
                        {paidBadge && (
                          <span className={`st-badge ${paidBadge}`}>
                            {paidBadge === 'paid' ? 'pagado' : 'sin pago'}
                          </span>
                        )}
                        <span className="st-badge" style={{ color: b.waiver_id ? '#2f7a55' : '#b3261e' }}>
                          waiver {b.waiver_id ? '✓' : '✗'}
                        </span>
                      </div>

                      {isOpen && (
                        <BookingDetail
                          booking={b}
                          customer={cust}
                          busy={busyId === b.id}
                          onStatus={(s) => setStatus(b.id, s)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function BookingDetail({
  booking: b,
  customer: cust,
  busy,
  onStatus,
}: {
  booking: Booking;
  customer: Customer | null;
  busy: boolean;
  onStatus: (status: string) => void;
}) {
  const [waiver, setWaiver] = useState<string | null>(null);
  const [waiverOpen, setWaiverOpen] = useState(false);

  async function loadWaiver() {
    setWaiverOpen(true);
    if (waiver || !b.waiver_id) return;
    const { data } = await getBrowserSupabase()
      .from('waivers')
      .select('rendered_text_snapshot, signer_name_typed, signed_at, is_minor, guardian_name, ip')
      .eq('id', b.waiver_id)
      .maybeSingle();
    setWaiver(
      data
        ? `Firmado por: ${data.signer_name_typed}\nFecha: ${data.signed_at}\n` +
            (data.is_minor ? `Tutor: ${data.guardian_name}\n` : '') +
            `IP: ${data.ip ?? '—'}\n\n${data.rendered_text_snapshot}`
        : 'No se encontró el waiver.',
    );
  }

  const participants = b.booking_participants ?? [];

  return (
    <div className="st-booking-detail">
      <dl>
        <dt>Email</dt>
        <dd>{cust?.email ?? '—'}</dd>
        <dt>Teléfono</dt>
        <dd>{cust?.phone ?? '—'}</dd>
        <dt>País</dt>
        <dd>{cust?.country_of_residence ?? '—'}</dd>
        <dt>Participantes</dt>
        <dd>
          {participants.length
            ? participants
                .map((p) => `${p.full_name}${p.age != null ? ` (${p.age})` : ''}${p.is_minor ? ' · menor' : ''}`)
                .join(', ')
            : '—'}
        </dd>
        {b.customer_note && (
          <>
            <dt>Nota cliente</dt>
            <dd>{b.customer_note}</dd>
          </>
        )}
        {b.staff_note && (
          <>
            <dt>Nota staff</dt>
            <dd>{b.staff_note}</dd>
          </>
        )}
      </dl>

      <div className="st-actions">
        {b.status === 'pending_payment' && (
          <button className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => onStatus('confirmed')}>
            Confirmar (manual)
          </button>
        )}
        {b.status === 'confirmed' && (
          <>
            <button className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => onStatus('completed')}>
              Completada
            </button>
            <button className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => onStatus('no_show')}>
              No-show
            </button>
          </>
        )}
        {(b.status === 'completed' || b.status === 'no_show') && (
          <button className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => onStatus('confirmed')}>
            Deshacer
          </button>
        )}
        {b.status === 'cancelled' ? (
          <button className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => onStatus('confirmed')}>
            Reactivar
          </button>
        ) : (
          <button
            className="st-btn st-btn-danger st-btn-sm"
            disabled={busy}
            onClick={() => {
              if (confirm(`¿Cancelar la reserva ${b.reference}?`)) onStatus('cancelled');
            }}
          >
            Cancelar
          </button>
        )}
        {b.waiver_id && (
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={loadWaiver}>
            {waiverOpen ? 'Ocultar waiver' : 'Ver waiver'}
          </button>
        )}
      </div>

      {waiverOpen && <div className="st-waiver-box">{waiver ?? 'Cargando…'}</div>}
    </div>
  );
}

function groupByDay(slots: Slot[]): { date: string; items: Slot[] }[] {
  const out: { date: string; items: Slot[] }[] = [];
  let cur: { date: string; items: Slot[] } | null = null;
  for (const s of slots) {
    if (!cur || cur.date !== s.slot_date) {
      cur = { date: s.slot_date, items: [] };
      out.push(cur);
    }
    cur.items.push(s);
  }
  return out;
}
