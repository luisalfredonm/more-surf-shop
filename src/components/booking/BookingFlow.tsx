import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WAIVER_VERSION,
  WAIVER_TITLE,
  WAIVER_SUBTITLE,
  WAIVER_RELEASEE,
  WAIVER_ACKNOWLEDGEMENT,
  getWaiverClauses,
} from '@lib/waiver';
import { usePayPalSdk } from './usePayPal';
import './BookingFlow.css';

export interface BookingClassType {
  id: string;
  name: string;
  price_per_person: number;
  ratio_label: string | null;
  badge: string | null;
}

interface Props {
  classTypes: BookingClassType[];
  whatsappNumber: string;
  paypalClientId: string;
  daysAhead?: number;
}

interface ApiSlot {
  slot_id: string;
  slot_date: string;
  start_time: string;
  class_type_id: string;
  class_type_name: string;
  price_per_person: number;
  ratio_label: string | null;
  instructor_id: string | null;
  instructor_name: string | null;
  capacity_total: number;
  booked: number;
  remaining: number;
}

type Step = 'type' | 'slot' | 'people' | 'contact' | 'review' | 'waiver' | 'pay' | 'done';
type SlotState = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

interface Participant {
  full_name: string;
  age: string;
}

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'type', label: 'Clase' },
  { key: 'slot', label: 'Fecha' },
  { key: 'people', label: 'Personas' },
  { key: 'contact', label: 'Contacto' },
  { key: 'review', label: 'Revisar' },
  { key: 'waiver', label: 'Waiver' },
  { key: 'pay', label: 'Pago' },
];
const MAX_PEOPLE = 8;

