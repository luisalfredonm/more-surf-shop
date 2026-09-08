import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

const money = (n: number | null | undefined, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n) || 0);
const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
const round2 = (n: number) => Math.round(n * 100) / 100;
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

interface Shift {
  id: string;
  profile_id: string;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  card_total: number | null;
  status: 'open' | 'closed' | 'reopened';
  notes: string | null;
  profiles?: { display_name: string } | { display_name: string }[] | null;
}
interface Totals {
  cash_total: number;
  card_total: number;
  cash_count: number;
  card_count: number;
  refunds_total: number;
}

const COLS =
  'id, profile_id, opened_at, opening_float, closed_at, closed_by, expected_cash, counted_cash, difference, card_total, status, notes, profiles ( display_name )';

export default function CashView() {
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [current, setCurrent] = useState<Shift | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Edición del dueño sobre un turno reabierto.
  const [edit, setEdit] = useState<{ id: string; float: string; counted: string; notes: string } | null>(
    null,
  );

  const token = useCallback(async () => {
    const { data } = await getBrowserSupabase().auth.getSession();
    return data.session?.access_token ?? '';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sb = getBrowserSupabase();
    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setLoading(false);
      return;
    }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', uid).maybeSingle();
    const role = (prof?.role as string) ?? 'staff';
    setMe({ id: uid, role });

    const { data: openRows } = await sb
      .from('cash_shifts')
      .select(COLS)
      .eq('profile_id', uid)
      .in('status', ['open', 'reopened'])
      .order('opened_at', { ascending: false })
      .limit(1);
    const mine = (openRows?.[0] as Shift) ?? null;
    setCurrent(mine);
    if (mine) {
      const { data: t } = await sb.rpc('cash_shift_totals', { p_shift_id: mine.id });
      setTotals(((Array.isArray(t) ? t[0] : t) as Totals) ?? null);
    } else {
      setTotals(null);
    }

    let hq = sb
      .from('cash_shifts')
      .select(COLS)
      .in('status', ['closed', 'reopened'])
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(40);
    if (!(role === 'owner' && showAll)) hq = hq.eq('profile_id', uid);
    const { data: hist } = await hq;
    // El turno reabierto propio ya se muestra arriba como "actual".
    setHistory(((hist ?? []) as Shift[]).filter((h) => h.id !== mine?.id));
    setLoading(false);
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openShift() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/cash/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ opening_float: Number(float) || 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || 'No se pudo abrir el turno.');
        return;
      }
      setFloat('');
      setMsg('Turno abierto.');
      void load();
    } finally {
      setBusy(false);
    }
  }

  const expected =
    current && totals
      ? round2(Number(current.opening_float) + totals.cash_total - totals.refunds_total)
      : 0;
  const diff = counted !== '' ? round2((Number(counted) || 0) - expected) : null;
  const needsNote = diff !== null && diff !== 0 && notes.trim().length === 0;

  async function closeShift() {
    if (!current) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/cash/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          shift_id: current.id,
          counted_cash: Number(counted) || 0,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || 'No se pudo cerrar el turno.');
        return;
      }
      setCounted('');
      setNotes('');
      setMsg(
        `Turno cerrado. Esperado ${money(data.expected_cash)} · contado ${money(
          data.counted_cash,
        )} · diferencia ${money(data.difference)}.`,
      );
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function reopen(s: Shift) {
    if (!confirm(`Reabrir el turno de ${one(s.profiles)?.display_name ?? '—'} (${dt(s.closed_at)})?`))
      return;
    const { error } = await getBrowserSupabase()
      .from('cash_shifts')
      .update({ status: 'reopened' })
      .eq('id', s.id);
    if (error) alert(error.message);
    else void load();
  }

  /** El dueño ajusta un turno reabierto y lo vuelve a cerrar. Un turno reabierto
   *  no recibe cobros nuevos, así que expected sólo se corre por el cambio de fondo. */
  async function saveEdit(s: Shift) {
    if (!edit) return;
    const floatNew = Number(edit.float) || 0;
    const countedNew = Number(edit.counted) || 0;
    const expectedNew = round2(Number(s.expected_cash ?? 0) + (floatNew - Number(s.opening_float)));
    const diffNew = round2(countedNew - expectedNew);
    if (diffNew !== 0 && edit.notes.trim().length === 0) {
      setErr('Hay diferencia. Agregá una nota.');
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await getBrowserSupabase()
      .from('cash_shifts')
      .update({
        opening_float: round2(floatNew),
        counted_cash: round2(countedNew),
        expected_cash: expectedNew,
        difference: diffNew,
        notes: edit.notes.trim() || null,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: me?.id ?? null,
      })
      .eq('id', s.id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setEdit(null);
    setMsg('Turno ajustado y cerrado.');
    void load();
  }

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Cargando…
      </p>
    );
  }

  return (
    <div>
      {err && <div className="st-err">{err}</div>}
      {msg && (
        <div className="st-note" style={{ marginBottom: '0.75rem' }}>
          {msg}
        </div>
      )}

      {/* Turno actual */}
      {!current ? (
        <div className="st-card">
          <h2 className="st-h2" style={{ marginTop: 0 }}>
            Abrir turno
          </h2>
          <p className="st-note" style={{ marginBottom: '0.75rem' }}>
            Contá el efectivo con el que arrancás y anotalo como fondo inicial. No podés cobrar sin un
            turno abierto.
          </p>
          <div className="st-row">
            <div className="st-field">
              <label>Fondo inicial (USD)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={float}
                onChange={(e) => setFloat(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="st-field" style={{ justifyContent: 'flex-end' }}>
              <button className="st-btn st-btn-primary" type="button" disabled={busy} onClick={openShift}>
                {busy ? 'Abriendo…' : 'Abrir turno'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="st-card">
          <div className="st-svc-head" style={{ cursor: 'default' }}>
            <span className="st-dot on" aria-hidden="true" />
            <span className="st-svc-title">Turno abierto</span>
            <span className="st-svc-sum">
              desde {dt(current.opened_at)} · fondo {money(current.opening_float)}
              {current.status === 'reopened' && ' · reabierto por el dueño'}
            </span>
          </div>

          <dl className="st-bdetail">
            <dt>Efectivo cobrado</dt>
            <dd>
              {money(totals?.cash_total)} <span className="st-note">({totals?.cash_count ?? 0} cobros)</span>
            </dd>
            <dt>Tarjeta</dt>
            <dd>
              {money(totals?.card_total)}{' '}
              <span className="st-note">({totals?.card_count ?? 0} cobros · no entra en la diferencia)</span>
            </dd>
            {!!totals?.refunds_total && (
              <>
                <dt>Reembolsos</dt>
                <dd>−{money(totals.refunds_total)}</dd>
              </>
            )}
            <dt>Efectivo esperado</dt>
            <dd>
              <strong>{money(expected)}</strong>{' '}
              <span className="st-note">(fondo + efectivo − reembolsos)</span>
            </dd>
          </dl>

          <div className="st-row" style={{ marginTop: '0.5rem' }}>
            <div className="st-field">
              <label>Efectivo contado al cierre (USD)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="st-field">
              <label>Diferencia</label>
              <input
                readOnly
                value={diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`}
                className={diff !== null && diff !== 0 ? 'st-gate-warn' : ''}
              />
            </div>
          </div>
          <div className="st-field">
            <label>Nota {needsNote ? '(obligatoria — hay diferencia)' : '(opcional)'}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explicá el faltante o sobrante"
            />
          </div>
          <button
            className="st-btn st-btn-primary"
            type="button"
            disabled={busy || counted === '' || needsNote}
            onClick={closeShift}
          >
            {busy ? 'Cerrando…' : 'Cerrar turno'}
          </button>
        </div>
      )}

      {/* Historial */}
      <div className="st-inline" style={{ justifyContent: 'space-between', margin: '1.5rem 0 0.5rem' }}>
        <h2 className="st-h2" style={{ margin: 0 }}>
          Cierres
        </h2>
        {me?.role === 'owner' && (
          <label className="st-note st-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <span>Ver los de todo el equipo</span>
          </label>
        )}
      </div>

      {history.length === 0 ? (
        <p className="st-empty">Sin cierres todavía.</p>
      ) : (
        history.map((s) => (
          <div className="st-card" key={s.id}>
            <div className="st-rental-row">
              <div className="st-rental-main">
                <strong className="st-svc-title">{one(s.profiles)?.display_name ?? '—'}</strong>
                <span className="st-note">
                  {dt(s.opened_at)} → {dt(s.closed_at)}
                  {s.status === 'reopened' && ' · reabierto'}
                </span>
                {s.notes && <span className="st-note">“{s.notes}”</span>}
              </div>
              <div className="st-rental-dates">
                <span>fondo {money(s.opening_float)}</span>
                <span>
                  esperado {money(s.expected_cash)} · contado {money(s.counted_cash)}
                </span>
                <span
                  className={s.difference != null && s.difference !== 0 ? 'st-gate-warn' : 'st-note'}
                >
                  dif {s.difference != null && s.difference > 0 ? '+' : ''}
                  {money(s.difference)} · tarjeta {money(s.card_total)}
                </span>
              </div>
              {me?.role === 'owner' && (
                <div className="st-rental-actions">
                  {s.status === 'closed' ? (
                    <button
                      className="st-btn st-btn-ghost st-btn-sm"
                      type="button"
                      onClick={() => reopen(s)}
                    >
                      Reabrir
                    </button>
                  ) : (
                    <button
                      className="st-btn st-btn-ghost st-btn-sm"
                      type="button"
                      onClick={() =>
                        setEdit(
                          edit?.id === s.id
                            ? null
                            : {
                                id: s.id,
                                float: String(s.opening_float ?? ''),
                                counted: String(s.counted_cash ?? ''),
                                notes: s.notes ?? '',
                              },
                        )
                      }
                    >
                      {edit?.id === s.id ? 'Cerrar edición' : 'Ajustar'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {edit?.id === s.id && (
              <div className="st-svc-form">
                <div className="st-row">
                  <div className="st-field">
                    <label>Fondo inicial (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={edit.float}
                      onChange={(e) => setEdit({ ...edit, float: e.target.value })}
                    />
                  </div>
                  <div className="st-field">
                    <label>Efectivo contado (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={edit.counted}
                      onChange={(e) => setEdit({ ...edit, counted: e.target.value })}
                    />
                  </div>
                </div>
                <div className="st-field">
                  <label>Nota</label>
                  <textarea
                    rows={2}
                    value={edit.notes}
                    onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  />
                </div>
                <button
                  className="st-btn st-btn-primary st-btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => saveEdit(s)}
                >
                  {busy ? 'Guardando…' : 'Guardar y cerrar'}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
