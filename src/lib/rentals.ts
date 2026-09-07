/**
 * Helpers puros de rentals — sin imports de server. Los usan
 * /api/rentals/create (walk-in) y /api/rentals/book (online).
 */

export const RENTAL_MS: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

export type RentalRate = 'hour' | 'day' | 'week';

export function computeEndAt(startAt: Date, rateType: string, qty: number): Date {
  return new Date(startAt.getTime() + qty * (RENTAL_MS[rateType] ?? RENTAL_MS.day));
}

/** Semana = tarifa/día × 7. Devuelve el precio unitario aplicado y el total. */
export function priceRental(
  perHour: number,
  perDay: number,
  rateType: string,
  qty: number,
): { unitPrice: number; total: number } {
  const unitPrice =
    rateType === 'hour' ? perHour : rateType === 'week' ? perDay * 7 : perDay;
  return { unitPrice, total: Math.round(unitPrice * qty * 100) / 100 };
}

/** Duración total del alquiler en días (para validar contra max_duration_days). */
export function durationDays(rateType: string, qty: number): number {
  return (qty * (RENTAL_MS[rateType] ?? RENTAL_MS.day)) / RENTAL_MS.day;
}

/**
 * Precio fijo del chip de duración que matchea (rate_type, qty), si el staff lo
 * definió en rental_settings. Devuelve null si no hay chip o no tiene precio.
 */
export function presetOverride(
  presets: { kind: string; qty: number; price?: number | null }[] | null | undefined,
  rateType: string,
  qty: number,
): number | null {
  const hit = (presets ?? []).find((p) => p.kind === rateType && p.qty === qty);
  return hit && typeof hit.price === 'number' && hit.price >= 0 ? hit.price : null;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRentalRef(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}
