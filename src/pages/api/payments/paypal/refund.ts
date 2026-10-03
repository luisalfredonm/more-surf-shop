import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { isPayPalConfigured, refundCapture } from '@lib/paypal';
import { requireStaff } from '@lib/staff-auth';
import { cancelGroupLines } from '@lib/group-lines';
import { captureIdFromNotes, recordPayPalRefund } from '@lib/paypal-refund';

export const prerender = false;

const Schema = z.object({ group_id: z.string().uuid() });

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

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
  if (!parsed.success) return json({ error: 'Validation failed' }, 400);
  if (!(await isPayPalConfigured()) || !isSupabaseConfigured()) {
    return json({ error: 'PayPal is not configured.', code: 'not_configured' }, 503);
  }

  const supabase = getSupabase();
  const { data: group } = await supabase
    .from('booking_groups')
    .select('id, reference, status, total_amount, currency, payment_method')
    .eq('id', parsed.data.group_id)
    .maybeSingle();
  if (!group) return json({ error: 'That reservation does not exist.' }, 404);
  if (group.payment_method !== 'paypal') {
    return json({ error: 'That reservation was not paid with PayPal.', code: 'not_paypal' }, 409);
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('id, status, notes')
    .eq('related_id', group.id)
    .eq('provider', 'paypal')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) {
    return json({ error: 'No hay un pago para reembolsar.', code: 'no_payment' }, 409);
  }

  // La venta sigue 'paid' después de reembolsar: lo que dice si ya se devolvió
  // es la fila de reembolso.
  const { data: already } = await supabase
    .from('payments')
    .select('id')
    .eq('related_id', group.id)
    .eq('provider', 'paypal')
    .eq('status', 'refunded')
    .limit(1)
    .maybeSingle();
  if (already) {
    return json({ error: 'That reservation was already refunded.', code: 'already_refunded' }, 409);
  }

  const captureId = captureIdFromNotes(payment.notes);
  if (!captureId) {
    return json({ error: 'Capture ID not found. Refund it manually in PayPal.', code: 'no_capture' }, 409);
  }

  let result;
  try {
    result = await refundCapture(
      captureId,
      Number(group.total_amount).toFixed(2),
      group.currency,
    );
  } catch (e) {
    console.error('[paypal/refund]', e);
    return json({ error: 'PayPal rejected the refund.' }, 502);
  }
  if (result.status !== 'COMPLETED' && result.status !== 'PENDING') {
    return json({ error: `Reembolso no completado (${result.status}).`, code: 'not_completed' }, 409);
  }

  await recordPayPalRefund(supabase, {
    relatedType: 'booking_group',
    relatedId: group.id,
    amount: Number(group.total_amount),
    currency: group.currency,
    refundId: result.id,
    captureId,
    staffId: staff.userId,
  });
  await cancelGroupLines(supabase, group.id);
  await supabase.from('booking_groups').update({ status: 'cancelled' }).eq('id', group.id);

  return json({ ok: true, refund_id: result.id, group_reference: group.reference }, 200);
};
