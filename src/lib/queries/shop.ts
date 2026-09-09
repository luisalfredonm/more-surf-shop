import { getSupabase, isSupabaseConfigured } from '../supabase';
import type { ShopCatalogRow } from '../supabase';

/**
 * Catálogo público de la tienda.
 *
 * Se apoya en la RPC `list_shop_catalog` (security definer), que devuelve UNA
 * FILA POR VARIANTE activa de producto activo, con la disponibilidad ya
 * calculada. Acá se agrupa por producto, igual que hace el catálogo de rentals
 * con `list_available_units`.
 */

export interface ShopVariant {
  variant_id: string;
  sku: string;
  label: string;
  price: number;
  available: number;
}

export interface ShopProduct {
  product_id: string;
  slug: string;
  name: string;
  category: string;
  brand: string | null;
  description: string | null;
  image: string | null;
  images: string[];
  has_variants: boolean;
  featured: boolean;
  sort_order: number;
  variants: ShopVariant[];
  price_from: number;
  price_to: number;
  available: number; // suma de las variantes
}

function group(rows: ShopCatalogRow[]): ShopProduct[] {
  const byProduct = new Map<string, ShopProduct>();
  for (const r of rows) {
    let p = byProduct.get(r.product_id);
    if (!p) {
      const images = (r.image_urls ?? []).filter(Boolean);
      p = {
        product_id: r.product_id,
        slug: r.slug,
        name: r.name,
        category: r.category,
        brand: r.brand,
        description: r.description,
        image: images[0] ?? null,
        images,
        has_variants: r.has_variants,
        featured: r.featured,
        sort_order: r.sort_order,
        variants: [],
        price_from: Number(r.price),
        price_to: Number(r.price),
        available: 0,
      };
      byProduct.set(r.product_id, p);
    }
    const price = Number(r.price);
    p.variants.push({
      variant_id: r.variant_id,
      sku: r.sku,
      label: r.label,
      price,
      available: Number(r.available) || 0,
    });
    p.price_from = Math.min(p.price_from, price);
    p.price_to = Math.max(p.price_to, price);
    p.available += Number(r.available) || 0;
  }
  return [...byProduct.values()];
}

/** Todo el catálogo público, opcionalmente filtrado por categoría. */
export async function getShopProducts(category?: string): Promise<ShopProduct[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase().rpc('list_shop_catalog', {
    p_category: category ?? null,
  });
  if (error) {
    console.error('[getShopProducts]', error.message);
    return [];
  }
  return group((data ?? []) as ShopCatalogRow[]);
}

/** Un producto por su slug, para la ficha. */
export async function getShopProduct(slug: string): Promise<ShopProduct | null> {
  const all = await getShopProducts();
  return all.find((p) => p.slug === slug) ?? null;
}

// ============================================
// Categorías — copy de las páginas indexables
// Los slugs coinciden con el check de products.category en schema-shop.sql.
// ============================================

export interface ShopCategory {
  slug: string;
  label: string;
  blurb: string;
  title: string; // <title>
  description: string; // meta description
  h1: string;
  intro: string;
}

