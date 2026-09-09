import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift } from '@lib/cash';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  rental_id: z.string().uuid(),
  fins_in: z.number().int().min(0).max(6),
  condition_in_photo_url: z.string().trim().max(500).nullish(),
  condition_in_notes: z.string().trim().max(1000).nullish(),
  damage_reported: z.boolean().default(false),
  damage_fee: z.number().min(0).max(100_000).nullish(),
  collect_cash: z.boolean().default(false),
  payment_method: z.enum(['cash', 'card']).default('cash'),
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
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  if (!isSupabaseConfigured()) {
    return json({ error: 'Supabase is not configured.', code: 'not_configured' }, 503);
  }
  const d = parsed.data;
  const supabase = getSupabase();

  const { data: rental, error: rErr } = await supabase
    .from('rentals')
    .select('id, reference, status, total_amount, currency, payment_id')
    .eq('id', d.rental_id)
    .maybeSingle();
  if (rErr) {
    console.error('[rentals/return] load:', rErr.message);
    return json({ error: 'Could not load the rental.' }, 500);
  }
  if (!rental) return json({ error: 'That rental does not exist.' }, 404);
  if (rental.status !== 'picked_up') {
    return json({ error: `The rental is "${rental.status}".`, code: 'not_out' }, 409);
  }

  const now = new Date().toISOString();
  const damage = d.damage_reported ? Number(d.damage_fee) || 0 : 0;
  const baseDue = rental.payment_id ? 0 : Number(rental.total_amount) || 0;
  const collectNow = baseDue + damage;

  const { error: upErr } = await supabase
    .from('rentals')
    .update({
      fins_in: d.fins_in,
      condition_in_photo_url: d.condition_in_photo_url ?? null,
      condition_in_notes: d.condition_in_notes ?? null,
      damage_reported: d.damage_reported,
      damage_fee: damage || null,
      returned_at: now,
      checked_in_by: staff.userId,
      status: 'returned',
    })
    .eq('id', rental.id);
  if (upErr) {
    console.error('[rentals/return] update:', upErr.message);
    return json({ error: 'Could not close the rental.' }, 500);
  }

  let collected = 0;
  if (d.collect_cash && collectNow > 0) {
    const shift = await getOpenShift(supabase, staff.userId);
    if (!shift) {
      return json(
        { error: 'Open your cash shift before charging for the damage.', code: 'no_open_shift' },
        409,
      );
    }
    const { data: pay } = await supabase
      .from('payments')
      .insert({
        provider: d.payment_method,
        amount: collectNow,
        currency: rental.currency || 'USD',
        status: 'paid',
        paid_at: now,
        related_type: 'rental_reservation',
        related_id: rental.id,
        collected_by: staff.userId,
        shift_id: shift.id,
        notes: damage > 0 ? `includes damage ${damage.toFixed(2)}` : null,
      })
      .select('id')
      .single();
    if (pay) {
      collected = collectNow;
      if (baseDue > 0) await supabase.from('rentals').update({ payment_id: pay.id }).eq('id', rental.id);
    }
  }

  return json({ ok: true, reference: rental.reference, collected, due: collectNow }, 200);
};
