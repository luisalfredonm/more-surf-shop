import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { renderWaiverText, WAIVER_VERSION } from '@lib/waiver';

export const prerender = false;

/**
 * Entrega de una tabla reservada (rental 'confirmed' → 'picked_up').
 * Aquí firma el cliente el waiver y el staff registra la condición de salida
 * y (opcional) cobra en efectivo.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  rental_id: z.string().uuid(),
  fins_out: z.number().int().min(0).max(6),
  condition_out_photo_url: z.string().trim().max(500).nullish(),
  condition_out_notes: z.string().trim().max(1000).nullish(),
  collect_cash: z.boolean().default(false),
  waiver: z
    .object({
      signer_name: z.string().trim().min(2).max(120), // el que alquila (o el menor)
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

  const { data: rental, error: rErr } = await supabase
    .from('rentals')
    .select('id, reference, status, customer_id, total_amount, currency, payment_id')
    .eq('id', d.rental_id)
    .maybeSingle();
  if (rErr) {
    console.error('[rentals/checkout] load:', rErr.message);
    return json({ error: 'No se pudo cargar la reserva.' }, 500);
  }
  if (!rental) return json({ error: 'Esa reserva no existe.' }, 404);
  if (rental.status !== 'confirmed') {
    return json(
      { error: `La reserva está en estado "${rental.status}", no se puede entregar.`, code: 'not_reservable' },
      409,
    );
  }

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
      customer_id: rental.customer_id,
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
    console.error('[rentals/checkout] waiver:', wErr?.message);
    return json({ error: 'No se pudo guardar el waiver.' }, 500);
  }

  // --- Entrega ---
  const { error: upErr } = await supabase
    .from('rentals')
    .update({
      status: 'picked_up',
      waiver_id: waiver.id,
      fins_out: d.fins_out,
      condition_out_photo_url: d.condition_out_photo_url ?? null,
      condition_out_notes: d.condition_out_notes ?? null,
      picked_up_at: signedAtISO,
      checked_out_by: staff.userId,
    })
    .eq('id', rental.id);
  if (upErr) {
    console.error('[rentals/checkout] update:', upErr.message);
    return json({ error: 'No se pudo registrar la entrega.' }, 500);
  }

  // --- Cobro en efectivo (opcional) ---
  let collected = 0;
  const due = rental.payment_id ? 0 : Number(rental.total_amount) || 0;
  if (d.collect_cash && due > 0) {
    const { data: pay } = await supabase
      .from('payments')
      .insert({
        provider: 'cash',
        amount: due,
        currency: rental.currency || 'USD',
        status: 'paid',
        paid_at: signedAtISO,
        related_type: 'rental_reservation',
        related_id: rental.id,
      })
      .select('id')
      .single();
    if (pay) {
      collected = due;
      await supabase.from('rentals').update({ payment_id: pay.id }).eq('id', rental.id);
    }
  }

  return json({ ok: true, reference: rental.reference, collected, due }, 200);
};
