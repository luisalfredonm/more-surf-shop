import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Un reembolso de PayPal es un movimiento NUEVO en `payments`, fechado cuando
 * ocurre. La venta original queda 'paid', igual que con el reembolso de
 * mostrador (refund-counter.ts).
 *
 * Pisar la venta a 'refunded' reescribía el pasado: la venta desaparecía de su
 * día y el reembolso quedaba fechado ese mismo día, así que un reporte impreso
 * dejaba de coincidir con el mismo día reimpreso. Ver schema-reports.sql.
 *
 * El endpoint de reembolso y el webhook REFUNDED llegan por el mismo reembolso.
 * El índice único uq_payments_paypal_refund deja pasar sólo al primero; el
 * segundo vuelve como 'duplicate' y no pasa nada.
 */
export interface PayPalRefund {
  relatedType: string;
  relatedId: string;
  amount: number;
  currency: string;
  refundId: string | null;
  captureId: string | null;
  /** Quién lo hizo desde el panel. Null = llegó por webhook. */
  staffId: string | null;
}

export async function recordPayPalRefund(
  supabase: SupabaseClient,
  r: PayPalRefund,
): Promise<'recorded' | 'duplicate' | 'error'> {
  const { error } = await supabase.from('payments').insert({
    provider: 'paypal',
    provider_ref: r.refundId,
    amount: r.amount,
    currency: r.currency,
    status: 'refunded',
    paid_at: new Date().toISOString(),
    related_type: r.relatedType,
    related_id: r.relatedId,
    collected_by: r.staffId,
    // "kind":"refund" lo reconoce la migración de schema-reports.sql.
    notes: JSON.stringify({ kind: 'refund', refund_id: r.refundId, capture_id: r.captureId }),
  });
  if (!error) return 'recorded';
  if (error.code === '23505') return 'duplicate';
  console.error('[paypal-refund]', error.message);
  return 'error';
}

/** Id de la captura guardado en payments.notes al cobrar. */
export function captureIdFromNotes(notes: string | null): string | null {
  try {
    return JSON.parse(notes ?? '{}').capture_id ?? null;
  } catch {
    return null;
  }
}
