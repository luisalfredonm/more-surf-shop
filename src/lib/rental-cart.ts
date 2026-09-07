/**
 * Carrito de alquiler en localStorage. Las fechas son del carrito completo
 * (un solo rango para todas las tablas), como en el checkout.
 * Módulo puro de browser: no importar desde el server.
 */

export interface CartItem {
  unit_id: string;
  slug: string;
  name: string;
  code: string;
  image: string | null;
  price_per_day: number;
}

export interface Cart {
  from: string; // YYYY-MM-DD
  to: string;
  items: CartItem[];
}

const KEY = 'mss-rental-cart';
const EMPTY: Cart = { from: '', to: '', items: [] };

export function readCart(): Cart {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const c = JSON.parse(raw) as Cart;
    return {
      from: typeof c.from === 'string' ? c.from : '',
      to: typeof c.to === 'string' ? c.to : '',
      items: Array.isArray(c.items) ? c.items.filter((i) => i && i.unit_id) : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeCart(c: Cart): Cart {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
    window.dispatchEvent(new CustomEvent('mss-cart', { detail: c.items.length }));
  } catch {
    /* modo privado / storage bloqueado: el carrito vive solo en memoria */
  }
  return c;
}

export function addToCart(item: CartItem, from: string, to: string): Cart {
  const c = readCart();
  // Nunca se pierden tablas: se conservan las que ya estaban (sin duplicar) y
  // el rango se reencuadra al nuevo. El checkout recotiza cada línea al cargar.
  const next: Cart = {
    from,
    to,
    items: [...c.items.filter((i) => i.unit_id !== item.unit_id), item],
  };
  return writeCart(next);
}

export function removeFromCart(unitId: string): Cart {
  const c = readCart();
  return writeCart({ ...c, items: c.items.filter((i) => i.unit_id !== unitId) });
}

export function setCartDates(from: string, to: string): Cart {
  const c = readCart();
  return writeCart({ ...c, from, to });
}

export function clearCart(): Cart {
  return writeCart({ ...EMPTY });
}

export function cartCount(): number {
  return readCart().items.length;
}
