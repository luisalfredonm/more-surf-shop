import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { computeEndAt, makeRentalRef, presetOverride, priceRental } from '@lib/rentals';

export const prerender = false;

/**
 * Reserva de alquiler desde el panel (walk-in o reserva para después).
 * Crea el `rental` en estado 'confirmed' — sin waiver ni condición de salida.
 * El waiver + la foto + el cobro van en /api/rentals/checkout (la entrega).
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  unit_id: z.string().uuid(),
  start_at: z.string().datetime().optional(), // retiro previsto; default = ahora
  rate_type: z.enum(['hour', 'day', 'week']),
  units_billed: z.number().int().min(1).max(60),
  customer: z.object({
    id: z.string().uuid().optional(),
    full_name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).nullish(),
    email: z.string().trim().email().max(200).nullish(),
  }),
  customer_note: z.string().trim().max(1000).nullish(),
  staff_note: z.string().trim().max(1000).nullish(),
});

export const POST: APIRoute = async ({ request }) => {
  const staff = await requireStaff(request);
  if (!staff) return json({ error: 'unauthorized' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  if (!isSupabaseConfigured()) {
    return json({ error: 'Supabase no está configurado.', code: 'not_configured' }, 503);
  }
  const d = parsed.data;
  const supabase = getSupabase();

  // --- Unidad + modelo + tarifa ---
  const { data: unit, error: uErr } = await supabase
    .from('board_units')
    .select('id, code, status, model_id, board_models ( name, price_per_hour, price_per_day )')
    .eq('id', d.unit_id)
    .maybeSingle();
  if (uErr) {
    console.error('[rentals/create] unit:', uErr.message);
    return json({ error: 'No se pudo cargar la tabla.' }, 500);
  }
  if (!unit) return json({ error: 'Esa tabla no existe.' }, 404);
  if (unit.status !== 'available') {
    return json({ error: `La tabla está en estado "${unit.status}".`, code: 'unit_unavailable' }, 409);
  }
  const model = Array.isArray(unit.board_models) ? unit.board_models[0] : unit.board_models;
  if (!model) return json({ error: 'La tabla no tiene modelo.' }, 409);

  const startAt = d.start_at ? new Date(d.start_at) : new Date();
  const endAt = computeEndAt(startAt, d.rate_type, d.units_billed);

  // Precio: si hay un chip de duración con precio fijo, gana; si no, tarifa del modelo.
  const { data: settings } = await supabase
    .from('rental_settings')
    .select('duration_presets')
    .eq('id', 1)
    .maybeSingle();
  const override = presetOverride(settings?.duration_presets as any, d.rate_type, d.units_billed);
  const computed = priceRental(
    Number(model.price_per_hour) || 0,
    Number(model.price_per_day) || 0,
    d.rate_type,
    d.units_billed,
  );
  const total = override ?? computed.total;
  const unitPrice = override != null ? Math.round((override / d.units_billed) * 100) / 100 : computed.unitPrice;

  // --- Disponibilidad (guard de carrera) ---
  const { data: avail, error: aErr } = await supabase.rpc('is_unit_available', {
    p_unit_id: d.unit_id,
    p_from: startAt.toISOString(),
    p_to: endAt.toISOString(),
  });
  if (aErr) {
    console.error('[rentals/create] availability:', aErr.message);
    return json({ error: 'No se pudo verificar disponibilidad.' }, 500);
  }
  if (!avail) {
    return json({ error: 'Esa tabla no está libre en ese rango.', code: 'unit_busy' }, 409);
  }

  // --- Cliente (find-or-create) ---
  let customerId = d.customer.id ?? null;
  if (!customerId) {
    const email = d.customer.email?.toLowerCase() || null;
    if (email) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle();
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const { data: created, error: cErr } = await supabase
        .from('customers')
        .insert({
          full_name: d.customer.full_name,
          email: email ?? `walkin+${Date.now()}@moresurfshop.local`,
          phone: d.customer.phone ?? null,
        })
        .select('id')
        .single();
      if (cErr || !created) {
        console.error('[rentals/create] customer:', cErr?.message);
        return json({ error: 'No se pudo crear el cliente.' }, 500);
      }
      customerId = created.id;
    }
  } else {
    await supabase
      .from('customers')
      .update({ full_name: d.customer.full_name, phone: d.customer.phone ?? undefined })
      .eq('id', customerId);
  }

  // --- Grupo ---
  let group: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 2 && !group; attempt++) {
    const { data: g, error: gErr } = await supabase
      .from('booking_groups')
      .insert({
        reference: makeRentalRef('GRP'),
        customer_id: customerId,
        total_amount: total,
        currency: 'USD',
        payment_method: 'on_arrival',
        status: 'confirmed',
      })
      .select('id, reference')
      .single();
    if (gErr) {
      if ((gErr as { code?: string }).code === '23505' && attempt === 0) continue;
      console.error('[rentals/create] group:', gErr.message);
      return json({ error: 'No se pudo crear la reserva.' }, 500);
    }
    group = g;
  }
  if (!group) return json({ error: 'No se pudo crear la reserva.' }, 500);

  // --- Alquiler: reservado (confirmed). El retiro/waiver va en /checkout. ---
  const { data: rental, error: rErr } = await supabase
    .from('rentals')
    .insert({
      reference: makeRentalRef('RNT'),
      group_id: group.id,
      customer_id: customerId,
      unit_id: d.unit_id,
      model_id: unit.model_id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      rate_type: d.rate_type,
      units_billed: d.units_billed,
      unit_price: unitPrice,
      total_amount: total,
      currency: 'USD',
      status: 'confirmed',
      payment_method: 'on_arrival',
      source: 'walk_in',
      customer_note: d.customer_note ?? null,
      staff_note: d.staff_note ?? null,
    })
    .select('id, reference')
    .single();
  if (rErr || !rental) {
    console.error('[rentals/create] rental:', rErr?.message);
    await supabase.from('booking_groups').delete().eq('id', group.id);
    return json({ error: 'No se pudo crear la reserva.' }, 500);
  }

  return json(
    {
      ok: true,
      rental_id: rental.id,
      reference: rental.reference,
      group_reference: group.reference,
      total,
      currency: 'USD',
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
    },
    201,
  );
};
