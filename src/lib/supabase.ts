import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para uso en server (SSR + API routes).
 * Usa service_role_key porque las escrituras las hacemos siempre desde el server
 * (nunca desde el cliente). Las lecturas públicas también van desde el server
 * para mantener el patrón consistente y evitar exponer claves.
 */

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase env vars are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Helper: retorna true si las env vars de Supabase están presentes y no son
 * los placeholders de .env.example. Útil para renderizar fallbacks estáticos
 * durante desarrollo/scaffolding antes de tener credenciales reales.
 */
export function isSupabaseConfigured(): boolean {
  const url = SUPABASE_URL ?? '';
  const key = SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return false;
  // Placeholders de .env.example: 'https://xxxxxxxxxxxxx.supabase.co' y 'eyJhbGci...'
  if (url.includes('xxxx') || key.includes('...')) return false;
  return true;
}

// ============================================
// Types (espejo del schema.sql)
// ============================================

export interface DbClassType {
  id: string;
  name: string;
  category: 'lesson' | 'package' | 'camp';
  price_per_person: number;
  ratio_label: string | null;
  description: string | null;
  included: string[];
  badge: string | null;
  cta_label: string | null;
  active: boolean;
  sort_order: number;
  min_guests: number;
  max_guests: number | null;
  duration_min: number;
  max_capacity: number;
  created_at: string;
  updated_at: string;
}

export interface DbInstructor {
  id: string;
  name: string;
  photo_url: string | null;
  years_teaching: number | null;
  certifications: string[];
  languages: string[];
  bio: string | null;
  favorite_break: string | null;
  personal_detail: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface DbReview {
  id: string;
  author_name: string;
  author_location: string | null;
  source: 'google' | 'tripadvisor' | 'direct';
  rating: number;
  quote: string;
  featured: boolean;
  active: boolean;
  created_at: string;
}

export interface DbLead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  interest: string;              // e.g. 'private', 'group', 'family', 'general'
  preferred_date: string | null; // DATE
  party_size: number | null;
  notes: string | null;
  source_page: string;           // slug de la página que originó el lead
  status: 'new' | 'contacted' | 'converted' | 'lost';
  created_at: string;
}

// ============================================
// Fase 1 — Reservas de lecciones + base compartida
// Espejo de supabase/schema-bookings.sql
// ============================================

export type StaffRole = 'owner' | 'staff';

export interface DbProfile {
  id: string;                    // = auth.users.id
  display_name: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
}

