import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { verifyWebhook, captureBreakdown } from '@lib/paypal';
import { sendBookingGroupEmails } from '@lib/email';
import { confirmGroupLines, cancelGroupLines } from '@lib/group-lines';
import { captureIdFromNotes, recordPayPalRefund } from '@lib/paypal-refund';

export const prerender = false;

const ok = () => new Response('ok', { status: 200 });

async function confirmGroup(supabase: SupabaseClient, groupId: string, resource: any): Promise<void> {
  const { data: group } = await supabase
    .from('booking_groups')
    .select('id, status, total_amount, currency')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.status !== 'pending') return;

  const value = resource?.amount?.value;
  const currency = resource?.amount?.currency_code;
  if (
    value !== Number(group.total_amount).toFixed(2) ||
    (currency && currency !== group.currency)
  ) {
    console.error('[paypal/webhook] amount mismatch', { groupId, value, currency });
    return;
  }

  const orderId = resource?.supplementary_data?.related_ids?.order_id ?? resource?.id ?? null;
  // El webhook trae el mismo seller_receivable_breakdown que la captura directa.
  const { fee, net } = captureBreakdown(resource);
  const paidRow = {
    provider: 'paypal' as const,
    provider_ref: orderId,
    amount: Number(group.total_amount),
    currency: group.currency,
    status: 'paid' as const,
    paid_at: new Date().toISOString(),
    related_type: 'booking_group' as const,
    related_id: group.id,
    fee,
    net_amount: net,
    notes: JSON.stringify({ capture_id: resource?.id ?? null, via: 'webhook' }),
  };

  let paymentId: string | null = null;
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('related_id', group.id)
    .eq('provider', 'paypal')
    .neq('status', 'refunded') // una fila de reembolso nunca se recicla como cobro
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    await supabase.from('payments').update(paidRow).eq('id', existing.id);
    paymentId = existing.id;
  } else {
    const { data: created } = await supabase.from('payments').insert(paidRow).select('id').single();
    paymentId = created?.id ?? null;
  }

  // Confirma líneas de lecciones Y de alquileres (mismo helper que capture.ts).
  await confirmGroupLines(supabase, group.id, paymentId);
  await supabase.from('booking_groups').update({ status: 'confirmed' }).eq('id', group.id);

  await sendBookingGroupEmails(group.id);
}

/**
 * Reembolso o reversión hecha desde PayPal (o el eco de uno hecho desde el
 * panel). Se registra como fila nueva; si refund.ts ya la registró, el índice
 * único la descarta. Antes se pisaban a 'refunded' TODAS las filas PayPal del
 * grupo, incluidos los intentos de checkout abandonados.
 */
async function recordRefund(
  supabase: SupabaseClient,
  relatedId: string,
  type: string,
  resource: any,
): Promise<void> {
  const { data: sale } = await supabase
    .from('payments')
    .select('related_type, amount, currency, notes')
    .eq('related_id', relatedId)
    .eq('provider', 'paypal')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sale) return;

  // REFUNDED trae el reembolso (su monto); REVERSED trae la captura entera.
  const value = Number(resource?.amount?.value);
  const amount =
    Number.isFinite(value) && value > 0 ? Math.min(value, Number(sale.amount)) : Number(sale.amount);

  await recordPayPalRefund(supabase, {
    relatedType: sale.related_type,
    relatedId,
    amount,
    currency: sale.currency,
    refundId: type === 'PAYMENT.CAPTURE.REFUNDED' ? (resource?.id ?? null) : null,
    captureId: captureIdFromNotes(sale.notes),
    staffId: null,
  });
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  const h = request.headers;

  const verified = await verifyWebhook({
    transmissionId: h.get('paypal-transmission-id') ?? '',
    transmissionTime: h.get('paypal-transmission-time') ?? '',
    transmissionSig: h.get('paypal-transmission-sig') ?? '',
    certUrl: h.get('paypal-cert-url') ?? '',
    authAlgo: h.get('paypal-auth-algo') ?? '',
    body,
  });
  if (!verified) return new Response('invalid signature', { status: 400 });

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('bad body', { status: 400 });
  }

  if (!isSupabaseConfigured()) return ok();
  const supabase = getSupabase();
  const type: string = event.event_type ?? '';
  const resource = event.resource ?? {};
  const groupId: string | undefined = resource.custom_id; // = booking_groups.id

  try {
    if (type === 'PAYMENT.CAPTURE.COMPLETED' && groupId) {
      await confirmGroup(supabase, groupId, resource);
    } else if (
      (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') &&
      groupId
    ) {
      await recordRefund(supabase, groupId, type, resource);
      await cancelGroupLines(supabase, groupId);
      await supabase
        .from('booking_groups')
        .update({ status: 'cancelled' })
        .eq('id', groupId);
    } else if (type === 'PAYMENT.CAPTURE.DENIED' && groupId) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('related_id', groupId)
        .eq('provider', 'paypal')
        .neq('status', 'refunded');
    }
  } catch (e) {
    console.error('[paypal/webhook]', type, e);
  }
  return ok();
};
