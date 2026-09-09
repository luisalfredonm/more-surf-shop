import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import { BUSINESS } from '@lib/constants';

/**
 * Shop → Sell. El POS de mostrador.
 *
 * No hay lector de código de barras (decisión 4): se vende con búsqueda por
 * nombre + grilla de productos, los destacados primero. Con ~50 productos eso
 * es más rápido que cualquier scanner.
 *
 * El cobro lo cierra /api/shop/pos-sale, que corre todo en una transacción y
 * estampa collected_by + shift_id: la venta entra al cierre de caja sola.
 */

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface CatalogRow {
  product_id: string;
  name: string;
  category: string;
  image_urls: string[] | null;
  has_variants: boolean;
  featured: boolean;
  variant_id: string;
  sku: string;
  label: string;
  price: number;
  available: number;
}

interface CartLine {
  variant_id: string;
  name: string;
  label: string;
  price: number;
  qty: number;
  available: number;
}

interface SaleResult {
  reference: string;
  total: number;
  sold_at: string;
  items: { name_snapshot: string; qty: number; unit_price: number; line_total: number }[];
  payments: { method: 'cash' | 'card'; amount: number }[];
  cashReceived: number | null;
}

const lineName = (name: string, label: string) => (label === 'Único' ? name : `${name} · ${label}`);

