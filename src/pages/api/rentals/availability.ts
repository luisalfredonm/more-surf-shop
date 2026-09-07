import type { APIRoute } from 'astro';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export const GET: APIRoute = async ({ request, url }) => {
  if (!rateLimit(`rav:${clientKey(request)}`, 40, 60_000)) return tooMany();

  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const category = url.searchParams.get('category') || null;

  if (!ISO.test(from) || !ISO.test(to)) {
    return json({ error: 'Invalid from/to (ISO).' }, 400);
  }
  const fromD = new Date(from);
  const toD = new Date(to);
  if (!(fromD < toD)) return json({ error: 'Pickup must be before return.' }, 400);

  if (!isSupabaseConfigured()) {
    return json({ units: [], settings: null, dev: true });
  }

  const supabase = getSupabase();

  const [{ data: units, error }, { data: settings }] = await Promise.all([
    supabase.rpc('list_available_units', {
      p_from: fromD.toISOString(),
      p_to: toD.toISOString(),
      p_category: category,
    }),
    supabase
      .from('rental_settings')
      .select('min_duration_hours, max_duration_days, min_lead_hours, min_charge_unit, duration_presets')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  if (error) {
    console.error('[rentals/availability]', error.message);
    return json({ error: "Couldn't check availability." }, 500);
  }

  return json({
    units: (units ?? []).map((u: any) => ({
      unit_id: u.unit_id,
      code: u.code,
      model_id: u.model_id,
      model_name: u.model_name,
      slug: u.slug,
      category: u.category,
      length_label: u.length_label,
      volume_l: u.volume_l,
      skill_level: u.skill_level,
      description: u.description,
      image: u.photo_url ?? (Array.isArray(u.image_urls) ? u.image_urls[0] : null) ?? null,
      price_per_hour: Number(u.price_per_hour) || 0,
      price_per_day: Number(u.price_per_day) || 0,
    })),
    settings: settings ?? null,
  });
};