const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' });
};
const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(n);
const waLink = (number: string, msg: string) =>
  `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;

export default function BookingFlow({
  classTypes,
  whatsappNumber,
  paypalClientId,
  daysAhead = 21,
}: Props) {
  const bookable = classTypes.filter((c) => c.price_per_person > 0);
  const paypalEnabled = paypalClientId.length > 0;
  const sdkStatus = usePayPalSdk(paypalClientId);

  const [step, setStep] = useState<Step>('type');
  const [classId, setClassId] = useState<string | null>(bookable.length === 1 ? bookable[0].id : null);
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [slotState, setSlotState] = useState<SlotState>('idle');
  const [slotId, setSlotId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([{ full_name: '', age: '' }]);
  const [contact, setContact] = useState({
    full_name: '',
    email: '',
    phone: '',
    country_of_residence: '',
  });
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [result, setResult] = useState<
    {
      reference: string;
      booking_id: string;
      amount: number;
      currency: string;
      hold_minutes: number;
      paid?: boolean;
    } | null
  >(null);

  // Waiver
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [minorFlag, setMinorFlag] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const selectedClass = bookable.find((c) => c.id === classId) ?? null;
  const selectedSlot = slots.find((s) => s.slot_id === slotId) ?? null;

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const loadSlots = useCallback(
    async (cid: string) => {
      setSlotState('loading');
      setSlots([]);
      setSlotId(null);
      const from = crToday();
      const to = addDays(from, daysAhead);
      try {
        const res = await fetch(
          `/api/availability?from=${from}&to=${to}&classTypeId=${encodeURIComponent(cid)}`,
        );
        if (!res.ok) {
          setSlotState('error');
          return;
        }
        const data = await res.json();
        const list: ApiSlot[] = Array.isArray(data.slots) ? data.slots : [];
        setSlots(list);
        setSlotState(list.length ? 'ok' : 'empty');
      } catch {
        setSlotState('error');
      }
    },
    [daysAhead],
  );

  function pickClass(id: string) {
    setClassId(id);
    setStep('slot');
    void loadSlots(id);
  }

  function pickSlot(s: ApiSlot) {
    setSlotId(s.slot_id);
    setParticipants((prev) => {
      const cap = Math.max(1, Math.min(prev.length, s.remaining, MAX_PEOPLE));
      return prev.slice(0, cap);
    });
    setStep('people');
  }

  const maxPeople = Math.min(selectedSlot?.remaining ?? MAX_PEOPLE, MAX_PEOPLE);
  function setCount(n: number) {
    const target = Math.max(1, Math.min(n, maxPeople));
    setParticipants((prev) => {
      const next = prev.slice(0, target);
      while (next.length < target) next.push({ full_name: '', age: '' });
      return next;
    });
  }
  function setParticipant(i: number, patch: Partial<Participant>) {
    setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  const peopleValid = participants.every((p) => p.full_name.trim().length >= 2);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim());
  const contactValid = contact.full_name.trim().length >= 2 && emailOk;

  async function submit() {
    if (!selectedClass || !selectedSlot) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_type_id: selectedClass.id,
          slot_id: selectedSlot.slot_id,
          participants: participants.map((p) => ({
            full_name: p.full_name.trim(),
            age: p.age.trim() === '' ? null : Number(p.age),
          })),
          contact: {
            full_name: contact.full_name.trim(),
            email: contact.email.trim(),
            phone: contact.phone.trim() || null,
            country_of_residence: contact.country_of_residence.trim() || null,
          },
          customer_note: note.trim() || null,
          source: 'web',
          website,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 201 && data.ok) {
        setResult({
          reference: data.reference,
          booking_id: data.booking_id,
          amount: data.amount,
          currency: data.currency ?? 'USD',
          hold_minutes: data.hold_minutes ?? 20,
        });
        // Prefill de la firma y detección de menores por edad.
        setSignerName((prev) => prev || contact.full_name.trim());
        setGuardianName((prev) => prev || contact.full_name.trim());
        setMinorFlag(
          participants.some((p) => p.age.trim() !== '' && Number(p.age) < 18),
        );
        setStep('waiver');
        return;
      }
      if (
        res.status === 409 &&
        ['slot_full', 'slot_unavailable', 'slot_closed', 'slot_missing', 'mismatch'].includes(
          data.code,
        )
      ) {
        setBanner('Ese horario ya no está disponible. Elegí otro.');
        setStep('slot');
        void loadSlots(selectedClass.id);
        return;
      }
      setBanner(
        data.error ||
          'No se pudo crear la reserva. Probá de nuevo o escribinos por WhatsApp.',
      );
    } catch {
      setBanner('Falló la conexión. Probá de nuevo o escribinos por WhatsApp.');
    } finally {
      setSubmitting(false);
    }
  }

  async function signWaiver() {
    if (!result) return;
    setWaiverSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/waivers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: result.booking_id,
          signer_name_typed: signerName.trim(),
          accepted_terms: true,
          waiver_version: WAIVER_VERSION,
          is_minor: minorFlag,
          guardian_name: minorFlag ? guardianName.trim() : null,
          activity: 'lesson',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setStep(paypalEnabled ? 'pay' : 'done');
        return;
      }
      if (res.status === 409 && data.code === 'version_mismatch') {
        setBanner('El waiver se actualizó. Revisá el texto de nuevo y volvé a firmar.');
        setWaiverAccepted(false);
        return;
      }
      setBanner(data.error || 'No se pudo registrar la firma. Probá de nuevo.');
    } catch {
      setBanner('Falló la conexión. Probá de nuevo.');
    } finally {
      setWaiverSubmitting(false);
    }
  }

  const waiverValid =
    waiverAccepted &&
    signerName.trim().length >= 2 &&
    (!minorFlag || guardianName.trim().length >= 2);

  const handlePaid = useCallback(() => {
    setResult((r) => (r ? { ...r, paid: true } : r));
    setStep('done');
  }, []);

  // ----- Sub-render helpers -----
  const visibleSteps = STEP_LABELS.filter((s) => s.key !== 'pay' || paypalEnabled);
  const stepIndex = visibleSteps.findIndex((s) => s.key === step);

  function Progress() {
    if (step === 'done') return null;
    return (
      <ol className="bf-steps">
        {visibleSteps.map((s, i) => (
          <li
            key={s.key}
            className={`bf-step${i === stepIndex ? ' is-active' : ''}${
              i < stepIndex ? ' is-done' : ''
            }`}
          >
            <span className="bf-dot" aria-hidden="true">
              {i < stepIndex ? '✓' : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    );
  }

  const helpMsg = `Hola! Quiero reservar una lección de surf${
    selectedClass ? ` (${selectedClass.name})` : ''
  } en Tamarindo. ¿Qué horarios tienen?`;

  return (
    <div className="bf">
      <Progress />
      {banner && (
        <div className="bf-banner" role="alert">
          {banner}
        </div>
      )}

      {/* STEP: type */}
      {step === 'type' && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            ¿Qué tipo de lección?
          </h3>
          <p className="bf-sub">Todas incluyen tabla, licra e instructor. Precio por persona.</p>
          <div className="bf-options">
            {bookable.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`bf-option${c.id === classId ? ' is-selected' : ''}`}
                onClick={() => pickClass(c.id)}
              >
                <span>
                  <span className="bf-option-name">{c.name}</span>
                  {c.ratio_label && (
                    <>
                      <br />
                      <span className="bf-option-ratio">{c.ratio_label}</span>
                    </>
                  )}
                </span>
                <span className="bf-option-price">
                  {money(c.price_per_person)} <small>/ persona</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP: slot */}
      {step === 'slot' && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            Elegí fecha y hora
          </h3>
          <p className="bf-sub">
            {selectedClass?.name} · próximos {daysAhead} días
          </p>

          {slotState === 'loading' && (
            <p className="bf-muted">
              <span className="bf-spin">◠</span> Buscando horarios…
            </p>
          )}

          {slotState === 'error' && (
            <div className="bf-state">
              <p>No se pudo cargar la disponibilidad.</p>
              <button
                type="button"
                className="bf-btn bf-btn-ghost"
                onClick={() => selectedClass && loadSlots(selectedClass.id)}
              >
                Reintentar
              </button>
            </div>
          )}

          {slotState === 'empty' && (
            <div className="bf-state">
              <p>
                No hay horarios abiertos en línea para esa clase ahora mismo. Escribinos y
                coordinamos tu lección directo.
              </p>
              <a
                className="bf-wa"
                href={waLink(whatsappNumber, helpMsg)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Escribir por WhatsApp
              </a>
            </div>
          )}

          {slotState === 'ok' &&
            groupByDate(slots).map(({ date, items }) => (
              <div className="bf-day" key={date}>
                <div className="bf-day-label">{fmtDate(date)}</div>
                <div className="bf-slotgrid">
                  {items.map((s) => (
                    <button
                      key={s.slot_id}
                      type="button"
                      className={`bf-slot${s.slot_id === slotId ? ' is-selected' : ''}`}
                      onClick={() => pickSlot(s)}
                    >
                      <span className="bf-slot-time">{fmtTime(s.start_time)}</span>
                      <span className="bf-slot-meta">
                        {s.remaining} cupo{s.remaining === 1 ? '' : 's'}
                        {s.instructor_name ? ` · ${s.instructor_name}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

          <div className="bf-nav">
            <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('type')}>
              ← Atrás
            </button>
          </div>
        </div>
      )}

      {/* STEP: people */}
      {step === 'people' && selectedSlot && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            ¿Cuántas personas?
          </h3>
          <p className="bf-sub">
            {fmtDate(selectedSlot.slot_date)} · {fmtTime(selectedSlot.start_time)}
          </p>

          <div className="bf-counter">
            <button
              type="button"
              className="bf-counter-btn"
              onClick={() => setCount(participants.length - 1)}
              disabled={participants.length <= 1}
              aria-label="Quitar persona"
            >
              −
            </button>
            <span className="bf-counter-val" aria-live="polite">
              {participants.length}
            </span>
            <button
              type="button"
              className="bf-counter-btn"
              onClick={() => setCount(participants.length + 1)}
              disabled={participants.length >= maxPeople}
              aria-label="Agregar persona"
            >
              +
            </button>
            <span className="bf-counter-note">
              {maxPeople < MAX_PEOPLE ? `máx ${maxPeople} en este horario` : 'máx 8'}
            </span>
          </div>

          {participants.map((p, i) => (
            <div className="bf-person" key={i}>
              <div className="bf-person-h">Persona {i + 1}</div>
              <div className="bf-row">
                <div className="bf-field">
                  <label htmlFor={`bf-name-${i}`}>Nombre y apellido</label>
                  <input
                    id={`bf-name-${i}`}
                    value={p.full_name}
                    onChange={(e) => setParticipant(i, { full_name: e.target.value })}
                    autoComplete={i === 0 ? 'name' : 'off'}
                  />
                </div>
                <div className="bf-field">
                  <label htmlFor={`bf-age-${i}`}>Edad (opcional)</label>
                  <input
                    id={`bf-age-${i}`}
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    value={p.age}
                    onChange={(e) => setParticipant(i, { age: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="bf-nav">
            <button type="button" className="bf-btn bf-btn-ghost" onClick={() => setStep('slot')}>
              ← Atrás
            </button>
            <span className="bf-nav-spacer" />
            <button
              type="button"
              className="bf-btn bf-btn-primary"
              onClick={() => setStep('contact')}
              disabled={!peopleValid}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* STEP: contact */}
      {step === 'contact' && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            Tus datos de contacto
          </h3>
          <p className="bf-sub">Para confirmarte la reserva y coordinar el pago.</p>

          <div className="bf-fields">
            <div className="bf-row">
              <div className="bf-field">
                <label htmlFor="bf-c-name">Nombre y apellido</label>
                <input
                  id="bf-c-name"
                  value={contact.full_name}
                  onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
                  autoComplete="name"
                />
              </div>
              <div className="bf-field">
                <label htmlFor="bf-c-email">Email</label>
                <input
                  id="bf-c-email"
                  type="email"
                  inputMode="email"
                  value={contact.email}
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="bf-row">
              <div className="bf-field">
                <label htmlFor="bf-c-phone">WhatsApp / teléfono (opcional)</label>
                <input
                  id="bf-c-phone"
                  type="tel"
                  inputMode="tel"
                  value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  autoComplete="tel"
                />
              </div>
              <div className="bf-field">
                <label htmlFor="bf-c-country">País de residencia (opcional)</label>
                <input
                  id="bf-c-country"
                  value={contact.country_of_residence}
                  onChange={(e) =>
                    setContact({ ...contact, country_of_residence: e.target.value })
                  }
                  autoComplete="country-name"
                />
              </div>
            </div>
            <div className="bf-field">
              <label htmlFor="bf-c-note">¿Algo que debamos saber? (opcional)</label>
              <textarea
                id="bf-c-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="bf-hp" aria-hidden="true">
              <label htmlFor="bf-website">Website</label>
              <input
                id="bf-website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
          </div>

          <div className="bf-nav">
            <button
              type="button"
              className="bf-btn bf-btn-ghost"
              onClick={() => setStep('people')}
            >
              ← Atrás
            </button>
            <span className="bf-nav-spacer" />
            <button
              type="button"
              className="bf-btn bf-btn-primary"
              onClick={() => setStep('review')}
              disabled={!contactValid}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* STEP: review */}
      {step === 'review' && selectedClass && selectedSlot && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            Revisá tu reserva
          </h3>
          <p className="bf-sub">
            Confirmás, firmás el waiver y coordinás el pago. Todavía no se cobra nada.
          </p>

          <dl className="bf-summary">
            <div className="bf-summary-row">
              <dt>Lección</dt>
              <dd>{selectedClass.name}</dd>
            </div>
            <div className="bf-summary-row">
              <dt>Fecha</dt>
              <dd>{fmtDate(selectedSlot.slot_date)}</dd>
            </div>
            <div className="bf-summary-row">
              <dt>Hora</dt>
              <dd>{fmtTime(selectedSlot.start_time)}</dd>
            </div>
            <div className="bf-summary-row">
              <dt>Personas</dt>
              <dd>{participants.length}</dd>
            </div>
            <div className="bf-summary-row">
              <dt>Contacto</dt>
              <dd>{contact.email}</dd>
            </div>
            <div className="bf-summary-row bf-summary-total">
              <dt>Total</dt>
              <dd>
                {money(selectedClass.price_per_person * participants.length, 'USD')}
                <br />
                <span className="bf-muted">
                  {participants.length} × {money(selectedClass.price_per_person, 'USD')}
                </span>
              </dd>
            </div>
          </dl>

          <div className="bf-nav">
            <button
              type="button"
              className="bf-btn bf-btn-ghost"
              onClick={() => setStep('contact')}
              disabled={submitting}
            >
              ← Atrás
            </button>
            <span className="bf-nav-spacer" />
            <button
              type="button"
              className="bf-btn bf-btn-primary"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="bf-spin">◠</span> Creando…
                </>
              ) : (
                'Confirmar reserva'
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP: waiver */}
      {step === 'waiver' && result && selectedClass && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            Firma del waiver
          </h3>
          <p className="bf-sub">
            Reserva <strong>{result.reference}</strong> creada. Leé y aceptá el waiver para
            completarla.
          </p>

          <div className="bf-waiver-box" tabIndex={0} role="region" aria-label="Texto del waiver">
            <h4>{WAIVER_TITLE}</h4>
            <p className="bf-waiver-sub">{WAIVER_SUBTITLE}</p>
            <p className="bf-waiver-releasee">
              Releasee: {WAIVER_RELEASEE.legalName} (commercial name{' '}
              {WAIVER_RELEASEE.commercialName}), corporate ID {WAIVER_RELEASEE.idNumber}.
            </p>
            {getWaiverClauses(selectedClass.name).map((clause, i) => (
              <p key={i}>{clause}</p>
            ))}
            <p className="bf-waiver-ack">{WAIVER_ACKNOWLEDGEMENT}</p>
          </div>

          <label className="bf-check">
            <input
              type="checkbox"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
            />
            <span>
              He leído y acepto el Release and Waiver of Liability, Assumption of Risk and
              Indemnity Agreement.
            </span>
          </label>

          <label className="bf-check">
            <input
              type="checkbox"
              checked={minorFlag}
              onChange={(e) => setMinorFlag(e.target.checked)}
            />
            <span>
              Esta reserva incluye a un menor de 18. Soy su padre/madre o tutor legal y firmo en
              su nombre.
            </span>
          </label>

          <div className="bf-fields" style={{ marginTop: '0.75rem' }}>
            {minorFlag && (
              <div className="bf-field">
                <label htmlFor="bf-guardian">Nombre del padre/madre o tutor</label>
                <input
                  id="bf-guardian"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}
            <div className="bf-field">
              <label htmlFor="bf-signer">Escribí tu nombre completo para firmar</label>
              <input
                id="bf-signer"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                autoComplete="name"
              />
            </div>
          </div>

          <p className="bf-muted" style={{ marginTop: '0.75rem' }}>
            Al firmar dejás registrada tu aceptación con fecha, hora y tu conexión. Waiver
            versión {WAIVER_VERSION}.
          </p>

          <div className="bf-nav">
            <button
              type="button"
              className="bf-btn bf-btn-primary"
              onClick={signWaiver}
              disabled={!waiverValid || waiverSubmitting}
            >
              {waiverSubmitting ? (
                <>
                  <span className="bf-spin">◠</span> Firmando…
                </>
              ) : (
                'Firmar y completar'
              )}
            </button>
          </div>

          <p className="bf-muted" style={{ marginTop: '1rem' }}>
            <a
              href={waLink(
                whatsappNumber,
                `Hola! Tengo la reserva ${result.reference} y prefiero terminar el waiver y el pago por WhatsApp.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Prefiero terminar por WhatsApp
            </a>
          </p>
        </div>
      )}

      {/* STEP: pay */}
      {step === 'pay' && result && selectedClass && selectedSlot && (
        <div>
          <h3 className="bf-h" tabIndex={-1} ref={headingRef}>
            Pagá tu reserva
          </h3>
          <p className="bf-sub">
            {selectedClass.name} · {fmtDate(selectedSlot.slot_date)} ·{' '}
            {fmtTime(selectedSlot.start_time)}
          </p>

          <dl className="bf-summary">
            <div className="bf-summary-row">
              <dt>Reserva</dt>
              <dd>{result.reference}</dd>
            </div>
            <div className="bf-summary-row bf-summary-total">
              <dt>A pagar</dt>
              <dd>{money(result.amount, result.currency)}</dd>
            </div>
          </dl>

          {sdkStatus === 'loading' && (
            <p className="bf-muted">
              <span className="bf-spin">◠</span> Cargando el pago…
            </p>
          )}

          {sdkStatus === 'error' && (
            <div className="bf-state">
              <p>No se pudo cargar PayPal. Pagá por WhatsApp con tu código.</p>
              <a
                className="bf-wa"
                href={waLink(
                  whatsappNumber,
                  `Hola! Tengo la reserva ${result.reference} y quiero pagar. PayPal no cargó en la web.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                Pagar por WhatsApp
              </a>
            </div>
          )}

          {sdkStatus === 'ready' && (
            <PayPalButtonsBox
              bookingId={result.booking_id}
              onPaid={handlePaid}
              onFail={setBanner}
            />
          )}

          <p className="bf-muted" style={{ marginTop: '1rem' }}>
            <a
              href={waLink(
                whatsappNumber,
                `Hola! Tengo la reserva ${result.reference} y prefiero coordinar el pago por WhatsApp.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Prefiero pagar por WhatsApp
            </a>
          </p>
        </div>
      )}

      {/* STEP: done */}
      {step === 'done' && result && selectedClass && selectedSlot && (
        <div className="bf-state">
          <div className="bf-state-icon" aria-hidden="true">
            ✓
          </div>
          {result.paid ? (
            <>
              <h3>¡Reserva confirmada!</h3>
              <span className="bf-ref">{result.reference}</span>
              <p>
                Pago recibido. Te esperamos el {fmtDate(selectedSlot.slot_date)} a las{' '}
                {fmtTime(selectedSlot.start_time)}. Guardá tu código.
              </p>
              <p className="bf-muted" style={{ marginTop: '0.5rem' }}>
                Pagado: {money(result.amount, result.currency)}
              </p>
            </>
          ) : (
            <>
              <h3>Reserva creada y waiver firmado</h3>
              <span className="bf-ref">{result.reference}</span>
              <p>
                Te guardamos el cupo por {result.hold_minutes} minutos. Mandanos este código por
                WhatsApp y coordinamos el pago.
              </p>
              <a
                className="bf-wa"
                href={waLink(
                  whatsappNumber,
                  `Hola! Tengo la reserva ${result.reference}: ${selectedClass.name}, ${fmtDate(
                    selectedSlot.slot_date,
                  )} a las ${fmtTime(selectedSlot.start_time)}, ${participants.length} persona(s). Quiero coordinar el pago.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                Enviar {result.reference} por WhatsApp
              </a>
              <p className="bf-muted" style={{ marginTop: '1rem' }}>
                Total estimado: {money(result.amount, result.currency)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PayPalButtonsBox({
  bookingId,
  onPaid,
  onFail,
}: {
  bookingId: string;
  onPaid: () => void;
  onFail: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    const paypal = (window as { paypal?: any }).paypal;
    if (rendered.current || !ref.current || !paypal) return;
    rendered.current = true;

    paypal
      .Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: async () => {
          const res = await fetch('/api/payments/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: bookingId }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.id) throw new Error(d.error || 'No se pudo iniciar el pago');
          return d.id;
        },
        onApprove: async (data: { orderID: string }) => {
          const res = await fetch('/api/payments/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: data.orderID, booking_id: bookingId }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok && d.ok) onPaid();
          else onFail(d.error || 'No se pudo confirmar el pago. Escribinos por WhatsApp.');
        },
        onError: () => onFail('Hubo un problema con PayPal. Probá de nuevo.'),
        onCancel: () => onFail('Cancelaste el pago. Podés intentarlo de nuevo.'),
      })
      .render(ref.current)
      .catch(() => onFail('No se pudo mostrar PayPal.'));
  }, [bookingId, onPaid, onFail]);

  return <div ref={ref} className="bf-paypal" />;
}

function groupByDate(slots: ApiSlot[]): { date: string; items: ApiSlot[] }[] {
  const out: { date: string; items: ApiSlot[] }[] = [];
  let cur: { date: string; items: ApiSlot[] } | null = null;
  for (const s of slots) {
    if (!cur || cur.date !== s.slot_date) {
      cur = { date: s.slot_date, items: [] };
      out.push(cur);
    }
    cur.items.push(s);
  }
  return out;
}