export default function PosView() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [staffName, setStaffName] = useState('');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<CatalogRow[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [sale, setSale] = useState<SaleResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const { data: sess } = await sb.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      const [{ data: prof }, { data: shift }] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('cash_shifts').select('id').eq('profile_id', uid).eq('status', 'open').maybeSingle(),
      ]);
      setStaffName((prof?.display_name as string) ?? '');
      setHasShift(!!shift);
    } else {
      setHasShift(false);
    }
    const { data } = await sb.rpc('list_shop_catalog', { p_category: null });
    setRows((data ?? []) as CatalogRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Una tarjeta por producto; las variantes se eligen al tocarlo.
  const products = useMemo(() => {
    const byProduct = new Map<string, CatalogRow[]>();
    for (const r of rows) {
      const arr = byProduct.get(r.product_id) ?? [];
      arr.push(r);
      byProduct.set(r.product_id, arr);
    }
    return [...byProduct.values()];
  }, [rows]);

  const categories = useMemo(
    () => ['all', ...new Set(rows.map((r) => r.category))],
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((vs) => {
      const p = vs[0];
      if (category !== 'all' && p.category !== category) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        vs.some((v) => v.sku.toLowerCase().includes(needle) || v.label.toLowerCase().includes(needle))
      );
    });
  }, [products, q, category]);

  function addVariant(v: CatalogRow) {
    setCart((c) => {
      const i = c.findIndex((l) => l.variant_id === v.variant_id);
      if (i >= 0) {
        const next = [...c];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [
        ...c,
        {
          variant_id: v.variant_id,
          name: v.name,
          label: v.label,
          price: Number(v.price),
          qty: 1,
          available: v.available,
        },
      ];
    });
    setPicking(null);
  }

  function pick(variants: CatalogRow[]) {
    if (variants.length === 1) addVariant(variants[0]);
    else setPicking(variants);
  }

  function setQty(variantId: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => (l.variant_id === variantId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  const total = useMemo(
    () => round2(cart.reduce((s, l) => s + l.price * l.qty, 0)),
    [cart],
  );

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      {hasShift === false && (
        <div className="st-err">
          You don't have an open cash shift. Go to <strong>Cash → Cash Close</strong> and open your
          shift before selling.
        </div>
      )}

      <div className="st-pos">
        <div>
          <div className="st-filters" style={{ marginBottom: '0.75rem' }}>
            <div className="st-field" style={{ flex: 1 }}>
              <label htmlFor="pos-q">Search</label>
              <input
                id="pos-q"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Product name or SKU"
              />
            </div>
          </div>

          <div className="st-chiprow" style={{ marginBottom: '0.75rem' }}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`st-dchip ${category === c ? 'on' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="st-empty">
              {rows.length === 0
                ? 'No active products. Add them in Shop → Products.'
                : 'Nothing matches that search.'}
            </p>
          ) : (
            <div className="st-pos-grid">
              {shown.map((vs) => {
                const p = vs[0];
                const stock = vs.reduce((s, v) => s + v.available, 0);
                return (
                  <button
                    key={p.product_id}
                    type="button"
                    className={`st-pos-item${stock <= 0 ? ' is-out' : ''}`}
                    onClick={() => pick(vs)}
                  >
                    <span className="st-pos-item-name">{p.name}</span>
                    {vs.length > 1 && (
                      <span className="st-note" style={{ fontSize: '0.72rem' }}>
                        {vs.length} options
                      </span>
                    )}
                    <span className="st-pos-item-meta">
                      <span className="st-pos-item-price">{money(p.price)}</span>
                      <span className={`st-pos-item-stock${stock <= 3 ? ' low' : ''}`}>
                        {stock} left
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="st-pos-cart">
          <h3>Sale</h3>
          {cart.length === 0 ? (
            <p className="st-note">Tap a product to start.</p>
          ) : (
            <>
              {cart.map((l) => (
                <div className="st-pos-line" key={l.variant_id}>
                  <span className="st-pos-line-name">{lineName(l.name, l.label)}</span>
                  <span className="st-pos-line-total">{money(l.price * l.qty)}</span>
                  <span className="st-pos-line-ctl">
                    <button
                      type="button"
                      className="st-pos-qty"
                      onClick={() => setQty(l.variant_id, -1)}
                      aria-label="One less"
                    >
                      −
                    </button>
                    <strong>{l.qty}</strong>
                    <button
                      type="button"
                      className="st-pos-qty"
                      onClick={() => setQty(l.variant_id, 1)}
                      aria-label="One more"
                    >
                      +
                    </button>
                    <span>× {money(l.price)}</span>
                    {l.qty > l.available && (
                      <span className="st-gate-warn">⚠ only {l.available} left</span>
                    )}
                  </span>
                </div>
              ))}

              <div className="st-pos-total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>

              <button
                className="st-btn st-btn-primary st-btn-block"
                type="button"
                disabled={hasShift !== true || total <= 0}
                onClick={() => setPaying(true)}
              >
                Charge {money(total)}
              </button>
              <button
                className="st-btn st-btn-ghost st-btn-sm st-btn-block"
                type="button"
                style={{ marginTop: '0.4rem' }}
                onClick={() => setCart([])}
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {picking && (
        <VariantPicker variants={picking} onPick={addVariant} onClose={() => setPicking(null)} />
      )}

      {paying && (
        <PayModal
          cart={cart}
          total={total}
          onClose={() => setPaying(false)}
          onDone={(result) => {
            setPaying(false);
            setCart([]);
            setSale(result);
            void load();
          }}
        />
      )}

      {sale && (
        <ReceiptModal sale={sale} staffName={staffName} onClose={() => setSale(null)} />
      )}
    </div>
  );
}

// ---------- Elegir variante ----------

function VariantPicker({
  variants,
  onPick,
  onClose,
}: {
  variants: CatalogRow[];
  onPick: (v: CatalogRow) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Pick a variant">
        <div className="st-modal-hd">
          <h3>{variants[0].name}</h3>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="st-pos-grid">
          {variants.map((v) => (
            <button
              key={v.variant_id}
              type="button"
              className={`st-pos-item${v.available <= 0 ? ' is-out' : ''}`}
              onClick={() => onPick(v)}
            >
              <span className="st-pos-item-name">{v.label}</span>
              <span className="st-pos-item-meta">
                <span className="st-pos-item-price">{money(v.price)}</span>
                <span className={`st-pos-item-stock${v.available <= 3 ? ' low' : ''}`}>
                  {v.available} left
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Cobro ----------

function PayModal({
  cart,
  total,
  onClose,
  onDone,
}: {
  cart: CartLine[];
  total: number;
  onClose: () => void;
  onDone: (r: SaleResult) => void;
}) {
  const [mode, setMode] = useState<'cash' | 'card' | 'split'>('cash');
  const [received, setReceived] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const cashIn = Number(received) || 0;
  const change = round2(cashIn - total);
  const splitCash = round2(Math.min(Number(cashPart) || 0, total));
  const splitCard = round2(total - splitCash);

  const valid =
    mode === 'card' ||
    (mode === 'cash' && cashIn >= total) ||
    (mode === 'split' && splitCash > 0 && splitCard > 0);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);

    // Lo que se registra es el TOTAL, no lo que entregó el cliente: el vuelto no
    // es un cobro. Por eso en efectivo va `total`, no `cashIn`.
    const payments =
      mode === 'cash'
        ? [{ method: 'cash' as const, amount: total }]
        : mode === 'card'
          ? [{ method: 'card' as const, amount: total }]
          : [
              { method: 'cash' as const, amount: splitCash },
              { method: 'card' as const, amount: splitCard },
            ];

    try {
      const { data: sess } = await getBrowserSupabase().auth.getSession();
      const res = await fetch('/api/shop/pos-sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          items: cart.map((l) => ({ variant_id: l.variant_id, qty: l.qty })),
          payments,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(
          data.code === 'no_open_shift'
            ? 'Open your cash shift (Cash → Cash Close) before selling.'
            : data.error || 'Could not record the sale.',
        );
        setBusy(false);
        return;
      }
      onDone({
        reference: data.reference,
        total: Number(data.total),
        sold_at: data.sold_at,
        items: data.items ?? [],
        payments,
        cashReceived: mode === 'cash' ? cashIn : mode === 'split' ? splitCash : null,
      });
    } catch {
      setErr('Connection failed.');
      setBusy(false);
    }
  }

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Charge">
        <div className="st-modal-hd">
          <h3>Charge {money(total)}</h3>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        <div className="st-field">
          <label>Method</label>
          <div className="st-chiprow">
            {(['cash', 'card', 'split'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`st-dchip ${mode === m ? 'on' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'cash' ? 'Cash' : m === 'card' ? 'Card' : 'Split'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'cash' && (
          <div className="st-row">
            <div className="st-field">
              <label>Cash received</label>
              <input
                type="number"
                min={0}
                step="0.01"
                autoFocus
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={total.toFixed(2)}
              />
            </div>
            <div className="st-field">
              <label>Change</label>
              <span className="st-pos-change">
                {cashIn >= total ? money(change) : '—'}
              </span>
            </div>
          </div>
        )}

        {mode === 'split' && (
          <div className="st-row">
            <div className="st-field">
              <label>Cash</label>
              <input
                type="number"
                min={0}
                max={total}
                step="0.01"
                autoFocus
                value={cashPart}
                onChange={(e) => setCashPart(e.target.value)}
              />
            </div>
            <div className="st-field">
              <label>Card (the rest)</label>
              <input readOnly value={money(splitCard)} />
            </div>
          </div>
        )}

        <div className="st-modal-actions">
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="st-btn st-btn-primary st-btn-sm"
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Confirm sale'}
          </button>
        </div>
        {!valid && !busy && mode === 'cash' && (
          <p className="st-note" style={{ marginTop: '0.4rem' }}>
            Enter at least {money(total)}.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Recibo ----------

function ReceiptModal({
  sale,
  staffName,
  onClose,
}: {
  sale: SaleResult;
  staffName: string;
  onClose: () => void;
}) {
  // Mientras el recibo está en pantalla, imprimir sólo imprime el recibo.
  useEffect(() => {
    document.body.classList.add('st-printing-receipt');
    return () => document.body.classList.remove('st-printing-receipt');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = new Date(sale.sold_at);
  const cash = sale.payments.find((p) => p.method === 'cash');
  const card = sale.payments.find((p) => p.method === 'card');
  const change =
    sale.cashReceived != null && cash ? round2(sale.cashReceived - cash.amount) : null;

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Receipt">
        <div className="st-modal-hd st-noprint">
          <h3>Sale recorded</h3>
          <span className="st-modal-ref">{sale.reference}</span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="st-receipt">
          <div className="st-receipt-center">
            <div className="st-receipt-name">{BUSINESS.name.toUpperCase()}</div>
            <div>
              {BUSINESS.address.locality}, {BUSINESS.address.region}
            </div>
          </div>
          <hr />
          <div className="st-receipt-row">
            <span>{sale.reference}</span>
            <span>{d.toLocaleDateString('en-US')}</span>
          </div>
          <div className="st-receipt-row">
            <span>{staffName ? `Served by ${staffName}` : ''}</span>
            <span>{d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <hr />
          {sale.items.map((it, i) => (
            <div className="st-receipt-row" key={i}>
              <span>
                {it.qty}× {it.name_snapshot}
              </span>
              <span>{money(Number(it.line_total))}</span>
            </div>
          ))}
          <hr />
          <div className="st-receipt-row st-receipt-total">
            <span>TOTAL</span>
            <span>{money(sale.total)}</span>
          </div>
          {cash && (
            <div className="st-receipt-row">
              <span>Cash</span>
              <span>{money(sale.cashReceived ?? cash.amount)}</span>
            </div>
          )}
          {change != null && change > 0 && (
            <div className="st-receipt-row">
              <span>Change</span>
              <span>{money(change)}</span>
            </div>
          )}
          {card && (
            <div className="st-receipt-row">
              <span>Card</span>
              <span>{money(card.amount)}</span>
            </div>
          )}
          <div>Tax included</div>
          <hr />
          <div className="st-receipt-foot">
            Thank you! · Exchanges within 8 days with this receipt
            <br />
            Not a tax document
          </div>
        </div>

        <div className="st-modal-actions st-noprint">
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>
            New sale
          </button>
          <button className="st-btn st-btn-primary st-btn-sm" onClick={() => window.print()}>
            Print receipt
          </button>
        </div>
      </div>
    </div>
  );
}
