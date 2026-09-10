import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Shop → Products. CRUD de productos y sus variantes.
 *
 * Es una tabla de administración, no una lista de tarjetas: con ~50 productos
 * lo que se hace acá es BUSCAR uno y tocarlo, así que arriba van buscador y
 * filtros, y el alta vive en un modal en vez de ocupar la pantalla siempre.
 *
 * El stock se ve de sólo lectura; se mueve en Shop → Inventory (toda variación
 * pasa por inventory_moves).
 *
 * Las fotos van al bucket `rental-photos` bajo el prefijo `products/`: ya existe,
 * es público y tiene la policy de escritura para staff.
 */

const CATEGORIES = [
  'leash',
  'fins',
  'wax',
  'apparel',
  'sunscreen',
  'bags',
  'accessories',
] as const;

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  brand: string | null;
  description: string | null;
  image_urls: string[] | null;
  price: number;
  has_variants: boolean;
  active: boolean;
  featured: boolean;
  sort_order: number;
}
interface Variant {
  id: string;
  product_id: string;
  sku: string;
  label: string;
  price_override: number | null;
  active: boolean;
  sort_order: number;
}
interface Stock {
  variant_id: string;
  qty_on_hand: number;
  reorder_point: number | null;
}

const PRODUCT_COLS =
  'id, name, slug, category, brand, description, image_urls, price, has_variants, active, featured, sort_order';
const VARIANT_COLS = 'id, product_id, sku, label, price_override, active, sort_order';

type StatusFilter = 'all' | 'active' | 'inactive';

