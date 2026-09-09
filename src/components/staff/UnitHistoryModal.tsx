import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

type NameRef = { display_name: string } | { display_name: string }[] | null;

interface Row {
  id: string;
  reference: string;
  start_at: string;
  end_at: string;
  returned_at: string | null;
  status: string;
  fins_out: number | null;
  fins_in: number | null;
  damage_reported: boolean;
  damage_fee: number | null;
  condition_out_notes: string | null;
  condition_in_notes: string | null;
  condition_out_photo_url: string | null;
  condition_in_photo_url: string | null;
  customers: { full_name: string } | { full_name: string }[] | null;
  res_by: NameRef;
  out_by: NameRef;
  in_by: NameRef;
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const nameOf = (v: NameRef) => one(v)?.display_name ?? null;

const COLS =
  'id, reference, start_at, end_at, returned_at, status, fins_out, fins_in, damage_reported, damage_fee, condition_out_notes, condition_in_notes, condition_out_photo_url, condition_in_photo_url, customers ( full_name ), res_by:profiles!reserved_by ( display_name ), out_by:profiles!checked_out_by ( display_name ), in_by:profiles!checked_in_by ( display_name )';

export default function UnitHistoryModal({
  unit,
  onClose,
}: {
  unit: { id: string; code: string };
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

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
      .eq('unit_id', unit.id)
      .order('start_at', { ascending: false })
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [unit.id]);

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Board history">
        <div className="st-modal-hd">
          <h3>Board history</h3>
          <span className="st-modal-ref">{unit.code}</span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!rows && (
          <p className="st-empty">
            <span className="st-spin">◠</span> Loading…
          </p>
        )}
        {rows && rows.length === 0 && <p className="st-empty">No rentals yet.</p>}
        {rows && rows.length > 0 && (
          <div className="st-card" style={{ marginBottom: 0 }}>
            {rows.map((r) => {
              const c = one(r.customers)?.full_name ?? '—';
              const finsBad = r.fins_in != null && r.fins_out != null && r.fins_in < r.fins_out;
              return (
                <div className="st-bdetail" key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <dl>
                    <dt>Ref</dt>
                    <dd>
                      {r.reference} · <span className={`st-badge ${r.status}`}>{r.status}</span>
                      {nameOf(r.res_by) ? ` · booked by ${nameOf(r.res_by)}` : ''}
                    </dd>
                    <dt>Customer</dt>
                    <dd>{c}</dd>
                    <dt>Out</dt>
                    <dd>
                      {dt(r.start_at)} · fins {r.fins_out ?? '—'}
                      {nameOf(r.out_by) ? ` · handed over by ${nameOf(r.out_by)}` : ''}
                      {r.condition_out_notes ? ` · ${r.condition_out_notes}` : ''}
                      {r.condition_out_photo_url && (
                        <>
                          {' '}
                          <a href={r.condition_out_photo_url} target="_blank" rel="noreferrer">
                            photo
                          </a>
                        </>
                      )}
                    </dd>
                    <dt>In</dt>
                    <dd>
                      {dt(r.returned_at)}
                      {r.returned_at ? ` · fins ${r.fins_in ?? '—'}` : ''}
                      {nameOf(r.in_by) ? ` · returned to ${nameOf(r.in_by)}` : ''}
                      {finsBad ? ' ⚠ missing fins' : ''}
                      {r.condition_in_notes ? ` · ${r.condition_in_notes}` : ''}
                      {r.condition_in_photo_url && (
                        <>
                          {' '}
                          <a href={r.condition_in_photo_url} target="_blank" rel="noreferrer">
                            photo
                          </a>
                        </>
                      )}
                    </dd>
                    {r.damage_reported && (
                      <>
                        <dt>Damage</dt>
                        <dd>{r.damage_fee ? `$${Number(r.damage_fee).toFixed(2)}` : 'reported'}</dd>
                      </>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
