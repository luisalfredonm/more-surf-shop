import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift } from '@lib/cash';

export const prerender = false;

/**
 * Cobro de mostrador para una reserva de lección o de tabla ya creada.
 * Toma el monto de la propia reserva (no confía en el cliente), exige un turno
 * de caja abierto y atribuye el pago (collected_by + shift_id). Lo usan la
 * agenda de lecciones y el alta de walk-in.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  related_type: z.enum(['booking', 'rental_reservation']),
  related_id: z.string().uuid(),
  method: z.enum(['cash', 'card']),
  notes: z.string().trim().max(500).nullish(),
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

  const table = d.related_type === 'booking' ? 'bookings' : 'rentals';
  const { data: row, error: rErr } = await supabase
    .from(table)
    .select('id, reference, total_amount, currency, payment_id')
    .eq('id', d.related_id)
    .maybeSingle();
  if (rErr) {
    console.error('[payments/counter] load:', rErr.message);
    return json({ error: 'Could not load the reservation.' }, 500);
  }
  if (!row) return json({ error: 'That reservation does not exist.' }, 404);
  if (row.payment_id) return json({ error: 'That reservation is already paid.', code: 'already_paid' }, 409);
  const amount = Number(row.total_amount) || 0;
  if (!(amount > 0)) return json({ error: 'That reservation has no amount.', code: 'no_amount' }, 409);

  const shift = await getOpenShift(supabase, staff.userId);
  if (!shift) {
    return json({ error: 'Open your cash shift before collecting payment.', code: 'no_open_shift' }, 409);
  }

  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .insert({
      provider: d.method,
      amount,
      currency: row.currency || 'USD',
      status: 'paid',
      paid_at: new Date().toISOString(),
      related_type: d.related_type,
      related_id: row.id,
      collected_by: staff.userId,
      shift_id: shift.id,
      notes: d.notes?.trim() || null,
    })
    .select('id')
    .single();
  if (pErr || !pay) {
    console.error('[payments/counter] insert:', pErr?.message);
    return json({ error: 'Could not record the payment.' }, 500);
  }

  await supabase
    .from(table)
    .update({ payment_id: pay.id, payment_method: d.method })
    .eq('id', row.id);

  return json({ ok: true, payment_id: pay.id, amount, method: d.method }, 201);
};
