import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';
import { BUSINESS } from '@lib/constants';

/**
 * Shop → Sell. El POS de mostrador.
 *
 * No hay lector de código de barras (decisión 4): se vende con búsqueda por
 * nombre + grilla de productos, los destacados primero. Con ~50 productos eso
 * es más rápido que cualquier scanner.
 *
 * Tampoco hay línea de impuesto: los precios ya lo incluyen y el sistema no
 * calcula desglose (ver docs/ETAPA-3-SHOP.md §3). Se dice "tax included" y
 * listo, en vez de inventar un porcentaje.
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
  image: string | null;
  price: number;
  qty: number;
  available: number;
}

/** Línea lista para mandar: con el descuento ya repartido. */
interface PricedLine extends CartLine {
  discount: number;
  lineTotal: number;
}

interface SaleResult {
  reference: string;
  total: number;
  sold_at: string;
  items: { name_snapshot: string; qty: number; unit_price: number; line_total: number }[];
  payments: { method: 'cash' | 'card'; amount: number }[];
  cashReceived: number | null;
}

type Method = 'cash' | 'card' | 'split';

const lineName = (name: string, label: string) => (label === 'Único' ? name : `${name} · ${label}`);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Reparte un descuento de venta entre las líneas, en proporción a cada una.
 * La última se lleva el resto para que la suma cierre AL CENTAVO: el RPC
 * recalcula el total del lado del server y aborta con payment_mismatch si lo
 * cobrado no coincide, así que un centavo de deriva tumbaría la venta.
 */
function priceLines(cart: CartLine[], discount: number): PricedLine[] {
  const gross = cart.map((l) => round2(l.price * l.qty));
  const subtotal = round2(gross.reduce((s, n) => s + n, 0));
  const disc = Math.min(Math.max(discount, 0), subtotal);
  if (disc === 0 || subtotal === 0) {
    return cart.map((l, i) => ({ ...l, discount: 0, lineTotal: gross[i] }));
  }
  let assigned = 0;
  return cart.map((l, i) => {
    const last = i === cart.length - 1;
    const d = last ? round2(disc - assigned) : round2((disc * gross[i]) / subtotal);
    assigned = round2(assigned + d);
    return { ...l, discount: d, lineTotal: round2(gross[i] - d) };
  });
}

