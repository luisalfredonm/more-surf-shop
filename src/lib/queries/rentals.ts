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

// ============================================
// Catálogo público — se navega y se reserva la UNIDAD (la tabla física).
// Las specs vienen del modelo; la foto, el apodo y el slug, de la unidad.
// ============================================

export interface CatalogUnit {
  id: string;
  code: string;
  slug: string;
  nickname: string | null;
  image: string | null;
  // del modelo
  name: string;
  category: string;
  length_label: string | null;
  volume_l: number | null;
  skill_level: string;
  description: string | null;
  price_per_day: number;
  price_per_hour: number;
  width_in: number | null;
  thickness_in: number | null;
  fin_setup: string | null;
  construction: string | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  best_for: string[];
  features: string[];
  /** Si está alquilada ahora mismo, hasta cuándo (ISO). */
  busy_until: string | null;
}

const UNIT_COLS =
  'id, code, slug, nickname, photo_url, status, board_models ( name, category, length_label, volume_l, skill_level, description, image_urls, price_per_day, price_per_hour, width_in, thickness_in, fin_setup, construction, weight_min_kg, weight_max_kg, best_for, features, active, sort_order )';

function shapeUnit(u: any, busyUntil: string | null): CatalogUnit | null {
  const m = Array.isArray(u.board_models) ? u.board_models[0] : u.board_models;
  if (!m || !m.active || !u.slug) return null;
  return {
    id: u.id,
    code: u.code,
    slug: u.slug,
    nickname: u.nickname,
    image: u.photo_url ?? (Array.isArray(m.image_urls) ? (m.image_urls[0] ?? null) : null),
    name: m.name,
    category: m.category,
    length_label: m.length_label,
    volume_l: m.volume_l == null ? null : Number(m.volume_l),
    skill_level: m.skill_level,
    description: m.description,
    price_per_day: Number(m.price_per_day) || 0,
    price_per_hour: Number(m.price_per_hour) || 0,
    width_in: m.width_in == null ? null : Number(m.width_in),
    thickness_in: m.thickness_in == null ? null : Number(m.thickness_in),
    fin_setup: m.fin_setup,
    construction: m.construction,
    weight_min_kg: m.weight_min_kg,
    weight_max_kg: m.weight_max_kg,
    best_for: m.best_for ?? [],
    features: m.features ?? [],
    busy_until: busyUntil,
  };
}

/** Para cada unit_id, hasta cuándo está ocupada ahora mismo (o null). */
async function busyMap(unitIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (unitIds.length === 0) return map;
  const nowISO = new Date().toISOString();
  const { data } = await getSupabase()
    .from('rentals')
    .select('unit_id, end_at')
    .in('unit_id', unitIds)
    .in('status', ['confirmed', 'picked_up'])
    .lte('start_at', nowISO)
    .gte('end_at', nowISO);
  for (const r of data ?? []) {
    const prev = map.get(r.unit_id as string);
    if (!prev || (r.end_at as string) > prev) map.set(r.unit_id as string, r.end_at as string);
  }
  return map;
}

