import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { sendBookingGroupEmails } from '@lib/email';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';
import { computeEndAt, durationDays, makeRentalRef, presetOverride, priceRental } from '@lib/rentals';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  unit_id: z.string().uuid(),
  start_at: z.string().datetime(),
  rate_type: z.enum(['hour', 'day', 'week']),
  units_billed: z.number().int().min(1).max(60),
  contact: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).nullish(),
  }),
  payment_method: z.enum(['paypal', 'on_arrival']),
  customer_note: z.string().trim().max(1000).nullish(),
  website: z.string().max(200).optional(), // honeypot
});

export const POST: APIRoute = async ({ request }) => {
  if (!rateLimit(`rbk:${clientKey(request)}`, 10, 10 * 60_000)) return tooMany();

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
  const d = parsed.data;
  if (d.website && d.website.length > 0) {
    return json({ ok: true, group_reference: 'GRP-XXXXX' }, 200); // bot
  }
  if (!isSupabaseConfigured()) {
    return json(
      { error: 'El alquiler en línea todavía no está activo. Escribinos por WhatsApp.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();

  // --- Settings: bordes de duración y antelación ---
  const { data: settings } = await supabase
    .from('rental_settings')
    .select('min_duration_hours, max_duration_days, min_lead_hours, duration_presets')
    .eq('id', 1)
    .maybeSingle();
  const minHours = settings?.min_duration_hours ?? 1;
  const maxDays = settings?.max_duration_days ?? 30;
  const minLead = settings?.min_lead_hours ?? 0;

  const startAt = new Date(d.start_at);
  const endAt = computeEndAt(startAt, d.rate_type, d.units_billed);
  const totalHours = (endAt.getTime() - startAt.getTime()) / 3_600_000;

  if (totalHours < minHours) {
    return json({ error: `El alquiler mínimo es de ${minHours} h.`, code: 'too_short' }, 409);
  }
  if (durationDays(d.rate_type, d.units_billed) > maxDays) {
    return json({ error: `El alquiler máximo es de ${maxDays} días.`, code: 'too_long' }, 409);
  }
  if (startAt.getTime() < Date.now() + minLead * 3_600_000) {
    return json(
      { error: minLead > 0 ? `Reservá con al menos ${minLead} h de antelación.` : 'El retiro ya pasó.', code: 'too_soon' },
      409,
    );
  }

  // --- Unidad + modelo ---
  const { data: unit, error: uErr } = await supabase
    .from('board_units')
    .select('id, status, model_id, board_models ( name, price_per_hour, price_per_day, active )')
    .eq('id', d.unit_id)
    .maybeSingle();
  if (uErr) {
    console.error('[rentals/book] unit:', uErr.message);
    return json({ error: 'No se pudo verificar la tabla.' }, 500);
  }
  const model = unit ? (Array.isArray(unit.board_models) ? unit.board_models[0] : unit.board_models) : null;
  if (!unit || unit.status !== 'available' || !model || !model.active) {
    return json({ error: 'Esa tabla no está disponible.', code: 'unit_unavailable' }, 409);
  }

  const override = presetOverride(settings?.duration_presets as any, d.rate_type, d.units_billed);
  const computed = priceRental(
    Number(model.price_per_hour) || 0,
    Number(model.price_per_day) || 0,
    d.rate_type,
    d.units_billed,
  );
  const total = override ?? computed.total;
  const unitPrice =
    override != null ? Math.round((override / d.units_billed) * 100) / 100 : computed.unitPrice;
  if (!(total > 0)) {
    return json({ error: 'Ese modelo todavía no tiene tarifa. Escribinos por WhatsApp.', code: 'no_price' }, 409);
  }

  // --- Disponibilidad (guard de carrera) ---
  const { data: avail, error: aErr } = await supabase.rpc('is_unit_available', {
    p_unit_id: d.unit_id,
    p_from: startAt.toISOString(),
    p_to: endAt.toISOString(),
  });
  if (aErr) {
    console.error('[rentals/book] availability:', aErr.message);
    return json({ error: 'No se pudo verificar disponibilidad.' }, 500);
  }
  if (!avail) {
    return json({ error: 'Esa tabla ya no está libre en ese rango.', code: 'unit_busy' }, 409);
  }

  // --- Cliente (find-or-create por email) ---
  const email = d.contact.email.toLowerCase();
  let customerId: string;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (existing) {
    customerId = existing.id;
    await supabase
      .from('customers')
      .update({ full_name: d.contact.full_name, phone: d.contact.phone ?? undefined })
      .eq('id', customerId);
  } else {
    const { data: created, error: cErr } = await supabase
      .from('customers')
      .insert({ full_name: d.contact.full_name, email, phone: d.contact.phone ?? null })
      .select('id')
      .single();
    if (cErr || !created) {
      console.error('[rentals/book] customer:', cErr?.message);
      return json({ error: 'No se pudo procesar el cliente.' }, 500);
    }
    customerId = created.id;
  }

  const isPaypal = d.payment_method === 'paypal';

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
        payment_method: d.payment_method,
        status: isPaypal ? 'pending' : 'confirmed',
      })
      .select('id, reference')
      .single();
    if (gErr) {
      if ((gErr as { code?: string }).code === '23505' && attempt === 0) continue;
      console.error('[rentals/book] group:', gErr.message);
      return json({ error: 'No se pudo crear la reserva.' }, 500);
    }
    group = g;
  }
  if (!group) return json({ error: 'No se pudo crear la reserva.' }, 500);

  // --- Alquiler ---
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
      status: isPaypal ? 'pending_payment' : 'confirmed',
      payment_method: d.payment_method,
      source: 'web',
      customer_note: d.customer_note ?? null,
    })
    .select('id, reference')
    .single();
  if (rErr || !rental) {
    console.error('[rentals/book] rental:', rErr?.message);
    await supabase.from('booking_groups').delete().eq('id', group.id);
    return json({ error: 'No se pudo crear la reserva.' }, 500);
  }

  if (!isPaypal) {
    await sendBookingGroupEmails(group.id);
  }

  return json(
    {
      ok: true,
      group_id: group.id,
      group_reference: group.reference,
      rental_reference: rental.reference,
      total,
      currency: 'USD',
      payment_method: d.payment_method,
      confirmed: !isPaypal,
      end_at: endAt.toISOString(),
    },
    201,
  );
};