export default function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stock, setStock] = useState<Map<string, Stock>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [cat, setCat] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    const [p, v, i] = await Promise.all([
      sb.from('products').select(PRODUCT_COLS).order('sort_order').order('name'),
      sb.from('product_variants').select(VARIANT_COLS).order('sort_order'),
      sb.from('inventory').select('variant_id, qty_on_hand, reorder_point'),
    ]);
    setProducts((p.data ?? []) as Product[]);
    setVariants((v.data ?? []) as Variant[]);
    setStock(new Map(((i.data ?? []) as Stock[]).map((r) => [r.variant_id, r])));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stockOf = useCallback(
    (productId: string) =>
      variants
        .filter((v) => v.product_id === productId)
        .reduce((s, v) => s + (stock.get(v.id)?.qty_on_hand ?? 0), 0),
    [variants, stock],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (status === 'active' && !p.active) return false;
      if (status === 'inactive' && p.active) return false;
      if (cat !== 'all' && p.category !== cat) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.slug.toLowerCase().includes(needle) ||
        (p.brand ?? '').toLowerCase().includes(needle) ||
        variants.some((v) => v.product_id === p.id && v.sku.toLowerCase().includes(needle))
      );
    });
  }, [products, variants, q, status, cat]);

  // Sólo se ofrecen las categorías que existen, como en el catálogo público.
  const usedCats = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort(),
    [products],
  );

  const activeCount = products.filter((p) => p.active).length;
  const outCount = products.filter((p) => stockOf(p.id) <= 0).length;

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <div className="st-tbl-bar">
        <div className="st-pos-search st-tbl-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, SKU or brand…"
            aria-label="Search products"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {usedCats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <span className="st-spacer" />

        <button className="st-btn st-btn-primary" type="button" onClick={() => setAdding(true)}>
          + Add product
        </button>
      </div>

      <p className="st-tbl-count">
        {shown.length === products.length
          ? `${products.length} ${products.length === 1 ? 'product' : 'products'}`
          : `${shown.length} of ${products.length}`}
        {products.length > 0 && (
          <>
            {' · '}
            {activeCount} active
            {outCount > 0 && <> · {outCount} out of stock</>}
          </>
        )}
      </p>

      {products.length === 0 ? (
        <div className="st-tbl-empty">
          <p>No products yet.</p>
          <button className="st-btn st-btn-primary" type="button" onClick={() => setAdding(true)}>
            + Add your first product
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="st-empty">Nothing matches those filters.</p>
      ) : (
        <div className="st-tbl-wrap">
          <table className="st-tbl">
            <thead>
              <tr>
                <th scope="col" className="st-tbl-thumbcol">
                  <span className="st-sr">Photo</span>
                </th>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col">Category</th>
                <th scope="col" className="st-tbl-num">
                  Price
                </th>
                <th scope="col" className="st-tbl-num">
                  Stock
                </th>
                <th scope="col" className="st-tbl-num">
                  Variants
                </th>
                <th scope="col">
                  <span className="st-sr">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const vs = variants.filter((v) => v.product_id === p.id);
                const qty = stockOf(p.id);
                const open = openId === p.id;
                const img = (p.image_urls ?? []).filter(Boolean)[0];
                return (
                  <Fragment key={p.id}>
                    <tr
                      className={`st-tbl-row${open ? ' is-open' : ''}`}
                      onClick={() => setOpenId(open ? null : p.id)}
                    >
                      <td className="st-tbl-thumbcol">
                        <span className="st-tbl-thumb">
                          {img ? (
                            <img src={img} alt="" loading="lazy" />
                          ) : (
                            <span aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="st-tbl-name">
                          {p.name}
                          {p.featured && <span className="st-src counter">featured</span>}
                        </span>
                        <span className="st-tbl-sub">
                          {p.brand ? `${p.brand} · ` : ''}
                          {p.slug}
                        </span>
                      </td>
                      <td>
                        <span className={`st-badge ${p.active ? 'confirmed' : 'cancelled'}`}>
                          {p.active ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="st-tbl-cat">{p.category}</td>
                      <td className="st-tbl-num st-tbl-price">{money(p.price)}</td>
                      <td className="st-tbl-num">
                        <span className={`st-tbl-stock${qty <= 0 ? ' out' : qty <= 3 ? ' low' : ''}`}>
                          {qty}
                        </span>
                      </td>
                      <td className="st-tbl-num st-tbl-muted">{vs.length}</td>
                      <td className="st-tbl-caret">{open ? '▲' : '▼'}</td>
                    </tr>

                    {open && (
                      <tr className="st-tbl-panel">
                        <td colSpan={8}>
                          <ProductEditor
                            product={p}
                            variants={vs}
                            stock={stock}
                            onSaved={load}
                            onClose={() => setOpenId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <NewProductModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------- Producto: nuevo ----------

function NewProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('wax');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [hasVariants, setHasVariants] = useState(false);
  const [initialStock, setInitialStock] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) {
      setErr('Enter a name.');
      return;
    }
    setBusy(true);
    const sb = getBrowserSupabase();
    const { data: created, error } = await sb
      .from('products')
      .insert({
        name: name.trim(),
        slug: slugify(name),
        category,
        brand: brand.trim() || null,
        price: Number(price) || 0,
        has_variants: hasVariants,
      })
      .select('id')
      .single();

    if (error || !created) {
      setBusy(false);
      setErr(
        (error as { code?: string })?.code === '23505'
          ? 'A product with that name already exists.'
          : (error?.message ?? 'Could not create the product.'),
      );
      return;
    }

    // Producto simple: el trigger ya creó la variante 'Único'. Si pusieron stock
    // inicial, se carga como un movimiento de compra (nunca update directo).
    const qty = Number(initialStock) || 0;
    if (!hasVariants && qty > 0) {
      const { data: v } = await sb
        .from('product_variants')
        .select('id')
        .eq('product_id', created.id)
        .limit(1)
        .maybeSingle();
      if (v) {
        await sb.from('inventory_moves').insert({
          variant_id: v.id,
          delta: qty,
          reason: 'purchase',
          note: 'Initial stock',
        });
      }
    }

    setBusy(false);
    onSaved();
  }

  return (
    <div
      className="st-modal"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form
        className="st-modal-card"
        onSubmit={add}
        role="dialog"
        aria-modal="true"
        aria-label="New product"
      >
        <div className="st-modal-hd">
          <h3>New product</h3>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}

        <div className="st-field">
          <label htmlFor="np-name">Name</label>
          <input
            id="np-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Surf wax tropical"
          />
          {name.trim().length >= 2 && (
            <span className="st-note">
              URL: <code>/surf-shop-tamarindo/product/{slugify(name)}</code>
            </span>
          )}
        </div>

        <div className="st-row">
          <div className="st-field">
            <label htmlFor="np-cat">Category</label>
            <select id="np-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="st-field">
            <label htmlFor="np-brand">Brand (optional)</label>
            <input id="np-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label htmlFor="np-price">Price (USD, tax included)</label>
            <input
              id="np-price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="st-field">
            <label htmlFor="np-var">Sizes / colors?</label>
            <select
              id="np-var"
              value={hasVariants ? 'yes' : 'no'}
              onChange={(e) => setHasVariants(e.target.value === 'yes')}
            >
              <option value="no">No — single variant</option>
              <option value="yes">Yes — I'll add variants</option>
            </select>
          </div>
        </div>

        <div className="st-field">
          <label htmlFor="np-stock">
            Initial stock {hasVariants ? '— set it per variant after saving' : ''}
          </label>
          <input
            id="np-stock"
            type="number"
            min={0}
            value={initialStock}
            onChange={(e) => setInitialStock(e.target.value)}
            disabled={hasVariants}
            placeholder="0"
          />
          <span className="st-note">Recorded as a stock movement, not as a silent edit.</span>
        </div>

        <div className="st-modal-actions">
          <button
            className="st-btn st-btn-ghost st-btn-sm"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="st-btn st-btn-primary st-btn-sm" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add product'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Producto: editar ----------

function ProductEditor({
  product,
  variants,
  stock,
  onSaved,
  onClose,
}: {
  product: Product;
  variants: Variant[];
  stock: Map<string, Stock>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(product);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoWarn, setPhotoWarn] = useState(false);

  useEffect(() => setForm(product), [product]);

  function set<K extends keyof Product>(k: K, v: Product[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(null);
  }

  const totalStock = variants.reduce((s, v) => s + (stock.get(v.id)?.qty_on_hand ?? 0), 0);
  const photos = (form.image_urls ?? []).filter(Boolean);

  async function save() {
    setSaving(true);
    setMsg(null);
    const { error } = await getBrowserSupabase()
      .from('products')
      .update({
        name: form.name.trim(),
        slug: slugify(form.slug || form.name),
        category: form.category,
        brand: form.brand?.trim() || null,
        description: form.description?.trim() || null,
        image_urls: photos.map((x) => x.trim()).filter(Boolean),
        price: Number(form.price) || 0,
        has_variants: form.has_variants,
        active: form.active,
        featured: form.featured,
        sort_order: Number(form.sort_order) || 0,
      })
      .eq('id', product.id);
    setSaving(false);
    if (error) {
      setMsg((error as { code?: string }).code === '23505' ? 'Duplicate slug.' : error.message);
      return;
    }
    setMsg('Saved.');
    onSaved();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoWarn(false);
    try {
      const sb = getBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `products/${product.slug}-${Date.now()}.${ext}`;
      const up = await sb.storage.from('rental-photos').upload(path, file, { upsert: false });
      if (up.error) setPhotoWarn(true);
      else {
        const url = sb.storage.from('rental-photos').getPublicUrl(path).data.publicUrl;
        set('image_urls', [...photos, url]);
      }
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
      e.target.value = '';
    }
  }

  function dropPhoto(i: number) {
    set(
      'image_urls',
      photos.filter((_, n) => n !== i),
    );
  }

  /** La primera foto es la que sale en la tienda y en el POS. */
  function makeCover(i: number) {
    if (i === 0) return;
    const next = [...photos];
    const [pick] = next.splice(i, 1);
    set('image_urls', [pick, ...next]);
  }

  async function remove() {
    if (totalStock !== 0) {
      alert(`"${product.name}" still has ${totalStock} in stock. Adjust it to 0 first.`);
      return;
    }
    if (!confirm(`Delete "${product.name}" and all its variants?`)) return;
    const { error } = await getBrowserSupabase().from('products').delete().eq('id', product.id);
    if (error) {
      alert(
        (error as { code?: string }).code === '23503'
          ? 'That product was already sold, so it cannot be deleted. Set it to inactive instead.'
          : error.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="st-ped">
      <div className="st-ped-cols">
        <section>
          <h4 className="st-ped-h">Details</h4>
          <div className="st-field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="st-field">
            <label>Slug (URL)</label>
            <input value={form.slug} onChange={(e) => set('slug', e.target.value)} />
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Category</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label>Brand (optional)</label>
              <input value={form.brand ?? ''} onChange={(e) => set('brand', e.target.value)} />
            </div>
          </div>
          <div className="st-field">
            <label>Description</label>
            <textarea
              rows={3}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </section>

        <section>
          <h4 className="st-ped-h">Pricing &amp; visibility</h4>
          <div className="st-row">
            <div className="st-field">
              <label>Price (USD, tax included)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => set('price', Number(e.target.value))}
              />
            </div>
            <div className="st-field">
              <label>Sort order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => set('sort_order', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label>Status</label>
              <select
                value={form.active ? 'yes' : 'no'}
                onChange={(e) => set('active', e.target.value === 'yes')}
              >
                <option value="yes">Active — on sale</option>
                <option value="no">Inactive — hidden</option>
              </select>
            </div>
            <div className="st-field">
              <label>Featured</label>
              <select
                value={form.featured ? 'yes' : 'no'}
                onChange={(e) => set('featured', e.target.value === 'yes')}
              >
                <option value="no">No</option>
                <option value="yes">Yes — first in the POS grid</option>
              </select>
            </div>
          </div>

          <h4 className="st-ped-h">Photos</h4>
          <div className="st-ped-photos">
            {photos.map((u, i) => (
              <span className={`st-ped-photo${i === 0 ? ' is-cover' : ''}`} key={`${u}-${i}`}>
                <img src={u} alt="" loading="lazy" />
                {i === 0 ? (
                  <em>Cover</em>
                ) : (
                  <button type="button" onClick={() => makeCover(i)} title="Use as cover">
                    Set cover
                  </button>
                )}
                <button
                  type="button"
                  className="st-ped-photo-x"
                  onClick={() => dropPhoto(i)}
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </span>
            ))}
            <label className={`st-ped-drop${photoBusy ? ' is-busy' : ''}`}>
              <input type="file" accept="image/*" onChange={onPhoto} disabled={photoBusy} />
              <span>{photoBusy ? 'Uploading…' : '+ Photo'}</span>
            </label>
          </div>
          {photoWarn && (
            <p className="st-note">Upload failed. Check the rental-photos bucket.</p>
          )}
          {photos.length === 0 && !photoBusy && (
            <p className="st-note">
              No photo yet. The shop shows a placeholder until you add one.
            </p>
          )}
        </section>
      </div>

      <VariantList product={product} variants={variants} stock={stock} onSaved={onSaved} />

      <div className="st-ped-foot">
        {msg && <span className={msg === 'Saved.' ? 'st-ped-ok' : 'st-gate-warn'}>{msg}</span>}
        <span className="st-spacer" />
        <button className="st-btn st-btn-danger st-btn-sm" type="button" onClick={remove}>
          Delete
        </button>
        <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={onClose}>
          Close
        </button>
        <button
          className="st-btn st-btn-primary st-btn-sm"
          type="button"
          disabled={saving}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ---------- Variantes ----------

function VariantList({
  product,
  variants,
  stock,
  onSaved,
}: {
  product: Product;
  variants: Variant[];
  stock: Map<string, Stock>;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addVariant(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (label.trim().length < 1) {
      setErr('Enter a label (e.g. M, L / Black).');
      return;
    }
    setBusy(true);
    const { error } = await getBrowserSupabase().from('product_variants').insert({
      product_id: product.id,
      sku: `${product.slug}-${slugify(label)}`,
      label: label.trim(),
      price_override: price === '' ? null : Number(price),
      sort_order: variants.length,
    });
    setBusy(false);
    if (error) {
      setErr(
        (error as { code?: string }).code === '23505'
          ? 'That variant already exists for this product.'
          : error.message,
      );
      return;
    }
    setLabel('');
    setPrice('');
    onSaved();
  }

  async function toggleActive(v: Variant) {
    const { error } = await getBrowserSupabase()
      .from('product_variants')
      .update({ active: !v.active })
      .eq('id', v.id);
    if (error) alert(error.message);
    else onSaved();
  }

  async function removeVariant(v: Variant) {
    const qty = stock.get(v.id)?.qty_on_hand ?? 0;
    if (qty !== 0) {
      alert(`"${v.label}" still has ${qty} in stock. Adjust it to 0 first.`);
      return;
    }
    if (!confirm(`Delete variant "${v.label}"?`)) return;
    const { error } = await getBrowserSupabase().from('product_variants').delete().eq('id', v.id);
    if (error) {
      alert(
        (error as { code?: string }).code === '23503'
          ? 'That variant was already sold, so it cannot be deleted. Set it to inactive instead.'
          : error.message,
      );
      return;
    }
    onSaved();
  }

  return (
    <div className="st-ped-vars">
      <h4 className="st-ped-h">
        Variants <span className="st-tbl-muted">({variants.length})</span>
      </h4>

      {variants.length === 0 ? (
        <p className="st-note">No variants — that should not happen. Reload the page.</p>
      ) : (
        <div className="st-tbl-wrap">
          <table className="st-tbl st-tbl-sm">
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col">SKU</th>
                <th scope="col" className="st-tbl-num">
                  Price
                </th>
                <th scope="col" className="st-tbl-num">
                  Stock
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="st-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const qty = stock.get(v.id)?.qty_on_hand ?? 0;
                return (
                  <tr key={v.id}>
                    <td>
                      <span className="st-tbl-name">{v.label}</span>
                    </td>
                    <td>
                      <span className="st-b-ref">{v.sku}</span>
                    </td>
                    <td className="st-tbl-num st-tbl-price">
                      {v.price_override != null ? money(v.price_override) : money(product.price)}
                      {v.price_override != null && <span className="st-tbl-muted"> override</span>}
                    </td>
                    <td className="st-tbl-num">
                      <span className={`st-tbl-stock${qty <= 0 ? ' out' : qty <= 3 ? ' low' : ''}`}>
                        {qty}
                      </span>
                    </td>
                    <td>
                      <span className={`st-badge ${v.active ? 'confirmed' : 'cancelled'}`}>
                        {v.active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td>
                      <span className="st-tbl-acts">
                        <button
                          className="st-btn st-btn-ghost st-btn-sm"
                          type="button"
                          onClick={() => toggleActive(v)}
                        >
                          {v.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="st-btn st-btn-danger st-btn-sm"
                          type="button"
                          onClick={() => removeVariant(v)}
                        >
                          Remove
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

      {err && <div className="st-err">{err}</div>}

      {product.has_variants ? (
        <form className="st-ped-addvar" onSubmit={addVariant}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (M, L / Black…)"
            aria-label="Variant label"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            title="Leave empty to use the product price"
            aria-label="Variant price override"
          />
          <button className="st-btn st-btn-ghost st-btn-sm" type="submit" disabled={busy}>
            {busy ? 'Adding…' : '+ Add variant'}
          </button>
        </form>
      ) : (
        <p className="st-note">
          Set <strong>Sizes / colors</strong> to <em>Yes</em> above and save to add variants.
        </p>
      )}
    </div>
  );
}
