/**
 * Helpers de caja / cierre (T4). Los usan los endpoints de /api/cash/* y los
 * cobros de mostrador (/api/rentals/create, return, checkout, bookings).
 *
 * Regla: no se puede cobrar sin un turno abierto. Cada `payments` de mostrador
 * lleva `collected_by` (el staff) y `shift_id` (el turno abierto en ese momento).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Turno de caja abierto de un empleado, o null. */
export async function getOpenShift(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('cash_shifts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('status', 'open')
    .maybeSingle();
  return data ? { id: data.id as string } : null;
}

export interface ShiftTotals {
  cash_total: number;
  card_total: number;
  cash_count: number;
  card_count: number;
  refunds_total: number;
}

/**
 * Totales de un turno, calculados en el server (service_role saltea RLS).
 * El browser usa la RPC `cash_shift_totals` en su lugar.
 */
export async function getShiftTotals(
  supabase: SupabaseClient,
  shiftId: string,
): Promise<ShiftTotals> {
  const { data, error } = await supabase
    .from('payments')
    .select('provider, amount, status')
    .eq('shift_id', shiftId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { provider: string; amount: number; status: string }[];
  const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
    round2(rows.filter(pred).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const paid = (prov: string) => (r: (typeof rows)[number]) =>
    r.provider === prov && r.status === 'paid';
  return {
    cash_total: sum(paid('cash')),
    card_total: sum(paid('card')),
    cash_count: rows.filter(paid('cash')).length,
    card_count: rows.filter(paid('card')).length,
    refunds_total: sum((r) => r.status === 'refunded'),
  };
}

/** efectivo esperado = fondo inicial + efectivo cobrado − reembolsos. */
export function expectedCash(openingFloat: number, t: ShiftTotals): number {
  return round2(Number(openingFloat) + t.cash_total - t.refunds_total);
}
