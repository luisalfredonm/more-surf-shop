import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import UnitHistoryModal from './UnitHistoryModal';

const CATEGORIES = ['softtop', 'longboard', 'funboard', 'shortboard', 'fish', 'sup'] as const;
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;
const UNIT_STATUS = ['available', 'maintenance', 'retired'] as const;

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

interface Model {
  id: string;
  name: string;
  slug: string;
  category: string;
  length_label: string | null;
  volume_l: number | null;
  skill_level: string;
  description: string | null;
  image_urls: string[] | null;
  price_per_hour: number;
  price_per_day: number;
  width_in: number | null;
  thickness_in: number | null;
  fin_setup: string | null;
  construction: string | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  best_for: string[] | null;
  features: string[] | null;
  active: boolean;
  featured: boolean;
  sort_order: number;
}
interface Unit {
  id: string;
  model_id: string;
  code: string;
  slug: string | null;
  nickname: string | null;
  photo_url: string | null;
  default_fins: number;
  status: string;
}

const MODEL_COLS =
  'id, name, slug, category, length_label, volume_l, skill_level, description, image_urls, price_per_hour, price_per_day, width_in, thickness_in, fin_setup, construction, weight_min_kg, weight_max_kg, best_for, features, active, featured, sort_order';
const UNIT_COLS = 'id, model_id, code, slug, nickname, photo_url, default_fins, status';

export default function FleetView() {
  const [models, setModels] = useState<Model[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [openModelId, setOpenModelId] = useState<string | null>(null);
  const [histUnit, setHistUnit] = useState<{ id: string; code: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const [m, u] = await Promise.all([
      sb.from('board_models').select(MODEL_COLS).order('sort_order').order('name'),
      sb.from('board_units').select(UNIT_COLS).order('code'),
    ]);
    setModels((m.data ?? []) as Model[]);
    setUnits((u.data ?? []) as Unit[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Cargando…
      </p>
    );
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Modelos y tarifas se ven de inmediato en el catálogo online. Las unidades son las
        tablas físicas reservables (el <code>code</code> va en el sticker QR).
      </p>

      <h2 className="st-h2">Modelos</h2>
      <NewModelForm onSaved={load} />
      {models.length === 0 ? (
        <p className="st-empty">Sin modelos todavía.</p>
      ) : (
        models.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            unitCount={units.filter((u) => u.model_id === m.id).length}
            open={openModelId === m.id}
            onToggle={() => setOpenModelId(openModelId === m.id ? null : m.id)}
            onSaved={load}
          />
        ))
      )}

      <h2 className="st-h2" style={{ marginTop: '2rem' }}>
        Unidades (tablas físicas)
      </h2>
      <NewUnitForm models={models} onSaved={load} />
      {models.map((m) => {
        const mine = units.filter((u) => u.model_id === m.id);
        if (mine.length === 0) return null;
        return (
          <div className="st-card" key={m.id}>
            <strong className="st-svc-title">{m.name}</strong>
            {mine.map((u) => (
              <UnitRow
                key={u.id}
                unit={u}
                onSaved={load}
                onHistory={() => setHistUnit({ id: u.id, code: u.code })}
              />
            ))}
          </div>
        );
      })}
      {units.length === 0 && <p className="st-empty">Sin unidades todavía.</p>}

      {histUnit && <UnitHistoryModal unit={histUnit} onClose={() => setHistUnit(null)} />}
    </div>
  );
}

// ---------- Modelo: nuevo ----------

function NewModelForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('softtop');
  const [lengthLabel, setLengthLabel] = useState('');
  const [pph, setPph] = useState('');
  const [ppd, setPpd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) {
      setErr('Poné un nombre.');
      return;
    }
    setBusy(true);
    const { error } = await getBrowserSupabase().from('board_models').insert({
      name: name.trim(),
      slug: slugify(name),
      category,
      length_label: lengthLabel.trim() || null,
      price_per_hour: Number(pph) || 0,
      price_per_day: Number(ppd) || 0,
    });
    setBusy(false);
    if (error) {
      setErr(error.code === '23505' ? 'Ya existe un modelo con ese slug.' : error.message);
      return;
    }
    setName('');
    setLengthLabel('');
    setPph('');
    setPpd('');
    onSaved();
  }

  return (
    <form className="st-card" onSubmit={add}>
      {err && <div className="st-err">{err}</div>}
      <div className="st-row">
        <div className="st-field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Soft-top 8'0" />
        </div>
        <div className="st-field">
          <label>Categoría</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label>Largo</label>
          <input value={lengthLabel} onChange={(e) => setLengthLabel(e.target.value)} placeholder="8'0" />
        </div>
        <div className="st-field">
          <label>Tarifa / hora (USD)</label>
          <input type="number" min={0} value={pph} onChange={(e) => setPph(e.target.value)} />
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label>Tarifa / día (USD)</label>
          <input type="number" min={0} value={ppd} onChange={(e) => setPpd(e.target.value)} />
        </div>
        <div className="st-field" style={{ justifyContent: 'flex-end' }}>
          <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Agregando…' : '+ Agregar modelo'}
          </button>
        </div>
      </div>
      <p className="st-note">Semana = tarifa/día × 7.</p>
    </form>
  );
}