export default function PosView() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [staffName, setStaffName] = useState('');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [picking, setPicking] = useState<CatalogRow[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [sale, setSale] = useState<SaleResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  // ⌘K / Ctrl+K vuelve a la búsqueda sin soltar el teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const categories = useMemo(() => ['all', ...new Set(rows.map((r) => r.category))], [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((vs) => {
      const p = vs[0];
      if (category !== 'all' && p.category !== category) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        vs.some(
          (v) => v.sku.toLowerCase().includes(needle) || v.label.toLowerCase().includes(needle),
        )
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
          image: (v.image_urls ?? [])[0] ?? null,
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

  function drop(variantId: string) {
    setCart((c) => c.filter((l) => l.variant_id !== variantId));
  }

  function reset() {
    setCart([]);
    setDiscount('');
    setMethod('cash');
  }

  const subtotal = useMemo(
    () => round2(cart.reduce((s, l) => s + round2(l.price * l.qty), 0)),
    [cart],
  );
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const priced = useMemo(() => priceLines(cart, disc), [cart, disc]);
  const total = useMemo(() => round2(priced.reduce((s, l) => s + l.lineTotal, 0)), [priced]);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const overstock = cart.some((l) => l.qty > l.available);

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
        <div className="st-pos-left">
          <div className="st-pos-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by product name or SKU…"
              aria-label="Search products"
            />
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </div>

          <div className="st-pos-tabs">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`st-pos-tab ${category === c ? 'on' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c === 'all' ? 'All' : c}
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
                const img = (p.image_urls ?? [])[0] ?? null;
                return (
                  <button
                    key={p.product_id}
                    type="button"
                    className={`st-pos-item${stock <= 0 ? ' is-out' : ''}`}
                    onClick={() => pick(vs)}
                  >
                    <span className="st-pos-item-photo">
                      {img ? (
                        <img src={img} alt="" loading="lazy" />
                      ) : (
                        <span className="st-pos-ph" aria-hidden="true">
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      {vs.length > 1 && <span className="st-pos-item-opts">{vs.length}</span>}
                    </span>
                    <span className="st-pos-item-name">{p.name}</span>
                    <span className="st-pos-item-price">{money(p.price)}</span>
                    <span className={`st-pos-item-stock${stock <= 3 ? ' low' : ''}`}>
                      {stock <= 0 ? 'Out of stock' : `Stock: ${stock}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="st-pos-cart" id="st-pos-cart">
          <div className="st-pos-cart-hd">
            <h3>Current sale{count > 0 ? ` (${count})` : ''}</h3>
            {cart.length > 0 && (
              <button type="button" className="st-linkbtn" onClick={reset}>
                Clear
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="st-note st-pos-empty">Tap a product to start a sale.</p>
          ) : (
            <>
              <div className="st-pos-lines">
                {priced.map((l) => (
                  <div className="st-pos-line" key={l.variant_id}>
                    <span className="st-pos-line-thumb">
                      {l.image ? (
                        <img src={l.image} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden="true">{l.name.charAt(0).toUpperCase()}</span>
                      )}
                    </span>

                    <span className="st-pos-line-body">
                      <span className="st-pos-line-name">{l.name}</span>
                      {l.label !== 'Único' && (
                        <span className="st-pos-line-sub">{l.label}</span>
                      )}
                      <span className="st-pos-qty">
                        <button
                          type="button"
                          onClick={() => setQty(l.variant_id, -1)}
                          aria-label={`One less ${l.name}`}
                        >
                          −
                        </button>
                        <strong>{l.qty}</strong>
                        <button
                          type="button"
                          onClick={() => setQty(l.variant_id, 1)}
                          aria-label={`One more ${l.name}`}
                        >
                          +
                        </button>
                        <span className="st-pos-line-unit">× {money(l.price)}</span>
                      </span>
                      {l.qty > l.available && (
                        <span className="st-gate-warn">⚠ only {l.available} in stock</span>
                      )}
                    </span>

                    <span className="st-pos-line-right">
                      <button
                        type="button"
                        className="st-pos-line-x"
                        onClick={() => drop(l.variant_id)}
                        aria-label={`Remove ${l.name}`}
                      >
                        ✕
                      </button>
                      <span className="st-pos-line-total">{money(l.lineTotal)}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="st-pos-sums">
                <div>
                  <span>Subtotal</span>
                  <span>{money(subtotal)}</span>
                </div>
                <div className="st-pos-disc">
                  <label htmlFor="pos-disc">Discount</label>
                  <span>
                    <em>−$</em>
                    <input
                      id="pos-disc"
                      type="number"
                      min={0}
                      max={subtotal}
                      step="0.01"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      placeholder="0.00"
                    />
                  </span>
                </div>
              </div>

              <div className="st-pos-total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>
              <p className="st-pos-taxnote">Tax included</p>

              <div className="st-pos-methods">
                {(
                  [
                    ['cash', 'Cash'],
                    ['card', 'Card'],
                    ['split', 'Split'],
                  ] as [Method, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    className={`st-pos-method ${method === m ? 'on' : ''}`}
                    onClick={() => setMethod(m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="st-btn st-btn-primary st-pos-checkout"
                type="button"
                disabled={hasShift !== true || total <= 0}
                onClick={() => setPaying(true)}
              >
                <span>Checkout</span>
                <strong>{money(total)}</strong>
              </button>
              {overstock && (
                <p className="st-note st-pos-warn">
                  Over the counted stock. The sale still goes through.
                </p>
              )}

            </>
          )}
        </aside>

        {/* Mobile: el carrito queda debajo del catalogo; esta barra fija abajo
            muestra el total y lleva a cobrar sin buscarlo. */}
        {count > 0 && (
          <button
            type="button"
            className="st-pos-mbar"
            onClick={() => document.getElementById('st-pos-cart')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <span>
              {count} {count === 1 ? 'item' : 'items'}
            </span>
            <strong>{money(total)}</strong>
            <span>Review sale ↓</span>
          </button>
        )}
      </div>

      {picking && (
        <VariantPicker variants={picking} onPick={addVariant} onClose={() => setPicking(null)} />
      )}

      {paying && (
        <PayModal
          lines={priced}
          total={total}
          method={method}
          onClose={() => setPaying(false)}
          onDone={(result) => {
            setPaying(false);
            reset();
            setSale(result);
            void load();
          }}
        />
      )}

      {sale && <ReceiptModal sale={sale} staffName={staffName} onClose={() => setSale(null)} />}
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
        <div className="st-pos-varlist">
          {variants.map((v) => (
            <button
              key={v.variant_id}
              type="button"
              className={`st-pos-var${v.available <= 0 ? ' is-out' : ''}`}
              onClick={() => onPick(v)}
            >
              <span className="st-pos-var-label">{v.label}</span>
              <span className={`st-pos-item-stock${v.available <= 3 ? ' low' : ''}`}>
                {v.available <= 0 ? 'Out of stock' : `Stock: ${v.available}`}
              </span>
              <span className="st-pos-item-price">{money(v.price)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Cobro ----------

function PayModal({
  lines,
  total,
  method,
  onClose,
  onDone,
}: {
  lines: PricedLine[];
  total: number;
  method: Method;
  onClose: () => void;
  onDone: (r: SaleResult) => void;
}) {
  const [mode, setMode] = useState<Method>(method);
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
          items: lines.map((l) => ({
            variant_id: l.variant_id,
            qty: l.qty,
            discount: l.discount || undefined,
          })),
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
    <div
      className="st-modal"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
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
          <div className="st-pos-methods">
            {(
              [
                ['cash', 'Cash'],
                ['card', 'Card'],
                ['split', 'Split'],
              ] as [Method, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`st-pos-method ${mode === m ? 'on' : ''}`}
                onClick={() => setMode(m)}
              >
                {label}
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
              <span className="st-pos-change">{cashIn >= total ? money(change) : '—'}</span>
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
