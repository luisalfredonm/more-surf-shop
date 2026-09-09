import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

/**
 * Shop → Products. CRUD de productos y sus variantes.
 * El stock se ve acá de sólo lectura; se mueve en Shop → Inventory
 * (toda variación pasa por inventory_moves).
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

export default function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stock, setStock] = useState<Map<string, Stock>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

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

  if (loading) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Prices include tax and are what the customer pays. Every product has at least one
        variant — a simple product gets an automatic <code>Único</code>. Stock is managed in
        Inventory.
      </p>

      <NewProductForm onSaved={load} />

      {products.length === 0 ? (
        <p className="st-empty">No products yet.</p>
      ) : (
        products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            variants={variants.filter((v) => v.product_id === p.id)}
            stock={stock}
            open={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            onSaved={load}
          />
        ))
      )}
    </div>
  );
}

// ---------- Producto: nuevo ----------

function NewProductForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('wax');
  const [price, setPrice] = useState('');
  const [hasVariants, setHasVariants] = useState(false);
  const [initialStock, setInitialStock] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setName('');
    setPrice('');
    setInitialStock('');
    onSaved();
  }

  return (
    <form className="st-card" onSubmit={add}>
      {err && <div className="st-err">{err}</div>}
      <div className="st-row">
        <div className="st-field">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Surf wax tropical"
          />
        </div>
        <div className="st-field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label>Price (USD, tax included)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="st-field">
          <label>Sizes / colors?</label>
          <select
            value={hasVariants ? 'yes' : 'no'}
            onChange={(e) => setHasVariants(e.target.value === 'yes')}
          >
            <option value="no">No — single variant</option>
            <option value="yes">Yes — I'll add variants</option>
          </select>
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label>Initial stock {hasVariants ? '(set it per variant)' : ''}</label>
          <input
            type="number"
            min={0}
            value={initialStock}
            onChange={(e) => setInitialStock(e.target.value)}
            disabled={hasVariants}
            placeholder="0"
          />
        </div>
        <div className="st-field" style={{ justifyContent: 'flex-end' }}>
          <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : '+ Add product'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------- Producto: editar ----------

function ProductCard({
  product,
  variants,
  stock,
  open,
  onToggle,
  onSaved,
}: {
  product: Product;
  variants: Variant[];
  stock: Map<string, Stock>;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
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

  const totalStock = variants.reduce(
    (s, v) => s + (stock.get(v.id)?.qty_on_hand ?? 0),
    0,
  );

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
        image_urls: (form.image_urls ?? []).map((x) => x.trim()).filter(Boolean),
        price: Number(form.price) || 0,
        has_variants: form.has_variants,
        active: form.active,
        featured: form.featured,
        sort_order: Number(form.sort_order) || 0,
      })
      .eq('id', product.id);
    setSaving(false);
    if (error) {
      setMsg(
        (error as { code?: string }).code === '23505' ? 'Duplicate slug.' : error.message,
      );
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
        set('image_urls', [...(form.image_urls ?? []), url]);
      }
    } catch {
      setPhotoWarn(true);
    } finally {
      setPhotoBusy(false);
    }
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
    <div className="st-card">
      <button type="button" className="st-svc-head" onClick={onToggle} aria-expanded={open}>
        <span className={`st-dot ${form.active ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="st-svc-title">{form.name}</span>
        <span className="st-svc-sum">
          {form.category} · {money(form.price)} ·{' '}
          {variants.length} {variants.length === 1 ? 'variant' : 'variants'} ·{' '}
          <strong className={totalStock <= 0 ? 'st-gate-warn' : ''}>{totalStock}</strong> in stock
        </span>
        {form.featured && <span className="st-svc-badge">featured</span>}
        <span className="st-svc-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="st-svc-form">
          <div className="st-row">
            <div className="st-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="st-field">
              <label>Slug (URL)</label>
              <input value={form.slug} onChange={(e) => set('slug', e.target.value)} />
            </div>
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
              <label>Order</label>
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
          <div className="st-field">
            <label>Description</label>
            <textarea
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="st-field">
            <label>Photos</label>
            <input type="file" accept="image/*" onChange={onPhoto} disabled={photoBusy} />
            {photoBusy && <span className="st-note">Uploading…</span>}
            {photoWarn && (
              <span className="st-note">Upload failed. Check the rental-photos bucket.</span>
            )}
            <textarea
              rows={2}
              value={(form.image_urls ?? []).join('\n')}
              onChange={(e) => set('image_urls', e.target.value.split('\n'))}
              placeholder="One URL per line"
            />
            {(form.image_urls ?? []).filter(Boolean).length > 0 && (
              <div className="st-inline" style={{ marginTop: '0.4rem', flexWrap: 'wrap' }}>
                {(form.image_urls ?? []).filter(Boolean).map((u, i) => (
                  <img
                    key={i}
                    src={u}
                    alt=""
                    style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6 }}
                  />
                ))}
              </div>
            )}
          </div>

          {msg && (
            <div className="st-note" style={{ marginBottom: '0.5rem' }}>
              {msg}
            </div>
          )}
          <div className="st-actions">
            <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="st-btn st-btn-danger st-btn-sm" type="button" onClick={remove}>
              Delete product
            </button>
          </div>

          <VariantList
            product={product}
            variants={variants}
            stock={stock}
            onSaved={onSaved}
          />
        </div>
      )}
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
    const { error } = await getBrowserSupabase()
      .from('product_variants')
      .delete()
      .eq('id', v.id);
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
    <div className="st-field" style={{ marginTop: '1rem' }}>
      <label>Variants</label>

      {variants.length === 0 ? (
        <p className="st-note">No variants — that should not happen. Reload the page.</p>
      ) : (
        variants.map((v) => {
          const qty = stock.get(v.id)?.qty_on_hand ?? 0;
          return (
            <div className="st-slotlist-row" key={v.id}>
              <strong style={{ minWidth: '5rem' }}>{v.label}</strong>
              <span className="st-b-ref">{v.sku}</span>
              <span className="st-note">
                {v.price_override != null ? money(v.price_override) : money(product.price)}
                {v.price_override != null ? ' (override)' : ''}
              </span>
              <span className={qty <= 0 ? 'st-gate-warn' : 'st-note'}>{qty} in stock</span>
              <span className="st-spacer" />
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
            </div>
          );
        })
      )}

      {err && <div className="st-err">{err}</div>}

      {product.has_variants ? (
        <form className="st-slotlist-row" onSubmit={addVariant} style={{ marginTop: '0.4rem' }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (M, L / Black…)"
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            title="Leave empty to use the product price"
            style={{ width: '6rem' }}
          />
          <button className="st-btn st-btn-ghost st-btn-sm" type="submit" disabled={busy}>
            {busy ? 'Adding…' : '+ Add variant'}
          </button>
        </form>
      ) : (
        <p className="st-note" style={{ marginTop: '0.4rem' }}>
          Set <strong>Sizes / colors</strong> to <em>Yes</em> above and save to add variants.
        </p>
      )}
    </div>
  );
}
