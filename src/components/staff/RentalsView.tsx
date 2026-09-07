import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import NewRentalForm from './NewRentalForm';
import ReturnRentalModal, { type OutRental } from './ReturnRentalModal';
import WaiverModal from './WaiverModal';

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
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'pending',
  confirmed: 'confirmed',
  picked_up: 'out',
  returned: 'returned',
  cancelled: 'cancelled',
  no_show: 'no-show',
};

interface Rental {
  id: string;
  reference: string;
  start_at: string;
  end_at: string;
  picked_up_at: string | null;
  returned_at: string | null;
  status: string;
  total_amount: number;
  currency: string;
  payment_id: string | null;
  waiver_id: string | null;
  fins_out: number | null;
  damage_reported: boolean;
  board_units: { code: string } | { code: string }[] | null;
  board_models: { name: string } | { name: string }[] | null;
  customers: { full_name: string; phone: string | null } | { full_name: string; phone: string | null }[] | null;
}

const COLS =
  'id, reference, start_at, end_at, picked_up_at, returned_at, status, total_amount, currency, payment_id, waiver_id, fins_out, damage_reported, board_units ( code ), board_models ( name ), customers ( full_name, phone )';

export default function RentalsView() {
  const [tab, setTab] = useState<'out' | 'agenda'>('out');
  const [rows, setRows] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [returnFor, setReturnFor] = useState<OutRental | null>(null);
  const [viewWaiver, setViewWaiver] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const q =
      tab === 'out'
        ? sb.from('rentals').select(COLS).eq('status', 'picked_up').order('end_at')
        : sb.from('rentals').select(COLS).gte('start_at', since).order('start_at', { ascending: false });
    const { data } = await q;
    setRows((data ?? []) as unknown as Rental[]);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const overdue = useMemo(
    () => rows.filter((r) => r.status === 'picked_up' && Date.parse(r.end_at) < now).length,
    [rows, now],
  );

  function openReturn(r: Rental) {
    setReturnFor({
      id: r.id,
      reference: r.reference,
      code: one(r.board_units)?.code ?? '—',
      model: one(r.board_models)?.name ?? '—',
      customer: one(r.customers)?.full_name ?? '—',
      total_amount: Number(r.total_amount),
      currency: r.currency || 'USD',
      payment_id: r.payment_id,
      fins_out: r.fins_out,
    });
  }

  return (
    <div>
      <div className="st-tabs">
        <button className={tab === 'out' ? 'on' : ''} onClick={() => setTab('out')}>
          Afuera ahora {overdue > 0 && <span className="st-tab-flag">{overdue} vencidas</span>}
        </button>
        <button className={tab === 'agenda' ? 'on' : ''} onClick={() => setTab('agenda')}>
          Agenda
        </button>
      </div>

      {tab === 'agenda' && (
        <div style={{ textAlign: 'right', margin: '1rem 0' }}>
          <button
            className={`st-btn st-btn-sm ${showNew ? 'st-btn-ghost' : 'st-btn-primary'}`}
            onClick={() => setShowNew((v) => !v)}
          >
            {showNew ? 'Cerrar' : '+ Nuevo alquiler'}
          </button>
        </div>
      )}
      {tab === 'agenda' && showNew && (
        <NewRentalForm
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      )}

      {loading ? (
        <p className="st-empty">
          <span className="st-spin">◠</span> Cargando…
        </p>
      ) : rows.length === 0 ? (
        <p className="st-empty">
          {tab === 'out' ? 'Ninguna tabla afuera.' : 'Sin alquileres en los últimos 30 días.'}
        </p>
      ) : (
        rows.map((r) => {
          const code = one(r.board_units)?.code ?? '—';
          const model = one(r.board_models)?.name ?? '—';
          const cust = one(r.customers);
          const isOverdue = r.status === 'picked_up' && Date.parse(r.end_at) < now;
          return (
            <div className="st-card st-rental-row" key={r.id}>
              <div className="st-rental-main">
                <span className="st-b-ref">{r.reference}</span>
                <strong className="st-svc-title">
                  {code} · {model}
                </strong>
                <span className="st-note">
                  {cust?.full_name ?? '—'}
                  {cust?.phone ? ` · ${cust.phone}` : ''}
                </span>
              </div>
              <div className="st-rental-meta">
                <span className={`st-badge ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                <span className={r.payment_id ? 'st-badge paid' : 'st-badge unpaid'}>
                  {r.payment_id ? 'paid' : 'unpaid'}
                </span>
                {r.damage_reported && <span className="st-badge no_show">daño</span>}
              </div>
              <div className="st-rental-dates">
                <span>salió {r.picked_up_at ? dt(r.picked_up_at) : dt(r.start_at)}</span>
                <span className={isOverdue ? 'st-gate-warn' : ''}>
                  {r.returned_at ? `devuelta ${dt(r.returned_at)}` : `devuelve ${dt(r.end_at)}`}
                  {isOverdue ? ' ⚠' : ''}
                </span>
                <span className="st-note">{money(r.total_amount, r.currency)}</span>
              </div>
              <div className="st-rental-actions">
                {r.waiver_id && (
                  <button
                    className="st-btn st-btn-ghost st-btn-sm"
                    onClick={() => setViewWaiver({ id: r.waiver_id!, name: cust?.full_name ?? code })}
                  >
                    Waiver
                  </button>
                )}
                {r.status === 'picked_up' && (
                  <button className="st-btn st-btn-primary st-btn-sm" onClick={() => openReturn(r)}>
                    Recibir
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {returnFor && (
        <ReturnRentalModal
          rental={returnFor}
          onClose={() => setReturnFor(null)}
          onDone={() => {
            setReturnFor(null);
            void load();
          }}
        />
      )}
      {viewWaiver && (
        <WaiverModal
          waiverId={viewWaiver.id}
          participantName={viewWaiver.name}
          emergencyName={null}
          emergencyPhone={null}
          onClose={() => setViewWaiver(null)}
        />
      )}
    </div>
  );
}
