import { useEffect, useState } from 'react';
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
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n));
const dt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const RATE_LABEL: Record<string, [string, string]> = {
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
};

interface Loaded {
  id: string;
  reference: string;
  status: string;
  start_at: string;
  end_at: string;
  rate_type: string;
  units_billed: number;
  total_amount: number;
  currency: string;
  payment_id: string | null;
  code: string;
  model: string;
  customer_name: string;
  default_fins: number;
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const COLS =
  'id, reference, status, start_at, end_at, rate_type, units_billed, total_amount, currency, payment_id, board_units ( code, default_fins ), board_models ( name ), customers ( full_name )';

export default function RentalCheckoutModal({
  rentalId,
  onClose,
  onDone,
}: {
  rentalId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [r, setR] = useState<Loaded | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [fins, setFins] = useState(3);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoWarn, setPhotoWarn] = useState(false);
  const [condNotes, setCondNotes] = useState('');

  const [signerName, setSignerName] = useState('');
  const [isMinor, setIsMinor] = useState(false);
  const [guardian, setGuardian] = useState('');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const [collectCash, setCollectCash] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    void getBrowserSupabase()
      .from('rentals')
      .select(COLS)
      .eq('id', rentalId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setLoadErr(error.message);
        if (!data) return setLoadErr('No se encontró la reserva.');
        const d = data as any;
        const unit = one<{ code?: string; default_fins?: number }>(d.board_units);
        const loaded: Loaded = {
          id: d.id,
          reference: d.reference,
          status: d.status,
          start_at: d.start_at,
          end_at: d.end_at,
          rate_type: d.rate_type,
          units_billed: d.units_billed,
          total_amount: Number(d.total_amount),
          currency: d.currency || 'USD',
          payment_id: d.payment_id,
          code: unit?.code ?? '—',
          model: one<{ name?: string }>(d.board_models)?.name ?? '—',
          customer_name: one<{ full_name?: string }>(d.customers)?.full_name ?? '',
          default_fins: unit?.default_fins ?? 3,
        };
        setR(loaded);
        setFins(loaded.default_fins);
        setSignerName(loaded.customer_name);
      });
  }, [rentalId]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !r) return;
    setPhotoBusy(true);
    setPhotoWarn(false);
    try {
      const sb = getBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${r.code.replace(/\s+/g, '-')}/${Date.now()}-out.${ext}`;
      const up = await sb.storage.from('rental-photos').upload(path, file, { upsert: false });
      if (up.error) setPhotoWarn(true);
      else setPhoto(sb.storage.from('rental-photos').getPublicUrl(path).data.publicUrl);
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
    }
  }

  const due = r && !r.payment_id ? r.total_amount : 0;
  const valid =
    signerName.trim().length >= 2 &&
    accepted &&
    signature &&
    (!isMinor || guardian.trim().length >= 2);

  async function submit() {
    if (!r || !valid) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: sess } = await getBrowserSupabase().auth.getSession();
      const res = await fetch('/api/rentals/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          rental_id: r.id,
          fins_out: fins,
          condition_out_photo_url: photo,
          condition_out_notes: condNotes.trim() || null,
          collect_cash: collectCash && due > 0,
          waiver: {
            signer_name: signerName.trim(),
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
      if (!res.ok || !data.ok) {
        setErr(data.error || 'No se pudo registrar la entrega.');
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setErr('Falló la conexión.');
      setBusy(false);
    }
  }

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Entregar tabla">
        <div className="st-modal-hd">
          <h3>Entregar</h3>
          <span className="st-modal-ref">
            {r ? `${r.code} · ${r.model} · ${r.customer_name}` : '…'}
          </span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {r && (
          <div className="st-checkout-span">
            <div>
              <span className="st-cs-label">Retiro</span>
              {dt(r.start_at)}
            </div>
            <span className="st-cs-arrow">→</span>
            <div>
              <span className="st-cs-label">Devolución</span>
              {dt(r.end_at)}
            </div>
            <span className="st-cs-total">
              {r.units_billed}{' '}
              {(RATE_LABEL[r.rate_type] ?? ['', ''])[r.units_billed === 1 ? 0 : 1]} ·{' '}
              {money(r.total_amount, r.currency)}
            </span>
          </div>
        )}

        {loadErr && <div className="st-err">{loadErr}</div>}
        {err && <div className="st-err">{err}</div>}
        {!r && !loadErr && (
          <p className="st-empty">
            <span className="st-spin">◠</span> Cargando…
          </p>
        )}

        {r && r.status !== 'confirmed' && (
          <div className="st-err">Esta reserva ya fue entregada o cancelada ({r.status}).</div>
        )}

        {r && r.status === 'confirmed' && (
          <>
            {/* Condición de salida */}
            <div className="st-row">
              <div className="st-field">
                <label>Fins entregadas</label>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={fins}
                  onChange={(e) => setFins(Number(e.target.value))}
                />
              </div>
              <div className="st-field">
                <label>Foto de la tabla</label>
                <input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={photoBusy} />
                {photoBusy && <span className="st-note">Subiendo…</span>}
                {photo && <span className="st-note">✓ foto cargada</span>}
                {photoWarn && <span className="st-note">No se pudo subir — seguí sin foto.</span>}
              </div>
            </div>
            <div className="st-field">
              <label>Nota de condición (opcional)</label>
              <input
                value={condNotes}
                onChange={(e) => setCondNotes(e.target.value)}
                placeholder="ej. ding chico en el nose"
              />
            </div>

            {/* Waiver */}
            <div className="st-field">
              <label>Waiver — lo firma {isMinor ? 'el tutor' : 'el cliente'}</label>
              <div className="st-row">
                <div className="st-field">
                  <label>Nombre del que alquila</label>
                  <input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                </div>
                <div className="st-field">
                  <label>¿Es menor de edad?</label>
                  <select value={isMinor ? 'yes' : 'no'} onChange={(e) => setIsMinor(e.target.value === 'yes')}>
                    <option value="no">No</option>
                    <option value="yes">Sí</option>
                  </select>
                </div>
              </div>
              {isMinor && (
                <div className="st-field">
                  <label>Nombre del tutor</label>
                  <input value={guardian} onChange={(e) => setGuardian(e.target.value)} />
                </div>
              )}
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

              <div className="st-waiver">
                <h4>{WAIVER_TITLE}</h4>
                <p className="st-waiver-sub">{WAIVER_SUBTITLE}</p>
                <p>
                  <strong>Releasee:</strong> {WAIVER_RELEASEE.legalName} (
                  {WAIVER_RELEASEE.commercialName}), corporate ID {WAIVER_RELEASEE.idNumber}.
                </p>
                {getWaiverClauses(ACTIVITY).map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
                <p>{WAIVER_ACKNOWLEDGEMENT}</p>
              </div>

              <SignaturePad key={isMinor ? 'm' : 'a'} onChange={setSignature} />

              <label className="st-check">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>
                  {acceptanceLabel({
                    isMinor,
                    signerName,
                    guardianName: guardian,
                    minorName: signerName,
                  })}
                </span>
              </label>
            </div>

            {/* Pago */}
            {due > 0 && (
              <label className="st-check">
                <input
                  type="checkbox"
                  checked={collectCash}
                  onChange={(e) => setCollectCash(e.target.checked)}
                />
                <span>Cobrar {money(due, r.currency)} en efectivo ahora</span>
              </label>
            )}

            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>
                Cancelar
              </button>
              <button className="st-btn st-btn-primary st-btn-sm" disabled={!valid || busy} onClick={submit}>
                {busy ? 'Entregando…' : 'Confirmar entrega'}
              </button>
            </div>
            {!valid && !busy && (
              <p className="st-note" style={{ marginTop: '0.4rem' }}>
                Falta: {signerName.trim().length < 2 && 'nombre · '}
                {isMinor && guardian.trim().length < 2 && 'tutor · '}
                {!signature && 'firma · '}
                {!accepted && 'aceptar términos'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
