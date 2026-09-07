import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import {
  acceptanceLabel,
  getWaiverClauses,
  WAIVER_ACKNOWLEDGEMENT,
  WAIVER_RELEASEE,
  WAIVER_SUBTITLE,
  WAIVER_TITLE,
} from '@lib/waiver';

const ACTIVITY = 'surf lessons';

interface Person {
  full_name: string;
  is_minor: boolean | null;
  guardian_name: string;
  ec_name: string;
  ec_phone: string;
  signature: string | null; // SVG string
  accepted: boolean;
  done: boolean;
}

type Sub = 'name' | 'emergency' | 'minor' | 'guardian' | 'sign' | 'next';

const blank = (): Person => ({
  full_name: '',
  is_minor: null,
  guardian_name: '',
  ec_name: '',
  ec_phone: '',
  signature: null,
  accepted: false,
  done: false,
});

export default function CheckinModal({
  booking,
  onClose,
  onDone,
}: {
  booking: { id: string; reference: string; participants_count: number; customer_name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([blank()]);
  const [idx, setIdx] = useState(0);
  const [sub, setSub] = useState<Sub>('name');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cur = people[idx];
  const doneCount = people.filter((p) => p.done).length;
  const signerName = cur.is_minor ? cur.guardian_name.trim() : cur.full_name.trim();

  const patch = (d: Partial<Person>) =>
    setPeople((ps) => ps.map((p, i) => (i === idx ? { ...p, ...d } : p)));

  const tryClose = useCallback(() => {
    if (doneCount > 0 && !confirm('¿Cerrar sin guardar el check-in? Se pierden las firmas.')) return;
    onClose();
  }, [doneCount, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tryClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tryClose]);

  function addAnother() {
    setPeople((ps) => [...ps, blank()]);
    setIdx((i) => i + 1);
    setSub('name');
  }

  async function finish() {
    setBusy(true);
    setErr(null);
    const payload = {
      booking_id: booking.id,
      participants: people
        .filter((p) => p.done)
        .map((p) => ({
          full_name: p.full_name.trim(),
          is_minor: !!p.is_minor,
          guardian_name: p.is_minor ? p.guardian_name.trim() : null,
          emergency_contact_name: p.ec_name.trim() || null,
          emergency_contact_phone: p.ec_phone.trim() || null,
          accepted_terms: true as const,
          signature_svg: p.signature,
        })),
    };
    try {
      const { data: sess } = await getBrowserSupabase().auth.getSession();
      const res = await fetch('/api/bookings/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || 'No se pudo guardar el check-in.');
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setErr('Falló la conexión.');
      setBusy(false);
    }
  }

  const stepHint =
    sub === 'next'
      ? `${doneCount} de ~${booking.participants_count} listas`
      : `Persona ${idx + 1}`;

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Check-in y waivers">
        <div className="st-modal-hd">
          <h3>Check-in</h3>
          <span className="st-modal-ref">
            {booking.reference}
            {booking.customer_name ? ` · ${booking.customer_name}` : ''}
          </span>
          <span className="st-spacer" />
          <span className="st-modal-step">{stepHint}</span>
          <button className="st-modal-x" onClick={tryClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        {sub === 'name' && (
          <div className="st-field">
            <label htmlFor="ci-name">Nombre del surfeador</label>
            <input
              id="ci-name"
              autoFocus
              value={cur.full_name}
              onChange={(e) => patch({ full_name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cur.full_name.trim().length >= 2) setSub('emergency');
              }}
            />
            <div className="st-modal-actions">
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={cur.full_name.trim().length < 2}
                onClick={() => setSub('emergency')}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {sub === 'emergency' && (
          <>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="ci-ecname">Contacto de emergencia — nombre</label>
                <input
                  id="ci-ecname"
                  autoFocus
                  value={cur.ec_name}
                  onChange={(e) => patch({ ec_name: e.target.value })}
                />
              </div>
              <div className="st-field">
                <label htmlFor="ci-ecphone">Teléfono</label>
                <input
                  id="ci-ecphone"
                  value={cur.ec_phone}
                  onChange={(e) => patch({ ec_phone: e.target.value })}
                />
              </div>
            </div>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('name')}>
                Atrás
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={!(cur.ec_name.trim() && cur.ec_phone.trim())}
                onClick={() => setSub('minor')}
              >
                Siguiente
              </button>
              <button className="st-linkbtn" onClick={() => setSub('minor')}>
                Omitir
              </button>
            </div>
          </>
        )}

        {sub === 'minor' && (
          <>
            <p className="st-q">¿{cur.full_name.trim() || 'Esta persona'} es menor de edad?</p>
            <div className="st-bigchoice">
              <button
                onClick={() => {
                  patch({ is_minor: false, guardian_name: '' });
                  setSub('sign');
                }}
              >
                No
              </button>
              <button
                onClick={() => {
                  patch({ is_minor: true });
                  setSub('guardian');
                }}
              >
                Sí
              </button>
            </div>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('emergency')}>
                Atrás
              </button>
            </div>
          </>
        )}

        {sub === 'guardian' && (
          <div className="st-field">
            <label htmlFor="ci-guardian">Nombre del tutor / adulto responsable</label>
            <input
              id="ci-guardian"
              autoFocus
              value={cur.guardian_name}
              onChange={(e) => patch({ guardian_name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cur.guardian_name.trim().length >= 2) setSub('sign');
              }}
            />
            <p className="st-note">Firma el tutor en nombre de {cur.full_name.trim() || 'el menor'}.</p>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('minor')}>
                Atrás
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={cur.guardian_name.trim().length < 2}
                onClick={() => setSub('sign')}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {sub === 'sign' && (
          <>
            <p className="st-q">
              {cur.is_minor ? (
                <>
                  {cur.guardian_name.trim() || 'El tutor'} firma por {cur.full_name.trim() || 'el menor'}
                </>
              ) : (
                <>{cur.full_name.trim() || 'El surfeador'} firma</>
              )}
            </p>

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

            <SignaturePad key={idx} onChange={(svg) => patch({ signature: svg })} />

            <label className="st-check">
              <input
                type="checkbox"
                checked={cur.accepted}
                onChange={(e) => patch({ accepted: e.target.checked })}
              />
              <span>
                {acceptanceLabel({
                  isMinor: !!cur.is_minor,
                  signerName: cur.full_name,
                  guardianName: cur.guardian_name,
                  minorName: cur.full_name,
                })}
              </span>
            </label>

            <div className="st-modal-actions">
              <button
                className="st-btn st-btn-ghost st-btn-sm"
                onClick={() => setSub(cur.is_minor ? 'guardian' : 'minor')}
              >
                Atrás
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={!cur.accepted || !cur.signature || !signerName}
                onClick={() => {
                  patch({ done: true });
                  setSub('next');
                }}
              >
                Firmar
              </button>
            </div>
          </>
        )}

        {sub === 'next' && (
          <div className="st-checkin-done">
            <p className="st-big">✓</p>
            <p>
              <strong>{people[idx].is_minor ? people[idx].guardian_name : people[idx].full_name}</strong>{' '}
              firmó{people[idx].is_minor ? ` por ${people[idx].full_name}` : ''}.
            </p>
            <p className="st-note">
              {doneCount} {doneCount === 1 ? 'persona' : 'personas'} · la reserva es para{' '}
              {booking.participants_count}.
            </p>
            <div className="st-modal-actions" style={{ justifyContent: 'center' }}>
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={addAnother}>
                + Otra persona
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={busy || doneCount === 0}
                onClick={finish}
              >
                {busy ? 'Guardando…' : 'Terminar check-in'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pad de firma sin dependencias: captura trazos y los serializa a SVG. */
function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const strokes = useRef<[number, number][][]>([]);
  const curStroke = useRef<[number, number][]>([]);
  const [has, setHas] = useState(false);
  const W = 480;
  const H = 160;

  const redraw = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  function emit() {
    if (!strokes.current.length) {
      setHas(false);
      onChange(null);
      return;
    }
    const paths = strokes.current
      .map(
        (s) =>
          `<path d="${s
            .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
            .join(' ')}" fill="none" stroke="#1a1a2e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
    setHas(true);
    onChange(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${paths}</svg>`);
  }

  return (
    <div className="st-sigpad">
      <canvas
        ref={ref}
        width={W}
        height={H}
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          curStroke.current = [at(e)];
          ref.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          curStroke.current.push(at(e));
          redraw();
          const ctx = ref.current?.getContext('2d');
          if (!ctx) return;
          ctx.beginPath();
          curStroke.current.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (curStroke.current.length > 1) strokes.current.push(curStroke.current);
          curStroke.current = [];
          emit();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (curStroke.current.length > 1) strokes.current.push(curStroke.current);
          curStroke.current = [];
          emit();
        }}
      />
      <div className="st-sigpad-foot">
        <span>{has ? 'Firma capturada' : 'Firmá con el dedo o el mouse'}</span>
        <button
          type="button"
          className="st-btn st-btn-ghost st-btn-sm"
          onClick={() => {
            strokes.current = [];
            curStroke.current = [];
            redraw();
            emit();
          }}
        >
          Borrar
        </button>
      </div>
    </div>
  );
}
