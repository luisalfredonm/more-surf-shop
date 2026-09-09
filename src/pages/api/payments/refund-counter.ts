import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift, round2 } from '@lib/cash';

export const prerender = false;

/**
 * Reembolso / ajuste de mostrador sobre una reserva ya cobrada (cobré de más,
 * cancelo y devuelvo, etc). Registra un `payments` con status='refunded'
 * atribuido al turno abierto. Los reembolsos en efectivo restan del efectivo
 * esperado al cerrar; los de tarjeta son informativos (los revierte el datáfono).
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  reference: z.string().trim().min(3).max(40),
  amount: z.number().positive().max(1_000_000),
  method: z.enum(['cash', 'card']),
  reason: z.string().trim().min(3).max(500),
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
  const ref = d.reference.toUpperCase();

  // ¿Es una renta o una lección?
  let relatedType: 'rental_reservation' | 'booking';
  let relatedId: string;
  let currency = 'USD';
  const { data: rnt } = await supabase
    .from('rentals')
    .select('id, currency')
    .eq('reference', ref)
    .maybeSingle();
  if (rnt) {
    relatedType = 'rental_reservation';
    relatedId = rnt.id;
    currency = rnt.currency || 'USD';
  } else {
    const { data: bk } = await supabase
      .from('bookings')
      .select('id, currency')
      .eq('reference', ref)
      .maybeSingle();
    if (!bk) return json({ error: `Reservation ${ref} not found.`, code: 'not_found' }, 404);
    relatedType = 'booking';
    relatedId = bk.id;
    currency = bk.currency || 'USD';
  }

  const shift = await getOpenShift(supabase, staff.userId);
  if (!shift) {
    return json({ error: 'Open your cash shift before recording a refund.', code: 'no_open_shift' }, 409);
  }

  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .insert({
      provider: d.method,
      amount: round2(d.amount),
      currency,
      status: 'refunded',
      paid_at: new Date().toISOString(),
      related_type: relatedType,
      related_id: relatedId,
      collected_by: staff.userId,
      shift_id: shift.id,
      notes: `Reembolso ${ref}: ${d.reason}`,
    })
    .select('id')
    .single();
  if (pErr || !pay) {
    console.error('[payments/refund-counter]', pErr?.message);
    return json({ error: 'Could not record the refund.' }, 500);
  }

  return json({ ok: true, payment_id: pay.id, reference: ref, amount: round2(d.amount), method: d.method }, 201);
};
