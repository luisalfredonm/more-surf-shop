import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

// weekday: 0 = domingo … 6 = sábado (compatible con extract(dow)). Mostramos Lun→Dom.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
};

const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' });
};

interface ClassType {
  id: string;
  name: string;
}
interface WeeklySlot {
  id: string;
  class_type_id: string;
  weekday: number;
  start_time: string;
}

export default function WeeklyScheduleView() {
  const [services, setServices] = useState<ClassType[]>([]);
  const [slots, setSlots] = useState<WeeklySlot[]>([]);
  const [loading, setLoading] = useState(true);

  const [svcId, setSvcId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [time, setTime] = useState('07:00');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const [ct, ws] = await Promise.all([
      sb
        .from('class_types')
        .select('id, name')
        .eq('active', true)
        .eq('category', 'lesson')
        .order('sort_order'),
      sb.from('weekly_slots').select('id, class_type_id, weekday, start_time').order('start_time'),
    ]);
    const list = (ct.data ?? []) as ClassType[];
    setServices(list);
    setSlots((ws.data ?? []) as WeeklySlot[]);
    if (list.length && !svcId) setSvcId(list[0].id);
    setLoading(false);
  }, [svcId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (!svcId || !time) return;
    const { error } = await getBrowserSupabase().from('weekly_slots').insert({
      class_type_id: svcId,
      weekday: Number(weekday),
      start_time: time,
    });
    if (error) {
      setErr(error.code === '23505' ? 'Ese horario ya existe.' : error.message);
      return;
    }
    setMsg('Horario agregado.');
    await load();
  }

  async function removeSlot(id: string) {
    const { error } = await getBrowserSupabase().from('weekly_slots').delete().eq('id', id);
    if (error) alert(error.message);
    else await load();
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Define qué días y horas corre cada servicio, todas las semanas. Las excepciones por
        fecha (Date Overrides) tienen prioridad.
      </p>

      <form className="st-card" onSubmit={addSlot}>
        {err && <div className="st-err">{err}</div>}
        {msg && (
          <div className="st-note" style={{ marginBottom: '0.75rem' }}>
            {msg}
          </div>
        )}
        <div className="st-row">
          <div className="st-field">
            <label htmlFor="ws-svc">Servicio</label>
            <select id="ws-svc" value={svcId} onChange={(e) => setSvcId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="st-field">
            <label htmlFor="ws-day">Día</label>
            <select id="ws-day" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {DAY_ORDER.map((d) => (
                <option key={d} value={d}>
                  {DAY_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="st-row">
          <div className="st-field">
            <label htmlFor="ws-time">Hora</label>
            <input id="ws-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="st-field" style={{ justifyContent: 'flex-end' }}>
            <button className="st-btn st-btn-primary" type="submit">
              + Agregar
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Cargando…
        </p>
      ) : (
        services.map((svc) => {
          const svcSlots = slots.filter((s) => s.class_type_id === svc.id);
          return (
            <div className="st-card" key={svc.id}>
              <h3 className="st-h2" style={{ fontSize: '1.05rem' }}>
                {svc.name}
              </h3>
              <div className="st-week-grid">
                {DAY_ORDER.map((d) => {
                  const chips = svcSlots
                    .filter((s) => s.weekday === d)
                    .sort((a, b) => a.start_time.localeCompare(b.start_time));
                  return (
                    <div className="st-week-col" key={d}>
                      <span className="st-week-day">{DAY_LABEL[d]}</span>
                      {chips.length === 0 ? (
                        <span className="st-week-none">—</span>
                      ) : (
                        chips.map((c) => (
                          <span className="st-chip" key={c.id}>
                            {fmtTime(c.start_time)}
                            <button
                              type="button"
                              aria-label="Quitar"
                              onClick={() => removeSlot(c.id)}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
