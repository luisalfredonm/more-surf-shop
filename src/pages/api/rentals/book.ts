import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { sendBookingGroupEmails } from '@lib/email';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';
import {
  dayEnd,
  dayStart,
  inclusiveDays,
  makeRentalRef,
  pickRate,
  presetOverride,
  priceRental,
} from '@lib/rentals';

export const prerender = false;

/**
 * Reserva online. El carrito comparte un único rango de fechas y puede llevar
 * varias tablas — un booking_group con N rentals. Sin waiver: se firma en el
 * mostrador al retirar.
 *
 * BYPASS temporal (RENTALS_ASSUME_ONLINE_PAID=true): mientras no hay pago online
 * real, las reservas "pagar al retirar" se marcan como PAGADAS al crearse
 * (payment provider='card', sin turno). Quitar el flag cuando entre PayPal.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const ASSUME_ONLINE_PAID = ['1', 'true', 'yes'].includes(
  String(import.meta.env.RENTALS_ASSUME_ONLINE_PAID ?? '').toLowerCase(),
);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const Schema = z.object({
  from: z.string().regex(DATE),
  to: z.string().regex(DATE),
  items: z.array(z.object({ unit_id: z.string().uuid() })).min(1).max(6),
  contact: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).nullish(),
  }),
  payment_method: z.enum(['paypal', 'on_arrival']),
  customer_note: z.string().trim().max(1000).nullish(),
  website: z.string().max(200).optional(), // honeypot
});

interface Priced {
  unit_id: string;
  model_id: string;
  name: string;
  unit_price: number;
  total: number;
}

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
      { error: 'Online rental is not live yet. Message us on WhatsApp.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();

  // --- Rango ---
  const days = inclusiveDays(d.from, d.to);
  if (days < 1) return json({ error: 'Return is before pickup.', code: 'bad_range' }, 409);

  const { data: settings } = await supabase
    .from('rental_settings')
    .select('max_duration_days, min_lead_hours, duration_presets')
    .eq('id', 1)
    .maybeSingle();
  const maxDays = settings?.max_duration_days ?? 30;
  const minLead = settings?.min_lead_hours ?? 0;

  if (days > maxDays) {
    return json({ error: `El alquiler máximo es de ${maxDays} días.`, code: 'too_long' }, 409);
  }
  const startAt = dayStart(d.from);
  const endAt = dayEnd(d.to);
  if (endAt.getTime() < Date.now()) {
    return json({ error: 'Those dates are in the past.', code: 'past' }, 409);
  }
  if (minLead > 0 && startAt.getTime() < Date.now() + minLead * 3_600_000) {
    return json({ error: `Reservá con al menos ${minLead} h de antelación.`, code: 'too_soon' }, 409);
  }

  const { rateType, unitsBilled } = pickRate(days);
  const override = presetOverride(settings?.duration_presets as any, rateType, unitsBilled);

  // --- Tasar y validar cada tabla ---
  const priced: Priced[] = [];
  const seen = new Set<string>();
  for (const item of d.items) {
    if (seen.has(item.unit_id)) continue; // misma tabla repetida en el carrito
    seen.add(item.unit_id);

    const { data: unit } = await supabase
      .from('board_units')
      .select('id, code, status, model_id, board_models ( name, price_per_hour, price_per_day, active )')
      .eq('id', item.unit_id)
      .maybeSingle();
    const model = unit ? (Array.isArray(unit.board_models) ? unit.board_models[0] : unit.board_models) : null;
    if (!unit || unit.status !== 'available' || !model || !model.active) {
      return json({ error: 'One of the boards is no longer available.', code: 'unit_unavailable' }, 409);
    }

    const computed = priceRental(
      Number(model.price_per_hour) || 0,
      Number(model.price_per_day) || 0,
      rateType,
      unitsBilled,
    );
    const total = override ?? computed.total;
    if (!(total > 0)) {
      return json(
        { error: `"${model.name}" todavía no tiene tarifa. Escribinos por WhatsApp.`, code: 'no_price' },
        409,
      );
    }

    const { data: available, error: aErr } = await supabase.rpc('is_unit_available', {
      p_unit_id: item.unit_id,
      p_from: startAt.toISOString(),
      p_to: endAt.toISOString(),
    });
    if (aErr) {
      console.error('[rentals/book] availability:', aErr.message);
      return json({ error: "Couldn't check availability." }, 500);
    }
    if (!available) {
      return json(
        { error: `"${model.name}" ya no está libre en esas fechas.`, code: 'unit_busy', unit_id: item.unit_id },
        409,
      );
    }

    priced.push({
      unit_id: item.unit_id,
      model_id: unit.model_id,
      name: model.name,
      unit_price: override != null ? Math.round((override / unitsBilled) * 100) / 100 : computed.unitPrice,
      total,
    });
  }

  const groupTotal = Math.round(priced.reduce((s, p) => s + p.total, 0) * 100) / 100;

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
      return json({ error: "Couldn't process the customer." }, 500);
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
        total_amount: groupTotal,
        currency: 'USD',
        payment_method: d.payment_method,
        status: isPaypal ? 'pending' : 'confirmed',
      })
      .select('id, reference')
      .single();
    if (gErr) {
      if ((gErr as { code?: string }).code === '23505' && attempt === 0) continue;
      console.error('[rentals/book] group:', gErr.message);
      return json({ error: "Couldn't create the reservation." }, 500);
    }
    group = g;
  }
  if (!group) return json({ error: "Couldn't create the reservation." }, 500);

  // --- Alquileres ---
  const assumePaid = !isPaypal && ASSUME_ONLINE_PAID && groupTotal > 0;
  const rows = priced.map((p) => ({
    reference: makeRentalRef('RNT'),
    group_id: group!.id,
    customer_id: customerId,
    unit_id: p.unit_id,
    model_id: p.model_id,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    rate_type: rateType,
    units_billed: unitsBilled,
    unit_price: p.unit_price,
    total_amount: p.total,
    currency: 'USD',
    status: isPaypal ? 'pending_payment' : 'confirmed',
    payment_method: assumePaid ? 'card' : d.payment_method,
    source: 'web',
    customer_note: d.customer_note ?? null,
  }));

  const { data: inserted, error: rErr } = await supabase
    .from('rentals')
    .insert(rows)
    .select('id, reference');
  if (rErr || !inserted) {
    console.error('[rentals/book] rentals:', rErr?.message);
    await supabase.from('booking_groups').delete().eq('id', group.id);
    return json({ error: "Couldn't create the reservation." }, 500);
  }

  // BYPASS: sin pago online real, marcar la reserva como pagada (un payment de
  // grupo, provider 'card', sin turno). Quitar con RENTALS_ASSUME_ONLINE_PAID.
  if (assumePaid) {
    const { data: pay } = await supabase
      .from('payments')
      .insert({
        provider: 'card',
        amount: groupTotal,
        currency: 'USD',
        status: 'paid',
        paid_at: new Date().toISOString(),
        related_type: 'booking_group',
        related_id: group.id,
        notes: 'Reserva online — pago pendiente de integración (bypass RENTALS_ASSUME_ONLINE_PAID)',
      })
      .select('id')
      .single();
    if (pay) {
      await supabase.from('rentals').update({ payment_id: pay.id }).eq('group_id', group.id);
    }
  }

  if (!isPaypal) await sendBookingGroupEmails(group.id);

  return json(
    {
      ok: true,
      group_id: group.id,
      group_reference: group.reference,
      references: inserted.map((r) => r.reference),
      boards: priced.length,
      days,
      total: groupTotal,
      currency: 'USD',
      payment_method: assumePaid ? 'card' : d.payment_method,
      confirmed: !isPaypal,
      paid: assumePaid,
      from: d.from,
      to: d.to,
    },
    201,
  );
};
