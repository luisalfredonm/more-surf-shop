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
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const COLS =
  'id, reference, start_at, end_at, returned_at, status, fins_out, fins_in, damage_reported, damage_fee, condition_out_notes, condition_in_notes, condition_out_photo_url, condition_in_photo_url, customers ( full_name )';

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
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Hoja de vida">
        <div className="st-modal-hd">
          <h3>Hoja de vida</h3>
          <span className="st-modal-ref">{unit.code}</span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {!rows && (
          <p className="st-empty">
            <span className="st-spin">◠</span> Cargando…
          </p>
        )}
        {rows && rows.length === 0 && <p className="st-empty">Sin alquileres todavía.</p>}
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
                    </dd>
                    <dt>Cliente</dt>
                    <dd>{c}</dd>
                    <dt>Salida</dt>
                    <dd>
                      {dt(r.start_at)} · fins {r.fins_out ?? '—'}
                      {r.condition_out_notes ? ` · ${r.condition_out_notes}` : ''}
                      {r.condition_out_photo_url && (
                        <>
                          {' '}
                          <a href={r.condition_out_photo_url} target="_blank" rel="noreferrer">
                            foto
                          </a>
                        </>
                      )}
                    </dd>
                    <dt>Entrada</dt>
                    <dd>
                      {dt(r.returned_at)}
                      {r.returned_at ? ` · fins ${r.fins_in ?? '—'}` : ''}
                      {finsBad ? ' ⚠ faltan fins' : ''}
                      {r.condition_in_notes ? ` · ${r.condition_in_notes}` : ''}
                      {r.condition_in_photo_url && (
                        <>
                          {' '}
                          <a href={r.condition_in_photo_url} target="_blank" rel="noreferrer">
                            foto
                          </a>
                        </>
                      )}
                    </dd>
                    {r.damage_reported && (
                      <>
                        <dt>Daño</dt>
                        <dd>{r.damage_fee ? `$${Number(r.damage_fee).toFixed(2)}` : 'reportado'}</dd>
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
