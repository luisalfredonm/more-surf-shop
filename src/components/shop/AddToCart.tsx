import { useState } from 'react';
import { addToShopCart } from '@lib/shop-cart';
import type { ShopProduct } from '@lib/queries/shop';
import './shop.css';

/**
 * Isla de compra en la ficha de producto: elegir variante, cantidad y agregar
 * al carrito. La disponibilidad la calculó el server (shop_variant_available),
 * así que acá sólo se respeta el tope.
 */

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export default function AddToCart({ product }: { product: ShopProduct }) {
  const sellable = product.variants.filter((v) => v.available > 0);
  const [variantId, setVariantId] = useState(sellable[0]?.variant_id ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const variant =
    product.variants.find((v) => v.variant_id === variantId) ?? sellable[0] ?? null;
  const max = variant?.available ?? 0;
  const canBuy = !!variant && max > 0;

  function add() {
    if (!variant) return;
    addToShopCart({
      variant_id: variant.variant_id,
      product_slug: product.slug,
      name: product.name,
      label: variant.label,
      image: product.image,
      price: variant.price,
      qty: Math.min(qty, max),
    });
    setAdded(true);
  }

  if (product.available <= 0) {
    return (
      <p className="sh-stock out" style={{ marginTop: '1rem' }}>
        Sold out right now. Message us and we'll tell you when it's back.
      </p>
    );
  }

  return (
    <div className="sh-buy">
      {product.variants.length > 1 && (
        <>
          <p className="sh-buy-label">Choose one</p>
          <div className="sh-variants">
            {product.variants.map((v) => (
              <button
                key={v.variant_id}
                type="button"
                className={`sh-variant ${v.available <= 0 ? 'out' : ''} ${
                  v.variant_id === variant?.variant_id ? 'on' : ''
                }`}
                disabled={v.available <= 0}
                onClick={() => {
                  setVariantId(v.variant_id);
                  setQty(1);
                  setAdded(false);
                }}
              >
                {v.label}
                {v.price !== product.price_from ? ` · ${money(v.price)}` : ''}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sh-buy-row">
        <div className="sh-qty">
          <button
            type="button"
            onClick={() => {
              setQty((q) => Math.max(1, q - 1));
              setAdded(false);
            }}
            disabled={qty <= 1}
            aria-label="One less"
          >
            −
          </button>
          <span>{qty}</span>
          <button
            type="button"
            onClick={() => {
              setQty((q) => Math.min(max, q + 1));
              setAdded(false);
            }}
            disabled={qty >= max}
            aria-label="One more"
          >
            +
          </button>
        </div>

        <button className="sh-add" type="button" disabled={!canBuy} onClick={add}>
          Add to order · {money((variant?.price ?? 0) * qty)}
        </button>
      </div>

      {added ? (
        <p className="sh-added">
          Added. <a href="/reserva-tienda">Go to your order →</a>
        </p>
      ) : (
        <p className="sh-buy-note">
          Pay online or when you pick it up. We hold it at the shop for 48 hours.
        </p>
      )}
    </div>
  );
}
