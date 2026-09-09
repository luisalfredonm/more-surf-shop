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
  saved_at?: number; // epoch ms del último guardado
}

const KEY = 'mss-rental-cart';
const EMPTY: Cart = { from: '', to: '', items: [] };

/** Un día. El carrito es intención de compra, no una reserva: no debe vivir más. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Hoy en Costa Rica (UTC-6 todo el año), no en la zona del visitante. */
const crToday = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);

function drop(): Cart {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage bloqueado: nada que borrar */
  }
  return { ...EMPTY };
}

export function readCart(): Cart {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const c = JSON.parse(raw) as Cart;

    // Un carrito viejo seguía mandando para siempre: bloqueaba las fechas en la
    // ficha de cada tabla sin que el visitante recordara haberlo armado. Se
    // descarta por antigüedad, o si el retiro ya pasó. Sin saved_at es de una
    // versión anterior, así que también se descarta.
    const stale = typeof c.saved_at !== 'number' || Date.now() - c.saved_at > TTL_MS;
    const past = typeof c.from === 'string' && c.from !== '' && c.from < crToday();
    if (stale || past) return drop();

    return {
      from: typeof c.from === 'string' ? c.from : '',
      to: typeof c.to === 'string' ? c.to : '',
      items: Array.isArray(c.items) ? c.items.filter((i) => i && i.unit_id) : [],
      saved_at: c.saved_at,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeCart(c: Cart): Cart {
  const next: Cart = { ...c, saved_at: Date.now() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('mss-cart', { detail: c.items.length }));
  } catch {
    /* modo privado / storage bloqueado: el carrito vive solo en memoria */
  }
  return next;
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
