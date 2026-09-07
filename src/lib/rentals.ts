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

// ============================================
// Rango por fechas (vía online). Costa Rica es UTC-6 todo el año.
// El alquiler se cobra por días INCLUSIVOS: 9 jun → 9 jun = 1 día.
// La franja horaria del día son las horas de tienda, así una tabla devuelta
// el 9 queda libre para el 10.
// ============================================

/** Inicio del alquiler: la fecha a las 08:00 hora CR. */
export function dayStart(dateISO: string): Date {
  return new Date(`${dateISO}T08:00:00.000-06:00`);
}

/** Fin del alquiler: la fecha a las 18:00 hora CR. */
export function dayEnd(dateISO: string): Date {
  return new Date(`${dateISO}T18:00:00.000-06:00`);
}

/** Días inclusivos entre dos fechas YYYY-MM-DD (mínimo 1). */
export function inclusiveDays(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Convierte N días a la tarifa que corresponde. Múltiplos exactos de 7 van
 * como semanas — neutro en precio (semana = día×7) salvo que el chip de
 * semana tenga precio fijo, en cuyo caso ese gana.
 */
export function pickRate(days: number): { rateType: RentalRate; unitsBilled: number } {
  if (days >= 7 && days % 7 === 0) return { rateType: 'week', unitsBilled: days / 7 };
  return { rateType: 'day', unitsBilled: Math.max(1, days) };
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRentalRef(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}
