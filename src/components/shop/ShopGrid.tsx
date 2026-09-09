import { useMemo, useState } from 'react';
import type { ShopProduct } from '@lib/queries/shop';
import './shop.css';

/**
 * Catálogo público de accesorios. Isla React: el server ya renderizó los
 * productos (SEO) y esto sólo filtra en el cliente — con ~50 productos no hace
 * falta filtrar en SQL, igual que en el catálogo de rentals.
 *
 * `activeCategory` viene fijado en las páginas de categoría; ahí no se muestran
 * los chips (la URL ya es el filtro).
 */

const money = (n: number) => `$${Number(n).toFixed(2)}`;

interface Props {
  products: ShopProduct[];
  categories: { slug: string; label: string }[];
  activeCategory?: string;
}

export default function ShopGrid({ products, categories, activeCategory }: Props) {
  const [cat, setCat] = useState<string>(activeCategory ?? 'all');
  const [q, setQ] = useState('');

  // En una página de categoría los chips sobran: la URL ya filtró.
  const showChips = !activeCategory;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => {
        if (cat !== 'all' && p.category !== cat) return false;
        if (!needle) return true;
        return (
          p.name.toLowerCase().includes(needle) ||
          (p.brand ?? '').toLowerCase().includes(needle) ||
          (p.description ?? '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        // Sin stock al final; después destacados; después el orden del panel.
        if (a.available <= 0 !== (b.available <= 0)) return a.available <= 0 ? 1 : -1;
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
      });
  }, [products, cat, q]);

  // Sólo se ofrecen las categorías que realmente tienen producto.
  const usable = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return categories.filter((c) => present.has(c.slug));
  }, [products, categories]);

  const label = useMemo(() => {
    const bySlug = new Map(categories.map((c) => [c.slug, c.label]));
    return (slug: string) => bySlug.get(slug) ?? slug;
  }, [categories]);

  return (
    <>
      <div className="sh-bar">
        {showChips && usable.length > 1 && (
          <div className="sh-chips">
            <button
              type="button"
              className={`sh-chip ${cat === 'all' ? 'on' : ''}`}
              onClick={() => setCat('all')}
            >
              Everything
            </button>
            {usable.map((c) => (
              <button
                key={c.slug}
                type="button"
                className={`sh-chip ${cat === c.slug ? 'on' : ''}`}
                onClick={() => setCat(c.slug)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <input
          className="sh-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the shop"
          aria-label="Search the shop"
        />
        <span className="sh-count">
          {shown.length} {shown.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="sh-empty">
          Nothing matches that. Try another word, or message us — we may have it behind the counter.
        </p>
      ) : (
        <div className="sh-grid">
          {shown.map((p) => (
            <ProductCard key={p.product_id} product={p} categoryLabel={label(p.category)} />
          ))}
        </div>
      )}
    </>
  );
}

function ProductCard({
  product: p,
  categoryLabel,
}: {
  product: ShopProduct;
  categoryLabel: string;
}) {
  const out = p.available <= 0;
  const low = !out && p.available <= 3;
  const ranged = p.price_from !== p.price_to;

  return (
    <a
      className={`sh-card ${out ? 'is-out' : ''}`}
      href={`/surf-shop-tamarindo/product/${p.slug}`}
    >
      <div className="sh-card-photo">
        {p.image ? (
          <img src={p.image} alt={p.name} loading="lazy" />
        ) : (
          // Sin foto: trama + inicial fantasma + estante, para que el hueco se
          // lea intencional y no como una imagen que no cargó.
          <span className="sh-card-noimg" aria-hidden="true">
            <b>{p.name.charAt(0).toUpperCase()}</b>
            <span>{categoryLabel}</span>
          </span>
        )}
        {out ? (
          <span className="sh-flag out">Sold out</span>
        ) : low ? (
          <span className="sh-flag low">Only {p.available} left</span>
        ) : p.featured ? (
          <span className="sh-flag">Popular</span>
        ) : null}
      </div>
      <div className="sh-card-body">
        <span className="sh-card-brand">{p.brand || categoryLabel}</span>
        <span className="sh-card-name">{p.name}</span>
        {p.variants.length > 1 && (
          <span className="sh-card-opts">
            {p.variants.length} options · {p.variants.map((v) => v.label).join(', ')}
          </span>
        )}
        <span className="sh-card-foot">
          <span className="sh-card-price">
            {ranged && <small>from</small>}
            {money(p.price_from)}
          </span>
          <span className="sh-card-go" aria-hidden="true">
            {out ? 'Details' : 'Buy'} →
          </span>
        </span>
      </div>
    </a>
  );
}
