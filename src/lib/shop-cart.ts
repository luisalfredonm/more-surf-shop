/**
 * Carrito de la tienda en localStorage.
 * Módulo puro de browser: no importar desde el server.
 *
 * Guarda lo mínimo para pintar el carrito (nombre, precio, foto). El precio
 * real lo recalcula el server al crear la orden — esto es sólo para mostrar.
 */

export interface ShopCartItem {
  variant_id: string;
  product_slug: string;
  name: string; // 'Rash guard Billabong'
  label: string; // 'M' | 'Único'
  image: string | null;
  price: number;
  qty: number;
}

const KEY = 'mss-shop-cart';
export const SHOP_CART_EVENT = 'mss-shop-cart';

function emit(items: ShopCartItem[]): ShopCartItem[] {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(
      new CustomEvent(SHOP_CART_EVENT, {
        detail: items.reduce((s, i) => s + i.qty, 0),
      }),
    );
  } catch {
    /* modo privado / storage bloqueado: el carrito vive sólo en memoria */
  }
  return items;
}

export function readShopCart(): ShopCartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is ShopCartItem =>
        !!i && typeof i.variant_id === 'string' && Number(i.qty) > 0,
    );
  } catch {
    return [];
  }
}

/** Suma al carrito. Si la variante ya estaba, acumula cantidad. */
export function addToShopCart(item: ShopCartItem): ShopCartItem[] {
  const items = readShopCart();
  const i = items.findIndex((x) => x.variant_id === item.variant_id);
  if (i >= 0) items[i] = { ...items[i], qty: items[i].qty + item.qty };
  else items.push(item);
  return emit(items);
}

export function setShopCartQty(variantId: string, qty: number): ShopCartItem[] {
  const items = readShopCart()
    .map((i) => (i.variant_id === variantId ? { ...i, qty } : i))
    .filter((i) => i.qty > 0);
  return emit(items);
}

export function removeFromShopCart(variantId: string): ShopCartItem[] {
  return emit(readShopCart().filter((i) => i.variant_id !== variantId));
}

export function clearShopCart(): ShopCartItem[] {
  return emit([]);
}

export function shopCartCount(): number {
  return readShopCart().reduce((s, i) => s + i.qty, 0);
}

export function shopCartTotal(): number {
  return (
    Math.round(readShopCart().reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100
  );
}
