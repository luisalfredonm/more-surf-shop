import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import QrScanner from './QrScanner';
import RentalCheckoutModal from './RentalCheckoutModal';

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
const MS: Record<string, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };
const crNow = () => new Date(Date.now() - 6 * 3_600_000);
const nowDate = () => crNow().toISOString().slice(0, 10);
const nowTime = () => `${String(crNow().getUTCHours()).padStart(2, '0')}:00`;

interface UnitOpt {
  id: string;
  code: string;
  model_name: string;
  price_per_hour: number;
  price_per_day: number;
}
interface Preset {
  label: string;
  kind: string;
  qty: number;
  price?: number | null;
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
  const [date, setDate] = useState(nowDate());
  const [time, setTime] = useState(nowTime());
  const [rateType, setRateType] = useState<'hour' | 'day' | 'week'>('day');
  const [qty, setQty] = useState(1);

  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [note, setNote] = useState('');

  const [payMethod, setPayMethod] = useState<'cash' | 'card'>('cash');
  const [hasShift, setHasShift] = useState<boolean | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);

  function onScan(text: string) {
    setScan(false);
    const norm = text.trim().toLowerCase();
    const hit = units.find((u) => u.code.trim().toLowerCase() === norm);
    if (hit) {
      setUnitId(hit.id);
      setScanNote(null);
    } else {
      setScanNote(`"${text}" no es una tabla disponible.`);
    }
  }

  useEffect(() => {
    const sb = getBrowserSupabase();
    void sb
      .from('board_units')
      .select('id, code, board_models ( name, price_per_hour, price_per_day )')
      .eq('status', 'available')
      .order('code')
      .then(({ data }) => {
        setUnits(
          (data ?? []).map((u: any) => {
            const m = Array.isArray(u.board_models) ? u.board_models[0] : u.board_models;
            return {
              id: u.id,
              code: u.code,
              model_name: m?.name ?? '—',
              price_per_hour: Number(m?.price_per_hour) || 0,
              price_per_day: Number(m?.price_per_day) || 0,
            };
          }),
        );
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
  }, []);

  const unit = useMemo(() => units.find((u) => u.id === unitId) ?? null, [units, unitId]);

  const computedUnit = unit
    ? rateType === 'hour'
      ? unit.price_per_hour
      : rateType === 'week'
        ? unit.price_per_day * 7
        : unit.price_per_day
    : 0;
  const activePreset = presets.find((p) => p.kind === rateType && p.qty === qty);
  const chipPrice =
    activePreset && typeof activePreset.price === 'number' && activePreset.price >= 0
      ? activePreset.price
      : null;
  const total = chipPrice != null ? chipPrice : Math.round(computedUnit * qty * 100) / 100;
  const startAt = new Date(`${date}T${time}:00`);
  const endAt = new Date(startAt.getTime() + qty * (MS[rateType] ?? MS.day));

  // --- autocomplete cliente ---
  const searchCustomers = useCallback((q: string) => {
    if (q.trim().length < 2) return setHits([]);
    void getBrowserSupabase()
      .from('customers')
      .select('id, full_name, phone, email')
      .ilike('full_name', `%${q.trim()}%`)
      .limit(5)
      .then(({ data }) => setHits((data ?? []) as CustomerHit[]));
  }, []);

  useEffect(() => {
    if (customerId) return;
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

  const valid = unitId && qty >= 1 && cName.trim().length >= 2 && hasShift === true;

  async function submit(deliver: boolean) {
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
          start_at: startAt.toISOString(),
          rate_type: rateType,
          units_billed: qty,
          payment: { method: payMethod },
          customer: {
            id: customerId ?? undefined,
            full_name: cName.trim(),
            phone: cPhone.trim() || null,
            email: cEmail.trim() || null,
          },
          staff_note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        setErr(data.error || 'No se pudo crear la reserva.');
        setBusy(false);
        return;
      }
      if (deliver) {
        setCheckoutId(data.rental_id);
      } else {
        setMsg(`Reserva ${data.reference} creada.`);
        onCreated();
      }
      setBusy(false);
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
      {hasShift === false && (
        <div className="st-err">
          No tenés un turno de caja abierto. Andá a <strong>Caja → Cierre de caja</strong> y abrí tu
          turno para poder cobrar.
        </div>
      )}

      {/* Tabla */}
      <div className="st-field">
        <label>Tabla</label>
        <div className="st-inline">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Elegí una tabla disponible…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.model_name} · {money(u.price_per_day)}/día
              </option>
            ))}
          </select>
          <button
            type="button"
            className="st-btn st-btn-ghost st-btn-sm"
            onClick={() => {
              setScanNote(null);
              setScan(true);
            }}
          >
            📷 Escanear
          </button>
        </div>
        {scanNote && <p className="st-note">{scanNote}</p>}
        {units.length === 0 && <p className="st-note">No hay tablas disponibles. Cargá la flota en Fleet.</p>}
      </div>
      {scan && <QrScanner onScan={onScan} onClose={() => setScan(false)} />}

      {/* Retiro */}
      <div className="st-row">
        <div className="st-field">
          <label>Fecha de retiro</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="st-field">
          <label>Hora</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      {/* Duración */}
      <div className="st-field">
        <label>Duración</label>
        <div className="st-chiprow">
          {presets.map((p, i) => (
            <button
              key={i}
              type="button"
              className={`st-dchip ${rateType === p.kind && qty === p.qty ? 'on' : ''}`}
              onClick={() => {
                setRateType(p.kind as 'hour' | 'day' | 'week');
                setQty(p.qty);
              }}
            >
              {p.label}
            </button>
          ))}
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
            {chipPrice != null ? (
              <>
                <strong>{money(chipPrice)}</strong> (precio fijo del chip)
              </>
            ) : (
              <>
                {money(computedUnit)} × {qty} = <strong>{money(total)}</strong>
              </>
            )}{' '}
            · devuelve{' '}
            {endAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Pago (se cobra al reservar) */}
      <div className="st-field">
        <label>Pago — se cobra ahora{unit ? ` · ${money(total)}` : ''}</label>
        <div className="st-chiprow">
          <button
            type="button"
            className={`st-dchip ${payMethod === 'cash' ? 'on' : ''}`}
            onClick={() => setPayMethod('cash')}
          >
            Efectivo
          </button>
          <button
            type="button"
            className={`st-dchip ${payMethod === 'card' ? 'on' : ''}`}
            onClick={() => setPayMethod('card')}
          >
            Tarjeta
          </button>
        </div>
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
      <div className="st-row">
        <div className="st-field">
          <label>Email (opcional)</label>
          <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
        </div>
        <div className="st-field">
          <label>Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="st-modal-actions">
        <button
          className="st-btn st-btn-ghost st-btn-sm"
          type="button"
          disabled={!valid || busy}
          onClick={() => submit(false)}
        >
          {busy ? '…' : 'Reservar'}
        </button>
        <button
          className="st-btn st-btn-primary st-btn-sm"
          type="button"
          disabled={!valid || busy}
          onClick={() => submit(true)}
        >
          {busy ? '…' : `Reservar y entregar · ${money(total)}`}
        </button>
      </div>
      {!valid && !busy && (
        <p className="st-note" style={{ marginTop: '0.5rem' }}>
          Falta: {!unitId && 'tabla · '}
          {cName.trim().length < 2 && 'nombre · '}
          {hasShift === false && 'abrir turno de caja'}
        </p>
      )}

      {checkoutId && (
        <RentalCheckoutModal
          rentalId={checkoutId}
          onClose={() => {
            setCheckoutId(null);
            setMsg('Reserva creada (sin entregar).');
            onCreated();
          }}
          onDone={() => {
            setCheckoutId(null);
            onCreated();
          }}
        />
      )}
    </div>
  );
}
