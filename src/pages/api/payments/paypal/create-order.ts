import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { isPayPalConfigured, createOrder } from '@lib/paypal';

export const prerender = false;

const Schema = z.object({ group_id: z.string().uuid() });

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

  const supabase = getSupabase();
  const { data: group, error } = await supabase
    .from('booking_groups')
    .select('id, reference, status, total_amount, currency, payment_method')
    .eq('id', parsed.data.group_id)
    .maybeSingle();
  if (error) {
    console.error('[paypal/create-order] group:', error.message);
    return json({ error: "Couldn't verify the reservation" }, 500);
  }
  if (!group) return json({ error: 'That reservation does not exist.', code: 'group_missing' }, 404);
  if (group.status === 'confirmed') {
    return json({ error: 'That reservation is already paid.', code: 'already_paid' }, 409);
  }
  if (group.status !== 'pending' || group.payment_method !== 'paypal') {
    return json({ error: 'That reservation cannot be paid with PayPal.', code: 'bad_status' }, 409);
  }
  if (!(Number(group.total_amount) > 0)) {
    return json({ error: 'Invalid amount.', code: 'bad_amount' }, 409);
  }

  const [{ count: nLessons }, { count: nRentals }] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('group_id', group.id),
    supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('group_id', group.id),
  ]);
  const parts: string[] = [];
  if (nLessons) parts.push(`${nLessons} lesson(s)`);
  if (nRentals) parts.push(`${nRentals} rental(s)`);
  const description = `More Surf Shop: ${parts.join(' + ') || 'reservation'} (${group.reference})`;

  try {
    const order = await createOrder({
      amount: Number(group.total_amount),
      currency: group.currency,
      bookingId: group.id, // custom_id = group id
      reference: group.reference,
      description,
    });
    await supabase.from('payments').insert({
      provider: 'paypal',
      provider_ref: order.id,
      amount: Number(group.total_amount),
      currency: group.currency,
      status: 'pending',
      related_type: 'booking_group',
      related_id: group.id,
    });
    return json({ id: order.id }, 201);
  } catch (e) {
    console.error('[paypal/create-order]', e);
    return json({ error: "Couldn't start the payment" }, 502);
  }
};
