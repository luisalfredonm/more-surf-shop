import { getSupabase, isSupabaseConfigured } from '../supabase';

/**
 * Disponibilidad de lecciones.
 *
 * Se apoya en la RPC `get_available_slots` (supabase/schema-bookings.sql), que
 * calcula el cupo restante = capacity_total − (participantes confirmados +
 * pending_payment recientes) y filta por antelación mínima en zona horaria de
 * Costa Rica. Solo devuelve slots con cupo > 0. Sin datos personales.
 */

export interface AvailableSlot {
  slot_id: string;
  slot_date: string;            // 'YYYY-MM-DD'
  start_time: string;           // 'HH:MM:SS'
  class_type_id: string;
  class_type_name: string;
  price_per_person: number;
  ratio_label: string | null;
  instructor_id: string | null;
  instructor_name: string | null;
  capacity_total: number;
  booked: number;
  remaining: number;
}

export interface AvailabilityQuery {
  from: string;                 // 'YYYY-MM-DD' inclusive
  to: string;                   // 'YYYY-MM-DD' inclusive
  classTypeId?: string | null;
  minLeadHours?: number;        // antelación mínima; default 2
}

const DEFAULT_MIN_LEAD_HOURS = 2;

/**
 * Minutos que una reserva en `pending_payment` retiene el cupo antes de que
 * la disponibilidad la ignore. Debe coincidir con el `interval '20 minutes'`
 * de la RPC get_available_slots en supabase/schema-bookings.sql.
 */
export const PENDING_HOLD_MINUTES = 20;

export async function getAvailableSlots(q: AvailabilityQuery): Promise<AvailableSlot[]> {
  if (!isSupabaseConfigured()) {
    // Sin Supabase no hay disponibilidad real; el UI cae a "escríbenos por WhatsApp".
    return [];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_from: q.from,
    p_to: q.to,
    p_class_type_id: q.classTypeId ?? null,
    p_min_lead_hours: q.minLeadHours ?? DEFAULT_MIN_LEAD_HOURS,
  });

  if (error) {
    console.error('[getAvailableSlots] Supabase error:', error.message);
    return [];
  }

  return (data ?? []) as AvailableSlot[];
}

export interface SlotDay {
  date: string;                 // 'YYYY-MM-DD'
  slots: AvailableSlot[];
}

/** Agrupa slots por fecha preservando el orden ascendente que devuelve la RPC. */
export function groupSlotsByDate(slots: AvailableSlot[]): SlotDay[] {
  const days: SlotDay[] = [];
  let current: SlotDay | null = null;
  for (const slot of slots) {
    if (!current || current.date !== slot.slot_date) {
      current = { date: slot.slot_date, slots: [] };
      days.push(current);
    }
    current.slots.push(slot);
  }
  return days;
}
