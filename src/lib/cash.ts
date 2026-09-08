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
  refunds_cash: number;
  refunds_card: number;
  expenses_total: number;
}

/**
 * Totales de un turno, calculados en el server (service_role saltea RLS).
 * El browser usa la RPC `cash_shift_totals` en su lugar.
 */
export async function getShiftTotals(
  supabase: SupabaseClient,
  shiftId: string,
): Promise<ShiftTotals> {
  const [payRes, expRes] = await Promise.all([
    supabase.from('payments').select('provider, amount, status').eq('shift_id', shiftId),
    supabase.from('cash_expenses').select('amount').eq('shift_id', shiftId),
  ]);
  if (payRes.error) throw new Error(payRes.error.message);
  if (expRes.error) throw new Error(expRes.error.message);
  const rows = (payRes.data ?? []) as { provider: string; amount: number; status: string }[];
  const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
    round2(rows.filter(pred).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const is = (prov: string, st: string) => (r: (typeof rows)[number]) =>
    r.provider === prov && r.status === st;
  return {
    cash_total: sum(is('cash', 'paid')),
    card_total: sum(is('card', 'paid')),
    cash_count: rows.filter(is('cash', 'paid')).length,
    card_count: rows.filter(is('card', 'paid')).length,
    refunds_cash: sum(is('cash', 'refunded')),
    refunds_card: sum(is('card', 'refunded')),
    expenses_total: round2(
      (expRes.data ?? []).reduce((s, r) => s + (Number((r as { amount: number }).amount) || 0), 0),
    ),
  };
}

/** efectivo esperado = fondo inicial + efectivo cobrado − reembolsos en efectivo − gastos. */
export function expectedCash(openingFloat: number, t: ShiftTotals): number {
  return round2(Number(openingFloat) + t.cash_total - t.refunds_cash - t.expenses_total);
}
