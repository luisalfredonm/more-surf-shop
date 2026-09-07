import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import {
  acceptanceLabel,
  getWaiverClauses,
  WAIVER_ACKNOWLEDGEMENT,
  WAIVER_RELEASEE,
  WAIVER_SUBTITLE,
  WAIVER_TITLE,
} from '@lib/waiver';
import SignaturePad from './SignaturePad';

const ACTIVITY = 'surfboard rental';
const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
const MS: Record<string, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };

interface UnitOpt {
  id: string;
  code: string;
  default_fins: number;
  model_name: string;
  category: string;
  price_per_hour: number;
  price_per_day: number;
}
interface Preset {
  label: string;
  kind: string;
  qty: number;
}
interface CustomerHit {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export default function NewRentalForm({ onCreated }: { onCreated: () => void }) {
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [unitId, setUnitId] = useState('');
  const [rateType, setRateType] = useState<'hour' | 'day' | 'week'>('day');
  const [qty, setQty] = useState(1);

  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [hits, setHits] = useState<CustomerHit[]>([]);

  const [fins, setFins] = useState(3);
  const [photoOut, setPhotoOut] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoWarn, setPhotoWarn] = useState(false);
  const [condNotes, setCondNotes] = useState('');

  const [isMinor, setIsMinor] = useState(false);
  const [guardian, setGuardian] = useState('');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const [payment, setPayment] = useState<'cash' | 'on_return'>('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const sb = getBrowserSupabase();
    void sb
      .from('board_units')
      .select('id, code, default_fins, board_models ( name, category, price_per_hour, price_per_day )')
      .eq('status', 'available')
      .order('code')
      .then(({ data }) => {
        const list: UnitOpt[] = (data ?? []).map((u: any) => {
          const m = Array.isArray(u.board_models) ? u.board_models[0] : u.board_models;
          return {
            id: u.id,
            code: u.code,
            default_fins: u.default_fins,
            model_name: m?.name ?? '—',
            category: m?.category ?? '',
            price_per_hour: Number(m?.price_per_hour) || 0,
            price_per_day: Number(m?.price_per_day) || 0,
          };
        });
        setUnits(list);
      });
    void sb
      .from('rental_settings')
      .select('duration_presets')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data?.duration_presets as Preset[]) ?? [];
        setPresets(Array.isArray(p) ? p : []);
      });
  }, []);

  const unit = useMemo(() => units.find((u) => u.id === unitId) ?? null, [units, unitId]);

  useEffect(() => {
    if (unit) setFins(unit.default_fins);
  }, [unit]);

  const unitPrice = unit
    ? rateType === 'hour'
      ? unit.price_per_hour
      : rateType === 'week'
        ? unit.price_per_day * 7
        : unit.price_per_day
    : 0;
  const total = Math.round(unitPrice * qty * 100) / 100;
  const endAt = new Date(Date.now() + qty * (MS[rateType] ?? MS.day));

  // --- autocomplete cliente ---
  const searchCustomers = useCallback((q: string) => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    void getBrowserSupabase()
      .from('customers')
      .select('id, full_name, phone, email')
      .ilike('full_name', `%${q.trim()}%`)
      .limit(5)
      .then(({ data }) => setHits((data ?? []) as CustomerHit[]));
  }, []);

  useEffect(() => {
    if (customerId) return; // ya elegido
    const t = setTimeout(() => searchCustomers(cName), 300);
    return () => clearTimeout(t);
  }, [cName, customerId, searchCustomers]);

  function pickCustomer(h: CustomerHit) {
    setCustomerId(h.id);
    setCName(h.full_name);
    setCPhone(h.phone ?? '');
    setCEmail(h.email && !h.email.endsWith('@moresurfshop.local') ? h.email : '');
    setHits([]);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoWarn(false);
    try {
      const sb = getBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${(unit?.code || 'unit').replace(/\s+/g, '-')}/${Date.now()}-out.${ext}`;
      const up = await sb.storage.from('rental-photos').upload(path, file, { upsert: false });
      if (up.error) {
        setPhotoWarn(true);
      } else {
        setPhotoOut(sb.storage.from('rental-photos').getPublicUrl(path).data.publicUrl);
      }
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
    }
  }

  const valid =
    unitId &&
    qty >= 1 &&
    cName.trim().length >= 2 &&
    accepted &&
    signature &&
    (!isMinor || guardian.trim().length >= 2);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { data: sess } = await getBrowserSupabase().auth.getSession();
      const res = await fetch('/api/rentals/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          unit_id: unitId,
          rate_type: rateType,
          units_billed: qty,
          customer: {
            id: customerId ?? undefined,
            full_name: cName.trim(),
            phone: cPhone.trim() || null,
            email: cEmail.trim() || null,
          },
          payment,
          fins_out: fins,
          condition_out_photo_url: photoOut,
          condition_out_notes: condNotes.trim() || null,
          waiver: {
            signer_name: cName.trim(),
            is_minor: isMinor,
            guardian_name: isMinor ? guardian.trim() : null,
            emergency_contact_name: ecName.trim() || null,
            emergency_contact_phone: ecPhone.trim() || null,
            accepted_terms: true,
            signature_svg: signature,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        setErr(data.error || 'No se pudo registrar el alquiler.');
        setBusy(false);
        return;
      }
      setMsg(`Alquiler ${data.reference} registrado.`);
      onCreated();
    } catch {
      setErr('Falló la conexión.');
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

      {/* Tabla */}
      <div className="st-field">
        <label>Tabla</label>
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Elegí una tabla disponible…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} — {u.model_name} · {money(u.price_per_day)}/día
            </option>
          ))}
        </select>
        {units.length === 0 && <p className="st-note">No hay tablas disponibles. Cargá la flota en Fleet.</p>}
      </div>

      {/* Duración */}
      <div className="st-field">
        <label>Duración</label>
        <div className="st-chiprow">
          {presets.map((p, i) => {
            const on = rateType === p.kind && qty === p.qty;
            return (
              <button
                key={i}
                type="button"
                className={`st-dchip ${on ? 'on' : ''}`}
                onClick={() => {
                  setRateType(p.kind as 'hour' | 'day' | 'week');
                  setQty(p.qty);
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="st-row" style={{ marginTop: '0.5rem' }}>
          <div className="st-field">
            <label>Tipo</label>
            <select value={rateType} onChange={(e) => setRateType(e.target.value as 'hour' | 'day' | 'week')}>
              <option value="hour">Horas</option>
              <option value="day">Días</option>
              <option value="week">Semanas</option>
            </select>
          </div>
          <div className="st-field">
            <label>Cantidad</label>
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
          </div>
        </div>
        {unit && (
          <p className="st-note">
            {money(unitPrice)} × {qty} = <strong>{money(total)}</strong> · devuelve{' '}
            {endAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Cliente */}
      <div className="st-row">
        <div className="st-field" style={{ position: 'relative' }}>
          <label>Nombre del cliente</label>
          <input
            value={cName}
            onChange={(e) => {
              setCName(e.target.value);
              setCustomerId(null);
            }}
            autoComplete="off"
          />
          {hits.length > 0 && (
            <div className="st-ac">
              {hits.map((h) => (
                <button type="button" key={h.id} onClick={() => pickCustomer(h)}>
                  <strong>{h.full_name}</strong>
                  {h.phone ? ` · ${h.phone}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="st-field">
          <label>Teléfono</label>
          <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
        </div>
      </div>
      <div className="st-field">
        <label>Email (opcional)</label>
        <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
      </div>

      {/* Condición de salida */}
      <div className="st-row">
        <div className="st-field">
          <label>Fins entregadas</label>
          <input type="number" min={0} max={6} value={fins} onChange={(e) => setFins(Number(e.target.value))} />
        </div>
        <div className="st-field">
          <label>Foto de la tabla</label>
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={photoBusy} />
          {photoBusy && <span className="st-note">Subiendo…</span>}
          {photoOut && <span className="st-note">✓ foto cargada</span>}
          {photoWarn && <span className="st-note">No se pudo subir (falta el bucket) — seguí sin foto.</span>}
        </div>
      </div>
      <div className="st-field">
        <label>Nota de condición (opcional)</label>
        <input value={condNotes} onChange={(e) => setCondNotes(e.target.value)} placeholder="ej. ding chico en el nose" />
      </div>

      {/* Waiver */}
      <div className="st-field">
        <label>Waiver — lo firma {isMinor ? 'el tutor' : 'el cliente'}</label>
        <div className="st-row">
          <div className="st-field">
            <label>Contacto de emergencia — nombre</label>
            <input value={ecName} onChange={(e) => setEcName(e.target.value)} />
          </div>
          <div className="st-field">
            <label>Teléfono</label>
            <input value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
          </div>
        </div>
        <div className="st-row">
          <div className="st-field">
            <label>¿Es menor de edad?</label>
            <select value={isMinor ? 'yes' : 'no'} onChange={(e) => setIsMinor(e.target.value === 'yes')}>
              <option value="no">No</option>
              <option value="yes">Sí</option>
            </select>
          </div>
          {isMinor && (
            <div className="st-field">
              <label>Nombre del tutor</label>
              <input value={guardian} onChange={(e) => setGuardian(e.target.value)} />
            </div>
          )}
        </div>

        <div className="st-waiver">
          <h4>{WAIVER_TITLE}</h4>
          <p className="st-waiver-sub">{WAIVER_SUBTITLE}</p>
          <p>
            <strong>Releasee:</strong> {WAIVER_RELEASEE.legalName} ({WAIVER_RELEASEE.commercialName}),
            corporate ID {WAIVER_RELEASEE.idNumber}.
          </p>
          {getWaiverClauses(ACTIVITY).map((c, i) => (
            <p key={i}>{c}</p>
          ))}
          <p>{WAIVER_ACKNOWLEDGEMENT}</p>
        </div>

        <SignaturePad key={`${unitId}-${isMinor}`} onChange={setSignature} />

        <label className="st-check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            {acceptanceLabel({
              isMinor,
              signerName: cName,
              guardianName: guardian,
              minorName: cName,
            })}
          </span>
        </label>
      </div>

      {/* Pago */}
      <div className="st-field">
        <label>Pago</label>
        <select value={payment} onChange={(e) => setPayment(e.target.value as 'cash' | 'on_return')}>
          <option value="cash">Efectivo — cobrado ahora ({money(total)})</option>
          <option value="on_return">Pagar al devolver</option>
        </select>
      </div>

      <button className="st-btn st-btn-primary" type="button" disabled={!valid || busy} onClick={submit}>
        {busy ? 'Registrando…' : `Registrar alquiler · ${money(total)}`}
      </button>
      {!valid && !busy && (
        <p className="st-note" style={{ marginTop: '0.5rem' }}>
          Falta: {!unitId && 'tabla · '}
          {cName.trim().length < 2 && 'nombre · '}
          {isMinor && guardian.trim().length < 2 && 'tutor · '}
          {!signature && 'firma · '}
          {!accepted && 'aceptar términos'}
        </p>
      )}
    </div>
  );
}