/** Todas las tablas alquilables (unidades disponibles de modelos activos). */
export async function getCatalogUnits(category?: string): Promise<CatalogUnit[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from('board_units')
    .select(UNIT_COLS)
    .eq('status', 'available')
    .order('code');
  if (error) {
    console.error('[getCatalogUnits]', error.message);
    return [];
  }
  const rows = (data ?? []) as any[];
  const busy = await busyMap(rows.map((u) => u.id));
  return rows
    .map((u) => shapeUnit(u, busy.get(u.id) ?? null))
    .filter((u): u is CatalogUnit => !!u && (!category || u.category === category))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Una tabla por su slug, para la página de detalle. */
export async function getCatalogUnit(slug: string): Promise<CatalogUnit | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase()
    .from('board_units')
    .select(UNIT_COLS)
    .eq('slug', slug)
    .eq('status', 'available')
    .maybeSingle();
  if (error || !data) return null;
  const busy = await busyMap([(data as any).id]);
  return shapeUnit(data, busy.get((data as any).id) ?? null);
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

export interface RentalCategory {
  slug: string;
  label: string;
  blurb: string;
  title: string; // <title>
  description: string; // meta description
  h1: string;
  intro: string;
}

export const RENTAL_CATEGORIES: RentalCategory[] = [
  {
    slug: 'softtop',
    label: 'Soft-tops',
    blurb: 'Foam boards — the safe, stable choice for learning and small days.',
    title: 'Soft-top Surfboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a soft-top surfboard in Tamarindo, Costa Rica. Stable foam boards for beginners and small days. Hourly, daily and weekly rates. Reserve online or walk in.',
    h1: 'Soft-top Surfboard Rental in Tamarindo',
    intro:
      'Foam-top boards are the stable, forgiving choice for learning and for small, mushy days. They float well, they paddle easy, and they don\'t hurt when they hit you.',
  },
  {
    slug: 'longboard',
    label: 'Longboards',
    blurb: 'Glide and paddle power. Easy waves, cruisy sessions.',
    title: 'Longboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a longboard in Tamarindo, Costa Rica. Glide, paddle power and easy wave-catching for cruisy sessions. Daily and weekly rates. Reserve online or walk in.',
    h1: 'Longboard Rental in Tamarindo',
    intro:
      'Longboards catch waves early, glide through flat sections, and turn a knee-high day into a fun one. The natural next step once you can stand up on a soft-top.',
  },
  {
    slug: 'funboard',
    label: 'Funboards',
    blurb: 'The in-between — more agile than a longboard, more forgiving than a shortboard.',
    title: 'Funboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a funboard in Tamarindo, Costa Rica. More agile than a longboard, more forgiving than a shortboard. Daily and weekly rates. Reserve online or walk in.',
    h1: 'Funboard Rental in Tamarindo',
    intro:
      'Funboards (or mid-lengths) sit between a longboard and a shortboard: enough volume to paddle into most waves, short enough to actually turn.',
  },
  {
    slug: 'shortboard',
    label: 'Shortboards',
    blurb: 'For surfers who can already catch and turn.',
    title: 'Shortboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a shortboard in Tamarindo, Costa Rica. Performance boards for surfers who can already catch and turn. Daily and weekly rates. Reserve online or walk in.',
    h1: 'Shortboard Rental in Tamarindo',
    intro:
      'Performance boards for surfers who already read the wave, catch it themselves, and want to turn. Tell us your height and weight and we\'ll match the volume.',
  },
  {
    slug: 'fish',
    label: 'Fish',
    blurb: 'Extra volume and speed for weaker or smaller waves.',
    title: 'Fish Surfboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a fish surfboard in Tamarindo, Costa Rica. Extra volume and speed for weaker, smaller waves. Daily and weekly rates. Reserve online or walk in.',
    h1: 'Fish Surfboard Rental in Tamarindo',
    intro:
      'Fish boards carry speed through slow sections and paddle easier than a standard shortboard — a good pick for Tamarindo\'s smaller, weaker days.',
  },
  {
    slug: 'sup',
    label: 'SUP',
    blurb: 'Stand-up paddle boards for flat mornings and the estuary.',
    title: 'SUP / Paddleboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent a stand-up paddleboard (SUP) in Tamarindo, Costa Rica. Flat-water mornings and the estuary. Hourly and daily rates. Reserve online or walk in.',
    h1: 'SUP & Paddleboard Rental in Tamarindo',
    intro:
      'Stand-up paddleboards for glassy mornings, the Tamarindo estuary, and cross-training on flat days.',
  },
];

export function getRentalCategory(slug: string): RentalCategory | undefined {
  return RENTAL_CATEGORIES.find((c) => c.slug === slug);
}
