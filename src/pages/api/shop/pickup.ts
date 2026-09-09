import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift } from '@lib/cash';

export const prerender = false;

/**
 * El cliente pasa a retirar su orden online.
 *
 * Lo hace la RPC `complete_shop_pickup` en UNA transacción: cobra si hacía
 * falta y descuenta el stock. Acá es donde `qty_on_hand` baja de verdad —
 * mientras la orden estuvo 'reserved' o 'paid' el stock sólo estaba retenido.
 *
 * Si la orden venía sin pagar, el cobro exige turno de caja abierto y queda
 * atribuido (collected_by + shift_id), así entra al cierre.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  order_id: z.string().uuid(),
  method: z.enum(['cash', 'card']).nullish(), // sólo si estaba sin pagar
});

function mapRpcError(msg: string): { error: string; code: string; status: number } {
  if (msg.includes('already_picked_up')) {
    return { error: 'That order was already handed over.', code: 'already_picked_up', status: 409 };
  }
  if (msg.includes('order_not_found')) {
    return { error: 'That order does not exist.', code: 'order_not_found', status: 404 };
  }
  if (msg.includes('payment_required')) {
    return {
      error: 'That order is unpaid — pick cash or card.',
      code: 'payment_required',
      status: 409,
    };
  }
  if (msg.includes('no_open_shift')) {
    return {
      error: 'Open your cash shift before collecting payment.',
      code: 'no_open_shift',
      status: 409,
    };
  }
  if (msg.includes('bad_status')) {
    return { error: 'That order cannot be handed over.', code: 'bad_status', status: 409 };
  }
  return { error: 'Could not complete the pickup.', code: 'rpc_failed', status: 500 };
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

  // El turno sólo hace falta si hay que cobrar; se busca igual y la RPC decide.
  const shift = await getOpenShift(supabase, staff.userId);

  const { data, error } = await supabase.rpc('complete_shop_pickup', {
    p_order_id: d.order_id,
    p_staff_id: staff.userId,
    p_shift_id: shift?.id ?? null,
    p_collect_method: d.method ?? null,
  });

  if (error) {
    console.error('[shop/pickup]', error.message);
    const mapped = mapRpcError(error.message ?? '');
    return json({ error: mapped.error, code: mapped.code }, mapped.status);
  }

  return json({ ok: true, collected: Number(data) || 0 }, 200);
};
