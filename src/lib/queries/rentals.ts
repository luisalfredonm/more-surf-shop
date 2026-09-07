import { getSupabase, isSupabaseConfigured, type DbBoardModel } from '../supabase';

/**
 * Modelos de tabla activos para las páginas públicas de rental.
 * Sin fallback ficticio: si no hay flota cargada, la página muestra el
 * handoff a WhatsApp.
 */

export type PublicBoardModel = Pick<
  DbBoardModel,
  | 'id'
  | 'name'
  | 'slug'
  | 'category'
  | 'length_label'
  | 'volume_l'
  | 'skill_level'
  | 'description'
  | 'image_urls'
  | 'price_per_hour'
  | 'price_per_day'
  | 'featured'
> & { unit_count: number };

const COLS =
  'id, name, slug, category, length_label, volume_l, skill_level, description, image_urls, price_per_hour, price_per_day, featured, sort_order, board_units(count)';

function shape(rows: any[]): PublicBoardModel[] {
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    category: m.category,
    length_label: m.length_label,
    volume_l: m.volume_l,
    skill_level: m.skill_level,
    description: m.description,
    image_urls: m.image_urls ?? [],
    price_per_hour: Number(m.price_per_hour) || 0,
    price_per_day: Number(m.price_per_day) || 0,
    featured: !!m.featured,
    unit_count: Array.isArray(m.board_units) ? (m.board_units[0]?.count ?? 0) : 0,
  }));
}

export async function getBoardModels(category?: string): Promise<PublicBoardModel[]> {
  if (!isSupabaseConfigured()) return [];
  let q = getSupabase()
    .from('board_models')
    .select(COLS)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) {
    console.error('[getBoardModels]', error.message);
    return [];
  }
  return shape(data ?? []).filter((m) => m.unit_count > 0);
}

export const RENTAL_CATEGORIES: { slug: string; label: string; blurb: string }[] = [
  { slug: 'softtop', label: 'Soft-tops', blurb: 'Foam boards — the safe, stable choice for learning and small days.' },
  { slug: 'longboard', label: 'Longboards', blurb: 'Glide and paddle power. Easy waves, cruisy sessions.' },
  { slug: 'funboard', label: 'Funboards', blurb: 'The in-between — more agile than a longboard, more forgiving than a shortboard.' },
  { slug: 'shortboard', label: 'Shortboards', blurb: 'For surfers who can already catch and turn.' },
  { slug: 'fish', label: 'Fish', blurb: 'Extra volume and speed for weaker or smaller waves.' },
  { slug: 'sup', label: 'SUP', blurb: 'Stand-up paddle boards for flat mornings and the estuary.' },
];
