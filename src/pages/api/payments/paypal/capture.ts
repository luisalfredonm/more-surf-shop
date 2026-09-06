import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { isPayPalConfigured, captureOrder } from '@lib/paypal';
import { sendBookingGroupEmails } from '@lib/email';

export const prerender = false;

const Schema = z.object({
  order_id: z.string().min(1).max(64),
  group_id: z.string().uuid(),
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
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
  if (!isPayPalConfigured() || !isSupabaseConfigured()) {
    return json({ error: 'El pago en línea todavía no está disponible.', code: 'not_configured' }, 503);
  }
  const { order_id, group_id } = parsed.data;

  const supabase = getSupabase();
  const { data: group, error } = await supabase
    .from('booking_groups')
    .select('id, reference, status, total_amount, currency')
    .eq('id', group_id)
    .maybeSingle();
  if (error) {
    console.error('[paypal/capture] group:', error.message);
    return json({ error: 'No se pudo verificar la reserva' }, 500);
  }
  if (!group) return json({ error: 'Esa reserva no existe.', code: 'group_missing' }, 404);
  if (group.status === 'confirmed') {
    return json({ ok: true, already: true, group_reference: group.reference }, 200);
  }
  if (group.status !== 'pending') {
    return json({ error: 'Esa reserva no admite pago.', code: 'bad_status' }, 409);
  }

  let cap;
  try {
    cap = await captureOrder(order_id);
  } catch (e) {
    console.error('[paypal/capture]', e);
    return json({ error: 'No se pudo capturar el pago' }, 502);
  }
  if (cap.status !== 'COMPLETED') {
    return json({ error: 'El pago no se completó.', code: 'not_completed', status: cap.status }, 409);
  }

  const expected = Number(group.total_amount).toFixed(2);
  if (cap.amount !== expected || (cap.currency && cap.currency !== group.currency)) {
    console.error('[paypal/capture] amount mismatch', { expected, got: cap.amount, cur: cap.currency });
    return json(
      { error: 'El monto pagado no coincide. Escribinos por WhatsApp.', code: 'amount_mismatch' },
      409,
    );
  }

  const paidRow = {
    provider: 'paypal' as const,
    provider_ref: order_id,
    amount: Number(group.total_amount),
    currency: group.currency,
    status: 'paid' as const,
    paid_at: new Date().toISOString(),
    related_type: 'booking_group' as const,
    related_id: group.id,
    notes: JSON.stringify({ capture_id: cap.captureId, payer_email: cap.payerEmail }),
  };

  let paymentId: string | null = null;
  const { data: existingPay } = await supabase
    .from('payments')
    .select('id')
    .eq('provider_ref', order_id)
    .eq('related_id', group.id)
    .maybeSingle();
  if (existingPay) {
    await supabase.from('payments').update(paidRow).eq('id', existingPay.id);
    paymentId = existingPay.id;
  } else {
    const { data: newPay } = await supabase.from('payments').insert(paidRow).select('id').single();
    paymentId = newPay?.id ?? null;
  }

  await supabase
    .from('bookings')
    .update({ status: 'confirmed', payment_id: paymentId })
    .eq('group_id', group.id)
    .eq('status', 'pending_payment');

  await supabase.from('booking_groups').update({ status: 'confirmed' }).eq('id', group.id);

  await sendBookingGroupEmails(group.id);

  return json({ ok: true, group_reference: group.reference }, 200);
};
