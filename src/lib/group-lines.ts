import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Líneas de un booking_group. Un grupo agrupa reservas de un solo tipo por
 * checkout: lecciones (`bookings`) o alquileres (`rentals`). Estos helpers
 * operan sobre ambos para que capture / refund no tengan que conocer cada tipo.
 */
const LINE_TABLES = ['bookings', 'rentals'] as const;

/**
 * Confirma las líneas de un grupo tras un pago capturado: las que estaban
 * 'pending_payment' pasan a 'confirmed' y reciben el payment_id. Idempotente
 * (el filtro por estado la vuelve no-op si ya se corrió).
 */
export async function confirmGroupLines(
  supabase: SupabaseClient,
  groupId: string,
  paymentId: string | null,
): Promise<void> {
  await Promise.all(
    LINE_TABLES.map((t) =>
      supabase
        .from(t)
        .update({ status: 'confirmed', payment_id: paymentId })
        .eq('group_id', groupId)
        .eq('status', 'pending_payment'),
    ),
  );
}

/**
 * Cancela todas las líneas de un grupo (p.ej. tras un reembolso).
 * Misma semántica que el refund actual: cancela todo lo del grupo.
 */
export async function cancelGroupLines(
  supabase: SupabaseClient,
  groupId: string,
): Promise<void> {
  await Promise.all(
    LINE_TABLES.map((t) =>
      supabase.from(t).update({ status: 'cancelled' }).eq('group_id', groupId),
    ),
  );
}
