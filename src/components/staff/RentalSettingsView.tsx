import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const RATE_KINDS = ['hour', 'day', 'week'] as const;

interface Preset {
  label: string;
  kind: string;
  qty: number;
  price?: number | null; // precio fijo; vacío = por tarifa del modelo
}
interface Settings {
  min_duration_hours: number;
  max_duration_days: number;
  min_lead_hours: number;
  min_charge_unit: string;
  duration_presets: Preset[];
}

const DEFAULTS: Settings = {
  min_duration_hours: 1,
  max_duration_days: 30,
  min_lead_hours: 0,
  min_charge_unit: 'hour',
  duration_presets: [
    { label: '2 h', kind: 'hour', qty: 2 },
    { label: '4 h', kind: 'hour', qty: 4 },
    { label: '1 day', kind: 'day', qty: 1 },
    { label: '2 days', kind: 'day', qty: 2 },
    { label: '1 week', kind: 'week', qty: 1 },
  ],
};

export default function RentalSettingsView() {
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .from('rental_settings')
      .select('min_duration_hours, max_duration_days, min_lead_hours, min_charge_unit, duration_presets')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const d = data as Settings | null;
        setForm(
          d
            ? { ...d, duration_presets: Array.isArray(d.duration_presets) ? d.duration_presets : [] }
            : DEFAULTS,
        );
      });
  }, []);

  if (!form) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setMsg(null);
  }
  function setPreset(i: number, patch: Partial<Preset>) {
    set(
      'duration_presets',
      form!.duration_presets.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const presets = form!.duration_presets
      .map((p) => {
        const base = { label: p.label.trim(), kind: p.kind, qty: Math.max(1, Number(p.qty) || 1) };
        return p.price != null && Number(p.price) >= 0
          ? { ...base, price: Math.round(Number(p.price) * 100) / 100 }
          : base;
      })
      .filter((p) => p.label);
    const { error } = await getBrowserSupabase()
      .from('rental_settings')
      .update({
        min_duration_hours: Math.max(1, Number(form!.min_duration_hours) || 1),
        max_duration_days: Math.max(1, Number(form!.max_duration_days) || 1),
        min_lead_hours: Math.max(0, Number(form!.min_lead_hours) || 0),
        min_charge_unit: form!.min_charge_unit,
        duration_presets: presets,
      })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg('Saved. The online widget picks it up immediately.');
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Rules for online rentals and the counter's duration chips.
      </p>

      <div className="st-card">
        <div className="st-row">
          <div className="st-field">
            <label>Minimum duration (hours)</label>
            <input
              type="number"
              min={1}
              value={form.min_duration_hours}
              onChange={(e) => set('min_duration_hours', Number(e.target.value))}
            />
          </div>
          <div className="st-field">
            <label>Maximum duration (days)</label>
            <input
              type="number"
              min={1}
              value={form.max_duration_days}
              onChange={(e) => set('max_duration_days', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="st-row">
          <div className="st-field">
            <label>Minimum booking lead time (hours)</label>
            <input
              type="number"
              min={0}
              value={form.min_lead_hours}
              onChange={(e) => set('min_lead_hours', Number(e.target.value))}
            />
          </div>
          <div className="st-field">
            <label>Minimum charge unit</label>
            <select
              value={form.min_charge_unit}
              onChange={(e) => set('min_charge_unit', e.target.value)}
            >
              <option value="hour">Hour</option>
              <option value="day">Day</option>
            </select>
          </div>
        </div>

        <div className="st-field">
          <label>Duration chips</label>
          <div className="st-slotlist-row" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <span style={{ flex: 1 }}>Label</span>
            <span style={{ width: '4rem' }}>Qty</span>
            <span style={{ width: '5.5rem' }}>Unit</span>
            <span style={{ width: '6rem' }}>Fixed price $</span>
            <span className="st-spacer" />
          </div>
          {form.duration_presets.map((p, i) => (
            <div className="st-slotlist-row" key={i}>
              <input
                value={p.label}
                onChange={(e) => setPreset(i, { label: e.target.value })}
                placeholder="1 day"
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={1}
                value={p.qty}
                onChange={(e) => setPreset(i, { qty: Number(e.target.value) })}
                style={{ width: '4rem' }}
              />
              <select
                value={p.kind}
                onChange={(e) => setPreset(i, { kind: e.target.value })}
                style={{ width: '5.5rem' }}
              >
                {RATE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.price ?? ''}
                onChange={(e) =>
                  setPreset(i, { price: e.target.value === '' ? null : Number(e.target.value) })
                }
                placeholder="auto"
                title="Fixed chip price. Empty = calculated from the model's hourly or daily rate."
                style={{ width: '6rem' }}
              />
              <span className="st-spacer" />
              <button
                className="st-btn st-btn-danger st-btn-sm"
                type="button"
                onClick={() =>
                  set(
                    'duration_presets',
                    form.duration_presets.filter((_, j) => j !== i),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="st-btn st-btn-ghost st-btn-sm"
            type="button"
            style={{ marginTop: '0.5rem' }}
            onClick={() =>
              set('duration_presets', [
                ...form.duration_presets,
                { label: '', kind: 'day', qty: 1, price: null },
              ])
            }
          >
            + Add chip
          </button>
          <p className="st-note" style={{ marginTop: '0.4rem' }}>
            Empty <strong>Fixed price</strong> = the chip charges the model's rate (hour/day, week =
            day×7). With a number, that chip charges that flat amount for any board.
          </p>
        </div>

        {msg && (
          <div className="st-note" style={{ margin: '0.75rem 0' }}>
            {msg}
          </div>
        )}
        <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