export const SHOP_CATEGORIES: ShopCategory[] = [
  {
    slug: 'wax',
    label: 'Surf wax',
    blurb: 'Tropical-water wax and base coats. The one thing everyone forgets.',
    title: 'Surf Wax in Tamarindo | More Surf Shop',
    description:
      'Buy surf wax in Tamarindo, Costa Rica. Tropical-water wax and base coats for warm water. Walk into our shop on Tamarindo Beach or reserve online.',
    h1: 'Surf Wax in Tamarindo',
    intro:
      'Tamarindo water sits around 28°C, so tropical wax is what holds. We stock base coats and top coats, and we keep them in the shade so they get to you hard, not melted.',
  },
  {
    slug: 'leash',
    label: 'Leashes',
    blurb: 'From 6ft comp leashes to 9ft longboard cords.',
    title: 'Surfboard Leashes in Tamarindo | More Surf Shop',
    description:
      'Surfboard leashes in Tamarindo, Costa Rica: 6ft to 9ft, comp and regular thickness. Snapped yours? Walk into our shop on Tamarindo Beach.',
    h1: 'Surfboard Leashes in Tamarindo',
    intro:
      'A leash is the part you only think about when it breaks, usually on a good day. We keep the common lengths in stock so you can be back in the water in ten minutes.',
  },
  {
    slug: 'fins',
    label: 'Fins',
    blurb: 'Thruster and quad sets, FCS and Futures compatible.',
    title: 'Surfboard Fins in Tamarindo | More Surf Shop',
    description:
      'Surfboard fins in Tamarindo, Costa Rica. Thruster and quad sets for FCS and Futures boxes. Buy at our shop on Tamarindo Beach.',
    h1: 'Surfboard Fins in Tamarindo',
    intro:
      'Lost a fin on the inside? We carry thruster and quad sets for the two boxes you actually see around here, FCS and Futures. Bring the board if you are not sure which you have.',
  },
  {
    slug: 'apparel',
    label: 'Apparel',
    blurb: 'Rash guards, boardshorts, bikinis and tees.',
    title: 'Surf Apparel in Tamarindo: Rash Guards & Boardshorts | More Surf Shop',
    description:
      'Rash guards, boardshorts, bikinis and tees in Tamarindo, Costa Rica. Sun protection that survives a week of surfing. Shop on Tamarindo Beach.',
    h1: 'Rash Guards, Boardshorts & Swimwear in Tamarindo',
    intro:
      'Eight degrees north of the equator, a rash guard is not a fashion choice. We stock long and short sleeve, plus boardshorts and bikinis that hold up to daily saltwater.',
  },
  {
    slug: 'sunscreen',
    label: 'Sunscreen',
    blurb: 'Reef-safe, high SPF, made for long sessions.',
    title: 'Reef-Safe Sunscreen in Tamarindo | More Surf Shop',
    description:
      'Reef-safe sunscreen in Tamarindo, Costa Rica. High SPF, water resistant, made for long surf sessions. Buy at our shop on Tamarindo Beach.',
    h1: 'Reef-Safe Sunscreen in Tamarindo',
    intro:
      'Only reef-safe formulas here: no oxybenzone or octinoxate. High SPF and water resistant, because a two-hour session in Guanacaste sun is not the place to find out your sunscreen washes off.',
  },
  {
    slug: 'bags',
    label: 'Bags',
    blurb: 'Dry bags, waterproof pouches and board bags for travel.',
    title: 'Dry Bags & Board Bags in Tamarindo | More Surf Shop',
    description:
      'Waterproof dry bags, phone pouches and travel board bags in Tamarindo, Costa Rica. Keep your gear dry. Shop on Tamarindo Beach.',
    h1: 'Dry Bags & Board Bags in Tamarindo',
    intro:
      'Dry bags and phone pouches for the beach, and padded board bags if you are flying your board home. Ask us about sizes before you buy a travel bag.',
  },
  {
    slug: 'accessories',
    label: 'Accessories',
    blurb: 'Hats, sunglasses, traction pads and the small stuff.',
    title: 'Surf Accessories in Tamarindo | More Surf Shop',
    description:
      'Surf accessories in Tamarindo, Costa Rica: hats, sunglasses, traction pads, ear plugs and more. Walk into our shop on Tamarindo Beach.',
    h1: 'Surf Accessories in Tamarindo',
    intro:
      'The small things that make a trip better: hats, sunglasses, traction pads, ear plugs. If you cannot find something, ask us, we probably have it behind the counter.',
  },
];

export function getShopCategory(slug: string): ShopCategory | undefined {
  return SHOP_CATEGORIES.find((c) => c.slug === slug);
}

export function shopCategoryLabel(slug: string): string {
  return getShopCategory(slug)?.label ?? slug;
}
