import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift } from '@lib/cash';

export const prerender = false;

/**
 * Venta de mostrador (POS).
 *
 * Todo el trabajo lo hace la RPC `create_pos_sale`, que corre en UNA transacción:
 * orden + líneas + salida de stock + pagos. Si algo falla, no queda una venta a
 * medias (cobrada sin descontar, o descontada sin cobrar).
 *
 * Los precios los pone el server (los lee de la variante): el cliente sólo manda
 * qué variante y cuántas. Exige turno de caja abierto, y estampa collected_by +
 * shift_id en cada pago, así la venta entra al cierre sin tocar el módulo de caja.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  items: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(999),
        discount: z.number().min(0).max(100_000).nullish(),
      }),
    )
    .min(1)
    .max(50),
  payments: z
    .array(
      z.object({
        method: z.enum(['cash', 'card']),
        amount: z.number().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(3),
  customer_id: z.string().uuid().nullish(),
  staff_note: z.string().trim().max(500).nullish(),
});

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRef(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

/** Traduce las excepciones de la RPC a algo que el mostrador entienda. */
function mapRpcError(message: string): { error: string; code: string; status: number } {
  if (message.includes('payment_mismatch')) {
    return {
      error: 'What was collected does not match the total. Nothing was saved.',
      code: 'payment_mismatch',
      status: 409,
    };
  }
  if (message.includes('variant_not_found')) {
    return { error: 'One of the products no longer exists.', code: 'variant_not_found', status: 409 };
  }
  if (message.includes('empty_cart')) {
    return { error: 'The cart is empty.', code: 'empty_cart', status: 400 };
  }
  if (message.includes('no_payment')) {
    return { error: 'No payment was recorded.', code: 'no_payment', status: 400 };
  }
  if (message.includes('bad_method')) {
    return { error: 'Invalid payment method.', code: 'bad_method', status: 400 };
  }
  return { error: 'Could not record the sale.', code: 'rpc_failed', status: 500 };
}

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
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  if (!isSupabaseConfigured()) {
    return json({ error: 'Supabase is not configured.', code: 'not_configured' }, 503);
  }
  const d = parsed.data;
  const supabase = getSupabase();

  const shift = await getOpenShift(supabase, staff.userId);
  if (!shift) {
    return json({ error: 'Open your cash shift before selling.', code: 'no_open_shift' }, 409);
  }

  // La referencia se genera acá; si choca con una existente (23505) se reintenta.
  let orderId: string | null = null;
  let reference = '';
  for (let attempt = 0; attempt < 2 && !orderId; attempt++) {
    reference = makeRef('ORD');
    const { data, error } = await supabase.rpc('create_pos_sale', {
      p_reference: reference,
      p_staff_id: staff.userId,
      p_shift_id: shift.id,
      p_items: d.items.map((i) => ({
        variant_id: i.variant_id,
        qty: i.qty,
        discount: i.discount ?? 0,
      })),
      p_payments: d.payments.map((p) => ({ method: p.method, amount: p.amount })),
      p_customer_id: d.customer_id ?? null,
      p_staff_note: d.staff_note?.trim() || null,
    });

    if (!error) {
      orderId = data as unknown as string;
      break;
    }
    const msg = error.message ?? '';
    if (msg.includes('orders_reference_key') && attempt === 0) continue; // colisión de ref
    console.error('[shop/pos-sale]', msg);
    const mapped = mapRpcError(msg);
    return json({ error: mapped.error, code: mapped.code }, mapped.status);
  }
  if (!orderId) return json({ error: 'Could not record the sale.' }, 500);

  // Se devuelve la orden tal como quedó en la base: es lo que imprime el recibo.
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, reference, subtotal, discount_total, total, currency, picked_up_at')
      .eq('id', orderId)
      .maybeSingle(),
    supabase
      .from('order_items')
      .select('name_snapshot, sku_snapshot, unit_price, qty, discount, line_total')
      .eq('order_id', orderId)
      .order('created_at'),
  ]);

  return json(
    {
      ok: true,
      order_id: orderId,
      reference: order?.reference ?? reference,
      total: Number(order?.total ?? 0),
      currency: order?.currency ?? 'USD',
      sold_at: order?.picked_up_at ?? new Date().toISOString(),
      items: items ?? [],
      payments: d.payments,
    },
    201,
  );
};
