import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { isPayPalConfigured, createOrder } from '@lib/paypal';

export const prerender = false;

const Schema = z.object({ booking_id: z.string().uuid() });

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
    return json(
      { error: 'El pago en línea todavía no está disponible.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'id, reference, status, total_amount, currency, waiver_id, class_type_id, slot_date, start_time',
    )
    .eq('id', parsed.data.booking_id)
    .maybeSingle();
  if (error) {
    console.error('[paypal/create-order] booking:', error.message);
    return json({ error: 'No se pudo verificar la reserva' }, 500);
  }
  if (!booking) return json({ error: 'Esa reserva no existe.', code: 'booking_missing' }, 404);
  if (booking.status === 'confirmed') {
    return json({ error: 'Esa reserva ya está pagada.', code: 'already_paid' }, 409);
  }
  if (booking.status !== 'pending_payment') {
    return json({ error: 'Esa reserva no admite pago.', code: 'bad_status' }, 409);
  }
  if (!booking.waiver_id) {
    return json({ error: 'Primero hay que firmar el waiver.', code: 'no_waiver' }, 409);
  }
  if (!(Number(booking.total_amount) > 0)) {
    return json({ error: 'Monto inválido.', code: 'bad_amount' }, 409);
  }

  const { data: ct } = await supabase
    .from('class_types')
    .select('name')
    .eq('id', booking.class_type_id)
    .maybeSingle();
  const description = `${ct?.name ?? 'Surf lesson'} — ${booking.slot_date} ${String(
    booking.start_time,
  ).slice(0, 5)} (${booking.reference})`;

  try {
    const order = await createOrder({
      amount: Number(booking.total_amount),
      currency: booking.currency,
      bookingId: booking.id,
      reference: booking.reference,
      description,
    });
    // Registrar el intento de pago (se completa en /capture o por webhook).
    await supabase.from('payments').insert({
      provider: 'paypal',
      provider_ref: order.id,
      amount: Number(booking.total_amount),
      currency: booking.currency,
      status: 'pending',
      related_type: 'booking',
      related_id: booking.id,
    });
    return json({ id: order.id }, 201);
  } catch (e) {
    console.error('[paypal/create-order]', e);
    return json({ error: 'No se pudo iniciar el pago' }, 502);
  }
};
