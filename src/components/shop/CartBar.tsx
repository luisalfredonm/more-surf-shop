import { useEffect, useState } from 'react';
import { readShopCart, SHOP_CART_EVENT } from '@lib/shop-cart';
import './shop.css';

/**
 * Pastilla fija abajo con el carrito. Sólo aparece si hay algo dentro, así que
 * no molesta a quien está mirando. Escucha el evento del carrito para
 * actualizarse sin recargar.
 */

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export default function CartBar() {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const sync = () => {
      const items = readShopCart();
      setCount(items.reduce((s, i) => s + i.qty, 0));
      setTotal(Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100);
    };
    sync();
    window.addEventListener(SHOP_CART_EVENT, sync);
    window.addEventListener('storage', sync); // otra pestaña
    return () => {
      window.removeEventListener(SHOP_CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (count === 0) return null;

  return (
    <a className="sh-cartbar" href="/reserva-tienda">
      <span className="sh-cartbar-count">{count}</span>
      <span>
        {count === 1 ? 'item' : 'items'} · {money(total)}
      </span>
      <strong>Checkout →</strong>
    </a>
  );
}
