import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { renderWaiverText, WAIVER_VERSION } from '@lib/waiver';
import { computeEndAt, makeRentalRef, priceRental } from '@lib/rentals';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  unit_id: z.string().uuid(),
  start_at: z.string().datetime().optional(),
  rate_type: z.enum(['hour', 'day', 'week']),
  units_billed: z.number().int().min(1).max(60),
  customer: z.object({
    id: z.string().uuid().optional(),
    full_name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).nullish(),
    email: z.string().trim().email().max(200).nullish(),
  }),
  payment: z.enum(['cash', 'on_return']),
  fins_out: z.number().int().min(0).max(6),
  condition_out_photo_url: z.string().trim().max(500).nullish(),
  condition_out_notes: z.string().trim().max(1000).nullish(),
  waiver: z
    .object({
      signer_name: z.string().trim().min(2).max(120),
      is_minor: z.boolean(),
      guardian_name: z.string().trim().min(2).max(120).nullish(),
      emergency_contact_name: z.string().trim().max(120).nullish(),
      emergency_contact_phone: z.string().trim().max(40).nullish(),
      accepted_terms: z.literal(true),
      signature_svg: z.string().max(200_000).nullish(),
    })
    .refine((w) => !w.is_minor || (w.guardian_name?.length ?? 0) >= 2, {
      message: 'guardian_name required for a minor',
      path: ['guardian_name'],
    }),
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
  const { unitPrice, total } = priceRental(
    Number(model.price_per_hour) || 0,
    Number(model.price_per_day) || 0,
    d.rate_type,
    d.units_billed,
  );

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

  // --- Cliente ---
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
      .update({
        full_name: d.customer.full_name,
        phone: d.customer.phone ?? undefined,
      })
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

  // --- Waiver ---
  const w = d.waiver;
  const signerName = w.is_minor ? (w.guardian_name as string) : w.signer_name;
  const signedAtISO = new Date().toISOString();
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null;
  const snapshot = renderWaiverText({
    activity: 'surfboard rental',
    signerName,
    signedAtISO,
    isMinor: w.is_minor,
    guardianName: w.is_minor ? (w.guardian_name as string) : null,
    minorName: w.is_minor ? w.signer_name : null,
  });
  const { data: waiver, error: wErr } = await supabase
    .from('waivers')
    .insert({
      customer_id: customerId,
      waiver_version: WAIVER_VERSION,
      activity: 'rental',
      signed_at: signedAtISO,
      signer_name_typed: signerName,
      accepted_terms: true,
      is_minor: w.is_minor,
      guardian_name: w.is_minor ? (w.guardian_name as string) : null,
      ip,
      user_agent: request.headers.get('user-agent')?.slice(0, 400) ?? null,
      rendered_text_snapshot: snapshot,
      signature_svg: w.signature_svg ?? null,
      lang: 'en',
    })
    .select('id')
    .single();
  if (wErr || !waiver) {
    console.error('[rentals/create] waiver:', wErr?.message);
    return json({ error: 'No se pudo guardar el waiver.' }, 500);
  }

  // --- Alquiler (sale de una: picked_up) ---
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
      status: 'picked_up',
      payment_method: d.payment === 'cash' ? 'cash' : 'on_arrival',
      waiver_id: waiver.id,
      source: 'walk_in',
      fins_out: d.fins_out,
      condition_out_photo_url: d.condition_out_photo_url ?? null,
      condition_out_notes: d.condition_out_notes ?? null,
      picked_up_at: signedAtISO,
      checked_out_by: staff.userId,
      staff_note: d.staff_note ?? null,
    })
    .select('id, reference')
    .single();
  if (rErr || !rental) {
    console.error('[rentals/create] rental:', rErr?.message);
    return json({ error: 'No se pudo crear el alquiler.' }, 500);
  }

  // --- Pago en efectivo cobrado ahora ---
  if (d.payment === 'cash') {
    const { data: pay } = await supabase
      .from('payments')
      .insert({
        provider: 'cash',
        amount: total,
        currency: 'USD',
        status: 'paid',
        paid_at: signedAtISO,
        related_type: 'rental_reservation',
        related_id: rental.id,
      })
      .select('id')
      .single();
    if (pay) await supabase.from('rentals').update({ payment_id: pay.id }).eq('id', rental.id);
  }

  return json(
    {
      ok: true,
      rental_id: rental.id,
      reference: rental.reference,
      group_reference: group.reference,
      total,
      currency: 'USD',
      end_at: endAt.toISOString(),
    },
    201,
  );
};
