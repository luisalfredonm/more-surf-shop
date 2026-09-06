import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { verifyWebhook } from '@lib/paypal';
import { sendBookingGroupEmails } from '@lib/email';

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
  const paidRow = {
    provider: 'paypal' as const,
    provider_ref: orderId,
    amount: Number(group.total_amount),
    currency: group.currency,
    status: 'paid' as const,
    paid_at: new Date().toISOString(),
    related_type: 'booking_group' as const,
    related_id: group.id,
    notes: JSON.stringify({ capture_id: resource?.id ?? null, via: 'webhook' }),
  };

  let paymentId: string | null = null;
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('related_id', group.id)
    .eq('provider', 'paypal')
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

  await supabase
    .from('bookings')
    .update({ status: 'confirmed', payment_id: paymentId })
    .eq('group_id', group.id)
    .eq('status', 'pending_payment');
  await supabase.from('booking_groups').update({ status: 'confirmed' }).eq('id', group.id);

  await sendBookingGroupEmails(group.id);
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
      await supabase
        .from('payments')
        .update({ status: 'refunded' })
        .eq('related_id', groupId)
        .eq('provider', 'paypal');
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('group_id', groupId);
      await supabase
        .from('booking_groups')
        .update({ status: 'cancelled' })
        .eq('id', groupId);
    } else if (type === 'PAYMENT.CAPTURE.DENIED' && groupId) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('related_id', groupId)
        .eq('provider', 'paypal');
    }
  } catch (e) {
    console.error('[paypal/webhook]', type, e);
  }
  return ok();
};
