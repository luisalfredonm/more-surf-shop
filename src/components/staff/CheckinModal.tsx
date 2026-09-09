import { useCallback, useEffect, useState } from 'react';
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
    if (doneCount > 0 && !confirm('Close without saving the check-in? Signatures will be lost.')) return;
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
        setErr(data.error || 'Could not save the check-in.');
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setErr('Connection failed.');
      setBusy(false);
    }
  }

  const stepHint =
    sub === 'next'
      ? `${doneCount} of ~${booking.participants_count} done`
      : `Person ${idx + 1}`;

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Check-in and waivers">
        <div className="st-modal-hd">
          <h3>Check-in</h3>
          <span className="st-modal-ref">
            {booking.reference}
            {booking.customer_name ? ` · ${booking.customer_name}` : ''}
          </span>
          <span className="st-spacer" />
          <span className="st-modal-step">{stepHint}</span>
          <button className="st-modal-x" onClick={tryClose} aria-label="Close">
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        {sub === 'name' && (
          <div className="st-field">
            <label htmlFor="ci-name">Surfer's name</label>
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
                Next
              </button>
            </div>
          </div>
        )}

        {sub === 'emergency' && (
          <>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="ci-ecname">Emergency contact — name</label>
                <input
                  id="ci-ecname"
                  autoFocus
                  value={cur.ec_name}
                  onChange={(e) => patch({ ec_name: e.target.value })}
                />
              </div>
              <div className="st-field">
                <label htmlFor="ci-ecphone">Phone</label>
                <input
                  id="ci-ecphone"
                  value={cur.ec_phone}
                  onChange={(e) => patch({ ec_phone: e.target.value })}
                />
              </div>
            </div>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('name')}>
                Back
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={!(cur.ec_name.trim() && cur.ec_phone.trim())}
                onClick={() => setSub('minor')}
              >
                Next
              </button>
              <button className="st-linkbtn" onClick={() => setSub('minor')}>
                Skip
              </button>
            </div>
          </>
        )}

        {sub === 'minor' && (
          <>
            <p className="st-q">Is {cur.full_name.trim() || 'this person'} a minor?</p>
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
                Yes
              </button>
            </div>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('emergency')}>
                Back
              </button>
            </div>
          </>
        )}

        {sub === 'guardian' && (
          <div className="st-field">
            <label htmlFor="ci-guardian">Guardian / responsible adult name</label>
            <input
              id="ci-guardian"
              autoFocus
              value={cur.guardian_name}
              onChange={(e) => patch({ guardian_name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cur.guardian_name.trim().length >= 2) setSub('sign');
              }}
            />
            <p className="st-note">The guardian signs on behalf of {cur.full_name.trim() || 'the minor'}.</p>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setSub('minor')}>
                Back
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={cur.guardian_name.trim().length < 2}
                onClick={() => setSub('sign')}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {sub === 'sign' && (
          <>
            <p className="st-q">
              {cur.is_minor ? (
                <>
                  {cur.guardian_name.trim() || 'The guardian'} signs for{' '}
                  {cur.full_name.trim() || 'the minor'}
                </>
              ) : (
                <>{cur.full_name.trim() || 'The surfer'} signs</>
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
                Back
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={!cur.accepted || !cur.signature || !signerName}
                onClick={() => {
                  patch({ done: true });
                  setSub('next');
                }}
              >
                Sign
              </button>
            </div>
          </>
        )}

        {sub === 'next' && (
          <div className="st-checkin-done">
            <p className="st-big">✓</p>
            <p>
              <strong>{people[idx].is_minor ? people[idx].guardian_name : people[idx].full_name}</strong>{' '}
              signed{people[idx].is_minor ? ` for ${people[idx].full_name}` : ''}.
            </p>
            <p className="st-note">
              {doneCount} {doneCount === 1 ? 'person' : 'people'} · booking is for{' '}
              {booking.participants_count}.
            </p>
            <div className="st-modal-actions" style={{ justifyContent: 'center' }}>
              <button className="st-btn st-btn-ghost st-btn-sm" onClick={addAnother}>
                + Another person
              </button>
              <button
                className="st-btn st-btn-primary st-btn-sm"
                disabled={busy || doneCount === 0}
                onClick={finish}
              >
                {busy ? 'Saving…' : 'Finish check-in'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