export interface DbCustomer {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  id_type: 'cedula' | 'dimex' | 'passport' | 'other' | null;
  id_number: string | null;
  country_of_residence: string | null;
  address: string | null;
  date_of_birth: string | null;  // DATE
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbWaiver {
  id: string;
  customer_id: string;               // siempre el titular del booking_group
  booking_participant_id: string | null;
  waiver_version: string;
  activity: 'lesson' | 'rental' | 'both';
  signed_at: string;
  signer_name_typed: string;         // adulto: su nombre. menor: nombre del tutor.
  accepted_terms: boolean;
  is_minor: boolean;
  guardian_name: string | null;
  ip: string | null;
  user_agent: string | null;
  rendered_text_snapshot: string;
  signature_svg: string | null;
  lang: string;                      // 'en' en v1
  created_at: string;
}

export type PaymentProvider = 'paypal' | 'sinpe' | 'cash' | 'tilopay' | 'card';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface DbPayment {
  id: string;
  provider: PaymentProvider;
  provider_ref: string | null;
  amount: number;
  currency: string;              // ISO 4217, 'USD' por defecto
  status: PaymentStatus;
  paid_at: string | null;
  related_type: 'booking' | 'booking_group' | 'rental_reservation' | 'order';
  related_id: string;            // FK blanda según related_type
  notes: string | null;
  collected_by: string | null;   // = profiles.id del staff que cobró (null = pago online)
  shift_id: string | null;       // = cash_shifts.id del turno abierto al cobrar
  created_at: string;
  updated_at: string;
}

export interface DbLessonSlot {
  id: string;
  slot_date: string;             // DATE
  start_time: string;            // TIME 'HH:MM:SS'
  class_type_id: string;
  instructor_id: string | null;
  capacity_total: number;
  status: 'open' | 'closed';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export type PaymentMethod = 'paypal' | 'on_arrival';

export interface DbBookingGroup {
  id: string;
  reference: string;             // p.ej. 'GRP-3F7K2'
  customer_id: string;
  total_amount: number;
  currency: string;
  payment_method: PaymentMethod | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
  created_at: string;
}

export interface DbBooking {
  id: string;
  reference: string;             // p.ej. 'MSS-3F7K2'
  group_id: string | null;
  customer_id: string;
  class_type_id: string;
  slot_id: string | null;
  slot_date: string;             // snapshot DATE
  start_time: string;            // snapshot TIME
  participants_count: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  status: BookingStatus;
  payment_method: PaymentMethod | 'cash' | 'card' | null;
  payment_id: string | null;
  waiver_id: string | null;
  source: 'web' | 'walk_in' | 'whatsapp' | 'phone';
  customer_note: string | null;
  staff_note: string | null;
  confirmation_sent_at: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;      // = profiles.id del staff que hizo el check-in
  created_at: string;
  updated_at: string;
}

export interface DbBookingParticipant {
  id: string;
  booking_id: string;
  full_name: string;
  age: number | null;
  is_minor: boolean;
  weight_kg: number | null;
  height_cm: number | null;
  experience_level: 'first_time' | 'beginner' | 'intermediate' | 'advanced' | null;
  waiver_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: string;
}

// ============================================
// Fase 2 — Rentals de tablas
// Espejo de supabase/schema-rentals.sql
// ============================================

export type BoardCategory =
  | 'softtop'
  | 'longboard'
  | 'funboard'
  | 'shortboard'
  | 'fish'
  | 'sup';
export type BoardSkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'all';
export type RentalRateType = 'hour' | 'day' | 'week';
export type RentalStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'picked_up'
  | 'returned'
  | 'cancelled'
  | 'no_show';

export interface DbBoardModel {
  id: string;
  name: string;
  slug: string;
  category: BoardCategory;
  length_label: string | null;
  volume_l: number | null;
  skill_level: BoardSkillLevel;
  description: string | null;
  image_urls: string[];
  price_per_hour: number;
  price_per_day: number;               // semana = price_per_day * 7 (calculado en la app)
  // Ficha del catálogo público
  width_in: number | null;
  thickness_in: number | null;
  fin_setup: string | null;            // Thruster, Quad, Twin…
  construction: string | null;         // Poliéster, Epoxi, Softtop…
  weight_min_kg: number | null;        // peso recomendado (se usa de filtro)
  weight_max_kg: number | null;
  best_for: string[];                  // Beach break, Point break…
  features: string[];                  // "Quillas FCS II incluidas"…
  active: boolean;
  featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbBoardUnit {
  id: string;
  model_id: string;
  code: string;                        // "6.2 Ap" — nº de tabla de la hoja + del QR
  slug: string | null;                 // URL del detalle público
  nickname: string | null;
  photo_url: string | null;            // foto propia de esta tabla
  default_fins: number;
  status: 'available' | 'maintenance' | 'retired';
  condition_notes: string | null;
  acquired_at: string | null;          // DATE
  created_at: string;
  updated_at: string;
}

export interface DbRental {
  id: string;
  reference: string;                   // 'RNT-XXXXX'
  group_id: string | null;
  customer_id: string;
  unit_id: string;
  model_id: string;                    // snapshot del modelo de la unidad
  start_at: string;                    // retiro
  end_at: string;                      // devolución prevista
  rate_type: RentalRateType;
  units_billed: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  status: RentalStatus;
  payment_method: 'paypal' | 'on_arrival' | 'cash' | 'card' | null;
  payment_id: string | null;
  waiver_id: string | null;
  reserved_by: string | null;          // = profiles.id del staff que creó la reserva (null = web)
  source: 'web' | 'walk_in' | 'whatsapp' | 'phone';
  fins_out: number | null;
  condition_out_photo_url: string | null;
  condition_out_notes: string | null;
  fins_in: number | null;
  condition_in_photo_url: string | null;
  condition_in_notes: string | null;
  damage_reported: boolean;
  damage_fee: number | null;
  picked_up_at: string | null;
  returned_at: string | null;
  checked_out_by: string | null;       // = profiles.id
  checked_in_by: string | null;        // = profiles.id
  customer_note: string | null;
  staff_note: string | null;
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;       // recordatorio de retiro
  overdue_notified_at: string | null;    // aviso de devolución vencida
  created_at: string;
  updated_at: string;
}

export interface RentalDurationPreset {
  label: string;
  kind: RentalRateType;
  qty: number;
  price?: number | null; // precio fijo del chip; ausente/null = calcular por tarifa del modelo
}

export interface DbRentalSettings {
  id: 1;
  min_duration_hours: number;
  max_duration_days: number;
  min_lead_hours: number;
  min_charge_unit: 'hour' | 'day';
  duration_presets: RentalDurationPreset[];
  updated_at: string;
}

// ============================================
// T4 — Cierre de caja (rentals + lecciones)
// Espejo de supabase/schema-cash.sql
// ============================================

export type CounterPaymentMethod = 'cash' | 'card';
export type CashShiftStatus = 'open' | 'closed' | 'reopened';

export interface DbCashShift {
  id: string;
  profile_id: string;            // de quién es el turno
  opened_at: string;
  opening_float: number;         // fondo inicial — lo fija el empleado
  closed_at: string | null;
  closed_by: string | null;      // = profiles.id (normal: el mismo; el dueño puede cerrar por otro)
  expected_cash: number | null;  // snapshot: opening_float + Σ efectivo del turno
  counted_cash: number | null;   // lo ingresa el empleado al cerrar
  difference: number | null;     // counted_cash - expected_cash
  card_total: number | null;     // Σ tarjeta del turno (informativo)
  status: CashShiftStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
