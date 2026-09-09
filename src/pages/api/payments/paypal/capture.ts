import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { isPayPalConfigured, captureOrder } from '@lib/paypal';
import { sendBookingGroupEmails } from '@lib/email';
import { confirmGroupLines } from '@lib/group-lines';

export const prerender = false;

/**
 * `order_id` es el id de la orden de PAYPAL. Lo que se está pagando es o bien
 * un booking_group (lecciones / tablas) o bien una orden de la tienda.
 */
const Schema = z
  .object({
    order_id: z.string().min(1).max(64),
    group_id: z.string().uuid().optional(),
    shop_order_id: z.string().uuid().optional(),
  })
  .refine((d) => !!d.group_id !== !!d.shop_order_id, {
    message: 'Send either group_id or shop_order_id',
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
  if (!(await isPayPalConfigured()) || !isSupabaseConfigured()) {
    return json({ error: 'Online payment is not available yet.', code: 'not_configured' }, 503);
  }
  const { order_id, group_id, shop_order_id } = parsed.data;

  const supabase = getSupabase();

  // --- Tienda: orden de accesorios ---
  if (shop_order_id) {
    return captureShopOrder(supabase, order_id, shop_order_id);
  }

  const { data: group, error } = await supabase
    .from('booking_groups')
    .select('id, reference, status, total_amount, currency')
    .eq('id', group_id!)
    .maybeSingle();
  if (error) {
    console.error('[paypal/capture] group:', error.message);
    return json({ error: "Couldn't verify the reservation" }, 500);
  }
  if (!group) return json({ error: 'That reservation does not exist.', code: 'group_missing' }, 404);
  if (group.status === 'confirmed') {
    return json({ ok: true, already: true, group_reference: group.reference }, 200);
  }
  if (group.status !== 'pending') {
    return json({ error: 'That reservation cannot be paid.', code: 'bad_status' }, 409);
  }

  let cap;
  try {
    cap = await captureOrder(order_id);
  } catch (e) {
    console.error('[paypal/capture]', e);
    return json({ error: "Couldn't capture the payment" }, 502);
  }
  if (cap.status !== 'COMPLETED') {
    return json({ error: 'The payment did not complete.', code: 'not_completed', status: cap.status }, 409);
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
    // PayPal deposita neto: sin esto el banco nunca cuadra contra las ventas.
    fee: cap.fee,
    net_amount: cap.net,
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

  await confirmGroupLines(supabase, group.id, paymentId);

  await supabase.from('booking_groups').update({ status: 'confirmed' }).eq('id', group.id);

  await sendBookingGroupEmails(group.id);

  return json({ ok: true, group_reference: group.reference }, 200);
};

/**
 * Captura de una orden de la tienda. La orden pasa a 'paid': el stock queda
 * comprometido (shop_variant_available ya no la cuenta como disponible) pero
 * `qty_on_hand` NO baja hasta que el cliente retira. Ver ETAPA-3-SHOP §8.1.
 */
async function captureShopOrder(
  supabase: ReturnType<typeof getSupabase>,
  paypalOrderId: string,
  shopOrderId: string,
): Promise<Response> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, reference, status, total, currency')
    .eq('id', shopOrderId)
    .maybeSingle();
  if (error) {
    console.error('[paypal/capture] shop order:', error.message);
    return json({ error: "Couldn't verify the order" }, 500);
  }
  if (!order) return json({ error: 'That order does not exist.', code: 'order_missing' }, 404);
  if (order.status === 'paid' || order.status === 'picked_up') {
    return json({ ok: true, already: true, reference: order.reference }, 200);
  }
  if (order.status !== 'pending_payment') {
    return json({ error: 'That order cannot be paid.', code: 'bad_status' }, 409);
  }

  let cap;
  try {
    cap = await captureOrder(paypalOrderId);
  } catch (e) {
    console.error('[paypal/capture] shop:', e);
    return json({ error: "Couldn't capture the payment" }, 502);
  }
  if (cap.status !== 'COMPLETED') {
    return json(
      { error: 'The payment did not complete.', code: 'not_completed', status: cap.status },
      409,
    );
  }

  const expected = Number(order.total).toFixed(2);
  if (cap.amount !== expected || (cap.currency && cap.currency !== order.currency)) {
    console.error('[paypal/capture] shop amount mismatch', {
      expected,
      got: cap.amount,
      cur: cap.currency,
    });
    return json(
      { error: 'The amount paid does not match. Message us on WhatsApp.', code: 'amount_mismatch' },
      409,
    );
  }

  const paidRow = {
    provider: 'paypal' as const,
    provider_ref: paypalOrderId,
    amount: Number(order.total),
    currency: order.currency,
    status: 'paid' as const,
    paid_at: new Date().toISOString(),
    related_type: 'order' as const,
    related_id: order.id,
    fee: cap.fee,
    net_amount: cap.net,
    notes: JSON.stringify({ capture_id: cap.captureId, payer_email: cap.payerEmail }),
  };

  const { data: existingPay } = await supabase
    .from('payments')
    .select('id')
    .eq('provider_ref', paypalOrderId)
    .eq('related_id', order.id)
    .maybeSingle();
  if (existingPay) {
    await supabase.from('payments').update(paidRow).eq('id', existingPay.id);
  } else {
    await supabase.from('payments').insert(paidRow);
  }

  await supabase.from('orders').update({ status: 'paid' }).eq('id', order.id);

  return json({ ok: true, reference: order.reference }, 200);
}
