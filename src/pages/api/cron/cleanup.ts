import type { APIRoute } from 'astro';
import { cronAuthorized } from '@lib/cron';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';

export const prerender = false;

// Reservas 'pending_payment' que nunca se pagaron: se borran pasadas 2h.
const MAX_AGE_HOURS = 2;

// Órdenes de tienda 'reserved' (paga al retirar) que nadie vino a buscar.
// Coincide con las 48 h que retiene shop_variant_available y con lo que se le
// promete al cliente en el checkout.
const ORDER_HOLD_HOURS = 48;

export const GET: APIRoute = async ({ request, url }) => {
  if (!cronAuthorized(request, url)) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no_supabase' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000).toISOString();
  let deletedBookings = 0;
  let deletedRentals = 0;
  let deletedGroups = 0;
  let deletedOrders = 0;
  let expiredOrders = 0;

  try {
    const [{ data: delB }, { data: delR }] = await Promise.all([
      supabase
        .from('bookings')
        .delete()
        .eq('status', 'pending_payment')
        .lt('created_at', cutoff)
        .select('id'),
      supabase
        .from('rentals')
        .delete()
        .eq('status', 'pending_payment')
        .lt('created_at', cutoff)
        .select('id'),
    ]);
    deletedBookings = (delB ?? []).length;
    deletedRentals = (delR ?? []).length;

    // Grupos 'pending' viejos que ya no tienen líneas (bookings ni rentals).
    const { data: pg } = await supabase
      .from('booking_groups')
      .select('id')
      .eq('status', 'pending')
      .lt('created_at', cutoff);
    for (const g of pg ?? []) {
      const [{ count: bc }, { count: rc }] = await Promise.all([
        supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('group_id', g.id),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('group_id', g.id),
      ]);
      if ((bc ?? 0) === 0 && (rc ?? 0) === 0) {
        await supabase.from('booking_groups').delete().eq('id', g.id);
        deletedGroups++;
      }
    }
    // --- Tienda ---
    // Sin pagar y vieja: se borra (nunca llegó a haber plata ni movimiento de
    // stock, así que no deja rastro que valga la pena guardar).
    const { data: delO } = await supabase
      .from('orders')
      .delete()
      .eq('status', 'pending_payment')
      .lt('created_at', cutoff)
      .select('id');
    deletedOrders = (delO ?? []).length;

    // Reservada y vencida: se cancela, no se borra. El cliente dejó sus datos y
    // el dueño quiere ver que la orden existió. Al pasar a 'cancelled' el stock
    // vuelve a estar disponible solo (shop_variant_available deja de contarla).
    const orderCutoff = new Date(Date.now() - ORDER_HOLD_HOURS * 3_600_000).toISOString();
    const { data: expO } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('status', 'reserved')
      .lt('created_at', orderCutoff)
      .select('id');
    expiredOrders = (expO ?? []).length;
  } catch (e) {
    console.error('[cron/cleanup]', e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      deletedBookings,
      deletedRentals,
      deletedGroups,
      deletedOrders,
      expiredOrders,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
