import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Shop → Inventory. Stock por variante, entradas de mercadería y ajustes.
 *
 * REGLA: nunca se hace `update inventory set qty_on_hand`. Toda variación se
 * inserta en `inventory_moves` y el trigger la aplica. Así el saldo y el kardex
 * no pueden desincronizarse.
 */

const dt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const REASON_LABEL: Record<string, string> = {
  sale: 'sale',
  return: 'return',
  purchase: 'stock in',
  adjustment: 'adjustment',
  shrinkage: 'shrinkage',
  correction: 'correction',
};

interface Row {
  variant_id: string;
  sku: string;
  label: string;
  active: boolean;
  product_id: string;
  product_name: string;
  category: string;
  qty_on_hand: number;
  reorder_point: number | null;
}

interface Move {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default function InventoryView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [moveFor, setMoveFor] = useState<Row | null>(null);
  const [kardexFor, setKardexFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const { data: sess } = await sb.auth.getSession();
    setMeId(sess.session?.user.id ?? null);

    const { data } = await sb
      .from('product_variants')
      .select(
        'id, sku, label, active, product_id, products ( name, category ), inventory ( qty_on_hand, reorder_point )',
      )
      .order('sort_order');

    const list: Row[] = ((data ?? []) as any[]).map((v) => {
      const p = one<{ name?: string; category?: string }>(v.products);
      const i = one<{ qty_on_hand?: number; reorder_point?: number | null }>(v.inventory);
      return {
        variant_id: v.id,
        sku: v.sku,
        label: v.label,
        active: v.active,
        product_id: v.product_id,
        product_name: p?.name ?? '—',
        category: p?.category ?? '—',
        qty_on_hand: i?.qty_on_hand ?? 0,
        reorder_point: i?.reorder_point ?? null,
      };
    });
    list.sort((a, b) => a.product_name.localeCompare(b.product_name) || a.label.localeCompare(b.label));
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isLow = (r: Row) => r.reorder_point != null && r.qty_on_hand <= r.reorder_point;

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.active);
    return {
      skus: active.length,
      units: active.reduce((s, r) => s + r.qty_on_hand, 0),
      low: active.filter(isLow).length,
      negative: rows.filter((r) => r.qty_on_hand < 0).length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyLow && !isLow(r)) return false;
      if (!needle) return true;
      return (
        r.product_name.toLowerCase().includes(needle) ||
        r.label.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, onlyLow]);

  async function setReorderPoint(r: Row, value: string) {
    const n = value === '' ? null : Math.max(0, Number(value) || 0);
    const { error } = await getBrowserSupabase()
      .from('inventory')
      .update({ reorder_point: n })
      .eq('variant_id', r.variant_id);
    if (error) alert(error.message);
    else await load();
  }

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <div className="st-tiles">
        <Tile label="Active SKUs" value={String(stats.skus)} />
        <Tile label="Units in stock" value={String(stats.units)} tone="accent" />
        <Tile label="Below minimum" value={String(stats.low)} tone={stats.low ? 'warn' : undefined} />
        <Tile label="Negative" value={String(stats.negative)} tone={stats.negative ? 'warn' : undefined} />
      </div>

      <p className="st-note st-inv-rule">
        Every change goes through a movement, so the balance and the history can never drift
        apart. Negative stock means a count is missing, not that selling is blocked.
      </p>

      <div className="st-tbl-bar">
        <div className="st-pos-search st-tbl-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by product, variant or SKU…"
            aria-label="Search inventory"
          />
        </div>
        <label className="st-check st-tbl-check">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          <span>Only below minimum</span>
        </label>
      </div>

      <p className="st-tbl-count">
        {shown.length === rows.length ? `${rows.length} SKUs` : `${shown.length} of ${rows.length}`}
      </p>

      {shown.length === 0 ? (
        <p className="st-empty">
          {rows.length === 0
            ? 'Nothing to count yet. Add products in Shop → Products.'
            : 'Nothing matches those filters.'}
        </p>
      ) : (
        <div className="st-tbl-wrap">
          <table className="st-tbl st-tbl-cards">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col" className="st-tbl-num">
                  In stock
                </th>
                <th scope="col" className="st-tbl-num">
                  Minimum
                </th>
                <th scope="col">
                  <span className="st-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const low = isLow(r);
                const neg = r.qty_on_hand < 0;
                return (
                  <tr key={r.variant_id}>
                    <td className="st-card-main st-card-full">
                      <span className="st-tbl-name">
                        {r.product_name}
                        {r.label !== 'Único' && (
                          <span className="st-inv-variant">{r.label}</span>
                        )}
                        {!r.active && <span className="st-badge cancelled">inactive</span>}
                      </span>
                      <span className="st-tbl-sub">{r.sku}</span>
                    </td>
                    <td className="st-tbl-cat" data-label="Category">{r.category}</td>
                    <td className="st-tbl-num" data-label="In stock">
                      <span
                        className={`st-tbl-stock${neg ? ' out' : low ? ' low' : ''}`}
                        title={
                          neg
                            ? 'Negative: a count is missing'
                            : low
                              ? 'At or below the minimum'
                              : undefined
                        }
                      >
                        {r.qty_on_hand}
                      </span>
                      {(neg || low) && (
                        <span className={`st-inv-flag${neg ? ' neg' : ''}`}>{neg ? '!' : '⚠'}</span>
                      )}
                    </td>
                    <td className="st-tbl-num" data-label="Minimum">
                      <input
                        className="st-inv-min"
                        type="number"
                        min={0}
                        defaultValue={r.reorder_point ?? ''}
                        placeholder="—"
                        aria-label={`Minimum for ${r.product_name}`}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== String(r.reorder_point ?? '')) void setReorderPoint(r, v);
                        }}
                      />
                    </td>
                    <td className="st-card-full">
                      <span className="st-tbl-acts">
                        <button
                          className="st-btn st-btn-ghost st-btn-sm"
                          type="button"
                          onClick={() => setMoveFor(r)}
                        >
                          Move stock
                        </button>
                        <button
                          className="st-btn st-btn-ghost st-btn-sm"
                          type="button"
                          onClick={() => setKardexFor(r)}
                        >
                          History
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {moveFor && (
        <MoveModal
          row={moveFor}
          meId={meId}
          onClose={() => setMoveFor(null)}
          onDone={() => {
            setMoveFor(null);
            void load();
          }}
        />
      )}
      {kardexFor && <KardexModal row={kardexFor} onClose={() => setKardexFor(null)} />}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'accent';
}) {
  return (
    <div className="st-tile">
      <span className="st-tile-label">{label}</span>
      <span className={`st-tile-val${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

// ---------- Movimiento de stock ----------

type MoveKind = 'purchase' | 'adjustment' | 'shrinkage' | 'return';

const KINDS: { key: MoveKind; label: string; hint: string; sign: 1 | -1 | 0 }[] = [
  { key: 'purchase', label: 'Stock in', hint: 'New merchandise arrived', sign: 1 },
  { key: 'adjustment', label: 'Adjustment', hint: 'Physical count differs — needs a reason', sign: 0 },
  { key: 'shrinkage', label: 'Loss', hint: 'Broken, lost or stolen', sign: -1 },
  { key: 'return', label: 'Customer return', hint: 'Item came back to the shelf', sign: 1 },
];

function MoveModal({
  row,
  meId,
  onClose,
  onDone,
}: {
  row: Row;
  meId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<MoveKind>('purchase');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const spec = KINDS.find((k) => k.key === kind)!;
  const n = Number(qty) || 0;
  // 'adjustment' lleva signo propio (puede ser +/−); los demás lo fijan.
  const delta = spec.sign === 0 ? n : spec.sign * Math.abs(n);
  const resulting = row.qty_on_hand + delta;
  const needsNote = kind === 'adjustment';
  const valid = delta !== 0 && (!needsNote || note.trim().length >= 3);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const { error } = await getBrowserSupabase().from('inventory_moves').insert({
      variant_id: row.variant_id,
      delta,
      reason: kind,
      note: note.trim() || null,
      created_by: meId,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone();
  }

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Move stock">
        <div className="st-modal-hd">
          <h3>Move stock</h3>
          <span className="st-modal-ref">
            {row.product_name}
            {row.label !== 'Único' ? ` · ${row.label}` : ''}
          </span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        <div className="st-field">
          <label>Reason</label>
          <div className="st-chiprow">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`st-dchip ${kind === k.key ? 'on' : ''}`}
                onClick={() => setKind(k.key)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="st-note" style={{ marginTop: '0.3rem' }}>
            {spec.hint}
          </p>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label>
              {kind === 'adjustment' ? 'Difference (+ or −)' : 'Quantity'}
            </label>
            <input
              type="number"
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={kind === 'adjustment' ? '-2' : '10'}
            />
          </div>
          <div className="st-field">
            <label>Result</label>
            <input
              readOnly
              value={`${row.qty_on_hand} → ${resulting}`}
              className={resulting < 0 ? 'st-gate-warn' : ''}
            />
          </div>
        </div>

        <div className="st-field">
          <label>Note {needsNote ? '(required)' : '(optional)'}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === 'adjustment' ? 'Counted 8, system said 10' : 'Supplier, invoice, detail…'
            }
          />
        </div>

        {resulting < 0 && (
          <p className="st-note st-gate-warn">
            This leaves the stock negative. It is allowed, but it means a count is missing.
          </p>
        )}

        <div className="st-modal-actions">
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="st-btn st-btn-primary st-btn-sm"
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Record movement'}
          </button>
        </div>
        {!valid && !busy && (
          <p className="st-note" style={{ marginTop: '0.4rem' }}>
            Missing: {delta === 0 && 'quantity · '}
            {needsNote && note.trim().length < 3 && 'reason'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Kardex ----------

function KardexModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [moves, setMoves] = useState<Move[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    void getBrowserSupabase()
      .from('inventory_moves')
      .select('id, delta, reason, note, created_at, profiles:created_by ( display_name )')
      .eq('variant_id', row.variant_id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setMoves((data ?? []) as unknown as Move[]));
  }, [row.variant_id]);

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Stock history">
        <div className="st-modal-hd">
          <h3>Stock history</h3>
          <span className="st-modal-ref">
            {row.product_name}
            {row.label !== 'Único' ? ` · ${row.label}` : ''} · {row.sku}
          </span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!moves && (
          <p className="st-empty">
            <span className="st-spin">◠</span> Loading…
          </p>
        )}
        {moves && moves.length === 0 && <p className="st-empty">No movements yet.</p>}
        {moves && moves.length > 0 && (
          <div className="st-tbl-wrap">
            <table className="st-tbl st-tbl-sm">
              <thead>
                <tr>
                  <th scope="col" className="st-tbl-num">
                    Change
                  </th>
                  <th scope="col">Reason</th>
                  <th scope="col">Note</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="st-tbl-num">
                      <span className={`st-inv-delta${m.delta < 0 ? ' down' : ''}`}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                    </td>
                    <td>
                      <span className="st-src">{REASON_LABEL[m.reason] ?? m.reason}</span>
                    </td>
                    <td className="st-tbl-muted">{m.note ?? '—'}</td>
                    <td className="st-tbl-muted st-inv-when">
                      {dt(m.created_at)}
                      {one(m.profiles)?.display_name ? ` · ${one(m.profiles)!.display_name}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
