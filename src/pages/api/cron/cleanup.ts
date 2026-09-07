import type { APIRoute } from 'astro';
import { cronAuthorized } from '@lib/cron';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';

export const prerender = false;

// Reservas 'pending_payment' que nunca se pagaron: se borran pasadas 2h.
const MAX_AGE_HOURS = 2;

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
  } catch (e) {
    console.error('[cron/cleanup]', e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, deletedBookings, deletedRentals, deletedGroups }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
