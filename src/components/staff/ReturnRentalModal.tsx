import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

export interface OutRental {
  id: string;
  reference: string;
  code: string;
  model: string;
  customer: string;
  total_amount: number;
  currency: string;
  payment_id: string | null;
  fins_out: number | null;
}

export default function ReturnRentalModal({
  rental,
  onClose,
  onDone,
}: {
  rental: OutRental;
  onClose: () => void;
  onDone: () => void;
}) {
  const [finsIn, setFinsIn] = useState(rental.fins_out ?? 3);
  const [notes, setNotes] = useState('');
  const [photoIn, setPhotoIn] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoWarn, setPhotoWarn] = useState(false);
  const [damage, setDamage] = useState(false);
  const [damageFee, setDamageFee] = useState('');
  const [collectCash, setCollectCash] = useState(true);
  const [payMethod, setPayMethod] = useState<'cash' | 'card'>('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const baseDue = rental.payment_id ? 0 : Number(rental.total_amount) || 0;
  const dmg = damage ? Number(damageFee) || 0 : 0;
  const due = baseDue + dmg;

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoWarn(false);
    try {
      const sb = getBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${rental.code.replace(/\s+/g, '-')}/${Date.now()}-in.${ext}`;
      const up = await sb.storage.from('rental-photos').upload(path, file, { upsert: false });
      if (up.error) setPhotoWarn(true);
      else setPhotoIn(sb.storage.from('rental-photos').getPublicUrl(path).data.publicUrl);
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { data: sess } = await getBrowserSupabase().auth.getSession();
      const res = await fetch('/api/rentals/return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          rental_id: rental.id,
          fins_in: finsIn,
          condition_in_photo_url: photoIn,
          condition_in_notes: notes.trim() || null,
          damage_reported: damage,
          damage_fee: dmg || null,
          collect_cash: collectCash && due > 0,
          payment_method: payMethod,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || 'Could not close the rental.');
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setErr('Connection failed.');
      setBusy(false);
    }
  }

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Return board">
        <div className="st-modal-hd">
          <h3>Return</h3>
          <span className="st-modal-ref">
            {rental.code} · {rental.model} · {rental.customer}
          </span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        <div className="st-row">
          <div className="st-field">
            <label>Fins returned</label>
            <input
              type="number"
              min={0}
              max={6}
              value={finsIn}
              onChange={(e) => setFinsIn(Number(e.target.value))}
            />
            {rental.fins_out != null && finsIn !== rental.fins_out && (
              <span className="st-note">{rental.fins_out} went out</span>
            )}
          </div>
          <div className="st-field">
            <label>Board photo</label>
            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={photoBusy} />
            {photoBusy && <span className="st-note">Uploading…</span>}
            {photoIn && <span className="st-note">✓ photo uploaded</span>}
            {photoWarn && <span className="st-note">Upload failed — continue without a photo.</span>}
          </div>
        </div>

        <div className="st-field">
          <label>Condition note (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <label className="st-check">
          <input type="checkbox" checked={damage} onChange={(e) => setDamage(e.target.checked)} />
          <span>Damage / missing items</span>
        </label>
        {damage && (
          <div className="st-field">
            <label>Damage fee (USD)</label>
            <input
              type="number"
              min={0}
              value={damageFee}
              onChange={(e) => setDamageFee(e.target.value)}
            />
          </div>
        )}

        {due > 0 && (
          <>
            <p className="st-q" style={{ marginTop: '0.75rem' }}>
              To collect now: <strong>{money(due, rental.currency)}</strong>
              {baseDue > 0 && dmg > 0 && (
                <span className="st-note">
                  {' '}
                  (rental {money(baseDue, rental.currency)} + damage {money(dmg, rental.currency)})
                </span>
              )}
            </p>
            <label className="st-check">
              <input
                type="checkbox"
                checked={collectCash}
                onChange={(e) => setCollectCash(e.target.checked)}
              />
              <span>Collect now</span>
            </label>
            {collectCash && (
              <div className="st-chiprow" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  className={`st-dchip ${payMethod === 'cash' ? 'on' : ''}`}
                  onClick={() => setPayMethod('cash')}
                >
                  Cash
                </button>
                <button
                  type="button"
                  className={`st-dchip ${payMethod === 'card' ? 'on' : ''}`}
                  onClick={() => setPayMethod('card')}
                >
                  Card
                </button>
              </div>
            )}
          </>
        )}

        <div className="st-modal-actions">
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="st-btn st-btn-primary st-btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Closing…' : 'Confirm return'}
          </button>
        </div>
      </div>
    </div>
  );
}
