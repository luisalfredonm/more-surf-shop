import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
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
interface Override {
  id: string;
  class_type_id: string | null;
  override_date: string;
  kind: 'closed' | 'custom';
  times: string[] | null;
  note: string | null;
  class_types: { name: string } | { name: string }[] | null;
}
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function DateOverridesView() {
  const [services, setServices] = useState<ClassType[]>([]);
  const [rows, setRows] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(crToday());
  const [svcId, setSvcId] = useState('');
  const [kind, setKind] = useState<'closed' | 'custom'>('closed');
  const [times, setTimes] = useState('07:00, 09:30');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const [ct, ov] = await Promise.all([
      sb.from('class_types').select('id, name').eq('active', true).eq('category', 'lesson').order('sort_order'),
      sb
        .from('date_overrides')
        .select('id, class_type_id, override_date, kind, times, note, class_types(name)')
        .gte('override_date', crToday())
        .order('override_date'),
    ]);
    setServices((ct.data ?? []) as ClassType[]);
    setRows((ov.data ?? []) as unknown as Override[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const timeList =
      kind === 'custom'
        ? times
            .split(',')
            .map((t) => t.trim())
            .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
            .map((t) => (t.length === 4 ? `0${t}` : t))
        : [];
    if (kind === 'custom' && timeList.length === 0) {
      setErr('Poné al menos una hora (HH:MM).');
      return;
    }
    const { error } = await getBrowserSupabase().from('date_overrides').insert({
      class_type_id: svcId || null,
      override_date: date,
      kind,
      times: timeList,
      note: note.trim() || null,
    });
    if (error) {
      setErr(error.code === '23505' ? 'Ya hay una excepción para esa fecha y servicio.' : error.message);
      return;
    }
    setNote('');
    await load();
  }

  async function remove(id: string) {
    const { error } = await getBrowserSupabase().from('date_overrides').delete().eq('id', id);
    if (error) alert(error.message);
    else await load();
  }

  return (
    <div>
      <h2 className="st-h2">Excepciones por fecha</h2>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Cerrar un día o reemplazar sus horarios. Gana sobre la plantilla semanal. Sin servicio
        = aplica a todos.
      </p>

      <form className="st-card" onSubmit={add}>
        {err && <div className="st-err">{err}</div>}
        <div className="st-row">
          <div className="st-field">
            <label htmlFor="ov-date">Fecha</label>
            <input id="ov-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="st-field">
            <label htmlFor="ov-svc">Servicio</label>
            <select id="ov-svc" value={svcId} onChange={(e) => setSvcId(e.target.value)}>
              <option value="">Todos</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="st-row">
          <div className="st-field">
            <label htmlFor="ov-kind">Tipo</label>
            <select
              id="ov-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'closed' | 'custom')}
            >
              <option value="closed">Cerrado (sin horarios)</option>
              <option value="custom">Horarios custom</option>
            </select>
          </div>
          {kind === 'custom' && (
            <div className="st-field">
              <label htmlFor="ov-times">Horas (HH:MM, coma)</label>
              <input id="ov-times" value={times} onChange={(e) => setTimes(e.target.value)} />
            </div>
          )}
        </div>
        <div className="st-field">
          <label htmlFor="ov-note">Nota (opcional)</label>
          <input id="ov-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="st-btn st-btn-primary" type="submit">
          + Agregar excepción
        </button>
      </form>

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Cargando…
        </p>
      ) : rows.length === 0 ? (
        <p className="st-empty">Sin excepciones futuras.</p>
      ) : (
        <div className="st-card">
          {rows.map((r) => (
            <div className="st-slotlist-row" key={r.id}>
              <span>{fmtDay(r.override_date)}</span>
              <span className="st-note">
                {one(r.class_types)?.name ?? 'Todos'} ·{' '}
                {r.kind === 'closed' ? 'cerrado' : (r.times ?? []).join(', ')}
                {r.note ? ` · ${r.note}` : ''}
              </span>
              <span className="st-spacer" />
              <button className="st-btn st-btn-danger st-btn-sm" onClick={() => remove(r.id)}>
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
