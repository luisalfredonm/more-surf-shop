import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 90 && d <= to; i++) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
};
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

interface ClassType {
  id: string;
  name: string;
}
interface Instructor {
  id: string;
  name: string;
}
interface UpcomingSlot {
  id: string;
  slot_date: string;
  start_time: string;
  status: string;
  capacity_total: number;
  class_types: { name: string } | { name: string }[] | null;
  bookings: { id: string; status: string }[] | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function SlotsView() {
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const [classId, setClassId] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [fromDate, setFromDate] = useState(addDays(crToday(), 1));
  const [toDate, setToDate] = useState(addDays(crToday(), 7));
  const [times, setTimes] = useState('07:00, 09:30');
  const [capacity, setCapacity] = useState(4);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadUpcoming = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const today = crToday();
    const [ct, ins, up] = await Promise.all([
      sb.from('class_types').select('id, name').eq('active', true).eq('category', 'lesson').order('sort_order'),
      sb.from('instructors').select('id, name').eq('active', true).order('sort_order'),
      sb
        .from('lesson_slots')
        .select('id, slot_date, start_time, status, capacity_total, class_types(name), bookings(id, status)')
        .gte('slot_date', today)
        .lte('slot_date', addDays(today, 21))
        .order('slot_date')
        .order('start_time'),
    ]);
    setClassTypes((ct.data ?? []) as ClassType[]);
    setInstructors((ins.data ?? []) as Instructor[]);
    setUpcoming((up.data ?? []) as unknown as UpcomingSlot[]);
    if ((ct.data ?? []).length && !classId) setClassId((ct.data as ClassType[])[0].id);
    setLoading(false);
  }, [classId]);

  useEffect(() => {
    void loadUpcoming();
  }, [loadUpcoming]);

  async function openSlots(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);

    const dates = eachDate(fromDate, toDate);
    const timeList = times
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
      .map((t) => (t.length === 4 ? `0${t}` : t));

    if (!classId || dates.length === 0 || timeList.length === 0) {
      setErr('Revisá clase, fechas y horas (formato HH:MM).');
      setBusy(false);
      return;
    }

    const { data, error } = await getBrowserSupabase().rpc('open_lesson_slots', {
      p_dates: dates,
      p_times: timeList,
      p_class_type_id: classId,
      p_instructor_id: instructorId || null,
      p_capacity: capacity,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg(`${data ?? 0} slot(s) nuevos creados.`);
    await loadUpcoming();
  }

  async function closeSlot(id: string) {
    if (!confirm('¿Cerrar este slot? Las reservas existentes quedan; no se aceptan nuevas.')) return;
    const { error } = await getBrowserSupabase()
      .from('lesson_slots')
      .update({ status: 'closed' })
      .eq('id', id);
    if (error) alert(error.message);
    else await loadUpcoming();
  }

  async function reopenSlot(id: string) {
    const { error } = await getBrowserSupabase()
      .from('lesson_slots')
      .update({ status: 'open' })
      .eq('id', id);
    if (error) alert(error.message);
    else await loadUpcoming();
  }

  return (
    <div>
      <h2 className="st-h2">Abrir slots</h2>

      <form className="st-card" onSubmit={openSlots}>
        {err && <div className="st-err">{err}</div>}
        {msg && <div className="st-note" style={{ marginBottom: '0.75rem' }}>{msg}</div>}

        <div className="st-row">
          <div className="st-field">
            <label htmlFor="sv-class">Tipo de clase</label>
            <select id="sv-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="st-field">
            <label htmlFor="sv-ins">Instructor (opcional)</label>
            <select id="sv-ins" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              <option value="">— sin asignar —</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label htmlFor="sv-from">Desde</label>
            <input id="sv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="st-field">
            <label htmlFor="sv-to">Hasta</label>
            <input id="sv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label htmlFor="sv-times">Horas (HH:MM, separadas por coma)</label>
            <input id="sv-times" value={times} onChange={(e) => setTimes(e.target.value)} />
          </div>
          <div className="st-field">
            <label htmlFor="sv-cap">Capacidad</label>
            <input
              id="sv-cap"
              type="number"
              min={1}
              max={20}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
        </div>

        <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Abrir slots'}
        </button>
      </form>

      <h2 className="st-h2">Próximos 21 días</h2>
      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Cargando…
        </p>
      ) : upcoming.length === 0 ? (
        <p className="st-empty">No hay slots creados.</p>
      ) : (
        <div className="st-card">
          {upcoming.map((s) => {
            const active = (s.bookings ?? []).filter((b) =>
              ['confirmed', 'pending_payment'].includes(b.status),
            ).length;
            return (
              <div className="st-slotlist-row" key={s.id}>
                <span>
                  {fmtDay(s.slot_date)} · {s.start_time.slice(0, 5)}
                </span>
                <span className="st-note">
                  {one(s.class_types)?.name ?? '—'} · cap {s.capacity_total} · {active} reserva(s)
                </span>
                <span className="st-spacer" />
                {s.status === 'closed' ? (
                  <>
                    <span className="st-slot-closed">cerrado</span>
                    <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => reopenSlot(s.id)}>
                      Reabrir
                    </button>
                  </>
                ) : (
                  <button className="st-btn st-btn-danger st-btn-sm" onClick={() => closeSlot(s.id)}>
                    Cerrar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
