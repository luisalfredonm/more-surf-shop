import type { APIRoute } from 'astro';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';
import { dayEnd, dayStart, inclusiveDays, pickRate, presetOverride, priceRental } from '@lib/rentals';

export const prerender = false;

/**
 * Cotiza una tabla para un rango de FECHAS (vía online, por días inclusivos).
 * Returns availability plus the price computed on the server.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: APIRoute = async ({ request, url }) => {
  if (!rateLimit(`rq:${clientKey(request)}`, 60, 60_000)) return tooMany();

  const unitId = url.searchParams.get('unit_id') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  if (!unitId || !DATE.test(from) || !DATE.test(to)) {
    return json({ error: 'Invalid parameters (unit_id, from, to).' }, 400);
  }
  const days = inclusiveDays(from, to);
  if (days < 1) return json({ error: 'The return date is before pickup.', code: 'bad_range' }, 400);
  if (!isSupabaseConfigured()) return json({ error: 'No disponible.', code: 'not_configured' }, 503);

  const supabase = getSupabase();

  const [{ data: unit }, { data: settings }] = await Promise.all([
    supabase
      .from('board_units')
      .select('id, status, board_models ( price_per_hour, price_per_day, active )')
      .eq('id', unitId)
      .maybeSingle(),
    supabase
      .from('rental_settings')
      .select('max_duration_days, min_lead_hours, duration_presets')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  const model = unit ? (Array.isArray(unit.board_models) ? unit.board_models[0] : unit.board_models) : null;
  if (!unit || unit.status !== 'available' || !model || !model.active) {
    return json({ error: 'That board is not available.', code: 'unit_unavailable' }, 409);
  }

  const maxDays = settings?.max_duration_days ?? 30;
  if (days > maxDays) {
    return json({ available: false, days, error: `The maximum rental is ${maxDays} days.`, code: 'too_long' });
  }

  const startAt = dayStart(from);
  const endAt = dayEnd(to);
  const minLead = settings?.min_lead_hours ?? 0;
  if (endAt.getTime() < Date.now()) {
    return json({ available: false, days, error: 'Those dates are in the past.', code: 'past' });
  }
  if (startAt.getTime() < Date.now() + minLead * 3_600_000 && minLead > 0) {
    return json({
      available: false,
      days,
      error: `Book at least ${minLead} h in advance.`,
      code: 'too_soon',
    });
  }

  const { rateType, unitsBilled } = pickRate(days);
  const override = presetOverride(settings?.duration_presets as any, rateType, unitsBilled);
  const computed = priceRental(
    Number(model.price_per_hour) || 0,
    Number(model.price_per_day) || 0,
    rateType,
    unitsBilled,
  );
  const total = override ?? computed.total;
  const unitPrice = override != null ? Math.round((override / unitsBilled) * 100) / 100 : computed.unitPrice;

  const { data: available, error: aErr } = await supabase.rpc('is_unit_available', {
    p_unit_id: unitId,
    p_from: startAt.toISOString(),
    p_to: endAt.toISOString(),
  });
  if (aErr) {
    console.error('[rentals/quote]', aErr.message);
    return json({ error: "Couldn't check availability." }, 500);
  }

  return json({
    available: !!available,
    unit_id: unitId,
    from,
    to,
    days,
    rate_type: rateType,
    units_billed: unitsBilled,
    unit_price: unitPrice,
    total,
    currency: 'USD',
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    ...(available ? {} : { error: 'That board is booked for those dates.', code: 'unit_busy' }),
  });
};