// ---------- Modelo: editar ----------

function ModelCard({
  model,
  unitCount,
  open,
  onToggle,
  onSaved,
}: {
  model: Model;
  unitCount: number;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(model);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setForm(model), [model]);

  function set<K extends keyof Model>(k: K, v: Model[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const { error } = await getBrowserSupabase()
      .from('board_models')
      .update({
        name: form.name.trim(),
        slug: slugify(form.slug || form.name),
        category: form.category,
        length_label: form.length_label?.trim() || null,
        volume_l: form.volume_l == null ? null : Number(form.volume_l),
        skill_level: form.skill_level,
        description: form.description?.trim() || null,
        image_urls: (form.image_urls ?? []).map((x) => x.trim()).filter(Boolean),
        price_per_hour: Number(form.price_per_hour) || 0,
        price_per_day: Number(form.price_per_day) || 0,
        width_in: form.width_in == null ? null : Number(form.width_in),
        thickness_in: form.thickness_in == null ? null : Number(form.thickness_in),
        fin_setup: form.fin_setup?.trim() || null,
        construction: form.construction?.trim() || null,
        weight_min_kg: form.weight_min_kg == null ? null : Number(form.weight_min_kg),
        weight_max_kg: form.weight_max_kg == null ? null : Number(form.weight_max_kg),
        best_for: (form.best_for ?? []).map((x) => x.trim()).filter(Boolean),
        features: (form.features ?? []).map((x) => x.trim()).filter(Boolean),
        active: form.active,
        featured: form.featured,
        sort_order: Number(form.sort_order) || 0,
      })
      .eq('id', model.id);
    setSaving(false);
    if (error) {
      setMsg(error.code === '23505' ? 'Slug repetido.' : error.message);
      return;
    }
    setMsg('Guardado.');
    onSaved();
  }

  async function remove() {
    if (unitCount > 0) {
      alert('Ese modelo tiene unidades. Quitalas primero.');
      return;
    }
    if (!confirm(`Eliminar el modelo "${model.name}"?`)) return;
    const { error } = await getBrowserSupabase().from('board_models').delete().eq('id', model.id);
    if (error) alert(error.message);
    else onSaved();
  }

  return (
    <div className="st-card">
      <button type="button" className="st-svc-head" onClick={onToggle} aria-expanded={open}>
        <span className={`st-dot ${form.active ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="st-svc-title">{form.name}</span>
        <span className="st-svc-sum">
          {form.category} · {money(form.price_per_hour)}/h · {money(form.price_per_day)}/día · {unitCount}{' '}
          {unitCount === 1 ? 'tabla' : 'tablas'}
        </span>
        {form.featured && <span className="st-svc-badge">destacado</span>}
        <span className="st-svc-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="st-svc-form">
          <div className="st-row">
            <div className="st-field">
              <label>Nombre</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="st-field">
              <label>Slug (URL)</label>
              <input value={form.slug} onChange={(e) => set('slug', e.target.value)} />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Categoría</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label>Nivel</label>
              <select value={form.skill_level} onChange={(e) => set('skill_level', e.target.value)}>
                {SKILL_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Largo</label>
              <input value={form.length_label ?? ''} onChange={(e) => set('length_label', e.target.value)} />
            </div>
            <div className="st-field">
              <label>Volumen (L)</label>
              <input
                type="number"
                value={form.volume_l ?? ''}
                onChange={(e) => set('volume_l', e.target.value === '' ? null : (Number(e.target.value) as number))}
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Tarifa / hora (USD)</label>
              <input
                type="number"
                min={0}
                value={form.price_per_hour}
                onChange={(e) => set('price_per_hour', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Tarifa / día (USD)</label>
              <input
                type="number"
                min={0}
                value={form.price_per_day}
                onChange={(e) => set('price_per_day', Number(e.target.value))}
              />
            </div>
          </div>

          <p className="st-field-label" style={{ margin: '0.5rem 0 0' }}>Ficha del catálogo</p>
          <div className="st-row">
            <div className="st-field">
              <label>Ancho (pulgadas)</label>
              <input
                type="number"
                step="0.01"
                value={form.width_in ?? ''}
                onChange={(e) => set('width_in', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="20.25"
              />
            </div>
            <div className="st-field">
              <label>Grosor (pulgadas)</label>
              <input
                type="number"
                step="0.01"
                value={form.thickness_in ?? ''}
                onChange={(e) => set('thickness_in', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="2.5"
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Quillas</label>
              <input
                value={form.fin_setup ?? ''}
                onChange={(e) => set('fin_setup', e.target.value)}
                placeholder="Thruster"
              />
            </div>
            <div className="st-field">
              <label>Construcción</label>
              <input
                value={form.construction ?? ''}
                onChange={(e) => set('construction', e.target.value)}
                placeholder="Poliéster"
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Peso recomendado — mín (kg)</label>
              <input
                type="number"
                min={0}
                value={form.weight_min_kg ?? ''}
                onChange={(e) => set('weight_min_kg', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="55"
              />
            </div>
            <div className="st-field">
              <label>Peso recomendado — máx (kg)</label>
              <input
                type="number"
                min={0}
                value={form.weight_max_kg ?? ''}
                onChange={(e) => set('weight_max_kg', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="95"
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Mejor en (uno por línea)</label>
              <textarea
                rows={2}
                value={(form.best_for ?? []).join('\n')}
                onChange={(e) => set('best_for', e.target.value.split('\n'))}
                placeholder={'Beach break\nPoint break'}
              />
            </div>
            <div className="st-field">
              <label>Incluye (uno por línea)</label>
              <textarea
                rows={2}
                value={(form.features ?? []).join('\n')}
                onChange={(e) => set('features', e.target.value.split('\n'))}
                placeholder={'Quillas FCS II incluidas\nIdeal Tamarindo'}
              />
            </div>
          </div>

          <div className="st-row">
            <div className="st-field">
              <label>Orden</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => set('sort_order', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Estado</label>
              <select
                value={form.active ? 'yes' : 'no'}
                onChange={(e) => set('active', e.target.value === 'yes')}
              >
                <option value="yes">Activo — visible online</option>
                <option value="no">Inactivo — oculto</option>
              </select>
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Destacado</label>
              <select
                value={form.featured ? 'yes' : 'no'}
                onChange={(e) => set('featured', e.target.value === 'yes')}
              >
                <option value="no">No</option>
                <option value="yes">Sí</option>
              </select>
            </div>
            <div className="st-field" />
          </div>
          <div className="st-field">
            <label>Descripción</label>
            <textarea
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="st-field">
            <label>Fotos — URLs (una por línea)</label>
            <textarea
              rows={2}
              value={(form.image_urls ?? []).join('\n')}
              onChange={(e) => set('image_urls', e.target.value.split('\n'))}
            />
          </div>

          {msg && (
            <div className="st-note" style={{ marginBottom: '0.5rem' }}>
              {msg}
            </div>
          )}
          <div className="st-actions">
            <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button className="st-btn st-btn-danger st-btn-sm" type="button" onClick={remove}>
              Eliminar modelo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Unidad: nueva ----------

function NewUnitForm({ models, onSaved }: { models: Model[]; onSaved: () => void }) {
  const [modelId, setModelId] = useState('');
  const [code, setCode] = useState('');
  const [fins, setFins] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!modelId && models.length) setModelId(models[0].id);
  }, [models, modelId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!modelId) {
      setErr('Creá un modelo primero.');
      return;
    }
    if (code.trim().length < 1) {
      setErr('Poné el número de tabla.');
      return;
    }
    setBusy(true);
    const model = models.find((m) => m.id === modelId);
    const { error } = await getBrowserSupabase().from('board_units').insert({
      model_id: modelId,
      code: code.trim(),
      slug: slugify(`${model?.name ?? 'tabla'}-${code.trim()}`),
      default_fins: Math.max(0, Number(fins) || 0),
    });
    setBusy(false);
    if (error) {
      setErr(error.code === '23505' ? 'Ya hay una tabla con ese número.' : error.message);
      return;
    }
    setCode('');
    onSaved();
  }

  return (
    <form className="st-card" onSubmit={add}>
      {err && <div className="st-err">{err}</div>}
      <div className="st-row">
        <div className="st-field">
          <label>Modelo</label>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label>Nº de tabla (code / QR)</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6.2 Ap" />
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label>Fins por defecto</label>
          <input
            type="number"
            min={0}
            max={6}
            value={fins}
            onChange={(e) => setFins(Number(e.target.value))}
          />
        </div>
        <div className="st-field" style={{ justifyContent: 'flex-end' }}>
          <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Agregando…' : '+ Agregar tabla'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------- Unidad: fila editable ----------

function UnitRow({
  unit,
  onSaved,
  onHistory,
}: {
  unit: Unit;
  onSaved: () => void;
  onHistory: () => void;
}) {
  const [f, setF] = useState(unit);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoWarn, setPhotoWarn] = useState(false);

  useEffect(() => setF(unit), [unit]);

  function set<K extends keyof Unit>(k: K, v: Unit[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  const dirty =
    f.default_fins !== unit.default_fins ||
    f.status !== unit.status ||
    (f.slug ?? '') !== (unit.slug ?? '') ||
    (f.nickname ?? '') !== (unit.nickname ?? '') ||
    (f.photo_url ?? '') !== (unit.photo_url ?? '');

  async function save() {
    setBusy(true);
    const { error } = await getBrowserSupabase()
      .from('board_units')
      .update({
        default_fins: Math.max(0, Number(f.default_fins) || 0),
        status: f.status,
        slug: f.slug?.trim() ? slugify(f.slug) : null,
        nickname: f.nickname?.trim() || null,
        photo_url: f.photo_url?.trim() || null,
      })
      .eq('id', unit.id);
    setBusy(false);
    if (error) alert(error.code === '23505' ? 'Ese slug ya existe.' : error.message);
    else onSaved();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoWarn(false);
    try {
      const sb = getBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `catalog/${unit.code.replace(/\s+/g, '-')}-${Date.now()}.${ext}`;
      const up = await sb.storage.from('rental-photos').upload(path, file, { upsert: false });
      if (up.error) setPhotoWarn(true);
      else set('photo_url', sb.storage.from('rental-photos').getPublicUrl(path).data.publicUrl);
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Eliminar la tabla ${unit.code}?`)) return;
    const { error } = await getBrowserSupabase().from('board_units').delete().eq('id', unit.id);
    if (error) alert(error.message);
    else onSaved();
  }

  return (
    <>
      <div className="st-slotlist-row">
        <button
          type="button"
          className="st-linkbtn"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, textDecoration: 'none' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▲' : '▼'} {unit.code}
        </button>
        {unit.photo_url && (
          <img
            src={unit.photo_url}
            alt=""
            style={{ width: 34, height: 26, objectFit: 'cover', borderRadius: 4 }}
          />
        )}
        {unit.nickname && <span className="st-note">{unit.nickname}</span>}
        <span className="st-note">fins {unit.default_fins}</span>
        <span className={`st-badge ${unit.status === 'available' ? 'confirmed' : 'unpaid'}`}>
          {unit.status}
        </span>
        <span className="st-spacer" />
        <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={onHistory}>
          Historial
        </button>
        <button className="st-btn st-btn-danger st-btn-sm" type="button" onClick={remove}>
          Quitar
        </button>
      </div>

      {open && (
        <div className="st-svc-form">
          <div className="st-row">
            <div className="st-field">
              <label>Apodo (opcional)</label>
              <input
                value={f.nickname ?? ''}
                onChange={(e) => set('nickname', e.target.value)}
                placeholder="la amarilla"
              />
            </div>
            <div className="st-field">
              <label>Slug (URL del detalle)</label>
              <input value={f.slug ?? ''} onChange={(e) => set('slug', e.target.value)} />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Fins por defecto</label>
              <input
                type="number"
                min={0}
                max={6}
                value={f.default_fins}
                onChange={(e) => set('default_fins', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Estado</label>
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>
                {UNIT_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="st-field">
            <label>Foto de esta tabla (la que ve el cliente)</label>
            <input type="file" accept="image/*" onChange={onPhoto} disabled={photoBusy} />
            {photoBusy && <span className="st-note">Subiendo…</span>}
            {photoWarn && <span className="st-note">No se pudo subir. Revisá el bucket rental-photos.</span>}
            <input
              value={f.photo_url ?? ''}
              onChange={(e) => set('photo_url', e.target.value)}
              placeholder="o pegá una URL"
            />
            {f.photo_url && (
              <img
                src={f.photo_url}
                alt=""
                style={{ maxWidth: 220, borderRadius: 6, marginTop: '0.4rem' }}
              />
            )}
          </div>
          <button
            className="st-btn st-btn-primary st-btn-sm"
            type="button"
            disabled={!dirty || busy}
            onClick={save}
          >
            {busy ? 'Guardando…' : 'Guardar tabla'}
          </button>
        </div>
      )}
    </>
  );
}
