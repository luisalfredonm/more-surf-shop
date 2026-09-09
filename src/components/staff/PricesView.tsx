import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

interface Service {
  id: string;
  name: string;
  badge: string | null;
  price_per_person: number;
  ratio_label: string | null;
  min_guests: number;
  max_guests: number | null;
  max_capacity: number;
  duration_min: number;
  sort_order: number;
  active: boolean;
  description: string | null;
  included: string[] | null;
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export default function PricesView() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getBrowserSupabase()
      .from('class_types')
      .select(
        'id, name, badge, price_per_person, ratio_label, min_guests, max_guests, max_capacity, duration_min, sort_order, active, description, included',
      )
      .eq('category', 'lesson')
      .order('sort_order');
    setServices((data ?? []) as Service[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Changes show up immediately in the booking wizard.
      </p>

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Loading…
        </p>
      ) : (
        services.map((s) => (
          <ServiceCard
            key={s.id}
            svc={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            onSaved={load}
          />
        ))
      )}
    </div>
  );
}

function ServiceCard({
  svc,
  open,
  onToggle,
  onSaved,
}: {
  svc: Service;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(svc);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setForm(svc), [svc]);

  function set<K extends keyof Service>(k: K, v: Service[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const { error } = await getBrowserSupabase()
      .from('class_types')
      .update({
        name: form.name.trim(),
        badge: form.badge?.trim() || null,
        price_per_person: Number(form.price_per_person) || 0,
        ratio_label: form.ratio_label?.trim() || null,
        min_guests: Math.max(1, Number(form.min_guests) || 1),
        max_guests: form.max_guests == null ? null : Number(form.max_guests),
        max_capacity: Math.max(1, Number(form.max_capacity) || 1),
        duration_min: Math.max(1, Number(form.duration_min) || 90),
        sort_order: Number(form.sort_order) || 0,
        active: form.active,
        description: form.description?.trim() || null,
        included: (form.included ?? []).map((x) => x.trim()).filter(Boolean),
      })
      .eq('id', svc.id);
    setSaving(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg('Saved.');
    onSaved();
  }

  return (
    <div className="st-card">
      <button
        type="button"
        className="st-svc-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={`st-dot ${form.active ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="st-svc-title">{form.name}</span>
        <span className="st-svc-sum">
          {money(form.price_per_person)}/person · {form.min_guests}–
          {form.max_guests ?? form.max_capacity} people · {form.duration_min}min
        </span>
        {form.badge && <span className="st-svc-badge">{form.badge}</span>}
        <span className="st-svc-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="st-svc-form">
          <div className="st-row">
            <div className="st-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="st-field">
              <label>Badge (optional)</label>
              <input
                value={form.badge ?? ''}
                onChange={(e) => set('badge', e.target.value)}
                placeholder="e.g. Most popular"
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Price / person (USD)</label>
              <input
                type="number"
                min={0}
                value={form.price_per_person}
                onChange={(e) => set('price_per_person', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Ratio (text)</label>
              <input
                value={form.ratio_label ?? ''}
                onChange={(e) => set('ratio_label', e.target.value)}
                placeholder="e.g. 2 or 3 people, one instructor"
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Min. people / booking</label>
              <input
                type="number"
                min={1}
                value={form.min_guests}
                onChange={(e) => set('min_guests', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Max. people / booking</label>
              <input
                type="number"
                min={1}
                value={form.max_guests ?? ''}
                onChange={(e) =>
                  set('max_guests', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Total capacity / time slot</label>
              <input
                type="number"
                min={1}
                value={form.max_capacity}
                onChange={(e) => set('max_capacity', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Duration (minutes)</label>
              <input
                type="number"
                min={1}
                value={form.duration_min}
                onChange={(e) => set('duration_min', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => set('sort_order', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Active</label>
              <select
                value={form.active ? 'yes' : 'no'}
                onChange={(e) => set('active', e.target.value === 'yes')}
              >
                <option value="yes">Yes — visible in the wizard</option>
                <option value="no">No — hidden</option>
              </select>
            </div>
          </div>
          <div className="st-field">
            <label>Description</label>
            <textarea
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="st-field">
            <label>Included (one per line)</label>
            <textarea
              rows={3}
              value={(form.included ?? []).join('\n')}
              onChange={(e) => set('included', e.target.value.split('\n'))}
            />
          </div>

          {msg && (
            <div className="st-note" style={{ marginBottom: '0.5rem' }}>
              {msg}
            </div>
          )}
          <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}
